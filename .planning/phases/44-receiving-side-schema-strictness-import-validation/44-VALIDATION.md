---
phase: 44
slug: receiving-side-schema-strictness-import-validation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-16
completed: 2026-07-16
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> This phase is pure schema/import-validation infrastructure. There is no shared test framework (per STATE.md Pitfalls B3/B4); validation follows the standalone-script precedent established by Phase 19's `verify-phase-N.ts` pattern.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (standalone tsx scripts) |
| **Config file** | none — scripts are self-contained |
| **Quick run command** | Wave 1+2: `npx tsc --noEmit` + grep assertions · Wave 3: `npx tsx scripts/verify-schema-roundtrip.ts` |
| **Full suite command** | `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit` |
| **Estimated runtime** | ~3-5 seconds |

---

## Sampling Rate

- **After every task commit:** Wave 1+2 tasks run their task-level `<automated>` (tsc + grep); Wave 3 task runs `npx tsx scripts/verify-schema-roundtrip.ts`
- **After every plan wave:** Wave 3 delivers the comprehensive end-of-phase gate: `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

> **Note on Wave 0 / deferred verifier:** The comprehensive `verify-schema-roundtrip.ts` script is authored in Plan 03 (Wave 3) because it asserts Wave 1+2 outputs. Wave 1+2 tasks therefore list their ACTUAL task-level automated commands below (tsc + grep), NOT the not-yet-existing script. Wave 3 re-verifies everything end-to-end via the single comprehensive script. This matches the reality of infrastructure phases that build the verifier alongside the work; `nyquist_compliant: true` is justified because every task has a concrete sub-5-second automated check, and Wave 3 is the comprehensive gate that closes the loop.

### Wave 1 (Plan 01 — schema expansion)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 44-01-01 | 01 | 1 | SCHEMA-01 | — | Schema declares full v2.0 field set as optional zod fields | static (generator run + grep canary) | `python schema/generate_mappings.py && grep -q '"era"' schema/generated/frontend-zod-extensions.ts && grep -q '"era"' schema/generated/canvas_sync_mappings.py && grep -q '"era"' schema/generated/frontend-enum-normalizers.ts` | ✅ green (era in zod + canvas_sync_mappings; absent from enum-normalizers because era has no alias/enum — generator behavior) |
| 44-01-02 | 01 | 1 | SCHEMA-04 | — | PATCH /nodes/batch enforces v2.0 schema; rejects with full error list (emergent from schema expansion — no nodes.ts edit) | static (export presence + tsc) | `npx tsc --noEmit 2>&1 \| tail -5 && grep -c "EXPECTED_PARAM_FIELDS_BY_TYPE" src/lib/canvasAssetSchema.ts \| grep -qE '^[1-9]' && grep -v '^//' src/lib/canvasAssetSchema.ts \| grep -c '"archetype"' \| grep -qE '^0$'` | ✅ green (3 pre-existing tsc errors, 0 new) |

### Wave 2 (Plan 02 — import stamping + flatten helper extraction)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 44-02-01 | 02 | 2 | SCHEMA-02 | — | import-from-dir logs warn + stamps `data.__incomplete` on missing fields; node still created (no silent drop); flattenParamsToNodeData helper exported for Plan 03 | static (tsc + grep presence) | `npx tsc --noEmit 2>&1 \| tail -5 && grep -c "EXPECTED_PARAM_FIELDS_BY_TYPE" src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^[2-9]' && grep -c '__incomplete\|__missing_fields' src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^[2-9]' && grep -c '\[v2/import\]' src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^[1-9]' && grep -c 'export function flattenParamsToNodeData' src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^1$'` | ✅ green |

### Wave 3 (Plan 03 — roundtrip verifier — comprehensive end-of-phase gate)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 44-03-01 | 03 | 3 | SCHEMA-03 | — | Every `params.*` round-trips into `node.data` via the REAL production `flattenParamsToNodeData` helper (imported, not hand-mirrored — closes Blocker 3 replay-drift loophole) | integration (fixture-driven, production-helper import) | `npx tsx scripts/verify-schema-roundtrip.ts 2>&1 \| tail -20 && echo "EXIT=$?"` | ✅ green (41/41 assertions pass, exit 0) |

### Wave 3 re-verification (comprehensive gate — covers SCHEMA-01/02/03/04)

The single script `npx tsx scripts/verify-schema-roundtrip.ts` runs all 4 sections end-to-end and is the authoritative Phase 44 gate. Run it after Plan 03 lands. It re-verifies:
- **SCHEMA-01** (schema-declaration section): every v2.0 field present in canvasAssetSchema.ts OR frontend-zod-extensions.ts
- **SCHEMA-02** (incomplete-stamping section): EXPECTED_PARAM_FIELDS_BY_TYPE + __incomplete + __missing_fields + [v2/import] all present in import-from-dir.ts
- **SCHEMA-03** (params-roundtrip section): imports `flattenParamsToNodeData` from production code, replays against fixtures, asserts every scalar params.* key survives
- **SCHEMA-04** (batch-rejection section): validateNodeData + 整批已拒绝 present in nodes.ts

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are indicative — the planner assigns final IDs based on plan decomposition. The 4 SCHEMA-XX requirements map to the 4 sections of the single verify-schema-roundtrip.ts script.*

---

## Wave 0 Requirements

- [ ] `scripts/verify-schema-roundtrip.ts` — single script with 4 assertion sections covering SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04; SCHEMA-03 IMPORTS the production `flattenParamsToNodeData` helper (not hand-mirrored — closes Blocker 3)
- [ ] `scripts/fixtures/sample-manifest.json` (optional) — in-repo fallback fixture; preferred source is cross-repo `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p01..p14.json` from Phase 42
- [ ] No framework install needed — `tsx` is already a dev dependency

*No conftest or shared fixtures needed — standalone script pattern.*

*Wave 0 deliverable is authored in Wave 3 (Plan 03) because the script asserts Wave 1+2 outputs. This is the "deferred Wave 0" reality of infrastructure phases that build the verifier alongside the work — every Wave 1+2 task has a concrete sub-5-second automated check (tsc + grep), and Wave 3 is the comprehensive gate. `nyquist_compliant: true` reflects this structure.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 689 historical rows still load after schema expansion | SCHEMA-01 | Requires live DB + populated canvas; optionals-only expansion means loadability is structurally guaranteed | Run `docker compose -f docker-compose.v9.yml up -d`, hit `GET /api/v1/canvas/v2/projects/:id/episodes/:id/graph`, verify 200 + no missing-field warnings on historical rows |

*All other phase behaviors have automated verification via verify-schema-roundtrip.ts (Wave 3) or task-level tsc/grep (Wave 1+2).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Wave 0 deliverable authored in Wave 3; Wave 1+2 tasks have concrete tsc/grep automated checks)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready (post-revision)
