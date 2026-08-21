# Phase 53: Variant Contract + Picker Upgrade (Wave A) - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 19 primary (11 new + 8 modified) + 5 test files
**Analogs found:** 17 / 19 (2 partial: wallTransport master clock, writeback drain scheduler — designs live in 53-RESEARCH DR-4/DR-5)

**Scope guard:** Wave A = kap side only (`/data/workspace/kais-aigc-platform`). Zero khs-side files are mapped here. Zero new dependencies (root zod ^4.3.5 / pkg zod ^3.25.76 both existing — never cross-import between them, see Shared Pattern P8).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/candidateEnvelope.ts` (new) | contract/utility | transform | `src/lib/candidateGrouping.ts` | role-match |
| `src/lib/candidateGroupDeriver.ts` (new) | service | CRUD | `src/lib/ingestAssets.ts` L87-146 + `src/lib/candidateGrouping.ts` | exact |
| `src/lib/manifestWriteback.ts` (new) | bridge/service | request-response | `src/lib/reviewBridge.ts` | exact |
| `src/lib/writebackQueue.ts` (new) | service | batch/retry | `src/lib/canvasRelationalStore.ts` (db-param + trx) + `src/lib/initDB.ts` L1117-1127 (state enum) | partial |
| `src/lib/g15Bridge.ts` (new) | bridge/service | request-response | `src/lib/reviewBridge.ts` | exact |
| `src/routes/canvas/v2/g15-ops.ts` (new) | route/controller | request-response | `src/routes/canvas/v2/select-winner.ts` | exact |
| `scripts/verify-phase-53.ts` (new) | test | batch | `scripts/verify-phase-51.ts` | exact |
| `packages/.../components/variants/VariantWall.tsx` (new) | component | streaming + CRUD | `VariantPicker.tsx` + `NodeDetailPanel.tsx` | role-match (upgrade) |
| `packages/.../components/variants/wallTransport.ts` (new) | utility (pure) | streaming | `store/variantOps.ts` (pure-fn discipline only) | partial |
| `packages/.../components/variants/useWallKeyboard.ts` (new) | hook | event-driven | `VariantPicker.tsx` L25-30 | exact (small) |
| `packages/.../components/g15/G15TriagePanel.tsx` (new) | component | request-response (batch) | `NodeDetailPanel.tsx` + `AssetLibrary.tsx` L839-862 | role-match |
| `src/routes/canvas/v2/select-winner.ts` (mod) | route | request-response | itself (extension in place) | exact |
| `src/lib/initDB.ts` (mod) | config/schema | CRUD | itself L1332-1347 | exact |
| `src/router.ts` (mod) | config | request-response | itself L26-29/L173/L188-192 | exact |
| `packages/.../components/variants/VariantPicker.tsx` (mod/deprecate) | component | — | absorbed by VariantWall; store protocol preserved | — |
| `packages/.../components/assetManager/AssetLibrary.tsx` (mod) | component | navigation | itself L829-835 | exact |
| `packages/.../src/services/canvasApi.ts` (mod) | service/client | request-response | itself L463-475 | exact |
| `packages/.../src/store/canvasStore.ts` (mod) | store | CRUD optimistic | itself L889-929 | exact |
| root `package.json` (mod) | config | — | itself L43-44 | exact |
| test files ×5 (see Test Placement) | test | unit | `src/store/__tests__/selectWinner.test.ts` + `src/hooks/__tests__/` | exact |

---

## Pattern Assignments

### `src/lib/candidateEnvelope.ts` (contract, transform)

**Analog:** `src/lib/candidateGrouping.ts` (module discipline) — schema shape from 53-RESEARCH Pattern 1 (do not re-derive)

Copy the module contract style, NOT the logic:

**Pure-module header convention** (`candidateGrouping.ts` L1-37): file-header docblock stating channels, vocabulary, and "Pure module: no DB, no fs, no network — data in, plans out" (L36). Envelope module is likewise pure: zod schemas + `normalizeLegacyCandidateData()` only.

**Type-first structure** (`candidateGrouping.ts` L41-92): types/interfaces exported first, helpers private below the `// ─── Types ───` section dividers.

