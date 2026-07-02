import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IterationEngine } from '../../src/runtime/iteration-engine.mjs';

let tmpDir;
let originalFetch;
let fetchMock;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'iter-engine-'));
  originalFetch = global.fetch;
});

afterEach(async () => {
  global.fetch = originalFetch;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

function setFetchMock(fn) {
  fetchMock = fn;
  global.fetch = (...args) => fn(...args);
}

function makeEngine() {
  return new IterationEngine(tmpDir, {
    apiBase: 'http://test',
    projectId: 1,
    episodesId: 2,
    llmCaller: async () => '{}',
  });
}

async function writeOverrides(obj) {
  const assetsDir = join(tmpDir, '.pipeline-assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(
    join(assetsDir, 'prompt-overrides.json'),
    JSON.stringify(obj),
    'utf-8',
  );
}

// ─── _buildPrompt tests (breakpoints 1, 2, 4) ─────────────────────────

test('_buildPrompt: case 1 — no overrides, no promptDelta, returns node description', async () => {
  setFetchMock(async (url, opts) => {
    assert.match(url, /\/api\/canvas\/load$/);
    return {
      ok: true,
      json: async () => ({
        data: { nodes: [{ id: 'n1', description: 'ORIGINAL_DESC' }] },
      }),
    };
  });
  const engine = makeEngine();
  const result = await engine._buildPrompt({ nodeId: 'n1' });
  assert.equal(result, 'ORIGINAL_DESC');
});

test('_buildPrompt: case 2 — applies prompt overrides + promptDelta, filters thresholds', async () => {
  setFetchMock(async () => ({
    ok: true,
    json: async () => ({ data: { nodes: [{ id: 'n1', description: 'ORIGINAL_DESC' }] } }),
  }));
  await writeOverrides({
    'topic-selector': [{ change: 'PREFER_SUSPENSE' }],
    thresholds: { total: { change: 70 } },
  });
  const engine = makeEngine();
  const result = await engine._buildPrompt({ nodeId: 'n1', promptDelta: 'DELTA' });
  assert.ok(result.includes('ORIGINAL_DESC'), 'must include node description');
  assert.ok(result.includes('[进化指令] PREFER_SUSPENSE'), 'must include evolution directive');
  assert.ok(result.includes('[迭代增补] DELTA'), 'must include iteration delta');
  assert.ok(!result.includes('70'), 'must NOT include threshold value 70');
});

test('_buildPrompt: case 3 — fetch throws, graceful degrade to just promptDelta', async () => {
  setFetchMock(async () => { throw new Error('network down'); });
  const engine = makeEngine();
  const result = await engine._buildPrompt({ nodeId: 'n1', promptDelta: 'DELTA' });
  assert.equal(result, '[迭代增补] DELTA');
});

test('_buildPrompt: case 4 — empty overrides + empty promptDelta + node.prompt field', async () => {
  setFetchMock(async () => ({
    ok: true,
    json: async () => ({
      data: { nodes: [{ id: 'n1', prompt: 'NODE_PROMPT' }] },
    }),
  }));
  await writeOverrides({});
  const engine = makeEngine();
  const result = await engine._buildPrompt({ nodeId: 'n1' });
  assert.equal(result, 'NODE_PROMPT');
});

// ─── getEffectiveThresholds tests (breakpoint 5) ──────────────────────

test('getEffectiveThresholds: case 5 — no overrides file returns defaults', async () => {
  const engine = makeEngine();
  const result = await engine.getEffectiveThresholds();
  assert.deepEqual(result, { total: 65, critical: 40, warning: 75 });
});

test('getEffectiveThresholds: case 6 — overrides merge into defaults', async () => {
  await writeOverrides({
    thresholds: {
      total: { change: 70 },
      warning: { change: 80 },
    },
  });
  const engine = makeEngine();
  const result = await engine.getEffectiveThresholds();
  assert.deepEqual(result, { total: 70, critical: 40, warning: 80 });
});

test('getEffectiveThresholds: case 7 — non-numeric change ignored, returns defaults', async () => {
  await writeOverrides({
    thresholds: {
      total: { change: 'bad' },
    },
  });
  const engine = makeEngine();
  const result = await engine.getEffectiveThresholds();
  assert.deepEqual(result, { total: 65, critical: 40, warning: 75 });
});
