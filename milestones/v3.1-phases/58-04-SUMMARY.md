---
phase: 58-full-recipe-persistence
plan: 04
subsystem: testing
tags: [verify-gate, aggregate-gate, three-way-set-equality, recipe-roundtrip, real-machine-probe, zero-footprint, playwright, forced-failure]

# Dependency graph
requires:
  - phase: 58-full-recipe-persistence plan 01
    provides: recipe.ts 零依赖常量契约(RECIPE_ROUNDTRIP_KEYS/RECIPE_EDITABLE_FIELDS) + serialize delete 传播 + migrate 映射表提取——本 plan 断言/探测的被测语义与常量侧
  - phase: 58-full-recipe-persistence plan 02
    provides: canvasAssetSchema 五分支五键 optional 声明(三方断言 schema 侧) + 高级参数编辑器(探针的 UI 操作面)
  - phase: 58-full-recipe-persistence plan 03
    provides: phase58-recipe.mjs e2e 语义锁定(70 用例基线)——phase 收尾三件套的 e2e 腿
provides:
  - verify:phase-58 聚合门(RECIPE-04):三方集合相等 + 九键 regex 交叉验证 + 消费证据 + nullish 计数锁 + S5 命令门 + forced-failure 自检,25/25 全绿
  - probe-58-real.mjs 真机零足迹探针(:10588 生产链路 RECIPE-01 实证:编辑→保存 200→wire 往返→面板 reload 保真→净足迹 0)
  - Phase 58 收尾三件套齐绿(verify 门 + e2e 70/70 + probe)
affects: [59-stale-cascade, verify-work-58, 60-panel-persistence]

# Tech tracking
tech-stack:
  added: []  # 零新依赖
  patterns:
    - "三方集合相等断言(planner 裁决 4 构造):常量侧零依赖相对 import ↔ schema 侧同仓 import shape 键 ↔ 高级子集推导——三串排序字符串严格相等,任一侧漂移即红"
    - "regex 文本提取替代 zod 对象 import 做跨包键集交叉验证(三包 zod 版本分裂 4.3.5/3.25.76/3.23.8,只共享字符串键集,Pitfall 4)"
    - "真机零足迹捕获-恢复探针:先 load-v2 捕获原图,finally saveV2 原图回存 + stripUpdatedAt deepEqual 复核净足迹=0;不可达输出 SKIP 非假绿"

key-files:
  created:
    - scripts/verify-phase-58.ts
    - packages/infinite-canvas/test/e2e/probe-58-real.mjs
  modified:
    - package.json

key-decisions:
  - "三方断言构造照 planner 裁决 4:recipe.ts 相对路径 import(tsx 直连零解析风险)+ assetDataSchemas 同仓 zod v4 import 取 shape 键 + zod.ts 九键 regex 文本提取——绝不 import 跨包 zod 对象"
  - "计数锁做满五键(steps/cfg/quant/sageAttention/lora 各恰 5 处)而非 plan 下限的 sageAttention/lora 两键——五分支漏声明任一键即红,门强度只增不减"
  - "门可红性双保险:forced-failure shadow 组 5 条全 FAIL(含 sampler 必然失败项,A1 字段集锁定五键)+ 执行时手测(临时注释 audio 分支 sageAttention → S1 三方断言红 → 还原复绿)"
  - "deploy 序列按 deploy-canvas.sh 内建 build 执行(脚本自含 npm run build+备份+cp,单独前置 build 会被脚本重建覆盖,语义等价);:10588 重启沿用既有启动命令行(NODE_ENV=production PORT=10588 setsid nohup node data/serve/app.js)"

patterns-established:
  - "Pattern: Phase 50/51/52 式聚合门传统延续到 58——verify:phase-NN 作为 phase 验收门注册 package.json,S5 命令门(三根 tsc+双包 vitest)+ forced-failure 自检证明门能红"
  - "Pattern: 真机探针 SKIP 语义——环境不可达时输出 SKIP 理由+补跑命令并退出非零,延后探针不阻塞 verify 门(RESEARCH Environment Availability fallback 条款)"

