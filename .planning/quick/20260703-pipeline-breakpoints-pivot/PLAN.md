---
slug: pipeline-breakpoints-pivot
date: 2026-07-03
status: in-progress
quick_id: 260703-pivot
repos:
  - kais-aigc-platform
---

# Pipeline Evolution Breakpoints — Pivoted Plan

## Context — why this plan differs from the original spec

The original task spec at `/tmp/gsd-task-pipeline-breakthrough.md` was written against the **retired** `kais-movie-agent` repo (lib/prompt-injector.js, lib/phases/index.js, lib/quality-gate.js, lib/iteration-engine.js). That repo is gone. The JS modules now live vendored as `.mjs` files under `kais-aigc-platform/src/runtime/`, and the per-phase prompt-injection logic has moved into Hermes skills (no longer in code).

**Original 5 breakpoints → pivoted 4 tasks:**

| # | Original | Pivoted approach |
|---|----------|------------------|
| 1 | prompt-injector.js ignores overrides | **Folded into task A** — override application lives in `iteration-engine.mjs::_buildPrompt` |
| 2 | 8 hardcoded system prompts in phases/index.js | **Folded into task A** — phase logic is in Hermes now; override text is appended to the iteration prompt as `[进化指令]` |
| 3 | /api/canvas/execute missing | **Already done in WIP** — just commit `execute.ts` |
| 4 | _buildPrompt empty base | **Task A** — fetch node via `POST /api/canvas/load` |
| 5 | quality-gate thresholds ignored | **Task B** — add `getEffectiveThresholds()` to IterationEngine (no quality-gate.mjs exists) |

## Goal

Close the pipeline evolution loop in the new arch: operator-approved overrides in `prompt-overrides.json` actually change downstream regeneration calls, and the threshold overrides are consumable by reflection flows.

## Tasks (3 atomic commits, single repo)

### Task A (breakpoints 1+2+4): Override-aware _buildPrompt

**Files:** `src/runtime/iteration-engine.mjs`

Replace `_buildPrompt(action)` (lines 481-487) with:

```javascript
async _buildPrompt(action) {
  // Step 1: fetch original node context (breakpoint 4)
  let base = '';
  try {
    const resp = await fetch(`${this.apiBase}/api/canvas/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: Number(this.projectId), episodesId: Number(this.episodesId) }),
    });
    if (resp.ok) {
      const body = await resp.json();
      const graph = body?.data ?? body;
      const node = Array.isArray(graph?.nodes) ? graph.nodes.find((n) => n.id === action.nodeId) : null;
      base = node?.description || node?.content || node?.prompt || '';
    }
  } catch { /* graceful degrade — empty base */ }

  // Step 2: load prompt-overrides.json (breakpoints 1+2)
  const overrides = await this._readJsonOptional(this.overridesPath) || {};

  // Step 3: collect prompt_modification additions (skip thresholds/parameterChanges)
  const additions = [];
  for (const [target, entries] of Object.entries(overrides)) {
    if (target === 'thresholds' || target === 'parameterChanges') continue;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry?.change) additions.push(entry.change);
      }
    }
  }

  // Step 4: compose base + [进化指令] + [迭代增补]
  let result = base;
  if (additions.length > 0) {
    result = result ? `${result}\n\n[进化指令] ${additions.join('; ')}` : `[进化指令] ${additions.join('; ')}`;
  }
  if (action.promptDelta) {
    result = result ? `${result}\n\n[迭代增补] ${action.promptDelta}` : `[迭代增补] ${action.promptDelta}`;
  }
  return result;
}
```

**Why this works:**
- The override `target` keys (`topic-selector`, `outline-writer`, etc.) were originally per-phase. In the new arch, Hermes owns the phase logic — the iteration engine just needs to apply approved evolution text to the regeneration prompt. Flat-appending ALL prompt_modification entries preserves operator intent.
- The `[进化指令]` prefix matches the original spec format. Operators reading the prompt see what was added by reflection.
- Backwards compat: empty overrides → `additions=[]` → no `[进化指令]` block. Empty promptDelta → no `[迭代增补]` block. Empty base + empty everything → returns `''` (same as pre-patch when promptDelta is absent).
- Uses existing helper `_readJsonOptional` (defined at iteration-engine.mjs:141) and existing endpoint `POST /api/canvas/load` (src/routes/canvas/load.ts).

**Verify:** unit test mocks `fetch` to return a node with `description: 'ORIGINAL_DESC'`, writes an overrides file with `{ 'topic-selector': [{ change: 'PREFER_SUSPENSE' }], thresholds: { total: { change: 70 } } }`, calls `_buildPrompt({ nodeId: 'n1', promptDelta: 'DELTA' })`, asserts result contains `ORIGINAL_DESC`, `[进化指令] PREFER_SUSPENSE`, `[迭代增补] DELTA`, AND does NOT contain `70` (threshold filtered out).

### Task B (breakpoint 5): getEffectiveThresholds() method

**Files:** `src/runtime/iteration-engine.mjs`

Add a new public method (place near `_applyPipelineAdjustment` ~line 610):

```javascript
/**
 * Returns effective thresholds by merging defaults with operator-approved overrides
 * from prompt-overrides.json. Used by reflection/iteration flows when evaluating
 * whether quality scores pass the bar.
 *
 * Default thresholds: { total: 65, critical: 40, warning: 75 }
 * Override shape (per threshold_adjustment): { thresholds: { <target>: { change: <number> } } }
 *
 * @returns {Promise<{total:number, critical:number, warning:number}>}
 */
