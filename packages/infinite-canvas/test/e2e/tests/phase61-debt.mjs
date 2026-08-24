import { test, expect, getCalls } from '../helpers.mjs'

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

/** 等视口安定(fitView 600ms 动画内换算基准仍在移动——drop/断言前必须稳;
 *  phase55-nav waitViewportSettled 同款,防 drop 换算与 screenToFlow 断言基准漂移)。 */
async function waitViewportSettled(page) {
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      await page.waitForTimeout(250)
      const b = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      return a != null && b != null && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 ? 1 : 0
    }, { timeout: 8_000 })
    .toBe(1)
}

/** 步骤③:pane dragover + drop(拖放点 clientX/clientY;__e2eDt 载荷仍在)。 */
async function dropOnPane(page, clientX = 700, clientY = 400) {
  await page.evaluate(([cx, cy]) => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) throw new Error('react-flow__pane not found')
    const init = { dataTransfer: window.__e2eDt, bubbles: true, cancelable: true, clientX: cx, clientY: cy }
    pane.dispatchEvent(new DragEvent('dragover', init))
    pane.dispatchEvent(new DragEvent('drop', init))
  }, [clientX, clientY])
}

/** 合成拖拽序列(三步,同一 DataTransfer 存 window.__e2eDt):
 *  ① 资产卡片 dragstart(写 MIME 载荷)→ ② 「画布」页签 dragover(切视图,
 *  等 ReactFlow pane 挂载 + 视口安定)→ ③ pane dragover + drop。 */
