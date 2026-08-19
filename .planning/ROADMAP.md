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
- ✅ **v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation** — Phase 39 (shipped 2026-06-19)
- ✅ **v1.9 Canvas Sync Reliability** — Phases 40-41 (shipped 2026-06-24)
- ✅ **v2.0 Canvas Sync Permanence** — Phases 42-47 (shipped 2026-07-16)
- 🚧 **v2.1 候选资产配套 (candidate-asset-completeness)** — Phases 48-50 (current milestone)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (shipped)
- Integer phases (35-38): v1.7 (shipped)
- Integer phase (39): v1.8 (shipped)
- Integer phases (40-41): v1.9 (shipped)
- Integer phases (42-47): v2.0 (shipped)
- Integer phases (48-50): **v2.1 (this milestone — in progress)**
- Decimal phases (e.g., 48.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-41: v1.0 through v1.9 — collapsed</summary>

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

Skill contract published at `src/skills/contract.ts`; registry layer replaces hardcoded constants; canvas fetches node types dynamically; skill author guide + install-ready manifest shipped. 35/36 requirements satisfied (1 deferred — COMPLIANCE-03).

#### v1.7 Infinite Canvas Storyboard & Orchestration (Phases 35-38, shipped 2026-06-18)

Storyboard metadata (camera/framing/composition/pacing), one-click "🚀 一键成片" orchestrator, batch execution, Tier 2 storyboard preview placeholder. 24/24 requirements satisfied. Zero backend schema changes.

#### v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation (Phase 39, shipped 2026-06-19)

3 waves — ADAPT (merge feature/canvas-v2), EXEC (real gold-team engine wiring env-gated), VERIFY (33/33 contract assertions). Master exposes both `/api/canvas/*` and `/api/v2/canvas/*` routes. 10/10 requirements satisfied.

#### v1.9 Canvas Sync Reliability (Phases 40-41, shipped 2026-06-24)

Phase 40 joint-debug fixes + Phase 41 append-only event log (`kv_canvasEvent`) + monotonic reducer + idempotent write API + resumable WS subscription. Eliminates silent data-loss from concurrent writes. 12 SYNC-* requirements satisfied.

</details>

---

## ✅ v2.0 Canvas Sync Permanence (画布同步永久治理) — Shipped 2026-07-16

**Milestone Goal:** 永久根治 kais-movie-pipeline → 无限画布自动同步中"资产同步不全 / 结构化参数缺失 / 描述过简不体现文字资产"三联症。通过**源端契约 + 接收端契约 + E2E 回归 + 存量 backfill** 四道闸,让该问题不再回归。

**Architecture decisions (v2.0):**

1. **v2.0 major** — 跨仓库结构化契约变更,且是"永久治理"性质;比 minor 更重
2. **Phase 编号延续 v1.9** (Phase 42+)
3. **双仓库同步变更**,但通过 manifest 契约解耦——每侧可独立测试
4. **E2E 测试归位 kais-aigc-platform 仓库**,通过 docker-compose 跑一个真实 phase 验证画布节点齐全
5. **canvas_sync.py 精简不重写**——渐进式,删除明确 dead code,保留核心 `on_phase_complete` 路径
6. **Backfill 是一次性脚本**,不进入持续运行代码
7. **契约真值源** —— `src/lib/canvasAssetSchema.ts` (TS zod) 和 `pipeline/phases/_manifest.py` (Python `MANIFEST_PARAM_SCHEMA`) 平行声明,通过双端 contract test 守住字段集一致
8. **MANIFEST phase 先行** —— 它是所有其他 phase 的契约源头;SCHEMA + SYNCSIDE 都依赖它定义的字段集

### Phase 42: Source-side Manifest Contract Hardening

**Goal**: Every phase manifest writer (p01..p12) MUST emit complete structured params + meaningful (non-terse) descriptions, validated by an automated contract test suite. This is the contract all downstream phases depend on.
**Depends on**: Nothing (first v2.0 phase; defines the contract)
**Requirements**: MANIFEST-01, MANIFEST-02, MANIFEST-03, MANIFEST-04, MANIFEST-05
**Repo**: `kais-hermes-skills/skills/kais-movie-pipeline`
**Success Criteria** (what must be TRUE):

  1. `MANIFEST_PARAM_SCHEMA` in `_manifest.py` declares per-type required structured fields (asset requires archetype/role; storyboard requires shot_id/shot_type/duration_sec; video requires engine/resolution/duration_sec; etc.) — emitting a node missing a required field raises ValueError.
  2. `_validate_node_content` rejects nodes where description is < `MIN_DESCRIPTION_LEN` (20 chars) — "角色 A" or "场景 S01" no longer pass.
  3. Every phase `.txt` output (script.txt / prompt.txt / description.txt / scene_notes.txt) is either inlined as a node description OR has an explicit text-type node in the manifest; orphan .txt files cause a contract violation.
  4. New `tests/test_manifest_schema.py` exercises ≥1 golden manifest per phase (p01..p12) and fails loudly on schema drift; running it is part of pre-commit.
  5. `write_manifest` raises ValueError on any contract violation; no except: pass swallows the error.

**Plans**: 1 plan (Wave 1: manifest contract hardening across 7 sub-tasks; covers all 5 MANIFEST-XX requirements)

Plans:
**Wave 1**

- [x] 42-01-PLAN.md — Source-side manifest contract hardening (MIN_DESCRIPTION_LEN + validate_text_coverage + PHASE_REQUIRED_FIELDS + golden fixtures + pre-commit AST guard); covers MANIFEST-01..05

### Phase 43: canvas_sync.py Cleanup + Single-Path Mapping

**Goal**: Trim `plugins/kais_aigc/canvas_sync.py` from 3409 lines by removing dead code and legacy branches; establish a single testable path from `phase_result` → canvas node that transparently forwards all manifest `params.*`.
**Depends on**: Phase 42 (uses new manifest contract)
**Requirements**: SYNCSIDE-01, SYNCSIDE-02, SYNCSIDE-03
**Repo**: `kais-hermes-skills/plugins/kais_aigc`
**Success Criteria** (what must be TRUE):

  1. `canvas_sync.py` line count drops to ≤ 2500 (≥25% reduction) with explicit commit messages per removed block.
  2. Both `sync_phase_result()` standalone API and `CanvasSyncSubscriber.on_phase_complete()` share a single `_build_node_from_phase_result()` helper — no forked mapping logic.
  3. The mapping helper forwards every key from manifest `params.*` into the canvas POST `/api/v2/canvas/nodes` request body's `data` field (verified by assertion in unit test).
  4. Existing `tests/test_canvas_sync_injection.py` + `tests/test_canvas_auto_sync.py` continue to pass after cleanup.

**Plans**: 1 plan (Wave 1: _build_node_from_phase_result helper + params-forwarding contract + line-count best-effort; covers SYNCSIDE-01..03)

Plans:
**Wave 1**

- [x] 43-01-PLAN.md — canvas_sync single-path mapping (unified helper + 7-test params-forwarding contract; SYNCSIDE-01 SOFT-MISS documented — every helper has active callers); covers SYNCSIDE-02, SYNCSIDE-03 fully; SYNCSIDE-01 best-effort

### Phase 44: Receiving-side Schema Strictness + Import Validation

**Goal**: `kais-aigc-platform` receiving side declares a complete schema that mirrors the v2.0 manifest contract; `import-from-dir.ts` validates incoming manifests and warns on missing fields instead of silently dropping them.
**Depends on**: Phase 42 (mirrors field set declared there)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. `src/lib/canvasAssetSchema.ts` declares the full v2.0 field set (archetype/role/era/scene_id/shot_id/engine/duration_sec/resolution/murch_grade/...) as optional zod fields — forward-compatible but documented.
  2. `src/routes/canvas/v2/import-from-dir.ts` logs a warning with the missing field list when a manifest node lacks expected params, and stamps `data.__incomplete = true` so UI can flag it; the node is still created (no silent drop).
  3. `PATCH /nodes/batch` enforces the v2.0 schema field set (tightened from the 2026-07-12 quick-task baseline); invalid batches return 400 with the full error list.
  4. A new `scripts/verify-schema-roundtrip.ts` runs a sample manifest through import + schema validation and asserts every `params.*` key appears in `node.data`.

**Plans**: 3 plans (Wave 1: schema expansion; Wave 2: import stamping + flatten-helper extraction; Wave 3: roundtrip verifier)

Plans:
**Wave 1**

- [x] 44-01-PLAN.md — Schema expansion (YAML + 3 generated files + EXPECTED_PARAM_FIELDS_BY_TYPE); covers SCHEMA-01, SCHEMA-04

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 44-02-PLAN.md — Import stamping (__incomplete + __missing_fields + console.warn in import-from-dir.ts) + extract flattenParamsToNodeData helper; covers SCHEMA-02

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 44-03-PLAN.md — Roundtrip verifier (scripts/verify-schema-roundtrip.ts + fixture + npm script); imports production flattenParamsToNodeData for non-tautological SCHEMA-03; covers SCHEMA-03, re-verifies SCHEMA-01/02/04

### Phase 45: Text Asset Mapping + UI Completeness

**Goal**: Every phase text output (.txt file) has a home on the canvas with full description; the node detail panel never collapses to a bare label.
**Depends on**: Phase 42 + Phase 44
**Requirements**: TEXT-01, TEXT-02, TEXT-03 (Tier 2)
**Repo**: Both
**Success Criteria** (what must be TRUE):

  1. Phase `.txt` outputs (script.txt / prompt.txt / description.txt / scene_notes.txt) have a documented mapping: either inlined as the producing node's description OR surfaced as an explicit text-type node — no orphan text files in OSS.
  2. `NodeDetailPanel` (AssetDetail / ScriptDetail / StoryboardDetail / VideoDetail) shows full multi-line description with line breaks preserved; never renders an empty detail card when `data.prompt` / `data.description` / `data.tags` / `data.filename` are present in any combination.
  3. (Tier 2, optional) Toolbar exposes a "search description" filter that narrows visible nodes by substring match against `data.description` / `data.prompt`.

**Plans**: 3 plans (Wave 1: backend text mapping + UI panel completeness — parallel-safe; Wave 2: Tier 2 search filter + comprehensive verifier)

Plans:
**Wave 1**

- [x] 45-01-PLAN.md — Backend text-asset mapping (lift 500-char sidecar cap to 10K + add standalone-.txt probe for script phase dirs); covers TEXT-01
- [x] 45-02-PLAN.md — UI panel completeness (StoryboardDetail description + VideoDetail full set + ScriptDetail prompt fallback); covers TEXT-02

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 45-03-PLAN.md — Tier 2 toolbar search filter + scripts/verify-phase-45.ts comprehensive verifier; covers TEXT-03, re-verifies TEXT-01/02

### Phase 46: E2E + Cross-repo Contract Tests

**Goal**: Automated regression tests prevent the canvas-sync triad from ever returning — a phase-level manifest contract test (source), an import unit test (receiver), an end-to-end phase run (both), and a cross-repo schema drift check.
**Depends on**: Phase 42 + 43 + 44 + 45
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Repo**: Both
**Success Criteria** (what must be TRUE):

  1. `kais-hermes-skills/.../tests/test_manifest_schema.py` (from Phase 42) runs in CI and fails on any phase manifest contract violation.
  2. `kais-aigc-platform/scripts/verify-import-roundtrip.ts` asserts import-from-dir produces non-empty description + complete params.* round-trip on a sample manifest.
  3. `kais-aigc-platform/scripts/verify-phase-46-e2e.ts` spins up docker-compose, runs `p04_character_design` end-to-end, then queries `/api/v2/canvas/nodes` and asserts every node has `data.description.length >= 20` AND at least one structured param field from `{archetype, role, era}`.
  4. `scripts/verify-schema-drift.ts` reads `MANIFEST_PARAM_SCHEMA` from the sibling kais-hermes-skills repo and `canvasAssetSchema` from this repo, diffs the field sets, and fails if they diverge.

**Plans**: 2 plans (Wave 1: 3 safe-tier contract verify scripts parallel-safe; Wave 2: env-gated docker E2E — depends on Wave 1 contract shape)

Plans:
**Wave 1**

- [x] 46-01-PLAN.md — Safe-tier contract verify scripts (verify-manifest-contract.ts + verify-import-roundtrip.ts + verify-schema-drift.ts + master verify:phase-46-contracts); covers VERIFY-01, VERIFY-02, VERIFY-04

**Wave 2** *(blocked on Wave 1 completion; autonomous: false — manual E2E)*

- [x] 46-02-PLAN.md — Env-gated docker E2E (verify-phase-46-e2e.ts + p04-canvas-e2e-manifest.json fixture); covers VERIFY-03 (structure shipped; live assertion deferred to manual setup)

### Phase 47: Historical Backfill + Archival

**Goal**: Run the existing backfill script (schema-ui-backfill, 2026-07-12) to repair the 530 historical empty-shell asset nodes; verify P04/P07/P08 panels show real content; archive the script as a one-off.
**Depends on**: Phase 46 (new contract tests must pass before mutating historical data)
**Requirements**: BACKFILL-01, BACKFILL-02, BACKFILL-03
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. `python3 scripts/backfill-asset-descriptions.py --apply` runs successfully; post-run DB query confirms 530 asset nodes (those with `description == ""` in pre-run snapshot) now have non-empty description.
  2. Manual sampling of 10 nodes each from P04 (character design, 256 total) / P07 (scene generation, 134 total) / P08 (scene selection, 52 total) shows NodeDetailPanel renders meaningful description text — not just label.
  3. The backfill script is moved to `scripts/oneoffs/` (or annotated with a deprecation header) and excluded from any cron / startup hook — clearly marked as a one-shot repair, not recurring infrastructure.

**Plans**: 2 plans (Wave 1: apply — autonomous: false, mutates DB; Wave 2: archive + verify — depends on Wave 1 success)

Plans:
**Wave 1** *(autonomous: false — DB mutation, requires opt-in)*

- [x] 47-01-PLAN.md — Apply backfill (pre-flight contract gate + DB backup + dry-run baseline + `--apply` + post-run reduction verify); covers BACKFILL-01

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 47-02-PLAN.md — Archive script to scripts/oneoffs/ + deprecation header + README convention + Phase 47 verifier + manual sampling sign-off; covers BACKFILL-02 (deferred to operator), BACKFILL-03

---

## 🚧 v2.1 候选资产配套 (candidate-asset-completeness) — In Progress

**Milestone Goal:** 打通 kmc 冗余候选生成 ↔ kap 无限画布/资产管理中心的配套管道——kmc 产出的 N 候选在 kap 侧自动成组、选定状态双向同步、按 phase 可组织，消除"候选进画布变孤产、kmc 选定结果无人消费"的断裂。

### v2.1 Phases

- [x] **Phase 48: Ingest Candidate Grouping + Enum Unification + workflow_phase** — ingest 从平铺改建组：候选组 `assetsId`/`isPrimaryView`/`state` 落库契约 + assetType 单一真值源 + 新资产 `workflow_phase` 自动写入 (completed 2026-08-19)
- [ ] **Phase 49: Selection Write-back (Canvas Endpoint + Asset-Center Linkage + kmc Bridge)** — select-winner 后端端点 + 前端接线 + 资产中心联动 + kmc review resolve 桥接，打通"kap 换选 ↔ kmc 消费"闭环
- [ ] **Phase 50: Historical Backfill + Contract Guards** — 存量 368 条资产回填建组 + workflow_phase 回填 + 契约测试 + verify-phase-50 汇总守护

**Architecture decisions (v2.1):**

1. **Phase 编号延续 v2.0** (Phase 48+)
2. **kmc 侧零修改**——桥接只读消费 `assets/P11/iframe-manifest.json` (`variants`/`all_first_frames[]`/`all_last_frames[]`/`selected_first_variant`/`selected_last_variant`)、turnaround `*_v{N}` + canonical 无后缀命名、`.pipeline-assets/hook-candidates.json` (`chosen_variant_id`) + review 协议 `POST /api/v1/reviews`；仅当桥接必需才动 kmc
3. **ingest 建组是契约源头**——o_assets 分组形状 (`assetsId`/`isPrimaryView`/`state`) 先落定，选定回写 (Phase 49) 与存量回填 (Phase 50) 都依赖它
4. **assetType 单一真值源**——遵循 v1.6 "删除而非包装" 模式：消灭 `images.ts:18` 与 `assets-registry/index.ts:21` 两套词汇，提供存量值兼容映射
5. **选定回写走画布层后端端点**——对齐 `docs/canvas-review-integration.md` 方案B + `docs/canvas-next-steps.md:428-545` (Phase 3.2) 规划；前端 `canvasStore.selectWinner` 不再本地乐观 + save-v2 整体落盘
6. **Backfill 沿用 Phase 47 模式**——dry-run 基线 + `--apply` + DB 备份先行；一次性脚本归档，不进运行时代码；INGEST-04 与 PHASE-02 合流为同一回填脚本
7. **GUARD 收尾**——延续 v2.0 verify-phase-N 传统，契约测试最后落地守全 milestone 行为 + 双端枚举/词汇映射无 drift

### Phase 48: Ingest Candidate Grouping + Enum Unification + workflow_phase

**Goal**: kmc 产出的候选经 kap ingest 落库后自动成组——每组恰好一个 primary (`isPrimaryView=true`)、其余候选带正确 `state`、assetType 词汇全站统一、`workflow_phase` 非空。这是选定回写与存量回填共同依赖的 o_assets 分组契约源头。
**Depends on**: Nothing (first v2.1 phase; defines the o_assets candidate-group shape)
**Requirements**: INGEST-01, INGEST-02, INGEST-03, PHASE-01
**Repo**: `kais-aigc-platform` (read-only consumption of kmc manifest conventions)
**Success Criteria** (what must be TRUE):

  1. Ingest a fixture manifest containing `all_first_frames[]`/`all_last_frames[]` (canonical no-suffix + `*_v{N}` turnaround variants): candidates land in `o_assets` sharing one `assetsId` pointing at the primary asset — the flat orphan insert at `src/routes/v1/pipeline/ingest/images.ts:29-54` no longer produces ungrouped rows.
  2. The candidate named by `selected_first_variant`/`selected_last_variant` lands with `isPrimaryView=true`; every other group member lands `isPrimaryView=false, state='active'`; exactly one primary per group — verifiable by a DB query over the ingested batch.
  3. `src/routes/v1/pipeline/ingest/images.ts` and `src/routes/v1/assets-registry/index.ts` consume a single assetType truth source; assets ingested with the new vocabulary are filterable via the assets-registry API, and rows holding legacy vocabulary values are still queryable through the compatibility mapping — the two-vocabulary split is gone.
  4. Assets from a new ingest run carry `workflow_phase` derived from the kmc manifest path `p{NN}`/DAG — a post-ingest query for `workflow_phase IS NULL` over that batch returns 0 rows.

**Plans**: 2 plans (Wave 1: contract layer — truth source + pure grouping functions + fixture + verify Part 1; Wave 2: wiring — ingestImagesPayload service + images.ts route rewrite + registry read-side compat + verify Part 2 temp-DB behavior)

Plans:
**Wave 1**

- [x] 48-01-PLAN.md — Contract layer (src/lib/assetTypes.ts 真值源 + src/lib/candidateGrouping.ts 纯建组函数 + kmc fixture + verify-phase-48 Part 1); covers INGEST-01/02/03 + PHASE-01 contracts

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 48-02-PLAN.md — Wiring (ingestAssets.ts 事务化建组落库 + images.ts 薄路由重写 + assets-registry 读侧旧词兼容 + verify-phase-48 Part 2 temp-sqlite 行为断言); wires INGEST-01/02/03 + PHASE-01 end-to-end

### Phase 49: Selection Write-back (Canvas Endpoint + Asset-Center Linkage + kmc Bridge)

**Goal**: 用户在画布或资产中心换选 winner 后，选定状态事务化持久化到后端（不再前端本地乐观），并经 review resolve (`chosen_variant_id`) 回写 kmc、被其 30s 轮询消费，影响下一次 p11b 渲染选帧——"kap 换选 ↔ kmc 消费"闭环打通。
**Depends on**: Phase 48 (selection operates on the candidate-group shape + `isPrimaryView` semantics defined there)
**Requirements**: SELECT-01, SELECT-02, SELECT-03, SELECT-04
**Repo**: `kais-aigc-platform` (bridge calls kmc review-platform API `POST /api/v1/reviews`; no kmc code changes)
**Success Criteria** (what must be TRUE):

  1. Calling the new canvas-level select-winner endpoint persists `canvas_variant_groups.winner_node_id` + the group's `is_winner`/curation node states in one transaction; after a fresh canvas load (`load-v2`), the winner state is still there — selection no longer lives only in frontend memory or a whole-graph `save-v2` flush.
  2. Frontend `canvasStore.selectWinner` (`packages/infinite-canvas/src/store/canvasStore.ts:524-571`) calls the backend endpoint; when the endpoint fails, the UI rolls back to the `variantOps` prevSnapshot — no "UI shows a new winner but the DB never wrote it" divergence.
  3. Changing selection in the asset center (`handleSelect` → `o_assets.isPrimaryView`) updates the corresponding canvas variant group's winner state, and vice versa — after either side changes selection, the other side shows the same winner on refresh.
  4. A kap-side selection change emits a review resolve carrying `chosen_variant_id` to the review-platform API; kmc's 30s poll picks it up — the next p11b render selects frames per the new winner.

**Plans**: TBD
**UI hint**: yes

### Phase 50: Historical Backfill + Contract Guards

**Goal**: 存量 368 条 o_assets 获得与新增资产相同的组织性（候选建组 + `workflow_phase` 非空），且 v2.1 全部行为由自动化契约测试守住——候选分组形状、选定回写链路、双端枚举映射不再回归。
**Depends on**: Phase 48 + Phase 49 (backfill reuses the ingest grouping logic; guards assert both phases' behaviors)
**Requirements**: INGEST-04, PHASE-02, GUARD-01, GUARD-02
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. The backfill script (INGEST-04 + PHASE-02 合流为一) runs dry-run first with a baseline report (groups to create / workflow_phase values to write), takes a DB backup before `--apply`, and is idempotent — a second `--apply` run changes 0 rows (Phase 47 backfill pattern).
  2. After `--apply`, `SELECT count(*) FROM o_assets WHERE workflow_phase IS NULL` drops significantly from the 368-all-empty baseline — remaining NULLs are only rows whose source cannot be derived from manifest/DAG/directory conventions; sampled p04/p07 assets carry the correct phase value.
  3. The candidate-grouping contract test ingests a fixture manifest and asserts the resulting o_assets shape — group count, exactly one `isPrimaryView=true` per group, `state` value domain, `assetsId` self-consistency (every group member points at a primary that exists in the group) — violations fail the suite.
  4. `scripts/verify-phase-50.ts` aggregates assertions over INGEST/SELECT/PHASE behaviors + dual-side enum/vocabulary mapping (no drift between ingest and assets-registry), registered in package.json following the v2.0 verify tradition.

**Plans**: TBD

## Progress

**v2.1 Execution Order (planned):**

```
48 (ingest grouping contract) ──► 49 (selection write-back loop) ──► 50 (backfill + guards)
```

Phase 48 is the contract source — the o_assets candidate-group shape that everything downstream consumes. Phase 49 closes the selection loop on top of it. Phase 50 backfills history (needs 48's grouping logic settled) and locks the whole milestone behind contract tests (asserts 48 + 49 behaviors).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 48. Ingest Candidate Grouping + Enum Unification + workflow_phase | v2.1 | 2/2 | Complete    | 2026-08-19 |
| 49. Selection Write-back (Canvas Endpoint + Asset-Center Linkage + kmc Bridge) | v2.1 | 0/? | Not started | - |
| 50. Historical Backfill + Contract Guards | v2.1 | 0/? | Not started | - |

**v2.0 (shipped 2026-07-16):**

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 42. Source-side Manifest Contract Hardening | v2.0 | 1/1 | Complete | 2026-07-15 |
| 43. canvas_sync.py Cleanup + Single-Path Mapping | v2.0 | 1/1 | Complete | 2026-07-15 |
| 44. Receiving-side Schema Strictness + Import Validation | v2.0 | 3/3 | Complete | 2026-07-16 |
| 45. Text Asset Mapping + UI Completeness | v2.0 | 3/3 | Complete | 2026-07-16 |
| 46. E2E + Cross-repo Contract Tests | v2.0 | 2/2 | Complete | 2026-07-16 |
| 47. Historical Backfill + Archival | v2.0 | 2/2 | Complete | 2026-07-16 |

### Completed Milestones

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 42-47 | v2.0 Canvas Sync Permanence | ✅ Complete | 2026-07-16 |
| 28-34 | v1.6 Workflow Skill Contract | ✅ Complete (1 deferred sign-off) | 2026-06-15 |
| 23-27 | v1.5 Architecture Hardening + Code Hygiene | ✅ Complete | 2026-06-14 |
| 20-22 | v1.4 Production Verification + Repo Governance | ✅ Partial Complete | 2026-06-13 |
| 15-19.1 | v1.3 Architecture Alignment | ✅ Complete | 2026-06-13 |
| 11-14 | v1.2 Integration Testing | ✅ Complete | 2026-06-07 |
| 7-10 | v1.1 Hermes Decision Engine | ✅ Complete | 2026-06-06 |
| 1-6 | v1.0 MVP | ✅ Complete | - |
| 35-38 | v1.7 Infinite Canvas Storyboard & Orchestration | ✅ Complete | 2026-06-18 |
| 39 | v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation | ✅ Complete | 2026-06-19 |
| 40-41 | v1.9 Canvas Sync Reliability | ✅ Complete | 2026-06-24 |