**NEVER place inside `assetDataSchemas`** — `src/lib/canvasAssetSchema.ts` stays the per-type baseline (its `optionalTypes` already skips `variant` nodes at L125); envelope is a per-source discriminated union, separate module (53-RESEARCH Anti-Patterns). Use root zod (^4.3.5), all new fields `.optional()`/`.default()` so today's flat shapes never 400 (Pitfall 1).

**groupKey field must reuse the exact vocabulary** — see candidateGroupDeriver below.

---

### `src/lib/candidateGroupDeriver.ts` (service, CRUD)

**Analog 1 (materialization service):** `src/lib/ingestAssets.ts`

**db-as-parameter + single transaction** (`ingestAssets.ts` L87-123):
```typescript
export async function ingestImagesPayload(
  db: Knex,
  payload: IngestImagesPayload,
): Promise<IngestResult> {
  ...
  return db.transaction(async (trx) => {
    // 1. Group plan (pure contract layer, Plan 48-01)
    const plan = planGroups(images, payload.manifests);
    // WR-05: basename-fallback degradation is logged, never silent
    for (const w of plan.warnings) {
      console.warn(`${LOG_PREFIX} grouping degraded (WR-05): ${w}`);
    }
```
Same shape: `deriveCandidateGroups(nodes)` stays pure (returns `DerivedGroup[]`, 53-RESEARCH Code Example), and a separate `materializeCandidateGroups(db, scope, derived)` does the writes inside one `db.transaction`, skipping groups whose id already exists (idempotent — research Open Question 3 recommends deterministic group id).

**Analog 2 (groupKey vocabulary — MUST be byte-identical):** `src/lib/candidateGrouping.ts`
- Manifest channel key (`L297-299`): `` groupKey = suffix === "first" ? `shot:${entry.shot_id}:first` : `shot:${entry.shot_id}:last` ``
- Naming channel key (`L366`): `` groupKey: `name:${key}` `` where key = `parentDir/stem` (dir-aware, WR-03, helpers L109-134)
- Header L16-20 declares the two formats. G13 first/last = two groups by construction (D-11, Pitfall 6).
- `parseVariantName` (L146-153) for `_v{N}` parsing if the deriver reads node ids/paths.

**Where groups land:** `canvas_variant_groups` rows with `select_mode:'single'` + `variant_node_ids` JSON — column shape at `src/lib/initDB.ts` L1332-1347; write via the same defensive `JSON.parse`-of-`variant_node_ids` read pattern as `canvasRelationalStore.ts` L473-479.

---

### `src/lib/manifestWriteback.ts` (bridge, request-response best-effort)

**Analog:** `src/lib/reviewBridge.ts` — copy the ENTIRE discipline verbatim

**Deps-injection interface** (L74-79):
```typescript
export interface ReviewBridgeDeps {
  baseUrl?: string;               // default process.env.REVIEW_PLATFORM_URL || "http://review-platform:8090"
  fetchImpl?: typeof fetch;       // test injection
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  timeoutMs?: number;             // default 5000
}
```
manifestWriteback replaces baseUrl with the Wave-B-decided transport (FS write vs HTTP — research Open Question 1: keep it a dep so Wave A ships a fixture impl).

**Function contract: NEVER throws** (L114-119 signature + swallow-all L249-257):
```typescript
export async function resolveOpenReviewForSelection(
  params: ReviewBridgeParams,
  deps: ReviewBridgeDeps = {},
): Promise<void> {
  const logger = deps.logger ?? console;
  try {
    ...
  } catch (err) {
    // Swallow EVERYTHING (fetch errors, timeouts, JSON parse errors…) — the
    // bridge is best-effort and must never leak into the caller's response.
    try { logger.warn(...) } catch { /* even a broken injected logger must not throw */ }
  }
}
```

**Idempotency inside the hook** (needed for queue replay, DR-4): mirror the 409-means-already-done semantics at L237-240 — for manifest writeback, "value already equal → no-op".

