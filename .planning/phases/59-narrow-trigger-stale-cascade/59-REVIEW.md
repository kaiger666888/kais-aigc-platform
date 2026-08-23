---
phase: 59-narrow-trigger-stale-cascade
reviewed: 2026-08-23T19:56:56Z
depth: quick
files_reviewed: 3
files_reviewed_list:
  - src/routes/canvas/v2/import-from-dir.ts
  - scripts/verify-59-dispatch.ts
  - scripts/verify-phase-59.ts
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: issues_found
iteration: 4
previous_findings_resolved: WR-07, WR-08, IN-06
---

# Phase 59: Code Review Report (Final Re-Review, Iteration 4)

**Reviewed:** 2026-08-23T19:56:56Z
**Depth:** quick (mandated narrow scope: round-3 fixes only, bypass-reasoning verification)
**Files Reviewed:** 3 (round-3 fix set: commits a10f7e4d, 246d5e98, 51cbd71c, 3cd11bb1; working tree verified clean vs HEAD)
**Status:** issues_found — **0 critical / 0 warning / 6 info (all advisory; nothing blocks shipping)**. All three round-3 fixes verified fixed. The loop closes here.
**Iteration:** 4 of 4 (final; re-review of round-3 fixes only — prior reviews 2026-08-23T19:14:07Z, 19:39:19Z)

## Summary

Verified exactly the three round-3 fix claims against bypass construction, per mandate. All three hold:

1. **No workdir input can mint a `/oss` symlink into the repo or its subtree.** The mint (`import-from-dir.ts:2110`) now binds `realWorkdir`, which at that point is provably (a) lexically under an allowed root (`:2005`), (b) an existing directory, (c) realpath-resolved and still under an allowed root (`:2032`), (d) byte-identical to `absWorkdir` (`:2050`) — no symlink components left anywhere in the input path, so the string stored in the symlink *is* the canonical path with no attacker-controlled indirection — and (e) rejected by `isProtected` in all three directions (equal/ancestor/subtree) against both anchors (`:2074-2085`). Every bypass class traced below is closed.
2. **The ancestor-of-allowed-root carve-out (`:2077`) opens nothing beyond the allowed domain.** Verified against both runtime layouts on disk: in dev (tsx) the `__dirname`-derived anchor resolves to exactly the repo root (checked: `resolve("src/routes/canvas/v2","../../../..")` = `/data/workspace/kais-aigc-platform`) and the carve-out is inert — all three directions active on both anchors. In the prod esbuild bundle the anchor degenerates to `/data` (checked), the carve-out skips only anchor (a)'s subtree direction, and anchor (a)'s two surviving directions are fully subsumed by anchor (b)'s ancestor direction; since every path reaching `isProtected` is already under `/data/workspace/` or `/mnt/agents/output/`, the skipped direction would have rejected exactly the allowed domain itself — nothing else. Anchor (b) (the deployment literal, never an allowed-root ancestor, same-sourced as the `ossDir` literal at `:2090`) carries complete equal/ancestor/subtree protection in both layouts. A worktree checkout at any other location gets a fully-active anchor (a) plus the literal anchor (b).
3. **No new issue introduced by these edits.** `/mnt/agents/output` is a real directory on this host (readlink ENOENT, not a bind mount), so the `realWorkdir !== absWorkdir` rejection does not decapitate the second allowed root; there are zero symlinks at `/data/workspace` top level; the live kst import workdirs behind the existing `data/oss` links are real directories, so no known caller regresses (the route has no in-repo frontend caller — driven by external tools/verify scripts). Both new 400 bodies echo only the caller's input; `realWorkdir` goes to server-side `console.warn` only.

Independently re-ran `npm run verify:phase-59`: **89/89 PASS** (up from 83). Additionally ran the import-guard dispatch mode directly and tabulated the seven probes: `repo-root`/`repo-ancestor`/`repo-subtree-serve`/`repo-subtree-src`/`symlink-escape`/`symlinked-workdir-input` → all **400 + zero mint + no realpath leak**; `positive-control` → **200 + mint** (guard not over-blocking). Forced-failure self-check live (7/7). Gate temp artifacts (`/data/workspace/__v59_guard`, `data/oss/__v59_guard`, `data/oss/__v59_probe`) cleaned up.

## Narrative Findings (AI reviewer)

### Fix Verification Matrix (round-3 findings)

