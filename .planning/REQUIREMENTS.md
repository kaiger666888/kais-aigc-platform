# Requirements: KAIS AIGC Platform

**Defined:** 2026-06-17 (v1.7) · extended 2026-06-19 (v1.8) · extended 2026-06-22 (v1.9) · **extended 2026-07-15 (v2.0)**
**Core Value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows (movie / podcast / ads / interactive) via a published skill contract.

## v2.0 Requirements — Canvas Sync Permanence (画布同步永久治理)

**Motivation:** Field symptom — kais-movie-pipeline 创作时, 无限画布自动同步出现 "资产同步不全 / 内部结构化参数缺失 / 描述过简不体现文字资产" 三联症。v1.9 解决了写路径 (event sourcing); 2026-07-12 的 `schema-ui-backfill` quick task 修了接收端的 import/schema/UI fallback, 但源端 (`kais-hermes-skills/skills/kais-movie-pipeline`) 仍然只硬性要求 prompt OR description, 不要求结构化字段完整 round-trip。v2.0 通过**源端契约 + 接收端契约 + E2E 回归 + 存量 backfill** 四道闸, 让该问题永久不回归。

**Cross-repo scope:**
- 源端: `kais-hermes-skills/skills/kais-movie-pipeline` (manifest writer + canvas_sync.py)
- 接收端: `kais-aigc-platform` (canvasAssetSchema + import-from-dir + UI)

### MANIFEST — 源端契约硬化 (kais-hermes-skills)

- [ ] **MANIFEST-01**: `_manifest.py` 的 `MANIFEST_PARAM_SCHEMA` 扩展覆盖所有结构化字段 (按 phase 类型声明: archetype/role/era/scene_id/shot_id/engine/duration_sec/resolution/murch_grade/...); 未声明字段 forward-tolerated 但显式字段缺失则 fail
- [ ] **MANIFEST-02**: 每个 phase (p01..p12) 必须通过 manifest schema contract test; 新增 `tests/test_manifest_schema.py` 覆盖每 phase 至少 1 个 golden manifest
- [ ] **MANIFEST-03**: `_validate_node_content` 强化 — 不仅要求 prompt OR description 存在, 还要求非空内容长度 >= `MIN_DESCRIPTION_LEN` (建议 20 字符), 拒绝 "角色 A" / "场景 S01" 这种过简兜底
- [ ] **MANIFEST-04**: 所有 phase `.txt` 输出 (script.txt / prompt.txt / description.txt / etc.) 必须在 manifest 中有对应 description 引用 OR 独立 text 节点 (不允许只产生 .txt 文件而无 manifest 节点)
- [ ] **MANIFEST-05**: `write_manifest` 失败时 phase 必须抛 ValueError 终止, 不允许 except: pass 静默继续

### SYNCSIDE — canvas_sync.py 精简 (kais-hermes-skills)

- [ ] **SYNCSIDE-01**: `canvas_sync.py` (3409 行) 删除明确 dead code / legacy 路径, 显著瘦身 (目标 ≤ 2500 行)
- [ ] **SYNCSIDE-02**: `phase_result → canvas node` 映射必须是单一可测路径 (无 fork); 老的 `sync_phase_result` standalone API 与 `CanvasSyncSubscriber.on_phase_complete` 共享同一 build_node 函数
- [ ] **SYNCSIDE-03**: `on_phase_complete` 从 manifest `params.*` 读取所有结构化字段并透传到 canvas POST `/api/v2/canvas/nodes` 请求的 `data` 字段 (不可只挑白名单)

### SCHEMA — 接收端契约硬化 (kais-aigc-platform)

- [ ] **SCHEMA-01**: `src/lib/canvasAssetSchema.ts` 扩展声明完整字段集 (与 MANIFEST-01 对齐); 包括 archetype/role/era/scene_id/shot_id/engine/duration_sec/resolution/murch_grade 等
- [ ] **SCHEMA-02**: `src/routes/canvas/v2/import-from-dir.ts` 校验 manifest 字段完整性 — 缺失字段产生 logger.warn 并标记节点 `data.__incomplete = true`, 不静默丢弃
- [ ] **SCHEMA-03**: 所有 manifest `params.*` 必须 round-trip 到 canvas `node.data` (自动化测试守); 不允许中途字段被吃掉
- [ ] **SCHEMA-04**: `PATCH /nodes/batch` 完整 schema 校验 (2026-07-12 已部分完成, v2.0 收紧字段集与 MANIFEST-01 一致)

