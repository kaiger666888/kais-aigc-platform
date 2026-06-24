# Requirements: KAIS AIGC Platform

**Defined:** 2026-06-17
**Core Value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows (movie / podcast / ads / interactive) via a published skill contract.

## v1.7 Requirements — Infinite Canvas Storyboard & Orchestration

借鉴字节小云雀短剧 Agent 的 Tier 1 差异化能力,升级无限画布。本期纯前端 + 后端编排扩展,不涉及 LLM 集成或 schema 重构。

每个 requirement 映射到 ROADMAP.md 中的 phase (Phase 35+)。Traceability 在 roadmap 创建时填充。

### STORYBOARD — 分镜元数据扩展 (Phase 35)

- [x] **STORYBOARD-01**: `StoryboardNodeData` 扩展字段 `cameraMovement` (枚举: `static`/`zoom_in`/`zoom_out`/`pan_left`/`pan_right`/`tilt_up`/`tilt_down`/`dolly`/`tracking`)
- [x] **STORYBOARD-02**: `StoryboardNodeData` 扩展字段 `framing` (枚举: `wide`/`medium`/`close_up`/`extreme_close_up`/`over_the_shoulder`/`aerial`)
- [x] **STORYBOARD-03**: `StoryboardNodeData` 扩展字段 `composition` (枚举: `rule_of_thirds`/`centered`/`golden_ratio`/`symmetrical`/`leading_lines`)
- [x] **STORYBOARD-04**: `StoryboardNodeData` 扩展字段 `pacing` (枚举: `slow`/`medium`/`fast`/`montage`)
- [x] **STORYBOARD-05**: `StoryboardNode` 渲染器展示元数据 chips (运镜 / 景别 / 构图 / 节奏),空值不显示
- [x] **STORYBOARD-06**: `NodeDetailPanel` 对 storyboard 节点提供四个枚举下拉编辑器,实时更新 store 并标记画布 dirty
- [x] **STORYBOARD-07**: `flowDataMapper` 双向序列化保留新字段 (canvas ↔ FlowGraph);保存到 `o_storyboard.prompt_meta` JSON column 不破坏现有 prompt 字段

### ORCHESTRATE — 一键成片编排器 (Phase 36)

- [x] **ORCHESTRATE-01**: 顶部 toolbar 新增 "🚀 一键成片" 按钮,仅当画布有 ≥1 节点时启用
- [x] **ORCHESTRATE-02**: 后端新增 `POST /api/canvas/orchestrate` 路由,接收 `projectId`/`episodesId`,返回 `runId`
- [x] **ORCHESTRATE-03**: 编排器按节点类型拓扑序触发执行 (script → asset → storyboard → video → audio),每节点走现有 `executeNode` 入口
- [x] **ORCHESTRATE-04**: 编排器跳过 `state === 'success'` 或 `cached` 的节点,避免重复执行
- [x] **ORCHESTRATE-05**: WebSocket 推送 `orchestrate_progress` 事件,前端显示全局进度条 (已完成 / 总数)
- [x] **ORCHESTRATE-06**: 顶部 toolbar 显示运行状态 (idle / running / done / error);运行中禁用按钮,显示"运行中 (3/12)"
- [x] **ORCHESTRATE-07**: 编排完成后 toast 提示 "一键成片完成 (12/12 节点成功)";失败节点列表附带在 toast 详情中

### BATCH — 批量执行 (Phase 37)

- [x] **BATCH-01**: 多选节点 (Shift+click 已支持 `selectionOnDrag`),右键菜单显示 "批量执行 (N 个节点)"
- [x] **BATCH-02**: 批量执行入口调用与 ORCHESTRATE 同一个后端 endpoint,但传入显式 nodeId 列表 (`POST /api/canvas/orchestrate { nodeIds: [...] }`)
- [x] **BATCH-03**: 批量执行遵守节点级 `state === 'success'` 跳过逻辑
- [x] **BATCH-04**: 批量执行通过同一 WebSocket 通道推送进度,UI 显示 "批量执行 (2/5)"
- [x] **BATCH-05**: 单节点右键菜单 "执行节点" 保留作为单点入口,内部复用 orchestrate endpoint (传单个 nodeId)

### CANVAS-PREVIEW — 分镜预览卡片 (Phase 38, Tier 2 可选)

> 目标:借鉴小云雀的"分镜即预览"——生成视频前,基于元数据 + 关联角色资产生成静态构图预览图,降低失败成本。

- [x] **PREVIEW-01**: Storyboard 节点新增 "👁 预览构图" 按钮 (仅当有 `linkedAssetIds` 且有 prompt 时启用)
- [x] **PREVIEW-02**: 后端新增 `POST /api/canvas/storyboard/preview`,调用现有 IMAGE_DRAW 引擎生成分镜参考图 (单图,1280x720)
- [x] **PREVIEW-03**: 预览图通过 WebSocket `preview_update` 推送,前端在 storyboard 节点缩略图位置展示
- [x] **PREVIEW-04**: 预览图存到 `o_storyboard.preview_path`;`state === 'success'` 后保留作为视频生成前的回顾
- [x] **PREVIEW-05**: 预览失败不阻塞主流程,仅 toast 提示

