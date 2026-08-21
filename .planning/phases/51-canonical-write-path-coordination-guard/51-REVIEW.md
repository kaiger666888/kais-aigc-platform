---
phase: 51
depth: standard
status: clean
date: 2026-08-21
---

# Phase 51 Code Review

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| Warning | 1 (1 fixed ✅) |
| Info | 7 |

**Overall:** The phase is well-executed. The serializer (`v3/serialize.ts`) is a faithful inverse of `migrate.ts buildMeta`, its wire shape mirrors the server zod contract (`src/types/flowgraph-v2-schema.ts`) field-for-field, and the `rawDataByNodeId` merge formula correctly protects audio required fields. Socket wiring has no stale-closure risk (`useCanvasSocket` routes all events through a per-render refreshed `callbacksRef`). The new tests assert real failure modes (mock-reject rollback, forced-failure self-check in verify-phase-51, transform-survival) rather than tautologies. No ASVS L1 issues: toast messages render as React text (auto-escaped), no `dangerouslySetInnerHTML` anywhere in the package, no YAML parsing, and the removed v1 route has zero remaining live callers (grep confirms only DEPRECATED scripts and `static/` build artifacts hit `canvas/save`). One Warning for a rollback-integrity race in the new `deleteNode`.

## Findings

### W1 — Warning: `deleteNode` whole-graph rollback clobbers concurrent canonical writes — ✅ FIXED (2026-08-21)

**Resolution:** `deleteNode` no longer snapshots/restores `prevGraph` wholesale. It now snapshots only the removed entities (`DeleteSnapshot`: node + original index, touched links + indices, touched variantGroups + indices) and, on save failure, calls the new pure transform `reinsertDeleted(graph, snapshot)` against the **current** graph — re-inserting the node, its links (endpoint-alive + id guards), and variant-group membership/winner (winner restored only if the concurrent graph has none). Concurrent canonical writes that land during the await (socket state/preview, `updateAssetMeta`, `variant:selected`) survive the rollback. Fallback: if the graph was wholly cleared mid-await, restore the pre-delete graph. Regression test `e` in `deleteNode.test.ts` drives a mid-flight `applySocketNodeState`/`applySocketNodePreview` through a mock-rejected save and asserts both the concurrent writes and the restored node. Verified: infinite-canvas vitest 203/203 green (incl. 8 deleteNode tests), pkg `tsc -b` exit 0, root `tsc --noEmit` exit 0.

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:698-705`

**Issue:** On save failure, `deleteNode` restores the entire pre-delete snapshot: `get().setGraph(prevGraph, get().warnings)`. Between the optimistic `applyGraphTransform` (L681) and the `await saveCanvasGraph(...)` rejection, any concurrent canonical write — socket `node:state`/`node:preview` (`applySocketNodeState`/`applySocketNodePreview`), a MetadataEditor edit (`updateAssetMeta`), or a remote `variant:selected` transform — lands on the post-delete graph and is then silently wiped by the wholesale snapshot restore.

**Why it matters:** During an active pipeline run, socket state events arrive continuously; a failed delete (network blip, server 400/500) during a run will roll node states/thumbnails back to stale values with no signal beyond the toast. The sibling actions in the same file avoid exactly this: `approveNode`/`rejectNode` (L607-609, L643-645) do *field-level* restore against the *current* graph (`withReviewStatus(cur, nodeId, prev)`), preserving interleaved edits. `deleteNode` breaks that established pattern.

**Suggested fix:** Restore surgically against the current graph instead of wholesale: re-insert the deleted node, its removed links, and the original variantGroups entries (winner/membership) into `get().graph` via a pure transform, leaving all other nodes untouched. E.g. snapshot `{ node, touchedLinks, prevGroups }` instead of `prevGraph`, then in the catch: `applyGraphTransform((g) => reinsert(g, snapshot))` — with guards for ids that reappeared in the meantime. If the simple restore is intentionally kept, document the accepted race window in the action's comment.

### I1 — Info: round-trip meta loss through `buildMeta` (pre-existing migrate gap, surfaced by the new write path)

**File:** `packages/infinite-canvas/src/v3/serialize.ts:155-178` × `packages/flowgraph-v3/ts/src/migrate.ts:210-278`

**Issue:** `flattenMeta` spreads all meta fields into the data bag, but reload-side `buildMeta` only lifts a subset: `script.emotion`, `storyboard.promptMeta`, `video.murchGrade`, and `global.archetype`/`viewAngle` are persisted into `data.*` yet never read back into canonical meta. After save → reload these fields vanish from `asset.meta` (they survive only in the `rawDataByNodeId` passthrough view). Notably, `META_PATCHABLE_KEYS` (canvasStore.ts:306-317) whitelists `murchGrade`, `emotion`, `archetype`, `viewAngle`, `promptMeta` for `updateAssetMeta` patching — implying a persistence guarantee the load side doesn't honor. The storyboard fields actually editable in the UI (`cameraMovement/framing/composition/pacing/durationS`) round-trip fine.

**Why it matters:** Canonical-first write path claims save/reload fidelity; these five fields silently don't survive reload. Pre-existing in migrate (not introduced this phase), but the new serializer is now the only write path, so the leak is permanent rather than incidental.

**Suggested fix:** Extend `buildMeta` branches in flowgraph-v3 to read the missing fields (script `emotion`, storyboard `promptMeta`, video `murchGrade`, global `archetype`/`viewAngle`) in a follow-up phase; until then, either narrow `META_PATCHABLE_KEYS` to round-trip-safe fields or add a code comment on the whitelist noting which keys are write-only-persistent.

### I2 — Info: approve/reject rollback coerces absent `reviewStatus` to `'pending'`

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:608, 644`

