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

// ─── Review reverse index: review_id → pipelineId ──────────────
// Populated when review is submitted; persisted to pipeline state.
const reviewIndex = new Map(); // review_id (number) → pipelineId (string)

// ─── Review index helper ──────────────────────────────────────
function rebuildReviewIndex(entry, pipelineId) {
  // Scan pipeline state and populate reviewIndex
  entry.pipeline._loadState().then(state => {
    for (const [phaseId, phaseState] of Object.entries(state.phases || {})) {
      if (phaseState.review_id) {
        reviewIndex.set(Number(phaseState.review_id), pipelineId);
      }
    }
  }).catch(() => {});
}

// ─── HMAC verification for callbacks ───────────────────────────
import crypto from 'node:crypto';

function verifyCallbackSignature(body, signatureHeader, secret) {
  if (!secret) return true; // No secret configured → skip verification
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^sha256=([0-9a-f]+)$/);
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[1]));
}

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
    const pipeline = new Pipeline({
      workdir,
      projectId,
      episode,
      config: {
        ...config,
        projectId,
        episode,
        // Toonflow bridge config
        scriptId: config.scriptId || null,
        episodesId: config.episodesId || null,
        toonflowBaseUrl: config.toonflowBaseUrl || process.env.TOONFLOW_BASE_URL || 'http://kais-core-backend:8000',
        ossRoot: config.ossRoot || '/app/data/oss',
      },
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
    const pipeline = new Pipeline({
      workdir,
      projectId,
      episode,
      config: {
        ...config,
        projectId,
        episode,
        // Toonflow bridge config — propagated from start API
        scriptId: body.script_id || body.scriptId || config.scriptId || null,
        episodesId: body.episodes_id || body.episodesId || config.episodesId || null,
        toonflowBaseUrl: config.toonflowBaseUrl || body.toonflowBaseUrl || process.env.TOONFLOW_BASE_URL || 'http://kais-core-backend:8000',
        ossRoot: config.ossRoot || body.ossRoot || '/app/data/oss',
      },
    });

    pipelines.set(pipelineId, {
      pipeline,
      episode,
      projectId,
      config,
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    // Build phasesConfig: convert phases array to object map and attach phase-specific config
    const phasesList = body.phases || config.phases || [];
    const phasesConfig = {};
    if (Array.isArray(phasesList)) {
      for (const phaseId of phasesList) {
        phasesConfig[phaseId] = config[phaseId] || {};
      }
      // Pass scene data from config.scenes into scene phase config
      if (phasesConfig.scene && config.scenes) {
        phasesConfig.scene.scenes = config.scenes;
      }
      // Pass shots data into storyboard/camera phases
      if (phasesConfig.storyboard && config.shots) {
        phasesConfig.storyboard.shots = config.shots;
      }
    } else if (typeof phasesList === 'object') {
      Object.assign(phasesConfig, phasesList);
    }

    // Attach skipNonListed flag so run() only executes specified phases
    pipeline._phaseFilter = Array.isArray(phasesList) ? new Set(phasesList) : null;

    // Start pipeline in background — do NOT await it
    pipeline.run(phasesConfig).then(result => {
      const entry = pipelines.get(pipelineId);
      if (entry) {
        entry.status = result.success ? 'completed' : 'failed';
        entry.result = result;
        entry.completedAt = new Date().toISOString();
        // Rebuild review index after pipeline settles (may have submitted reviews)
        rebuildReviewIndex(entry, pipelineId);
      }
    }).catch(err => {
      console.error(`[pipeline/run] Pipeline ${pipelineId} failed:`, err);
      const entry = pipelines.get(pipelineId);
      if (entry) {
        entry.status = 'failed';
        entry.error = err.message;
        entry.completedAt = new Date().toISOString();
        rebuildReviewIndex(entry, pipelineId);
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

  entry.pipeline.resume(fromPhase, entry.config.phases || {}).then(result => {
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

// ─── Review callback handler ─────────────────────────────────
// POST /api/v1/pipeline/callback/review_result
// Receives review-platform approval/rejection callbacks and resumes pipeline.
//
// Supports:
// - O(1) lookup via reviewIndex (populated during submit)
// - Recovery from movie-agent restart: scans pipeline state dirs
// - HMAC signature verification (optional, when secret configured)
// - Rejected reviews: sets 'review_rejected' status (not 'failed')
async function handleReviewCallback(req, res) {
  try {
    const rawBody = await readBody(req);
    const payload = JSON.parse(rawBody);

    console.log(`[callback] Review callback received: review_id=${payload.review_id}, disposition=${payload.disposition}`);

    // Verify HMAC signature if secret is configured
    const signatureHeader = req.headers['x-callback-signature'] || '';
    const callbackSecret = process.env.REVIEW_CALLBACK_SECRET || '';
    if (callbackSecret && !verifyCallbackSignature(rawBody, signatureHeader, callbackSecret)) {
      console.warn(`[callback] HMAC signature verification failed for review_id=${payload.review_id}`);
      return json(res, 401, { error: 'Invalid callback signature' });
    }

    const { review_id, disposition, source_system, result } = payload;

    if (!review_id || !disposition) {
      return json(res, 400, { error: 'Missing review_id or disposition' });
    }

    // --- Phase 1: O(1) lookup via in-memory index ---
    let targetEntry = null;
    let targetPipelineId = reviewIndex.get(Number(review_id)) || reviewIndex.get(String(review_id)) || null;

    if (targetPipelineId) {
      targetEntry = pipelines.get(targetPipelineId);
    }

    // --- Phase 2: Scan in-memory pipelines (covers pipelines loaded but not yet indexed) ---
    if (!targetEntry) {
      for (const [pid, entry] of pipelines) {
        try {
          const state = await entry.pipeline._loadState();
          for (const phaseState of Object.values(state.phases)) {
            if (phaseState.review_id == review_id) { // loose equality for number/string
              targetEntry = entry;
              targetPipelineId = pid;
              // Backfill index
              reviewIndex.set(Number(review_id), pid);
              break;
            }
          }
          if (targetEntry) break;
        } catch (e) {
          // skip pipelines with broken state
        }
      }
    }

    // --- Phase 3: Recover from disk (movie-agent restarted, pipelines Map empty) ---
    if (!targetEntry) {
      const { readdir, readFile: readFileAsync } = await import('node:fs/promises');
      const baseDir = process.env.PIPELINE_WORKDIR || '/mnt/agents/output/pipelines';
      try {
        const dirs = await readdir(baseDir);
        for (const dir of dirs) {
          const statePath = `${baseDir}/${dir}/.pipeline-state.json`;
          try {
            const stateRaw = await readFileAsync(statePath, 'utf-8');
            const state = JSON.parse(stateRaw);
            for (const [phaseId, phaseState] of Object.entries(state.phases || {})) {
              if (phaseState.review_id == review_id) {
                // Reconstruct pipeline from disk
                const pipelineId = dir.startsWith('pipe-') ? dir : null;
                // Try to match by pipelineId in directory name
                if (!pipelineId) continue;
                targetPipelineId = pipelineId;

                const pipeline = new Pipeline({
                  workdir: `${baseDir}/${dir}`,
                  projectId: state.projectId || 'unknown',
                  episode: state.episode || 'EP01',
                  config: {},
                });
                // Restore _phaseFilter from state if available
                pipeline._phaseFilter = null;

                targetEntry = {
                  pipeline,
                  episode: state.episode || 'EP01',
                  projectId: state.projectId || 'unknown',
                  config: { phases: {} },
                  status: 'awaiting_review',
                  createdAt: state.startedAt || new Date().toISOString(),
                };

                pipelines.set(targetPipelineId, targetEntry);
                reviewIndex.set(Number(review_id), targetPipelineId);
                console.log(`[callback] Recovered pipeline ${targetPipelineId} from disk for review_id=${review_id}`);
                break;
              }
            }
          } catch (e) {
            // Not a pipeline dir or corrupt state — skip
          }
          if (targetEntry) break;
        }
      } catch (e) {
        console.warn(`[callback] Disk recovery scan failed: ${e.message}`);
      }
    }

    if (!targetEntry) {
      console.warn(`[callback] No pipeline found for review_id=${review_id}`);
      return json(res, 404, { error: 'No pipeline awaiting this review', review_id });
    }

    // Update the phase state based on disposition
    const state = await targetEntry.pipeline._loadState();
    let targetPhaseId = null;
    for (const [phaseId, phaseState] of Object.entries(state.phases)) {
      if (phaseState.review_id == review_id) {
        targetPhaseId = phaseId;
        if (disposition === 'approved') {
          phaseState.status = 'approved';
          phaseState.approvedAt = new Date().toISOString();
          phaseState.reviewResult = result || {};
        } else {
          phaseState.status = 'review_rejected';
          phaseState.rejectedAt = new Date().toISOString();
          phaseState.reviewResult = result || {};
        }
        break;
      }
    }
    await targetEntry.pipeline._saveState(state);

    console.log(`[callback] Pipeline ${targetPipelineId}/${targetPhaseId}: review #${review_id} ${disposition}`);

    if (disposition === 'approved') {
      // Sync the approved phase output to Toonflow (now that it's fully complete)
      if (targetPhaseId) {
        try {
          const { syncPhaseOutput } = await import('./toonflow-bridge.js');
          await syncPhaseOutput(targetPhaseId, targetEntry.pipeline.workdir, targetEntry.pipeline.config);
          console.log(`[callback] Toonflow sync for approved phase=${targetPhaseId}`);
        } catch (syncErr) {
          console.warn(`[callback] Toonflow sync failed for ${targetPhaseId}: ${syncErr.message}`);
        }
      }

      // Approved → resume pipeline from next phase
      targetEntry.status = 'running';
      targetEntry.pipeline.resume(null, targetEntry.config.phases || {}).then(r => {
        targetEntry.status = r.success ? 'completed' : 'failed';
        targetEntry.result = r;
        targetEntry.completedAt = new Date().toISOString();
        console.log(`[callback] Pipeline ${targetPipelineId} resumed and ${r.success ? 'completed' : 'failed'}`);
      }).catch(err => {
        targetEntry.status = 'failed';
        targetEntry.error = err.message;
        targetEntry.completedAt = new Date().toISOString();
        console.error(`[callback] Pipeline ${targetPipelineId} resume failed: ${err.message}`);
      });
    } else {
      // Rejected → pause pipeline, allow re-trigger
      targetEntry.status = 'review_rejected';
      targetEntry.error = `Review rejected for ${targetPhaseId}: review_id=${review_id}`;
      console.log(`[callback] Pipeline ${targetPipelineId} paused (review_rejected) for phase ${targetPhaseId}`);
    }

    json(res, 200, {
      ok: true,
      pipeline_id: targetPipelineId,
      phase: targetPhaseId,
      disposition,
      review_id,
    });
  } catch (err) {
    console.error('[callback] Review callback error:', err);
    json(res, 500, { error: err.message });
  }
}

// ─── Router ───────────────────────────────────────────────────
async function handleRequest(req, res) {
  const { path } = parseUrl(req.url);
  const method = req.method;

  // Health
  if (path === '/health' && method === 'GET') {
    return handleHealth(req, res);
  }

  // Review callback
  if (path === '/api/v1/pipeline/callback/review_result' && method === 'POST') {
    return handleReviewCallback(req, res);
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

  // Review callback — must come before pipeline sub-routes to avoid :id match
  // Already handled above at /api/v1/pipeline/callback/review_result

  // POST /api/v1/pipeline/:id/resubmit-review
  // Re-triggers a rejected review phase
  const resubmitMatch = path.match(/^\/api\/v1\/pipeline\/([^/]+)\/resubmit-review$/);
  if (resubmitMatch && method === 'POST') {
    const pipelineId = resubmitMatch[1];
    const entry = pipelines.get(pipelineId);
    if (!entry) return json(res, 404, { error: 'Pipeline not found', pipeline_id: pipelineId });

    try {
      const body = JSON.parse(await readBody(req));
      const phaseId = body.phase_id;
      if (!phaseId) return json(res, 400, { error: 'phase_id is required' });

      const state = await entry.pipeline._loadState();
      const phaseState = state.phases[phaseId];
      if (!phaseState || phaseState.status !== 'review_rejected') {
        return json(res, 400, { error: `Phase ${phaseId} is not in review_rejected state`, current_status: phaseState?.status });
      }

      // Reset phase state so run/resume will re-execute it
      delete state.phases[phaseId];
      await entry.pipeline._saveState(state);

      // Resume from this phase
      entry.status = 'running';
      entry.pipeline.resume(phaseId, entry.config.phases || {}).then(r => {
        entry.status = r.success ? 'completed' : 'failed';
        entry.result = r;
        entry.completedAt = new Date().toISOString();
      }).catch(err => {
        entry.status = 'failed';
        entry.error = err.message;
        entry.completedAt = new Date().toISOString();
      });

      json(res, 202, {
        pipeline_id: pipelineId,
        phase: phaseId,
        status: 'running',
        message: `Re-running phase ${phaseId} for re-review`,
      });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
    return;
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

server.listen(PORT, async () => {
  console.log(`[movie-agent] Server listening on port ${PORT}`);
  console.log(`[movie-agent] Health: http://localhost:${PORT}/health`);
  console.log(`[movie-agent] Pipelines: http://localhost:${PORT}/api/v1/pipelines`);

  // ── Startup: recover pending reviews from disk ──────────────
  try {
    const { readdir, readFile: readFileAsync } = await import('node:fs/promises');
    const baseDir = process.env.PIPELINE_WORKDIR || '/mnt/agents/output/pipelines';
    const dirs = await readdir(baseDir);
    let recoveredCount = 0;
    for (const dir of dirs) {
      if (!dir.startsWith('pipe-')) continue;
      try {
        const stateRaw = await readFileAsync(`${baseDir}/${dir}/.pipeline-state.json`, 'utf-8');
        const state = JSON.parse(stateRaw);
        for (const [phaseId, phaseState] of Object.entries(state.phases || {})) {
          if (phaseState.review_id && phaseState.status === 'awaiting_review') {
            reviewIndex.set(Number(phaseState.review_id), dir);
            recoveredCount++;
          }
        }
      } catch (e) {
        // skip non-pipeline dirs
      }
    }
    if (recoveredCount > 0) {
      console.log(`[movie-agent] Recovered ${recoveredCount} pending review(s) from disk`);
    }
  } catch (e) {
    // Pipeline workdir may not exist yet — that's fine
    console.log(`[movie-agent] No existing pipelines to recover`);
  }
});
