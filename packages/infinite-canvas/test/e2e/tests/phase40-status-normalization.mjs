import { test, expect, resetMock, nodeSelector } from '../helpers.mjs'

/**
 * Phase 40 — T3: reviewStatus 边界处理
 *
 * V3 适配说明：V3 的加载边界从旧的 `flowGraphToCanvas` 换成了 `v3/adapter.ts`
 * （adaptV2Graph → migrateV2toV3）。新边界对 reviewStatus 采取**严格策略**：
 * 只接受 canonical 三值 (pending/approved/rejected)；非法旧值（如 awaiting_audit）
 * 在边界**丢弃**并记 warning（P22 消费端宽松：绝不崩画布），而非归一化为 pending。
 *
 * 因此本组测试的业务语义「legacy/非法 reviewStatus 在加载边界被妥善处理、UI 不崩」
 * 保持不变，观测点改为：
 *  - NORMALIZE-01：含 awaiting_audit 的 stale blob 能优雅加载（节点渲染、详情面板正常打开）。
 *  - NORMALIZE-02：canonical 三值正确透传；非法值被丢弃；任何 awaiting_audit 字面量都不漏到 store。
 *
 * 注：适配层读取顶层 FlowNodeV2 的 reviewStatus 字段（migrate 契约），故注入的 stale
 * blob 把 reviewStatus 放在节点顶层（与真实 V2 导出形状一致）。
 */

test.describe('Phase 40 — T3: stale reviewStatus handled at V3 boundary', () => {
  test.beforeEach(async ({ baseURL }) => {
    await resetMock(baseURL)
  })

  test('NORMALIZE-01: stale awaiting_audit blob loads gracefully (no crash)', async ({ page, baseURL }) => {
    // 构造 stale blob — 节点顶层含旧值 awaiting_audit（T3 之前这是合法值）
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
            linkedAssetIds: [],
          },
          state: 'success',
          reviewStatus: 'awaiting_audit',
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

    // 加载画布 — V3 边界应丢弃非法 reviewStatus（不崩）
    const params = new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' })
    await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })

    // 资产节点正常渲染
    await expect(page.locator(nodeSelector('storyboard-stale'))).toBeVisible()

    // 点开旧节点 — 详情面板正常打开（不出现空白/报错）
    await page.locator(nodeSelector('storyboard-stale')).click()
    const detailPanel = page.locator('[data-testid="detail-panel"]')
    await expect(detailPanel).toBeVisible()
  })

  test('NORMALIZE-02: canonical reviewStatus passes through; stale value dropped', async ({ page, baseURL }) => {
    // 多个节点含混合值（顶层 reviewStatus），验证边界批量处理
    const mixedGraph = {
      nodes: [
        {
          id: 'n-old',
          type: 'storyboard',
          position: { x: 100, y: 100 },
          size: { width: 260, height: 180 },
          data: { label: '旧', type: 'storyboard', storyboardId: 1, duration: 2, prompt: 'x', state: 'success', linkedAssetIds: [] },
          state: 'success',
          reviewStatus: 'awaiting_audit',
        },
        {
          id: 'n-new',
          type: 'storyboard',
          position: { x: 500, y: 100 },
          size: { width: 260, height: 180 },
          data: { label: '新', type: 'storyboard', storyboardId: 2, duration: 2, prompt: 'x', state: 'success', linkedAssetIds: [] },
          state: 'success',
          reviewStatus: 'pending',
        },
        {
          id: 'n-approved',
          type: 'storyboard',
          position: { x: 900, y: 100 },
          size: { width: 260, height: 180 },
          data: { label: '已通过', type: 'storyboard', storyboardId: 3, duration: 2, prompt: 'x', state: 'success', linkedAssetIds: [] },
          state: 'success',
          reviewStatus: 'approved',
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

    // 通过 store 验证边界处理后的值（绕过 UI 渲染细节）
    const reviewStatuses = await page.evaluate(() => {
      const nodes = window.__kaisCanvas?.getNodes?.() ?? []
      return nodes
        .filter((n) => n.data?.reviewStatus)
        .map((n) => ({ id: n.id, status: n.data.reviewStatus }))
    })

    // awaiting_audit 被丢弃（n-old 不在列表）；pending/approved 透传
    expect(reviewStatuses).toEqual([
      { id: 'n-new', status: 'pending' },
      { id: 'n-approved', status: 'approved' },
    ])

    // 不应存在任何 awaiting_audit 字面量
    const staleCount = reviewStatuses.filter((r) => r.status === 'awaiting_audit').length
    expect(staleCount).toBe(0)
  })
})
