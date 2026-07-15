---
phase: 46
slug: e2e-cross-repo-contract-tests
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-16
---

# Phase 46 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Phase 46 splits cleanly into two safety tiers:
> - **Safe tier (Plan 01, Wave 1):** 3 standalone tsx scripts with no
>   docker / GPU / network-beyond-sibling-repo dependencies. Runs in CI.
> - **Manual tier (Plan 02, Wave 2):** 1 env-gated E2E script that
>   requires docker-compose v9 + canvas API. Manual operator trigger only.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (standalone tsx scripts per `verify-phase-NN.ts` precedent) |
| **Config file** | none — scripts are self-contained |
| **Quick run command (safe tier)** | `npm run verify:phase-46-contracts` |
| **Full suite command** | `npm run verify:phase-46-contracts && PHASE46_RUN_E2E=1 npm run verify:phase-46-e2e` (E2E requires docker) |
| **Estimated runtime** | Safe tier: ~5s · E2E: ~30s (mostly canvas_sync propagation + API poll) |

---

## Sampling Rate

- **On every commit (safe tier):** Plan 01's 3 scripts via `npm run verify:phase-46-contracts`
- **Before v2.0 milestone close:** both tiers green
- **Before Phase 47 backfill `--apply`:** both tiers green against the live environment where backfill will run
- **Max feedback latency:** Safe tier < 5s · E2E < 30s

---

## Per-Task Verification Map

### Wave 1 (Plan 01 — safe-tier contract scripts)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 46-01-01 | 01 | 1 | VERIFY-01 | T-46-01, T-46-02 | Phase 42 manifest contract suite (132 tests) runs green from this repo | integration (cross-repo pytest) | `npx tsx scripts/verify-manifest-contract.ts` | ⬜ pending |
| 46-01-02 | 01 | 1 | VERIFY-02 | — | Production flattenParamsToNodeData + non-empty description ≥20 chars + every params.* round-trips on fixture | integration (runtime helper + fixture) | `npx tsx scripts/verify-import-roundtrip.ts` | ⬜ pending |
| 46-01-03 | 01 | 1 | VERIFY-04 | T-46-04 | TS EXPECTED_PARAM_FIELDS_BY_TYPE matches Python MANIFEST_PARAM_SCHEMA across all 9 node types | static (regex parse + diff) | `npx tsx scripts/verify-schema-drift.ts` | ⬜ pending |
| 46-01-04 | 01 | 1 | VERIFY-01, VERIFY-02, VERIFY-04 | — | Master npm script chains all 3 safe-tier scripts | npm-script composition | `npm run verify:phase-46-contracts` | ⬜ pending |

### Wave 2 (Plan 02 — manual E2E)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 46-02-01 | 02 | 2 | VERIFY-03 | T-46-07 | 3-node p04 fixture with description ≥20 + archetype/role/era params | static (fixture file shape) | `python3 -c "import json; ..."` shape check | ⬜ pending |
| 46-02-02 | 02 | 2 | VERIFY-03 | T-46-05, T-46-06, T-46-09 | Env-gated E2E: docker-up + fixture-drop + canvas_sync trigger + API poll + description/params assertions | E2E (env-gated) | `PHASE46_RUN_E2E=1 npx tsx scripts/verify-phase-46-e2e.ts` | ⬜ pending |
| 46-02-03 | 02 | 2 | VERIFY-03 | — | package.json wiring + VALIDATION.md manual section | static (grep) | `grep -c 'verify:phase-46-e2e' package.json` | ⬜ pending |

### Wave 2 manual E2E (documented in Plan 02)

The single E2E script `npx tsx scripts/verify-phase-46-e2e.ts` is the
authoritative Phase 46 gate WHEN docker is available. It runs all 3
assertions per fixture node + a summary. Run it after Plan 01 lands
to confirm the receiver-side E2E flow.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-manifest-contract.ts` — Plan 01 Task 1
- [ ] `scripts/verify-import-roundtrip.ts` — Plan 01 Task 2
- [ ] `scripts/verify-schema-drift.ts` — Plan 01 Task 3
- [ ] `scripts/verify-phase-46-e2e.ts` — Plan 02 Task 2 (env-gated)
- [ ] `scripts/fixtures/p04-canvas-e2e-manifest.json` — Plan 02 Task 1
- [ ] `package.json` entries: `verify:manifest-contract`, `verify:import-roundtrip`, `verify:schema-drift`, `verify:phase-46-contracts`, `verify:phase-46-e2e`

*Wave 0 deliverables are split across both plans. Plan 01 ships the safe-tier subset (CI-ready); Plan 02 ships the manual E2E. `nyquist_compliant: true` because every task has a concrete automated check.*

---

## Manual E2E Procedure (Plan 02)

**When to run:** before v2.0 milestone close, before Phase 47 backfill
`--apply`, after any change to canvas_sync.py / canvas routes /
relational store.

**Setup steps:**

1. Start docker compose v9:
   ```bash
   docker compose -f docker-compose.v9.yml up -d
   ```

2. Wait for services to be healthy (~30s for comfyui to download models on first start)

3. Set the env var:
   ```bash
   export PHASE46_RUN_E2E=1
   # Optional overrides:
   # export PHASE46_API_PORT=3000
   # export PHASE46_PROJECT_ID=1
   # export PHASE46_EPISODES_ID=1
   # export PHASE46_OSS_DIR=/data/workspace/kais-aigc-platform/data/oss/e2e-test/p04/manifest.json
   ```

4. Run the E2E script:
   ```bash
   npm run verify:phase-46-e2e
   ```

5. Expected output: 9 PASS assertions (3 nodes × 3 fields each) + summary line "9 passed, 0 failed" + exit 0

**On failure:**

- The script leaves the fixture file in `$PHASE46_OSS_DIR` for inspection
- Investigate via:
  - `docker compose -f docker-compose.v9.yml logs kais-review-platform` (canvas API logs)
  - `docker compose -f docker-compose.v9.yml logs hermes-agent` (canvas_sync trigger path)
- Manual cleanup: `rm $PHASE46_OSS_DIR`

**On success:**

- Script auto-deletes the fixture file
- Canvas nodes remain in the test project (intentional — proves the API path works)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Phase 46 E2E against a freshly-started docker environment | VERIFY-03 | Requires docker compose v9 + ~30s wait + GPU access | See "Manual E2E Procedure" above |
| Phase 46 E2E against a production-like environment | VERIFY-03 (out of scope) | Production canvas API requires auth; test design assumes localhost dev | Documented as out-of-scope; operators should run smoke tests separately |
| Performance regression check (canvas API responds < N ms) | — (not a requirement) | Out of scope — Phase 46 verifies correctness, not perf | Future phase candidate |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: every commit runs `verify:phase-46-contracts` (safe tier); E2E is opt-in
- [x] Wave 0 covers all 4 VERIFY-XX requirements (VERIFY-01/02/04 in Plan 01; VERIFY-03 in Plan 02)
- [x] No watch-mode flags
- [x] Feedback latency < 5s safe tier; < 30s E2E
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
