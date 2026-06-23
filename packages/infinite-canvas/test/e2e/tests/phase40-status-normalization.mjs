import { test, expect, resetMock } from '../helpers.mjs'

/**
 * Phase 40 — T3: reviewStatus 边界归一化
 *
 * 验证：当后端持久化的画布 blob 仍含有旧值 'awaiting_audit' 时
 * (movie-agent 旧版本写入，或 DB 历史数据)，FE 在 flowGraphToCanvas
 * 边界将其归一化为新的 canonical 值 'pending'，UI 正常渲染 "待审核" 徽章，
 * 不出现类型错误或空白徽章。
 */

test.describe('Phase 40 — T3: stale awaiting_audit blob normalizes to pending', () => {
  test.beforeEach(async ({ baseURL }) => {
    await resetMock(baseURL)
  })

  test('NORMALIZE-01: node with reviewStatus=awaiting_audit renders as "待审核" badge', async ({ page, baseURL }) => {
    // 构造 stale blob — 后端返回的 data 里直接含旧值
    const staleGraph = {
      nodes: [
        {
          id: 'storyboard-stale',
          type: 'storyboard',
          position: { x: 100, y: 100 },
          size: { width: 260, height: 180 },
          data: {
            label: '旧数据节点',
            type: 'storyboard',
            storyboardId: 99,
            duration: 3,
            prompt: 'test',
            filePath: null,
            thumbnailUrl: null,
            state: 'success',
            // 旧值 — T3 之前这是合法值
            reviewStatus: 'awaiting_audit',
            linkedAssetIds: [],
          },
          state: 'success',
        },
      ],
      links: [],
      groups: [],
      variantGroups: [],
    }

    // 注入 stale blob 到 mock 后端的 state
    await page.request.post(`${baseURL}/api/canvas/save`, {
      data: { projectId: 1, episodesId: 1, graph: staleGraph },
    })

    // 加载画布 — flowGraphToCanvas 应当归一化 reviewStatus
    const params = new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' })
    await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })

    // 选中山旧节点打开详情面板
    await page.locator('.react-flow__node').first().click()

    // 详情面板应显示 "待审核" 徽章 (而不是空白或错误)
    const detailPanel = page.locator('[data-testid="detail-panel"]')
    await expect(detailPanel).toBeVisible()
    await expect(detailPanel.locator('text=待审核')).toBeVisible({ timeout: 5_000 })
  })

  test('NORMALIZE-02: multiple stale values all normalize correctly', async ({ page, baseURL }) => {
    // 多个节点含混合新旧值，验证批量归一化
    const mixedGraph = {
      nodes: [
        {
          id: 'n-old',
          type: 'storyboard',
          position: { x: 100, y: 100 },
          size: { width: 260, height: 180 },
          data: {
            label: '旧', type: 'storyboard', storyboardId: 1, duration: 2, prompt: 'x',
            state: 'success', reviewStatus: 'awaiting_audit', linkedAssetIds: [],
          },
          state: 'success',
        },
        {
          id: 'n-new',
          type: 'storyboard',
          position: { x: 500, y: 100 },
          size: { width: 260, height: 180 },
          data: {
            label: '新', type: 'storyboard', storyboardId: 2, duration: 2, prompt: 'x',
            state: 'success', reviewStatus: 'pending', linkedAssetIds: [],
          },
          state: 'success',
        },
        {
          id: 'n-approved',
          type: 'storyboard',
          position: { x: 900, y: 100 },
          size: { width: 260, height: 180 },
          data: {
            label: '已通过', type: 'storyboard', storyboardId: 3, duration: 2, prompt: 'x',
            state: 'success', reviewStatus: 'approved', linkedAssetIds: [],
          },
          state: 'success',
        },
      ],
      links: [],
      groups: [],
      variantGroups: [],
    }

    await page.request.post(`${baseURL}/api/canvas/save`, {
      data: { projectId: 1, episodesId: 1, graph: mixedGraph },
    })

    const params = new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' })
    await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })

    // 通过 store 验证归一化后的值 (绕过 UI 渲染细节)
    const reviewStatuses = await page.evaluate(() => {
      const nodes = window.__kaisCanvas?.getNodes?.() ?? []
      return nodes
        .filter((n) => n.data?.reviewStatus)
        .map((n) => ({ id: n.id, status: n.data.reviewStatus }))
    })

    expect(reviewStatuses).toEqual([
      { id: 'n-old', status: 'pending' },        // ← 归一化
      { id: 'n-new', status: 'pending' },        // ← 已是 canonical
      { id: 'n-approved', status: 'approved' },
    ])

    // 不应存在任何 awaiting_audit 字面量
    const staleCount = reviewStatuses.filter((r) => r.status === 'awaiting_audit').length
    expect(staleCount).toBe(0)
  })
})
