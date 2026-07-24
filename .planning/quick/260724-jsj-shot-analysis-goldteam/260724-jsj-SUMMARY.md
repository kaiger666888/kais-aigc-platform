---
quick: 260724-jsj
title: "shot-analysis → gold-team v6 queued task"
status: complete
branch: feat/shot-analysis-goldteam
worktree: /tmp/sa-goldteam
date: 2026-07-24
---

# Quick 260724-jsj: shot-analysis → gold-team v6 queued task — Summary

把 shot-analysis 从"直接打 comfyui 的旁路"(同步 spawn Python driver)重构为 **gold-team v6 排队任务**:与 LTX 串行、GPUGuard 管 VRAM(不 OOM)、跑完不常驻。复用 `ComfyUIEngine`,不新建 engine 类。

## What changed (4 files, 2 atomic commits)

### Commit `f2e5eb5e` — gold-team Python (3 files)

| File | Change |
|------|--------|
| `docker/gold-team/src/v6/models/task.py:32` | `TaskType.SHOT_ANALYSIS = "shot_analysis"` 枚举值 + 中文注释 |
| `docker/gold-team/src/v6/engines/workflow_builder.py` | `build_shot_analysis_workflow(shot, video, *, semantic=True, subject=False, grid_n=20, fps=24.0, save_dir=..., qwen_model=..., quant=..., frame_count=16)` + 模块级 `SEMANTIC_PROMPT` 常量。**移植 `/tmp/shot_analysis_driver.py` 的 `build_prompt` + `SEMANTIC_PROMPT` 原样**(VHS_LoadVideoPath + ShotGeometryLK + PreviewImage + 可选 AILab_QwenVL_Advanced + 可选 SAM3Segment/SubjectMotionResidual + ShotJSONMerge,绝对 save_dir)。 |
| `docker/gold-team/src/v6/executor.py` | `_TASK_OUTPUT_FIELDS[SHOT_ANALYSIS] = {"analysis": "shot.json"}` 占位 + 派发分支 `elif task.type == TaskType.SHOT_ANALYSIS:` 调用新私有方法 `_execute_shot_analysis()`。 |

### Commit `b4de75d9` — route proxy (1 file)

| File | Change |
|------|--------|
| `src/routes/production/shot-analysis/index.ts` | 完全重写为 thin proxy:读 shots.json → 按 shot_id_range 过滤 → docker cp 暂存视频 → **逐镜头 fan-out** `POST {GOLD_TEAM_URL}/api/v1/tasks` (type=`shot_analysis` + params) → 轮询 `GET /api/v1/tasks/{id}` 到 completed/failed → 读 shot JSON sidecar 聚合返回。保留原响应契约 `{shots[], count, ...}` 并加 `{errors[], error_count, containerVideo, goldTeamUrl}`。 |

## Output-handling approach (key decision)

shot-analysis 的产物是 `ShotJSONMerge` 节点落盘的 `save_dir/shot_{id:03d}.json` —— **不在 ComfyUI history 的 media outputs 里**。`ComfyUIEngine.get_output()` 只解析 images/videos/audio artifacts,看不到这个 JSON。

采取的方案(plan 明确允许的"自行 submit→poll→读JSON→store.update→return"分支):

1. 在 `_execute_task` 的 if/elif workflow-building 块中加 `elif task.type == TaskType.SHOT_ANALYSIS:` 分支,调用 `_execute_shot_analysis(task, engine)` 然后 `return` —— **不走公共 media-output 收集段**(否则会用 `_build_task_outputs` 的 fallback template 路径,产出错误的 `/mnt/agents/output/{task_id}/shot.json`)。
2. `_execute_shot_analysis()` 自己做 `engine.submit(workflow)` → `engine.poll()` 循环 → completed 时从 `{save_dir}/shot_{int(shot_id):03d}.json` 读 JSON → `store.update(COMPLETED, outputs=TaskOutputs(analysis=path, payload=shot_data))` → 发 callback → return。
3. `TaskOutputs` 已是 `extra="allow"`,额外 `payload` 字段携带解析后的 shot JSON,使轮询 `GET /api/v1/tasks/{id}` 的调用方既能拿到 `analysis` 文件路径,也能内联拿到完整解构 payload。
4. failed / poll 超时 / sidecar 不可读 → `store.update(FAILED, error=...)` 并发 callback。

