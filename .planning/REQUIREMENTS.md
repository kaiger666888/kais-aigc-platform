# Requirements: KAIS AIGC Platform

**Defined:** 2026-06-17
**Core Value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows (movie / podcast / ads / interactive) via a published skill contract.

## v1.7 Requirements — Infinite Canvas Storyboard & Orchestration

借鉴字节小云雀短剧 Agent 的 Tier 1 差异化能力,升级无限画布。本期纯前端 + 后端编排扩展,不涉及 LLM 集成或 schema 重构。

每个 requirement 映射到 ROADMAP.md 中的 phase (Phase 35+)。Traceability 在 roadmap 创建时填充。

### STORYBOARD — 分镜元数据扩展 (Phase 35)

- [ ] **STORYBOARD-01**: `StoryboardNodeData` 扩展字段 `cameraMovement` (枚举: `static`/`zoom_in`/`zoom_out`/`pan_left`/`pan_right`/`tilt_up`/`tilt_down`/`dolly`/`tracking`)
- [ ] **STORYBOARD-02**: `StoryboardNodeData` 扩展字段 `framing` (枚举: `wide`/`medium`/`close_up`/`extreme_close_up`/`over_the_shoulder`/`aerial`)
- [ ] **STORYBOARD-03**: `StoryboardNodeData` 扩展字段 `composition` (枚举: `rule_of_thirds`/`centered`/`golden_ratio`/`symmetrical`/`leading_lines`)
- [ ] **STORYBOARD-04**: `StoryboardNodeData` 扩展字段 `pacing` (枚举: `slow`/`medium`/`fast`/`montage`)
- [ ] **STORYBOARD-05**: `StoryboardNode` 渲染器展示元数据 chips (运镜 / 景别 / 构图 / 节奏),空值不显示
- [ ] **STORYBOARD-06**: `NodeDetailPanel` 对 storyboard 节点提供四个枚举下拉编辑器,实时更新 store 并标记画布 dirty
- [ ] **STORYBOARD-07**: `flowDataMapper` 双向序列化保留新字段 (canvas ↔ FlowGraph);保存到 `o_storyboard.prompt_meta` JSON column 不破坏现有 prompt 字段

### ORCHESTRATE — 一键成片编排器 (Phase 36)

- [ ] **ORCHESTRATE-01**: 顶部 toolbar 新增 "🚀 一键成片" 按钮,仅当画布有 ≥1 节点时启用
- [ ] **ORCHESTRATE-02**: 后端新增 `POST /api/canvas/orchestrate` 路由,接收 `projectId`/`episodesId`,返回 `runId`
- [ ] **ORCHESTRATE-03**: 编排器按节点类型拓扑序触发执行 (script → asset → storyboard → video → audio),每节点走现有 `executeNode` 入口
- [ ] **ORCHESTRATE-04**: 编排器跳过 `state === 'success'` 或 `cached` 的节点,避免重复执行
- [ ] **ORCHESTRATE-05**: WebSocket 推送 `orchestrate_progress` 事件,前端显示全局进度条 (已完成 / 总数)
- [ ] **ORCHESTRATE-06**: 顶部 toolbar 显示运行状态 (idle / running / done / error);运行中禁用按钮,显示"运行中 (3/12)"
- [ ] **ORCHESTRATE-07**: 编排完成后 toast 提示 "一键成片完成 (12/12 节点成功)";失败节点列表附带在 toast 详情中

### BATCH — 批量执行 (Phase 37)

- [ ] **BATCH-01**: 多选节点 (Shift+click 已支持 `selectionOnDrag`),右键菜单显示 "批量执行 (N 个节点)"
- [ ] **BATCH-02**: 批量执行入口调用与 ORCHESTRATE 同一个后端 endpoint,但传入显式 nodeId 列表 (`POST /api/canvas/orchestrate { nodeIds: [...] }`)
- [ ] **BATCH-03**: 批量执行遵守节点级 `state === 'success'` 跳过逻辑
- [ ] **BATCH-04**: 批量执行通过同一 WebSocket 通道推送进度,UI 显示 "批量执行 (2/5)"
- [ ] **BATCH-05**: 单节点右键菜单 "执行节点" 保留作为单点入口,内部复用 orchestrate endpoint (传单个 nodeId)

