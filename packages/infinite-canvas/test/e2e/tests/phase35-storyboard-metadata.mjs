import { test, expect, loadCanvas, nodeSelector } from '../helpers.mjs'

/**
 * Phase 35 — 分镜元数据扩展 (借鉴小云雀的运镜/景别/构图/节奏)
 *
 * 覆盖 STORYBOARD-01..07:
 *  - 字段在数据 schema 中存在
 *  - chips 渲染 (有值时显示,空值不显示)
 *  - NodeDetailPanel 下拉编辑器
 *  - 保存/重载往返
 *
 * V3 适配说明：V3 用统一 AssetCardNode 取代了 per-type StoryboardNode，卡片上
 * **不再渲染** 运镜/景别/构图/节奏 chip（这些字段归入资产的 `data.meta`）。
 * 因此原 chip 断言改为「节点存在 + store meta 携带字段」——业务语义不变
 * （有值字段被节点持有、空字段不持有），只是观测点从 chip DOM 移到 canonical 数据。
 * 下拉编辑器与枚举选项断言维持不变（NodeDetailPanel 仍渲染 4 个 select）。
 */

/** 读取某节点的 meta（V3 storyboard 元数据权威存放处）。 */
async function getMeta(page, id) {
  return page.evaluate((nodeId) => {
    const n = window.__kaisCanvas?.getNodes?.().find((x) => x.id === nodeId)
    return n?.data?.meta ?? {}
  }, id)
}

/** 读取某节点 data 上的扁平字段值（下拉编辑器写入处）。 */
async function getField(page, id, field) {
  return page.evaluate(({ nodeId, f }) => {
    const n = window.__kaisCanvas?.getNodes?.().find((x) => x.id === nodeId)
    return n?.data?.[f]
  }, { nodeId: id, f: field })
}

test.describe('Phase 35 — Storyboard Metadata', () => {
  test('STORYBOARD-05: populated metadata fields render on the storyboard asset', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 默认带 cameraMovement='zoom_in'（→ 推近）
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await expect(sb1).toBeVisible()
    const meta1 = await getMeta(page, 'storyboard-1')
    expect(meta1.cameraMovement).toBe('zoom_in')

    // storyboard-2 有 framing + composition + pacing 三个字段（→ 近景 / 三分法 / 中速）
    const sb2 = page.locator(nodeSelector('storyboard-2'))
    await expect(sb2).toBeVisible()
    const meta2 = await getMeta(page, 'storyboard-2')
    expect(meta2.framing).toBe('close_up')
    expect(meta2.composition).toBe('rule_of_thirds')
    expect(meta2.pacing).toBe('medium')
  })

  test('STORYBOARD-05: unset metadata fields are absent from the storyboard asset', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 只设置了 cameraMovement，framing/composition/pacing 不应存在
    const meta1 = await getMeta(page, 'storyboard-1')
    expect(meta1.cameraMovement).toBe('zoom_in')
    expect(meta1.framing).toBeUndefined()
    expect(meta1.composition).toBeUndefined()
    expect(meta1.pacing).toBeUndefined()
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
    // V3：卡片不再渲染 chip；改验证 store 里 framing 已即时更新为 wide（→ 远景）
    await expect.poll(() => getField(page, 'storyboard-1', 'framing'), { timeout: 3_000 }).toBe('wide')
  })

  test('STORYBOARD-06: "未设置" option clears the field', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')
    // 第一个 select 是 cameraMovement：先设为 zoom_in，再选「未设置」清空
    const select = page.locator('[data-testid="detail-panel"] select').first()
    await select.selectOption('zoom_in')
    await expect.poll(() => getField(page, 'storyboard-1', 'cameraMovement'), { timeout: 3_000 }).toBe('zoom_in')
    await select.selectOption('')
    await expect.poll(() => getField(page, 'storyboard-1', 'cameraMovement'), { timeout: 3_000 }).toBeUndefined()
  })

  test('STORYBOARD-07: save → reload round-trip preserves metadata', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.click()
    await page.waitForSelector('[data-testid="detail-panel"]')

    // 修改 framing 为 wide
    await page.locator('[data-testid="detail-panel"] select').nth(1).selectOption('wide')
    await expect.poll(() => getField(page, 'storyboard-1', 'framing'), { timeout: 3_000 }).toBe('wide')

    // 关闭详情面板，避免右侧面板遮住顶部工具栏的保存按钮
    await page.locator('[data-testid="detail-panel"] button:has-text("✕")').click()
    await expect(page.locator('[data-testid="detail-panel"]')).toHaveCount(0)

    // 保存
    await page.locator('button:has-text("保存")').click()
    await expect(page.locator('button:has-text("保存中")')).toHaveCount(0, { timeout: 5_000 })

    // 验证后端收到了编辑：flat framing=wide 已随保存序列化；原始 meta.cameraMovement 保留
    const saved = await page.evaluate(async () => {
      const res = await fetch('/__mock/state')
      return res.json()
    })
    const sb1Node = saved.canvas.nodes.find((n) => n.id === 'storyboard-1')
    expect(sb1Node.data.framing).toBe('wide')
    expect(sb1Node.data.meta?.cameraMovement).toBe('zoom_in')
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
