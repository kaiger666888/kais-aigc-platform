---
phase: 59
slug: narrow-trigger-stale-cascade
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-23
planner_mapped: 2026-08-23
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 59-RESEARCH.md §Validation Architecture (HIGH confidence, line-verified).
> Task IDs filled by planner 2026-08-23 (4 plans: 59-01 W1 → 59-02/59-03 W2 → 59-04 W3).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9 (packages/infinite-canvas + packages/flowgraph-v3/ts) · Playwright 1.61 (e2e) · tsx aggregate gate (root) |
| **Config file** | vitest built-in per package · playwright.config.mjs (webServer=mock-backend :9876, workers=1) |
| **Quick run command** | `npx tsc --noEmit` (root) + touched package `npx vitest run <narrowest relevant file>` |
| **Full suite command** | `npx tsx scripts/verify-phase-59.ts` (new aggregate gate: 3× tsc + both vitest + contract assertions + forced-failure) |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit` (root) + touched package `npx vitest run <file>`
- **After every plan wave:** `npm run verify:phase-59` + `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase59-stale-cascade.mjs` (serve dist, not source — landmine #10)
- **Before `/gsd:verify-work`:** full e2e suite (incl. phase52 trio regression) + probe-59-real (:10588 zero-footprint) + SC3 real-machine negative
- **Max feedback latency:** ~30 seconds (quick loop)

### Negative Assertion Trio (locked)

1. execute without regenSource (ContextMenu path) → zero stale writes
2. orchestrate → zero stale writes (SC3)
3. engine failure → error broadcast AND zero stale writes (D-02)

---

## Per-Task Verification Map

> Filled by planner with concrete task IDs (59-01-T1 … 59-04-T3). Requirement→test mapping from RESEARCH.md:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 59-04-T1 | 59-04 | 3 | STALE-01/SC1 panel regen → stale badge | T-59-04 | regenSource enum-validated, not auth basis | e2e | `npx playwright test test/e2e/tests/phase59-stale-cascade.mjs -g "panel"` (wiring: 59-02-T1/T2 + 59-03-T1/T2) | ❌ W0 → 59-04-T1 creates | ⬜ pending |
| 59-04-T1 | 59-04 | 3 | STALE-02/SC2 seed reroll → badge + seed passthrough | — | seed numeric, pydantic re-check | e2e + body assert | `… -g "reroll"` (getCalls body.regenSource + body.params.seed) | ❌ W0 → 59-04-T1 | ⬜ pending |
| 59-02-T3 + 59-04-T1 | 59-02/59-04 | 2/3 | STALE-03/SC3 orchestrate/batch zero impact | — | N/A (negative) | e2e neg + integration neg + static | `… -g "orchestrate"` + verify S4 (spawn dispatch + grep orchestrate.ts) | ❌ W0 → 59-02-T3 / 59-04-T1 | ⬜ pending |
| 59-04-T1 | 59-04 | 3 | SC4 rerun clears badge | — | N/A | e2e (reuse phase52-stale-panel.mjs trio regression in 59-04-T3) | `… -g "rerun-clears"` | Partial (phase52-stale-panel.mjs ✅) | ⬜ pending |
| 59-01-T2 | 59-01 | 1 | SC5/BP① poll reads outputs.image | — | N/A | integration (fake engine live shape, direct call) | verify S2 (completed mode → outputUrl=/oss/…) | ❌ W0 → 59-01-T2 | ⬜ pending |
| 59-01-T1 + 59-01-T2 | 59-01 | 1 | SC5/BP② /mnt/agents/output→/oss/ | T-59-01 | normalize + prefix whitelist | unit + integration | verify S1 (fsToOssUrl/ossToEnginePath direct) + S2 (applied) | ❌ W0 → 59-01-T1 | ⬜ pending |
| 59-01-T3 (static) + 59-02-T3 (behavioral) | 59-01/59-02 | 1/2 | SC5/BP③ engine error → error broadcast, no fake success | — | N/A | integration (failed mode → spawn dispatch → event capture) | verify S3 engine-fail mode (error event, zero success, zero stale) | ❌ W0 → 59-01-T3/59-02-T3 | ⬜ pending |
| 59-01-T2 | 59-01 | 1 | SC5/BP④ ref_images param + host paths | T-59-01 | traversal guard on inbound | integration (capture body) | verify S2 (params.ref_images host path, no reference_images key) | ❌ W0 → 59-01-T2 | ⬜ pending |
| 59-01-T2 + 59-02-T3 + 59-04-T1 | 59-01/02/04 | 1/2/3 | REGEN-02 seed reaches engine params.seed | — | N/A | integration + e2e getCalls | verify S2 (metadata seed) + S3 (captured body seed===777) + e2e body.params.seed | ❌ W0 → 59-01-T2 | ⬜ pending |
| 59-02-T2 | 59-02 | 2 | D-03/04 cascade semantics converge | — | N/A | unit (flowgraph-v3 baseline) + dispatch fixture | `cd packages/flowgraph-v3 && npx vitest run` + verify S3-cascade | ✅ stale.test.ts | ⬜ pending |
| 59-02-T3 | 59-02 | 2 | D-05 reload fidelity (data.stale persist→restore) | — | N/A | integration (isolated sqlite child) | verify S3-cascade staleRows via loadFullGraph | ❌ W0 → 59-02-T3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [x] → 59-01-T1: `scripts/verify-phase-59.ts` aggregate gate skeleton (S-segments) + package.json `verify:phase-59` (S2 engine fixture 59-01-T2; S3/S4 dispatch 59-02-T3; S5 client statics 59-04-T3)
- [x] → 59-04-T1: `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` — SC1-4 (mock-backend extension honors regenSource + replays node:updated contract)
- [x] → 59-01-T2 + 59-02-T3: fake engine fixture (inline http server: outputs.image container path / failed+error / params capture modes)
- [x] → 59-01-T1: fsToOssUrl export + new-branch unit test hook (residence pinned: stays in `src/routes/canvas/v2/import-from-dir.ts`, tested via verify S1 direct import)
- [x] → 59-04-T2: `probe-59-real.mjs` (:10588 zero-footprint probe + restore logic)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-machine narrow-path regen cascades | STALE-01 | needs live :10588 + real project | probe-59-real.mjs scripted (zero-footprint, restore in finally) — scripted, not manual |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (planner check 2026-08-23)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task carries tsc/verify/playwright automated gate)
- [x] Wave 0 covers all MISSING references (mapped to owning tasks above)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick loop: tsc + narrow vitest)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (execution + verify-work)
