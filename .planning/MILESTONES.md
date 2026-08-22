# Milestones

## v3.0 画布创作体验 / Canvas Creative Experience for kmc (Shipped: 2026-08-22)

**Status:** ✅ Archived
**Phases:** 51–57 (7 phases; 52 externally owned — code on master, verification owed by owning session, user-accepted 2026-08-22) | **Requirements:** 25/29 verified + 4 code-only (REGEN-01..04)
**Automated assertions:** verify:phase-53 92 · 54 57 · 55 14 · 56 94 · 57 48 — 305/305 全绿; canvas vitest 401/401; portal vitest 34/34; tsc 三根 clean; live 探针(10588/8090/gate-state 16 gates)ok

**Key accomplishments:**

1. **Gate 中心三仓闭环** — review-platform R1(决策持久化+waive 端点,已部署活体)+ khs R2/R3(COMPLETE 词汇+result 提取)+ kap(20s 轮询+gate-ops 409 幂等+chip/列发光/决策面板);SC1 活体对照表全绿。
2. **导航与规模** — 22-phase 单一注册表(三张旧表删,khs 三真相源契约门)+ SceneShotBrowser 两级浏览 + `/` SearchNavigator(隐藏式搜索永删)+ placeNewAsset 有界落点 + laneZoom 泳道记忆 + BranchPanel 乐观+REST+回滚;e2e 5/5×3。
3. **创作可视化** — scored 死信修复 + verdict 眼/耳角标 + hover mini-雷达 + 组视图剧场(2×2 同步缩放签名元素)+ G16 配音听审工作台(双轨+豁免桥 p10c-gate 白名单);94/94 契约门含 khs 词表零漂移。
4. **门户与交付** — Toonflow 替换评估结论(五维对比+混合路线)+ packages/portal 三路由壳 + KapNavbar 单源三宿主 + 交付页(master hero+管线带 full+G8 放行/驳回)+ taxonomy 22 重对齐(verify:phase-57 48/48)。
5. **并行会话协作零冲突** — COORD-01 纪律全程(具名文件 add;khs 只读;52 域避让);两波 API 故障经 SendMessage 续接零上下文损失。

**Stats:** Timeline: 2026-08-21..22 (single session, autonomous) · audit f9280e0c passed · carry-forward: Wave B(khs2 v2.4 gated)/UAT §7/TD-1..8

## v2.1 候选资产配套 / candidate-asset-completeness (Shipped: 2026-08-19)

**Status:** ✅ Archived
**Phases:** 48–50 (3 phases) | **Requirements:** 12/12 satisfied
**Automated assertions:** verify:phase-48 135 · 49 79 · 49-bridge 63 · 49-linkage 50 · 50 114 — 全绿; vitest 172/172; tsc 双根 clean

**Key accomplishments:**

1. **Ingest 候选建组契约源头** — `src/lib/candidateGrouping.ts` (manifest 双通道 + `*_v{N}` 命名通道 + shot-dir 消歧) + `src/lib/ingestAssets.ts` (db 参数化单事务 + 恰一 primary 断言) + `src/lib/assetTypes.ts` 枚举真值源 (role→character/tool→prop 存量兼容)。kmc 冗余生成的候选进 kap 不再平铺孤产。
2. **选定回写闭环** — `POST /api/canvas/v2/variant-groups/:id/select-winner` 事务化端点 + 前端 `canvasStore.selectWinner` 接后端 (双路径乐观/回滚, prevSnapshot) + 资产中心↔画布双向联动 (`canvasAssetLinkage`, `a-oasset-{id}` 映射) + review-platform approve 桥接 (fail-closed 三重过滤 + 有界分页 + never-throw)。
3. **生产存量回填** — 1612 行存量: 154 候选组建成 / 240 行挂链 / workflow_phase NULL 1456→922 / eliminated 386 行字节级未动 / 幂等 0/0。完整安全链 (dry-run 默认 → 371MB .backup 先行 → --i-backed-up-db 硬门 → 单事务 → 红线证明)。
4. **GUARD 契约守护** — verify:phase-50 五节汇总 (GUARD-01 fixture→planGroups→落库形状 / 回填幂等+红线 / 枚举无 drift / 48/49 关键不变量 spot / SC-4 债务 WARN), 手工注册脚本 5 个 DEPRECATED。
5. **Code-review 修复轮** — 48/49/50 三轮 review 共修 19 findings (含 2 组静默腐化 Critical), 每项带回归断言。

**Stats:**