| Prior ID | Claim | Verdict | Notes |
|---|---|---|---|
| WR-08 | subtree containment: any repo-internal dir rejected | **Fixed** | Three-direction predicate; repo-internal dirs (`data/serve`, `src`, `schema`, `data/skills`, …) all 400 + zero mint; probes ⑤⑥ behavioral |
| WR-07 | reject symlinked workdir input + mint binds realpath | **Fixed** | `realWorkdir !== absWorkdir` → 400 (probe ⑦: symlink-to-allowed-root-dir now rejected, zero mint); mint binds `realWorkdir`; mismatched pre-existing link at the same basename is unlinked and re-minted to the validated target (heals pre-fix lexical mints) |
| IN-06 | 400 body no longer echoes resolved path | **Fixed** | Server-side `console.warn` only; both new 400s echo caller input only; probes ⑤⑦ assert `realpathLeaked=false` |

### Q1 verification detail — bypass constructions, all closed

- **Direct repo / subtree** (`workdir=repo`, `repo/data`, `repo/data/serve`, `repo/src`, …): subtree predicate `p.startsWith(root + "/")` on `realWorkdir`; anchor (b) always active. Probe-verified 400/zero-mint.
- **Repo ancestors** (`/data/workspace`, `/data`, `/`): ancestor predicate `root.startsWith(p + "/")` of anchor (b); `/data` and `/` additionally die at the root-prefix check (`:2005`). Probe-verified.
- **Symlinked input resolving into the repo** (any nesting depth): `realpath` fully collapses → subtree predicate catches; and independently `realWorkdir !== absWorkdir` → 400. Double-covered.
- **WR-07 pivot** (symlink input pointing at a legit allowed-root dir, re-pointed after mint): input rejected at `:2050` — zero mint, nothing to re-point. The in-request `realpath()`→`symlink()` window is also dead: `symlink()` stores an already-validated string and never re-resolves, so there is nothing left to race on the route side.
- **Lexical normalization** (trailing slash / `..` / relative / prefix-adjacency `/data/workspace-evil` / null byte): `resolve`+`realpath` normalize or throw → 400 (carried from round 2, unchanged).
- **Raw-input basename `.`/`..`** (`workdir=/data/workspace/y/x/..` → `basename` = `..` → mint path `join(ossDir, "..")` = `repo/data`): `readlink` on a real directory throws EINVAL → no unlink; `symlink()` hits EEXIST → outer catch → warn, non-fatal no-op. Harmless on this filesystem but fragile by construction — see IN-07-adjacent note in Info.
- **Pre-existing mismatched `data/oss` link at the requested basename** (pre-fix lexical target, trailing-slash variant, relative target): `readlink` mismatch → unlink → re-mint to validated `realWorkdir`. Healing, never widens.
- **Post-mint directory swap** (delete the validated dir, replace with symlink→repo, serve through the chain): *not a workdir-input vector and not introduced by r3* — it requires local write on the minted target path itself (under an allowed root). Critically, it is strictly dominated by an ambient pre-existing capability: `app.ts:80-91` mounts world-writable `/mnt/agents/output` as a **fallback static root for `/oss`** — any writer there can already serve any symlinkable path (including the repo) at `/oss/<name>` with no request to this route at all. The route-level guard cannot and need not close that; recorded as environmental context (IN-08), not a defect of these edits.

### Q3 verification detail — regression surface of the new rejection

- `/mnt/agents/output` confirmed real dir (not symlink, not bind mount) → the `!==` rejection cannot reject every engine-output workdir wholesale. Symlinked *components deeper* in a workdir now 400 with an actionable message ("请使用真实路径") — intentional per fix design; no in-repo caller depends on symlinked workdirs.
- Guard ordering consistent: `isProtected` runs after the `!==` rejection, so it always evaluates a symlink-free path, and the mint binds that same string. No check-operate divergence on the *mint* side. (A pre-existing divergence on the *scan* side is noted as IN-07 below — predates r3, low severity, unchanged by it.)
- `verify-phase-59.ts:703-712` static locks (`realWorkdir !== absWorkdir`, `symlink(realWorkdir, ossLinkPath`, `p.startsWith(root + "/")`) match the shipped code; behavioral probes verified above.

## Critical Issues

None.

## Warnings

None.

## Info

### IN-07: guard validates `resolve(workdir)`/realpath, but `stat` and `scanAndBuildTree` still operate on the raw lexical `workdir`

