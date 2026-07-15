---
phase: 44
slug: receiving-side-schema-strictness-import-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-16
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
| **Quick run command** | `npx tsx scripts/verify-schema-roundtrip.ts` |
| **Full suite command** | `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit` |
| **Estimated runtime** | ~3-5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx scripts/verify-schema-roundtrip.ts`
- **After every plan wave:** Run `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 1 | SCHEMA-01 | — | Schema declares full v2.0 field set as optional zod fields | static (grep + schema parse) | `npx tsx scripts/verify-schema-roundtrip.ts --section=schema-declaration` | ❌ W0 | ⬜ pending |
| 44-01-02 | 01 | 1 | SCHEMA-04 | — | PATCH /nodes/batch enforces v2.0 schema; rejects with full error list | static (route code read) | `npx tsx scripts/verify-schema-roundtrip.ts --section=batch-rejection` | ❌ W0 | ⬜ pending |
| 44-02-01 | 02 | 1 | SCHEMA-02 | — | import-from-dir logs warn + stamps `data.__incomplete` on missing fields | unit (logic replay) | `npx tsx scripts/verify-schema-roundtrip.ts --section=incomplete-stamping` | ❌ W0 | ⬜ pending |
| 44-03-01 | 03 | 2 | SCHEMA-03 | — | Every `params.*` round-trips into `node.data` | integration (fixture-driven) | `npx tsx scripts/verify-schema-roundtrip.ts --section=params-roundtrip` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are indicative — the planner assigns final IDs based on plan decomposition. The 4 SCHEMA-XX requirements map to the 4 sections of the single verify-schema-roundtrip.ts script.*

---

## Wave 0 Requirements

- [ ] `scripts/verify-schema-roundtrip.ts` — single script with 4 assertion sections covering SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04
- [ ] `scripts/fixtures/sample-manifest.json` (optional) — in-repo fallback fixture; preferred source is cross-repo `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p01..p14.json` from Phase 42
- [ ] No framework install needed — `tsx` is already a dev dependency

*No conftest or shared fixtures needed — standalone script pattern.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 689 historical rows still load after schema expansion | SCHEMA-01 | Requires live DB + populated canvas; optionals-only expansion means loadability is structurally guaranteed | Run `docker compose -f docker-compose.v9.yml up -d`, hit `GET /api/v1/canvas/v2/projects/:id/episodes/:id/graph`, verify 200 + no missing-field warnings on historical rows |

*All other phase behaviors have automated verification via verify-schema-roundtrip.ts.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
