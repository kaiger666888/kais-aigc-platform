# Retrospective

## Milestone: v1.6 — Workflow Skill Contract

**Shipped:** 2026-06-15
**Phases:** 7 (28-34) | **Requirements:** 35/36 satisfied | **Automated assertions:** 277 PASSED / 1 SKIPPED / 0 FAILED

### What Was Built

- Skill Manifest contract: `src/skills/contract.ts` (TS interface) + `src/skills/validator.ts` (zod v4 schema) + `.planning/specs/SKILL-CONTRACT.md` (human-readable spec with drift test).
- Persisted skill registry: `o_skillRegistry` table + `registry.ts` singleton + `loader.ts` boot hydration. `o_assets` and `kv_pipelineRun` extended with `skill_id`; orphan rows backfilled to `movie-v1`.
- REST surface: `GET/POST /api/v1/skills/*` (5 endpoints — list / inspect / register / node-types / phases).
- Pipeline callback refactor: 3 callback files (`phase-complete.ts`, `resume.ts`, `submit-to-review.ts`) consult the registry. 3 hardcoded constants deleted. Equivalence regression guard proves movie-v1 behavior is preserved bit-for-bit.
- Canvas integration: `packages/infinite-canvas` fetches node types via API; `FallbackNode` renders unknown types.
- Compliance + docs: install-ready `movie-v1.manifest.json` + `docs/skill-author-guide.md` (field reference, deploy order, anti-features, annotated example).

### What Worked

- **Single-session execution**: 7 phases (28-34) shipped start-to-finish in one 12-hour session — same velocity pattern as v1.5. The `/gsd-*` pipeline keeps the cost of phase transitions low enough that the model can carry context across the whole milestone.
- **Verification-first phases (32/33/34)**: When the deliverable IS a verification script, skip the discuss→plan→execute→summary dance and let `verify-phase-*.ts` be the artifact. This cut ceremony without losing rigor — 23+39+22 = 84 assertions across 3 phases that would otherwise have needed plan/summary pairs.
- **Equivalence test as a deletion license**: PIPELINE-05 (the verify-phase-31.ts equivalence regression guard) was written *before* deleting `REVIEW_REQUIRED_PHASES` / `PHASE_INGEST_MAP` / `PHASE_ORDER`. The test passing became the green light to delete. Pattern worth reusing whenever replacing a constant with a lookup.
- **zod-as-source-of-truth**: Spec markdown is field-equality-tested against the zod schema, not hand-maintained. Zero drift across 4 phases of contract iteration.
- **Inline execution in main context**: Per user preference ([[feedback_skip_gsd_subagent_ceremony]]), plans were implemented inline rather than spawning `gsd-executor` subagents. Saved the subagent spin-up cost on every plan and let the model keep phase context warm.

### What Was Inefficient

- **Phase 33's verification-vs-UAT ambiguity**: The phase has a `VERIFICATION.md` (CI assertions, 23/24 PASSED) and no SUMMARY.md, then we ran UAT and the user chose "Skip — trust CI". The two layers measure different things (CI wiring vs human-observable behavior). Phase 33 could have made the boundary explicit up-front: "this phase has no UI/UX surface — UAT reduces to running the live-stack sign-off checklist or deferring."
- **STATE.md progress counters drift**: STATE.md still shows `completed_phases: 3` after milestone close because the counter is updated incrementally by `/gsd-*` skills but the milestone-close flow doesn't reconcile it. Not load-bearing — the manager dashboard reads disk state, not the counter — but it's noise for a human reading STATE.md.
- **Single-sign-off gap on COMPLIANCE-03**: The Phase 33 live-stack verification was deferred to "pre-production sign-off" without naming a human owner or a deployment gate. It's tracked in STATE.md Deferred Items, but there's no committed trigger for when it actually runs.

### Patterns Established

- **`verify-phase-N.ts` is the regression contract**: Each phase ships a standalone TS script under `scripts/` that asserts its success criteria. No jest/vitest — runner is `tsx`. Each script distinguishes PASSED / SKIPPED / FAILED explicitly (no silent skips). Pattern reused for all 7 v1.6 phases.
- **Equivalence test as deletion license** (see above) — formalized as "before deleting a constant the new path replaces, write the equivalence test first."
- **Descriptive-only manifest**: Manifests carry no executable code. Platform owns behavior. This is the explicit "we are not building a Web3-style smart-contract system" invariant — called out in `docs/skill-author-guide.md` anti-features.
- **Namespaced node IDs `<skill_id>::<type>`**: Validator rejects bare IDs at registration time. Prevents cross-skill node-type collisions when v1.7 ships a second skill.
- **Zero-config default seed**: `seedDefaultIfEmpty()` pattern — empty DB auto-seeds `movie-v1` on boot, no migration step required. Reduces upgrade friction for downstream workspaces.

