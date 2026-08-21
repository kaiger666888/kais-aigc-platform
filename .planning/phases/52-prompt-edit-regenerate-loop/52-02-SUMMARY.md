---
phase: 52-prompt-edit-regenerate-loop
plan: 02
subsystem: wire-contract
tags: [serialize, migrate, round-trip, orchestrate, mock-backend, execute-channel, stale, recipe]

# Dependency graph
requires:
  - phase: 51-canvas-write-path-foundation
    provides: serializeGraphToV2 + save-v2 通道、migrate §14 recipeParams 重建、FlowGraphV2Schema 契约
  - phase: 52-prompt-edit-regenerate-loop/52-01
    provides: updateEventParams/persistEventParams(配方编辑写入方)、applySocketNodeState stale 清除(消费端)
provides:
  - serializeGraphToV2 事件配方反向覆盖(prompt/seed/engine 三键,script stage 例外)+ data.stale 落 wire
  - migrate.ts d.stale → StaleInfo 还原(stale 刷新即丢预存缺口修复)
  - orchestrate 服务端 + mock 双侧 stale-success 不跳过谓词(同构镜像)
  - mock logCall execute/orchestrate 记完整 body(REGEN e2e 任务参数断言观测点)
  - canvasApi.executeNode extra 参数通道 + execute.ts zod params(52-03/52-04 提交通道就绪)
affects: [52-03 PromptSection 重生成, 52-04 换 seed 重跑, 52-05 stale 重跑链, 52-06 聚合门]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "事件配方反向覆盖:经 role:'output' 边反查产生事件,在 {...raw, ...flattenMeta} 之后覆盖 data.prompt/seed/engine,canonical 事件配方为最终真值;script stage 跳过 prompt(content 真值);无事件/无字段不写不伪造"
    - "窄通道声明入注释(地雷 #3):§14 只 round-trip prompt/seed/engine 三键,steps/cfg/lora/quant 全配方持久化出范围"
    - "stale wire round-trip:序列化写 data.stale 三字段 ↔ migrate restoreStaleInfo 轻校验还原(畸形降级 null 不 throw)"
    - "mock 与生产同构镜像:orchestrate skip 谓词双侧同一条件表达式语义,e2e 与生产不分叉"
    - "logCall 完整 body:{...req.body} 全透传 + 计算字段(mode/total)保留——既有断言与新观测点兼得"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/v3/serialize.ts
    - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts
    - packages/flowgraph-v3/ts/src/migrate.ts
    - packages/flowgraph-v3/ts/tests/migrate.test.ts
    - src/routes/canvas/orchestrate.ts
    - src/routes/canvas/execute.ts
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs

key-decisions:
  - "反向覆盖只 round-trip prompt/seed/engine 三键(§14 窄通道,地雷 #3):全配方持久化出范围,注释明写防 scope creep"
  - "script stage 跳过 prompt 覆盖但允许 seed 覆盖:prompt 真值是 content(P4 防两处抄),seed 无对应 content 字段"
  - "orchestrate stale 谓词不加 force 参数(CONTEXT 锁定):stale 即需重跑语义;fixture success 节点无 stale,ORCHESTRATE-04 skipped===1 保持绿"
  - "mock orchestrate logCall body = {...req.body, mode, total}:mode/total 是计算字段不在 req.body,但 phase36/37 既有断言(body.mode/body.nodeIds)依赖,spread 透传同时满足新旧断言"
  - "migrate stale 还原轻校验降级 null 不 throw:与 migrate 宽容风格一致(畸形数据不阻塞整图迁移)"
  - "execute.ts 补 zod params 为契约诚实:validateFields 只校验不回写,extra key 本就穿透无行为变化,防未来 strip 回写踩雷;模拟器语义不变(接受并忽略)"

patterns-established:
  - "wire 富字段宽松消费:stale 未进 v2types 白名单,按 §7 cast 读取(与 thumbnailPath 先例一致)"
  - "round-trip 互逆成对落地:serialize 写 + migrate 还原同 plan 双提交(migrate 先行,保证每个提交独立全绿)"

