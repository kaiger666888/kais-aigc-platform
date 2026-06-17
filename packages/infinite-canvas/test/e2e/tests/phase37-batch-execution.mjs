import { test, expect, loadCanvas, nodeSelector, getCalls, setSelectedNodeIds } from '../helpers.mjs'

/**
 * Phase 37 — 批量执行 (借鉴小云雀的多镜头批量生成)
 *
 * 注: React Flow v12 的 multi-select UI 在 headless playwright 中不稳定,
 * 我们通过 testMode hook 直接设置 selectedNodeIds 来驱动测试 — 这绕过了
 * React Flow 的 selection 模型,但完整验证了 v1.7 Phase 37 的应用层逻辑:
 *   - selectedNodeIds 状态正确同步到 CanvasContextMenu
 *   - 批量执行入口调用 /api/canvas/orchestrate 携带 nodeIds
 *   - 单节点右键仍保留 /api/canvas/execute 入口 (BATCH-05)
 */
test.describe('Phase 37 — Batch Execution', () => {
  test('BATCH-01: multi-select + right-click shows batch menu entry', async ({ page }) => {
    await loadCanvas(page)
    // 通过 testMode hook 直接设置多选状态
    await setSelectedNodeIds(page, ['storyboard-1', 'storyboard-2'])
    // 在 pane 上右键打开 context menu
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await expect(page.locator('text=/批量执行 \\(\\d+ 个节点\\)/')).toBeVisible({ timeout: 5_000 })
  })

  test('BATCH-01: menu shows correct selection count', async ({ page }) => {
    await loadCanvas(page)
    await setSelectedNodeIds(page, ['storyboard-1', 'storyboard-2', 'video-1'])
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await expect(page.locator('text=/批量执行 \\(3 个节点\\)/')).toBeVisible({ timeout: 5_000 })
  })

  test('BATCH-02: batch execution calls /api/canvas/orchestrate with explicit nodeIds', async ({ page }) => {
    await loadCanvas(page)
    await setSelectedNodeIds(page, ['storyboard-1', 'storyboard-2'])
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await page.locator('text=/批量执行 \\(\\d+ 个节点\\)/').click()
    await page.waitForTimeout(500)

    const calls = await getCalls(page)
    const orch = calls.find((c) => c.path === '/api/canvas/orchestrate')
    expect(orch).toBeDefined()
    expect(orch.body.mode).toBe('batch')
    expect(orch.body.nodeIds).toEqual(expect.arrayContaining(['storyboard-1', 'storyboard-2']))
    expect(orch.body.nodeIds).toHaveLength(2)
  })

  test('BATCH-03: batch execution honors success skip logic', async ({ page }) => {
    await loadCanvas(page)
    // 多选 script-0(success)+ asset-1(idle)
    await setSelectedNodeIds(page, ['script-0', 'asset-1'])
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await page.locator('text=/批量执行 \\(\\d+ 个节点\\)/').click()
    await page.waitForTimeout(500)

    const calls = await getCalls(page)
    const orch = calls.find((c) => c.path === '/api/canvas/orchestrate')
    expect(orch.response.total).toBe(1) // script-0 跳过
    expect(orch.response.skipped).toBe(1)
  })

  test('BATCH-04: batch progress uses same WebSocket channel', async ({ page }) => {
    await loadCanvas(page)
    await setSelectedNodeIds(page, ['storyboard-1', 'storyboard-2'])
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await page.locator('text=/批量执行 \\(\\d+ 个节点\\)/').click()
    // 编排运行很快 (2 节点 × 50ms),完成 toast 会替换开始 toast。
    // 验证方式:orchestration 状态变成 done,且 toast 出现过 "批量执行" 前缀 (开始或完成)
    await expect(page.locator('text=/批量执行(开始|完成)/').first()).toBeVisible({ timeout: 5_000 })
    // 也校验 orchestration state 进入 done
    await expect.poll(async () => {
      return page.evaluate(() => window.__kaisCanvas?.getOrchestration?.()?.status)
    }, { timeout: 5_000 }).toBe('done')
  })

  test('BATCH-05: single-node right-click still has "执行节点" entry', async ({ page }) => {
    await loadCanvas(page)
    await page.locator(nodeSelector('asset-1')).click({ button: 'right' })
    await expect(page.locator('text=执行节点')).toBeVisible({ timeout: 3_000 })
  })

  test('BATCH-05: single-node "执行节点" triggers /api/canvas/execute (legacy path)', async ({ page }) => {
    await loadCanvas(page)
    await page.locator(nodeSelector('asset-1')).click({ button: 'right' })
    await page.locator('text=执行节点').click()
    await page.waitForTimeout(500)

    const calls = await getCalls(page)
    const exec = calls.find((c) => c.path === '/api/canvas/execute')
    expect(exec).toBeDefined()
    expect(exec.body.nodeId).toBe('asset-1')
  })

  test('BATCH-01: pane right-click alone (no multi-select) does NOT show batch entry', async ({ page }) => {
    await loadCanvas(page)
    // 没有多选,pane 右键不应该显示批量执行
    await page.locator('.react-flow__pane').click({ button: 'right' })
    await expect(page.locator('text=/批量执行/')).toHaveCount(0)
  })
})
