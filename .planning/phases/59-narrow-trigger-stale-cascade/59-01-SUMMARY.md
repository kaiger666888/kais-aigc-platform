---
phase: 59-narrow-trigger-stale-cascade
plan: "01"
subsystem: canvas-execute / engine-adapter / verify-gate
tags: [execute-chain, d-06, path-translation, fake-engine, a1-a2-a3-a4, phase59]
dependency_graph:
  requires:
    - fsToOssUrl (import 链既有,v2/import-from-dir.ts)
    - canvasRelationalStore listNodes/upsertNode (src/lib/canvasRelationalStore.ts)
    - 引擎活体契约 (docker/gold-team/src/v6/models/task.py:90-127)
  provides:
    - fsToOssUrl 导出 + /mnt/agents/output/ → /oss/ 翻译分支(断点②)
    - ossToEnginePath 入向翻译(/oss/ → 宿主双根白名单,T-59-01 缓解)
    - pollEngineTask 读 raw.outputs.*(断点①)+ 翻译 outputUrl
    - submitEngineTask ref_images + model_preference=cloud(image_*)+ seed 通道(断点④ + A3 + REGEN-02)
    - simulateExecution overrides(prompt/seed/params/nodeType)通道 + rethrow(断点③)+ filePath 落库(A1)
    - scripts/verify-phase-59.ts S1+S2 聚合门 + package.json verify:phase-59
  affects:
    - src/routes/canvas/execute.ts(行为:simulateExecution 失败现真 error 广播)
    - src/routes/canvas/orchestrate.ts(行为:同上,Pitfall 5 裁定记录)
    - src/routes/canvas/storyboardPreview.ts(_engine 既有调用方签名零破坏)
tech_stack:
  added: []
  patterns:
    - fake-engine http stub(verify-phase-54 L284-328 骨架复用,127.0.0.1:0 随机端口)
    - 隔离 chdir(verify-phase-51 模式:mkdtemp + package.json 拷贝,@/utils/db IIFE 落临时目录)
    - WR-01 教训:命令门不经 shell 管道,maxBuffer 16MB
    - 双根白名单 fs.existsSync 探测(T-59-01 缓解,replaceUrl.ts L14-21 先例)
key_files:
  created:
    - scripts/verify-phase-59.ts
  modified:
    - src/routes/canvas/v2/import-from-dir.ts
    - src/routes/canvas/_engine.ts
    - src/routes/canvas/_simulate.ts
    - package.json
decisions:
  - A1: 成功产物 filePath 落库(outputUrl 非 null → upsertNode data.filePath = /oss/ web 路径);落库失败仅 console.error,不把成功翻成 error
  - A2: mix/composite 有意不进 NODE_TYPE_TO_TASK_TYPE,console.log warn 后 simulateOnly(引擎无混音/合成 TaskType,守批量路径稳定)
  - A3: image_* taskType 平铺 model_preference:'cloud'(平台政策 2026-08-19 t2i 5.0/i2i 4.6 白名单走 :8002 gateway cloud-jimeng);video/tts 等不动
  - A4: storyboard 保持 image_draw,不解析上游参考;ref 化的 image_draw_ipadapter 是 storyboardPreview 专用路径(最小实现)
  - D-06③: 引擎调用 catch rethrow,不再 simulateOnly 假成功;GOLD_TEAM_URL 未配置 + 无 prompt 两个 simulateOnly 分支合法保留
  - REGEN-02: seed 通道经 metadata 平铺达 params.seed;cloud 路径 dreamina CLI 不接受 seed,确定性重放仅本地 ComfyUI 路径成立(已知边界如实记录)
metrics:
  duration_min: 12
  tasks_completed: 3
  files_modified: 5
  completed_at: "2026-08-23T16:39:53Z"
---

# Phase 59 Plan 01: execute 链修真 + verify-phase-59 聚合门骨架 Summary

**One-liner:** 把 canvas→引擎 execute 链的四个断点(① outputs.* 读取 / ② 容器路径翻译 / ③ 假成功 / ④ ref_images 键名)全部对齐 :8002 活体契约,并立起 verify-phase-59 聚合门骨架——「成功」信号从此为真,STALE-01/02 级联语义才可靠。

## What Was Built

### Task 1 — 双向路径翻译 + verify-phase-59 聚合门骨架 (commit `8ebef7f5`)

