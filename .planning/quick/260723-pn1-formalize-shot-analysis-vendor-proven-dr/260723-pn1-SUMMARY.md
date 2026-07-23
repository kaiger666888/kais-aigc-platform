---
phase: quick-shot-analysis
plan: 01
subsystem: production/shot-analysis
status: complete
tags: [shot-analysis, comfyui, python-driver, production-route, thin-wrapper]
requires:
  - "ComfyUI running with ShotGeometryLK / SubjectMotionResidual / ShotJSONMerge / AILab_QwenVL_Advanced / SAM3Segment nodes deployed"
  - "shots.json (kais-shot-timeline producer output)"
provides:
  - "POST /api/v1/production/shot-analysis — thin HTTP wrapper over vendored driver"
  - "scripts/shot-analysis/shot_analysis_driver.py — validated逐镜头运镜解构 driver (geometry + optional semantic + optional subject)"
affects:
  - "src/router.ts (route138 import + mount)"
  - "data/serve/app.js (rebuilt bundle includes the new route module)"
tech-stack:
  added: []
  patterns:
    - "THIN TS wrapper (execFileSync spawn) over Python driver — all ComfyUI workflow/prompt/history logic stays in Python"
    - "docker cp staging skipped for /root/ComfyUI or /mnt/agents container-visible paths"
    - "Partial-result aggregation: per-shot JSON read failures are logged + skipped, do not fail the whole request"
key-files:
  created:
    - scripts/shot-analysis/shot_analysis_driver.py
    - scripts/shot-analysis/README.md
    - src/routes/production/shot-analysis/_shared/config.ts
    - src/routes/production/shot-analysis/index.ts
  modified:
    - src/router.ts
decisions:
  - "Driver vendored BYTE-FOR-BYTE (diff clean) — any edit invalidates the 2026-07-23 validated baseline"
  - "Route stays THIN: no axios / ComfyUI /prompt /history calls in TS — driver owns all ComfyUI interaction"
  - "Mounts at /api/v1/production/shot-analysis (v1 prefix) — intentional deviation from sibling /api/production/* routes per locked design"
  - "routeN=138 (next free after route137)"
metrics:
  duration: "~2m48s"
  completed: "2026-07-23"
  tasks: 3
  commits: 3
---

# Phase quick-shot-analysis Plan 01: Formalize shot-analysis (vendor proven driver + thin production route) Summary

Vendored the validated逐镜头运镜解构 Python driver verbatim and exposed it behind a THIN `POST /api/v1/production/shot-analysis` route that stages video into the ComfyUI container, spawns the driver via `execFileSync`, and aggregates the per-shot `shot_XXX.json` outputs — all ComfyUI workflow/polling logic stays in Python (no TS port).

## What Was Built

### Task A — Vendored driver + operator README (`170938b6`)
- `scripts/shot-analysis/shot_analysis_driver.py` copied byte-for-byte from `/tmp/shot_analysis_driver.py` (`diff -q` returns no output). The driver builds ComfyUI workflows (`VHS_LoadVideoPath` + `ShotGeometryLK` geometry layer + optional `AILab_QwenVL_Advanced` semantic + optional `SAM3Segment`+`SubjectMotionResidual` subject), POSTs to `/prompt`, polls `/history`, and `ShotJSONMerge` writes per-shot merged JSON.
- `scripts/shot-analysis/README.md` — Chinese operator docs: 3-layer + flag table, full CLI argparse contract (`--shots`/`--video`/`--shot-id-range`/`--semantic`/`--subject`/`--grid-n` default 20 / `--fps` default 24.0 / `--qwen-model` / `--quant`), prerequisites (5 ComfyUI nodes + Qwen3-VL-8B-Instruct + sam3.pt), both known limitations (sam3.pt HF xet CDN block; container-path requirement), and the validated shot_003 example (`pan_right`/`fast`/~18px + `近景`/`follow`/`刀飞向画面右侧`/雾气幽暗神秘).

### Task B — THIN production route + router registration (`2472721f`)
- `src/routes/production/shot-analysis/_shared/config.ts` — `SHOT_ANALYSIS_CONFIG` (7 fields: `comfyuiUrl`, `containerName`, `outputDir`, `driverPath`, `pythonBin`, `containerInputDir`, `shotAnalysisDir`), mirrors `WAN22_CONFIG` shape.
- `src/routes/production/shot-analysis/index.ts` — default-exported Express router exposing `POST /`. Zod-validated body `{video, shots, shot_id_range?, semantic?, subject?, grid_n?=20, fps?=24}`. Determines container video path (passthrough for `/root/ComfyUI/*` or `/mnt/agents/*`; otherwise `docker cp` into `containerInputDir/<basename>` via `execFileSync` with argv array — no shell interpolation). Spawns driver synchronously with `COMFYUI_URL` injected. Aggregates `shot_XXX.json` from `shotAnalysisDir`, filters by `shot_id_range` if provided, sorts ascending; per-file read failures are logged + skipped (partial results preserved). **Verified THIN**: `grep -E "axios|/prompt|/history"` returns zero matches — no ComfyUI client logic in TS.
- `src/router.ts` — added `import route138 from "./routes/production/shot-analysis";` (alphabetical, between qwenTts/voiceId and storyboard) and `app.use("/api/v1/production/shot-analysis", route138);` (between qwenTts and storyboard mounts). `@routes-hash` comment intentionally left stale (no automated hasher exists in this repo). `routeN=138`.