## v1.8 Requirements — Canvas ↔ Movie-Agent V8.6 Adaptation

**Motivation:** v1.7 infinite canvas (master) drifted from latest kais-movie-agent V8.6 (sibling repo at `/data/workspace/kais-movie-agent/`). Movie-agent ships `lib/canvas-client.js` (795 lines) expecting `/api/v2/canvas/*` routes that were stranded on `feature/canvas-v2` since d9c826c. Reconcile both sides so the latest agent can drive the latest canvas.

### ADAPT — Contract Alignment (Phase 39 Wave 1)

- [x] **ADAPT-01**: master exposes `/api/v2/canvas/{load,save,nodes,branches,links,layout}` REST endpoints
- [x] **ADAPT-02**: FlowGraphV2 types + zod schema available on master (`src/types/flowgraph-v2.ts` + `flowgraph-v2-schema.ts`)
- [x] **ADAPT-03**: `router.ts` registers both `/api/canvas/*` (v1) and `/api/v2/canvas/*` (v2)
- [x] **ADAPT-04**: `useCanvasSocket` listens to `orchestrate:*` AND `branch:*`/`review:*` events (no regression from either side)

### EXEC — Real Engine Wiring (Phase 39 Wave 2)

- [x] **EXEC-01**: `_simulate.ts` calls real gold-team engine when `GOLD_TEAM_URL` set; falls back to setTimeout simulation otherwise (graceful degradation)
- [x] **EXEC-02**: `storyboardPreview.ts` calls real IMAGE_DRAW engine when env configured; persists `preview_path`; falls back gracefully
- [x] **EXEC-03**: Node-type → TaskType mapping covers all 5 v1.7 node types (script, asset, storyboard, video, audio)

### VERIFY — Contract Verification (Phase 39 Wave 3)

- [x] **VERIFY-01**: Every method in `/data/workspace/kais-movie-agent/lib/canvas-client.js` maps to a valid master endpoint
- [x] **VERIFY-02**: `tsc --noEmit` (root) passes after merge
- [x] **VERIFY-03**: `tsc -b` (packages/infinite-canvas) passes after merge

## v1.9 Requirements — Canvas Sync Reliability

**Motivation:** Field symptom — kais-movie-agent 节点生成物 / 审核状态经常无法同步到无限画布。Root cause: fire-and-forget + read-modify-write + whole-graph-overwrite on `o_agentWorkData.canvasGraph` loses data silently on concurrent writes; no replay on WS reconnect; no idempotency on receiver. Phase 41 replaces the write model with an append-only event log + monotonic reducer + resumable subscription.

### SYNC — Write Path (Phase 41 Wave 1)

- [ ] **SYNC-01**: New table `kv_canvasEvent(eventId PK autoincrement, projectId, episodesId, clientId, type, nodeId, payload JSON, source, createdAt)` with `UNIQUE(projectId, episodesId, clientId)` and index on `(projectId, episodesId, eventId)`.
- [ ] **SYNC-02**: `POST /api/v2/canvas/events` accepts `{projectId, episodesId, clientId, events[]}` and appends atomically in a transaction. Duplicate `clientId` returns previously-assigned `eventId`s with `duplicated: true`, writes nothing.
- [ ] **SYNC-03**: Pure reducer `reduce(state, event): state` covers `node_upsert` / `node_delete` / `link_upsert` / `link_delete` / `branch_upsert` / `variant_group_upsert` / `review_status` / `bootstrap`. Deterministic given identical event sequence.
- [ ] **SYNC-04**: `o_agentWorkData.canvasGraph` snapshot recomputed from event log after every successful append (debounced per project+episode, flushed before any read returns).
- [ ] **SYNC-05**: Idempotent bootstrap — if `o_agentWorkData.canvasGraph` exists but `kv_canvasEvent` is empty for that (project, episode), a one-time synthetic `bootstrap` event captures the current graph.

### REPLAY — Read Path (Phase 41 Wave 3)

- [ ] **SYNC-06**: `GET /api/v2/canvas/load-v2?since=<eventId>` — without `since` returns `{graph, lastEventId}`; with `since` returns `{events[], lastEventId}`.
- [ ] **SYNC-07**: WS `/ws/projects` accepts `subscribe` handshake `{projectId, since?}`. Server replays all events after `since` to that socket, then continues live emission. Back-compat (no handshake) preserved.
- [ ] **SYNC-08**: All canvas WS broadcasts carry `{eventId, type, payload, projectId, episodesId}` so clients can stamp high-water mark.

