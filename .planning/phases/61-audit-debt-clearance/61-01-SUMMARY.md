---
phase: 61-audit-debt-clearance
plan: "01"
subsystem: ui
tags: [react, html5-dnd, reactflow, e2e, playwright, express-mock, zod]

# Dependency graph
requires:
  - phase: 55-nav-pan-zoom-consistency
    provides: placeNewAsset 纯函数(source/center 双锚 + 有界落位)+ testMode 桥 getGraph/getViewCenter 断言面
  - phase: 51-canonical-write-path-coordination-guard
    provides: POST /api/canvas/v2/nodes/ 通道 + node:created → addNodeFromSocket canonical 写回链(WRITE-03)
provides:
  - 资产卡片 → 「画布」页签 dragover 切视图 → 面板 drop 的拖入全链(生产代码)
  - canvasApi.placeAssetNode(POST /canvas/v2/nodes/ 真封装,409 结构化不 throw)+ ASSET_DRAG_MIME/AssetDragPayload 契约
  - placeNewAsset(anchor='source') 唯一活调用方(stub 链:＋画布按钮/handleAddToCanvas/投放占位函数全退役)
  - mock POST /api/canvas/v2/nodes/(400/409/200+node:created 5ms 回放)+ /api/v1/assets-registry/search(2 fixture)
  - phase61-debt.mjs 三用例 e2e(有界落点 ≤64px/409 重复/stub 退役)
  - testMode 桥 screenToFlow 只读访问器(e2e drop 锚换算面)
affects: [61-audit-debt-clearance wave2 收口门, 62+ 资产中心/画布交互, verify:phase-61]

# Tech tracking
tech-stack:
  added: []  # 零新依赖(RESEARCH Package Audit 兑现)
  patterns:
    - "合成 DragEvent 三步拖拽序列(同一 DataTransfer 挂 window.__e2eDt)——视图互斥下 e2e 驱动跨视图拖入的可重复范式"
    - "mock logCall 全尝试记录(含 409)——请求级观测面与响应语义解耦"

key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs
  modified:
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
    - packages/infinite-canvas/src/components/assetManager/assetManager.css
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/src/main.tsx
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs

key-decisions:
  - "A2 裁定落地:placeNewAsset 本体零改动,PLACE_GRID.source=4px 既有语义胜出,CONTEXT「8px」措辞不落代码(D-01 文字勘误)"
  - "P3 裁定落地:视图互斥下拖入必经「画布」页签 dragover 切视图(store setViewMode 直调,幂等;不走 handleSetViewMode 的 nav 快照——点击语义,非拖拽 hover 高频路径)"
  - "ApiError 判 409 用 .code 字段(plan 文字写 .status,实际类字段是 code——语义照抄,字段名按仓内事实)"
  - "onDrop 前置 MIME types 守卫:非 asset 拖拽(如文件拖入)静默忽略,避免误 toast"
  - "mock /nodes logCall 移守卫前:全尝试(含 409)落 /__mock/calls——二次拖入恰-2-条计数断言的观测面"

patterns-established:
  - "drop 成功路径零本地写:placeAssetNode POST → 服务端 node:created 广播 → onNewAsset 服务端 position 真相优先 → addNodeFromSocket canonical(勿二次偏移,Anti-Pattern 3)"
  - "id 约定 asset-${数字id} 与 handleLocateOnCanvas 同源(Pitfall 8 查重/定位双赢)"

requirements-completed: [DEBT-01]

# Metrics
duration: 18min
completed: 2026-08-24
---

# Phase 61 Plan 01: DEBT-01 拖入清偿 Summary

**资产卡片 HTML5 拖拽入画布全链落地——placeNewAsset(anchor='source') 获得唯一活调用方,「＋ 画布」stub 链全退役,经 POST /api/canvas/v2/nodes/ 真持久化 + 三用例 e2e(有界落点/409 重复/退役面)全绿**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-24T05:02:28Z
- **Completed:** 2026-08-24T05:20:12Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- 拖入全链生产接线:卡片 dragstart 写 MIME 载荷 → 「画布」页签 dragover 切视图(P3 裁定)→ ReactFlow onDrop → placeNewAsset(anchor='source', 4px 既有语义)→ POST /nodes 落库 → node:created 广播 → addNodeFromSocket canonical 写回
- stub 链退役:「＋ 画布」按钮/handleAddToCanvas/恒 true 投放占位函数/死 CSS 全清,grep 三件套 src 零残留;placeNewAsset 本体与其 8 用例单测零改动
- phase61-debt.mjs 三用例 e2e 全绿(drag-in-bounded 各轴 ≤64px + POST 载荷/canonical position 全等三点一线;drag-in-duplicate-409 恰 2 条调用+节点仍 1+toast;stub-disposed 计数 0 不误伤定位按钮);phase55-nav 全量复跑 5/5 绿

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave-0 契约面 — mock 两条新路由 + phase61 e2e 骨架** - `8a2faa81` (test)
2. **Task 2: 生产接线 — canvasApi 真封装 + 卡片 draggable + stub 退役 + FlowCanvas onDrop** - `8204d7a3` (feat)
3. **Task 3: phase61 e2e 三用例全绿 + 放置面回归** - `9c8bae22` (test)

**Plan metadata:** (本 commit)