### Task C — Static build + lint verification (`4db9386e`)
- `node scripts/build.js` → exit 0 (server bundle `data/serve/app.js` rebuilt, 17.5 MB; `grep -c 'shot-analysis' data/serve/app.js` = 7 → new module bundled).
- `npm run lint` (`tsc --noEmit`) → exit 0.
- `grep -c 'shot-analysis' src/router.ts` = 2 (import + mount).
- Committed file set across Tasks A+B (`git diff --name-only HEAD~2 HEAD`) = exactly the 5 deliverables; the pre-existing dirty `src/routes/production/ltx/msr.ts` and `docs/architecture.md` / `docs/ltx-msr-bgm-detection.md` were NOT staged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ZodError `.errors` typing**
- **Found during:** Task B verification (tsc --noEmit)
- **Issue:** `Property 'errors' does not exist on type 'ZodError<unknown>'` on the `err.errors` access in the validation catch block — zod version typing quirk under this repo's `tsconfig.json` (`strict: true`, zod installed version).
- **Fix:** Cast `(err as any).errors`, mirroring the established codebase pattern at `src/routes/production/flux/sceneGenerate.ts:310` (`(err as any).errors`). No behavioral change.
- **Files modified:** `src/routes/production/shot-analysis/index.ts`
- **Commit:** `2472721f`

**2. [Rule 3 - Blocking] Header comment tripped the thin-wrapper grep gate**
- **Found during:** Task B verification
- **Issue:** The plan's `<verify>` gate `grep -E "axios|/prompt|/history"` (which exists to ensure no ComfyUI HTTP client calls leak into TS) was matching my own descriptive header comment that literally contained those substrings ("所有 ComfyUI workflow 构建 + /prompt + /history 轮询逻辑... TS 侧不出现 axios..."). False positive — no actual client calls existed.
- **Fix:** Reworded the comment to avoid the literal substrings ("prompt 提交 / history 轮询逻辑... 不直接调 ComfyUI HTTP"). Gate intent preserved (it still catches any real `axios` import / `/prompt` POST / `/history` GET).
- **Files modified:** `src/routes/production/shot-analysis/index.ts`
- **Commit:** `2472721f`

### Intentional Plan Overrides (per launching orchestrator's constraints)

**Commit cadence — atomic per-task commits instead of single end-of-plan staged commit.**
- **Plan said:** Task C "leave the 5 files staged; do NOT commit" (assumed one combined commit of all 5 deliverables at the end).
- **Orchestrator constraints said:** "Commit each task atomically" and named the third commit message `chore(260723-pn1): build/lint verification`.
- **Resolution:** Honored the orchestrator's override — Tasks A and B each committed their files atomically; Task C is verification-only (all source already committed, `data/serve/app.js` is gitignored), so its commit is an empty `--allow-empty` audit-trail record documenting that build/lint passed. The plan's `git diff --cached --name-only` staged-set check is N/A under the atomic-commit model (files are committed, not staged); the equivalent guarantee — "exactly the 5 deliverables, no pollution" — was verified via `git diff --name-only HEAD~2 HEAD` (see Task C above).

## Verification (all static — no container, no ComfyUI, no live HTTP)

| # | Check | Result |
|---|-------|--------|
| 1 | `diff -q /tmp/shot_analysis_driver.py scripts/shot-analysis/shot_analysis_driver.py` | identical (no output) |
| 2 | `npm run lint` (tsc --noEmit) | exit 0 |
| 3 | `node scripts/build.js` | exit 0 |
| 4 | `grep -c 'shot-analysis' src/router.ts` | 2 (≥2) |
| 5 | `grep -cE 'axios\|/prompt\|/history' src/routes/production/shot-analysis/index.ts` | 0 (THIN wrapper confirmed) |
| 6 | committed file set = 5 deliverables, no `ltx/msr.ts` / `docs/*` pollution | confirmed |

## Known Limitations (carried from driver, documented in README — NOT bugs in this plan)

- **Subject layer (`--subject`) blocked by sam3.pt download failure** — HF xet CDN unreachable from the container; `hf-mirror` forces xet redirect. Geometry + semantic layers work end-to-end. This is a pre-existing infrastructure issue, not introduced by this plan, and explicitly out of scope to fix.
- **`--video` must be container-visible** — the route mitigates this via `docker cp` staging, but callers passing unusual host paths still rely on the staging logic. Paths already under `/root/ComfyUI/` or `/mnt/agents/` are passed through untouched.

## Self-Check: PASSED

- `scripts/shot-analysis/shot_analysis_driver.py` — FOUND (committed, diff-clean vs /tmp source)
- `scripts/shot-analysis/README.md` — FOUND (committed)
- `src/routes/production/shot-analysis/_shared/config.ts` — FOUND (committed)
- `src/routes/production/shot-analysis/index.ts` — FOUND (committed)
- `src/router.ts` — FOUND (committed; import + mount present)
- Commit `170938b6` — FOUND (Task A)
- Commit `2472721f` — FOUND (Task B)
- Commit `4db9386e` — FOUND (Task C)