### TEXT — 文字资产完整映射 (双端)

- [ ] **TEXT-01**: phase `.txt` 输出 (script.txt / prompt.txt / description.txt / scene_notes.txt) 必须有显式映射策略: 内联为节点 description OR 产生独立 text 节点; 不允许文件存在于 OSS 但画布无对应节点
- [ ] **TEXT-02**: 节点详情面板 (NodeDetailPanel AssetDetail/ScriptDetail) 显示完整 description 文本, 不可仅 label; 多行文本保留换行
- [ ] **TEXT-03** (Tier 2, 可选): 文字资产 search/filter — toolbar 增加按 description 关键字过滤节点的能力

### VERIFY — 端到端回归 (双端)

- [ ] **VERIFY-01**: 源端 manifest contract test 套件 (kais-hermes-skills 侧 `tests/test_manifest_schema.py`) — 每个 phase 至少 1 个 golden case, schema 违反必须 fail
- [ ] **VERIFY-02**: 接收端 import-from-dir 单元测试 (kais-aigc-platform 侧) — 对 sample manifest 产出非空 description + 完整 params.* round-trip
- [ ] **VERIFY-03**: E2E: 跑一个完整 phase (建议 p04_character_design, 已知历史问题最多), 启动 docker-compose, 通过 canvas API 断言画布节点齐全 (有 prompt OR description 长度 >= 20 + 关键 params.* 字段非空)
- [ ] **VERIFY-04**: 跨仓库 contract test — manifest schema (Python) ↔ canvasAssetSchema (TypeScript) 字段集等价性守 (防 drift); 建议落在 kais-aigc-platform 的 verify-phase-N.ts 中读 sibling repo 的 schema 并 diff

### BACKFILL — 存量修复 (一次性)

- [ ] **BACKFILL-01**: 执行 `python3 scripts/backfill-asset-descriptions.py --apply` 修复现存 530 个空壳 asset 节点
- [ ] **BACKFILL-02**: 抽样验证 P04 (256 节点) / P07 (134 节点) / P08 (52 节点) 详情面板有内容 (非空 description)
- [ ] **BACKFILL-03**: backfill 脚本归档至 `scripts/oneoffs/` 或加 deprecation 注释, 不进入持续运行代码

---

## v1.9 Requirements — Canvas Sync Reliability

**Motivation:** Field symptom — kais-movie-agent 节点生成物 / 审核状态经常无法同步到无限画布。Root cause: fire-and-forget + read-modify-write + whole-graph-overwrite on `o_agentWorkData.canvasGraph` loses data silently on concurrent writes; no replay on WS reconnect; no idempotency on receiver. Phase 41 replaces the write model with an append-only event log + monotonic reducer + resumable subscription.

### SYNC — Write Path (Phase 41 Wave 1)

- [x] **SYNC-01**: New table `kv_canvasEvent(eventId PK autoincrement, projectId, episodesId, clientId, type, nodeId, payload JSON, source, createdAt)` with `UNIQUE(projectId, episodesId, clientId)` and index on `(projectId, episodesId, eventId)`.
- [x] **SYNC-02**: `POST /api/v2/canvas/events` accepts `{projectId, episodesId, clientId, events[]}` and appends atomically in a transaction. Duplicate `clientId` returns previously-assigned `eventId`s with `duplicated: true`, writes nothing.
- [x] **SYNC-03**: Pure reducer `reduce(state, event): state` covers `node_upsert` / `node_delete` / `link_upsert` / `link_delete` / `branch_upsert` / `variant_group_upsert` / `review_status` / `bootstrap`. Deterministic given identical event sequence.
- [x] **SYNC-04**: `o_agentWorkData.canvasGraph` snapshot recomputed from event log after every successful append (debounced per project+episode, flushed before any read returns).
- [x] **SYNC-05**: Idempotent bootstrap — if `o_agentWorkData.canvasGraph` exists but `kv_canvasEvent` is empty for that (project, episode), a one-time synthetic `bootstrap` event captures the current graph.

### REPLAY — Read Path (Phase 41 Wave 3)

- [x] **SYNC-06**: `GET /api/v2/canvas/load-v2?since=<eventId>` — without `since` returns `{graph, lastEventId}`; with `since` returns `{events[], lastEventId}`.
- [x] **SYNC-07**: WS `/ws/projects` accepts `subscribe` handshake `{projectId, since?}`. Server replays all events after `since` to that socket, then continues live emission. Back-compat (no handshake) preserved.
- [x] **SYNC-08**: All canvas WS broadcasts carry `{eventId, type, payload, projectId, episodesId}` so clients can stamp high-water mark.

