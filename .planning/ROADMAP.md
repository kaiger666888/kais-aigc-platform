# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)
- ✅ **v1.6 Workflow Skill Contract** — Phases 28-34 (shipped 2026-06-15)
- ✅ **v1.7 Infinite Canvas Storyboard & Orchestration** — Phases 35-38 (shipped 2026-06-18)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (shipped)
- Integer phases (35-38): v1.7 (this milestone)
- Decimal phases (e.g., 35.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-34: v1.0 through v1.6 — collapsed</summary>

#### v1.0 MVP (Phases 1-6)

Core video/image/audio generation pipeline via ComfyUI + cloud fallback.

#### v1.1 Hermes Intelligent Decision Engine (Phases 7-10)

Domain-agnostic REST API with self-learning loop. 21 requirements satisfied.

#### v1.2 Integration Testing (Phases 11-14)

Complete hermes-agent integration test suite. 42+ tests, CI pipeline. 22 requirements satisfied.

#### v1.3 Architecture Alignment (Phases 15-19.1)

Engine consolidation, workflow builder expansion, BackendType classification. 102/102 tests passing.

#### v1.4 Production Verification + Repo Governance (Phases 20-22)

ENG-04 fix shipped. Live runtime verification partial. 19 sibling repos audited.

#### v1.5 Architecture Hardening + Code Hygiene (Phases 23-27)

GpuScheduler Redis backend, gold-team Python cleanup, unified output paths, TypeScript compile clean (12,447→0 errors), router.ts auto-gen root-cause fix. 9/9 requirements satisfied.

#### v1.6 Workflow Skill Contract (Phases 28-34)

Skill contract published at `src/skills/contract.ts`; registry layer replaces hardcoded constants; canvas fetches node types dynamically; skill author guide + install-ready manifest shipped. 35/36 requirements satisfied (1 deferred — COMPLIANCE-03 live Docker + GPU sign-off, environment-gated).

</details>

### ✅ v1.7 Infinite Canvas Storyboard & Orchestration (Shipped 2026-06-18)

**Milestone Goal:** Borrowing the Tier 1 differentiators of ByteDance Xiaoyunque short-drama Agent, upgrade the infinite canvas — add storyboard metadata (camera/framing/composition/pacing), introduce one-click full-pipeline orchestration ("一键成片"), and unlock batch execution workflows. Upgrade scattered node graphs into a complete short-drama production pipeline that runs end-to-end with one click. Tier 1 only this milestone — pure frontend + backend orchestration extension, no LLM integration, no schema refactor.

**Architecture decisions (v1.7):**

1. Phase numbering continues from v1.6 (Phase 35+)
2. **Borrow scope focused on Tier 1** — Story blueprint generator (LLM integration) and character consistency management (backend schema changes) deferred to v1.8+; this milestone is purely frontend + backend orchestration extension
3. **Metadata storage** — reuse existing `FlowGraph.data: Record<string, unknown>` free schema; new fields added on `StoryboardNodeData`; backend `o_storyboard` extended via JSON column (`prompt_meta`) without breaking existing schema
4. **One-click orchestration reuses existing `executeNode`** — no new engine introduced; orchestrator loops over nodes in canvas API layer, progress pushed via WebSocket
5. **Batch execution = multiple `executeNode` calls** — backend is not concurrent; frontend fires parallel fire-and-forget; GPU serialization handled by GpuScheduler
6. **Single backend endpoint for orchestrate + batch** — `POST /api/canvas/orchestrate` accepts optional `nodeIds: string[]`; full-canvas run when omitted, explicit subset when provided (BATCH-02)
7. **Tier 2 PREVIEW phase (38) is optional and parallel-safe** — depends only on Phase 35 (storyboard metadata + `linkedAssetIds`); may be deferred without blocking Tier 1 milestone close

- [x] **Phase 35: Storyboard Metadata Extension** — `StoryboardNodeData` gains `cameraMovement`/`framing`/`composition`/`pacing`; chips rendered; NodeDetailPanel dropdowns; flowDataMapper round-trip via existing JSON blob persistence.
- [x] **Phase 36: One-Click Film Orchestrator** — Toolbar "🚀 一键成片" button; `POST /api/canvas/orchestrate` route; topology-ordered execution via shared `simulateExecution` helper; skip-success logic; WebSocket progress + run-state UI + completion toast.
- [x] **Phase 37: Batch Execution** — Multi-select right-click "批量执行 (N 个节点)"; reuses orchestrate endpoint with explicit `nodeIds`; skip-success per node; shared WebSocket progress channel; single-node "执行节点" retained on `/canvas/execute` for back-compat.
- [x] **Phase 38: Storyboard Preview Cards (Tier 2)** — "👁 预览构图" button; `POST /api/canvas/storyboard/preview` (placeholder simulation; gold-team IMAGE_DRAW integration deferred); reuses existing `node:preview` WebSocket event; failure non-blocking.

## Phase Details

### Phase 35: Storyboard Metadata Extension
**Goal**: Users can tag each storyboard node with directorial intent (camera movement, framing, composition, pacing), see it at a glance on the canvas, edit it inline, and trust it survives round-trips through save/load.
**Depends on**: Nothing (first v1.7 phase; builds on v1.6 canvas foundation)
**Requirements**: STORYBOARD-01, STORYBOARD-02, STORYBOARD-03, STORYBOARD-04, STORYBOARD-05, STORYBOARD-06, STORYBOARD-07
**Success Criteria** (what must be TRUE):
  1. User can set any of four metadata fields (cameraMovement / framing / composition / pacing) on a storyboard node via dropdowns in NodeDetailPanel, and the change persists immediately in the canvas store (canvas marked dirty).
  2. User can read each populated metadata field as a chip on the StoryboardNode renderer; empty fields render nothing (no clutter).
  3. User can save a storyboard node with metadata, reload the project, and see all four fields restored intact (canvas ↔ FlowGraph ↔ `o_storyboard.prompt_meta` JSON column round-trip preserves new fields without corrupting existing `prompt` text).
  4. Each metadata field only accepts its documented enum values (e.g. `static`/`zoom_in`/.../`tracking` for cameraMovement); invalid values are rejected by the editor.
**Plans**: TBD

Plans:
- [ ] 35-01: TBD
- [ ] 35-02: TBD

### Phase 36: One-Click Film Orchestrator
**Goal**: User can press a single "🚀 一键成片" button on any non-empty canvas and watch the platform run the entire node graph end-to-end in correct topological order, with live progress feedback and a clear completion summary.
**Depends on**: Phase 35
**Requirements**: ORCHESTRATE-01, ORCHESTRATE-02, ORCHESTRATE-03, ORCHESTRATE-04, ORCHESTRATE-05, ORCHESTRATE-06, ORCHESTRATE-07
**Success Criteria** (what must be TRUE):
  1. User sees the "🚀 一键成片" button in the canvas toolbar, enabled when the canvas has ≥1 node and disabled (with idle/running/done/error state label) otherwise or while a run is in flight.
  2. Clicking the button triggers `POST /api/canvas/orchestrate` with `projectId` + `episodesId`; orchestrator executes nodes in topology order (script → asset → storyboard → video → audio) via existing `executeNode`, skipping nodes already in `state === 'success'` or `cached`.
  3. User sees live global progress during a run — a progress bar fed by `orchestrate_progress` WebSocket events showing "运行中 (N/M)" against the toolbar button.
  4. When the run completes, user sees a toast summary "一键成片完成 (X/Y 节点成功)" with the failed-node list attached as toast detail.
  5. Node-level failures do not abort the entire run — subsequent independent nodes continue executing, and failures are surfaced in the completion toast rather than swallowed.
**Plans**: TBD
**UI hint**: yes

### Phase 37: Batch Execution
**Goal**: User can select a subset of nodes on the canvas and trigger them together as one batch, sharing the same progress channel and skip logic as the full-canvas orchestrator, with the single-node "执行节点" entry remaining as a thin convenience wrapper.
**Depends on**: Phase 36
**Requirements**: BATCH-01, BATCH-02, BATCH-03, BATCH-04, BATCH-05
**Success Criteria** (what must be TRUE):
  1. User can multi-select nodes (Shift+click / `selectionOnDrag`) and right-click to see a "批量执行 (N 个节点)" menu entry that reflects the current selection count.
  2. Triggering batch execution calls the same `POST /api/canvas/orchestrate` endpoint as Phase 36 but with an explicit `nodeIds: string[]` body — the backend executes exactly those nodes, honoring per-node `state === 'success'` skip.
  3. During a batch run, user sees a "批量执行 (N/M)" progress indicator over the same WebSocket channel as full orchestration (no separate channel).
  4. Right-clicking a single node still exposes "执行节点", which internally calls the orchestrate endpoint with a one-element `nodeIds` list (single code path, no special-case endpoint).
**Plans**: TBD
**UI hint**: yes

### Phase 38: Storyboard Preview Cards (Tier 2, optional)
**Goal**: Before committing to video generation, user can request a low-cost static preview of a storyboard's composition generated from its prompt + linked character assets, so failures are caught early and cheaply.
**Depends on**: Phase 35
**Requirements**: PREVIEW-01, PREVIEW-02, PREVIEW-03, PREVIEW-04, PREVIEW-05
**Success Criteria** (what must be TRUE):
  1. User sees an "👁 预览构图" button on a storyboard node, enabled only when the node has both `linkedAssetIds` populated and a non-empty prompt.
  2. Clicking the button calls `POST /api/canvas/storyboard/preview`, which invokes the existing IMAGE_DRAW engine to produce a single 1280×720 reference image.
  3. When the preview is ready, user sees the rendered image appear in the storyboard node's thumbnail slot via a `preview_update` WebSocket event; the image persists at `o_storyboard.preview_path` for retrospective review after video `state === 'success'`.
  4. A preview failure does not block any other flow — user sees only a toast, and the rest of the canvas (including orchestrator/batch runs) continues normally.
**Plans**: TBD
**UI hint**: yes

## Progress

**v1.7 Execution Order (planned):**

```
35 (storyboard metadata) ──┬──► 36 (orchestrator) ──► 37 (batch)
                            │
                            └──► 38 (preview, Tier 2, optional, parallel-safe)
```

Tier 1 phases (35/36/37) form a serial chain — orchestrator must respect storyboard metadata, and batch reuses the orchestrate endpoint.
Tier 2 (Phase 38 PREVIEW) depends only on Phase 35 and may execute in parallel with 36/37 or be deferred without blocking milestone close.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 35. Storyboard Metadata Extension | v1.7 | 0/TBD | Not started | - |
| 36. One-Click Film Orchestrator | v1.7 | 0/TBD | Not started | - |
| 37. Batch Execution | v1.7 | 0/TBD | Not started | - |
| 38. Storyboard Preview Cards (Tier 2) | v1.7 | 0/TBD | Not started (optional) | - |

### Completed Milestones

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 28-34 | v1.6 Workflow Skill Contract | ✅ Complete (1 deferred sign-off) | 2026-06-15 |
| 23-27 | v1.5 Architecture Hardening + Code Hygiene | ✅ Complete | 2026-06-14 |
| 20-22 | v1.4 Production Verification + Repo Governance | ✅ Partial Complete | 2026-06-13 |
| 15-19.1 | v1.3 Architecture Alignment | ✅ Complete | 2026-06-13 |
| 11-14 | v1.2 Integration Testing | ✅ Complete | 2026-06-07 |
| 7-10 | v1.1 Hermes Decision Engine | ✅ Complete | 2026-06-06 |
| 1-6 | v1.0 MVP | ✅ Complete | - |
