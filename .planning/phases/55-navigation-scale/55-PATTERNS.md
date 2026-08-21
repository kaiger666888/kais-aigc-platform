# Phase 55: 画布导航与规模 (Navigation & Scale) - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 21 (new + modified)
**Analogs found:** 21 / 21 (all have at least a partial analog; 2 are "component scaffolding analog only" — see No Analog Found)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/infinite-canvas/src/constants/phaseRegistry.ts` (NEW — 22-phase single registry, D-04) | config (registry) | transform (static → derived consumers) | `packages/infinite-canvas/src/components/pipeline/model.ts:46-80` (PIPELINE_PHASES) + `src/routes/canvas/v2/import-from-dir.ts:88-102` (PHASE_DEFS) | exact (both tables merge into it) |
| `packages/infinite-canvas/src/components/pipeline/model.ts` (MODIFY — PIPELINE_PHASES 19→22 + fallback zone entry) | model | transform | the file itself; extras mechanism at `model.ts:382-398` | exact |
| `packages/infinite-canvas/src/constants.ts` (MODIFY — PHASE_GROUPS derived/aligned from registry) | config | transform | `constants.ts:324-331` (PHASE_GROUPS) | exact |
| `src/routes/canvas/v2/import-from-dir.ts` (MODIFY — PHASE_DEFS 13→22, khs phaseIndex numbering) | route (backend zone-table writer) | file-I/O (dir scan → graph write) | `import-from-dir.ts:88-145` (PHASE_DEFS/FILE_TO_PHASE/ASSET_DIR_TO_PHASE) | exact |
| `scripts/verify-phase-55.ts` (NEW — contract test, D-01) | test | file-I/O (regex-parse khs python) | `scripts/canvas/verify-schema-drift.ts` (full file) + `scripts/canvas/lib/verify-harness.ts` + `scripts/verify-phase-53.ts` (root-script aggregate pattern) | exact |
| `packages/infinite-canvas/src/components/__tests__/phaseRegistry.test.ts` (NEW) | test | transform | `packages/infinite-canvas/src/hooks/__tests__/canvasState.test.ts` | exact |
| `packages/infinite-canvas/src/components/StoryboardTimeline.tsx` (MODIFY — extractShots enrichment: video_prompt / referenced char+scene thumbs) | model (pure derivation) | transform | `StoryboardTimeline.tsx:302-403` (extractShots Pass 1/2) | exact |
| Two-level browse host (ShotTree enhancement OR new SceneShotPanel — planner decides) | component | request-response (graph-derived render) | `packages/infinite-canvas/src/components/canvas/ShotTree.tsx` (tree+jump) + `packages/infinite-canvas/src/components/storyboard/StoryboardBoard.tsx` (scene→shot grid + ShotCard visuals) | exact (visuals) / role-match (host form open) |
| SearchNavigator component (NEW — results list + jump) | component | transform (client-side filter) | `packages/infinite-canvas/src/components/canvas/ShotTree.tsx` (list UI + CollapsibleSection) + FlowCanvas focusAssetNodeId effect (`FlowCanvas.tsx:700-721`) | role-match |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx` (MODIFY — delete hidden search filter, `/` hotkey, onNewAsset rewrite) | component | event-driven (socket/keyboard) | the file itself; canonical-write precedent at `FlowCanvas.tsx:200-216` | exact |
| `packages/infinite-canvas/src/utils/placeNewAsset.ts` (NEW — pure placement fn, NAV-04) | utility | transform | none for placement math; guard pattern from `LAYOUT.NEW_NODE_*` (`constants.ts:104-107`) is the anti-pattern being replaced | partial (see No Analog) |
| `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` (MODIFY — node:created payload shape) | hook | event-driven (socket) | `useCanvasSocket.ts:143-155` (existing handler signatures) | exact |
| `src/routes/canvas/v2/nodes.ts` (MODIFY if payload unified server-side) | route | event-driven (REST + broadcast) | `src/routes/canvas/v2/branches.ts:81-130` (PATCH + broadcast pattern) | exact |
| `packages/infinite-canvas/src/components/canvas/PhaseColumns.tsx` (MODIFY — clickable column header, pointer-events affordance) | component | request-response (viewport ops) | `PhaseColumns.tsx` full file + `ShotTree.tsx:132-142` (jumpTo/setCenter) | role-match |
| `packages/infinite-canvas/src/hooks/useCanvasPersistence.ts` (MODIFY — laneZoom memory in PersistedCanvasState) | hook | file-I/O (localStorage patch) | `useCanvasPersistence.ts:18-69` (PersistedCanvasState + saveCanvasState patch) | exact |
| `packages/infinite-canvas/src/hooks/__tests__/canvasState.test.ts` (MODIFY — laneZoom tests) | test | transform | the file itself (fakeStorage harness) | exact |
| `packages/infinite-canvas/src/components/BranchPanel.tsx` (NEW — rewrite, NAV-06) | component | request-response (REST-backed store) | git `7ec2e605:packages/infinite-canvas/src/components/BranchPanel.tsx` (full 235-line archive) + `selectWinner` optimistic pattern (`canvasStore.ts:886-933`) | exact |
| `packages/infinite-canvas/src/store/canvasStore.ts` (MODIFY — selectBranchAsMain REST wiring + rollback) | store | request-response (optimistic + REST) | `canvasStore.ts:886-933` (selectWinner: prevGraph → setGraph → await REST → rollback) | exact |
| `packages/infinite-canvas/src/store/__tests__/` branch test (NEW) | test | request-response | `packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts` (vi.mock canvasApi + fixture graph factory) | exact |
| `packages/infinite-canvas/test/e2e/tests/phase55-nav.mjs` (NEW — e2e smoke) | test | request-response | `packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs` + `packages/infinite-canvas/canvas-real-screenshot.mjs` (real-backend probe) | exact |
| `packages/infinite-canvas/src/components/__tests__/searchNavigator.test.ts` (NEW) | test | transform | `StoryboardTimeline.shotKey.test.ts` (pure-fn derivation tests) | exact |