- `src/routes/canvas/v2/import-from-dir.ts`:`fsToOssUrl` 改导出,新增 `/mnt/agents/output/` → `/oss/` 纯字符串翻译分支(断点②);doc 注释钉 59-01 动机(app.ts:74-87 /oss 静态链已能服务,不依赖 `_workdirToOss` 全局态)。
- `src/routes/canvas/_engine.ts`:新增并导出 `ossToEnginePath(input)`——空/非 string → null;`/oss/...` → `path.posix.normalize` + 拒绝 `..` 上溯(T-59-01 缓解,replaceUrl.ts L14-21 先例)+ `fs.existsSync` 双根白名单探测(`/mnt/agents/output` 与 `data/oss`,引擎容器 Mounts 实证只挂这两个根,Pitfall 3);其余宿主绝对路径与 http(s) 原样透传。
- `scripts/verify-phase-59.ts` 新建:复刻 verify-phase-58 全骨架(assert/runCmd WR-01 教训 maxBuffer 16MB/shadowAssert forced-failure/退出码 0-1-2)+ verify-phase-51 隔离 chdir 模式(mkdtemp + package.json 拷贝,@/utils/db IIFE 落临时目录,生产 db 绝不被打开);S1 双向翻译 8 断言全 PASS。
- `package.json`:scripts 注册 `verify:phase-59`。

### Task 2 — _engine.ts 引擎契约对齐 (commit `02ad9590`)

- `pollEngineTask` completed 分支改读引擎活体形状 `raw.outputs.{image,video,audio,thumbnail}`(断点①,实证形状 docker/gold-team/src/v6/models/task.py:90-127);旧 `output_url/outputUrl` 保留兜底无害。containerPath 经 `fsToOssUrl` 翻译为 `/oss/` web 路径(断点②);http(s) CDN 直链透传;不可翻译 → null。
- `submitEngineTask`:referenceImages 先经 `ossToEnginePath` 翻译并 filter null;payload 键名 `reference_images` → `ref_images`(断点④,引擎 v6 cloud 直通表 executor.py:703-717),仅非空数组时展开。
- A3 裁定落地:taskType 以 `image` 开头平铺 `model_preference:'cloud'`(平台政策 2026-08-19 t2i 5.0/i2i 4.6 白名单走 :8002 gateway cloud-jimeng);video/tts 等不动;T-59-03 accept 服务端常量非用户输入。
- REGEN-02 seed 通道打通:metadata 展开行注释钉死「调用方经 input.metadata 平铺即达 params.seed」(59-02 接线前提);已知边界(cloud 路径 dreamina CLI 不接受 seed,确定性重放仅本地 ComfyUI 成立)如实记录。
- `verify-phase-59.ts` S2 段:进程内 `http.createServer` fake 引擎 listen 127.0.0.1 随机端口,`process.env.GOLD_TEAM_URL` 指向它直调(baseUrl() 运行时读);三模式断言 9 条全 PASS——completed 模式 outputUrl = `/oss/jimeng_T6384/output.png`、failed 模式抛 `Error("Generation timed out")`、image_draw 提交体 ref_images 宿主路径 + model_preference=cloud + seed=12345、video_final 无 model_preference 键。

### Task 3 — _simulate.ts 真化 (commit `957e4a26`)