**Params interface** (L65-72): plain-data params object, `variantIndex` 1-based, `winnerPhaseName: string | null` — extend with `frameSlot: "first"|"last"|undefined` and `source` (from envelope enum) per D-11.

---

### `src/lib/writebackQueue.ts` (service, batch/retry)

**Analog (db handling):** `src/lib/canvasRelationalStore.ts`

**db handle as parameter** (L367-369 docstring): "The db handle is a PARAMETER (48-02 'db handle as parameter' decision) so verify scripts and future plans can inject their own knex instance." Every queue function takes `db`/`trxDb` first — see `selectWinnerInGroup(trxDb, scope, groupId, winnerNodeId)` (L446-451) and `syncAssetPrimaryForWinner(trxDb, projectId, ...)` (L571-576).

**Transaction wrapper** (L526-545):
```typescript
await trxDb.transaction(async (trx: any) => {
  await trx("canvas_variant_groups").where(groupWhere).update({...});
  await trx("canvas_nodes").where({...}).update({...});
});
```

**Table DDL goes in initDB.ts** — state machine vocabulary precedent `kv_shotGraph` (`initDB.ts` L1117-1127): `table.string("state"); // pending | processing | done | error`. Queue DDL shape is fully specified in 53-RESEARCH DR-4 (columns, index `(project_id, episodes_id, state, next_attempt_at)`); register it inside `relationalCanvasTables` family (L1257+) using the builder style of `canvas_variant_groups` (L1332-1347):
```typescript
{
  name: "canvas_variant_groups",
  builder: (table) => {
    table.string("id", 128).notNullable();
    table.integer("project_id").notNullable();
    ...
    table.primary(["id", "project_id", "episodes_id"]);
    table.index(["project_id", "episodes_id"], "idx_canvas_vg_scope");
  },
},
```

**No drain-scheduler precedent exists** (nothing in repo does setInterval replay) — that logic follows DR-4 (startup + 30s interval + on-enqueue-fail; exponential backoff base 30s; max_attempts 8; serial drain). Isolation rule: enqueue failure must degrade to a log line, never a 5xx (Pitfall 4).

---

### `src/lib/g15Bridge.ts` (bridge, request-response)

**Analog:** `src/lib/reviewBridge.ts` — same file, three specific parts to replicate

1. **Header docblock with verified protocol contract** (L1-63): numbered list of the remote contract + explicit "DOCUMENTED PROTOCOL GAP" freeze note. g15Bridge documents: waive = approve-with-comment extension of the verified approve contract (L12-18); requeue = new action with NO kmc consumer yet (research A3 — state this as a frozen gap, Wave B lights it up).
2. **Deps + never-throws + try/catch-swallow** — identical to manifestWriteback above (L74-79, L114-119, L249-257).
3. **Fail-closed multi-dimensional matching** (L196-208): g15 waive must scope reviews the same way (episode segment equality + exact phase-token equality, no prefix matching) before acting. "A missed bridge is benign; a wrong approve is not" (L31-33).

---

### `src/routes/canvas/v2/g15-ops.ts` (route, request-response)

**Analog:** `src/routes/canvas/v2/select-winner.ts` (179 lines — the template end-to-end)

**Imports + router** (L1-13):
```typescript
import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
```

**zod body schema with bounded fields** (L37-41):
```typescript
const selectWinnerSchema = z.object({
  projectId: z.number(),
  episodesId: z.number(),
  winnerNodeId: z.string().min(1).max(128), // T-49-01: no oversized ids into the DB
});
```
g15-ops body: `{ projectId, episodesId, action: z.enum(["waive","requeue"]), shotIds: z.array(z.string().min(1).max(128)).max(200) }` (V5 bound from 53-RESEARCH Security Domain).

**Inline safeParse + 400** (L46-49) — prefer this over the `validateFields` middleware variant (seen in `thumbnail/index.ts` L20-22) when the endpoint has richer status semantics:
```typescript
const parse = selectWinnerSchema.safeParse(req.body);
if (!parse.success) {
  return res.status(400).send(error("参数校验失败", parse.error.issues));
}
```