async function dragAssetIntoCanvas(page, { clientX = 700, clientY = 400 } = {}) {
  // ① 卡片 dragstart(资产中心视图;fixture 第一张卡 = asset-90001)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    window.__e2eDt = dt
    const card = document.querySelector('.am-card')
    if (!card) throw new Error('am-card not found(资产中心未挂载?)')
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  // ② 「画布」页签 dragover → 视图切换;等 ReactFlow 挂载
  await page.getByRole('button', { name: '画布', exact: true }).evaluate((el) => {
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: window.__e2eDt, bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('.react-flow__pane', { timeout: 15_000 })
  await waitViewportSettled(page)
  // ③ pane dragover + drop
  await dropOnPane(page, clientX, clientY)
}

test.describe('phase61-debt 拖入清偿', () => {
  test('drag-in-bounded: 拖入落点与拖放点各轴 ≤64px(D-01)', async ({ page }) => {
    await loadAssetCenter(page)
    await dragAssetIntoCanvas(page, { clientX: 700, clientY: 400 })

    // canonical graph 出现节点(广播 → onNewAsset → addNodeFromSocket → setGraph)
    await expect
      .poll(() => page.evaluate(() =>
        (window.__kaisCanvas?.getGraph()?.nodes ?? []).some((n) => n.id === 'asset-90001') ? 1 : 0),
      { timeout: 10_000 })
      .toBe(1)
    // RF DOM 反射(setGraph 重建 → layoutedNodes → RF 渲染全链证据)
    await expect
      .poll(() => page.evaluate(() =>
        (document.querySelector('.react-flow__node[data-id="asset-90001"]') ? 1 : 0)),
      { timeout: 10_000 })
      .toBe(1)

    // 有界断言:canonical position 与 drop 锚(screenToFlow 桥换算)各轴 ≤64px
    // (source 锚理论紧界 dx≤26/dy≤18,64 留裕量——Pattern 3 口径)
    const dist = await page.evaluate(() => {
      const n = window.__kaisCanvas?.getGraph()?.nodes.find((x) => x.id === 'asset-90001')
      const anchor = window.__kaisCanvas?.screenToFlow?.({ x: 700, y: 400 })
      if (!n || !anchor) return null
      return { dx: Math.abs(n.position.x - anchor.x), dy: Math.abs(n.position.y - anchor.y) }
    })
    expect(dist).not.toBeNull()
    expect(dist.dx).toBeLessThanOrEqual(64)
    expect(dist.dy).toBeLessThanOrEqual(64)

    // 持久化三点一线:POST /nodes 落库记录 nodeId/x/y 与 canonical position 相等
    // (POST 载荷 = 落库真值 = 客户端显示,truth-first;JSON 双精度往返无损 → toBe)
    const calls = await getCalls(page)
    const nodeCalls = calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/v2/nodes/')
    expect(nodeCalls.length).toBe(1)
    expect(nodeCalls[0].body.nodeId).toBe('asset-90001')
    // WR-02(review-61): data 袋携带注册表主键——assetIdOf 联动 + filePath 补全链
    // 的 wire 证据(mock logCall 防御性提取;fixture 首卡 = id 90001 / uuid e2e-asset-90001)
    expect(nodeCalls[0].body.assetId).toBe(90001)
    expect(nodeCalls[0].body.assetUuid).toBe('e2e-asset-90001')
    const node = await page.evaluate(() =>
      window.__kaisCanvas?.getGraph()?.nodes.find((x) => x.id === 'asset-90001'))
    expect(nodeCalls[0].body.x).toBe(node.position.x)
    expect(nodeCalls[0].body.y).toBe(node.position.y)
  })

  test('drag-in-duplicate-409: 同资产二次拖入 → 409 + toast(已在画布', async ({ page }) => {
    await loadAssetCenter(page)
    await dragAssetIntoCanvas(page, { clientX: 700, clientY: 400 })
    // 第一次拖入落图(canonical 恰 1 个)
    await expect
      .poll(() => page.evaluate(() =>
        (window.__kaisCanvas?.getGraph()?.nodes ?? []).filter((n) => n.id === 'asset-90001').length),
      { timeout: 10_000 })
      .toBe(1)

    // 第二次拖同一资产:视图已在画布,直接用同一 DataTransfer 再 drop 一次
    // (合成面不依赖卡片存活;真实面 dragend 仍发,视图已切不回 assets)
    await dropOnPane(page, 700, 400)

    // WR-03(review-61): 第二次 POST 完成门——dropOnPane 返回只保证浏览器 fetch 已
    // 发起,getCalls 走 page.request 独立连接,与浏览器 fetch 无 happens-before 保证;
    // 立即读数在 CPU 抖动下可为 1。先 poll 到恰 2 条再读明细断言(用例 1 的
    // graph-poll 门同理——以副作用收口,不赌请求竞速)。
    await expect
      .poll(async () => (await getCalls(page))
        .filter((c) => c.method === 'POST' && c.path === '/api/canvas/v2/nodes/').length,
        { timeout: 10_000 })
      .toBe(2)
    // 该路由恰 2 条调用记录(顺序即时间;mock 不记 response,以副作用断言)
    const nodeCalls = (await getCalls(page))
      .filter((c) => c.method === 'POST' && c.path === '/api/canvas/v2/nodes/')
    expect(nodeCalls.length).toBe(2)
    expect(nodeCalls[0].body.nodeId).toBe('asset-90001')
    expect(nodeCalls[1].body.nodeId).toBe('asset-90001')

    // 画布上该 id 节点仍恰 1 个(409 无广播,不重复插入;过广播窗口后复查)
    await page.waitForTimeout(400)
    const count = await page.evaluate(() =>
      (window.__kaisCanvas?.getGraph()?.nodes ?? []).filter((n) => n.id === 'asset-90001').length)
    expect(count).toBe(1)

    // toast「已在画布」(3s 自灭窗口内断言)
    await expect(page.getByText('该资产已在画布上')).toBeVisible({ timeout: 3_000 })
  })

  test('stub-disposed: ＋画布 按钮退役(D-01 sole-caller)', async ({ page }) => {
    await loadAssetCenter(page)
    // 「＋ 画布」stub 按钮退役 = 0
    expect(await page.locator('.am-card__add').count()).toBe(0)
    // 退役面精准,不误伤:卡片本体与定位按钮仍在
    expect(await page.locator('.am-card').count()).toBeGreaterThan(0)
    expect(await page.locator('.am-card__locate').count()).toBeGreaterThan(0)
  })
})
