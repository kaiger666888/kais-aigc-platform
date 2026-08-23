import { test, expect, loadCanvas, getCalls, setSelectedNodeIds } from '../helpers.mjs'

/**
 * Phase 52-04 — REGEN-02: 事件芯片「同配方换 seed 重跑」闭环
 *
 * 覆盖:
 *  - REGEN-02-a: 芯片 → popover → 🎲 → mock execute body 断言:
 *      · 同配方:params.prompt 不变(fixture 实证「主角进入场景」)
 *      · 新 seed:number、1e6 域内、≠ 旧展示 seed(fixture 合成事件无 seed → 旧值为空)
 *      · nodeId === 产出资产 id(地雷 #4 裁定:role:'output' 反查,非 evt_*)
 *      · pending 态:execute 挂起期间按钮 disabled + 「重跑中…」(route 延迟观测)
 *  - REGEN-02-b: 提交成功后新 seed 回写 canonical 上屏(popover data-seed)+ toast「已提交」
 *
 * ⚠️ 前置纪律(地雷 #10):e2e 跑 dist 非源码——运行本文件前必须 `npm run build`
 *    (packages/infinite-canvas),否则测的是旧构建产物。
 *
 * fixture 选定注释:
 *  - 事件芯片 evt_storyboard-1:migrate §14 为 storyboard-1 合成(params.prompt=
 *    「主角进入场景」,自 DEFAULT_NODES data.prompt;data 无 seed → params.seed 缺位,
 *    旧 seed 展示值为空——「新 seed ≠ 旧」在旧值缺失时由存在性+域断言承担)。
 *  - 产出资产反查:evt_storyboard-1 --role:'output'--> storyboard-1,stage='storyboard'。
 *  - e2e testMode URL 注入 projectId=1/episodesId=1(地雷 #13 不影响:有项目上下文,
 *    anchor 注入后 popover 守卫放行)。
 */

test.describe('Phase 52-04 — REGEN-02 Reroll Seed', () => {
  test('REGEN-02-a: chip → popover → 🎲 posts same recipe + new seed with asset-id nodeId', async ({ page }) => {
    await loadCanvas(page)
    // 选中 storyboard-1:直接上下游芯片强制升级完整态(P19),保证芯片可点(与 LOD 无关)
    await setSelectedNodeIds(page, ['storyboard-1'])

    const chip = page.locator('[data-testid="edge-op-chip"][data-event-id="evt_storyboard-1"]')
    await chip.first().click()
    const popover = page.locator('[data-testid="event-params-popover"]')
    await expect(popover).toBeVisible()

    const rerollBtn = page.locator('[data-testid="reroll-seed-btn"]')
    await expect(rerollBtn).toBeEnabled()
    // 旧 seed 展示值(fixture 合成事件无 seed → data-seed 为空串)
    const oldSeed = await rerollBtn.getAttribute('data-seed')

    // 挂起 execute 响应 300ms,观测 pending 态(disabled + 「重跑中…」)
    let releaseExecute
    const executeHeld = new Promise((resolve) => { releaseExecute = resolve })
    await page.route('**/api/canvas/execute', async (route) => {
      await executeHeld
      await route.continue()
    })
    await rerollBtn.click()
    await expect(rerollBtn).toBeDisabled()
    await expect(rerollBtn).toHaveText('重跑中…')
    releaseExecute()

    // 轮询 mock 调用日志:execute body 同配方 + 新 seed(52-02 logCall 观测点)
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/execute')
      return exec?.body?.params?.seed
    }, { timeout: 5_000 }).toBeTruthy()

    // 同配方:prompt 与旧配方一致(未被改动)
    expect(exec.body.params.prompt).toBe('主角进入场景')
    // 59-fix WR-05:顶层 prompt 专用通道同样到达(NodeDetailPanel 同款;CR-01
    // 白名单后服务端不读袋内 prompt,顶层通道使同配方不依赖 extractPrompt 兜底)
    expect(exec.body.prompt).toBe('主角进入场景')
    // 新 seed:1e6 域内(与芯片 tooltip seed 量级一致)且 ≠ 旧展示值
    const newSeed = exec.body.params.seed
    expect(typeof newSeed).toBe('number')
    expect(newSeed).toBeGreaterThanOrEqual(0)
    expect(newSeed).toBeLessThan(1_000_000)
    expect(String(newSeed)).not.toBe(oldSeed ?? '')
    // 地雷 #4 裁定证据:nodeId 是产出资产 id,不是 evt_* id
    expect(exec.body.nodeId).toBe('storyboard-1')
    expect(exec.body.nodeId.startsWith('evt_')).toBe(false)
    expect(exec.body.nodeType).toBe('storyboard')

    // pending 复位(finally):按钮回到可用态与常态文案
    await expect(rerollBtn).toBeEnabled()
    await expect(rerollBtn).toHaveText('🎲 同配方换 seed 重跑')
  })

  test('REGEN-02-b: submitted new seed writes back to canonical + toast', async ({ page }) => {
    await loadCanvas(page)
    await setSelectedNodeIds(page, ['storyboard-1'])

    await page.locator('[data-testid="edge-op-chip"][data-event-id="evt_storyboard-1"]').first().click()
    const rerollBtn = page.locator('[data-testid="reroll-seed-btn"]')
    await expect(rerollBtn).toBeEnabled()
    await rerollBtn.click()

    // 捕获提交的 seed(仅一条 execute 调用)
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/execute')
      return exec?.body?.params?.seed
    }, { timeout: 5_000 }).toBeTruthy()

    // updateEventParams 回写 canonical → popover 立即显示新 seed(地雷 #12:防 reload 回旧值)
    await expect(rerollBtn).toHaveAttribute('data-seed', String(exec.body.params.seed))
    // popover 内采样区 seed 行同步显示新值
    const popover = page.locator('[data-testid="event-params-popover"]')
    await expect(popover.getByText(String(exec.body.params.seed), { exact: true })).toBeVisible()

    // toast「已提交换 seed 重跑」
    await expect(page.getByText(/已提交换 seed 重跑/)).toBeVisible({ timeout: 5_000 })
  })
})