**Status ladder → HTTP codes** (L61-88): map service result statuses to 404/409/200 individually; the idempotent branch returns early and deliberately skips all side-channels (Pitfall 5 — keep this exact behavior).

**Best-effort bridge mount point** (L146-158) — g15-ops mounts g15Bridge exactly here in its own flow:
```typescript
void resolveOpenReviewForSelection({
  projectId, episodesId, groupId, winnerNodeId,
  variantIndex: result.variantIndex,
  winnerPhaseName: result.winnerPhaseName,
}).catch(() => {});
```

**Broadcast + 500 catch** (L160-166, L171-174): `broadcastToProject(projectId, "<event>", {...timestamp: Date.now()})`; outer try/catch logs `[canvas:v2/<route>]` prefix and returns `error("...失败")`.

**Registration:** add import + mount in `src/router.ts` mirroring L26-29 (import block) and L188-192 (`app.use("/api/canvas/v2/<name>", routeN);`) — follow the existing alphabetical-ish numbering (next free routeN number).

---

### `scripts/verify-phase-53.ts` (test, batch)

**Analog:** `scripts/verify-phase-51.ts` (457 lines — skeleton copied near line-for-line)

- **Header docblock with S-section map** (L1-56): one `S<n> REQ-xx — description` bullet per section. Phase 53 sections per 53-RESEARCH: S1 envelope round-trip / S2 group derivation / S3 endpoint+queue / S4 wall source shape / S5 G15 bridge + forced-failure.
- **assert collector + REPO_ROOT reader** (L62-76).
- **mkdtemp + chdir isolation BEFORE dynamic imports** (L78-83), including the package.json copy for writeVersion.ts:
```typescript
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-51-"));
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);
```
- **grepSource walker with build-artifact exclusions** (L90-124) — reuse verbatim (excludes `src/routes/canvas/static/` + `data/web/`, 地雷 #5).
- **Import-order guard before touching db** (L201-210): root the module graph at `../src/utils` barrel, then import the store, then `await Promise.race([dbMod.bootReady, timeout])`.
- **Real-module integration** (L216-311): build fixture scopes (`const SCOPE = { projectId: 5151, episodesId: 1 }`), call real store functions, assert semantics + idempotency group.
- **Forced-failure self-check** (L397-423): shadow asserts that MUST fail; unexpected PASS fails the run.
- **Summary + exit codes** (L425-441): 0 all-pass / 1 failure / 2 crash via `main().catch`.
- **npm script registration** — root `package.json` L43-44 precedent: `"verify:phase-53": "npx tsx scripts/verify-phase-53.ts",`.

---

### `packages/infinite-canvas/src/components/variants/VariantWall.tsx` (component, streaming + CRUD)

**Analog A (open/close protocol to preserve):** `VariantPicker.tsx`

- Store protocol: `useVariantPickerStore` (`variantPickerStore.ts` L10-20) — `open: { nodeId, stack } | null`, `openPicker`, `close`. Entry point stays `registerCInteractions.ts` L15: `onStackToggle: (nodeId, stack) => useVariantPickerStore.getState().openPicker(nodeId, stack)`. The wall replaces the modal BODY, not this protocol.
- **Esc handler with cleanup** (L25-30):
```typescript
useEffect(() => {
  if (!open) return
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [open, close])
```
- **Backdrop-click close** (L56): `onClick={(e) => { if (e.target === e.currentTarget) close() }}`
- **Modality emoji placeholder** (L108-111) — the DR-3 fallback tier copies this exactly:
```typescript
{c.thumbnail
  ? <img src={c.thumbnail} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} .../>
  : <span style={{ fontSize: 22, opacity: 0.4 }}>{mod === 'video' ? '🎬' : mod === 'audio' ? '🎵' : '🖼'}</span>}
```
(upgrade the onError branch into the DR-3 three-tier heal: one-shot POST `/api/canvas/v2/thumbnail` → swap URL → placeholder.)
- **What NOT to copy** (D-12 kills the dual-track): `handlePick` L41-50 (`selectWinner(candidateId); triggerStaleCascade([candidateId]); close()`) — click-equals-select-equals-close becomes inspect (D-08: explicit 选定 button per card, wall stays open, next group loads per D-17). Footer text L127-128 mentioning 「💾 保存后持久化」 is the deprecated narrative — new copy states immediate persistence. Also do NOT source data from `VariantStackData` — `adapter.ts` `stackByWinner` L679-707 only materializes stacks when a group has `curation:'deprecated'` members (L683-687), which kmc candidate groups never satisfy (research Critical Gap). Read `graph.variantGroups` + member nodes directly via `variantOps.getVariantMemberNodes` (`variantOps.ts` L27-34).

**Analog B (quiet panel shell):** `NodeDetailPanel.tsx`
- Panel chrome (L98-111): `background: theme.bg.panel`, `border: 1px solid ${theme.border.default}`, header row with icon + title + `✕` close button (`closeBtnStyle` pattern, VariantPicker L135-137).
- Section dividers: `borderBottom: 1px solid ${theme.border.default}` + `background: theme.bg.card` header strip (L104).
- Full-screen theater tokens: `theme.chrome.lightboxOverlay` (L196, `rgba(0,0,0,0.85)`) for the dark theater backdrop; `v3theme.signal.select` cold-white for the winner/selected accent (D-05 names these tokens).
- Signature-element restraint: one signature only (synchronized playhead), everything else quiet — catppuccin.ts L44-46 design language ("颜色只留给 4 个产物模态通道").

**Selection wiring (D-12):** call `useCanvasStore.selectWinner` — the v3 path is already optimistic+endpoint+rollback (canvasStore.ts L889-929, excerpt below). The wall only changes WHO calls it (explicit button) and adds frameSlot for G13 (extend signature + `canvasApi.selectVariantWinner` body, see canvasStore/canvasApi entries). After success fire `triggerStaleCascade([candidateId])` (`useStale.ts` L48-60) exactly as VariantPicker did — the v3 store path does not cascade by itself.

**Video elements:** `<video ... muted loop ...>` precedent at `AssetCardNode.tsx` L343-344; src via `resolveMediaUrl(asset?.media.proxy ?? asset?.media.original ?? data.filePath)` (L272). DR-5/D-06: all non-solo videos stay `muted=true`; only the solo card unmutes.

---

### `packages/infinite-canvas/src/components/variants/wallTransport.ts` (utility, streaming)

**No functional analog** (repo has no multi-video sync). Discipline analog: `store/variantOps.ts` — pure functions, no React imports, returns new state/outcome objects with everything a caller needs for rollback (`applyWinnerSelection` L66-71 + `WinnerUpdateOutcome` L56-64). Model the video as an injected interface (`HTMLVideoElementLike`) so vitest can drive it with fakes (53-RESEARCH DR-5 + Code Example supply the algorithm: rAF master clock, 120ms hard-seek, min-duration span, solo muting, stall→pause-align).

---

### `packages/infinite-canvas/src/components/variants/useWallKeyboard.ts` (hook, event-driven)

**Analog:** `VariantPicker.tsx` L25-30 (quoted above) — `window.addEventListener('keydown', onKey)` inside `useEffect` gated on open state, cleanup on unmount. Extend the map: `1-9` inspect/select-take, `Enter` confirm, `←/→` group nav, `Space` transport toggle, `Esc` close (D-20). Test placement: `packages/infinite-canvas/src/hooks/__tests__/` exists as the hook-test precedent directory.

---

### `packages/infinite-canvas/src/components/g15/G15TriagePanel.tsx` (component, request-response batch)

**Analog A (panel shell):** `NodeDetailPanel.tsx` — same quiet chrome (L98-118 excerpt above): panel bg/border, header strip, tab/section rows, `closeBtnStyle`. Design tokens per DR-6: phase badge color = `v3theme.phaseGroup` four-color map (catppuccin.ts L67-73), error-category badge = `v3theme.signal.*` (L75-80), row chrome quiet.

**Analog B (batch optimistic + confirm + rollback):** `AssetLibrary.tsx` `handleSelect` (L839-862):
```typescript
// 待选→选定：... 全程乐观更新——绝不 reload（避免列表闪烁/跳顶），仅在后端失败时回滚。
const handleSelect = async (assetId: number, groupKey: string) => {
  ...
  // 1. 乐观更新 UI
  patchLocal(assetId, { isPrimaryView: true, state: 'active' })
  // 2. 后端同步（不 reload；失败时整体回滚到真实状态）。
  try {
    ...
    showToast(`已设为选定资产 · ...`, 'success')
  } catch (err) {
    showToast('设置失败: ' + (err as Error).message, 'error')
    await reload()
  }
}
```
G15 batch waive/requeue follows this loop shape (optimistic row-state change → sequential awaited POSTs → toast → rollback on failure). Two-step confirmation for 重渲 (D-14) mirrors the in-component confirm-state precedent `showDeletePrompt` in CanvasContextMenu (verified in verify-phase-51.ts S2 assertions L191-194: confirmation state, never native `confirm()`).

---

### `src/routes/canvas/v2/select-winner.ts` (mod — extension in place)

**Analog: itself.** Three edits, all with in-file precedent:

1. **Schema extension** (after L40, backward-compatible optionals per 53-RESEARCH Code Example):
```typescript
frameSlot: z.enum(["first", "last"]).optional(),   // D-11: G13 首尾分选
source: candidateSourceSchema.optional(),          // 归因到 5 源之一
```
2. **Manifest writeback hook** — insert AFTER the reviewBridge call (L151-158, same `void ... .catch(() => {})` shape), still inside the `status==="updated"` reach (idempotent branch L82-88 must keep skipping it — Pitfall 5):
```typescript
void enqueueManifestWriteback({ projectId, episodesId, groupId,
  winnerNodeId, variantIndex: result.variantIndex, frameSlot, source }).catch(() => {});
```
3. Nothing else moves — transaction, o_assets swap, broadcast all stay as-is (D-09 one-channel rule).

---

### `packages/infinite-canvas/src/services/canvasApi.ts` (mod)

**Analog: itself**, `selectVariantWinner` L463-475:
```typescript
export async function selectVariantWinner(
  projectId: number,
  episodesId: number,
  groupId: string,
  winnerNodeId: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>(
    `/canvas/v2/variant-groups/${encodeURIComponent(groupId)}/select-winner`,
    { projectId, episodesId, winnerNodeId },
    { cancelToken },
  )
}
```
Extend the body with `...(frameSlot ? { frameSlot } : {})` (spread-omit pattern for optional fields, same as `approveNode` L438: `...(winnerId ? { winnerId } : {})`). Add `g15Ops(projectId, episodesId, action, shotIds)` as a sibling `apiCall<void>('/canvas/v2/g15-ops', {...})`. Docblock style: endpoint contract + error semantics + who rolls back (L452-462 is the model).

---

### `packages/infinite-canvas/src/store/canvasStore.ts` (mod)

**Analog: itself**, `selectWinner` v3 canonical path L889-929:
```typescript
selectWinner: async (nodeId) => {
  ...
  if (graph) {
    ...
    if (group) {
      // 拍下 prev 引用：selectVariant 内部 clone，prev 不被改动，可零成本回滚
      const prevGraph = graph
      let next: FlowGraphV3
      try {
        // 包内校验（非 single 组 / 悬空 winner / curation:'locked' 成员）同步 throw
        // → 发生在任何 await 之前：不部分应用、不调 API
        next = selectVariant(graph, group.id, nodeId)
      } catch (err) {
        showToast(`选定失败: ${(err as Error).message}`, 'error')
        return
      }
      get().setGraph(next, get().warnings)
      try {
        await selectVariantWinner(projectId, episodesId, group.id, nodeId)
        showToast(`已选为优胜: ${nodeId}`, 'success')
      } catch (err) {
        get().setGraph(prevGraph, get().warnings)
        showToast(`选定失败已回滚: ${(err as Error).message}`, 'error')
      }
      return
    }
```
Extension: pass `frameSlot` through (G13 walls know the slot from the derived group's groupKey suffix), and add the wall's next-group flow (D-17/D-18: after success, advance to next unselected group in shot order — a read-only selector, not a new write path). The legacy RF path L931-971 is the D-12 deprecation target — do not extend it; plan its removal carefully against "graph 为空" fallback users. Guards in `selectVariant` (locked/multi/dangling) come from the flowgraph-v3 package and stay authoritative.

---

### `packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx` (mod)

**Analog: itself**, `handleLocateOnCanvas` L829-835 — the exact block D-19 reuses for 「去画布选片」:
```typescript
const handleLocateOnCanvas = useCallback((a: AssetItem) => {
  const nodeId = `asset-${a.id}`
  const store = useCanvasStore.getState()
  store.navPushCallback?.()
  store.setFocusAssetNodeId(nodeId)
  store.setViewMode('canvas')
}, [])
```
The new link targets the candidate group's canvas node (from the derived group, not `asset-${id}`) and additionally opens the wall after focus lands.

---

### `src/lib/initDB.ts` (mod) / `src/router.ts` (mod) / root `package.json` (mod)

- `initDB.ts`: add `canvas_writeback_queue` to the `relationalCanvasTables` family (L1257+) using the `canvas_variant_groups` builder shape (L1332-1347, quoted in writebackQueue above); state-enum column comment style from `kv_shotGraph` L1122.
- `router.ts`: import near L26-29, mount near L188-192 as `app.use("/api/canvas/v2/g15-ops", routeN);`.
- `package.json`: `"verify:phase-53": "npx tsx scripts/verify-phase-53.ts",` after L44.

### Test placement (5 files)

| Test file | Location precedent |
|---|---|
| `selectWinner.test.ts` (extend: frameSlot assertions) | `packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts` (exists) |
| `wallTransport.test.ts`, `useWallKeyboard.test.ts` | `packages/infinite-canvas/src/hooks/__tests__/` (dir exists); wall tests under new `src/components/variants/__tests__/` |
| `G15TriagePanel.test.tsx` | package vitest, component-test style of store/__tests__ |
| root-side contract tests (envelope round-trip, g15Bridge swallow, queue replay) | root has NO vitest — go into `verify-phase-53.ts` S-sections with `node:assert` (verify-phase-51 precedent, L46-52 header note) |

---

## Shared Patterns

### P1. Best-effort bridge (applies to: manifestWriteback, g15Bridge, both hook mounts)
**Source:** `src/lib/reviewBridge.ts` L114-119 + L249-257; mount style `select-winner.ts` L146-158.
`void fn({...}).catch(() => {})` at the call site; the function itself never rejects; deps fully injected; failures warn+skip. The idempotent branch of the owning endpoint never reaches the bridge.

### P2. Transactional endpoint status ladder (applies to: g15-ops, select-winner extension)
**Source:** `select-winner.ts` L61-88. Service returns discriminated `status`; each status maps to one HTTP code; early-return before ANY write on non-updated branches; `console.error` + generic `error("...失败")` 500 catch (L171-174).

### P3. Optimistic + rollback (applies to: VariantWall selection, G15 batch ops)
**Source:** `canvasStore.ts` L903-923 (prevGraph snapshot → apply → await → rollback+toast) and `AssetLibrary.tsx` L839-862 (optimistic patch → await POSTs → rollback reload). Pure compute BEFORE any await so validation throws never partially apply.

### P4. db-as-parameter service functions (applies to: candidateGroupDeriver, writebackQueue)
**Source:** `canvasRelationalStore.ts` L367-369/L446-451, `ingestAssets.ts` L87-90. `db: Knex` first arg; `db.transaction(async (trx) => ...)` for multi-row writes (canvasRelationalStore L526-545).

### P5. Media URL resolution + thumbnail self-heal (applies to: wall cards, G15 rows)
**Source:** `utils/mediaUrl.ts` — `resolveMediaUrl` L89-103 (/oss prefix + fsToOssPath + /local-file whitelist fallback), `resolveRelativeAssetPath` L117-126, `ossDirOf` L106-111. NEVER hand-build media URLs (8 existing consumers). Self-heal backend: POST `/api/canvas/v2/thumbnail` body `{sourcePath}` (`thumbnail/index.ts` L9-37, idempotent) → `ensureThumbnail` (`src/lib/thumbnail.ts` L124-157). Frontend detects via `<img onError>`; the known trap is `needsThumbnailing` returning false for missing `_thumbs` files (L163-168) — `isThumbnailMissing` (L176-185) + `healNodeDataThumbnail` (L198+) are the server-side four-state heal to mirror conceptually, but the wall triggers from onError (DR-3), not the save hook.

### P6. Theme tokens (applies to: VariantWall, G15TriagePanel — token decisions BEFORE code per /frontend-design discipline)
**Source:** `theme/catppuccin.ts` (248 lines). `v3theme.signal.*` L75-80 (select= cold white #EDEEF1 for winner accent, per D-05); `theme.bg.panel` L101 / `theme.bg.card` L102; `v3theme.modalityWeak` L51-56 (badge chip weak backgrounds per DR-1); `v3theme.phaseGroup` L67-73 (G15 phase badges); `theme.chrome.lightboxOverlay` L196 (theater dark); score thresholds via `getScoreColor` L244-248 (≥0.8 青 / ≥0.5 金 / else 玫 — reuse, do not invent). Stack-open animation `cv-stack-fan` var usage: VariantPicker L67.

### P7. Verify-gate skeleton (applies to: verify-phase-53)
**Source:** `scripts/verify-phase-51.ts` — mkdtemp/chdir isolation before dynamic imports (L78-83), @/utils barrel-first import order (L201-210), real modules zero re-implementation, grepSource build-artifact exclusions (L90-124), forced-failure self-check (L397-423), exit 0/1/2. npm script at root package.json L43-44.

### P8. zod version discipline (applies to: every new/extended schema)
Root (`src/`) uses zod ^4.3.5; `packages/infinite-canvas` uses zod ^3.25.76. Never import a schema instance across the package boundary — server envelope in root zod; package-side types as hand-written TS interfaces (Pitfall 8).

### P9. Keyboard + focus hygiene (applies to: useWallKeyboard, wall Esc)
**Source:** `VariantPicker.tsx` L25-30. window-level keydown gated on open, always removed on cleanup.

### P10. Socket broadcast echo guard (applies to: wall multi-tab consistency)
**Source:** `useCanvasSocket.ts` L199-205 — `variant:selected` payload consumed with a skip-when-already-applied guard; extend payload consumers, not the broadcast.

---

## No Analog Found

| File | Role | Data Flow | Reason / Where the Design Lives |
|------|------|-----------|----------------|
| `wallTransport.ts` (rAF master clock) | utility | streaming | No multi-video sync exists in repo (closest: single-video hover-play, AssetCardNode L343-344). Full algorithm in 53-RESEARCH DR-5 + Code Example; discipline analog variantOps.ts (pure + injectable interfaces for vitest fakes). |
| `writebackQueue.ts` drain/replay loop | service | batch | No scheduler/retry-queue precedent (kv tables have state enums but no drain). Shape fully specified in 53-RESEARCH DR-4; db/trx discipline from canvasRelationalStore. |

---

## Metadata

**Analog search scope:** `src/lib`, `src/routes/canvas/v2/**`, `src/router.ts`, `scripts/`, `packages/infinite-canvas/src/{components,store,services,hooks,theme,utils,v3}`; khs repo intentionally NOT mapped (Wave B, D-01).
**Files scanned:** 18 analog files read line-targeted; ~30 more located via grep (openPicker call sites, router mounts, npm scripts).
**Pattern extraction date:** 2026-08-21
**Line-number caveat:** excerpts verified 2026-08-21 against master; if Wave A lands in parallel sessions (known repo behavior), re-verify line anchors for select-winner.ts and canvasStore.ts before executing plans that quote them.