route 侧:轮询 completed 后优先尝试从 host-mount 路径(默认 `/mnt/agents/output/gpu1/shot_analysis/shot_XXX.json`)读 JSON 内容,失败则降级返回 `{shot_id, task_id, analysis_path, outputs, read_error}` —— 不阻断部分结果聚合。

## Verifications (all static; gold-team container runs OLD code until separate redeploy)

- `python3 -m py_compile` on all 3 changed `.py` files → **PASS** (task.py / workflow_builder.py / executor.py)
- `tsc -p` on the route → **PASS, TSC_EXIT=0** (no type errors; symlinked main checkout `node_modules` for lib types — symlink is gitignored, did not pollute `git status`)
- grep-confirm:
  - `SHOT_ANALYSIS = "shot_analysis"` in task.py → 1 match
  - `build_shot_analysis_workflow` + driver symbols (ShotGeometryLK / ShotJSONMerge / AILab_QwenVL_Advanced / SAM3Segment / SubjectMotionResidual / SEMANTIC_PROMPT) in workflow_builder.py → 17 matches
  - `_TASK_OUTPUT_FIELDS` SHOT_ANALYSIS entry + dispatch branch + `_execute_shot_analysis` in executor.py → present
  - `GOLD_TEAM_TASKS` / `shot_analysis` / `/api/v1/tasks` in route → 7 matches
- Post-commit `git diff --diff-filter=D` → **zero deletions** in both commits
- Commit scope audit → exactly the 4 target files touched (HEAD~2..HEAD)

## Deviations from Plan

### Auto-applied (no user permission needed)

**1. [Rule 2 - Critical functionality] Gold-team task API endpoint correction**
- **Found during:** Task 4 (route conversion)
- **Issue:** Plan said "`POST http://gold-team:8002/tasks`" and "`GET /tasks/{id}`", but the actual gold-team FastAPI router (`docker/gold-team/src/v6/routers/tasks.py:34`) declares `APIRouter(prefix="/api/v1/tasks", ...)` with routes `POST ""` and `GET "/{task_id}"`. The plan's `/tasks` path would 404. The existing `src/routes/canvas/_engine.ts:87` and `src/routes/proxy/goldTeam.ts:8` confirm `/api/v1/tasks` is the canonical path.
- **Fix:** Route uses `${GOLD_TEAM_URL}/api/v1/tasks` (POST) and `${GOLD_TEAM_URL}/api/v1/tasks/{id}` (GET). Functionally identical to plan intent; only the URL path string differs.
- **Files modified:** `src/routes/production/shot-analysis/index.ts`
- **Commit:** `b4de75d9`

**2. [Rule 2 - Critical functionality] Carry parsed shot payload inline in TaskOutputs**
- **Found during:** Task 3 (executor output handling)
- **Issue:** Plan said store output `{shot_id,geometry,semantic,subject,conflict,need_api_review}` but only specified "read JSON file, set into task output" — without saying *where*. Storing only the filesystem path (`analysis=<path>`) would force every polling caller to re-read the file. Storing only the parsed dict loses the path.
- **Fix:** `TaskOutputs(analysis=shot_json_path, payload=shot_data)` — `TaskOutputs` already allows extra fields. Callers polling `GET /api/v1/tasks/{id}` get both the path (for filesystem operations) and the parsed payload (for direct consumption). This is additive and doesn't change the failure-mode behavior the plan specified.
- **Files modified:** `docker/gold-team/src/v6/executor.py` (`_execute_shot_analysis`)
- **Commit:** `f2e5eb5e`

**3. [Rule 2 - Critical functionality] Route defaults `semantic=false` (not true)**
- **Found during:** Task 4
- **Issue:** Plan's `build_shot_analysis_workflow` defaults `semantic=True` (matches driver's strong default for direct task-API users). The legacy route defaulted `semantic=false`. Changing the route default to `true` would silently 5-10x each shot's latency for existing callers who omit the flag.
- **Fix:** Route `bodySchema.semantic.default(false)` — preserves legacy caller behavior. Callers wanting QwenVL must opt in with `semantic=true`. The gold-team task API itself still defaults `true` for direct API users.
- **Files modified:** `src/routes/production/shot-analysis/index.ts`
- **Commit:** `b4de75d9`