### Key Lessons

- **Drift prevention > drift detection**: Field-equality testing the spec markdown against the zod schema caught zero drifts because there was nothing to catch — the test existing kept authors honest. Cheaper than a post-hoc audit.
- **Breaking-change-OK decisions age well when the blast radius is small**: v1.6 deleted 3 constants and tightened node-ID validation with no legacy adapter. Worked because the only consumer was kais-movie-agent, upgraded in lockstep. Would not work for a public API with third-party consumers — there the legacy adapter cost is justified.
- **Verification status vocabulary matters**: `passed` / `skipped` / `failed` / `human_needed` — Phase 33's `human_needed` status let us ship v1.6 without falsifying CI green. The vocabulary is more useful than a binary pass/fail.
- **Single reference skill validates the abstraction**: Building one skill (movie-v1) against the new contract surfaced every wrong assumption for cheap. The deferred second-skill work (MULTI-01..03) is the right next milestone because it stress-tests the multi-skill assumptions.

### Cost Observations

- **Sessions**: 1 (single-session execution, 2026-06-15)
- **Timeline**: ~12 hours (11:06 → 23:24 +0800)
- **Commits in v1.6 range**: 60+ (research → 7 phases → audit → close)
- **Files touched**: 73 (+12,640 / −608 LOC)
- **Model mix**: Almost all Sonnet for execution; the user's [[feedback_skip_gsd_subagent_ceremony]] preference avoided spawning `gsd-executor` Opus subagents per plan.
- **Notable**: Per-phase verify scripts made regression paranoia cheap — 277 assertions across 7 scripts run in seconds, so re-running the full v1.6 safety net after any change is essentially free.

### Tech Debt

- **COMPLIANCE-03 live-stack sign-off** (environment-gated): 6-step Docker+GPU checklist in `33-VERIFICATION.md`. No owner, no trigger. Needs a deployment gate before v1.6 hits production.
- **STATE.md progress counters** not reconciled at milestone close.
- **Phase 33 has no SUMMARY.md**: Verification-only phases skip the SUMMARY artifact. Future verification-only phases should document this convention explicitly (perhaps in a phase README or in `.planning/specs/`).
- **No HTTP-layer test for the new `/api/v1/skills/*` endpoints**: All registry verification was at the singleton/method level. The Express mount-path-param bug surfaced in 30-02-SUMMARY proves the HTTP layer has its own failure modes that the registry-level tests don't cover.

---

## Milestone: v1.5 — Architecture Hardening + Code Hygiene

**Shipped:** 2026-06-14
**Phases:** 5 (23-27) | **Requirements:** 9/9 satisfied | **Commits:** 9

### What Was Built

1. **GpuScheduler Redis backend** — StateStore abstraction (`stateStore.ts` + `memoryStateStore.ts` + `redisStateStore.ts`) with Lua atomic release; `getGpuSchedulerAsync()` factory auto-detects REDIS_URL with graceful memory fallback
2. **gold-team Python retirement** — Deleted `acestep.py` + `docker_polling.py` (395 LOC) + 5 cleanup sites in main/executor/engine_registry/router; Dockerfile stripped of ACE-Step source install + 7 ENV ACESTEP_* vars
3. **Output path convention** — `src/lib/paths.ts` typed API (`engineOutputDir`, `EngineKind` union) + backwards-compatible legacy env var aliases + migration guide
4. **TypeScript compile clean** — 4 vendored project excludes added to `tsconfig.json`; `yarn lint` errors 12,447 → 0
5. **router.ts auto-gen root-cause fix** — `src/core.ts` SKIP_PATTERNS regex; 12 config/shared files no longer `export default router`; router.ts 248 → 236 routes (12 phantom routes removed)

### What Worked

- **Skipping GSD ceremony (smart_discuss + plan-phase)** — Each phase had clear scope (1-2 reqs, well-bounded). Writing CONTEXT.md directly + implementing + writing VERIFICATION.md saved substantial ceremony overhead without losing quality.
- **Memory-first verification pattern** — `verify-phase-23.ts --memory-only` runs in CI/Planning context (no Redis dependency); full Redis test path is coded and ready for production runtime. Decouples verification from infrastructure availability.
- **Root-cause fixing over symptom patching** — Phase 27 fixed `src/core.ts` (the auto-generator) instead of repeatedly patching `src/router.ts` (the generated output). v1.4 commit 7a9393e had tried the symptom approach and was repeatedly overwritten.
- **3-source cross-reference for audit** — REQUIREMENTS.md traceability + Phase VERIFICATION.md + checkbox state triangulated requirement completion; caught no orphans.

