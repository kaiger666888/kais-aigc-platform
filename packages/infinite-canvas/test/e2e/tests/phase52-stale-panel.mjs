import { test, expect, loadCanvas, getCalls, switchToCanvasView, nodeSelector } from '../helpers.mjs'

/**
 * Phase 52-05 — REGEN-03/04: stale 下游一键重跑 + 面板交互
 *
 * 覆盖:
 *  - REGEN-03-a: save-v2 注入带 data.stale 的 success 节点 → reload → stale 角标可见 →
 *    点击角标 → mock orchestrate body nodeIds 含该节点且 total=1/skipped=0(stale
 *    success 不跳过,52-02 mock 镜像)→ node:state success 广播后角标消失
 *    (applySocketNodeState 清 stale,52-01)。
 *  - REGEN-03-b: 注入 stale 图 → reload → 角标仍在(stale 刷新不丢,地雷 #2 e2e 防线)。
 *  - REGEN-04-a: dblclick 开面板 → 宽度 ≈480(400≤w≤520 容差)。
 *  - REGEN-04-b: 面板开着单击另一节点 → 保持打开且内容跟随;点空白 → 关闭;
 *    关闭后单击 → 不打开(回归)。
 *
 * ⚠️ 前置纪律(地雷 #10):e2e 跑 dist 非源码——运行本文件前必须 `npm run build`
 *    (packages/infinite-canvas),否则测的是旧构建产物。
 *
 * fixture/注入选定注释:
 *  - 注入图 = 单 storyboard-1 节点(state:'success' + data.stale 三字段),经 save-v2
 *    全量替换 mock canvas(REGEN-01-c 注入范式);load-v2 → migrate restoreStaleInfo
 *    还原 asset.stale(52-02)→ 角标渲染。
 *  - 跟随断言用 PromptSection textarea 值:storyboard-1=「主角进入场景」、
 *    storyboard-2=「特写镜头」(fixture 实证值,两节点都有合成产生事件可编辑)。
 */

/** 注入带 stale 标记的 success 图(storyboard-1 单节点,无下游——链=自身)。 */
async function injectStaleGraph(page) {
  await page.request.post('/api/canvas/v2/save-v2', {
    data: {
      projectId: 1,
      episodesId: 1,
      graph: {
        nodes: [
          {
            id: 'storyboard-1', type: 'storyboard',
            position: { x: 400, y: 500 }, size: { width: 260, height: 180 },
            data: {
              label: '分镜 1', type: 'storyboard', storyboardId: 1, duration: 3,
              prompt: '主角进入场景', filePath: null, thumbnailUrl: null, state: 'success',
              stale: { since: 1724280000000, triggerAssetId: 'script-0', triggerEventId: 'e2' },
            },
            state: 'success',
          },
        ],
        links: [], groups: [], variantGroups: [],
      },
    },
  })
  // 重新加载 → load-v2 取注入图 → migrate 还原 stale
  await page.reload({ waitUntil: 'networkidle' })
  await switchToCanvasView(page)
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForTimeout(300)
}

/** 打开节点详情面板(dblclick,phase35 契约手法)。 */
async function openDetailPanel(page, nodeId) {
  await page.locator(nodeSelector(nodeId)).dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
}

test.describe('Phase 52-05 — REGEN-03 stale rerun / REGEN-04 panel UX', () => {
  test('REGEN-03-a: badge click → orchestrate subset (stale success not skipped) → badge cleared', async ({ page }) => {
    await loadCanvas(page)
    await injectStaleGraph(page)

    const staleBadge = page.locator(`${nodeSelector('storyboard-1')} svg[aria-label="stale"]`)
    await expect(staleBadge).toBeVisible()

    // 点击角标(出口之一;stopPropagation 隔离,不触发 onNodeClick 切面板)
    await staleBadge.click()

    // rerunStaleChain:先 save-v2(stale 上 wire)→ orchestrate nodeIds 子集
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/orchestrate')
      return exec?.body?.total
    }, { timeout: 8_000 }).toBeGreaterThanOrEqual(1)

    expect(exec.body.nodeIds).toContain('storyboard-1')
    expect(exec.body.mode).toBe('batch')
    // stale success 未跳过:唯一目标计入 total,skipped=0(52-02 mock 镜像谓词;
    // skipped 在 logCall response 字段非 body)
    expect(exec.body.total).toBe(1)
    expect(exec.response?.skipped).toBe(0)

    // node:state success 广播 → applySocketNodeState 清 stale(52-01)→ 角标消失
    await expect(staleBadge).toHaveCount(0, { timeout: 8_000 })
  })

  test('REGEN-03-b: injected stale badge survives page reload', async ({ page }) => {
    await loadCanvas(page)
    await injectStaleGraph(page)
    // injectStaleGraph 已含一次 reload;再 reload 一次强化「刷新不丢」断言语境
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForTimeout(300)
    await expect(page.locator(`${nodeSelector('storyboard-1')} svg[aria-label="stale"]`)).toBeVisible()
  })

  test('REGEN-04-a: detail panel default width ≈480px', async ({ page }) => {
    await loadCanvas(page)
    await openDetailPanel(page, 'storyboard-1')
    const box = await page.locator('[data-testid="detail-panel"]').boundingBox()
    expect(box).toBeTruthy()
    expect(box.width).toBeGreaterThanOrEqual(400)
    expect(box.width).toBeLessThanOrEqual(520)
  })

  test('REGEN-04-b: open panel follows single-click; blank closes; closed stays closed', async ({ page }) => {
    await loadCanvas(page)

    // 开面板(storyboard-1)→ 内容为主角进入场景
    await openDetailPanel(page, 'storyboard-1')
    const panel = page.locator('[data-testid="detail-panel"]')
    await expect(page.locator('[data-testid="prompt-textarea"]')).toHaveValue('主角进入场景')

    // 面板开着 → 单击 storyboard-2 → 面板保持打开 + 内容跟随(跟随 = textarea 值切换)
    await page.locator(nodeSelector('storyboard-2')).click()
    await expect(panel).toBeVisible()
    await expect(page.locator('[data-testid="prompt-textarea"]')).toHaveValue('特写镜头')

    // 点空白 → 面板关闭(onPaneClick 回归)。取 pane 中下部空白:fitView padding 0.15
    // 使节点集中中部,底部 ~15% 无节点;左上 Controls 与左侧分镜树(shot-tree)均避开
    const paneBox = await page.locator('.react-flow__pane').boundingBox()
    await page.mouse.click(paneBox.x + paneBox.width * 0.55, paneBox.y + paneBox.height * 0.92)
    await expect(panel).toHaveCount(0)

    // 关闭后单击节点 → 面板不打开(单击不开面板,双击才开——回归)
    await page.locator(nodeSelector('storyboard-1')).click()
    await page.waitForTimeout(300)
    await expect(panel).toHaveCount(0)
  })
})
