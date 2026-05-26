/**
 * kais-movie-agent — Pipeline HTTP Server
 *
 * Zero npm dependencies. Pure node:http + ESM imports.
 * Provides Pipeline lifecycle API for the AIGC platform.
 */

import http from 'node:http';
import { Pipeline } from '../lib/pipeline.js';
import { CoreBackendClient } from '../lib/core-backend-client.js';
import { GoldTeamClient } from '../lib/gold-team-client.js';
import { ReviewPlatformClient } from '../lib/review-platform-client.js';

// ─── In-memory pipeline registry ──────────────────────────────
// Maps pipelineId → { pipeline, config, status, createdAt }
const pipelines = new Map();

// ─── Helpers ──────────────────────────────────────────────────
function json(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function parseUrl(url) {
  const [path, qs] = url.split('?');
  return { path, qs };
}

// ─── Route handlers ───────────────────────────────────────────

// GET /health
function handleHealth(_req, res) {
  json(res, 200, {
    status: 'ok',
    service: 'kais-movie-agent',
    version: '6.0.0',
    pipelines: pipelines.size,
  });
}

// GET /api/v1/pipelines
function handleListPipelines(_req, res) {
  const list = [];
  for (const [id, entry] of pipelines) {
    list.push({
      pipeline_id: id,
      status: entry.status,
      episode: entry.episode,
      created_at: entry.createdAt,
    });
  }
  json(res, 200, { pipelines: list, total: list.length });
}

// POST /api/v1/pipeline/create
async function handleCreatePipeline(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const projectId = body.project_id || body.projectId;
    const config = body.config || {};
    const metadata = body.metadata || {};

    if (!projectId) {
      return json(res, 400, { error: 'project_id is required' });
    }

    // Generate pipeline ID
    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const episode = config.episode || `E${pipelineId.slice(-4)}`;

    // Create pipeline instance
    const workdir = process.env.PIPELINE_WORKDIR || `/mnt/agents/output/pipelines/${pipelineId}`;
    const pipeline = new Pipeline(episode, {
      ...config,
      workdir,
      projectId,
    });

    pipelines.set(pipelineId, {
      pipeline,
      episode,
      projectId,
      config,
      metadata,
      status: 'created',
      createdAt: new Date().toISOString(),
    });

    json(res, 201, {
      pipeline_id: pipelineId,
      episode,
      status: 'created',
      created_at: pipelines.get(pipelineId).createdAt,
    });
  } catch (err) {
    console.error('[pipeline/create]', err);
    json(res, 500, { error: err.message });
  }
}