### COMPAT — Backwards Compatibility (Phase 41 Wave 2)

- [x] **SYNC-09**: Legacy routes `save-v2` / `nodes POST` / `nodes PATCH /batch` / `nodes PATCH /:id` / `nodes DELETE` / `links` / `branches` continue to work by translating writes to event appends with a generated `clientId`. Caller-visible behavior unchanged.
- [x] **SYNC-10**: Frontend `useCanvasSocket` gains optional `subscribe` + incremental handling behind `VITE_CANVAS_EVENT_REPLAY=1` (default OFF for v1.9 staged rollout). Existing listeners untouched.

### VERIFY — Static verification (Phase 41 Wave 3)

- [x] **SYNC-11**: `tsc --noEmit` (root) and `tsc -b` (packages/infinite-canvas) both pass with zero errors.
- [x] **SYNC-12**: `scripts/verify-phase-41.ts` covers: idempotent append (duplicate `clientId`); reducer determinism + merge parity with `Object.assign`; `load-v2?since=N` returns exactly N+1..last; bootstrap migration; legacy `save-v2` round-trip.

---

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

- [x] **VERIFY-01 (v1.8)**: Every method in `/data/workspace/kais-movie-agent/lib/canvas-client.js` maps to a valid master endpoint
- [x] **VERIFY-02 (v1.8)**: `tsc --noEmit` (root) passes after merge
- [x] **VERIFY-03 (v1.8)**: `tsc -b` (packages/infinite-canvas) passes after merge

---

## v1.7 Requirements — Infinite Canvas Storyboard & Orchestration

借鉴字节小云雀短剧 Agent 的 Tier 1 差异化能力,升级无限画布。本期纯前端 + 后端编排扩展,不涉及 LLM 集成或 schema 重构。

### STORYBOARD — 分镜元数据扩展 (Phase 35)

- [x] **STORYBOARD-01**: `StoryboardNodeData` 扩展字段 `cameraMovement`
- [x] **STORYBOARD-02**: `StoryboardNodeData` 扩展字段 `framing`
- [x] **STORYBOARD-03**: `StoryboardNodeData` 扩展字段 `composition`
- [x] **STORYBOARD-04**: `StoryboardNodeData` 扩展字段 `pacing`
- [x] **STORYBOARD-05**: `StoryboardNode` 渲染器展示元数据 chips
- [x] **STORYBOARD-06**: `NodeDetailPanel` 对 storyboard 节点提供四个枚举下拉编辑器
- [x] **STORYBOARD-07**: `flowDataMapper` 双向序列化保留新字段

### ORCHESTRATE — 一键成片编排器 (Phase 36)

- [x] **ORCHESTRATE-01**: 顶部 toolbar 新增 "🚀 一键成片" 按钮
- [x] **ORCHESTRATE-02**: 后端新增 `POST /api/canvas/orchestrate` 路由
- [x] **ORCHESTRATE-03**: 编排器按节点类型拓扑序触发执行
- [x] **ORCHESTRATE-04**: 编排器跳过 `state === 'success'` 的节点
- [x] **ORCHESTRATE-05**: WebSocket 推送 `orchestrate_progress` 事件
- [x] **ORCHESTRATE-06**: 顶部 toolbar 显示运行状态
- [x] **ORCHESTRATE-07**: 编排完成后 toast 提示

### BATCH — 批量执行 (Phase 37)

- [x] **BATCH-01**: 多选节点右键菜单显示 "批量执行 (N 个节点)"
- [x] **BATCH-02**: 批量执行复用 orchestrate endpoint
- [x] **BATCH-03**: 批量执行遵守节点级 skip 逻辑
- [x] **BATCH-04**: 同一 WebSocket 通道推送进度
- [x] **BATCH-05**: 单节点右键 "执行节点" 保留

### CANVAS-PREVIEW — 分镜预览卡片 (Phase 38, Tier 2)

- [x] **PREVIEW-01**: Storyboard 节点新增 "👁 预览构图" 按钮
- [x] **PREVIEW-02**: 后端新增 `POST /api/canvas/storyboard/preview`
- [x] **PREVIEW-03**: 预览图通过 WebSocket `preview_update` 推送
- [x] **PREVIEW-04**: 预览图存到 `o_storyboard.preview_path`
- [x] **PREVIEW-05**: 预览失败不阻塞主流程

