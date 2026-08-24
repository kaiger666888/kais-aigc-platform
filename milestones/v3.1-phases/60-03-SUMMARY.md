---
phase: 60-post-save-panel-persistence
plan: "03"
subsystem: canvas-store
tags: [panel-persist, anchor-loss, console-warn, symmetric-collapse, roundtrip-lock, branch-a, d-02, d-03, d-07, t60-05]
requires:
  - phase: 60-post-save-panel-persistence
    provides: 60-01 Branch A 裁定(Fix branch 行)+ reloadAnchor 三 case 基底 + diagnose-60-roundtrip 探针(--strict 门)
provides:
  - canvasStore setGraph 锚丢失 console.warn —— D-03 验收钩子([panel-persist] 默认串,「非 null→null」转移守卫防刷屏)
  - reloadAnchor.test.ts 八 case 永久锁 —— D-03 warn 行为/D-07 对称(Together-or-not-at-all)/roundtrip in-memory id 稳定(60-05 静态锁与 60-04 e2e 的 store 侧锚点)
  - 60-DIAGNOSIS.md Branch A confirmation 段 —— 两次门(真机 --strict exit 0 + vitest 8/8)结果存档,分支执行如实性可审计
affects: [60-04 (e2e anchor-miss 断言消费 warn 钩子/roundtrip 前提), 60-05 (verify 静态锁锚定 setGraph warn 与探针 dispatch 复用), PANEL-02]
tech-stack:
  added: []  # 零新依赖(T-60-SC 兑现)
  patterns:
    - "转移守卫 warn: 副作用置于 set() 更新器之外、以 get() 预读锚状态判定「非 null→null」转移——重锚行 L442-447 逐字零改动,warn 为纯增量(git diff 验收项)"
    - "双层 roundtrip 门: 真机探针(diagnose --strict,含服务端层)+ 纯函数 vitest 锁(adapt→serialize→adapt,evt_ 子集单列)——同一 id 稳定性结论的 CI 安全绑定形态"
key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts
    - .planning/phases/60-post-save-panel-persistence/60-DIAGNOSIS.md
key-decisions:
  - "分支裁定如实执行: 60-DIAGNOSIS「Fix branch: A」逐字消费——serialize.ts/adapter.ts/canvasRelationalStore.ts 三文件 diff 为零(验收已核);唯一生产 delta 是 Task 1 的 D-03 warn 纯增量钩子(plan must_haves 明列,非分支 B 修复)"
  - "warn 实现形状: 循环 [get().selectedNode, get().detailNode] 在 set() 之前判定未命中(锚非 null 且 vm.rfNodes 无同 id)——set 更新器保持纯函数,重锚语义字节级不变;转移守卫天然防刷屏(锚本就 null 不进分支),no-warn-spam 锁死"
  - "roundtrip-lock evt_ 子集单列断言且非空先证: evt id 派生确定(migrate §14 evt_<产出资产id>,资产 id wire 全程透传)——锁的是重合成确定性本身,任何 serialize/adapter 派生源漂移即红"
  - "requirements.mark-complete 继续跳过(沿 60-01/60-02 先例): 60-04/60-05 frontmatter 均携带 PANEL-02(e2e 四用例/probe/verify 断言面),届时勾选——store 侧语义与 id 前提本 plan 已锁,断言面待收口"
patterns-established:
  - "诚实收起的验收钩子形态: 行为(warn)+语义(对称收起)+防滥用(spam 守卫)三位一体进同一 vitest 文件——后续任何「诚实路径」需求的模板"
  - "诊断先于修复的收口形态: DIAGNOSIS 追加执行结果段(分支字母+门结果+改动清单),分支选择器的消费可审计"
requirements-completed: []  # PANEL-02 断言面待 60-04/60-05(见 key-decisions)
duration: 9min
completed: 2026-08-24
---

# Phase 60 Plan 03: reload 侧收口 — D-03 warn + D-07 对称锁 + Branch A roundtrip 门 Summary

**Branch A 逐字执行(DIAGNOSIS 裁定「setGraph 语义已对,零生产修复,仅锁」): 锚丢失 console.warn 验收钩子(转移守卫防刷屏)+ D-07 together-or-not-at-all 对称锁 + 纯函数 roundtrip id 稳定锁,真机 --strict 门复跑三层零漂移 exit 0,D-02 由既有 setGraph 语义满足——证据锚定。**

## 实际执行的分支字母 + 证据

**Branch: A**(60-DIAGNOSIS 最终裁定「Fix branch: A(setGraph 语义已对,零生产修复,仅锁)」,本 plan 分支选择器逐字消费)。

真机门输出摘录(`npx tsx scripts/diagnose-60-roundtrip.ts --strict`,:10588,2026-08-24 复跑):