### CANVAS-PREVIEW — 分镜预览卡片 (Phase 38, Tier 2 可选)

> 目标:借鉴小云雀的"分镜即预览"——生成视频前,基于元数据 + 关联角色资产生成静态构图预览图,降低失败成本。

- [ ] **PREVIEW-01**: Storyboard 节点新增 "👁 预览构图" 按钮 (仅当有 `linkedAssetIds` 且有 prompt 时启用)
- [ ] **PREVIEW-02**: 后端新增 `POST /api/canvas/storyboard/preview`,调用现有 IMAGE_DRAW 引擎生成分镜参考图 (单图,1280x720)
- [ ] **PREVIEW-03**: 预览图通过 WebSocket `preview_update` 推送,前端在 storyboard 节点缩略图位置展示
- [ ] **PREVIEW-04**: 预览图存到 `o_storyboard.preview_path`;`state === 'success'` 后保留作为视频生成前的回顾
- [ ] **PREVIEW-05**: 预览失败不阻塞主流程,仅 toast 提示

## Future Requirements (deferred)

- **故事蓝图生成器** — Script 节点右键 "生成分镜",调用 LLM 拆解为多个 storyboard 节点;需 LLM 集成层 (推迟 v1.8)
- **角色一致性管理** — 跨分镜/跨集的角色绑定 + 全剧集统一形象管理;需 `o_character_role` 表 + 一致性引擎 (推迟 v1.8)
- **批量多集生成** — 项目级批量执行(参考小云雀 80 集能力);需 queue + scheduler 协调 (推迟 v1.9)
- **第二参考 skill** — v1.6 deferred,验证 skill contract 抽象的扩展性

## Out of Scope (v1.7)

- **视频生成参数编辑器** — Wan2.2 等模型参数(seed/guidance_scale/steps)编辑属于引擎调参范畴,非画布职责
- **音频波形可视化** — 音频节点目前仅展示时长;完整波形是 audio-workstation 范畴
- **多语言配音/语音翻译** — v1.6 已声明 out-of-scope,延续
- **移动端审批** — review-platform 范畴,非画布
- **协作编辑 (CRDT)** — 多用户实时协作属于 Figma 类产品形态,本期不做

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STORYBOARD-01 | Phase 35 | Pending |
| STORYBOARD-02 | Phase 35 | Pending |
| STORYBOARD-03 | Phase 35 | Pending |
| STORYBOARD-04 | Phase 35 | Pending |
| STORYBOARD-05 | Phase 35 | Pending |
| STORYBOARD-06 | Phase 35 | Pending |
| STORYBOARD-07 | Phase 35 | Pending |
| ORCHESTRATE-01 | Phase 36 | Pending |
| ORCHESTRATE-02 | Phase 36 | Pending |
| ORCHESTRATE-03 | Phase 36 | Pending |
| ORCHESTRATE-04 | Phase 36 | Pending |
| ORCHESTRATE-05 | Phase 36 | Pending |
| ORCHESTRATE-06 | Phase 36 | Pending |
| ORCHESTRATE-07 | Phase 36 | Pending |
| BATCH-01 | Phase 37 | Pending |
| BATCH-02 | Phase 37 | Pending |
| BATCH-03 | Phase 37 | Pending |
| BATCH-04 | Phase 37 | Pending |
| BATCH-05 | Phase 37 | Pending |
| PREVIEW-01 | Phase 38 | Pending (Tier 2 optional) |
| PREVIEW-02 | Phase 38 | Pending (Tier 2 optional) |
| PREVIEW-03 | Phase 38 | Pending (Tier 2 optional) |
| PREVIEW-04 | Phase 38 | Pending (Tier 2 optional) |
| PREVIEW-05 | Phase 38 | Pending (Tier 2 optional) |

**Coverage:** 24/24 v1.7 requirements mapped. No orphans. No duplicates.