### COMPAT — Backwards Compatibility (Phase 41 Wave 2)

- [ ] **SYNC-09**: Legacy routes `save-v2` / `nodes POST` / `nodes PATCH /batch` / `nodes PATCH /:id` / `nodes DELETE` / `links` / `branches` continue to work by translating writes to event appends with a generated `clientId`. Caller-visible behavior unchanged.
- [ ] **SYNC-10**: Frontend `useCanvasSocket` gains optional `subscribe` + incremental handling behind `VITE_CANVAS_EVENT_REPLAY=1` (default OFF for v1.9 staged rollout). Existing listeners untouched.

### VERIFY — Static Verification (Phase 41 Wave 3)

- [ ] **SYNC-11**: `tsc --noEmit` (root) and `tsc -b` (packages/infinite-canvas) both pass with zero errors.
- [ ] **SYNC-12**: `scripts/verify-phase-41.ts` covers: idempotent append (duplicate `clientId`); reducer determinism + merge parity with `Object.assign`; `load-v2?since=N` returns exactly N+1..last; bootstrap migration; legacy `save-v2` round-trip.

## Future Requirements (deferred)

- **故事蓝图生成器** — Script 节点右键 "生成分镜",调用 LLM 拆解为多个 storyboard 节点;需 LLM 集成层 (推迟 v1.9)
- **角色一致性管理** — 跨分镜/跨集的角色绑定 + 全剧集统一形象管理;需 `o_character_role` 表 + 一致性引擎 (推迟 v1.9)
- **批量多集生成** — 项目级批量执行(参考小云雀 80 集能力);需 queue + scheduler 协调 (推迟 v1.9)
- **第二参考 skill** — v1.6 deferred,验证 skill contract 抽象的扩展性
- **运行 movie-agent V8.6 Docker** — 需 OpenClaw runtime;单独工程
- **Canvas UI for V8.6 13-step pipeline** — 推迟 v1.9+
- **dreamina CLI subprocess** 替换 gold-team proxy — V8.6 架构变迁,推迟 v1.9+

## Out of Scope (v1.7)

- **视频生成参数编辑器** — Wan2.2 等模型参数(seed/guidance_scale/steps)编辑属于引擎调参范畴,非画布职责
- **音频波形可视化** — 音频节点目前仅展示时长;完整波形是 audio-workstation 范畴
- **多语言配音/语音翻译** — v1.6 已声明 out-of-scope,延续
- **移动端审批** — review-platform 范畴,非画布
- **协作编辑 (CRDT)** — 多用户实时协作属于 Figma 类产品形态,本期不做

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STORYBOARD-01 | Phase 35 | ✓ Shipped |
| STORYBOARD-02 | Phase 35 | ✓ Shipped |
| STORYBOARD-03 | Phase 35 | ✓ Shipped |
| STORYBOARD-04 | Phase 35 | ✓ Shipped |
| STORYBOARD-05 | Phase 35 | ✓ Shipped |
| STORYBOARD-06 | Phase 35 | ✓ Shipped |
| STORYBOARD-07 | Phase 35 | ✓ Shipped |
| ORCHESTRATE-01 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-02 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-03 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-04 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-05 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-06 | Phase 36 | ✓ Shipped |
| ORCHESTRATE-07 | Phase 36 | ✓ Shipped |
| BATCH-01 | Phase 37 | ✓ Shipped |
| BATCH-02 | Phase 37 | ✓ Shipped |
| BATCH-03 | Phase 37 | ✓ Shipped |
| BATCH-04 | Phase 37 | ✓ Shipped |
| BATCH-05 | Phase 37 | ✓ Shipped |
| PREVIEW-01 | Phase 38 | ✓ Shipped |
| PREVIEW-02 | Phase 38 | ✓ Shipped |
| PREVIEW-03 | Phase 38 | ✓ Shipped |
| PREVIEW-04 | Phase 38 | ✓ Shipped |
| PREVIEW-05 | Phase 38 | ✓ Shipped |
| ADAPT-01 | Phase 39 | ✓ Shipped |
| ADAPT-02 | Phase 39 | ✓ Shipped |
| ADAPT-03 | Phase 39 | ✓ Shipped |
| ADAPT-04 | Phase 39 | ✓ Shipped |
| EXEC-01 | Phase 39 | ✓ Shipped |
| EXEC-02 | Phase 39 | ✓ Shipped |
| EXEC-03 | Phase 39 | ✓ Shipped |
| VERIFY-01 | Phase 39 | ✓ Verified |
| VERIFY-02 | Phase 39 | ✓ Verified |
| VERIFY-03 | Phase 39 | ✓ Verified |

**Coverage:** 24/24 v1.7 requirements + 10/10 v1.8 requirements verified. All three waves (ADAPT/EXEC/VERIFY) complete.
