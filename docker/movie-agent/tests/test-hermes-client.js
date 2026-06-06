/**
 * Unit tests for hermes-client.js
 *
 * Uses Node.js built-in test runner (node --test).
 * Mocks global fetch to simulate hermes-agent responses and failures.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// We will dynamically import after setting up mocks
const { default: decache } = await import('data:text/javascript,export default () => {}');

// --- Mock infrastructure ---

let mockFetch;
let originalFetch;

const MOCK_DECIDE_RESPONSE = {
  decision_id: 'test-uuid-1234',
  recommendation: 'Use steps=25, guidance_scale=4.0 for anime style',
  confidence: 0.75,
  domain: 'movie-pipeline',
  task: 'soul-visual',
  timestamp: '2026-06-06T12:00:00+00:00',
};

const MOCK_AUDIT_RESPONSE = {
  recorded: true,
  auto_learn_triggered: false,
  decision_id: 'test-uuid-1234',
};

function setupMockFetch(responses) {
  let callIndex = 0;
  mockFetch = mock.fn(async (url, options) => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;

    if (response.error) {
      const err = new Error(response.error);
      err.name = response.errorName || 'Error';
      if (response.error === 'ECONNREFUSED') {
        err.code = 'ECONNREFUSED';
      }
      throw err;
    }

    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.body,
    };
  });
  globalThis.fetch = mockFetch;
}

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  mock.reset();
});

// Helper to get fresh module (bypass ESM cache via query string)
async function importFresh() {
  const mod = await import(`../lib/hermes-client.js?_t=${Date.now()}`);
  return mod;
}

// --- Tests ---

describe('hermes-client', () => {
  describe('decide()', () => {
    it('Test 1: sends POST to /v1/decide with domain="movie-pipeline" and returns parsed DecideResponse', async () => {
      setupMockFetch([{
        ok: true,
        status: 200,
        body: MOCK_DECIDE_RESPONSE,
      }]);

      const { decide } = await importFresh();

      const result = await decide('soul-visual', { style: 'anime' });

      // Verify fetch was called correctly
      assert.equal(mockFetch.mock.calls.length, 1);
      const [callUrl, callOptions] = mockFetch.mock.calls[0].arguments;
      assert.ok(callUrl.includes('/v1/decide'), `URL should contain /v1/decide, got: ${callUrl}`);
      assert.equal(callOptions.method, 'POST');
      assert.equal(callOptions.headers['Content-Type'], 'application/json');

      const body = JSON.parse(callOptions.body);
      assert.equal(body.domain, 'movie-pipeline');
      assert.equal(body.task, 'soul-visual');
      assert.deepEqual(body.context, { style: 'anime' });

      // Verify response shape
      assert.equal(result.decision_id, 'test-uuid-1234');
      assert.equal(result.recommendation, 'Use steps=25, guidance_scale=4.0 for anime style');
      assert.equal(result.confidence, 0.75);
      assert.equal(result.domain, 'movie-pipeline');
      assert.equal(result.task, 'soul-visual');
    });

    it('Test 2: returns degraded response with HERMES_DEFAULTS when server returns ECONNREFUSED', async () => {
      setupMockFetch([
        { error: 'ECONNREFUSED', errorName: 'TypeError' },
        { error: 'ECONNREFUSED', errorName: 'TypeError' }, // retry also fails
      ]);

      const { decide } = await importFresh();

      const result = await decide('soul-visual');

      assert.equal(result.degraded, true);
      assert.equal(result.decision_id, null);
      assert.equal(result.confidence, 0);
      assert.equal(result.domain, 'movie-pipeline');
      assert.equal(result.task, 'soul-visual');

      // recommendation should be JSON-stringified HERMES_DEFAULTS["soul-visual"]
      const parsed = JSON.parse(result.recommendation);
      assert.equal(parsed.flux.steps, 20);
      assert.equal(parsed.flux.guidance_scale, 3.5);
    });

    it('Test 3: retries once on timeout then degrades to HERMES_DEFAULTS', async () => {
      // First call times out, second call also times out -> degrade
      setupMockFetch([
        { error: 'The operation was aborted', errorName: 'TimeoutError' },
        { error: 'The operation was aborted', errorName: 'TimeoutError' },
      ]);

      const { decide } = await importFresh();

      const result = await decide('soul-visual');

      // Should have retried (2 fetch calls total)
      assert.equal(mockFetch.mock.calls.length, 2);
      assert.equal(result.degraded, true);
      assert.equal(result.confidence, 0);

      const parsed = JSON.parse(result.recommendation);
      assert.equal(parsed.flux.steps, 20);
    });

    it('Test 6: degrades with empty object {} for unknown task', async () => {
      setupMockFetch([
        { error: 'ECONNREFUSED', errorName: 'TypeError' },
        { error: 'ECONNREFUSED', errorName: 'TypeError' },
      ]);

      const { decide } = await importFresh();

      const result = await decide('unknown-task');

      assert.equal(result.degraded, true);
      assert.equal(result.recommendation, '{}');
    });
  });

  describe('audit()', () => {
    it('Test 4: sends POST to /v1/audit with correct body and returns AuditResponse', async () => {
      setupMockFetch([{
        ok: true,
        status: 200,
        body: MOCK_AUDIT_RESPONSE,
      }]);

      const { audit } = await importFresh();

      const result = await audit('decision-123', 'completed', { score: 8 });

      assert.equal(mockFetch.mock.calls.length, 1);
      const [callUrl, callOptions] = mockFetch.mock.calls[0].arguments;
      assert.ok(callUrl.includes('/v1/audit'), `URL should contain /v1/audit, got: ${callUrl}`);
      assert.equal(callOptions.method, 'POST');

      const body = JSON.parse(callOptions.body);
      assert.equal(body.domain, 'movie-pipeline');
      assert.equal(body.decision_id, 'decision-123');
      assert.equal(body.outcome, 'completed');
      assert.deepEqual(body.metrics, { score: 8 });

      assert.equal(result.recorded, true);
      assert.equal(result.auto_learn_triggered, false);
      assert.equal(result.decision_id, 'test-uuid-1234');
    });

    it('Test 5: returns {recorded: false} without throwing when server is unreachable', async () => {
      setupMockFetch([
        { error: 'ECONNREFUSED', errorName: 'TypeError' },
      ]);

      const { audit } = await importFresh();

      // Must NOT throw
      const result = await audit('decision-123');

      assert.equal(result.recorded, false);
      assert.equal(result.auto_learn_triggered, false);
      assert.equal(result.decision_id, 'decision-123');
    });
  });
});