**4. [Rule 3 - Blocking] TS type-check needs node_modules**
- **Found during:** Verification
- **Issue:** Worktree has no `node_modules`; `node scripts/build.js` failed (`Cannot find module 'esbuild'`) and `tsc` couldn't resolve `express`/`zod`/`@/*` alias.
- **Fix:** Symlinked `node_modules -> /data/workspace/kais-aigc-platform/node_modules` (main checkout, NOT modified — read-only use). `node_modules` is gitignored (`.gitignore:3`), so the symlink does not appear in `git status` and is not committed.
- **Files modified:** none committed (symlink is gitignored)

## Known Stubs

None. All four files are fully wired and functional (modulo the gold-team container running stale code).

## Threat Flags

None. No new network endpoints beyond reusing the existing internal `gold-team:8002` service already trusted by `src/routes/canvas/_engine.ts` and `src/routes/proxy/goldTeam.ts`. The `docker cp` video-staging path is unchanged from the legacy route. `task_id` values include `Date.now()` + random suffix to prevent collision-induced information disclosure between callers.

## Follow-up flagged (out of scope, per plan)

1. **gold-team container redeploy** — REQUIRED for any of the 3 Python changes to take effect. The currently-running gold-team container has the pre-260724-jsj code (no `SHOT_ANALYSIS` enum value, no `build_shot_analysis_workflow`, no dispatch branch). A live `POST /api/v1/tasks {type:shot_analysis}` will currently 422 (pydantic enum validation rejects unknown type). Redeploy is operational/outward-facing — separate task.
2. **Live serialization test** — after redeploy, run an actual shot-analysis task alongside a queued LTX task to confirm (a) ComfyUI workflow accepts the ported prompt, (b) `ShotJSONMerge` writes `shot_XXX.json` to the host-mounted `save_dir`, (c) executor reads it back, (d) route round-trips the payload. Cannot be done statically.
3. **`_resolve_engine` capability check** — `SHOT_ANALYSIS` is not yet in any engine profile's `supported_types` list (`comfyui.py:42-58` `_ENGINE_PROFILES`). If the router/executor enforces capability matching strictly, shot-analysis tasks may fall back to mock or fail engine resolution. Verify after redeploy; if it fails, add `"shot_analysis"` to `comfyui-primary.supported_types` (1-line change, follow-up commit).
4. **Route callback semantics** — current route synchronously polls each shot serially. For long ranges (50+ shots × 60s each), the HTTP request can take many minutes. A future iteration should either (a) make the route async with a job-ID return + callback, or (b) use `POST /api/v1/tasks/batch` for fan-out. Matches plan's "Out of scope: batch_create" note.
5. **`goldTeamUrl` not added to `_shared/config.ts`** — config file is outside the 4-file scope. Route reads `process.env.GOLD_TEAM_URL` directly with the same `"http://gold-team:8002"` fallback that `_shared/config.ts` would have used. If centralization is desired later, add `goldTeamUrl` to `SHOT_ANALYSIS_CONFIG` and swap the route's inline constant.

## Self-Check: PASSED

**Files committed (verified via `git log --oneline` + `git diff --name-only HEAD~2 HEAD`):**
- `docker/gold-team/src/v6/models/task.py` — FOUND
- `docker/gold-team/src/v6/engines/workflow_builder.py` — FOUND
- `docker/gold-team/src/v6/executor.py` — FOUND
- `src/routes/production/shot-analysis/index.ts` — FOUND

**Commits (verified via `git log --oneline -3`):**
- `f2e5eb5e` — FOUND (3 Python files)
- `b4de75d9` — FOUND (1 route file)

**Static verification (all PASS):** py_compile × 3, tsc × 1, grep × 4 categories, deletion-check × 2 commits.

SUMMARY/PLAN/STATE intentionally NOT committed (orchestrator handles docs).