## Pattern Assignments

### `packages/infinite-canvas/src/constants/phaseRegistry.ts` (NEW; config registry, D-04 single source)

**Analogs:** `packages/infinite-canvas/src/components/pipeline/model.ts` (PIPELINE_PHASES) + `src/routes/canvas/v2/import-from-dir.ts` (PHASE_DEFS) — the two tables being unified.

**Entry shape** — extend the existing `PipelinePhaseDef` (model.ts:24-37). Keep `sub: true` for shared-lane phases (P09b/P10c/P11c precedent, model.ts:65-75):

```typescript
// model.ts:24-37 (copy this shape into the registry module)
export interface PipelinePhaseDef {
  sortKey: number          // 全局排序键；3.5/11.5 可精确表达插入位（既有先例）
  code: string             // 'P01' / 'P09b' …
  name: string             // 中文名
  group: PhaseGroup        // 'research' | 'story' | 'production' | 'post'
  phaseIndex: number       // khs _PHASE_INDEX_MAP 编号（唯一真相源）
  sub?: boolean            // gate 子阶段：仅展示，不重复计资产
}
```

**Target 22-phase content** (from RESEARCH.md §NAV-01, khs-verified): existing 19 entries (model.ts:46-80, already W6-index-aligned) + `P09c`(production, phaseIndex 10, sub) + `P12a`/`P12b`(post, phaseIndex 15, sub, sortKey ~14.25/14.5) + `p11a0` folded into P11a lane as sub (A2 recommendation; Pitfall 2 — `_PHASE_PREFIX_RE` collapses both to `p11a`). Also carry a **backend-only field set** for import-from-dir consumption: `prefix` / `canvasType` / `assetType` / `phaseGroup` mirror `PhaseDef` (import-from-dir.ts:80-86).

**Backend table being replaced** (import-from-dir.ts:88-102) — 13 entries, `phaseIndex = laneIndex + 1` is the systematic mis-numbering NAV-01 fixes (write sites at import-from-dir.ts:639, 657, 842):

```typescript
const PHASE_DEFS: PhaseDef[] = [
  { prefix: "p01", label: "P01 · 选题+钩子", canvasType: "script", assetType: "topic", phaseGroup: "research" },
  // … 13 entries through p13 only; NO p035/p09b/p09c/p10c/p11*/p12a/p12b/p14/p15
]
```

