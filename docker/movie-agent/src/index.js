#!/usr/bin/env node
/**
 * kais-movie-agent — REST API 入口
 *
 * 独立 Docker 服务，端口 8001。
 * 基于 node:http 零依赖实现（与 Toonflow 技术栈一致）。
 * 复用 lib/ 现有管线逻辑，HTTP 层仅在 server/ 下。
 */

import { createServer } from 'node:http';
import { pipelineRouter } from './routes/pipeline.js';
import { skillsRouter } from './routes/skills.js';
import { qualityGateRouter } from './routes/quality-gate.js';
import { callbacksRouter } from './routes/callbacks.js';
import { healthRouter } from './routes/health.js';
import { PipelineManager } from './pipeline/state-machine.js';

// ─── 全局管线管理器 ────────────────────────────────────────
const manager = new PipelineManager();

// 共享上下文：所有路由可访问
const ctx = { manager };

// ─── JSON 工具函数 ─────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res, message, status = 400) {
  jsonResponse(res, { error: message }, status);
}

// ─── 路由分发 ─────────────────────────────────────────────

const routers = [
  healthRouter,
  callbacksRouter,
  qualityGateRouter,
  pipelineRouter,
  skillsRouter,
];

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Signature',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  // 将工具注入 req 上下文
  req._ctx = ctx;
  req._parseBody = () => parseBody(req);
  res._json = (data, status) => jsonResponse(res, data, status);
  res._error = (msg, status) => errorResponse(res, msg, status);
  req._url = url;
  req._path = url.pathname;

  for (const router of routers) {
    const handled = await router(req, res);
    if (handled) return;
  }

  res._error('Not Found', 404);
}

// ─── 启动服务 ─────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8001', 10);

const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error(`[server] Unhandled error: ${err.message}`);
    if (!res.headersSent) {
      errorResponse(res, 'Internal Server Error', 500);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    service: 'kais-movie-agent',
    version: '6.0.0',
    event: 'server_started',
    port: PORT,
    ts: new Date().toISOString(),
  }));
});

server.on('error', err => {
  console.error(`[server] Fatal: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[server] Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
  });
}

export default server;
