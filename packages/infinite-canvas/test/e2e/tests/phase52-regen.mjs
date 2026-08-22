import { test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView } from '../helpers.mjs'

/**
 * Phase 52-03 — REGEN-01: PromptSection 编辑 → 保存 → 重生成 闭环
 *
 * 覆盖:
 *  - REGEN-01-a: 编辑 prompt → 保存(persistEventParams → save-v2) → 重生成(execute 通道)
 *    → mock logCall 完整 body 断言:body.prompt / body.params.prompt 含新 prompt、
 *    body.nodeId === 资产 id(地雷 #4 裁定:非 evt_* id)
 *  - REGEN-01-b: 保存 + 页面 reload 往返保真(地雷 #1 端到端防线,STORYBOARD-07 范式)
 *  - REGEN-01-c: 落选变体只读态(地雷 #5):只读提示可见,保存/重生成 disabled
 *
 * ⚠️ 前置纪律(地雷 #10):e2e 跑 dist 非源码——运行本文件前必须 `npm run build`
 *    (packages/infinite-canvas),否则测的是旧构建产物。
 *
 * fixture 选定注释:
 *  - 编辑对象 storyboard-1:migrate 为它合成 evt_storyboard-1,params.prompt 现值
 *    「主角进入场景」(mock DEFAULT_NODES data.prompt,recipeParams 保留)。
 *  - 只读对象 sb-cand-b:本用例经 save-v2 注入变体组(type:'variant' 节点 var-1,
 *    候选 sb-cand-a(isWinner)/sb-cand-b)——migrate Pass 3 删除落选事件、output 边
 *    重指 winner 主事件、配方并入 variantRecipes,curation='deprecated' +
 *    variantGroupId='vg_var-1'。fixture 默认无变体组,故用注入方式构造(与
 *    phase41 经 save-v2 注入外部写入的范式一致)。
 */

const NEW_PROMPT = '主角转身离开'

/** 打开节点详情面板并等 PromptSection 渲染。 */
async function openDetailPanel(page, nodeId) {
  await page.locator(nodeSelector(nodeId)).dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })
}

/** 编辑 storyboard-1 的 prompt 并保存,等待 save-v2 落 mock 状态(round-trip 信息源)。 */
async function editAndSavePrompt(page) {
  await openDetailPanel(page, 'storyboard-1')
  const textarea = page.locator('[data-testid="prompt-textarea"]')
  // 初始值为 fixture 实证 prompt(先读值再改)
  await expect(textarea).toHaveValue('主角进入场景')
  // 未编辑时重生成可用(配方即已保存的 canonical);编辑后未保存 → disabled(防半编辑误触发,CONTEXT 锁定)
  await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeEnabled()
  await textarea.fill(NEW_PROMPT)
  await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeDisabled()
  await expect(page.locator('[data-testid="prompt-save"]')).toBeEnabled()
  await page.locator('[data-testid="prompt-save"]').click()
  // 保存 = persistEventParams → save-v2:等 mock 状态里的 storyboard-1 data.prompt
  // 被反向覆盖为新 prompt(52-02 serialize 事件配方反向覆盖,wire 层证据)
  await expect.poll(async () => {
    const res = await page.request.get('/__mock/state')
    const s = await res.json()
    return s.canvas.nodes.find((n) => n.id === 'storyboard-1')?.data?.prompt
  }, { timeout: 5_000 }).toBe(NEW_PROMPT)
}

