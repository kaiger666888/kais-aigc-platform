---
phase: 57-portal-delivery-pages
plan: 07
subsystem: skills-contract
tags: [skill-manifest, phase-taxonomy, contract-test, gate-catalog, phase-registry, zod]

requires:
  - phase: 55-navigation-scale
    provides: PHASE_REGISTRY 22-phase single registry (khsPrefix/sortKey/name)
  - phase: 54-gate-gate-center-blocking-state-ux
    provides: GATE_CATALOG 16-gate snapshot + deriveGateId + gates.yaml js-yaml diff precedent
  - phase: 31-skill-callback-contract
    provides: MOVIE_V1_MANIFEST inline taxonomy constant (12-entry predecessor)
provides:
  - PhaseDecl.review_gate optional contract field (contract.ts + validator.ts + SKILL-CONTRACT.md + skill-author-guide.md lockstep)
  - movie-v1 phase_taxonomy 22 entries realigned to PHASE_REGISTRY vocabulary (13 gated / 9 gate-less)
  - upgradeDefaultSkillRow idempotent boot-time o_skillRegistry row upgrade (wired in db.ts boot)
  - scripts/verify-phase-57.ts three-way drift contract (taxonomy ↔ PHASE_REGISTRY ↔ GATE_CATALOG ↔ khs gates.yaml) + forced-fail
  - verify-phase-30/31/33 superseded to the 22-phase vocabulary (31 OLD_* snapshots preserved verbatim)
affects: [57-08 aggregate verification, skill-author-guide consumers, phase-complete callback gating, portal pipeline ribbon]

tech-stack:
  added: []  # zero new dependencies
  patterns: [mirror + three-way contract test (4th replication of verify-schema-drift discipline), idempotent boot-time row upgrade]

key-files:
  created: [scripts/verify-phase-57.ts]
  modified:
    - src/skills/defaultSkill.ts
    - src/skills/contract.ts
    - src/skills/validator.ts
    - src/utils/db.ts
    - scripts/verify-phase-30.ts
    - scripts/verify-phase-31.ts
    - scripts/verify-phase-33.ts
    - package.json
    - .planning/specs/SKILL-CONTRACT.md
    - docs/skill-author-guide.md
    - docs/skill-author-guide/movie-v1.manifest.json

key-decisions:
  - "D-13/D-16 executed: taxonomy rewritten 12→22 with id=PHASE_REGISTRY khsPrefix (p035/p11a0 token forms), order=sortKey ascending sequence 0..21, label=registry name; direct switch, no legacy adapter"
  - "D-15 executed: 13 gated phases carry review_gate in derivedGateId form (p01-gate…p13-gate); 9 gate-less phases carry ''; redline sub-gates (p13_delivery_redline_*) stay platformInvisible and occupy NO taxonomy entries"
  - "review_gate is OPTIONAL in the contract (zod optional, old manifests without the key still load — Pitfall 10); validator keeps .strict() with the new whitelisted key"
  - "Row upgrade lives in defaultSkill.ts (upgradeDefaultSkillRow) called from db.ts boot after loadAllFromDB+seedDefaultIfEmpty: SELECT → size guard → transactional UPDATE scoped to skill_id='movie-v1' → registry.register replay (T-57-07a)"
  - "verify-phase-31 OLD_* snapshots preserved verbatim as historical document; Group A/B equivalence assertions migrated to explicit SKIP + pointer comments to verify:phase-57 (no silent edit)"
  - "Live 10588 endpoint not restarted from this executor: the systemd service predates the commits and a shared restart mid-parallel-session was judged riskier than the code-path proof (see Verification)"

patterns-established:
  - "Three-way + khs four-link drift contract: taxonomy ↔ PHASE_REGISTRY ↔ GATE_CATALOG ↔ gates.yaml, with checkTaxonomy() factored so forced-fail can re-run it on in-memory mutations"
  - "Idempotent boot-time row upgrade pattern alongside seedDefaultIfEmpty (size-guarded, transactional, audit log line, cache re-hydrate)"

requirements-completed: [PORTAL-04]

duration: 95min
completed: 2026-08-22
---

# Phase 57 Plan 07: taxonomy 22/16 realignment + review_gate + three-way drift contract

**movie-v1's phase_taxonomy now speaks the 22-phase registry vocabulary with machine-readable review-gate annotation, guarded by a four-link zero-drift contract test that reaches read-only into khs gates.yaml.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 (contract lockstep / taxonomy + row upgrade / drift test + supersede)
- **Commits:** 3 feat + 1 docs

## Accomplishments

1. **Contract lockstep (D-15)** — `PhaseDecl.review_gate?: string` added in four places: `src/skills/contract.ts`, `src/skills/validator.ts` (`z.string().optional()`, `.strict()` retained), `.planning/specs/SKILL-CONTRACT.md` PhaseDecl table, `docs/skill-author-guide.md` §2.2 (with "platform-aligned, not hand-filled" note). verify-phase-28 drift test green both directions.