requirements-completed: [REGEN-01, REGEN-02, REGEN-03]

# Metrics
duration: 7 min
completed: 2026-08-21
---

# Phase 52 Plan 02: wire round-trip + 服务端 stale 语义 Summary

**两颗成败手地雷双闭环:serializeGraphToV2 事件配方反向覆盖(prompt/seed/engine,script 例外)+ data.stale 落 wire,migrate d.stale 还原(修复 stale 刷新即丢);orchestrate 服务端+mock 双侧 stale-success 不跳过;mock logCall 记完整 body;executeNode extra + zod params 提交通道 W1 先行就绪。34+13 条 vitest、phase36/37 e2e 全绿。**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-08-21T11:07:48Z
- **Completed:** 2026-08-21T11:14:30Z
- **Tasks:** 4
- **Files modified:** 8

## Accomplishments

- **地雷 #1(事件配方不落盘)闭环**:序列化器对每个资产节点经 `role:'output'` 边反查产生事件,在 `{...raw, ...flattenMeta}` 之后把 `params.prompt→data.prompt`、`params.seed→data.seed`、`params.modelVersion→data.engine` 覆盖进 data 袋——canonical 事件配方为最终真值,52-01 的 updateEventParams 编辑保存+刷新后不再无声丢失;script stage 跳过 prompt(content 真值,P4);无产生事件或事件 params 缺字段不写不伪造
- **地雷 #2(stale 不上 wire)闭环**:`asset.stale != null` → `data.stale {since, triggerAssetId, triggerEventId}` 落 wire;migrate.ts L552 `stale: null` 硬编码改为 `restoreStaleInfo(d.stale)` 轻校验还原(三字段齐全才还原,畸形降级 null 不 throw)——stale 刷新即丢预存缺口连带修复,orchestrate 服务端改动有了信息源
- **REGEN-03 服务端语义双侧落地**:orchestrate.ts skip 谓词改为 `(n.state !== "success" && n.state !== "cached") || (n.data != null && n.data.stale != null)`;mock server.mjs 同构镜像(e2e 与生产语义不分叉);不加 force 参数(CONTEXT 锁定);ORCHESTRATE-04 skipped===1 兼容性实证绿(fixture success 节点无 stale)
- **地雷 #6 修复**:mock logCall 对 execute 改记完整 `req.body`,orchestrate 改记 `{...req.body, mode, total}`——"任务参数含新 prompt/seed" 的 e2e 断言观测点就绪
- **52-03/52-04 提交通道 W1 先行**:canvasApi.executeNode 第 5 参数前插 `extra?: { prompt?, seed?, params? }`,body 展开 `{...extra}`(CanvasContextMenu 零 diff,向后兼容);execute.ts zod shape 补 `params: z.record(z.string(), z.unknown()).optional()`(契约诚实,validateFields 只校验不回写故无行为变化;模拟器语义不变=接受并忽略)

## Task Commits

1. **Task 2: migrate.ts d.stale 还原 + vitest** — `d25723ec` (feat,先行提交保证每提交独立全绿)
2. **Task 1: serialize.ts 事件配方反向覆盖 + data.stale + vitest round-trip** — `5126ae91` (feat)
3. **Task 3: orchestrate stale-success 不跳过 + mock 镜像 + logCall 完整 body** — `c9c60e73` (feat)
4. **Task 4: executeNode extra 参数 + execute.ts zod params** — `927ab8af` (feat)

**Plan metadata:** 见 docs commit(SUMMARY 本文件)

## Files Created/Modified

