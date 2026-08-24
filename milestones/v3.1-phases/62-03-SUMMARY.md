---
phase: 62-asset-hierarchy-selection
plan: "03"
subsystem: e2e-mock-backend
tags: [mock-backend, e2e, phase-62, select-winner, generation-config, assets-registry]
requires:
  - "61 mock-backend search fixture(2 条常量,本 plan 抽取为 DEFAULT_ASSET_FIXTURE)"
  - "62-01 getGroupKey 词表(char:/scene:/keyframe:/type:name)——rich fixture 组键依据"
provides:
  - "PATCH /api/v1/assets-registry/:id mock(白名单写 + logCall 全尝试记录)"
  - "POST /api/canvas/v2/variant-groups/:groupId/select-winner mock(200 幂等/404/409/400/注入 500)"
  - "GET+PUT /api/canvas/v2/generation-config mock(14 行查表生成 + writeState 注入)"
  - "rich 多组 search fixture(/__mock/config { assetFixture:'rich' } 激活,reset 归位)"
  - "/__mock/config 扩展旋钮(assetFixture/fixtureVariantGroups/fileShape/genCfgWriteState/failSelectWinner)"
affects:
  - "62-04/05/06/07(全部断言面依赖本 plan 的 mock 面)"
tech-stack:
  added: []
  patterns:
    - "logCall 全尝试记录惯例(nodes/ 先例)延续到 PATCH/select-winner/PUT"
    - "错误分支同时给 HTTP status 与 body code 信封(apiCall res.ok 判错前置)"
key-files:
  created: []
  modified:
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
decisions:
  - "voice 组行携带 meta.subtype='voice_print'——getGroupKey 仅经该 subtype 到达 char:<id>:voice 键,<interfaces> 简写省略但 62-07 钉死的组键集要求它"
  - "PATCH 写时物化:默认路径命中写操作才 clone 常量到 state.fixtureAssets,DEFAULT_ASSET_FIXTURE 永不原地突变,保字节等价可证伪"
  - "select-winner 错误分支用真实 HTTP status + code 信封双通道(客户端 apiCall 先判 res.ok 再判 json.code)"
  - "generation-config rows 查表生成不复制服务端合并实现(裁定锁定;legacy 行 source='snapshot'+sourceLegacy:true 对齐 62-06 契约)"
metrics:
  duration: ~35min
  completed: 2026-08-24
---

# Phase 62 Plan 03: P7 mock-backend 扩面 Summary

五组 Phase 62 mock 面(PATCH assets-registry / select-winner / generation-config GET+PUT / rich 多组 search fixture / config 注入旋钮)落进 server.mjs 单文件——默认行为与 61 逐字节等价(BYTE-EQUIV-PASS 实测),62-07 三文件断言面全部就绪。

## What Was Built

- **Task 1 — rich fixture + PATCH**(`6f01ed88`):`buildRichFixture()` 12 条(id 91001-91012,组键 char:shenzhiyi:concept ×3 / scene:宴会厅 ×2 / char:shenzhiyi:voice ×2 / keyframe:S01:S01_first ×2 / video:SH01 / outline 单件 primary / delivery_package reportAudit 单件;每条完整 AssetDetail + createdAt 排序键面);state.fixtureAssets 三态(null=默认/rich/null 清回);PATCH 路由白名单 isPrimaryView/state/tags、404 信封、logCall 全尝试。
- **Task 2 — select-winner + generation-config**(`b73ce3e8`):select-winner 全分支(200 applied true/false 幂等重放/404 变体组不存在/409 不在组内·非 single/400 载荷/failSelectWinner→500);fixtureVariantGroups 注册表(vg-e2e-1: asset-91001/91002);GET 恰 14 行(11 嵌套 RESEARCH F 口径+3 扁平,override>fileShape 三档);PUT 载荷保真 logCall + preCap1 400「确定性派生 · pre 固定为 1」+ genCfgWriteState 注入。

## Tasks

| Task | Name | Commit | Verify |
| ---- | ---- | ------ | ------ |
| 1 | rich search fixture + PATCH assets-registry | 6f01ed88 | search-rows=12 patch-calls=1;BYTE-EQUIV-PASS vs HEAD;RESET-RESTORES-PASS;patch-404 入 calls |
| 2 | select-winner + generation-config mocks | b73ce3e8 | rows=14 put-synced=1 cap-400=1 sw-200=1;500/404/409/幂等 replay false 实测;6 次尝试全落 calls |

## Verification Results

- `node --check` 通过;
- Task 1 冒烟:rich 激活后 search 12 条 ≥12,PATCH 91001 落 /__mock/calls,二次 search 可见 eliminated,reset 归位后与 HEAD 版响应逐字节相等;
- Task 2 冒烟:rows=14;writeState synced 注入生效;preCap1 nCandidates=3 → HTTP 400;select-winner applied 在场;500/404/409/400 分支 HTTP status 与 body code 双通道正确;幂等重放 applied:false;legacy→13×sourceLegacy(override 行优先)、requirement-v25→13×requirement;扁平键 p01_hook pre=3 final=3、嵌套键 1/1 快照默认;
- 结构门(T-62-09):全部新路由在 express.static(:806)之前;
- 回归门:`npx playwright test test/e2e/tests/phase61-debt.mjs` **3 passed**(dist 未重建);
- grep 锚全在场:assetFixture=5 / genCfgWriteState=4 / failSelectWinner=3 / select-winner=8。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TDZ ReferenceError——Phase 62 fixture 块初始位置在 state 声明之后**
- **Found during:** Task 1 自检冒烟(服务启动即 crash)
- **Issue:** fixture 常量块最初插在 broadcastToProject 助手后,而 `state` 字面量初始化引用 `DEFAULT_VARIANT_GROUPS`(const TDZ)→ `Cannot access before initialization`
- **Fix:** 整块移到 `const state = {` 之前(DEFAULT_EDGES 之后)
- **Files modified:** packages/infinite-canvas/test/e2e/mock-backend/server.mjs
- **Commit:** 6f01ed88(随 Task 1)

### Contract-tightening notes(非偏差,契约对齐记录)

1. **voice 行补 meta.subtype='voice_print'**:plan <interfaces> 只写「characterId 'shenzhiyi' type 'voice'」,但 62-07 钉死期望组键含 `char:shenzhiyi:voice`,getGroupKey 只有经 subtype='voice_print' 分支才产出该键——不加则 voice 组并入 concept 组且手动 chip 断言面缺组。按「组键对齐 getGroupKey 词表」的既定裁定补齐。
2. **错误分支带真实 HTTP status**:plan 文本只锁 body 形状;实测客户端 `canvasApi.apiCall` 先判 `res.ok` 非 2xx 即抛 ApiError,纯 body-code 信封(HTTP 200)虽也能被二级分支捕获,但镜像真端点(res.status(...))更忠实且对 500 toast 断言面(非 network/business 分类)更稳。所有 4xx/5xx 同时给 status + code。
3. **verify 命令 kill %1 → PID 捕获**:非交互 shell 无 job control,`kill %1` 不可靠;改 `$!` 直捕 node PID(exec 语义),断言部分逐字保留。

## Known Stubs

None —— 五组 mock 面均为完整数据通路;mock 不模拟服务端 PATCH-linkage 是**裁定内的刻意分离**(D-05 两通道语义),非 stub。

## Self-Check: PASSED

- server.mjs 在场且已提交(6f01ed88 + b73ce3e8);
- git log 双 commit 存在;phase61-debt 3 passed;
- 无未跟踪残留(mock-backend 目录仅 server.mjs)。
