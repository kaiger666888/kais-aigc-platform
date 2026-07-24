# Quick 260724-jsj: shot-analysis → gold-team v6 queued task

## Goal
把 shot-analysis 从"直接打 comfyui 的旁路"改成 **gold-team v6 排队任务**:与 LTX 串行、GPUGuard 管 VRAM(不 OOM)、跑完不常驻。

## Architecture (复用 ComfyUIEngine,不新建 engine 类)
`POST /tasks`(type=SHOT_ANALYSIS + params) → async queue → executor worker 串行取 → GPUGuard 在 OOM 前 evict → ComfyUIEngine.submit(workflow) → poll → 读 shot JSON → task output。

## Files (全在 /tmp/sa-goldteam = feat/shot-analysis-goldteam 分支)

### 1. `docker/gold-team/src/v6/models/task.py`
TaskType 枚举加:`SHOT_ANALYSIS = "shot_analysis"`  # 逐镜头运镜解构(几何+语义+主体)

### 2. `docker/gold-team/src/v6/engines/workflow_builder.py`
加 `build_shot_analysis_workflow(shot, video, *, semantic=True, subject=False, grid_n=20, fps=24.0, save_dir="/mnt/agents/output/gpu1/shot_analysis", qwen_model="Qwen3-VL-8B-Instruct", quant="8-bit (Balanced)")` → 返回 ComfyUI API prompt dict。
**移植 `/tmp/shot_analysis_driver.py` 的 `build_prompt` + `SEMANTIC_PROMPT`(v2)逻辑,原样**(已验证:几何+语义+主体三层,Merged SAM3,绝对 save_dir)。shot = {"id","start_sec","end_sec"}。

### 3. `docker/gold-team/src/v6/executor.py`
- `_TASK_OUTPUT_FIELDS` 加 `TaskType.SHOT_ANALYSIS: {"analysis": "shot.json"}`
- 派发分支 `elif task.type == TaskType.SHOT_ANALYSIS:`:从 task.params 取 `video`(容器可见路径)、`shot_id`、`start_sec`、`end_sec`、`semantic`、`subject`、`grid_n`、`fps` → `build_shot_analysis_workflow(...)` → 设 `workflow`。
- **输出处理(关键)**:shot-analysis 的产物是 ShotJSONMerge 落盘的 `shot_XXX.json`(在 save_dir),**不在 ComfyUI history 的 media outputs 里**。跑完 poll=completed 后,读该 JSON 文件,把 `{shot_id, geometry, semantic, subject, conflict, need_api_review}` 设进 task output(而非依赖 ComfyUIEngine.get_output 的 media 解析)。若公共执行段不允许自定义 output,则在 SHOT_ANALYSIS 分支内自行 submit→poll→读JSON→`store.update(COMPLETED, output=...)` 后 return(参考其他分支的 FAILED-early-return 模式)。

### 4. `src/routes/production/shot-analysis/index.ts`
改成**薄代理**:不再 spawn driver 打 comfyui,而是 `POST http://gold-team:8002/tasks`(`{type:"shot_analysis", params:{video, shot_id, start_sec, end_sec, semantic, subject, grid_n}}`)→ 轮询 `GET /tasks/{id}` 到 completed → 返回 output。保留 docker cp 暂存视频到容器可见路径的逻辑(喂给 params.video)。

## Task params (task.params dict,TaskCreateRequest 已支持自由 params)
`video`(容器可见)、`shot_id`、`start_sec`、`end_sec`、`semantic`(默认 true)、`subject`(默认 false)、`grid_n`(默认 20)、`fps`(默认 24)。一个 task = 一个镜头。

## Verify (静态,gold-team 容器未 redeploy 前无法活测)
- `python3 -c "import ast; ast.parse(open('docker/gold-team/src/v6/engines/workflow_builder.py').read())"` 等三个 .py 语法 OK
- `python3 -c "from docker.gold_team... "` 不可行(路径),改用:在 gold-team 容器内 `docker exec kais-gold-team python3 -c "import sys; sys.path.insert(0,'/app'); from src.v6.engines.workflow_builder import build_shot_analysis_workflow; print('import OK')"`(但容器是旧代码——所以仅做 AST 语法检查 + 逻辑 review,活测留 redeploy 后)
- TS:`node scripts/build.js` exit 0(路由改动)
- grep 确认 TaskType.SHOT_ANALYSIS + build_shot_analysis_workflow + 派发分支都在

## Out of scope (follow-up)
- gold-team 容器 redeploy(让 Python 改动生效)—— 操作性、outward-facing,单独做
- 活体串行测试(shot-analysis task + LTX task 排队、不 OOM)—— redeploy 后
- 批量(batch_create 扇出整片逐镜头 task)

## Constraints
- 仅改这 4 个文件。`/tmp/shot_analysis_driver.py` 逻辑原样移植。
- TARGETED git add(只这 4 文件)。
- 分支 feat/shot-analysis-goldteam(已在 worktree /tmp/sa-goldteam)。
