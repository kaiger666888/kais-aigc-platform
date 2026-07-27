/**
 * canvas-client.js — 画布 API 客户端（CJS，零依赖）
 *
 * 供 sync-canvas.js 等 Node CLI 共用：
 *   - config     从环境变量解析（CANVAS_API_HOST / CANVAS_API_PORT / DB_PATH）
 *   - apiCall    调用画布 v2 HTTP API（超时 10s，错误带 apiPath 上下文）
 *   - loadGraph  加载画布图（404 或无 data 返回 null）
 *   - saveGraph  保存画布图（code 非 200/0 抛错）
 *   - parseArgs / parseRequired / usageExit  CLI 参数辅助
 */

const http = require('http');
const path = require('path');

// ─── Config ───────────────────────────────────────────────

const config = {
  host: process.env.CANVAS_API_HOST || '127.0.0.1',
  port: parseInt(process.env.CANVAS_API_PORT || '10588', 10),
  // 本文件位于 scripts/canvas/lib/，仓库根在上三级；默认指向仓库根 data/db2.sqlite
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', '..', '..', 'data', 'db2.sqlite'),
};

// ─── HTTP helper ──────────────────────────────────────────

function apiCall(apiPath, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: config.host,
        port: config.port,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks));
          } catch {
            reject(new Error(`Invalid JSON response from ${apiPath}: ${chunks.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', (err) => {
      reject(new Error(`${apiPath} request failed: ${err.message}`));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms): ${apiPath}`));
    });
    req.write(data);
    req.end();
  });
}

// ─── Canvas Graph load/save via v2 API ────────────────────

async function loadGraph(projectId, episodesId) {
  const res = await apiCall('/api/canvas/v2/load-v2', { projectId, episodesId });
  if (res.code === 404 || !res.data) return null;
  return res.data;
}

async function saveGraph(projectId, episodesId, graph) {
  const res = await apiCall('/api/canvas/v2/save-v2', { projectId, episodesId, graph });
  if (res.code !== 200 && res.code !== 0) {
    throw new Error(`Save failed: ${res.message || JSON.stringify(res)}`);
  }
  return res;
}

// ─── Arg parsing ──────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        args[key] = val;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function parseRequired(args, required) {
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: --${missing.join(' --')}`);
    process.exit(1);
  }
  return args;
}

// 打印 usage 文本到 stderr 并 exit(1)
function usageExit(usageText) {
  console.error(usageText);
  process.exit(1);
}

module.exports = { config, apiCall, loadGraph, saveGraph, parseArgs, parseRequired, usageExit };
