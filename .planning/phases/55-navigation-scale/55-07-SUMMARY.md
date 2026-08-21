---
phase: 55-navigation-scale
plan: 07
subsystem: phase-gate
tags: [nav-03, nav-04, nav-05, e2e-smoke, phase-gate, dead-constants]

# Dependency graph
requires:
  - phase: 55-navigation-scale/55-04
    provides: testMode 桥 addNodeForTest/getViewCenter(live 源)
  - phase: 55-navigation-scale/55-05
    provides: laneZoom 记忆 + 列头聚焦热区(aria-label)
provides:
  - test/e2e/tests/phase55-nav.mjs:5 用例(open/Pitfall-7 守卫/grouped-jump+零隐藏/placement ≤64px/lane-focus ≥0.6)×3 连续全绿
  - NEW_NODE_* 死常量清除(随机散布时代最后残留)
  - 55-04 桥补强:getGraph(canonical 只读;placement 断言用——rfNodes position 是布局缓存)+ getViewCenter pane 基准
  - addNodeFromSocket 修复:经 setGraph 全量重建派生缓存(rfNodes/edges/phaseCatalog)+ 注入 raw 补回——首版直写 graph 渲染链看不到新节点
  - deriveSearchResults 修复:Map 形状 raw 查找(store 传 Map,属性访问恒 undefined)
  - navigator 全局 Esc(焦点在导航器外输入框时 window 层兜底关闭)
affects: [phase 55 verify 前置达成, Wave 0 五缺口闭合]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "e2e 时序纪律:注入/断言前 waitViewportSettled(初始 fitView 600ms 动画内中心仍在移;250ms 双读差 <1px 才算稳)"
    - "canonical vs 派生缓存断言分层:放置决策断言 graph 节点 position(rfNodes 经 layoutFlowGraph 重算,非决策值)"
    - "pane 基准统一:getViewCenter 与 placeNewAsset 的 screenToFlowPosition 同以 RF pane 为原点(顶栏 48px 偏移不可混用 window 中心)"
    - "overlay 下点击用 dispatchEvent:命中矩形可能在顶栏之下,actionability 点击被遮挡拦截;冒烟验证处理链不做命中几何断言"

key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase55-nav.mjs
  modified:
    - packages/infinite-canvas/src/constants.ts(NEW_NODE_* 删)
    - packages/infinite-canvas/src/store/canvasStore.ts(addNodeFromSocket setGraph 重建)
    - packages/infinite-canvas/src/main.tsx(getGraph 桥 + paneFlowCenter 统一)
    - packages/infinite-canvas/src/components/canvas/SearchNavigator.tsx(Map raw)
    - packages/infinite-canvas/src/components/FlowCanvas.tsx(全局 Esc)
    - packages/infinite-canvas/src/utils/placeNewAsset.ts(docblock)

key-decisions:
  - decision: 全量 e2e 的 2 个失败(phase52-regen.mjs)记为并行会话在途工件,不阻本 phase 门
    rationale: 该文件 git status 为未跟踪(??)——基线 commit 5891f006(worktree 实测)不含它,属 Phase 52 并行会话未提交测试;全部已提交测试 46/46 绿,phase55 5/5×3 稳定。按 COORD 纪律不动并行域文件。
  - decision: placement 断言读 canonical graph(新增 getGraph 桥)而非 rfNodes
    rationale: setGraph 重建后 rfNodes.position 是 layoutFlowGraph 布局缓存;放置决策(placeNewAsset 输出)在 graph 节点上,两者语义不同层。

requirements-completed: [NAV-03, NAV-04, NAV-05]

duration: 75 min
completed: 2026-08-22T05:10:00+08:00
---

# Phase 55 Plan 07: e2e 冒烟 + phase 收口 Summary

导航三链路 e2e 证据(5 用例 ×3 连续全绿)+ 五项门禁全绿 + NEW_NODE 死常量清除;顺带修复 55-04 两个真 bug(渲染链看不到注入节点/搜索 Map raw 失效)。

**Duration:** 75 min · **Tasks:** 2/2 · **Files:** 7

## What Was Built

- **phase55-nav.mjs**(REAL_BACKEND 顶部常量可切,默认 mock):
  1. search-navigator-open:`/` 打开 dialog+自动聚焦;工具栏输入框聚焦时 `/` 不劫持(Pitfall 7)
  2. search-grouped-jump:注入 shot_id 节点 → 场景 1/场景 3 分组头;查询期 hidden 节点数 === 0;Enter → detail-panel 打开
  3. new-asset-placement:getViewCenter poll 就绪 + waitViewportSettled → addNodeForTest(无 position)→ DOM 反射 + canonical 位置与 live 中心各轴 ≤64px
  4. lane-focus-readable:P09 列头 dispatchEvent click → zoom ≥0.6(预置 laneZoom{9:0.9})
  5. 收尾零 pageerror
- **修复链**:addNodeFromSocket → setGraph 全量重建 + raw 补回(否则 useLayout 的 storeNodes 看不到新节点);deriveSearchResults Map.get;getViewCenter/safeCenter pane 基准;全局 Esc
- **死常量**:NEW_NODE_X/Y_MIN/RANGE 四键删除,constants.ts 引用零

## Self-Check: PASSED(五门禁)

1. vitest **322/322**
2. 包内 tsc 0;3. 根仓 tsc 0;4. verify:phase-55 **14/14**
5. build + e2e:**phase55 5/5 ×3 连续**;全量 46 passed + 2 failed(均为未跟踪的并行会域 phase52-regen.mjs,见 key-decisions)
红线:useLod 四常量原值(测试钉死);tokens.css 零 diff;khs plugins/ 零改动

## Deviations from Plan

**[Rule 1 - 真缺陷] addNodeFromSocket 直写 graph 不触发派生重建(55-04 遗留 bug)** — Found during: Task 1 | Issue: e2e 注入节点 DOM 不出现——useLayout 迭代 store.nodes(派生缓存),仅 setGraph 重建 | Fix: 经 setGraph + raw 补回 | Verification: placement/lane 用例绿
**[Rule 1 - 类型谎言] deriveSearchResults 对 Map 用属性访问恒 undefined(组件 cast 掩盖)** — Found during: Task 1 | Fix: rawOf 双形状读取 | Verification: 场景分组头出现
**[Rule 2 - 时序] waitViewportSettled 前置(初始 fitView 动画期中心漂移 ~65px)** — Found during: Task 1 | Fix: 250ms 双读稳定 poll | Verification: placement 5/5 稳定
**[Rule 2 - 并行域] phase52-regen.mjs 2 失败不阻门** — Found during: Task 2 | Fix: 基线 worktree 实证文件未跟踪;记档移交并行会话 | Verification: 已提交测试 46/46

**Total deviations:** 4(2 真修复 + 2 纪律裁定)。**Impact:** addNodeFromSocket 修复使 node:created 实时新增真正可见。

## Issues Encountered

None blocking(并行会话未提交测试的 2 失败已定责移交)。

---

**Phase 55 全部 7 plans 完成** —— Ready for phase verification(gsd-verifier)。Manual-Only:fitView 可读性/生产导入未映射/分支手感/93 镜性能。
