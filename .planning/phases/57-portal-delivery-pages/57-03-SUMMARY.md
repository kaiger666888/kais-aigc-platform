---
phase: 57-portal-delivery-pages
plan: 03
subsystem: ui
tags: [deep-link, canvas, custom-element, e2e, react-19]
requires: [57-02]
provides:
  - deepLink.ts 纯函数（parseDeepLink + resolveDeepLinkTarget；zone→PHASE_REGISTRY.khsPrefix→phaseIndex→首个资产节点；注册表外 fail-loud warn）
  - FlowCanvas 深链消费链（getInitialParams 增读 focus/zone；loadCanvas resolve 后一次性消费 + 切画布视图；投放门=目标节点已 measure）
  - 画布 topbar 左簇 kap-navbar compact 第二宿主（@portal-nav 跨包 alias + React.JSX IntrinsicElements 增强）
  - phase57-deeplink.mjs e2e（真实后端 10588，运行时发现 scope，注册表源文件解析单源）
affects: [57-08 聚合验证]
key-files:
  created: [packages/infinite-canvas/src/lib/deepLink.ts, packages/infinite-canvas/src/__tests__/deepLink.test.ts, packages/infinite-canvas/src/types/kap-navbar-jsx.d.ts, packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs]
  modified: [packages/infinite-canvas/src/components/FlowCanvas.tsx, packages/infinite-canvas/vite.config.ts, packages/infinite-canvas/tsconfig.json, packages/infinite-canvas/index.html]
key-decisions:
  - decision: 深链投放两重竞态防线（fitView={!deepLinkPending && ...} + getInternalNode measured 门）
    rationale: 776 节点真机实测：prop 级 initial fitView 在全部节点 measure 完才发车（>3s），会覆写先发的定位 fitView；且未测量节点 fitView 拿 0×0 bounds 静默 no-op。pending 期间禁用 initial fitView + 目标 measured 后投放，定位 fitView 成为最后一次视口操作（zoom 1.5 证据）。
  - decision: 消费时 setViewMode('canvas')（默认视图是资产中心）
    rationale: AssetLibrary.handleLocateOnCanvas（plan 引用的先例）定位链同款：setFocusAssetNodeId + setViewMode('canvas')——不切视图则聚焦发生在不可见画布。
  - decision: focus 未命中不在纯函数里判（恒回 focus 目标）
    rationale: 「落点不存在→既有 toast」三态必须保留——miss 时也要 setFocusAssetNodeId 让既有 effect 出「该资产尚未放置在画布上」toast。
  - decision: e2e 断言用 DOM rect 屏幕坐标而非 store position
    rationale: store RF nodes position 是 adapter 布局缓存，渲染真值在 useLayout 重算后的 DOM transform（真机实测两者相差 14 万 flow-px；phase55 放置断言同教训）。
  - decision: compact 属性写 compact=""（显式空串）
    rationale: React 19 对 custom element 布尔属性的处理不如空串确定；CSS 选择器 [compact] 与 observedAttributes 均按 presence 生效，空串最稳。
patterns-established:
  - "深链=参数解析纯函数 + 一次性消费守卫 + 投放门（不动锁定 effect,只决定何时交给它）"
  - "React 宿主吃 vanilla custom element：alias 引源码 + IntrinsicElements 增强（57-02 静态壳路线的 TSX 互补）"
requirements-completed: [PORTAL-02 画布半边]
duration: 85 min
completed: 2026-08-22T10:05:00+08:00
---

# Phase 57 Plan 03: 画布深链消费 + topbar navbar compact Summary

D-05 深链画布半边闭环（/canvas?project&ep&focus|zone → 302 → 画布定位,全程零手动）+ D-06 四岛共脸第二宿主（topbar 左簇 kap-navbar compact 替换 logo+标题块）。

**Tasks:** 2/2 · **Commits:** 2（43d4a2b6 / 256c2262）· **Files:** 4 created + 4 modified

## 验证证据

- vitest：新增 deepLink.test.ts 17 断言（focus 优先/zone 无节点静默/注销前缀 p05·p10b·p11·p12·乱码 warn/注册表防漂移全覆盖）→ 包内 **401/401 绿**
- `tsc -b --pretty` 0；根仓 `tsc --noEmit` 0；vite build 过
- e2e `phase57-deeplink.mjs` **3/3 绿**（真实后端 10588 + dist 部署后）：
  - case A focus：详情面板打开 + 目标节点 DOM rect 中心 ≈ pane 中心（≤200px）+ URL 留 focus 可重放
  - case B zone：该 phase 首个资产节点定位居中（与前端同 nodes 集复制的落点 id）
  - case C 回归：无参数直链只加载不定位（详情面板不出现）+ navbar compact 在位
- phase55-nav e2e **5/5 绿**（topbar 嵌 navbar 零回归；getByRole('button') 与 nav `<a>` 不撞）
- 回归断言组全过：`grep -c kap-navbar FlowCanvas.tsx`===1、`calc(100vh - 48px)`===1、getInitialParams 仍读两键、setFocusAssetNodeId 计数 8→9 且新增段零自写 fitView
- compact 实测（1600×1000 headless）：navbar **251.8×26px**（低于 Q6 估算 380px）,左簇总宽 784px,视图切换簇 440px,零折行
- `/infinite-canvas/` 服务端 HTML 含 `/assets/kap-nav.css` link（curl 命中）

## Deviations

1. **投放时序防线（计划外的必要修复）**：计划原文「loadCanvas resolve 后一次性 setFocusAssetNodeId」在真机 776 节点图上定位丢失——prop 级 initial fitView 全量 measure 后才发车（>3s）覆写定位视口（zoom 钳 0.4 证据）。修复=①深链 pending 期间 `fitView` prop 禁用 ②投放门=目标节点 measured（getInternalNode）③onInit 门 ④3s 兜底交既有 toast。既有 focusAssetNodeId effect 语义零改动（只复用）。
2. **`<kap-navbar>` 进 TSX 需类型增强**：57-02 走 index.html 静态壳绕开了 TSX；画布宿主在 JSX 渲染,新增 `src/types/kap-navbar-jsx.d.ts`（React.JSX.IntrinsicElements 增强,jsx-runtime 经 extends 生效）。
3. **curl 断言「HTML 含 kap-navbar」按宿主形态调整**：画布是纯客户端渲染 SPA（curl 时 #root 空）,静态 HTML 只含 css link;元素本体由 e2e 真浏览器断言（存在/26px/6 链/aria-current=画布）——比 curl grep 更强。
4. **e2e 断言坐标基准改 DOM rect**：store position 是布局缓存非渲染真值（phase55 同教训）。
5. **setViewMode('canvas') 追加进定位链**（先例 AssetLibrary.tsx:828-835 同款）——默认视图是资产中心,不切则聚焦不可见。

## 运维注记

- 改动画布需 `npm run build && bash scripts/deploy-canvas.sh`（e2e 跑 dist,地雷 #10）。
- 深链 URL 样例：`/canvas?project=1785508691757&ep=1&zone=p13`（302 → focus 首个 p13 资产节点）。

---

Ready for 57-04（story-map/director-desk serve 时 navbar 注入）。