**Issue:** `prev ?? 'pending'` — if the node had no `reviewStatus` before a failed approve/reject, rollback assigns `reviewStatus: 'pending'` rather than restoring the field's absence. Minor semantic drift vs. a true snapshot.

**Suggested fix:** When `prev === undefined`, delete the key in the rollback transform instead of substituting `'pending'` (or snapshot the node object and restore it).

### I3 — Info: serializer can emit variant groups with empty `variantNodeIds`

**File:** `packages/infinite-canvas/src/v3/serialize.ts:297`

**Issue:** `members = g.variantNodeIds.filter((id) => persistedIds.has(id))` can yield `[]` (e.g., a group whose members are all event nodes). Empty arrays pass the server zod (`z.array(z.string())`, no `.min(1)`), so semantically empty groups persist. `deleteNode` already drops empty groups client-side; the serializer doesn't.

**Suggested fix:** Add `.filter((g) => g.variantNodeIds.length > 0)` (plus a warning) to the variantGroups mapping for defense in depth.

### I4 — Info: agent-sync.js v1→v2 normalization passes `type`/link `id` through unvalidated

**File:** `scripts/agent-sync.js:287-307`

**Issue:** The client-side re-implementation of the deleted v1 route's normalization sends `type: n.type || 'script'` and `id: l.id` straight to save-v2's zod gate. A v1 node typed `scene_image` (a known historical type with no zod slot — the exact case serialize.ts guards with `V2_NODE_TYPES`) or an edge lacking `id` fails the *entire graph* with 400. This is behavioral parity with the deleted route (same fragility, server-side), and `episodesId: 1` remains hardcoded (pre-existing). Risk is low: the script is a documented manual tool with no automated callers.

**Suggested fix:** Mirror serialize.ts's whitelist guard (`V2_NODE_TYPES.has(type) ? type : 'asset'`) and synthesize a fallback link id (`lv2_${i}`) when missing.

### I5 — Info: socket `node:created` still writes the derived cache directly

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:217-224`

**Issue:** `onNewAsset` appends the new node via `setNodes` — a derived-cache-only write. The node never enters `store.graph`, so it is wiped by the next `applyGraphTransform` and is absent from any `handleSave` serialization. CONTEXT ruled only `node:state`/`node:preview` in scope for this phase, so this is a known surviving instance of the bug class the phase eliminates, not a regression. In practice the `graph:saved` full reload converges the view.

**Suggested fix:** Track as follow-up: either route node creation through the canonical graph (requires a V3 asset constructor) or document that `node:created` is display-only-ephemeral until the next `graph:saved`.

### I6 — Info: unused destructured `nodes, edges` in `handleBatchExecute`

**File:** `packages/infinite-canvas/src/components/CanvasContextMenu.tsx:112`

**Issue:** `const { orchestration, showToast, nodes, edges } = useCanvasStore.getState()` — `nodes`/`edges` are leftovers from the `canvasToFlowGraph` era, now unused.

**Suggested fix:** Drop the two unused bindings.

### I7 — Info: DEPRECATED verify scripts fail if run directly

**File:** `scripts/verify-phase-39.ts:76,86,142`, `scripts/canvas/verify-save-gates.ts:47`

**Issue:** Both carry stale v1-route assertions (`verify-save-gates.ts` reads the deleted `src/routes/canvas/save.ts` → throws; `verify-phase-39.ts` asserts on deleted route lists). Both are clearly headed `[DEPRECATED — Phase 51]` per the D-12 precedent and neither is registered in `package.json` scripts, so exposure is minimal. Acceptable as-is; note that `verify:phase-51` is the only registered successor gate.

## Verified-Positive Notes (no action needed)

- **Serializer correctness:** stage→type mapping, `locked→single` + warning, `failed→error`, event/output-edge folding semantics match `graphToViewModel` exactly; wire output passes the real server `FlowGraphV2Schema.safeParse` (test imports the actual server schema file, not a copy).
- **Test quality:** `deleteNode.test.ts` asserts rollback with a *mock-rejected* save (real failure path), payload wire shape, and all three early-exit guards; `canonicalWriteback.test.ts` locks the progress-ephemeral-after-transform ordering; `verify-phase-51.ts` includes a forced-failure self-check that would `exit 1` on unexpected PASS. Not tautological.
- **Delete confirmation UI:** real `<button>` elements, confirm → `onClose()` + single `void storeDeleteNode` (double-click safe: second call early-returns on missing node), cancel → collapses prompt only. No browser-native `confirm(` (grep-verified).
- **Regression sweep:** no dynamic `import()` of deleted modules; legacy type names 0 hits; `StoryboardTimeline.tsx:805` `ScoreBadge` is a local function, not the deleted component; `@kais/flowgraph-v3` declared via `file:../flowgraph-v3`; v1 `/canvas/save` has zero live callers (only DEPRECATED scripts + stale `static/` build artifacts — the summary already flags the required `deploy-canvas.sh` rerun as an explicit manual handoff, without which the *deployed* SPA would 404 on save).
- **Security (ASVS L1):** all toast/`err.message` rendering is React text interpolation (auto-escaped); no `dangerouslySetInnerHTML`; no unsafe parsing; agent-sync retains its label-sanitization regex; verify-phase-51's DB isolation (mkdtemp + chdir before dynamic imports) confirmed line-for-line — production `data/db2.sqlite` is never opened.
