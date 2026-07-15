---
phase: 45
slug: text-asset-mapping-ui-completeness
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-16
completed: 2026-07-16
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> This phase mixes backend (import path), frontend (NodeDetailPanel,
> FlowCanvas toolbar), and a verify script. No shared test framework
> (per STATE.md Pitfalls B3/B4); validation follows the standalone-script
> precedent established by Phase 41 / Phase 44.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (standalone tsx scripts + tsc) |
| **Config file** | none — scripts are self-contained |
| **Quick run command** | Wave 1: `npx tsc --noEmit` + grep assertions · Wave 2: `npx tsx scripts/verify-phase-45.ts` |
| **Full suite command** | `npx tsx scripts/verify-phase-45.ts && npx tsc --noEmit` |
| **Estimated runtime** | ~3-5 seconds |

---

## Sampling Rate

- **After every task commit:** Wave 1 tasks run their task-level `<automated>` (tsc + grep); Wave 2 Task 2 runs `npx tsx scripts/verify-phase-45.ts`
- **After every plan wave:** Wave 2 Task 2 delivers the comprehensive end-of-phase gate
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

> **Note on Wave 0 / deferred verifier:** The comprehensive `verify-phase-45.ts` script is authored in Plan 03 Task 2 (Wave 2) because it asserts Wave 1+2 outputs. Wave 1 tasks therefore list their ACTUAL task-level automated commands below (tsc + grep), NOT the not-yet-existing script. Wave 2 re-verifies everything end-to-end via the single comprehensive script. This matches the reality of infrastructure phases that build the verifier alongside the work; `nyquist_compliant: true` is justified because every task has a concrete sub-5-second automated check, and Wave 2 is the comprehensive gate that closes the loop.

### Wave 1 (Plan 01 — backend text-asset mapping)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 45-01-01 | 01 | 1 | TEXT-01 | T-45-01 | Sidecar cap raised to 10K; old 500 cap removed | static (tsc + grep) | `grep -c "slice(0, 500)" src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^0$' && grep -c "slice(0, 10000)" src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^1$' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green (0 old / 1 new / 3 baseline errors) |
| 45-01-02 | 01 | 1 | TEXT-01 | — | Standalone .txt files in script dirs become script nodes; deduped against sidecars | static (tsc + grep) | `grep -c "artifactsFromScriptTextFiles" src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^[2-9]$' && grep -c "consumedBaselineSet" src/routes/canvas/v2/import-from-dir.ts \| grep -qE '^[2-9]$' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green (probe at workdir root rather than asset dirs — see 45-01-SUMMARY deviation note) |

### Wave 1 (Plan 02 — UI panel completeness, parallel-safe with Plan 01)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 45-02-01 | 02 | 1 | TEXT-02 | T-45-05 | StoryboardDetail renders description block (pre-wrap, theme styles) when prompt absent | static (awk + tsc) | `awk '/^function StoryboardDetail/,/^function [A-Z]/' packages/infinite-canvas/src/components/NodeDetailPanel.tsx \| grep -c "描述" \| grep -qE '^[1-9]' && awk '/^function StoryboardDetail/,/^function [A-Z]/' packages/infinite-canvas/src/components/NodeDetailPanel.tsx \| grep -c "pre-wrap" \| grep -qE '^[2-9]' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green |
| 45-02-02 | 02 | 1 | TEXT-02 | T-45-05, T-45-07 | VideoDetail renders prompt + description + tags + provenance per AssetDetail pattern | static (awk + tsc) | `awk '/^function VideoDetail/,/^}$/' packages/infinite-canvas/src/components/NodeDetailPanel.tsx \| grep -cE 'Prompt 描述\|描述\|标签\|来源' \| grep -qE '^4$' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green |
| 45-02-03 | 02 | 1 | TEXT-02 | — | ScriptDetail falls back description → content → prompt (was: description → content) | static (grep + tsc) | `grep -c "data.description as string) \|\| (data.content as string) \|\| (data.prompt as string)" packages/infinite-canvas/src/components/NodeDetailPanel.tsx \| grep -qE '^1$' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green |

