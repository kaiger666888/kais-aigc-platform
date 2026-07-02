---
slug: pipeline-breakpoints-pivot
date: 2026-07-03
status: complete
quick_id: 260703-pivot
---

# Summary — Pipeline Evolution Breakpoints (Pivoted)

## Pivot context

Original task spec at `/tmp/gsd-task-pipeline-breakthrough.md` targeted the now-retired `kais-movie-agent` repo (`lib/prompt-injector.js`, `lib/phases/index.js`, `lib/quality-gate.js`, `lib/iteration-engine.js`). User-issued pivot directive (`/tmp/gsd-correction.txt`) consolidated all consumption logic into `iteration-engine.mjs` in `kais-aigc-platform/src/runtime/`. The original 5-breakpoint mapping:

| Original | Pivoted reality |
|----------|-----------------|
| Breakpoint 1 (prompt-injector.js) | Folded into `_buildPrompt` override application |
| Breakpoint 2 (8 hardcoded system prompts) | Folded into `_buildPrompt` — phase logic lives in Hermes skills now, override text flat-appended as `[进化指令]` |
| Breakpoint 3 (/api/canvas/execute) | Already fixed in WIP — committed as-is |
| Breakpoint 4 (empty _buildPrompt) | Fixed via `POST /api/canvas/load` node fetch |
| Breakpoint 5 (quality-gate thresholds) | New `getEffectiveThresholds()` method on IterationEngine |

## Commits (3, all in kais-aigc-platform)

| Hash | Message | Files |
|------|---------|-------|
| `af62000c` | `fix(runtime): iteration-engine _buildPrompt fetches node + applies prompt overrides (breakpoints 1, 2, 4)` | `src/runtime/iteration-engine.mjs` (+47), `test/runtime/iteration-engine-overrides.test.mjs` (+98, new) |
| `faeab497` | `feat(runtime): IterationEngine.getEffectiveThresholds() merges threshold overrides (breakpoint 5)` | `src/runtime/iteration-engine.mjs` (+28), `test/runtime/iteration-engine-overrides.test.mjs` (+31) |
| `4214a018` | `fix(canvas): execute route accepts iteration-engine payload (breakpoint 3)` | `src/routes/canvas/execute.ts` (+28 / −8) |

## What the new _buildPrompt does

```javascript
async _buildPrompt(action) {
  // 1. Fetch original node via POST /api/canvas/load
  let base = '';
  try {
    const resp = await fetch(`${this.apiBase}/api/canvas/load`, { ... });
    if (resp.ok) {
      const graph = (await resp.json())?.data;
      const node = graph?.nodes?.find((n) => n.id === action.nodeId);
      base = node?.description || node?.content || node?.prompt || '';
    }
  } catch { /* graceful degrade */ }

  // 2. Load prompt-overrides.json
  const overrides = await this._readJsonOptional(this.overridesPath) || {};

  // 3. Collect prompt_modification additions (skip thresholds / parameterChanges)
  const additions = [];
  for (const [target, entries] of Object.entries(overrides)) {
    if (target === 'thresholds' || target === 'parameterChanges') continue;
    if (Array.isArray(entries)) {
      for (const entry of entries) if (entry?.change) additions.push(entry.change);
    }
  }

  // 4. Compose: base + [进化指令] additions + [迭代增补] promptDelta
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

## What getEffectiveThresholds() does

```javascript
async getEffectiveThresholds() {
  const defaults = { total: 65, critical: 40, warning: 75 };
  const overrides = await this._readJsonOptional(this.overridesPath) || {};
  if (!overrides.thresholds) return defaults;
  const merged = { ...defaults };
  for (const [key, val] of Object.entries(overrides.thresholds)) {
    if (val?.change != null && typeof val.change === 'number') merged[key] = val.change;
  }
  return merged;
}
```

## Test coverage — 7/7 pass

`node --test test/runtime/iteration-engine-overrides.test.mjs`:

1. `_buildPrompt` no overrides, no promptDelta → returns node description
2. `_buildPrompt` with overrides + promptDelta → contains description, `[进化指令]` additions, `[迭代增补]` delta, filters out thresholds
3. `_buildPrompt` fetch throws → graceful degrade to `[迭代增补]` delta only
4. `_buildPrompt` empty overrides + empty delta + node.prompt field → returns just the node prompt
5. `getEffectiveThresholds()` no overrides file → returns defaults
6. `getEffectiveThresholds()` with overrides → merges into defaults
7. `getEffectiveThresholds()` with non-numeric change → ignored, returns defaults

## WIP safety

Pre-execution WIP count: 66 entries. Post-execution: 66 entries. Every commit used explicit `git add <path>` — never `-A`/`.`/`-u`. The 30+ WIP files in `packages/infinite-canvas/`, `scripts/`, `workflows/`, `src/routes/production/`, etc. were untouched.

## Backwards compatibility

All overrides consumption is opt-in:
- `_buildPrompt` with empty/missing overrides file → no `[进化指令]` block, behavior same as pre-patch
- `getEffectiveThresholds()` with no overrides → returns defaults unchanged
- `/api/canvas/execute` with canvas-UI payload (`episodesId`+`nodeType`) → simulateExecution path unchanged

## Limitations / follow-ups

- The original spec's per-phase override key mapping (`topic-selector`, `outline-writer`, etc.) is no longer used — the new arch flat-appends ALL prompt_modification entries. This loses per-phase granularity but preserves operator intent: approved evolution text reaches the regeneration prompt.
- No quality-gate.mjs exists in the new arch. `getEffectiveThresholds()` exposes the merged thresholds but there is no automatic consumer in the iteration flow yet — future Hermes skills can call it when threshold-aware decisions are needed.
- The `/api/canvas/execute` endpoint still returns a queued stub response for IterationEngine callers; actual engine dispatch (gold-team/jimeng) is a separate future task.

## Deviations from plan

None. Implementation matches PLAN.md verbatim.