**Consumers to re-point at the single registry (D-04, anti-pattern guard):** `PIPELINE_PHASES` (model.ts:46), `PHASE_GROUPS` (constants.ts:324-331), `PHASE_DEFS` (import-from-dir.ts:88), plus downstream `computePhaseColumns` (laneGeometry.ts:94 reads `PHASE_GROUPS[index]`), Phase 54 swimlane blocking highlight, Phase 57 PORTAL-04 taxonomy. RESEARCH anti-pattern: "新建注册表又不删旧表 = D-04 明令禁止的漂移源".

---

### `scripts/verify-phase-55.ts` (NEW; contract test, D-01 — third replication of mirror+contract)

**Primary analog:** `scripts/canvas/verify-schema-drift.ts` (full file, 201 lines).

**Harness + header pattern** (verify-schema-drift.ts:22-34):

```typescript
import fs from "node:fs";
import path from "node:path";
import { createHarness } from "./canvas/lib/verify-harness";

const { results, assert, summary: finish } = createHarness();
const REPO_ROOT = path.resolve(__dirname, "..");
const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const PYTHON_SCHEMA_PATH = path.join(SIBLING_ROOT, "plugins/kais_aigc/canvas_sync.py");
```

**Fragile-regex-is-the-signal discipline** (verify-schema-drift.ts:36-40 — keep this comment verbatim in spirit):

```text
// ⚠️ 正则解析的脆弱性是有意的契约漂移信号：一旦 schema 写法变化导致解析失效
//（解析到 0 个条目即 FAIL），这本身就是要捕获的「契约漂移」告警。
// 不要「修复」为更健壮的解析器 —— 脆弱性即契约信号。
```

**Depth-count dict body extraction** (verify-schema-drift.ts:53-67) — reuse for `_PHASE_INDEX_MAP` (entries look like `"p09b": 10,`):

```typescript
const startMatch = source.match(/^_PHASE_INDEX_MAP[^{]*\{/m);
// … depth-count `{`/`}` to find closing brace, then entry regex:
//   /"([^"]+)"\s*:\s*(\d+)/g  → Map<string, number>
```

Also parse `canvas_graph.py:741` `ZONE_PHASES` (tuple list `(prefix, label, group)` → group + lane order) and cross-check against the kap registry. Assertions to port from verify-schema-drift.ts:156-193: file-exists gate, parsed-count > 0 gate, per-entry "only in kap / only in khs / index mismatch" diff, final zero-drift assert. Note khs side already has `test_phase_registry_canvas_map_consistency.py` — kap test is complementary.

