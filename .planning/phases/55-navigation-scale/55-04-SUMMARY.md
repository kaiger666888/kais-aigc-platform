---
phase: 55-navigation-scale
plan: 04
subsystem: search-nav-asset-placement
tags: [nav-03, nav-04, search-navigator, bounded-placement, canonical-writeback]

# Dependency graph
requires:
  - phase: 55-navigation-scale/55-02
    provides: sceneNumOf/sceneColorOf 共享口径
provides:
  - placeNewAsset 纯函数:源旁(+24/−16,4px 网格)/视口中心(8px 网格)双模式,非有限防御回退 center
  - deriveSearchResults 纯派生:label/shot_id/prompt/description + raw 穿透(video_prompt/ltx_prompt),场景分组升序+「其他资产」末组,200 截断,零 mutate
  - SearchNavigator 组件:`/` 浮层(15vh 居中/60vh 上限/dialog+aria),↑↓ 跨组/Enter 跳转(setFocusAssetNodeId)/Esc;空态与键位提示文案逐字
  - onNewAsset canonical 重写:{node} payload 适配(Q4,后端零改动)+ 位置决策(服务端 position → placeNewAsset 视口中心)+ addNodeFromSocket(WRITE-03)幂等写回;Math.random 随机散布永久移除
  - adaptV2Node 节点级适配(normalizeNode + migrate 单节点;坏节点 null 不 throw)
  - testMode 桥扩张:getViewCenter(live 视口 getter,非 store 镜像)+ addNodeForTest(同一 canonical 防线)
affects: [55-07 e2e 消费 addNodeForTest/getViewCenter, 55-05 lane 缩放记忆]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "live 视口桥(方案 b):模块级 getter ref(testMode 门内赋值)——store.viewport 运行时镜像被证伪(零调用方/触发全量重布),绝不作为数据源"
    - "位置决策两档真相优先:服务端 position 有限即用 → 否则视口中心;源旁分支纯函数就绪待调用点"
    - "幂等增量:同 id 重播仅刷 rawData 不重复 append;坏节点 warn 早退不 throw"
    - "`/` 守卫三层:非 input/textarea/contentEditable + modal 开启早退 + preventDefault"

key-files:
  created:
    - packages/infinite-canvas/src/utils/placeNewAsset.ts
    - packages/infinite-canvas/src/components/__tests__/placeNewAsset.test.ts(8)
    - packages/infinite-canvas/src/components/canvas/SearchNavigator.tsx
    - packages/infinite-canvas/src/components/__tests__/searchNavigator.test.ts(7)
  modified:
    - packages/infinite-canvas/src/components/FlowCanvas.tsx(hidden 过滤整段删除 + `/` 键 + onNewAsset 重写 + getLiveViewport)
    - packages/infinite-canvas/src/hooks/useCanvasSocket.ts({node} payload)
    - packages/infinite-canvas/src/store/canvasStore.ts(addNodeFromSocket)
    - packages/infinite-canvas/src/v3/adapter.ts(adaptV2Node)
    - packages/infinite-canvas/src/main.tsx(桥扩张)

key-decisions:
  - decision: 工具栏搜索输入框保留为打开入口(onFocus 打开导航器),不再有任何 hidden 写路径
    rationale: 输入框是既有可见入口,点击聚焦打开导航器比删除更平滑;搜索行为全部迁移到浮层。
  - decision: 事件源旁落点(anchor='source')纯函数+单测完整交付但无 live 调用点
    rationale: CONTEXT discretion 裁决——canvasApi.createNode 无组件消费方(RESEARCH 已证);live 路径为「服务端 position → 视口中心」两档,源旁分支为已测代码路径。

requirements-completed: [NAV-03, NAV-04]

duration: 50 min
completed: 2026-08-22T02:50:00+08:00
---

# Phase 55 Plan 04: 搜索导航器 + 新资产有界落点 Summary

NAV-03:`/` 搜索导航器(场景分组/键盘流/零隐藏);NAV-04:onNewAsset canonical 重写(有界落点/幂等/{node} 适配)+ testMode 桥。

**Duration:** 50 min · **Tasks:** 3/3(TDD ×2)· **Files:** 9

## What Was Built

- **placeNewAsset**:PLACE_OFFSET(+24/−16)/PLACE_GRID(4/8)常量;finitePoint 防御;8 用例(偏移/网格/NaN 回退/有界契约)
- **deriveSearchResults + SearchNavigator**:15 用例;浮层 15vh 居中 min(560px,90vw)/60vh/blur(4px)/dialog+aria-label;sticky 场景头(色点+mono+计数);↑↓/Enter/Esc;空态「未找到匹配项」+键位条逐字;即时过滤零 debounce
- **onNewAsset 重写**:Math.random/LAYOUT.NEW_NODE_* 引用清零;位置=服务端 position ?? placeNewAsset(视口中心);addNodeFromSocket canonical;成功后 setFocusAssetNodeId(到达高亮)
- **hidden 过滤删除**:Phase 45 TEXT-03 整段移除,Do-Not-Regress 3 达成(grep hidden: = 0)
- **testMode 桥**:getViewCenter((screen−v.xy)/zoom 换算,live getter 源)+ addNodeForTest(同位置决策+同一防线)

## Self-Check: PASSED

- `npm test` **312/312**(26 文件);双根 tsc 0
- grep:NEW_NODE 0/Math.random 0/hidden: 0(FlowCanvas);payload.node 6(socket);adaptV2Node 2;addNodeForTest+getViewCenter 3(main);getLiveViewport 2(FlowCanvas)+1(main);getState().viewport 0(镜像非数据源)

## 设计自检(UI-SPEC §1)

- ✅ 浮层形态(top 15vh/宽 min(560px,90vw)/60vh 上限/dialog+aria-label)
- ✅ 键盘流(↑↓ 跨组跳组头/Enter 跳转/Esc 关闭/输入框自动聚焦)
- ✅ 文案逐字(placeholder/空态 heading+body/键位提示条)
- ✅ 93 镜不平铺:按场景分组 sticky 头 + 200 截断标记
- ✅ Do-Not-Regress 2(focusAssetNodeId effect 原样)/3(零隐藏)/5(行 button 键盘焦点)

## Deviations from Plan

**[Rule 2 - 既有 UI] 工具栏输入框 onFocus 打开导航器(plan 提两种取简,选保留入口)** — Found during: Task 2 | Fix: onFocus+placeholder 更新,输入框不再绑定过滤 | Verification: 无 hidden 路径
**[Rule 1 - 声明顺序] liveViewport effect 初版插在 getViewport 声明前(TS2448)** — Found during: Task 3 | Fix: 移到 navHistory 之后 | Verification: tsc 0
**[Rule 2 - python 静默 no-op] addNodeFromSocket 实现块首次替换未命中(缩进不符)** — Found during: Task 3 | Fix: 以 applySocketNodePreview 尾块重锚插入 | Verification: tsc 0 + 接口/实现齐

**Total deviations:** 3 auto-fixed。**Impact:** 无。

## Issues Encountered

None blocking。

---

Ready for 55-05(lane 缩放记忆 + LOD 红线 pins)/55-06(BranchPanel 重写)。