- `readNode` 关系表化:改走 `canvasRelationalStore.listNodes`,旧 canvasGraph JSON blob 查询删除(v2 项目 blob 下 readNode 恒 null → 恒 simulateOnly,是 D-06③ 假成功的结构性根因);legacy-blob-only 项目落 simulateOnly 兜底(本就无关系表真值,无回归)。
- `NODE_TYPE_TO_TASK_TYPE` 扩表补 V3 Stage(Pitfall 6):`global`/`keyframe` → `image_draw`、`voice` → `tts`、`foley` → `sfx`、`bgm` → `music`。`storyboard` 保持 `image_draw`(A4 裁定:ref 化 ipadapter 是 storyboardPreview 专用路径,最小实现不解析上游参考)。`mix`/`composite` 有意不进表(A2 裁定:引擎无混音/合成 TaskType,console.log warn 后 simulateOnly 守批量路径稳定)。
- `simulateExecution` 第 4 参 `overrides?: { prompt, seed, params, nodeType }`(可选,既有调用方 orchestrate/execute 不传零影响,59-02 接线前提);nodeType overrides 优先(V3 Stage 权威),store node.type 剥 skill 前缀保留兜底;effective prompt = overrides.prompt ?? extractPrompt。
- D-06③ 断点③:引擎调用 catch 去 simulateOnly 假成功——console.error(去「降级模拟」字样)后 `throw err`,execute.ts L72-73 与 orchestrate.ts L102-108 既有 error 广播接管,「成功」信号从此为真。`GOLD_TEAM_URL` 未配置 + 无 prompt 两个 simulateOnly 分支合法保留。
- A1 裁定:成功产物 filePath 落库——`node:preview` 广播后 outputUrl 非 null 时把 `/oss/` web 路径经 `upsertNode` 写回节点 `data.filePath`(reload 可见,与 import 链 filePath 语义一致);外裹 try/catch console.error,落库失败不得把成功翻成 error。
- 文件头补 59-01 行为变化声明(Pitfall 5 裁定:orchestrate 共享本函数,其执行载荷随之变真——orchestrate 自身目标筛选读法本 phase 不动,SC3「零变化」限定为 stale 级联零触发 + 无 regen 通道结构保证)。

## Verification Evidence

| Gate | Result |
|------|--------|
| `npm run verify:phase-59` | 18/18 PASS,exit 0(S1 双向翻译 8 + S2 fake 引擎三模式 9 + forced-failure self-check 1) |
| `npx tsc --noEmit` (root) | exit 0(storyboardPreview 等既有调用方零破坏) |
| `grep -c "o_agentWorkData" src/routes/canvas/_simulate.ts` | 0 |
| `grep "reference_images" src/routes/canvas/_engine.ts` | 仅命中注释行 |
| 映射表五键 (global/keyframe/voice/foley/bgm) | 全部命中 |
| catch 块 `throw err` + 无 `return simulateOnly` | 确认 |
| 三 commit 零 deletion(`git diff --diff-filter=D HEAD~1 HEAD`) | 全部为空 |

## Deviations from Plan

**None** — plan executed exactly as written. 所有自动化断言一次通过,未触发 Rule 1-4。

(说明:verify-phase-59.ts S2 段原 PLAN 建议「设 `ENGINE_POLL_INTERVAL_MS=10`」,经查证 `_engine.ts` 的 `POLL_INTERVAL` 是模块顶层常量,import 后不再读取 env;fake 引擎第一次 GET 即返回 completed/failed,不触发 sleep,遂移除该行避免误导,注释同步说明。属文档级纠偏,无行为差异。)

## Auth Gates

None.

## Known Stubs

None. `_simulate.ts` 中 `simulateOnly` 保留分支(GOLD_TEAM_URL 未配置 + 无 prompt + mix/composite)是计划内合法降级,不是 stub。

## Threat Flags

None. 本 plan 实现的所有 threat mitigation(T-59-01 穿越拒绝、T-59-02 不拼接 HTML、T-59-03 服务端常量)均已落地;未引入 plan 外的新攻击面。

## Requirements Closed

- **STALE-01 / STALE-02 前置条件**:「成功」信号为真(D-06 断点③修真)——本 plan 把引擎故障时 100% 假成功的窟窿堵死,后续 59-02 级联触发才有真语义。
- **REGEN-02 通道就绪**:seed 经 metadata 平铺即达 params.seed(59-02 接线即可)。
- **D-06 断点①②③④ + 引擎活体契约对齐**:全部修复并有 S1/S2 自动化证据。

## Self-Check: PASSED

- `scripts/verify-phase-59.ts` FOUND
- `src/routes/canvas/v2/import-from-dir.ts` 含 `export function fsToOssUrl` FOUND
- `src/routes/canvas/_engine.ts` 含 `export function ossToEnginePath` 与 `posix.normalize` FOUND
- `src/routes/canvas/_simulate.ts` 含 `listNodes` 与 `upsertNode` 导入 FOUND
- `package.json` 含 `verify:phase-59` FOUND
- Commit `8ebef7f5` (Task 1) FOUND in `git log`
- Commit `02ad9590` (Task 2) FOUND in `git log`
- Commit `957e4a26` (Task 3) FOUND in `git log`
