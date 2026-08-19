# Phase 48: Ingest Candidate Grouping + Enum Unification + workflow_phase - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Source:** Orchestrator express path (双侧代码调查 2026-08-19, 全部结论带 file:line 证据)

<domain>
## Phase Boundary

把 `pipeline/ingest/images` 从"每图独立平铺 insert"升级为"kmc 候选感知建组"：同组候选写 `o_assets.assetsId` 指向 primary、按 kmc 选定结果落 `isPrimaryView`、assetType 枚举收敛单一真值源、新资产自动写 `workflow_phase`。不改 assets-registry API 语义、不做存量回填（Phase 50）、不做画布选定端点（Phase 49）。

</domain>

<decisions>
## Implementation Decisions

### 候选组建模 (INGEST-01/02)
- [LOCKED] D-01: 分组**复用 o_assets 现有字段**（`assetsId` 指向 primary uuid + `isPrimaryView` + `state`），**不加新列**——资产中心 `AssetLibrary.tsx:475` 的 `candidateGroups` 已按 `getGroupKey` 消费这个形状，DB schema 零迁移
- [LOCKED] D-02: 组识别**双通道**：(a) kmc `iframe-manifest.json` 的 `all_first_frames[]`/`all_last_frames[]` + `selected_first_variant`/`selected_last_variant`（P11 条件帧，manifest 为准）；(b) 文件命名约定 `*_v{N}` 后缀 + canonical 无后缀版本（P04 turnaround 等，参考 `episodes/ep-shencongshenyuan-kmc01/assets/turnaround_sheets/base_turnaround_chengyu_v1..v3.png` + canonical 并存）
- [LOCKED] D-03: 优先级 = manifest 命中 > 命名约定推断 > 无分组（单资产维持现状，不抛错）
- [LOCKED] D-04: primary 唯一性由 ingest 批内保证：每组恰一个 `isPrimaryView=true`；manifest 有 `selected_*_variant` 用之，缺省回退 v1/canonical；其余候选 `isPrimaryView=false, state='active'`
- [LOCKED] D-05: `state` 写入只用 `active`（淘汰 `eliminated` 留给资产中心人工操作，ingest 不写 `archived`/`eliminated`）

### assetType 枚举统一 (INGEST-03)
- [LOCKED] D-06: 单一真值源新建 `src/lib/assetTypes.ts`（或并入现有 lib 惯例位置），词汇采用 **assets-registry 的 `character|scene|prop…`**（registry `index.ts:21` 已是主要消费方）；ingest 旧词 `role|scene|tool`（`images.ts:18`）读侧映射 `role→character`、`tool→prop`
- [LOCKED] D-07: 新写入全部 normalize 到新词汇；存量 DB 行**不 UPDATE**（Phase 50 回填脚本统一处理），registry 查询侧对旧词做兼容匹配

### workflow_phase 写入 (PHASE-01)
- [LOCKED] D-08: 从 ingest 上下文（payload phase 字段 / 源目录 `P{NN}` / kmc `oss/{project_id}/p{NN}/manifest.json` 路径模式）推导，写 `o_assets.workflow_phase`（列 v1.6 已存在，`initDB.ts:453`）；推导不出 → 允许 NULL 并 logger.warn（不猜）

### 边界
- [LOCKED] D-09: kmc 侧零修改——只读其文件约定；ingest 改动限定 `src/routes/v1/pipeline/ingest/*` + `src/lib/*` 共享模块
- [LOCKED] D-10: 手工注册脚本 `scripts/canvas/register_turnaround_b2.py` 等**本 phase 不删除**（Phase 50 守护后再退役），但新 ingest 路径必须能产出同等形状

### Claude's Discretion
- 组键函数的具体实现位置（lib 文件名/导出签名）
- ingest 路由内重构幅度（可抽 helper 到 lib 以便 Phase 50 回填脚本复用——**推荐**，回填与在线 ingest 共享同一建组函数）
- 测试放 `tests/` 还是 `scripts/verify-*` 惯例（repo 两种都有）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### kap 接收端（本 phase 主战场）
- `src/routes/v1/pipeline/ingest/images.ts` — 平铺 insert 点 `:29-54`；旧枚举 `:18`
- `src/routes/v1/assets-registry/index.ts` — 新枚举 `:21`；state enum `:185`；variants 端点 `:277`
- `src/lib/initDB.ts:447-478` — o_assets DDL（assetsId/isPrimaryView/state/workflow_phase 列定义）
- `packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx` — 三态定义 `:8-15`；candidateGroups `:475`；handleSelect `:782-800`（消费形状参照）
- `src/routes/canvas/v2/sync-assets.ts:95,194` — node state 推导 `selected/candidate` 与 `state='active'` 过滤（消费方，勿破坏）

### kmc 侧只读约定（跨仓库，勿改）
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/templates/gen_iframes.py:28-44` — P11 目录布局文档
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes/ep-shencongshenyuan-ep01/assets/P11/iframe-manifest.json` — 实测 manifest（entry 字段：`shot_id, variants, all_first_frames[], all_last_frames[], selected_first_variant, first_frame_path...`）
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes/ep-shencongshenyuan-kmc01/assets/turnaround_sheets/` — 命名约定实例（`base_turnaround_chengyu_v1..v3.png` + canonical）
- `scripts/canvas/register_turnaround_b2.py:5-11` — 现行手工三层写入（o_image + o_assets `isPrimaryView=0,state='active'` + canvas_nodes）——新路径要对齐的形状

### 规划/背景文档
- `packages/infinite-canvas/.task-pipeline-asset-gap-analysis.md` — workflow_phase 368/368 全空、9 步资产链覆盖度
- `.planning/REQUIREMENTS.md` v2.1 节 — INGEST-01..03, PHASE-01 验收定义

</canonical_refs>

<specifics>
## Specific Ideas

- kmc manifest entry 实测（iframe-manifest.json[0]）：`{shot_id:"s1.b0", iframe_mode, variants:3, first_frame_path, last_frame_path, all_first_frames:[...3 paths], all_last_frames:[...], selected_first_variant:<1-based int|null>, first_frame_prompt, ...}`——`selected_*_variant` 是 1-based 索引指向 `all_*_frames[selected-1]`
- kmc manifest 不变量：manifest 是磁盘状态纯函数（gen_iframes.py:41-44），**选定不改写 `first_frame_path`**——kap 侧必须用 `selected_*_variant` 显式解析，不能拿 `first_frame_path` 当选定
- turnaround 无 manifest，仅命名约定；canonical 无后缀文件与 character-assets.json 的 `turnaround_sheet` 指向一致
- 既有坑：`characterId` 为空时 `AssetLibrary` fallback `type:name` 分组错误（`.task-fix-three-issues.md:28-84`）——ingest 建组后 candidateGroups 改善但 characterId 仍应尽量写入

</specifics>

<deferred>
## Deferred Ideas

- 存量平铺资产回填建组 + workflow_phase 回填 → Phase 50 (INGEST-04, PHASE-02)
- 画布 select-winner 后端端点 / kmc chosen_variant_id 桥接 → Phase 49 (SELECT-*)
- `o_assets.version` 列 / provenance `input_refs` → 未排期（gap-analysis P2 建议）

</deferred>

---

*Phase: 48-ingest-candidate-grouping-enum-unification-workflow-phase*
*Context gathered: 2026-08-19 via orchestrator express path*
