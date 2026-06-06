/**
 * Hermes Client — Decision engine HTTP client with graceful degradation
 *
 * Calls hermes-agent FastAPI service (POST /v1/decide, POST /v1/audit).
 * When the service is unreachable, decide() falls back to HERMES_DEFAULTS
 * so the pipeline never blocks. audit() never throws.
 *
 * Pattern: gold-team-client.js (async functions + native fetch + timeout)
 * Zero external npm dependencies (Node 20+ built-in fetch).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HERMES_URL = process.env.HERMES_URL || 'http://kais-hermes-agent:8080';
const HERMES_DOMAIN = 'movie-pipeline';
const TIMEOUT_MS = 5000;    // 5s per request
const RETRY_DELAY_MS = 1000; // 1s before retry

/**
 * Hardcoded parameter defaults grouped by task.
 * Sourced from register_movie_pipeline.py SEED_MEMORY.
 * Always available — no network dependency.
 */
const HERMES_DEFAULTS = {
  'soul-visual': {
    flux: {
      steps: 20,
      guidance_scale: 3.5,
      sampler: 'euler',
      scheduler: 'normal',
      width: 1024,
      height: 1024,
      denoise: 1.0,
      seed: -1,
    },
  },
  'video-gen': {
    wan: {
      width: 832,
      height: 480,
      num_frames: 81,
      fps: 16,
      cfg: 3.5,
      shift: 5.0,
      total_steps: 20,
    },
  },
  'voice': {
    tts: {
      voice: 'default',
      speed: 1.0,
    },
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Perform a single fetch attempt to the hermes-agent.
 * @param {string} path - API path (e.g. '/v1/decide')
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 * @throws on network error, timeout, or non-2xx status
 */
async function _hermesRequest(path, body) {
  const resp = await fetch(`${HERMES_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask hermes-agent for a decision on the given task.
 *
 * Retries once on failure. On second failure, degrades to HERMES_DEFAULTS
 * and returns a synthetic response with degraded=true.
 *
 * @param {string} task - Task name (e.g. 'soul-visual', 'video-gen')
 * @param {object} [context={}] - Additional context for the decision
 * @returns {Promise<{decision_id: string|null, recommendation: string, confidence: number, domain: string, task: string, timestamp: string, degraded?: boolean}>}
 */
export async function decide(task, context = {}) {
  const body = { domain: HERMES_DOMAIN, task, context };

  // First attempt
  try {
    return await _hermesRequest('/v1/decide', body);
  } catch {
    // Retry once after delay
    try {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return await _hermesRequest('/v1/decide', body);
    } catch {
      // Degrade to defaults
      console.warn(`[hermes-client] Service unavailable, using defaults for task=${task}`);
      return {
        decision_id: null,
        recommendation: JSON.stringify(HERMES_DEFAULTS[task] || {}),
        confidence: 0,
        domain: HERMES_DOMAIN,
        task,
        timestamp: new Date().toISOString(),
        degraded: true,
      };
    }
  }
}

/**
 * Record audit feedback for a previous decision.
 *
 * NEVER throws — audit is non-blocking. On any failure, returns
 * {recorded: false, auto_learn_triggered: false, decision_id}.
 *
 * @param {string} decisionId - UUID from a prior decide() call
 * @param {string} [outcome='completed'] - Outcome of the decision
 * @param {object} [metrics={}] - Evaluation metrics
 * @returns {Promise<{recorded: boolean, auto_learn_triggered: boolean, decision_id: string}>}
 */
export async function audit(decisionId, outcome = 'completed', metrics = {}) {
  const body = {
    domain: HERMES_DOMAIN,
    decision_id: decisionId,
    outcome,
    metrics,
  };

  try {
    return await _hermesRequest('/v1/audit', body);
  } catch (err) {
    console.warn(`[hermes-client] Audit failed: ${err.message}`);
    return {
      recorded: false,
      auto_learn_triggered: false,
      decision_id: decisionId,
    };
  }
}