**Alternative root-script pattern:** `scripts/verify-phase-53.ts:36-64` — self-contained assert (no lib import), isolation `mkdtemp+chdir` guard before dynamic imports, `grepSource()` walker scoped to `packages/infinite-canvas/src` + `src` excluding `src/routes/canvas/static/` + `data/web/` (地雷 #5 scope discipline). Use this walker form if the gate also needs "all consumers import from registry" assertions (recommended for D-04). Register npm script `verify:phase-55` (package.json scripts, alongside `verify:phase-53`).

---

### `packages/infinite-canvas/src/components/pipeline/model.ts` (MODIFY — 22 entries + fallback zone)

**Fallback (D-03) — extend the existing extras mechanism** (model.ts:382-398, current behavior appends unknown phaseIndex as `阶段 ${idx}`):

```typescript
// 注册表外的 phaseIndex → 追加为兜底阶段（按 index 排序插入末尾前）
const extras = [...byPhase.keys()].filter((idx) => !seen.has(idx)).sort((a, b) => a - b)
for (const idx of extras) {
  const group = PHASE_GROUPS[idx] ?? 'post'
  models.push(derivePhase({ sortKey: 1000 + idx, code: `P${String(idx).padStart(2, '0')}`,
    name: `阶段 ${idx}`, group, phaseIndex: idx }, byPhase.get(idx) ?? []))
}
```

NAV-01 change: extras become a named 「未映射」fallback entry + `console.warn` once per unseen index (fail-loud, no throw). Same philosophy lives in `adapter.ts` zod repair loop (adapter.ts:416-419: "修不好就降级…绝不 throw") and `updateAssetMeta` guards (canvasStore.ts:582-598: warn + early return).

**Do-not-regress invariants** (from model.ts:33-44 comments): `sub: true` phases share lane phaseIndex but don't count assets; `phaseIndexOf` guard (model.ts:161-165: `Number.isFinite` check). Fix the stale "17 阶段" header comment (model.ts:5, 40) while touching the file.

---

### `src/routes/canvas/v2/import-from-dir.ts` (MODIFY — backend zone writer, 13→22)

**Analog:** the file itself. Three coordinated tables to extend (all in lines 88-145): `PHASE_DEFS` (+p035/p09b/p09c/p10c/p11a/p11b/p11c/p12a/p12b/p14/p15 with khs `phaseIndex` as an explicit new field — NOT `laneIndex+1`), `FILE_TO_PHASE` (longest-prefix match, sorted at :234), `ASSET_DIR_TO_PHASE` (:134-145).

**phaseIndex write sites to change** (:627-649 zone node shown; also :657 summary, :842):

```typescript
// Determine the lane index (0-based) from PHASE_DEFS order
const laneIndex = PHASE_DEFS.findIndex((p) => p.prefix === phasePrefix);
const baseX = laneIndex * ZONE_X_STEP;
const zoneNode: FlowNodeV2 = {
  id: phasePrefix, type: "zone" as any, branchId: "main",
  phaseIndex: laneIndex + 1,   // ← replace with def.phaseIndex from the shared registry
  phaseName: def.label, position: { x: baseX, y: 0 }, ...
```

Keep layout geometry (ZONE_X_STEP etc.) driven by lane order; only `phaseIndex` semantic changes. Zone-node consumption downstream: `adapter.ts:380-408` `buildPhaseCatalog` reads `phaseIndex`+`phaseName` (zone wins, :404) → `laneGeometry.ts:63-111` `computePhaseColumns` maps it via `PHASE_GROUPS[index]` — both adapt automatically once the registry is single-sourced.

---

### NAV-02 — two-level scene→shot browse (`extractShots` enrichment + host component)

**Data derivation analog — `extractShots`** (StoryboardTimeline.tsx:302-403, exported + already tested): Pass 1 collects storyboard nodes with `meta ?? raw` fallbacks (:316-321), dedupes by `shotKey` via `storyboardTypeRank` (:363-381), Pass 2 builds video/lastFrame maps by shotKey (:383-403). Enrich for NAV-02 by adding `videoPrompt` (raw.video_prompt / raw.ltx_prompt — labels already in `RAW_FIELD_LABELS` constants.ts:357) and referenced character/scene thumbnails (chars are string names; thumbs require回查 scope='global' nodes — ShotTree.tsx:77-82 global-asset derivation is the same-source precedent).

**Scene grouping — two existing conventions, planner must unify (RESEARCH NAV-02 note):**

```typescript
// StoryboardTimeline.tsx:1770 (numeric scene from shotId):
function sceneNumOf(shotId: string): number {
  const m = shotId.match(/s?0*(\d+)/i); return m ? Number(m[1]) : 0
}
// ShotTree.tsx:40 (prefix split on [.\-_/]):
function scenePrefix(shotId: string): string | null {
  return shotId.match(/^([^.\-_/]+)[.\-_/]/)?.[1] ?? null
}
```

**Tree/list host analog — `ShotTree.tsx`**: `deriveTree()` (:60-106, graph+rawDataByNodeId → scenes/flatShots/globals, natural sort, ≥2-distinct-prefix rule :92-94), `jumpTo` (:132-142: `reactFlow.setCenter(cx, cy, { zoom: 1.0, duration: 600 })` + setSelectedNode), single-click vs double-click semantics (:274 hint "单击选中溯源 · 双击查看详情"), `CollapsibleSection`/`TreeItem` (:282-364), overlay panel style (:153-169, `data-testid="shot-tree"`).

**Shot-card visuals analog — `StoryboardBoard.tsx` `ShotCard`** (:60-223): 16:9 thumb + shot_id badge overlay (:126-141), Chip row for scale/camera/framing (:147-151), duration row (:153-157), 2-line clamped dialogue (:159-173), hover-expand detail (:198-219), `toDisplayUrl` relative-path resolver (:28-35). `SceneSection` (:244-297) is the scene-row collapse + auto-fill grid. **Pitfall 6: data source** — StoryboardBoard fetches `GET /api/v1/storyboard` (canvasApi.ts:1117-1144) which is p10b-assembled JSON from a deregistered phase; NAV-02 must use graph-derived `extractShots` as primary, board JSON only as fallback.

---

### NAV-03 — SearchNavigator + FlowCanvas search rewrite

**Delete this hidden-filter effect** (FlowCanvas.tsx:608-626 — the behavior NAV-03 removes):

```typescript
useEffect(() => {
  const t = setTimeout(() => {
    const q = searchQuery.trim().toLowerCase()
    setNodes((nds) => nds.map((n) => { /* label/description/prompt match */ return { ...n, hidden: !matches } }))
  }, 200)
  return () => clearTimeout(t)
}, [searchQuery, setNodes])
```

**Jump mechanism to reuse verbatim** (FlowCanvas.tsx:700-721 — focusAssetNodeId effect; do not change its semantics):

```typescript
useEffect(() => {
  if (!focusAssetNodeId) return
  const target = (nodes as any[]).find((n) => n.id === focusAssetNodeId)
  if (!target) { showToast('该资产尚未放置在画布上', 'info'); /* clear */ return }
  setSelectedNode(target); setDetailNode(target)
  const tFit = setTimeout(() => {
    reactFlow.fitView({ nodes: [{ id: focusAssetNodeId }], duration: 600, maxZoom: 1.5 })
  }, 50)
  const tClear = setTimeout(() => setFocusAssetNodeId(null), 1500)
  return () => { clearTimeout(tFit); clearTimeout(tClear) }
}, [focusAssetNodeId, /* ... */])
```

Clicking a search result = `useCanvasStore.getState().setFocusAssetNodeId(id)` (store action at canvasStore.ts:1016-1017). 93-shot scale: group results by scene (ShotTree `scenePrefix` convention) — CONTEXT specifically forbids a 93-row flat list.

**Keyboard guard precedent** (FlowCanvas.tsx:726-735 — Escape handler; copy this window-keydown + early-return form for `/`):

```typescript
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (useVariantPickerStore.getState().open || /* modal guards */) return
    /* ... */
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [/* ... */])
```

Pitfall 7: `/` handler must exclude `e.target` being input/textarea/contentEditable. Results-list UI scaffolding: ShotTree `CollapsibleSection`/`TreeItem` + catppuccin inline styles (repo convention — no cmdk dependency, RESEARCH Alternatives table).

---

### NAV-04 — onNewAsset rewrite + `placeNewAsset` pure function

**The code being replaced** (FlowCanvas.tsx:217-224 — random scatter + direct derived-cache write, violates WRITE-03):

```typescript
onNewAsset: (nodeId: string, data: Record<string, unknown>) => {
  setNodes((nds) => [...(nds as any[]), {
    id: nodeId, type: 'asset',
    position: { x: LAYOUT.NEW_NODE_X_MIN + Math.random() * LAYOUT.NEW_NODE_X_RANGE,
                y: LAYOUT.NEW_NODE_Y_MIN + Math.random() * LAYOUT.NEW_NODE_Y_RANGE },
    data,
  }])
},
```

**Canonical write-back pattern to follow** — the sibling socket handlers in the same hook call (FlowCanvas.tsx:200-216):

```typescript
// WRITE-03（Phase 51-02）：socket 写回走 store canonical action，不再直改派生缓存
const applySocketNodeState = useCanvasStore((s) => s.applySocketNodeState)
const applySocketNodePreview = useCanvasStore((s) => s.applySocketNodePreview)
```

I.e. new handler should call a store canonical action (`applyGraphTransform`-based add, canvasStore.ts:441) — never `setNodes` append. Guard-early-return + warn style: canvasStore.ts:579-598 (`updateAssetMeta`).

**Payload shape fix (Pitfall 3):** server broadcasts `{ node }` (nodes.ts:90/151), client destructures `{ nodeId, data }` (useCanvasSocket.ts:153-155 — shown in full in context). RESEARCH recommendation Q4: client adapts to server `{node}` shape (zero backend change preferred); handler then uses payload node position when present.

**Viewport math precedent** (FlowCanvas.tsx:349-355 — navHistory's injected getter; use `reactFlow.screenToFlowPosition` or viewport arithmetic for view-center):

```typescript
const getViewport = useCallback(() => {
  const v = reactFlow.getViewport()
  return { x: v.x, y: v.y, zoom: v.zoom }
}, [reactFlow])
```

Event-source availability: regen call site is `NodeDetailPanel:675` (`executeNode(projectId, episodesId, asset.id, …)`) — source nodeId is known at emit time; pass it through the socket payload or accept an options arg. Assertion contract (RESEARCH test map): `placeNewAsset(centerOrSource)` pure fn — coords within R of viewport center OR of source node.

---

### NAV-05 — PhaseColumns interaction + lane zoom memory

**PhaseColumns current state** (`PhaseColumns.tsx:30-45`): SVG overlay with `pointerEvents: 'none'`, `data-testid="phase-columns"`, transform synced to `useViewport()`. NAV-05 adds a clickable header affordance — needs a pointer-events:auto hit area on the label region only (keep the bands non-interactive). Column geometry comes from `computePhaseColumns` (laneGeometry.ts:63-111: median-x projection, `PHASE_GROUPS[index] ?? 'production'` fallback :94) — do NOT touch the geometry math.

**Focus action analog** — ShotTree `jumpTo` (ShotTree.tsx:132-142) or FlowCanvas focus effect (`fitView({nodes, maxZoom, duration})`); for "fit this phase's nodes" collect the column's node ids and use `fitView({ nodes: [...] })`.

**Zoom memory persistence** — extend `PersistedCanvasState` (useCanvasPersistence.ts:18-23) with `laneZoom?: Record<number, number>` using the existing patch-merge writer (useCanvasPersistence.ts:57-69):

```typescript
export function saveCanvasState(key, patch: Partial<PersistedCanvasState>, storage = defaultStorage()): void {
  if (!storage) return
  try {
    const next = { ...loadCanvasState(key, storage), ...patch }
    storage.setItem(key, JSON.stringify(next))
  } catch { /* 写失败降级为不持久化，不打断交互 */ }
}
```

Key isolation `kais:canvas:v1:p${pid}:e${eid}` (:26-28). Restore side follows the existing viewport-restore + FITVIEW_MIN_ZOOM clamp precedent (:100-110).

**Do-not-regress (hard constraint, CONTEXT):** `useLod.ts` constants — `LOD_L0_MAX=0.22 / LOD_L1_MAX=0.6 / LOD_HYSTERESIS=0.03 / FITVIEW_MIN_ZOOM=0.4` (useLod.ts:13-23), `LodProvider` single-subscriber design (:72-79), `resolveLodLevel` hysteresis (:33-53). Existing regression tests live in `canvasState.test.ts:7-31` — keep them green untouched.

---

### NAV-06 — BranchPanel rewrite + selectBranchAsMain persistence

**UI analog (git archive):** `git show 7ec2e605:packages/infinite-canvas/src/components/BranchPanel.tsx` — 235 lines: status sectioning (`mainBranches/exploreBranches/archivedBranches` memos), `renderBranch` with promote/archive/restore/delete buttons, `branchStats` node-count per branch, full catppuccin style-block set. Rewritten panel keeps the store consumption shape (`branches`/`selectBranchAsMain`/`archiveBranch`/`updateBranch`) but must fix: (a) `updateBranch(branchId, {status:'rejected'})` fake-delete → real DELETE endpoint exists (branches.ts:133-183), (b) wire REST persistence (below).

**Store action to rewrite** (canvasStore.ts:937-953 — currently store-only, no REST):

```typescript
selectBranchAsMain: (branchId) => {
  const { branches, updateBranch, showToast } = get()
  const target = branches.find((b) => b.id === branchId)
  if (!target) { showToast('分支不存在', 'error'); return }
  branches.forEach((b) => {           // ⚠️ 只改 store，无 REST 调用
    if (b.id === branchId) updateBranch(b.id, { status: 'active' })
    else if (b.status === 'active') updateBranch(b.id, { status: 'archived' })
  })
  showToast(`已升主线: ${target.label}`, 'success')
},
```

**Optimistic + rollback pattern to copy** (canvasStore.ts:886-933, `selectWinner`):

```typescript
const prevGraph = graph                      // 拍 prev（零成本回滚引用）
get().setGraph(next, get().warnings)         // 乐观上屏
try {
  await selectVariantWinner(projectId, episodesId, group.id, nodeId, undefined, opts?.frameSlot)
  showToast(`已选为优胜: ${nodeId}`, 'success')
} catch (err) {
  get().setGraph(prevGraph, get().warnings)  // 失败回滚 — UI 不呈现假象
  showToast(`选定失败已回滚: ${(err as Error).message}`, 'error')
}
```

For branches: snapshot `branches` array → optimistic `updateBranch` loop → `await canvasApi.updateBranch(...)` per branch → rollback + error toast on failure. Early-exet guard for missing project context precedes any await (selectWinner :889-892 precedent).

**REST endpoints already present (zero backend work):** `PATCH /api/canvas/v2/branches/:branchId` (branches.ts:81-130 — zod `validateFields` with `status` enum `draft|active|paused|completed|archived|rejected`, `appendAndSync` event store, `broadcastToProject('branch:updated')`) + `canvasApi.updateBranch` (canvasApi.ts:594-602):

```typescript
export async function updateBranch(projectId, episodesId, branchId,
  updates: Partial<Pick<FlowBranch, 'label' | 'status'>>, cancelToken?): Promise<void> {
  await apiCall<void>(`/v2/canvas/branches/${encodeURIComponent(branchId)}`, { projectId, episodesId, ...updates }, { cancelToken })
}
```

**Status truth-source decision (Pitfall 4, planner picks per A5):** V3 `toLegacyBranches` hardcodes `status: 'active'` (canvasStore.ts:278-289); `setGraph` path prefers `graph.branches.length > 0 ? toLegacyBranches(...) : state.branches` (canvasStore.ts:429) — REST-merge option (b) hooks in exactly there.

---

### Tests — vitest + e2e patterns

**Pure-function vitest** (`src/hooks/__tests__/canvasState.test.ts` — the model for phaseRegistry/placeNewAsset/searchNavigator tests): direct import of pure exports, `fakeStorage()` injected StorageLike (:35-42), behavior tables via `it.each` (see StoryboardTimeline.shotKey.test.ts:28-37). For placeNewAsset: assert bounded distance to center OR source. For searchNavigator derivation: scene-grouped output shape + no-mutation of node visibility.

**Store test with API mock** (`src/store/__tests__/selectWinner.test.ts:15-31`):

```typescript
vi.mock('../../services/canvasApi', () => ({
  approveNode: vi.fn(), rejectNode: vi.fn(), selectVariantWinner: vi.fn(),
}))
import { useCanvasStore } from '../canvasStore'
import { selectVariantWinner } from '../../services/canvasApi'
const apiSelectWinner = vi.mocked(selectVariantWinner)
```

Fixture-graph factory at :35-84 (`assetNode(id, overrides)` + `fixtureGraph()`). Branch test asserts: REST called per branch, rollback restores prev statuses on rejection, missing-context early-exit calls nothing.

**e2e probe** (`packages/infinite-canvas/canvas-real-screenshot.mjs` — real-backend template): `page.goto('http://localhost:10588/infinite-canvas/?projectId=…&episodesId=…&testMode=1')` → `waitForSelector('.react-flow__node')` → `window.__kaisCanvas` store bridge (`getNodes()`, helpers.mjs:37-54 also `setSelectedNodeIds`). Formal test template (`test/e2e/tests/phase52-regen.mjs:1,28-54`): import from `../helpers.mjs` (`test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView`), `expect.poll` against mock state, `data-testid` selectors, and the 地雷 #10 discipline note — **e2e runs the dist build; `npm run build` first**.

## Shared Patterns

### Canonical write-back (WRITE-03)
**Source:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:200-216` + `canvasStore.ts:441` (`applyGraphTransform`)
**Apply to:** NAV-04 onNewAsset rewrite (mandatory), any new socket handlers.
Rule: event writes go through store canonical actions; derived RF caches rebuild only via graphToViewModel. `setNodes` direct append is the pre-Phase-51 anti-pattern.

### Fail-loud but don't crash
**Source:** `canvasStore.ts:579-598` (guard + `console.warn` + early return), `adapter.ts:416-419` (zod repair loop, "修不好就降级为空图 + warnings，绝不 throw"), `model.ts:382-398` (extras fallback)
**Apply to:** NAV-01 fallback zone (D-03), NAV-06 missing-branch guards.

### Optimistic update + rollback + REST persistence
**Source:** `canvasStore.ts:886-933` (selectWinner)
**Apply to:** NAV-06 selectBranchAsMain. Sequence: context guard → snapshot prev → optimistic set → await REST → rollback + error toast on failure. Success toast only after await resolves.

### Focus/jump mechanism
**Source:** FlowCanvas.tsx:700-721 (focusAssetNodeId + fitView maxZoom 1.5, 1.5s auto-clear) and ShotTree.tsx:132-142 (setCenter zoom 1.0 duration 600)
**Apply to:** NAV-03 search results, NAV-05 column focus, NAV-02 shot-card jump. Reuse `setFocusAssetNodeId` store action rather than new viewport plumbing.

### Catppuccin inline-style overlay component
**Source:** ShotTree.tsx:153-169 (overlay card: absolute positioning, `rgba(17,19,23,0.92)` bg, `theme.border.default`, backdropFilter blur, `data-testid`), StoryboardBoard.tsx:225-240 (Chip)
**Apply to:** SearchNavigator panel, BranchPanel, any NAV-02 panel. Repo convention: inline `React.CSSProperties` objects + `theme`/`v3theme` tokens, no CSS modules, no new deps.

### Contract-test harness
**Source:** `scripts/canvas/lib/verify-harness.ts` (`createHarness()` — assert/section/summary/exit-code) + verify-schema-drift.ts:36-40 fragility discipline + verify-phase-53.ts:71-105 `grepSource()` scoping
**Apply to:** scripts/verify-phase-55.ts; register `verify:phase-55` npm script.

### localStorage patch persistence
**Source:** useCanvasPersistence.ts:18-69 (`canvasStateKey` isolation, `saveCanvasState` merge-write, corrupt-JSON tolerance)
**Apply to:** NAV-05 laneZoom memory. Never hand-roll separate storage keys.

## No Analog Found

Files where the specific capability is new (planner uses RESEARCH.md patterns + the listed scaffolding analogs):

| File | Role | Data Flow | Reason / Scaffolding analog |
|------|------|-----------|------------------------------|
| `packages/infinite-canvas/src/utils/placeNewAsset.ts` (pure placement math) | utility | transform | No existing bounded-placement function — the only prior art is the random `LAYOUT.NEW_NODE_*` scatter being deleted (constants.ts:104-107, FlowCanvas.tsx:217-224). Contract = RESEARCH test map: "coords ∈ viewport-center R OR source-node R". Viewport math precedent FlowCanvas.tsx:349-355. |
| SearchNavigator results-list interaction (open on `/`, scene-grouped list, Esc close) | component | event-driven | No existing command-palette/navigator in the repo. Scaffolding: ShotTree CollapsibleSection/TreeTree list patterns + Escape-key guard FlowCanvas.tsx:726-735 + focus effect :700-721. RESEARCH explicitly rejected cmdk (new dep). |

## Metadata

**Analog search scope:** `packages/infinite-canvas/src/**` (components, hooks, store, v3, services, utils, __tests__), `src/routes/canvas/v2/**`, `scripts/**` + `scripts/canvas/**`, `packages/infinite-canvas/test/e2e/**`, git history (`7ec2e605` BranchPanel). khs truth-source files read read-only per D-01 (canvas_sync.py, canvas_graph.py — paths in RESEARCH §Sources).
**Files scanned:** ~28 source/test/script files read; registry delta verified against model.ts:46-80 / import-from-dir.ts:88-145 / constants.ts:324-331.
**Out of bounds honored:** nothing under `.planning/phases/53-*/` or `54-*/` was read; code-level analogs only (verify-phase-53.ts read as the newest root-script exemplar — it is source code, not a 53 planning doc).
**Pattern extraction date:** 2026-08-21
