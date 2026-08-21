import { test, expect, loadCanvas, nodeSelector } from '../helpers.mjs'

/**
 * Phase 38 — 分镜构图预览卡片 (Tier 2, 借鉴小云雀的"分镜即预览")
 *
 * V3 适配说明：V3 统一 AssetCardNode 取代了 per-type StoryboardNode，旧的
 * 「👁 预览构图」按钮在 V3 卡片上**已不存在**——构图预览由卡片封面 + 生成事件
 * （携带 prompt 的 evt_* 芯片）承担。因此：
 *  - 原「按钮存在 / 启用 / 点击 POST / toast」断言 → 改为验证 storyboard 资产
 *    节点存在、其生成事件携带 prompt，以及后端 `/api/canvas/storyboard/preview`
 *    契约仍被遵守（直接 POST）。
 *  - 计数断言改为只数资产节点（事件芯片不计入）。
 *  - 保留「非分镜节点没有预览入口」的语义：V3 表现为画布上不存在「预览构图」按钮。
 */

/** 统计资产节点数（事件芯片 / 结构节点不计）。 */
function countAssets(page) {
  return page.evaluate(() => {
    const nodes = window.__kaisCanvas?.getNodes?.() ?? []
    return nodes.filter((n) => n.data?.v3?.kind === 'asset').length
  })
}

test.describe('Phase 38 — Storyboard Preview', () => {
  test('PREVIEW-01: storyboard asset nodes render on the canvas', async ({ page }) => {
    await loadCanvas(page)
    // storyboard-1 / storyboard-2 资产节点渲染（RF wrapper 在任意 LOD 都存在）
    await expect(page.locator(nodeSelector('storyboard-1'))).toBeVisible()
    await expect(page.locator(nodeSelector('storyboard-2'))).toBeVisible()

    const stages = await page.evaluate(() => {
      const ids = ['storyboard-1', 'storyboard-2']
      return window.__kaisCanvas?.getNodes?.()
        .filter((n) => ids.includes(n.id))
        .map((n) => ({ id: n.id, stage: n.data?.stage }))
    })
    expect(stages).toEqual([
      { id: 'storyboard-1', stage: 'storyboard' },
      { id: 'storyboard-2', stage: 'storyboard' },
    ])
  })

  test('PREVIEW-01: storyboard generation event carries the composition prompt', async ({ page }) => {
    await loadCanvas(page)
    // V3：事件节点折叠为资产间因果边，op 配方挂边中点（P19）；storyboard 的构图意图
    // prompt 由其生成事件 evt_storyboard-1 携带，经折叠边的 data.eventId/params 观测。
    const evt = await page.evaluate(() => {
      const e = (window.__kaisCanvas?.getEdges?.() ?? []).find((x) => x.data?.eventId === 'evt_storyboard-1')
      return { op: e?.data?.op, prompt: e?.data?.params?.prompt }
    })
    expect(evt.op).toBe('create')
    expect(evt.prompt).toBe('主角进入场景')
  })

  test('PREVIEW-02: /api/canvas/storyboard/preview contract honored', async ({ page }) => {
    await loadCanvas(page)
    // storyboard nodeId → 200 + triggered
    const ok = await page.request.post('/api/canvas/storyboard/preview', {
      data: { projectId: 1, episodesId: 1, nodeId: 'storyboard-1' },
    })
    expect(ok.ok()).toBeTruthy()
    const okBody = await ok.json()
    expect(okBody.data.status).toBe('preview_triggered')

    // 非 storyboard nodeId → 400
    const bad = await page.request.post('/api/canvas/storyboard/preview', {
      data: { projectId: 1, episodesId: 1, nodeId: 'asset-1' },
    })
    expect(bad.ok()).toBeFalsy()
  })

  test('PREVIEW-05: V3 canvas has no per-node "预览构图" button', async ({ page }) => {
    await loadCanvas(page)
    // V3 用卡片封面承担构图预览，per-node 按钮已移除——任意节点都不应有该按钮
    await expect(page.locator('button:has-text("预览构图")')).toHaveCount(0)
  })

  test('PREVIEW-05: asset-node count is 6 (event chips excluded)', async ({ page }) => {
    await loadCanvas(page)
    // 6 资产 + 6 事件芯片 = 12 个 RF 节点；只数资产节点应为 6
    await expect(countAssets(page)).resolves.toBe(6)
  })

  test('PREVIEW-05: preview API call does not block main flow', async ({ page }) => {
    await loadCanvas(page)
    // 即使触发预览，前端不应崩溃，主流程仍可用
    await page.request.post('/api/canvas/storyboard/preview', {
      data: { projectId: 1, episodesId: 1, nodeId: 'storyboard-1' },
    })
    await page.waitForTimeout(200)
    // 保存按钮仍可用
    await expect(page.locator('button:has-text("保存")')).toBeEnabled()
    // 画布仍有 storyboard 资产节点
    await expect(page.locator(nodeSelector('storyboard-1'))).toBeVisible()
    await expect(countAssets(page)).resolves.toBe(6)
  })
})
