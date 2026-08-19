# Phase 50: Historical Backfill + Contract Guards - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Source:** Orchestrator express path (双侧调查 + Phase 48/49 交付事实 2026-08-19)

<domain>
## Phase Boundary

存量数据修复 + 契约守护：①把已平铺的存量 o_assets 回填成候选组（`assetsId` 指向 primary + `isPrimaryView` 置位）+ 回填 `workflow_phase`（合流为一个幂等脚本，dry-run + `--apply` + DB 备份，Phase 47 模式）；②GUARD-01 契约测试固化 Phase 48 的 ingest 分组形状；③GUARD-02 `verify-phase-50` 汇总脚本断言全 milestone 行为 + 双端词汇映射无 drift。不改 ingest 在线路径（Phase 48 已交付）、不改 select-winner 链路（Phase 49 已交付）。

</domain>

<decisions>
## Implementation Decisions

### 回填脚本 (INGEST-04 + PHASE-02 合流)
- [LOCKED] D-01: 单一一次性脚本 `scripts/backfill-candidate-groups.ts`（tsx 运行，注册 `npm run backfill:phase-50`），**不进运行时代码**；完成后按 Phase 47 惯例加 deprecation 头注释归档语义（留在 scripts/ 即可，加 ONE-OFF 标注）
- [LOCKED] D-02: 流程 = `--dry-run`（默认）打印基线报告（当前分组状况 + 计划变更数 + NULL workflow_phase 计数）→ 手动 DB 备份提示（打印 `cp data/db2.sqlite` 命令并要求 `--i-backed-up-db` 旗标才允许 `--apply`，与 Phase 47 一致）→ `--apply` 幂等执行（第二跑 0 行变更）
- [LOCKED] D-03: 建组逻辑**复用 Phase 48 契约层**——`src/lib/candidateGrouping.ts` 的 `planGroups`/`parseVariantName`/`deriveWorkflowPhase` 纯函数按存量资产文件名/路径重算分组；**不复制粘贴逻辑**。落库复用 `src/lib/ingestAssets.ts` 暴露的可复用入口或其内部事务模式（48-02 SUMMARY 明示 backfill 是其复用方）；若直接复用不fit（存量行已存在、不能重 insert），则做 UPDATE 型变体（UPDATE assetsId/isPrimaryView/state/workflow_phase），仍导入同一套纯函数做决策
- [LOCKED] D-04: workflow_phase 数据源优先级：存量行 `meta` 内已有 phase 信息 > 文件路径 `p{NN}`/`P{NN}` 段推导 > kmc manifest/DAG 对应（episode 资产目录约定）> 推导不出保持 NULL（与 D-08 在线语义一致，报告里单列）
- [LOCKED] D-05: **绝不改 `state='eliminated'` 的行**（人工淘汰是历史决策，回填只处理 active/archived）；组内 primary 唯一性冲突（多个 isPrimaryView=1 或全 0）按 candidateGrouping 的 primary 解析规则收敛，dry-run 报告列出每处收敛决策
- [LOCKED] D-06: 生产 DB = `data/db2.sqlite`；脚本 db 句柄自建（不 import @/utils 单例）；先 `SELECT COUNT(*)` 打印规模再动手

### 契约测试 (GUARD-01)
- [LOCKED] D-07: 把 Phase 48 verify 的 fixture 回归形式化为 `scripts/verify-phase-50.ts` 内的契约测试组：`scripts/fixtures/phase48-p11-manifest.fixture.json` 经 `candidateGrouping.planGroups` → 断言组数/组内 isPrimaryView 唯一/state 值域/assetsId 自洽（指回组内 primary）；GUARD-01 验收即此测试组存在且绿
- [LOCKED] D-08: 双端词汇映射断言：`assetTypes.ts` 的 canonical 集合 == assets-registry `CANONICAL_ASSET_TYPES` 引用同一真值源（import 比对，非字面量复制），legacy 别名 `role→character`/`tool→prop` 双向查表无孤儿