async getEffectiveThresholds() {
  const defaults = { total: 65, critical: 40, warning: 75 };
  try {
    const overrides = await this._readJsonOptional(this.overridesPath) || {};
    if (!overrides.thresholds) return defaults;
    const merged = { ...defaults };
    for (const [key, val] of Object.entries(overrides.thresholds)) {
      if (val?.change != null && typeof val.change === 'number') {
        merged[key] = val.change;
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}
```

**Why this approach:**
- No quality-gate.mjs exists in the new arch. The threshold consumer that used to live in `lib/quality-gate.js` was retired with the docker movie-agent image.
- The natural place for threshold-aware logic now is the IterationEngine itself, which already owns the prompt-overrides.json file (it writes to it via `_applyPipelineAdjustment`).
- Exposing `getEffectiveThresholds()` as a public async method lets future Hermes skills / iteration flows consult operator-approved thresholds via `engine.getEffectiveThresholds()`.
- Backwards compat: no overrides file → returns defaults unchanged. Non-numeric change values silently ignored.

**Verify:** unit test writes an overrides file with `{ thresholds: { total: { change: 70 }, warning: { change: 80 } } }`, calls `getEffectiveThresholds()`, asserts result is `{ total: 70, critical: 40, warning: 80 }`. Also test: no file → defaults. Also test: non-numeric change → ignored.

### Task C (breakpoint 3): Commit already-fixed execute.ts

**Files:** `src/routes/canvas/execute.ts`

The fix is already applied as WIP. Verify the current file state matches:
- Schema accepts `projectId: union(number, string)`, `episodesId: optional`, `nodeId: string().min(1)`, `nodeType: optional`, `prompt: optional`, `branchId: optional`
- Handler has a `if (episodesId === undefined || episodesId === null) { return res.status(200).send(success({ status: 'queued', ... })) }` branch for IterationEngine callers
- Existing canvas-UI path (with `episodesId`) preserved unchanged

**Just commit this single file.** Do NOT touch router.ts (route already registered). Do NOT use `git add -A` or `git add .` — only `git add src/routes/canvas/execute.ts`.

**Verify:** `git diff --cached --name-only` should show only `src/routes/canvas/execute.ts`. `npx tsc --noEmit src/routes/canvas/execute.ts` should pass.

## Test file

**Files:** `test/runtime/iteration-engine-overrides.test.mjs` (NEW)

Use `node:test` + `node:assert`. Cover:

1. `_buildPrompt` with no overrides file, no promptDelta, fetch returns node with description → returns description.
2. `_buildPrompt` with overrides `{ 'topic-selector': [{ change: 'PREFER_SUSPENSE' }], thresholds: { total: { change: 70 } } }`, promptDelta `'DELTA'`, fetch returns node with description `'ORIGINAL_DESC'` → returns string containing `ORIGINAL_DESC`, `[进化指令] PREFER_SUSPENSE`, `[迭代增补] DELTA`, NOT containing `70`.
3. `_buildPrompt` with fetch throwing → returns `[迭代增补] DELTA` (graceful degrade, no crash).
4. `_buildPrompt` with empty overrides file, empty promptDelta, fetch returns node with `prompt` field → returns just the node prompt.
5. `getEffectiveThresholds()` with no overrides file → returns `{ total: 65, critical: 40, warning: 75 }`.
6. `getEffectiveThresholds()` with `{ thresholds: { total: { change: 70 }, warning: { change: 80 } } }` → returns `{ total: 70, critical: 40, warning: 80 }`.
7. `getEffectiveThresholds()` with `{ thresholds: { total: { change: 'bad' } } }` → returns defaults unchanged.

Mock `fetch` via `global.fetch` swap with `beforeEach`/`afterEach` restore. Construct engine via `new IterationEngine(tmpDir, { apiBase: 'http://test', projectId: 1, episodesId: 2, llmCaller: async () => '{}' })`. Use `mkdtemp` for tmpDir, write overrides file via `writeFile` to `${tmpDir}/.pipeline-assets/prompt-overrides.json`.

## Commit strategy

Three atomic commits in `/data/workspace/kais-aigc-platform`:

1. `fix(runtime): iteration-engine _buildPrompt fetches node + applies prompt overrides (breakpoints 1, 2, 4)` — touches `src/runtime/iteration-engine.mjs` + test file
2. `feat(runtime): IterationEngine.getEffectiveThresholds() merges threshold overrides (breakpoint 5)` — touches `src/runtime/iteration-engine.mjs` + test file (same test file as #1, expanded)
3. `fix(canvas): execute route accepts iteration-engine payload (breakpoint 3)` — touches ONLY `src/routes/canvas/execute.ts`

**Alternative**: combine 1+2 into a single commit since they touch the same file. Prefer 3 separate commits for clean history if the executor can manage the staging cleanly. If combining, use commit message: `fix(runtime): iteration-engine applies prompt+threshold overrides, fetches node context (breakpoints 1, 2, 4, 5)`.

**CRITICAL WIP SAFETY:** the kais-aigc-platform working tree has 30+ WIP files. Before EVERY commit:
```bash
git status --short
```
Confirm only the intended files are staged. Use explicit `git add <path>` only.

## Constraints

1. Single repo: `/data/workspace/kais-aigc-platform/`. Do NOT touch the deleted kais-movie-agent paths.
2. Do NOT use `git add -A` or `git add .` — only explicit file paths.
3. Do NOT modify `src/router.ts` (route already registered).
4. Do NOT modify `src/routes/canvas/_simulate.ts` or `_engine.ts`.
5. Backwards compat: when overrides file is missing or empty, behavior is byte-identical to pre-patch.
6. Do NOT change the `_callEngine` contract or any other method in iteration-engine.mjs.
7. Do NOT change the `_applyPipelineAdjustment` method — it already writes overrides correctly.

## Success criteria

- All 3 commits land in kais-aigc-platform
- `node --test test/runtime/iteration-engine-overrides.test.mjs` passes (7+ cases)
- `npx tsc --noEmit src/routes/canvas/execute.ts` clean
- `git status --short` after final commit shows same WIP files as before (we only added/modified the 3 we intended)
- `_buildPrompt` now:
  - Fetches original node description via `/api/canvas/load`
  - Applies prompt_modification overrides from `prompt-overrides.json` as `[进化指令]`
  - Composes with `[迭代增补]` promptDelta
  - Degrades gracefully on fetch failure
- `getEffectiveThresholds()` returns merged thresholds
- `/api/canvas/execute` accepts IterationEngine's payload without 400