## Files Created/Modified
- `packages/infinite-canvas/src/services/canvasApi.ts` - ASSET_DRAG_MIME 常量 + AssetDragPayload 类型 + placeAssetNode(POST /canvas/v2/nodes/ 真封装,409→{ok:false,status:409},绝不 throw);恒 true 投放 stub 删除
- `packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx` - 卡片 draggable + dragstart MIME 载荷(id 缺失防御 toast);handleAddToCanvas + 「＋ 画布」按钮退役;定位按钮不动
- `packages/infinite-canvas/src/components/assetManager/assetManager.css` - .am-card__add 死样式随按钮退役
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` - 「画布」页签 onDragOver 切视图(P3 裁定)+ handleAssetDrop(useCallback,MIME 守卫/载荷强校验/项目剧集守卫/placeNewAsset(source)/placeAssetNode/409 toast);ReactFlow onDragOver/onDrop props;ViewModeButton 增可选 onDragOver;onNewAsset 段零改动
- `packages/infinite-canvas/src/main.tsx` - testMode 桥增 screenToFlow 只读访问器(pane rect 原点 + live viewport 换算,与 paneFlowCenter 同基准)
- `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` - POST /api/canvas/v2/nodes/(400/409/200+node:created 5ms 回放,全尝试 logCall)+ POST /api/v1/assets-registry/search(2 条 AssetDetail fixture 90001/90002);均在 express.static 之前
- `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs` - 三用例 e2e + loadAssetCenter/dragAssetIntoCanvas/dropOnPane/waitViewportSettled helpers

## Decisions Made
- A2 裁定照办:placeNewAsset 零改动(4px 网格既有语义胜出);拖入锚 = drop point 经 screenToFlowPosition(A3 推荐项)
- 页签切视图用 store setViewMode 直调而非 handleSetViewMode:后者拍 nav 历史快照,适合点击;dragover 连发需幂等高频路径
- onNewAsset / useCanvasSocket / addNodeFromSocket / 服务端 nodes.ts 全零改动——写回链全部现成(WRITE-03)
- mock search 不校验查询参数:客户端分页 limit 200,fixture 2 条 < 200 自然收敛

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ApiError 409 判定字段名**
- **Found during:** Task 2 (placeAssetNode 实现)
- **Issue:** Plan 写 `err.status === 409`,但仓内 ApiError 构造器字段是 `code?: number`(canvasApi.ts L40-49),无 status 字段
- **Fix:** 用 `err.code === 409`;4xx 真侧(HTTP 409)与 mock 侧(json.code 409)两路都经 ApiError.code 到达
- **Files modified:** packages/infinite-canvas/src/services/canvasApi.ts
- **Verification:** e2e drag-in-duplicate-409 绿(toast「已在画布」即 409 分支证据)
- **Committed in:** 8204d7a3

**2. [Rule 1 - Bug] mock /nodes 409 尝试未落 /__mock/calls**
- **Found during:** Task 3 (drag-in-duplicate-409 首跑红:期望 2 条实测 1 条)
- **Issue:** Plan 的 mock spec 把 logCall 放在查重守卫之后(仅成功路径记录),而 plan 的测试 spec 要求「恰 2 条」计数——自相矛盾;409 尝试不可观测
- **Fix:** logCall 移到守卫前,全尝试记录(与 load/orchestrate/execute 全请求记录惯例一致),x/y/nodeId 防御性提取
- **Files modified:** packages/infinite-canvas/test/e2e/mock-backend/server.mjs
- **Verification:** 三用例复跑全绿
- **Committed in:** 9c8bae22

**3. [Rule 3 - Blocking] 退役三件套零残留门需清死 CSS**
- **Found during:** Task 2 (自检 grep)
- **Issue:** Plan files_modified 未列 assetManager.css,但 acceptance 要求 grep `am-card__add` 在 src/ 命中 0——按钮 JSX 删除后 CSS 死规则(2 处)仍命中
- **Fix:** 删 .am-card__add 两条死规则(留一行退役注释);.am-card__locate 不动;同时删 AssetLibrary 因 stub 退役而孤儿化的 episodesId 订阅行
- **Files modified:** packages/infinite-canvas/src/components/assetManager/assetManager.css, packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
- **Verification:** grep 计数 0 + build exit 0
- **Committed in:** 8204d7a3

**4. [Rule 2 - Missing Critical] onDrop 前置 MIME types 守卫**
- **Found during:** Task 2 (handleAssetDrop 实现)
- **Issue:** Plan 只要求 try/catch 解析 getData;非 asset 拖拽(如文件拖入 pane)会走「拖入载荷无效」误 toast
- **Fix:** onDrop 与 onDragOver 同款 `types.includes(ASSET_DRAG_MIME)` 前置守卫,非 asset 拖拽静默忽略(与 T-61-03 异源伪造面评估一致)
- **Files modified:** packages/infinite-canvas/src/components/FlowCanvas.tsx
- **Verification:** build exit 0;三用例绿
- **Committed in:** 8204d7a3

---

**Total deviations:** 4 auto-fixed (2 blocking, 1 bug, 1 missing critical)
**Impact on plan:** 全部为满足 plan 自身 acceptance 的必要修正,无范围蔓延;assetManager.css 是唯一超出 files_modified 的文件(零残留门强制)。

## Issues Encountered
- phase55-nav 首跑 search-grouped-jump 1 红:按 plan 协议隔离重跑绿 + 全量复跑 5/5 绿 → 判定 STATE 已记录的并行会话负载 flake,非本 plan 回归(未修,沿先例记录)。

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEBT-01 三条 truth 有行为证据,REQUIREMENTS.md DEBT-01 可勾选
- Wave-1 兄弟 plan(61-02/03/04)零文件交集确认成立:本 plan 触 assetManager/FlowCanvas-drop 段/canvasApi 投放段/mock server/新 e2e 文件,均不与他人重叠
- verify:phase-61(61-05)可静态锁:grep 退役三件套 0、anchor: 'source' 恰 1、ASSET_DRAG_MIME 两端一致、mock 两路由在场

---
*Phase: 61-audit-debt-clearance*
*Completed: 2026-08-24*