### 汇总守护 (GUARD-02)
- [LOCKED] D-09: `verify-phase-50.ts` 汇总断言：①GUARD-01 契约组 ②回填幂等性（对 :memory: 种子库跑两遍 `--apply`，第二遍 0 变更）③词汇无 drift ④Phase 48/49 三个 gate 的关键不变量 spot 断言（恰一 primary / winner 回写链路文件存在性）——**不重复跑** verify:phase-48/49 全量（引用式断言防重复维护）
- [LOCKED] D-10: 注册 `npm run verify:phase-50`；verify 输出沿用 PASS/FAIL 行 + 汇总 + exit code 惯例

### 边界
- [LOCKED] D-11: 不动 kmc 仓库；不动 review-platform；SC-4 消费侧半环债务**不在本 phase 解决**（已在 49-HUMAN-UAT 登记），但 GUARD-02 的报告输出要提示该债务存在（一行 warn 即可，不做断言）
- [LOCKED] D-12: 手工注册脚本 `scripts/canvas/register_turnaround_b2.py` 等加 deprecation 头注释（指向新链路），**不删除**（历史证据）

### Claude's Discretion
- dry-run 报告格式（表格/分组计数）
- 回填的批量 UPDATE 粒度与事务大小

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 48/49 交付物（复用对象）
- `src/lib/candidateGrouping.ts` — planGroups/parseVariantName/deriveWorkflowPhase 纯函数（含 shot-dir 消歧 cd9d0379 + parentDir/stem 键 6e7a6743）
- `src/lib/ingestAssets.ts` — ingestImagesPayload(db, payload) 事务模式（48-02 SUMMARY: backfill 是声明的复用方）
- `src/lib/assetTypes.ts` — CANONICAL_ASSET_TYPES/normalizeAssetType/expandTypesForQuery
- `scripts/fixtures/phase48-p11-manifest.fixture.json` — GUARD-01 用 fixture
- `scripts/verify-phase-48.ts` / `verify-phase-49.ts` / `-bridge` / `-linkage` — 既有 gate 惯例与 Part-2 marker 模式
- `.planning/phases/48-*/48-02-SUMMARY.md` + `.planning/phases/49-*/49-0*-SUMMARY.md` — 前序交付事实

### Phase 47 backfill 模式（流程范本）
- `scripts/oneoffs/` 目录 + Phase 47 的 dry-run/--apply/--i-backed-up-db/DB 备份模式（`.planning/milestones/` 下 47 归档或 git log 找 `47-01` backfill 脚本——执行者用 `git log --oneline --grep="47-01"` 定位范本）

### 存量数据事实（基线）
- `data/db2.sqlite` 生产库；`.task-pipeline-asset-gap-analysis.md`（packages/infinite-canvas/ 下）: workflow_phase 368/368 空、8 角色×3 版本、27 场景×3、44 镜×3、eliminated 59 条、`/project/:id` 只返回 assetsId IS NULL 行
- kmc 存量资产目录：`/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes/ep-*/assets/`（P11 iframe-manifest.json + turnaround_sheets/ + voice_clips/）

</canonical_refs>

<specifics>
## Specific Ideas

- 回填 UPDATE 不得触发 o_asset_history 快照膨胀（该表无人写也无人读——死代码，但保险起见不动它）
- eliminated 59 条是资产中心人工淘汰的历史决策（gap-analysis :65-69）——D-05 的红线来源
- Phase 48 在线路径已保证新 ingest 不再产生孤产；本 phase 只修历史存量
- dry-run 基线数字（分组前后对比）写进 50-SUMMARY，作为 milestone 收口的量化证据

</specifics>

<deferred>
## Deferred Ideas

- SC-4 kmc 消费侧半环对齐（review-platform 加字段/词汇）→ 跨仓库债务，后续里程碑
- `o_assets.version` 列 / provenance `input_refs` → 未排期
- `POST create-variants` 批量生成端点 → 未排期

</deferred>

---

*Phase: 50-historical-backfill-contract-guards*
*Context gathered: 2026-08-19 via orchestrator express path*