- Timeline: 1 day (2026-08-19, single session)
- Git range: 3300db2d^..HEAD · 97 commits · 308 files (+16,119 / −34,078 — 删除主要为里程碑切换归档)
- Known deferred items at close: ① SC-4 kmc 消费侧半环 (review-platform 无 chosen_variant_id + COMPLETE≠resolved/closed, 跨仓库债务, [49-HUMAN-UAT G-1]) ② HUMAN-UAT 浏览器目检 4 项 (48/49 各 2) ③ WR-10 registry maxId+1 竞态 (pre-existing)

**Archive:**
- Roadmap: [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- Requirements: [milestones/v2.1-REQUIREMENTS.md](milestones/v2.1-REQUIREMENTS.md)
- Audit: [v2.1-MILESTONE-AUDIT.md](v2.1-MILESTONE-AUDIT.md)

---
## v1.6 Workflow Skill Contract (Shipped: 2026-06-15)

**Status:** ✅ Archived
**Phases:** 28–34 (7 phases) | **Requirements:** 35/36 satisfied (1 deferred — COMPLIANCE-03)
**Automated assertions:** 277 PASSED / 1 SKIPPED / 0 FAILED across 7 verify-phase scripts

**Key accomplishments:**

1. **Skill Manifest Contract published** — `src/skills/contract.ts` (SkillManifest TS interface + zod v4 validator) is the single source of truth for what a workflow skill must declare. Namespaced node type IDs (`<skill_id>::<type>`), descriptive-only manifest (no executable code), `major.minor` versioning rule.
2. **Persisted skill registry with zero-config boot** — `o_skillRegistry` table + in-memory `registry.ts` singleton + `loader.ts` boot hydration. Existing `o_assets` / `kv_pipelineRun` rows backfilled to `movie-v1`. Default seed on empty DB → no migration step required for upgrade.
3. **REST surface for the registry** — `GET/POST /api/v1/skills/*` (list / inspect / register / node-types / phases) lets any client (OpenClaw, curl, future skill) discover and install skills at runtime.
4. **Pipeline callbacks decoupled from movie-v1** — `phase-complete.ts`, `resume.ts`, `submit-to-review.ts` consult `registry.phaseById(skill_id, phase)` instead of the deleted `REVIEW_REQUIRED_PHASES` / `PHASE_INGEST_MAP` / `PHASE_ORDER` constants. Equivalence regression guard (`verify-phase-31.ts`) proves movie-v1 behavior is preserved bit-for-bit.
5. **Canvas renders any skill's node types** — `packages/infinite-canvas` fetches node types from `/api/v1/skills/:skillId/node-types`; unknown types fall back to `FallbackNode` instead of crashing. No more hardcoded movie-v1 node shape in the bundle.
6. **Skill author guide + install-ready manifest** — `docs/skill-author-guide.md` (field reference + deploy order + anti-features) and `docs/skill-author-guide/movie-v1.manifest.json` (install-ready artifact for OpenClaw workspaces).

**Stats:**

- Timeline: 1 day (2026-06-15, single session)
- Git range: 4dbbe19 → b91a382 · 73 files changed (+12,640 / −608 LOC)
- Known deferred items at close: 1 (Phase 33 COMPLIANCE-03 live Docker + GPU golden-path sign-off — environment-gated, not a code gap. See [STATE.md Deferred Items](STATE.md).)

**Archive:**

- Roadmap: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
- Requirements: [milestones/v1.6-REQUIREMENTS.md](milestones/v1.6-REQUIREMENTS.md)
- Audit: [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)

---

## v1.5 Architecture Hardening + Code Hygiene (Shipped: 2026-06-14)

**Status:** ✅ Archived
**Phases:** 23–27 | **Requirements:** 9/9 satisfied
**Status:** tech_debt — 0 blockers, 11 deferred items (all runtime verification or opportunistic migrations)

### Key Accomplishments

1. **GpuScheduler Redis backend** (Phase 23) — Introduced `StateStore` abstraction with memory + Redis implementations; cross-process GPU lock coordination via Lua atomic release; factory `getGpuSchedulerAsync()` with auto-fallback. 13/13 memory-path tests pass.
2. **gold-team ACE-Step retirement** (Phase 24) — Deleted `acestep.py` + `docker_polling.py` (395 lines) + 5 cleanup sites + 7 Dockerfile ENV vars. Music generation now exclusively via Node-layer ComfyUI routes.
3. **Unified output path convention** (Phase 25) — `src/lib/paths.ts` with typed `engineOutputDir()` + backwards-compatible legacy env var aliases. Migration guide at `docs/OUTPUT-PATH-CONVENTION.md`.
4. **TypeScript compile clean** (Phase 26) — Added 4 vendored project excludes to tsconfig.json. `yarn lint` errors: 12,447 → 0.
5. **router.ts auto-gen root-cause fix** (Phase 27) — `src/core.ts` SKIP_PATTERNS regex skips config/_shared files. router.ts routes: 248 → 236 (12 phantom routes removed). Fixed the bug that v1.4 commit 7a9393e tried to address manually.

### Stats

- Requirements: 9/9 satisfied (SCHED/GOLD/PATH/HERMES/CORE)
- Commits: 9 (`6ca8313..a117e42`)
- Tests: verify-phase-23.ts (13 assertions, memory path); Redis path coded & ready
- Audit: `v1.5-MILESTONE-AUDIT.md`

### Known Deferred Items at Close

11 items across 5 phases — documented in audit. Highlights:

- Live Redis integration test (Phase 23) — awaits `docker compose up redis`
- Live `docker compose build kais-gold-team` (Phase 24) — awaits Docker daemon
- 32 ComfyUI routes to migrate to paths.ts (Phase 25) — opportunistic
- Live `yarn dev` startup observation (Phase 27) — runtime test

### Archive

- Roadmap: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- Requirements: [milestones/v1.5-REQUIREMENTS.md](milestones/v1.5-REQUIREMENTS.md)
- Audit: [milestones/v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md)

---

## v1.4 Production Verification + Repo Governance (Shipped: 2026-06-13)

**Status:** ✅ Archived (partial)
**Phases:** 20-22

### Key Accomplishments

1. **Phase 20 (FIX):** ACEStepEngine backend_type classification fixed (MOCK → DOCKER); commit `1d5996a`
2. **Phase 21 (VERIFY):** 3/4 live runtime verifications closed; VERIFY-03 hardware-blocked (24GB GPU insufficient for ACE-Step XL inference)
3. **Phase 22 (REPO):** 19 sibling repos audited, movie-agent archived, REPO-MAP.md created

Mid-milestone acceleration: ACE route convergence (commits e3d649e, e817e18) closed v1.5 scope ahead of plan.

---

## v1.3 — Architecture Alignment: Engine Consolidation (Shipped: 2026-06-13)

**Status:** ✅ Archived
**Phases:** 15-19.1 | **Plans:** 16 | **Tests:** 102/102 passing

### Key Accomplishments

1. v6 代码合并(研发版 → 部署版,消除分叉)
2. 7 个 workflow builder 补全(flux_dev, flux_ipadapter, hunyuan3d, trellis, flux_trellis_full, lipsync, frame_interpolate)
3. BackendType 枚举分类(COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK)
4. movie-agent 完全清退(OpenClaw Agent 替代)
5. ACE-Step 权限修复

### Archive

- Audit: [v1.3-MILESTONE-AUDIT.md](v1.3-MILESTONE-AUDIT.md)

---

## v1.2 — Integration Testing: Hermes-Agent

**Shipped:** 2026-06-07
**Status:** ✅ Archived
**Phases:** 11–14 | **Plans:** 8

### Key Accomplishments

1. Built isolated test environment (docker-compose.test.yml) for hermes-agent integration testing
2. Created 14 integration test files with 42+ test cases covering all API endpoints
3. Validated hermes-client.js end-to-end chain with real LLM (decide/audit/degradation/retry)
4. Stress tested with concurrent requests (10 concurrent, 20 mixed) and 100-cycle stability loop
5. Set up GitHub Actions CI workflow for PR-triggered automated testing with reporting

### Stats

- Requirements: 22/22 satisfied (15 Must + 7 Should)
- Test cases: 42+ across 14 test files
- CI: GitHub Actions + local `make test-integration`

### Archive

- Roadmap: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)
- Audit: [v1.2-MILESTONE-AUDIT.md](v1.2-MILESTONE-AUDIT.md)

---

## v1.1 — Hermes Intelligent Decision Engine

**Shipped:** 2026-06-06
**Status:** ✅ Archived
**Phases:** 7–10 | **Plans:** 10

### Key Accomplishments

1. Built domain-agnostic REST API wrapper (decide/audit/register/health) around NousResearch/hermes-agent
2. Implemented EWMA-based self-learning loop (audit → memory → confidence adaptation)
3. Registered movie-pipeline as first domain with 14 expert skills and seed parameter memory
4. Adapted hermes-client.js with HERMES_DEFAULTS fallback; deployed as Docker container
5. Retired legacy hermes-worker-agent and kais-hermes services

### Stats

- Requirements: 21/21 satisfied
- Verification: All 4 phases passed
- Cross-phase integration: 5/5 flows verified
- E2E flows: 3/3 passing

### Archive

- Roadmap: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)
- Audit: [v1.1-MILESTONE-AUDIT.md](v1.1-MILESTONE-AUDIT.md)

---

_For current project status, see [ROADMAP.md](ROADMAP.md)_
