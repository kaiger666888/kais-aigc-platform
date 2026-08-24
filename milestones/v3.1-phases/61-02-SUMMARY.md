---
phase: 61-audit-debt-clearance
plan: "02"
subsystem: api
tags: [review-bridge, trailing-slash, 307-redirect, node-test, fetch-injection, regression-lock]

# Dependency graph
requires:
  - phase: 54-gate-center
    provides: gateStateService L323-324 尾斜杠修复先例(注释措辞 + URL 形状逐字参照)
provides:
  - reviewBridge 列表出站 URL 直连化(/api/v1/reviews/?,307 → Location 丢端口 → 404 链路在源码层消除)
  - node:test 注入式回归锁(URL 字面量正反双断言 + 分页双跳 + skip 分支),删斜杠必红已变异验证
  - 仓内 reviews 列表调用点 100% 带尾斜杠(gateStateService 54-01 + reviewBridge 61-02 双点齐清)
affects: [61-05 (verify:phase-61 聚合门 S1 静态 grep 第二形态锁), review-platform 桥接行为]

# Tech tracking
tech-stack:
  added: []  # 零新依赖(node:test 与 tsx 均仓内既有)
  patterns: [deps.fetchImpl 原生注入位捕获出站 URL 断言字面量(防 Pitfall 2 假绿:注入 fetch 不走真 307,断言必须打 URL 而非响应成功)]

key-files:
  created:
    - src/lib/__tests__/reviewBridge.test.ts
  modified:
    - src/lib/reviewBridge.ts

key-decisions:
  - "回归锁双形态:node:test 单测断言 URL 字面量(本 plan)+ 61-05 聚合门静态 grep(后续 plan)——CONTEXT discretion 裁定两者都上,54-01 gateStateService + verify-phase-54 L193 先例"
  - "测试用 node:test + assert/strict(非 vitest——根仓无 vitest,仅两 packages 有;planner 勘正 RESEARCH 建议),运行: node --import tsx --test src/lib/__tests__/reviewBridge.test.ts"
  - "改动面严格只动 path 字面量:baseUrl 解析/分页循环/approve 调用零改动"

patterns-established:
  - "Pattern: 出站 URL 回归锁 = 注入 fetchImpl 捕获 URL + 字面量正反双断言(contains('/api/v1/reviews/?') && !match(/\/api\/v1\/reviews\?/))——反断言在场使删斜杠必红"

requirements-completed: [DEBT-02]

# Metrics
duration: 5min
completed: 2026-08-24
---

# Phase 61 Plan 02: reviewBridge 尾斜杠一字修 + 回归锁 Summary

**reviewBridge 列表请求 URL 补尾斜杠直连 review-nginx(消除 Starlette 307 → Location 丢端口 → 404 中间跳),node:test 注入 fetchImpl 字面量正反双断言 + 分页双跳 + skip 分支回归锁,删斜杠必红已变异实证**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-24T05:19:17Z
- **Completed:** 2026-08-24T05:23:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- L182(现 L183)出站列表 URL `/api/v1/reviews?` → `/api/v1/reviews/?`,行上方加 54-01 同款措辞行内注释——307 中间跳在源码层消除,直连 200(RESEARCH 已存档本机 :8090 活体证据)
- 模块头契约注释 L19 第 2 条同步 slashed 形态(仅 `reviews?` → `reviews/?` 一处字符,注释其余逐字不动)
- 新建 node:test 回归锁 3 用例全绿:单跳字面量正反双断言 / 分页第二跳带斜杠 + cursor=c1 透传 / winnerPhaseName null → 零出站 skip 回归网
- 变异验证(acceptance criteria 要求):临时删掉斜杠跑一次 → Tests 1&2 必红(2 fail),还原后 3/3 复绿,`git diff` 字节级零残留

## Task Commits

Each task was committed atomically:

1. **Task 1: L182 尾斜杠一字修 + 模块头契约注释同步** - `1aed3816` (fix)
2. **Task 2: node:test 回归锁(注入 fetchImpl 断言 URL 字面量)** - `2fb4aaa6` (test)

**Plan metadata:** (见 final docs commit)

## Files Created/Modified

- `src/lib/reviewBridge.ts` - L182 一字修 + 行内注释 + 模块头 L19 契约注释同步(3 insertions / 2 deletions,改动面严格限 path 字面量与注释)
- `src/lib/__tests__/reviewBridge.test.ts` - 新建回归锁:mintFetch 注入桩捕获出站 URL、mock-review 假主机零网络(T-61-07)、三用例覆盖单跳/分页/skip

## Decisions Made

- 回归锁双形态(node:test 字面量断言为主 + 61-05 聚合门静态 grep 为辅)——CONTEXT discretion 授权,54-01 先例(gateStateService L323-324 修复 + verify-phase-54 L193 锁)
- 测试框架按 planner 勘正用 node:test(根仓无 vitest),Response 桩用 `{ok, status, json} as unknown as Response` 最小对象
- 测试 winnerPhaseName 用 `'p11a0'`(phaseToken 门须 leading p<digits> 前缀才放行列表请求)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. (执行环境注:executor 会话 cwd 每次调用重置回 /home/kai 且若干次 compound `cd` 前缀丢失,测试改用仓库绝对路径的 `node_modules/.bin/tsx --test <abs-file>` 跑通;计划内 verify 命令语义不变,仅调用形态适配——非计划偏差,不影响任何产物。)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DEBT-02 销账完毕:仓内 reviews 列表调用点(gateStateService + reviewBridge)100% 带尾斜杠
- 61-05 verify:phase-61 聚合门可直接引用:`grep -c 'reviews/?' src/lib/reviewBridge.ts`(2 行:代码字面量 1 + 模块头注释 1)与裸 `reviews?` 零命中作为 S1 静态锁断言
- REQUIREMENTS.md DEBT-02 勾选由 state updates 流程处理

## Self-Check: PASSED

- Files: src/lib/reviewBridge.ts / src/lib/__tests__/reviewBridge.test.ts / 61-02-SUMMARY.md 全部 FOUND
- Commits: 1aed3816 / 2fb4aaa6 全部 FOUND

---
*Phase: 61-audit-debt-clearance*
*Completed: 2026-08-24*