---

## Future Requirements (deferred)

- **故事蓝图生成器** — Script 节点右键 "生成分镜",调用 LLM 拆解为多个 storyboard 节点;需 LLM 集成层 (推迟 v2.1+)
- **角色一致性管理** — 跨分镜/跨集的角色绑定 + 全剧集统一形象管理 (推迟 v2.1+)
- **批量多集生成** — 项目级批量执行 (推迟 v2.1+)
- **第二参考 skill** — v1.6 deferred,验证 skill contract 抽象的扩展性
- **Canvas UI for V8.6 13-step pipeline** — 推迟 v2.1+
- **dreamina CLI subprocess** 替换 gold-team proxy — V8.6 架构变迁,推迟 v2.1+
- **Multi-skill coexistence per project** (MULTI-01/02/03) — v1.6 deferred
- **Skill scaffolding CLI / hot-reload / offline validator** (AUTHOR-01/02/03) — v1.6 deferred
- **Custom node renderers over HTTP** (RENDER-01/02) — v1.6 deferred
- **Per-skill health tracking / auto-disable** (HEALTH-01/02/03) — v1.6 deferred

---

## Out of Scope

### v2.0 out of scope

- **重构 `canvas_sync.py` 为多个文件** — 本期只删 dead code,不做模块拆分 (跨仓库 PR 边界太大)
- **manifest schema 单一真值源** — Python `MANIFEST_PARAM_SCHEMA` 与 TypeScript `canvasAssetSchema` 仍然平行声明,通过 VERIFY-04 contract test 守 drift;统一真值源需要 schema codegen 工具链,推迟
- **CRDT 协作编辑** — 多用户实时协作属于 Figma 类产品形态,本期不做
- **文字资产版本化** — phase .txt 的历史版本管理属于 review-platform 范畴
- **canvas_sync.py → TypeScript 移植** — 跨语言重写,推迟 v2.1+
- **kais-movie-agent (DEPRECATED repo) 同步修复** — 已 DEPRECATED, 本期不动 (memory note: 实际活动 pipeline 是 kais-movie-pipeline)

### Inherited out of scope (from prior milestones)

- **多语言配音/语音翻译** — 不阻塞短剧核心流程
- **视频风格迁移 (V2V Style Transfer)** — 非必须
- **全自动剪辑** — 需要人工介入创作决策
- **移动端审批** — review-platform 范畴

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MANIFEST-01 | Phase 42 | Pending |
| MANIFEST-02 | Phase 42 | Pending |
| MANIFEST-03 | Phase 42 | Pending |
| MANIFEST-04 | Phase 42 | Pending |
| MANIFEST-05 | Phase 42 | Pending |
| SYNCSIDE-01 | Phase 43 | Pending |
| SYNCSIDE-02 | Phase 43 | Pending |
| SYNCSIDE-03 | Phase 43 | Pending |
| SCHEMA-01 | Phase 44 | Pending |
| SCHEMA-02 | Phase 44 | Pending |
| SCHEMA-03 | Phase 44 | Pending |
| SCHEMA-04 | Phase 44 | Pending |
| TEXT-01 | Phase 45 | Pending |
| TEXT-02 | Phase 45 | Pending |
| TEXT-03 | Phase 45 | Pending (Tier 2) |
| VERIFY-01 (v2.0) | Phase 46 | Pending |
| VERIFY-02 (v2.0) | Phase 46 | Pending |
| VERIFY-03 (v2.0) | Phase 46 | Pending |
| VERIFY-04 (v2.0) | Phase 46 | Pending |
| BACKFILL-01 | Phase 47 | Pending |
| BACKFILL-02 | Phase 47 | Pending |
| BACKFILL-03 | Phase 47 | Pending |

**Coverage:**
- v2.0 requirements: 22 total (21 committed + 1 Tier 2)
- Mapped to phases: 22
- Unmapped: 0 ✓

Prior milestone traceability:
- v1.9 SYNC-01..12: Phase 40 + 41 ✓ Shipped
- v1.8 ADAPT-01..04, EXEC-01..03, VERIFY-01..03: Phase 39 ✓ Shipped
- v1.7 STORYBOARD-01..07, ORCHESTRATE-01..07, BATCH-01..05, PREVIEW-01..05: Phases 35-38 ✓ Shipped

---
*Requirements defined: 2026-06-17 (v1.7)*
*Last updated: 2026-07-15 after v2.0 milestone requirements added*
