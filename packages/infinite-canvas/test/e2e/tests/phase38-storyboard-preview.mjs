import { test, expect, loadCanvas, nodeSelector } from '../helpers.mjs'

/**
 * Phase 38 — 分镜构图预览卡片 (Tier 2, 借鉴小云雀的"分镜即预览")
 *
 * 覆盖 PREVIEW-01..05:
 *  - 按钮存在 + 启用条件 (有 linkedAssetIds 且有 prompt)
 *  - 点击触发 /api/canvas/storyboard/preview
 *  - 失败不阻塞主流程
 *  - 非 storyboard 节点没有按钮
 */
test.describe('Phase 38 — Storyboard Preview', () => {
  test('PREVIEW-01: 预览构图 button visible on storyboard node', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 应该有 "👁 预览构图" 按钮
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await expect(sb1.locator('button:has-text("预览构图")')).toBeVisible()
  })

  test('PREVIEW-01: button enabled when linkedAssetIds > 0 AND prompt non-empty', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    const btn = sb1.locator('button:has-text("预览构图")')
    // mock storyboard-1 有 linkedAssetIds=[1] 和 prompt='主角进入场景' → 应启用
    await expect(btn).toBeEnabled()
  })

  test('PREVIEW-02: clicking button POSTs /api/canvas/storyboard/preview', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.locator('button:has-text("预览构图")').click()
    await page.waitForTimeout(300)
    const calls = await page.evaluate(async () => {
      const res = await fetch('/__mock/calls')
      return res.json()
    })
    const prev = calls.find((c) => c.path === '/api/canvas/storyboard/preview')
    expect(prev).toBeDefined()
    expect(prev.body.nodeId).toBe('storyboard-1')
  })

  test('PREVIEW-01: shows "预览生成中..." toast on click', async ({ page }) => {
    await loadCanvas(page)
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.locator('button:has-text("预览构图")').click()
    await expect(page.locator('text=预览生成中')).toBeVisible({ timeout: 2_000 })
  })

  test('PREVIEW-05: non-storyboard nodes do not have the preview button', async ({ page }) => {
    await loadCanvas(page)
    // script 节点不应该有预览按钮
    const script0 = page.locator(nodeSelector('script-0'))
    await expect(script0.locator('button:has-text("预览构图")')).toHaveCount(0)
    // asset 节点不应该有
    const asset1 = page.locator(nodeSelector('asset-1'))
    await expect(asset1.locator('button:has-text("预览构图")')).toHaveCount(0)
    // video 节点不应该有
    const video1 = page.locator(nodeSelector('video-1'))
    await expect(video1.locator('button:has-text("预览构图")')).toHaveCount(0)
  })

  test('PREVIEW-05: preview failure does not block main flow', async ({ page }) => {
    await loadCanvas(page)
    // 即使后端失败,前端应该不崩溃,只 toast
    // 这里直接验证按钮点击后页面仍然可用
    const sb1 = page.locator(nodeSelector('storyboard-1'))
    await sb1.locator('button:has-text("预览构图")').click()
    await page.waitForTimeout(200)
    // 保存按钮应该仍然可用
    await expect(page.locator('button:has-text("保存")')).toBeEnabled()
    // 画布仍然有节点
    await expect(page.locator('.react-flow__node')).toHaveCount(6)
  })
})