### What Was Inefficient

- **TypeScript ESM/CJS interop friction** — Calling `core.ts`'s `generateRouter` via `tsx -e "import(...)"` returned `{ default: object }` instead of a function. Required writing a standalone `/tmp/regen-router.ts` script to invoke properly.
- **No project test framework** — Project lacks jest/vitest/mocha. Verification had to use standalone `tsx scripts/verify-phase-*.ts` files instead of integrated test runner. Limits CI integration.
- **Two-round cleanup for config files** — Phase 27 required (a) fixing `core.ts` to skip, then (b) cleaning 12 existing files that had been forced to `export default router` as a workaround. Could have been one pass if `core.ts` had been correct from the start.

### Patterns Established

- **StateStore abstraction for cross-process state** — Pattern for any future shared state (cache, sessions, locks): interface + memory impl + Redis impl + factory with fallback + WARN log on degradation.
- **"Root cause or it didn't happen"** — When a fix has been tried before and reverted (commit 7a9393e), suspect the fix was at the wrong layer. Audit the generator, not the generated.
- **Vendored project isolation** — Embedded projects under `docker/*` get their own tsconfig; main project excludes them from compile. Prevents 12k+ error noise from polluting main build.
- **Migration via alias, not breakage** — `paths.ts` accepts legacy env vars as overrides; new convention is opt-in via `OUTPUT_ROOT`. Zero breaking changes for existing deployments.

### Key Lessons

- **5 phases of "code hygiene" is the right granularity for a milestone** — Each phase had 1-2 requirements, took 1-3 hours to implement + verify. Larger milestones (v1.3 with 26 reqs) feel different — feature work, not cleanup.
- **VERIFICATION.md with "Deferred Items" section** is more honest than "all green" — explicitly documents what wasn't tested live (Redis path, Docker build, etc.) vs what was tested in CI.
- **audit-milestone doesn't require integration-checker for independent phases** — When 5 phases address different subsystems with no cross-wiring, spawning integration-checker adds noise without value.

### Cost Observations

- Model mix: ~95% Sonnet, ~5% Haiku (no Opus needed for hygiene work)
- Sessions: 1 (long autonomous session, context summarized mid-way)
- Notable: Skipping GSD plan/execute ceremony saved an estimated 40-60% of token cost vs full ceremony for 5 small phases

---

## Milestone: v1.1 — Hermes Intelligent Decision Engine

**Shipped:** 2026-06-06
**Phases:** 4 | **Plans:** 10

### What Was Built

1. Domain-agnostic REST API (decide/audit/register/health) wrapping hermes-agent as a Python library
2. EWMA-based self-learning loop: audit data flows into per-domain memory, confidence adapts over time
3. movie-pipeline domain registered as first tenant with 14 expert skills and seed parameter memory
4. hermes-client.js adapted for Node.js movie-agent with HERMES_DEFAULTS fallback; Docker container deployment
5. Legacy hermes-worker-agent (:3100) and kais-hermes Decision API retired

### What Worked

- **TDD-first approach**: Every plan started with failing tests, then implementation. All 4 phases passed verification on first run.
- **Wave-based execution**: Dependency-aware waves (07→08∥09→10) allowed parallel work without blocking.
- **Hardcoded skill list**: Explicit 14-file migration list avoided glob-based fragility.
- **Docker-first deployment**: Container health checks validated E2E without systemd complexity.

### What Was Inefficient

- **Context exhaustion at 75%**: Long session hit context limits before finishing, requiring session restart.
- **run_agent.py God Object (9000 lines)**: Wrapping hermes-agent required working around its monolithic structure; stable API surface was narrower than expected.
- **E2E tests auto-skip without Docker**: Tests pass in CI but skip locally without Docker, giving false confidence during development.

### Patterns Established

- **Domain-scoped AIAgent factory**: Each domain gets isolated skills, memory, and SOUL.md — reusable for future domains.
- **HERMES_DEFAULTS fallback pattern**: Client embeds defaults so pipeline survives hermes outage — applicable to other service dependencies.
- **Atomic JSON writes**: All file-based state uses write-to-tmp + rename for crash safety.

### Key Lessons

- When wrapping a large OSS library (hermes-agent 172k stars), focus on a narrow stable API surface rather than trying to expose all capabilities.
- EWMA alpha=0.3 gives good balance between recency and stability for confidence scoring.
- Node.js ↔ Python bridge via REST is simpler than IPC; the latency cost is acceptable for decision calls.

### Tech Debt

