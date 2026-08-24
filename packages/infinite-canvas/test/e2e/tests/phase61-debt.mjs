import { test, expect } from '../helpers.mjs'

/**
 * Phase 61-01 — DEBT-01 拖入清偿 e2e(三用例)。
 *
 * 用例地图(-g 组词):
 *  - drag-in-bounded     : 资产卡片拖入 → 「画布」页签 dragover 切视图 → 面板 drop
 *                          → 节点落点与拖放点各轴 ≤64px(source 锚,理论紧界 26/18)+
 *                          POST /api/canvas/v2/nodes/ 落库(/__mock/calls 三点一线)。
 *  - drag-in-duplicate-409: 同资产二次拖入 → mock 409 → toast「已在画布」,节点不重复。
 *  - stub-disposed       : 「＋ 画布」按钮(.am-card__add)退役 = 0;.am-card/.am-card__locate 在。
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——先 `npm run build`。
 *
 * 视图互斥裁定(P3,plan 内 pin):viewMode 互斥下资产中心(AssetManager)与 ReactFlow
 * 不同时挂载,拖入必经顶栏「画布」页签 dragover 切视图。e2e 用合成 DragEvent 驱动
 * (同一 DataTransfer 挂 window.__e2eDt,不依赖浏览器原生拖拽会话跨源存活);
 * 真实手感由 VALIDATION 既有 manual UAT 行(:10588)兜底。
 *
 * 断言纪律:canonical position 一律读 window.__kaisCanvas.getGraph()(rfNodes 是
 * 布局缓存禁断言,Anti-Pattern 2);drop 锚换算用 testMode 桥 screenToFlow()。
 */

/** 加载资产中心视图——loadCanvas 的 goto+双 reset 导航序列,但不切画布
 *  (拖入用例起点在 assets 视图;fixture 经新 search 路由到达后卡片可见)。 */
async function loadAssetCenter(page) {
  const params = new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' })
  await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
  await page.locator('.am-card').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
}

test.describe('phase61-debt 拖入清偿', () => {
  test('drag-in-bounded: 拖入落点与拖放点各轴 ≤64px(D-01)', async ({ page }) => {
    // TODO(61-01 Task 3): 合成拖拽序列 + getGraph 有界断言 + /__mock/calls 三点一线
  })

  test('drag-in-duplicate-409: 同资产二次拖入 → 409 + toast(已在画布', async ({ page }) => {
    // TODO(61-01 Task 3): 重复拖入 → 调用恰 2 条 + 节点计数仍 1 + toast 断言
  })

  test('stub-disposed: ＋画布 按钮退役(D-01 sole-caller)', async ({ page }) => {
    // TODO(61-01 Task 3): .am-card__add count === 0;.am-card / .am-card__locate 仍在
  })
})