**File:** `src/routes/canvas/v2/import-from-dir.ts:2014, 2118`
**Issue:** Pre-existing (predates round 3; r3 actually hardened the mint half of this divergence). With a locally-created symlink `L` plus lexical `..` in the input (e.g. `workdir=/data/workspace/L/../x`), `resolve()` collapses `..` *lexically* while the kernel resolves it *after* following `L` — so the directory scanned (and stat'd) can diverge from the validated/minted one. Exposure is limited to conventional-pattern file *contents* (`pXX_*.json`, media dirs) flowing into the caller's own canvas; every served URL still routes through the validated mint. Requires local write under an allowed root — a privilege that already grants direct read of anything reachable this way. No `/oss` exposure.
**Fix:** Pass `absWorkdir` (= validated `realWorkdir`) to `stat()` and `scanAndBuildTree()` instead of the raw `workdir`; optionally compute `workdirBase` from `absWorkdir` too (also neutralizes the `.`/`..` basename edge permanently).

### IN-08 (environmental, context): pre-existing out-of-root `data/oss` symlinks persist; `/oss` fallback root at world-writable `/mnt/agents/output` is the dominant ambient exposure

**File:** runtime environment (`data/oss/*`, `src/app.ts:80-91`) — not introduced by this phase
**Issue:** `data/oss` today contains links minted before the guard existed that point outside the allowed roots (`p1800 → /home/kai/p1800-love-life`, `p1800-love-life → /home/kai/p1800-love-life`, `ep-cat-worker-v3 → /home/kai/runs/ep-cat-worker-v3`) — served by `/oss` now. Separately, `app.ts:80-91` serves `/mnt/agents/output` (mode 0777, ~2500 entries, engine-task-writable) as an `/oss` fallback root, so any writer there can expose arbitrary symlink targets at `/oss/<name>` without this route. The round-3 guard governs only new mints via this route and is coherent under that scope; whether to clean the legacy links / harden the fallback root is an environmental decision outside this phase.
**Fix (optional):** Sweep legacy out-of-root links; consider `dotfiles`/symlink policy or auth on the `/oss` fallback root in app.ts.

### IN-01 (carried, unfixed): execute/orchestrate error paths broadcast `error` without server-side logging of `err`

**File:** `src/routes/canvas/execute.ts:106-110`, `src/routes/canvas/orchestrate.ts:126-133`
**Issue:** Still no `console.error` of the caught error in either `setImmediate`/per-node catch.
**Fix:** Add `console.error("[canvas:execute] node failed:", nodeId, err)` / orchestrate equivalent.

### IN-02 (carried, unfixed): `canvasApi.executeNode` `extra.seed` remains a dead contract

**File:** `packages/infinite-canvas/src/services/canvasApi.ts:385-390`
**Issue:** Server only reads `params.seed`; a caller using the advertised top-level `extra.seed` silently loses it.
**Fix:** Fold it in client-side or drop it from the type.

### IN-03 (carried, unfixed): hardcoded deployment roots duplicated across `_engine.ts` / `import-from-dir.ts` with silent degradation

**File:** `src/routes/canvas/_engine.ts:84-91`, `src/routes/canvas/v2/import-from-dir.ts:211, 2003, 2073, 2090`
**Issue:** The root-literal set backs three behaviors (engine-path translate, allowed-workdir roots, protected repo anchors); relocation silently breaks all three with no warn.
**Fix:** Hoist to one shared exported constant; warn when an `/oss/` input fails both probes.

### IN-04 (carried, unfixed): `_stale.ts` per-node upsert+broadcast loop is all-or-nothing on mid-loop failure

**File:** `src/routes/canvas/_stale.ts:99-124`
**Issue:** A throw at node k of N leaves k+1..N unmarked and un-broadcast with no per-node record; execute swallows by design.
**Fix:** Per-node try/catch, collect + log failures, continue; rethrow after the loop.

---

_Reviewed: 2026-08-23T19:56:56Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick (final iteration — round-3 fix verification: WR-08 subtree predicate / WR-07 symlink-input rejection + realpath-bound mint / IN-06 no realpath echo)_
_Verification: gate 89/89 PASS; import-guard probes directly re-run (6×400/zero-mint/no-leak + positive control 200/mint); /mnt/agents/output confirmed real dir; anchors confirmed in both runtime layouts; working tree clean vs HEAD_