- `packages/infinite-canvas/src/v3/serialize.ts` — 事件配方反向覆盖段(producingEventByAssetId 索引 + 三键覆盖,script 例外,窄通道注释)+ `data.stale` 序列化;头注释补 52-02 映射说明
- `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts` — asset() helper 加 stale 选项;新断言组 4 条(配方覆盖+round-trip/script 例外/不伪造/stale 落 wire+adapt∘serialize 往返保真)
- `packages/flowgraph-v3/ts/src/migrate.ts` — 新增 `restoreStaleInfo`(轻校验三字段);L552 `stale: null` → 条件还原;StaleInfo 类型 import
- `packages/flowgraph-v3/ts/tests/migrate.test.ts` — 新 describe 3 用例(stale 还原相等/缺失→null/畸形→null 不 throw)
- `src/routes/canvas/orchestrate.ts` — skip 谓词加 stale 放行分支 + 图类型注解补 `data?` 字段
- `src/routes/canvas/execute.ts` — zod shape 补 `params` 字段(契约诚实注释)
- `packages/infinite-canvas/src/services/canvasApi.ts` — executeNode 前插 extra 参数,body 展开 `...extra`
- `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` — orchestrate skip 谓词同构镜像;execute/orchestrate logCall 记完整 body

## Decisions Made

- **反向覆盖三键范围(§14 窄通道声明)**:只 round-trip prompt/seed/engine;steps/cfg/lora/quant 等保存+刷新本来就丢(预存损耗,非本期引入),全配方持久化出范围,注释明写防 scope creep
- **mock orchestrate logCall body 形状**:`{...req.body, mode, total}`——核查结果:phase36 ORCHESTRATE-02 断言 `body.mode`、phase37 断言 `body.mode`/`body.nodeIds`、execute 断言 `body.nodeId`;mode/total 是计算字段不在 req.body,故 spread 透传 + 计算字段保留,既有 17 条 e2e 断言零迁移全绿,同时 prompt/params/seed 等新任务参数可被未来 52-03/52-04 e2e 断言
- **提交顺序调整**:Task 2(migrate)先于 Task 1(serialize)提交——serialize.test.ts 断言组 d 的 stale round-trip 依赖 migrate 还原,先落 migrate 保证每个提交点上全套测试独立全绿(plan 明许"两 task 同 plan 同提交/顺序未定")

## Deviations from Plan

None - plan executed exactly as written.(提交顺序调整为 plan 文本明许范围内,非 deviation。)

## Issues Encountered

None — 四任务按计划落地,测试一次通过。

## Verification(最终门全绿)

- `packages/infinite-canvas npm test`:**219/219**(serialize 13/13 = 既有 9 + 新增 4,无回归)
- `packages/flowgraph-v3/ts npm test`:**128/128**(migrate 34/34 = 既有 31 + 新增 3)
- 三处 tsc:根 `npx tsc --noEmit`、`packages/infinite-canvas npx tsc -b`、`packages/flowgraph-v3/ts npx tsc --noEmit` 全部 exit 0
- e2e(build 后跑 dist):phase36-orchestrator **9/9**(ORCHESTRATE-04 skipped===1 回归通过)、phase37-batch-execution **8/8**(logCall body 形状变化零影响)
- grep 门:serialize.ts 含 `data.stale`(2 处)与 `role === 'output'`(2 处);orchestrate.ts 与 mock 各含 `data.stale`;execute.ts zod 含 `params`;canvasApi 含 `...extra`;migrate.ts 无裸 `stale: null` 硬编码行
- CanvasContextMenu.tsx 零 diff(向后兼容实证)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **52-03(PromptSection + 重生成)**:persistEventParams(52-01)→ serializeGraphToV2 反向覆盖(本 plan)→ reload §14 重建,编辑跨刷新存活链路已闭环;executeNode extra 通道可直接传新 prompt;mock logCall 完整 body 观测点就绪
- **52-04(换 seed 重跑)**:executeNode extra `{params: {...recipe, seed}}` 通道就绪;zod params 契约已声明
- **52-05(stale 重跑链)**:save-v2 注入带 `data.stale` 的 success 节点 → orchestrate 不跳过 → node:state success → applySocketNodeState 清 stale(52-01)全链信息源已通;e2e 可经 mock 注入 stale 态
- 遗留(归 52-06):重生成后下游不自动标 stale(地雷 #11,本期不做)

## Self-Check: PASSED

---
*Phase: 52-prompt-edit-regenerate-loop*
*Completed: 2026-08-21*
