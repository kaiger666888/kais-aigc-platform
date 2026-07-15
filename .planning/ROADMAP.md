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
- 🚧 **v2.0 Canvas Sync Permanence** — Phases 42-47 (current milestone)

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
- Integer phases (42-47): **v2.0 (this milestone — in progress)**
- Decimal phases (e.g., 35.1): Urgent insertions

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

## 🚧 v2.0 Canvas Sync Permanence (画布同步永久治理) — In Progress

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

**Plans**: TBD

### Phase 47: Historical Backfill + Archival

**Goal**: Run the existing backfill script (schema-ui-backfill, 2026-07-12) to repair the 530 historical empty-shell asset nodes; verify P04/P07/P08 panels show real content; archive the script as a one-off.
**Depends on**: Phase 46 (new contract tests must pass before mutating historical data)
**Requirements**: BACKFILL-01, BACKFILL-02, BACKFILL-03
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. `python3 scripts/backfill-asset-descriptions.py --apply` runs successfully; post-run DB query confirms 530 asset nodes (those with `description == ""` in pre-run snapshot) now have non-empty description.
  2. Manual sampling of 10 nodes each from P04 (character design, 256 total) / P07 (scene generation, 134 total) / P08 (scene selection, 52 total) shows NodeDetailPanel renders meaningful description text — not just label.
  3. The backfill script is moved to `scripts/oneoffs/` (or annotated with a deprecation header) and excluded from any cron / startup hook — clearly marked as a one-shot repair, not recurring infrastructure.

**Plans**: TBD

## Progress

**v2.0 Execution Order (planned):**

```
42 (manifest contract) ──┬──► 43 (canvas_sync cleanup)
                         │
                         └──► 44 (receiving schema) ──► 45 (text + UI) ──► 46 (E2E + contract tests) ──► 47 (backfill)
```

Phase 42 is the contract source — 43 and 44 can start in parallel after 42 lands. Phase 45 unifies both sides. Phase 46 is the regression gate before Phase 47 mutates historical data.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 42. Source-side Manifest Contract Hardening | v2.0 | 1/1 | Complete | 2026-07-15 |
| 43. canvas_sync.py Cleanup + Single-Path Mapping | v2.0 | 1/1 | Complete | 2026-07-15 |
| 44. Receiving-side Schema Strictness + Import Validation | v2.0 | 3/3 | Complete | 2026-07-16 |
| 45. Text Asset Mapping + UI Completeness | v2.0 | 3/3 | Complete | 2026-07-16 |
| 46. E2E + Cross-repo Contract Tests | v2.0 | 0/? | Not started | - |
| 47. Historical Backfill + Archival | v2.0 | 0/? | Not started | - |

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
| 35-38 | v1.7 Infinite Canvas Storyboard & Orchestration | ✅ Complete | 2026-06-18 |
| 39 | v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation | ✅ Complete | 2026-06-19 |
| 40-41 | v1.9 Canvas Sync Reliability | ✅ Complete | 2026-06-24 |