// POST /api/v1/pipeline/run
async function handleRunPipeline(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const projectId = body.project_id || body.projectId;
    const config = body.config || {};

    if (!projectId) {
      return json(res, 400, { error: 'project_id is required' });
    }

    // Generate pipeline ID
    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const episode = config.episode || `E${pipelineId.slice(-4)}`;

    const workdir = config.workdir || process.env.PIPELINE_WORKDIR || `/mnt/agents/output/pipelines/${pipelineId}`;
    const pipeline = new Pipeline(episode, {
      ...config,
      workdir,
      projectId,
    });

    pipelines.set(pipelineId, {
      pipeline,
      episode,
      projectId,
      config,
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    // Start pipeline in background — do NOT await it
    pipeline.run(config.phases || {}).then(result => {
      const entry = pipelines.get(pipelineId);
      if (entry) {
        entry.status = result.success ? 'completed' : 'failed';
        entry.result = result;
        entry.completedAt = new Date().toISOString();
      }
    }).catch(err => {
      console.error(`[pipeline/run] Pipeline ${pipelineId} failed:`, err);
      const entry = pipelines.get(pipelineId);
      if (entry) {
        entry.status = 'failed';
        entry.error = err.message;
        entry.completedAt = new Date().toISOString();
      }
    });

    json(res, 202, {
      pipeline_id: pipelineId,
      episode,
      status: 'running',
      message: 'Pipeline started',
    });
  } catch (err) {
    console.error('[pipeline/run]', err);
    json(res, 500, { error: err.message });
  }
}

// GET /api/v1/pipeline/:id/status
async function handlePipelineStatus(req, res, pipelineId) {
  const entry = pipelines.get(pipelineId);
  if (!entry) {
    return json(res, 404, { error: 'Pipeline not found', pipeline_id: pipelineId });
  }

  try {
    const status = await entry.pipeline.getStatus();
    json(res, 200, {
      pipeline_id: pipelineId,
      episode: entry.episode,
      status: entry.status,
      created_at: entry.createdAt,
      completed_at: entry.completedAt || null,
      phases: status.phases,
    });
  } catch (err) {
    // getStatus may fail if pipeline dir doesn't exist yet
    json(res, 200, {
      pipeline_id: pipelineId,
      episode: entry.episode,
      status: entry.status,
      created_at: entry.createdAt,
      completed_at: entry.completedAt || null,
      phases: Pipeline.getPhases().map(p => ({ id: p.id, name: p.name, order: p.stageOrder, status: 'pending' })),
    });
  }
}

// GET /api/v1/pipeline/:id/phases
async function handlePipelinePhases(req, res, pipelineId) {
  const entry = pipelines.get(pipelineId);
  if (!entry) {
    return json(res, 404, { error: 'Pipeline not found', pipeline_id: pipelineId });
  }

  const phases = Pipeline.getPhases().map(p => ({
    id: p.id,
    name: p.name,
    stage: p.stage,
    order: p.stageOrder,
    review: !!p.review,
  }));

  json(res, 200, phases);
}

// POST /api/v1/pipeline/:id/cancel
async function handlePipelineCancel(req, res, pipelineId) {
  const entry = pipelines.get(pipelineId);
  if (!entry) {
    return json(res, 404, { error: 'Pipeline not found', pipeline_id: pipelineId });
  }

  const prevStatus = entry.status;
  entry.status = 'cancelled';
  entry.completedAt = new Date().toISOString();

  json(res, 200, {
    pipeline_id: pipelineId,
    previous_status: prevStatus,
    status: 'cancelled',
    message: 'Pipeline cancelled',
  });
}

// POST /api/v1/pipeline/:id/resume
async function handlePipelineResume(req, res, pipelineId) {
  const entry = pipelines.get(pipelineId);
  if (!entry) {
    return json(res, 404, { error: 'Pipeline not found', pipeline_id: pipelineId });
  }

  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch {}

  entry.status = 'running';
  const fromPhase = body.from_phase || null;

  pipeline.resume(fromPhase, entry.config.phases || {}).then(result => {
    entry.status = result.success ? 'completed' : 'failed';
    entry.result = result;
    entry.completedAt = new Date().toISOString();
  }).catch(err => {
    entry.status = 'failed';
    entry.error = err.message;
    entry.completedAt = new Date().toISOString();
  });

  json(res, 202, {
    pipeline_id: pipelineId,
    status: 'running',
    message: 'Pipeline resumed',
  });
}

// ─── Router ───────────────────────────────────────────────────
async function handleRequest(req, res) {
  const { path } = parseUrl(req.url);
  const method = req.method;

  // Health
  if (path === '/health' && method === 'GET') {
    return handleHealth(req, res);
  }

  // List pipelines
  if (path === '/api/v1/pipelines' && method === 'GET') {
    return handleListPipelines(req, res);
  }

  // Create pipeline
  if (path === '/api/v1/pipeline/create' && method === 'POST') {
    return handleCreatePipeline(req, res);
  }

  // Run pipeline
  if (path === '/api/v1/pipeline/run' && method === 'POST') {
    return handleRunPipeline(req, res);
  }

  // Pipeline sub-routes: /api/v1/pipeline/:id/...
  const pipelineMatch = path.match(/^\/api\/v1\/pipeline\/([^/]+)\/(.+)$/);
  if (pipelineMatch) {
    const [, pipelineId, action] = pipelineMatch;
    if (action === 'status' && method === 'GET') {
      return handlePipelineStatus(req, res, pipelineId);
    }
    if (action === 'phases' && method === 'GET') {
      return handlePipelinePhases(req, res, pipelineId);
    }
    if (action === 'cancel' && method === 'POST') {
      return handlePipelineCancel(req, res, pipelineId);
    }
    if (action === 'resume' && method === 'POST') {
      return handlePipelineResume(req, res, pipelineId);
    }
  }

  // Also support /api/v1/pipeline/:id (status shorthand)
  const pipelineShortMatch = path.match(/^\/api\/v1\/pipeline\/([^/]+)$/);
  if (pipelineShortMatch && method === 'GET') {
    return handlePipelineStatus(req, res, pipelineShortMatch[1]);
  }

  json(res, 404, { error: 'Not Found', path });
}

// ─── Start server ─────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8001');

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('[server] Unhandled error:', err);
    json(res, 500, { error: 'Internal Server Error' });
  });
});

server.listen(PORT, () => {
  console.log(`[movie-agent] Server listening on port ${PORT}`);
  console.log(`[movie-agent] Health: http://localhost:${PORT}/health`);
  console.log(`[movie-agent] Pipelines: http://localhost:${PORT}/api/v1/pipelines`);
});