- E2E tests auto-skip when Docker container unavailable (by design, but limits local validation)
- Full GPU pipeline run not automated (requires hardware)
- No WebSocket real-time push (v2 scope)

---

## Milestone: v3.0 — Canvas Creative Experience (2026-08-22)

**What worked:** 单一注册表镜像+契约门模式第三次复刻(phaseRegistry/gateCatalog/taxonomy 三处零漂移治理);跨仓三段提交(khs/review-platform/kap)各自原子;并行会话 COORD-01 纪律(具名 add+khs 只读+域避让)全程零冲突;API 故障 SendMessage 续接保上下文;GUARD 收口传统(每 phase verify 门)使 milestone audit 仅聚合即可。

**What hurt:** e2e 时序竞态消耗大量调试(fitView 动画期注入/mock webServer 陈旧进程/G16 打开源竞态三例);UI-SPEC 规格与 registry 真值偶有脱节(sub 段 6 vs 7);plan 的 verify 命令字面与仓内现实有三处需执行者自行校正(router 库禁引/服务名/tsc 形态)。

**Carry forward:** Phase 53 Wave B(khs2 v2.4 Phase 25 gated);52 验证材料欠账(外部会话);TD-1..8(register 见 v3.0-MILESTONE-AUDIT);人工 UAT §7(14 项真机走查)。

## Milestone: v3.2 — 跨仓协调清偿 (2026-08-25)

**Shipped:** 2026-08-25 (单日: 执行→立项→审计→归档)
**Phases:** 63-73 (11) | **Repos:** kap + khs2 + gold-team + review-platform (四仓 27+ commits)

### What Was Built
12-agent 复审 40 findings (15 high) 的全量清偿: 引擎真值源收编+生产通电(终结 simulateOnly 假成功)·豁免桥三仓闭环(g15/ops+子集豁免)·变体域契约重冻结+Wave B 实施(FS transport 通电+换选四断点)·画布↔kmc 共存语义(_kmc_prompt 哨兵+产物回流)·QC/评分真数据(aiScore 生产者+五值 verdict)·门中心收尾(p11b 哨兵+qwen-eye 不绕队)。

### What Worked
- **回溯立项模式**: 授权代执行→draft 留证→正式立项固化——避免了 40 findings 逐条走 GSD phase 的流程开销,同时保留全部可追溯性(门+commit+ADR)。
- **漂移告警门当值**: 审计重跑时 verify-54/55 与 3 个 vitest pin 全部正确报警并行会话的 ICA M1/M2 漂移——门不是摆设。
- **COORD-02 端到端纪律二次自证**: 审计抓到「验 spawn pid ≠ 验监听者」的生产端口事故,当场修复+脚本硬化。

### What Was Inefficient
- 执行时点的「全绿」快照 6h 后就被并行会话打破(pin 滞后×2 类)——跨仓 pin 类断言的维护方约定仍缺失(谁改注册表谁更新全部 pin)。
- 生产被绕过脚本手动重启而无告警,静默回退 5.5h——需要端口/进程监控而非仅启动时验证。

### Patterns Established
- 回溯立项(retrospective formalization): draft→执行→立项→同日审计归档
- serve-production.sh 三重实证: 端口归属 pid==pidfile + /health + 监听进程 environ
- per-phase id 空间 (`{sid}:{ft}:v{N}`) + fullPhaseToken 防错批——跨相位同名门的隔离范式

### Key Lessons
- 验证断言要锚定「真实服务面」(监听者/消费端/生产数据),不能锚定「我启动的东西」(spawn pid)。
- 契约计数 pin 是漂移告警的代价: 注册表演进方必须同步全部 pin(kap verify-55 + 3 个 vitest 文件),否则下一个会话的审计就要替你销账。

### Cost Observations
- Model mix: 主力 Opus 4.8 (1M ctx), audit 子代理 Sonnet; 单会话完成执行+立项+审计+归档
- Notable: 12-agent fan-out 复审(journal wf_86c8a137)+ 40 finding 对抗复核的产出/成本比极高——一次投入防了 8 条「门绿链断」

## Cross-Milestone Trends

| Metric | v1.1 | v1.5 | v1.6 |
|--------|------|------|------|
| Phases | 4 | 5 | 7 |
| Plans | 10 | 5 | 8 (3 verification-only) |
| Requirements | 21/21 | 9/9 | 35/36 (1 env-gated) |
| Automated assertions | n/a | n/a | 277 PASSED / 1 SKIP / 0 FAIL |
| Verification | All passed | All passed | tech_debt (0 blockers) |
| Timeline | 1 day | 1 day | 1 day |
| Files touched | n/a | n/a | 73 (+12,640 / −608) |