### Wave 2 (Plan 03 — Tier 2 search filter + comprehensive gate, depends on Wave 1)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 45-03-01 | 03 | 2 | TEXT-03 | T-45-08, T-45-10 | Debounced search input filters visible nodes by label/description/prompt substring; visibility-only (no data mutation) | static (grep + tsc) | `grep -c "searchQuery" packages/infinite-canvas/src/components/FlowCanvas.tsx \| grep -qE '^[3-9]$' && grep -c "hidden: !matches" packages/infinite-canvas/src/components/FlowCanvas.tsx \| grep -qE '^1$' && grep -c "setTimeout" packages/infinite-canvas/src/components/FlowCanvas.tsx \| grep -qE '^[1-9]' && npx tsc --noEmit 2>&1 \| grep -c "error TS" \| grep -qE '^3$'` | ✅ green |
| 45-03-02 | 03 | 2 | TEXT-01, TEXT-02, TEXT-03 | — | Comprehensive end-of-phase verifier: 13 assertions across TEXT-01/02/03 | integration (substring-presence on source files) | `npx tsx scripts/verify-phase-45.ts 2>&1 \| tail -10 && echo "EXIT=$?"` | ✅ green (13/13 assertions pass, exit 0) |

### Wave 2 re-verification (comprehensive gate — covers TEXT-01/02/03)

The single script `npx tsx scripts/verify-phase-45.ts` runs all 3 sections end-to-end and is the authoritative Phase 45 gate. Run it after Plan 03 lands. It re-verifies:
- **TEXT-01** (backend section): `slice(0, 10000)` present, `slice(0, 500)` absent, `artifactsFromScriptTextFiles` present, `consumedBaselineSet` present, `canvasType === "script"` gate present
- **TEXT-02** (UI section): ScriptDetail fallback chain includes prompt, description SectionLabel appears ≥3 times, VideoDetail contains Prompt 描述 + 来源 blocks, pre-wrap appears ≥6 times
- **TEXT-03** (search section): `searchQuery` present, `hidden: !matches` present, search input placeholder present

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-45.ts` — single script with 3 assertion sections covering TEXT-01, TEXT-02, TEXT-03; static substring-presence checks (no runtime imports needed)
- [ ] `package.json` — `verify:phase-45` script registered
- [ ] No framework install needed — `tsx` is already a dev dependency

*Wave 0 deliverable is authored in Wave 2 (Plan 03 Task 2) because the script asserts Wave 1+2 outputs. Every Wave 1 task has a concrete sub-5-second automated check (tsc + grep), and Wave 2 is the comprehensive gate. `nyquist_compliant: true` reflects this structure.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual confirmation that StoryboardDetail / VideoDetail panels show description text for nodes that previously rendered as bare labels | TEXT-02 | Requires live canvas + populated DB; the static grep verifies the JSX is present but not the visual rendering | Run dev server, open a project with P09 storyboard nodes / P11-P13 video nodes, click each node type, confirm 描述 / Prompt 描述 / 标签 / 来源 sections appear when expected |
| Search filter narrows visible nodes in real time | TEXT-03 | Requires live canvas + React Flow rendering; static grep verifies the wiring but not the UX | Run dev server, type into the toolbar search input, confirm non-matching nodes hide; clear input, confirm all nodes reappear |
| Standalone .txt files in script phase dirs produce script nodes on import | TEXT-01 | Requires running the import path against a real OSS dir with .txt files | Manually place a `test.txt` file in a p01 phase dir, re-run import, confirm a new script node appears with the .txt content as description |

*All other phase behaviors have automated verification via verify-phase-45.ts (Wave 2) or task-level tsc/grep (Wave 1).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Wave 0 deliverable authored in Wave 2; Wave 1 tasks have concrete tsc/grep automated checks)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