2. **Taxonomy 12→22 (D-13/D-16)** — `defaultSkill.ts` phase_taxonomy rewritten from PHASE_REGISTRY: id=khsPrefix, order=sortKey ascending (0..21), label=registry name. 13 gated phases (p01/p02/p03/p04/p06/p07/p09c/p10c/p11a0/p11a/p11b/p11c/p13) carry `review_gate: '<prefix>-gate'`; 9 gate-less (p035/p08/p09/p09b/p10/p12a/p12b/p14/p15) carry `''`. ingest_outputs follows canvasType (video→videos, audio→audio, asset→images, storyboard→storyboard, script→none). Docs JSON regenerated via gen script.

3. **Idempotent row upgrade (Q2)** — `upgradeDefaultSkillRow` added next to seedDefaultIfEmpty and wired into `src/utils/db.ts` boot (after loadAllFromDB + seedDefaultIfEmpty). Size-guarded (≠22 → upgrade), transactional, scoped to movie-v1, replays registry.register. Proven against a copy of the real production DB row: 12→22, idempotent rerun false, other rows untouched, registry cache serves p13-gate.

4. **verify-phase-57 (D-14)** — S parse gate (gates.yaml exactly 16 via read-only js-yaml, KAIS_HERMES_SKILLS_PATH-overridable, 0-entries/missing-file = fatal), T1 set equivalence (taxonomy ids ≡ khsPrefix set, two-way diff), T2 order strictly ascending ≡ sortKey ascending sequence, T3 review_gate non-empty ⇔ requires_review ∧ value ∈ GATE_CATALOG derivedGateId set ∧ ∈ gates.yaml derived set ∧ prefix = own khsPrefix, T4 gateless-9 list exact + redlines occupy no entries + non-redline catalog = 13, T5 constant requires_review ≡ registry gated-ness (phase-complete.ts silent-drop reef), F two forced-fail in-memory mutations (bad gate id,虚标 requires_review) both detected. npm `verify:phase-57` registered.

5. **Supersede** — verify-phase-30: expectedPhaseIds now derived from PHASE_REGISTRY import (sortKey asc), 12→22 in manifest + endpoint assertions, spot-checks p03/p09c/p11b including review_gate. verify-phase-31: OLD_* const blocks byte-identical (git diff confirmed zero value-line changes); Group A/B equivalence migrated to explicit SKIP console lines + pointer comments "superseded by verify:phase-57 T1-T4"; replaced with two live assertions (22 entries, legacy 12 ids fully retired); Groups C/D stay live. verify-phase-33 golden-path sample ids moved to p03/p09c/p11c/p13/p15.

## Verification

| Gate | Result |
|------|--------|
| `npm run verify:phase-57` | 14/14 PASS, exit 0 |
| `KAIS_HERMES_SKILLS_PATH=/tmp/nonexistent npm run verify:phase-57` | exit 1 (missing-file gate works) |
| `npm run verify:phase-55` | PASS exit 0 (registry untouched) |
| `npm run verify:phase-54` | PASS exit 0 (catalog untouched) |
| verify-phase-28 / 30 / 31 / 33 | 12/64/117/24 assertions, all exit 0 |
| root `npx tsc --noEmit` | exit 0 |
| `packages/infinite-canvas npx tsc -b --pretty` | exit 0 |
| khs repo | read-only (no changes from this plan; pre-existing parallel-session dirt untouched) |
| production-row upgrade (on DB copy) | 12→22, idempotent, other-skill row untouched |

**Live endpoint note:** `GET /api/v1/skills/movie-v1/phases` on 10588 still returned 12 at execution time — the systemd service (started before these commits) has not rebooted, so the boot-time row upgrade has not run there. The upgrade path itself is fully proven (transient DB + production-row copy + verify-phase-30's in-process route mount asserting 22). First service restart/deploy flips the live endpoint to 22 automatically; no manual data migration needed.

## Deviations

- **verify-phase-33 sample ids** were superseded beyond the plan's explicit file list — its golden-path loop asserted on legacy ids ("requirement"/"storyboard"/…) which no longer exist; without the edit the plan's own "verify-phase-33 green" acceptance was unmeetable. Same supersede rationale as 30/31, comment included.
- **Live endpoint smoke deferred to next service restart** (see Verification note) — coordinator guidance preferred code-path assertion over restarting the shared service mid-parallel-session.
- Loader.ts itself was not modified: the plan allowed the upgrade to live "loader.ts 或 defaultSkill.ts seed 段旁"; defaultSkill.ts (next to seedDefaultIfEmpty) + db.ts boot wiring was chosen as the minimal-touch path.