requirements-completed: [RECIPE-04, RECIPE-01]

# Metrics
duration: 8 min
completed: 2026-08-23
---

# Phase 58 Plan 04: RECIPE-04 防漂移聚合门 + 真机零足迹探针 Summary

**verify:phase-58 三方集合相等门(recipe.ts 常量 ↔ canvasAssetSchema 五分支 shape 键 ↔ ROUNDTRIP 高级子集,25/25 全绿+forced-failure 5/5+红性手测)+ probe-58-real 生产 :10588 实证 RECIPE-01 编辑往返保真与零足迹恢复——Phase 58 收尾三件套(verify/e2e/probe)齐绿**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-23T13:41:47Z
- **Completed:** 2026-08-23T13:49:56Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `scripts/verify-phase-58.ts` 新建(Phase 50/51/52 聚合门传统):S1 三方集合相等(五分支配方键互相相等 + modelVersion↔engine 唯一非恒等映射锁) / S2 九键 regex 交叉验证(不 import zod 对象) / S3 消费证据(migrate 映射表驱动禁手写键回潮 + serialize 运行时 import + delete 传播 + script prompt 例外) / S4 五键计数锁各恰 5 处 / S5 三根 tsc + 双包 vitest 命令门 / forced-failure 自检 5 条全按预期 FAIL
- `package.json` 注册 `verify:phase-58`(verify 块内恰 1 处)——RECIPE-04 防漂移门成为 phase 验收门
- 门可红性双验证:forced-failure shadow 组(sampler 不在 EDITABLE 等必然失败项)全 FAIL;执行时手测临时注释 audio 分支 sageAttention 一行 → S1 三方断言变红(`audio=[cfg,lora,quant,steps]` 缺 sageAttention)→ 还原后 25/25 复绿
- `probe-58-real.mjs` 真机零足迹探针(200 行,复用 probe-52-real Part B 骨架):部署前置纪律头注释锁定(build → deploy-canvas.sh → build:server → restart,地雷 #10);:10588 不可达输出 SKIP 非假绿
- 真机实证全绿:P1 编辑 steps=40/cfg=6 → 保存 save-v2 200;P2 wire 断言 load-v2 `a-p04-art4 data.steps===40 && data.cfg===6`;P3 面板 reload 往返(advanced-toggle 展开,值 40/6);P4 原图回存 stripUpdatedAt deepEqual 全等(净足迹=0,结束后节点无 steps/cfg 残留、prompt 906 字原样)
- 部署序列实跑:deploy-canvas.sh(build+备份 dist → data/web/infinite-canvas)→ build:server → :10588 重启(load-v2 200,479 节点,a-p04-art4 prompt-only 零 steps 存量与 RESEARCH 裁定一致)

## Task Commits

1. **Task 1: verify-phase-58.ts 聚合门 + package.json 注册(RECIPE-04)** - `1e74b42b` (feat)
2. **Task 2: probe-58-real.mjs 真机零足迹探针 + deploy + 验证** - `cde7c4fc` (test)

**Plan metadata:** 见本文件提交(docs)

## Files Created/Modified

- `scripts/verify-phase-58.ts` — 新建:RECIPE-04 聚合门(S1 三方集合相等/S2 九键交叉/S3 消费证据/S4 计数锁/S5 命令门/forced-failure),25 断言
- `packages/infinite-canvas/test/e2e/probe-58-real.mjs` — 新建:真机零足迹探针(:10588,捕获-编辑-wire 断言-面板往返-恢复五段,stripUpdatedAt/deepEqual 深比对)
- `package.json` — scripts 块追加 `verify:phase-58` 注册(仅一行,其余注册未动)

## Verification Results（plan-level）

- `npm run verify:phase-58`:**25/25 PASSED**(S1×5 + S2×2 + S3×7 + S4×5 + S5×5 + forced-failure×1;shadow 自检 5/5 expected-FAIL,0 意外 PASS)
- 门可红性手测:注释 audio 分支 sageAttention → 重跑 **24/25 FAILED**(S1 三方断言红)→ 还原 → 25/25 复绿;git diff 确认 canvasAssetSchema.ts 还原零残留
- acceptance grep:`grep -c "verify:phase-58" package.json` = 1;verify 脚本 import 行仅 node 内建 + recipe 相对路径 + 同仓 canvasAssetSchema(无跨包 zod 对象 import);shadow assert 含 sampler 必然失败项
- `node test/e2e/probe-58-real.mjs`:**全绿**(P1 保存 200 / P2 wire 40/6 / P3 面板往返 40/6 / P4 恢复深比对全等);探针 grep:finally 块 1、stripUpdatedAt 1、deepEqual 1、头注释部署序列 3、10588 引用 7、200 行 ≥ min_lines 100
- 结束后残留复核:load-v2 `a-p04-art4` steps=(absent) cfg=(absent) prompt_len=906——零残留
- phase 收尾三件套对齐 VALIDATION phase gate:verify 门绿(本 plan)+ e2e 全量 70/70(58-03 已跑,本 plan 零 canvas src 改动不扰动)+ probe 通过(本 plan)

## Decisions Made

- 计数锁做满五键(高于 plan 下限两键):漏声明任一分支任一键即红,防漂移覆盖面最大化
- 三方断言中 schema 侧配方键集合定义为 shape 键 ∩ RECIPE_EDITABLE_FIELDS(每分支恰五键)——asset 分支另有 prompt 声明(52 先例),不与高级五键混判
- 探针 P2 wire 断言用轮询(≤10s)等 save-v2 落库后 load-v2 反映;P3 面板往返用 focus 深链整页重载(openPanel goto 即 fresh load-v2 → migrate 全集提取),与 probe-52 B2 同款真值判定

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **:10588 重启首轮 EADDRINUSE(已解决)**:`pgrep -f "node data/serve/app.js"` 首个匹配是另一会话的 bash 包装进程(2084757)而非 node 本体(2084759)——kill 错对象后旧 node 仍持端口,新实例 EADDRINUSE 崩(日志实证)。Fix:精确 PID 双杀(2084759 + 崩溃实例 2484551)→ 确认 `ss -tln` 端口 free → 同命令行重启(pid 2487701)→ load-v2 200 健康通过。对生产图零影响(重启窗口内无写入);探针照常全绿。
- **deploy 序列执行细节**:plan 文本列 `npm run build → bash scripts/deploy-canvas.sh`,实际只跑 deploy-canvas.sh——脚本自含同目录 `npm run build`(L22-24)再备份+拷贝,单独前置 build 产物会被脚本重建覆盖,语义完全等价(最终部署的就是最新构建)。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 58 全部 4 plans 完成**(01 数据通道 / 02 编辑器+schema / 03 e2e / 04 守护门+真机探针),RECIPE-01..04 全部落地并机器锁死
- Phase gate 齐绿:verify:phase-58 25/25 + e2e 70/70(58-03)+ probe-58-real 零足迹通过——可进入 `/gsd:verify-work 58`
- 59-stale-cascade 可直接消费:execute.ts extra channel 契约未动(58 零改动),RECIPE 九键全集在 EventNodeV3.params 的最终形状已由 verify:phase-58 三方锁死——STALE per-request 关联级联在此形状上挂载即可
- :10588 已跑最新 dist + 最新 server bundle(含 58-02 canvasAssetSchema 在场形状强制)——后续真机验证无需再部署,除非再改 canvas src

## Self-Check: PASSED

- created/modified 文件 3/3 在盘(scripts/verify-phase-58.ts、packages/infinite-canvas/test/e2e/probe-58-real.mjs、package.json 注册)
- commits 1e74b42b / cde7c4fc 均在 git log
- 全部 acceptance criteria 复跑通过(见 Verification Results;Task 1 门可红手测 + Task 2 探针全绿 + 残留复核)

---
*Phase: 58-full-recipe-persistence*
*Completed: 2026-08-23*
