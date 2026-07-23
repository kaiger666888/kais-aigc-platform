import { test, expect, loadCanvas } from '../helpers.mjs'

/**
 * Phase 41 fix — Pipeline 同步链路
 *
 * 验证:当外部 pipeline 通过 /api/canvas/v2/save-v2 写入并广播 graph:saved
 * 事件时,前端必须自动 reload 画布并显示 toast。前端自己的 saveCanvasGraph
 * 走 legacy /api/canvas/save 不广播此事件,所以无循环重载。
 *
 * 修复见 commit eb1a806b:
 *   - useCanvasSocket: 加 onGraphSaved? + socket.on('graph:saved')
 *   - FlowCanvas: onGraphSaved 触发 loadCanvas + toast
 */

function makeAssetNode(id, label) {
  return {
    id,
    type: 'asset',
    position: { x: 800, y: 200 },
    size: { width: 260, height: 180 },
    data: { label, type: 'asset', assetType: 'role', prompt: 'pipeline-generated', state: 'idle' },
    state: 'idle',
  }
}

/** 统计资产节点数（V3 迁移会为每个资产合成一个事件芯片，故只数资产节点）。 */
function countAssets(page) {
  return page.evaluate(() => {
    const nodes = window.__kaisCanvas?.getNodes?.() ?? []
    return nodes.filter((n) => n.data?.v3?.kind === 'asset').length
  })
}

test.describe('Phase 41 — Pipeline graph:saved 同步', () => {
  test('SYNC-01: pipeline save-v2 触发前端 reload + toast', async ({ page }) => {
    await loadCanvas(page)
    const initialAssetCount = await countAssets(page)
    expect(initialAssetCount).toBeGreaterThan(0)

    // 模拟 pipeline 全量写入:在 mock state 上加一个新节点
    const state = await page.request.get('/__mock/state').then((r) => r.json())
    const newGraph = {
      ...state.canvas,
      nodes: [...(state.canvas.nodes ?? []), makeAssetNode('pipeline-asset-1', 'Pipeline 资产 1')],
    }
    const resp = await page.request.post('/api/canvas/v2/save-v2', {
      data: { projectId: 1, episodesId: 1, graph: newGraph },
    })
    expect(resp.ok()).toBeTruthy()

    // toast 出现
    await expect(page.locator('text=/Pipeline 同步了新数据/')).toBeVisible({ timeout: 5_000 })

    // 资产节点数 +1（V3 会同时多一个事件芯片，故只数资产节点）
    await expect.poll(() => countAssets(page), { timeout: 5_000 }).toBe(initialAssetCount + 1)
    await expect(page.locator('.react-flow__node[data-id="pipeline-asset-1"]')).toBeVisible()
  })

  test('SYNC-02: 跨 project 的 graph:saved 不触发 reload', async ({ page }) => {
    await loadCanvas(page)
    const initialCount = await page.locator('.react-flow__node').count()

    // pipeline 写到 projectId=999(不是当前 1)— mock 不改当前 state
    await page.request.post('/__mock/emit', {
      data: {
        projectId: 999,
        event: 'graph:saved',
        data: { projectId: 999, episodesId: 1, timestamp: Date.now() },
      },
    })

    // 等 1 秒,确保如果有 bug 触发 reload 也已经发生
    await page.waitForTimeout(1000)

    // toast 不应出现
    expect(await page.locator('text=/Pipeline 同步了新数据/').count()).toBe(0)
    // 节点数不应变化
    expect(await page.locator('.react-flow__node').count()).toBe(initialCount)
  })
})