```
选定 scope 2/1: nodes=31(非 evt 31,evt/eventChip 0),links=30
[PASS] 层1 V2 id(服务端重组稳定性): loadA 31 ids vs loadC 31 ids,双向差集 loadA→loadC=0 loadC→loadA=0
[PASS] 层2 V3 id(完整客户端往返): adaptedA 62 ids vs adaptedC 62 ids,双向差集 A→C=0 C→A=0
[PASS] 层3 evt_* id(事件重合成确定性): adaptedA evt 31 个 vs adaptedC evt 31 个,双向差集=0
[PASS] 恢复(净足迹): 原图回存 HTTP 200;load-v2 深比对原图:全等(剔 meta.updatedAt,净足迹=0)
✓ diagnose-60-roundtrip 零漂移:三层 id diff 全空 + 恢复全等(净足迹=0)   [exit 0]
```

与 60-01 首跑逐层复现——零漂移可重复,**PANEL-02 锚等价的 id 稳定性物理前提成立**。

## Performance

- **Duration:** 9 min(23:54:15Z → 00:0x UTC;本地 08-24 07:54-08:0x +08)
- **Completed:** 2026-08-24(本地)
- **Tasks:** 2/2
- **Files modified:** 3(生产 1: canvasStore.ts 纯增量 warn;测试 1;文档 1;serialize/adapter/canvasRelationalStore **diff 为零**)
- **Commits:** aaebd0f6(Task 1)· 3c4299ed(Task 2)

## Accomplishments

1. **Task 1 — D-03 锚丢失 warn + D-07 对称锁:** canvasStore.ts setGraph 在 set() 更新器**之外**(get() 预读锚状态)对 selectedNode/detailNode 各自判定「锚非 null 且新派生模型按 id 未命中」→ console.warn 一次(`[panel-persist] 锚点丢失: {id} 在重载图中未找到,面板已收起`,UI-SPEC §2 默认串);重锚行 L442-447 **逐字零改动**(git diff 验收项已核,纯增量)。reloadAnchor.test.ts 三 case 基底扩四 case:warn-on-miss(串含 `[panel-persist]`+丢失 id,精确匹配默认串)/symmetric-collapse(D-07 两锚同一次 setGraph 内同时 null,together-or-not-at-all)/no-warn-on-hit(命中零调用)/no-warn-spam(同一缺失锚连续两次 setGraph 恰一次——转移已消费);warn spy 补 afterEach restore。
2. **Task 2 — Branch A 收口:** 零生产修复(三候选文件 diff 零);reloadAnchor.test.ts 增 roundtrip-lock(case h):`adaptV2Graph(wire) → serializeGraphToV2(graph, rawDataByNodeId, undefined) → adaptV2Graph(wire2)` 两代节点 id 集全等 + evt_ 子集单列全等且非空先证(纯函数级,CI 安全,不依赖 :10588);真机门复跑 exit 0(见上摘录);60-DIAGNOSIS.md 追加「Branch A confirmation」执行结果段(分支字母+两次门结果表+改动文件清单)。

## Verification

- `npx tsc --noEmit`(根)exit 0(Task 1/2 后各跑一次)
- vitest `reloadAnchor.test.ts` **8/8 绿**(60-01 三 case + d/e/f/g 四 case + h roundtrip 锁)
- `scripts/diagnose-60-roundtrip.ts --strict` **exit 0**(三层差集全空+恢复深比对全等,净足迹=0)
- Branch A: `serialize.ts`/`adapter.ts`/`canvasRelationalStore.ts` git status 为空(diff 零,验收已核)
- `grep -c '\[panel-persist\]' canvasStore.ts` = 1(≥1 达标)
- NodeDetailPanel.tsx / FlowCanvas.tsx 零改动(UI-SPEC 锁面未触碰)

## Deviations from Plan

**None — plan 逐字执行。** 分支选择器(Task 2 唯一裁决输入)按 DIAGNOSIS 裁定走 Branch A;两个任务的 action/verify/acceptance 全项兑现,无 Rule 1-4 触发。

## Auth Gates

None(:10588 本机直连,无认证门槛)。

## Known Stubs

None(warn 钩子/锁套件/探针门全部真实;Branch A 本身即「零生产修复」的如实执行,非桩)。

## Threat Flags

None(威胁面与 plan 一致:T-60-04 Branch B 专属,N/A;T-60-05 缓解兑现——转移守卫 + no-warn-spam vitest 锁双防日志洪水;T-60-SC 零新依赖兑现。无模型外新增面)。

## TDD Gate Compliance

N/A(plan type: execute,非 tdd;warn 行为锁按 plan 字面以 vitest 扩充落地,无 RED/GREEN 循环要求)。

## Self-Check: PASSED

- packages/infinite-canvas/src/store/canvasStore.ts / reloadAnchor.test.ts / 60-DIAGNOSIS.md / 60-03-SUMMARY.md 全部 FOUND
- commits aaebd0f6(Task 1) / 3c4299ed(Task 2) 全部 FOUND;两 commit 零文件删除