test.describe('Phase 52-03 — REGEN-01 Prompt Edit → Regenerate Loop', () => {
  test('REGEN-01-a: edit → save → regenerate posts new prompt with asset-id nodeId', async ({ page }) => {
    await loadCanvas(page)
    await editAndSavePrompt(page)

    // 保存后 graph:saved 广播触发前端 reload;重开面板拿到最新 canonical 态再点重生成
    await openDetailPanel(page, 'storyboard-1')
    await expect(page.locator('[data-testid="prompt-textarea"]')).toHaveValue(NEW_PROMPT)
    const regenBtn = page.locator('[data-testid="prompt-regenerate"]')
    await expect(regenBtn).toBeEnabled() // 已保存 → 重生成可用
    await regenBtn.click()

    // 轮询 mock 调用日志:execute 完整 body 含新 prompt(52-02 logCall 观测点)
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/execute')
      return exec?.body?.prompt
    }, { timeout: 5_000 }).toBe(NEW_PROMPT)

    // 地雷 #4 裁定证据:nodeId 是产出资产 id,不是 evt_* id
    expect(exec.body.nodeId).toBe('storyboard-1')
    expect(exec.body.nodeId.startsWith('evt_')).toBe(false)
    // 同配方提交:params 携带完整配方 + 新 prompt
    expect(exec.body.params?.prompt).toBe(NEW_PROMPT)
    expect(exec.body.nodeType).toBe('storyboard')
  })

  test('REGEN-01-b: save → page reload round-trip preserves new prompt in panel', async ({ page }) => {
    await loadCanvas(page)
    await editAndSavePrompt(page)

    // 真往返:整页刷新 → load-v2 → migrate §14 重建 → 面板仍显示新 prompt
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)

    await openDetailPanel(page, 'storyboard-1')
    await expect(page.locator('[data-testid="prompt-textarea"]')).toHaveValue(NEW_PROMPT)
  })

  test('REGEN-01-c: deprecated loser variant is read-only (mine #5)', async ({ page }) => {
    await loadCanvas(page)

    // 注入变体组:两个 storyboard 候选 + variant 节点,migrate Pass 3 归组
    await page.request.post('/api/canvas/v2/save-v2', {
      data: {
        projectId: 1,
        episodesId: 1,
        graph: {
          nodes: [
            {
              id: 'sb-cand-a', type: 'storyboard',
              position: { x: 400, y: 500 }, size: { width: 260, height: 180 },
              data: {
                label: '分镜候选 A', type: 'storyboard', storyboardId: 101, duration: 3,
                prompt: '候选A配方', filePath: null, thumbnailUrl: null, state: 'idle',
              },
              state: 'idle', isWinner: true,
            },
            {
              id: 'sb-cand-b', type: 'storyboard',
              position: { x: 700, y: 500 }, size: { width: 260, height: 180 },
              data: {
                label: '分镜候选 B', type: 'storyboard', storyboardId: 102, duration: 3,
                prompt: '候选B配方', filePath: null, thumbnailUrl: null, state: 'idle',
              },
              state: 'idle',
            },
            {
              id: 'var-1', type: 'variant',
              position: { x: 550, y: 700 }, size: { width: 200, height: 100 },
              data: { label: '变体组', type: 'variant' },
              state: 'idle',
            },
          ],
          links: [
            { id: 've1', source: 'sb-cand-a', target: 'var-1', data: { dataType: 'variant' } },
            { id: 've2', source: 'sb-cand-b', target: 'var-1', data: { dataType: 'variant' } },
          ],
          groups: [],
          variantGroups: [],
        },
      },
    })

    // 重新加载页面 → load-v2 取到注入图 → migrate Pass 3 归组
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)

    // 落选候选 sb-cand-b:只读提示可见 + 保存/重生成 disabled(地雷 #5)
    await openDetailPanel(page, 'sb-cand-b')
    await expect(page.locator('[data-testid="prompt-readonly-hint"]')).toBeVisible()
    await expect(page.locator('[data-testid="prompt-readonly-hint"]')).toContainText('落选变体')
    await expect(page.locator('[data-testid="prompt-textarea"]')).toBeDisabled()
    await expect(page.locator('[data-testid="prompt-save"]')).toBeDisabled()
    await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeDisabled()

    // winner sb-cand-a 不受影响:可编辑可保存可重生成
    await openDetailPanel(page, 'sb-cand-a')
    await expect(page.locator('[data-testid="prompt-textarea"]')).toBeEnabled()
    await expect(page.locator('[data-testid="prompt-textarea"]')).toHaveValue('候选A配方')
  })
})
