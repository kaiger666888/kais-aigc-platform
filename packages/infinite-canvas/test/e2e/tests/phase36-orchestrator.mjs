import { test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView } from '../helpers.mjs'

/**
 * Phase 36 — 一键成片编排器 (借鉴小云雀的"一键直出视频成片")
 */
test.describe('Phase 36 — One-Click Film Orchestrator', () => {
  test('ORCHESTRATE-01: button visible + enabled when canvas has nodes', async ({ page }) => {
    await loadCanvas(page)
    const btn = page.locator('button:has-text("一键成片")')
    await expect(btn).toBeVisible()
    await expect(btn).toBeEnabled()
  })

  test('ORCHESTRATE-02: clicking button POSTs /api/canvas/orchestrate with full mode', async ({ page }) => {
    await loadCanvas(page)
    await page.locator('button:has-text("一键成片")').click()
    await page.waitForTimeout(500)
    const calls = await getCalls(page)
    const orch = calls.find((c) => c.path === '/api/canvas/orchestrate')
    expect(orch).toBeDefined()
    expect(orch.body.mode).toBe('full')
    expect(orch.response.runId).toMatch(/^run-/)
  })

  test('ORCHESTRATE-04: success nodes are skipped', async ({ page }) => {
    await loadCanvas(page)
    await page.locator('button:has-text("一键成片")').click()
    await page.waitForTimeout(800)
    const calls = await getCalls(page)
    const orch = calls.find((c) => c.path === '/api/canvas/orchestrate')
    expect(orch.response.total).toBe(5) // 6 - 1 (script-0 是 success)
    expect(orch.response.skipped).toBe(1)
  })

  test('ORCHESTRATE-05/06: progress bar + button shows 运行中 (N/M)', async ({ page }) => {
    await loadCanvas(page)
    // 拉长延迟以便观察 running 状态
    await page.request.post('/__mock/config', { data: { orchDelay: 500 } })

    await page.locator('button:has-text("一键成片")').click()
    await expect(page.locator('button:has-text("运行中")')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('div[style*="width: 120px"]')).toBeVisible()
  })

  test('ORCHESTRATE-07: completion toast appears with summary', async ({ page }) => {
    await loadCanvas(page)
    await page.locator('button:has-text("一键成片")').click()
    await expect(page.locator('text=/一键成片完成.*5\\/5 节点成功/')).toBeVisible({ timeout: 5_000 })
  })

  test('ORCHESTRATE-07: single-node failure does not abort the run', async ({ page }) => {
    await loadCanvas(page)
    await page.request.post('/__mock/config', { data: { failSecondNode: true, orchDelay: 200 } })

    await page.locator('button:has-text("一键成片")').click()
    await expect(page.locator('text=/一键成片完成.*4\\/5 成功.*1 失败/')).toBeVisible({ timeout: 5_000 })
  })

  test('ORCHESTRATE-06: button disabled while running', async ({ page }) => {
    await loadCanvas(page)
    await page.request.post('/__mock/config', { data: { orchDelay: 800 } })

    await page.locator('button:has-text("一键成片")').click()
    await expect(page.locator('button:has-text("运行中")')).toBeDisabled()
  })

  test('ORCHESTRATE-01: button disabled when canvas empty (no projectId)', async ({ page }) => {
    // 直接访问根路径,没有 projectId（一键成片按钮在画布工具栏，需先切到画布视图）
    await page.goto('/', { waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForTimeout(800)
    const btn = page.locator('button:has-text("一键成片")')
    await expect(btn).toBeVisible()
    await expect(btn).toBeDisabled()
  })

  test('ORCHESTRATE-03: topology order via currentNodeId in progress events', async ({ page }) => {
    await loadCanvas(page)
    await page.request.post('/__mock/config', { data: { orchDelay: 300 } })

    // 注入 socket.io-client 监听器 —— 用 testMode hook 暴露的本地 socket.io-client
    // （window.__kaisCanvas.io），避免浏览器侧 CDN dynamic import（沙箱常不可达）。
    await page.evaluate(() => {
      window.__progressOrder = []
      const s = window.__kaisCanvas.io('/ws/projects', { query: { projectId: '1' }, transports: ['websocket', 'polling'] })
      s.on('orchestrate:progress', (p) => {
        if (p.mode === 'full') window.__progressOrder.push(p.currentNodeId)
      })
      window.__testSocket = s
    })

    await page.locator('button:has-text("一键成片")').click()
    await page.waitForTimeout(2500)
    const order = await page.evaluate(() => window.__progressOrder)
    expect(order[0]).toBe('asset-1')
    const sb1Idx = order.indexOf('storyboard-1')
    const v1Idx = order.indexOf('video-1')
    expect(sb1Idx).toBeGreaterThan(-1)
    expect(v1Idx).toBeGreaterThan(-1)
    expect(sb1Idx).toBeLessThan(v1Idx)
  })
})
