---
phase: 59
slug: narrow-trigger-stale-cascade
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 59-RESEARCH.md §Validation Architecture (HIGH confidence, line-verified).

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

> To be finalized by planner with concrete task IDs. Requirement→test mapping from RESEARCH.md:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {planner fills} | — | — | STALE-01/SC1 panel regen → stale badge | T-path-traversal / — | regenSource enum-validated, not auth basis | e2e | `npx playwright test test/e2e/tests/phase59-stale-cascade.mjs -g "panel"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | STALE-02/SC2 seed reroll → badge + seed passthrough | — | seed numeric, pydantic re-check | e2e + body assert | `… -g "reroll"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | STALE-03/SC3 orchestrate/batch zero impact | — | N/A (negative) | e2e neg + integration neg + static | `… -g "orchestrate"` + verify S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | SC4 rerun clears badge | — | N/A | e2e (reuse phase52-stale-panel.mjs) | `… -g "rerun-clears"` | Partial | ⬜ pending |
| {planner fills} | — | — | SC5/BP① poll reads outputs.image | — | N/A | integration (fake engine live shape) | verify S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | SC5/BP② /mnt/agents/output→/oss/ | T-path-traversal | normalize + prefix whitelist | unit | verify or vitest | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | SC5/BP③ engine error → error broadcast, no fake success | — | N/A | integration (500/timeout) | verify S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | SC5/BP④ ref_images param + host paths | — | N/A | integration (capture body) | verify S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | REGEN-02 seed reaches engine params.seed | — | N/A | integration + e2e getCalls | verify S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | D-03/04 cascade semantics converge | — | N/A | unit (stale.test.ts baseline) | `cd packages/flowgraph-v3 && npx vitest run` | ✅ | ⬜ pending |
| {planner fills} | — | — | D-05 reload fidelity (data.stale persist→restore) | — | N/A | integration (:memory: sqlite) | verify S-segment | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-59.ts` — aggregate gate skeleton (S-segments: BP①②/③/④+seed/cascade wiring/SC3 negative/SC5 negative/command gate/forced-failure) + package.json `verify:phase-59`
- [ ] `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` — SC1-4 (mock-backend extension: execute mock honors regenSource + replays node:updated contract event; `/__mock/emit` available)
- [ ] fake engine fixture (inline http server in verify: live-verified shapes — outputs.image container path / failed+error / params capture modes)
- [ ] fsToOssUrl export + new-branch unit test hook (planner picks residence)
- [ ] `probe-59-real.mjs` (:10588 zero-footprint probe + restore logic)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-machine narrow-path regen cascades | STALE-01 | needs live :10588 + real project | probe-59-real.mjs scripted (zero-footprint, restore in finally) — scripted, not manual |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
