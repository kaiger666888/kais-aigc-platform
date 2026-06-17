import { test, expect, loadCanvas, nodeSelector } from '../helpers.mjs'

/**
 * Phase 35 — 分镜元数据扩展 (借鉴小云雀的运镜/景别/构图/节奏)
 *
 * 覆盖 STORYBOARD-01..07:
 *  - 字段在数据 schema 中存在
 *  - chips 渲染 (有值时显示,空值不显示)
 *  - NodeDetailPanel 下拉编辑器
 *  - 保存/重载往返
 */
test.describe('Phase 35 — Storyboard Metadata', () => {
  test('STORYBOARD-05: chips render for populated metadata fields', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 默认带 cameraMovement='zoom_in' → 应该有 chip
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await expect(sb1).toBeVisible()
    await expect(sb1.locator('text=推近')).toBeVisible()

    // storyboard-2 有 framing + composition + pacing 三个 chip
    const sb2 = page.locator(nodeSelector('storyboard-2'))
    await expect(sb2).toBeVisible()
    await expect(sb2.locator('text=近景')).toBeVisible()
    await expect(sb2.locator('text=三分法')).toBeVisible()
    await expect(sb2.locator('text=中速')).toBeVisible()
  })

  test('STORYBOARD-05: empty fields do not render chips', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 只设置了 cameraMovement,所以 framing/composition/pacing 不应该有 chip
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await expect(sb1.locator('text=推近')).toBeVisible()
    await expect(sb1.locator('text=近景')).toHaveCount(0)
    await expect(sb1.locator('text=三分法')).toHaveCount(0)
    await expect(sb1.locator('text=慢速')).toHaveCount(0)
  })

  test('STORYBOARD-06: NodeDetailPanel shows 4 dropdown editors for storyboard', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    // 等待详情面板渲染
    await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
    // 应该看到 "镜头意图" 区块 + 4 个 select
    await expect(page.locator('text=镜头意图').first()).toBeVisible()
    const selects = page.locator('[data-testid="detail-panel"] select')
    await expect(selects).toHaveCount(4)
  })

  test('STORYBOARD-06: dropdown change updates store immediately', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')
    const selects = page.locator('[data-testid="detail-panel"] select')
    // 第二个 select 是 framing
    const framingSelect = selects.nth(1)
    await framingSelect.selectOption('wide')
    // 等一下,chip 应该立即出现
    await expect(sb1.locator('text=远景')).toBeVisible({ timeout: 3_000 })
  })

  test('STORYBOARD-06: "未设置" option clears the field', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')
    // 第一开始有 "推近" chip
    await expect(sb1.locator('text=推近')).toBeVisible()
    // 第一个 select 是 cameraMovement,选未设置
    const select = page.locator('[data-testid="detail-panel"] select').first()
    await select.selectOption('')
    // 推近 chip 应该消失
    await expect(sb1.locator('text=推近')).toHaveCount(0)
  })

  test('STORYBOARD-07: save → reload round-trip preserves metadata', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')

    // 修改 framing 为 wide
    await page.locator('[data-testid="detail-panel"] select').nth(1).selectOption('wide')
    await expect(sb1.locator('text=远景')).toBeVisible()

    // 保存
    await page.locator('button:has-text("保存")').click()
    await expect(page.locator('button:has-text("保存中")')).toHaveCount(0, { timeout: 5_000 })

    // 验证后端收到了 framing=wide
    const saved = await page.evaluate(async () => {
      const res = await fetch('/__mock/state')
      return res.json()
    })
    const sb1Node = saved.canvas.nodes.find((n) => n.id === 'storyboard-1')
    expect(sb1Node.data.framing).toBe('wide')
    expect(sb1Node.data.cameraMovement).toBe('zoom_in') // 仍然保留
  })

  test('STORYBOARD-07: enums enforce valid values', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')
    // cameraMovement 下拉的 options 应该正好是定义的 9 个 + 未设置
    const options = await page.locator('[data-testid="detail-panel"] select').first().locator('option').allTextContents()
    expect(options).toContain('— 未设置 —')
    expect(options).toContain('固定')
    expect(options).toContain('推近')
    expect(options).toContain('跟随')
    expect(options.length).toBe(10) // 1 + 9
  })
})
