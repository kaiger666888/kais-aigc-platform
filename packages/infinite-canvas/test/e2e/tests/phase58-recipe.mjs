import { test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView } from '../helpers.mjs'

/**
 * Phase 58-03 — RECIPE-01/02/03: 全配方持久化 e2e
 *
 * 用例组:
 *  - A(RECIPE-01/03 编辑往返):面板编辑 steps/cfg/lora → 保存 → wire 反写 + canonical
 *    同步 + page.reload 往返保真(三层断言)。
 *  - B(RECIPE-03 lora 结构):lora-add 追加 / lora-remove 删行 → wire 层 {name,strength}
 *    结构保真。
 *  - C(RECIPE-02 请求体):仅编辑 steps → 重生成 → execute body.params 整袋断言
 *    (编辑值 + 未编辑 quant/lora/cfg 原样透传)。
 *  - D(Pitfall 1 清空不复活):清空 steps → 保存 → wire data.steps 键消失(delete 传播)
 *    → reload 后 canonical params.steps === undefined。
 *  - E(Pitfall 2 空 lora 归一化):删光 lora 行 → 保存 → wire data.lora === undefined(非 [])
 *    → 面板「暂无 LoRA」空态。
 *  - F(落选只读):落选变体高级控件随整块 disabled + 锁死文案。
 *
 * 三层断言范式(phase52-regen 同款):
 *  ① wire 层:GET /__mock/state → s.canvas.nodes.find(n=>n.id===X)?.data?.steps
 *     ——等 save-v2 把 canonical params 反写进 mock 节点 data。expect.poll 两段式:
 *     先等 wire 再断言面板/canonical(防 graph:saved 同屏回读时序,Pitfall 3)。
 *  ② 请求体层:getCalls(page) → calls.find(c=>c.path==='/api/canvas/execute')
 *     → exec.body.params(mock logCall 完整 body)。
 *  ③ canonical 层:window.__kaisCanvas.getGraph()(main.tsx 桥)→ EventNodeV3.params。
 *
 * ⚠️ 前置纪律(地雷 #10):e2e 跑 dist 非源码——运行本文件前必须 `npm run build`
 *    (packages/infinite-canvas),否则测的是旧构建产物。
 *
 * fixture 注入(Pitfall 6):mock DEFAULT_NODES(server.mjs)的 data 只有 prompt 无高级
 * 字段,直接对默认节点断言高级值 = undefined 假红。本文件全部用例先经 POST
 * /api/canvas/v2/save-v2 注入带全套高级字段(steps/cfg/quant/sageAttention/lora)的
 * 节点(REGEN-01-c 注入范式)→ page.reload → migrate recipeParams 全集提取(58-01)。
 */

const ADV_NODE_ID = 'sb-adv-1'
const ADV_EVENT_ID = 'evt_sb-adv-1'

/** 注入节点全套初始值(编辑前先断言初始态,防假绿)。 */
const INITIAL = {
  prompt: '初始配方',
  steps: 30,
  cfg: 7,
  quant: 'fp8',
  sageAttention: true,
  lora: [{ name: 'xl-light', strength: 0.6 }],
}

/** 单节点完整 graph(含全套高级字段 data,Pitfall 6 注入基底)。 */
function advancedFixtureGraph() {
  return {
    nodes: [
      {
        id: ADV_NODE_ID,
        type: 'storyboard',
        position: { x: 400, y: 500 },
        size: { width: 260, height: 180 },
        data: {
          label: '高级参数分镜', type: 'storyboard', storyboardId: 58, duration: 3,
          prompt: INITIAL.prompt, filePath: null, thumbnailUrl: null, state: 'idle',
          steps: INITIAL.steps, cfg: INITIAL.cfg, quant: INITIAL.quant,
          sageAttention: INITIAL.sageAttention, lora: INITIAL.lora,
        },
        state: 'idle',
      },
    ],
    links: [],
    groups: [],
    variantGroups: [],
  }
}

/**
 * 落选变体 fixture(REGEN-01-c 变体组范式):winner 带全套高级字段——migrate Pass 3
 * 删候选事件、output 边重指 winner 主事件,落选面板显示的是主事件配方(Pitfall 7
 * 预存折叠语义,本文件只断言 disabled,不试图「修复」折叠)。
 */
function loserVariantGraph() {
  return {
    nodes: [
      {
        id: 'adv-cand-a',
        type: 'storyboard',
        position: { x: 400, y: 500 },
        size: { width: 260, height: 180 },
        data: {
          label: '高级候选 A', type: 'storyboard', storyboardId: 101, duration: 3,
          prompt: '候选A配方', filePath: null, thumbnailUrl: null, state: 'idle',
          steps: 44, cfg: 6, quant: 'fp16', sageAttention: false,
          lora: [{ name: 'winner-lora', strength: 0.5 }],
        },
        state: 'idle',
        isWinner: true,
      },
      {
        id: 'adv-cand-b',
        type: 'storyboard',
        position: { x: 700, y: 500 },
        size: { width: 260, height: 180 },
        data: {
          label: '高级候选 B', type: 'storyboard', storyboardId: 102, duration: 3,
          prompt: '候选B配方', filePath: null, thumbnailUrl: null, state: 'idle',
        },
        state: 'idle',
      },
      {
        id: 'adv-var-1',
        type: 'variant',
        position: { x: 550, y: 700 },
        size: { width: 200, height: 100 },
        data: { label: '变体组', type: 'variant' },
        state: 'idle',
      },
    ],
    links: [
      { id: 've1', source: 'adv-cand-a', target: 'adv-var-1', data: { dataType: 'variant' } },
      { id: 've2', source: 'adv-cand-b', target: 'adv-var-1', data: { dataType: 'variant' } },
    ],
    groups: [],
    variantGroups: [],
  }
}

/** Pitfall 6:经 save-v2 注入带高级字段的 fixture,再 reload 让 migrate 全集提取。 */
async function injectAdvancedFixture(page) {
  await page.request.post('/api/canvas/v2/save-v2', {
    data: { projectId: 1, episodesId: 1, graph: advancedFixtureGraph() },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await switchToCanvasView(page)
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

/** 打开节点详情面板并等 PromptSection 渲染(phase52 同款)。 */
async function openDetailPanel(page, nodeId) {
  await page.locator(nodeSelector(nodeId)).dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })
}

/** 展开高级参数折叠区——默认收起(UI-SPEC §7 契约:交互前必须先点 advanced-toggle)。 */
async function openAdvanced(page) {
  await page.locator('[data-testid="advanced-toggle"]').click()
  await page.waitForSelector('[data-testid="advanced-section"]', { timeout: 5_000 })
}

/** wire 层读取:注入节点在 /__mock/state s.canvas.nodes 上的 data 袋。 */
async function wireNodeData(page) {
  const res = await page.request.get('/__mock/state')
  const s = await res.json()
  return s.canvas.nodes.find((n) => n.id === ADV_NODE_ID)?.data
}

/** canonical 层读取:window.__kaisCanvas.getGraph() 事件 params。 */
async function canonicalParams(page) {
  return page.evaluate((eventId) => {
    const g = window.__kaisCanvas?.getGraph()
    return g?.nodes.find((n) => n.id === eventId)?.params ?? null
  }, ADV_EVENT_ID)
}

test.describe('Phase 58-03 — RECIPE 全配方持久化(编辑往返 + 请求体 + 清空/结构保真)', () => {
  test('RECIPE-01-a: edit steps/cfg/lora → save → wire 层反写 + 面板回显(未编辑字段原样)', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)

    // 编辑前先断言注入初始态(Pitfall 6:初始值来自 fixture 而非 DEFAULT_NODES)
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('30')
    await expect(page.locator('[data-testid="param-input-cfg"]')).toHaveValue('7')
    await expect(page.locator('[data-testid="param-select-quant"]')).toHaveValue('fp8')
    await expect(page.locator('[data-testid="param-select-sage"]')).toHaveValue('true')
    await expect(page.locator('[data-testid="lora-name-0"]')).toHaveValue('xl-light')
    await expect(page.locator('[data-testid="lora-strength-0"]')).toHaveValue('0.6')

    // 编辑 steps=50 / cfg=4.5 / lora 首行 strength=0.8
    await page.locator('[data-testid="param-input-steps"]').fill('50')
    await page.locator('[data-testid="param-input-cfg"]').fill('4.5')
    await page.locator('[data-testid="lora-strength-0"]').fill('0.8')

    // dirty 语义(UI-SPEC §5):dirty 时重生成 disabled(防半编辑误触发)、保存可用
    await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeDisabled()
    await expect(page.locator('[data-testid="prompt-save"]')).toBeEnabled()
    await page.locator('[data-testid="prompt-save"]').click()

    // ① wire 层(两段式第一段:先等 save-v2 反写,58-01 serialize 九键写回)
    await expect.poll(async () => (await wireNodeData(page))?.steps, { timeout: 5_000 }).toBe(50)
    const wire = await wireNodeData(page)
    expect(wire.cfg).toBe(4.5)
    expect(wire.lora).toEqual([{ name: 'xl-light', strength: 0.8 }])
    // 未编辑字段原样透传(RECIPE-03:整袋不丢弃)
    expect(wire.quant).toBe('fp8')
    expect(wire.sageAttention).toBe(true)

    // ② 面板回显:graph:saved 回读 canonical 重置 draft(52-08 面板保持打开)
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('50')
    await expect(page.locator('[data-testid="param-input-cfg"]')).toHaveValue('4.5')
    await expect(page.locator('[data-testid="lora-strength-0"]')).toHaveValue('0.8')
  })

  test('RECIPE-01-b: 编辑保存后 canonical 层 getGraph() 事件 params 同步', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    await page.locator('[data-testid="param-input-steps"]').fill('50')
    await page.locator('[data-testid="param-input-cfg"]').fill('4.5')
    await page.locator('[data-testid="lora-strength-0"]').fill('0.8')
    await page.locator('[data-testid="prompt-save"]').click()

    // ① 先等 wire(Pitfall 3 两段式)再断言 canonical——graph:saved 同屏回读完成后
    await expect.poll(async () => (await wireNodeData(page))?.steps, { timeout: 5_000 }).toBe(50)

    // ③ canonical 层:EventNodeV3.params 携带编辑值(58-01 migrate 全集提取证据)
    const params = await canonicalParams(page)
    expect(params).not.toBeNull()
    expect(params.steps).toBe(50)
    expect(params.cfg).toBe(4.5)
    expect(params.lora).toEqual([{ name: 'xl-light', strength: 0.8 }])
    // 未编辑字段原样(RECIPE-03)
    expect(params.quant).toBe('fp8')
    expect(params.sageAttention).toBe(true)
  })

  test('RECIPE-01-c: save → page reload 重开面板,高级参数输入框仍显示编辑后的值', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    await page.locator('[data-testid="param-input-steps"]').fill('50')
    await page.locator('[data-testid="lora-strength-0"]').fill('0.8')
    await page.locator('[data-testid="prompt-save"]').click()
    await expect.poll(async () => (await wireNodeData(page))?.steps, { timeout: 5_000 }).toBe(50)

    // 真往返(REGEN-01-b 同款):整页刷新 → load-v2 → migrate recipeParams 全集提取
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)

    // reload 后折叠区回到默认收起(组件本地态)——重开面板 + 重新展开再断言
    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('50')
    await expect(page.locator('[data-testid="lora-strength-0"]')).toHaveValue('0.8')
    // 未编辑字段 reload 后保真
    await expect(page.locator('[data-testid="param-input-cfg"]')).toHaveValue('7')
    await expect(page.locator('[data-testid="param-select-quant"]')).toHaveValue('fp8')
    await expect(page.locator('[data-testid="param-select-sage"]')).toHaveValue('true')
  })

  test('RECIPE-03-a: lora 行增删 → wire 层结构保真({name,strength})', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)

    // 追加行 → 填 name/strength → 保存 → wire 长度 2 且两行结构保真
    await page.locator('[data-testid="lora-add"]').click()
    await page.locator('[data-testid="lora-name-1"]').fill('ink-style')
    await page.locator('[data-testid="lora-strength-1"]').fill('1.2')
    await page.locator('[data-testid="prompt-save"]').click()
    await expect.poll(async () => (await wireNodeData(page))?.lora?.length, { timeout: 5_000 }).toBe(2)
    let wire = await wireNodeData(page)
    expect(wire.lora[0]).toEqual({ name: 'xl-light', strength: 0.6 })
    expect(wire.lora[1]).toEqual({ name: 'ink-style', strength: 1.2 })

    // 等 graph:saved 回读把 draft 重置为 2 行 canonical(防删行点在重渲染前)
    await expect(page.locator('[data-testid="lora-name-1"]')).toHaveValue('ink-style')

    // 删行(lora-remove-0)→ 保存 → wire 回到 1 行,剩新行(结构仍保真)
    await page.locator('[data-testid="lora-remove-0"]').click()
    await page.locator('[data-testid="prompt-save"]').click()
    await expect.poll(async () => {
      const d = await wireNodeData(page)
      return Array.isArray(d?.lora) && d.lora.length === 1 && d.lora[0]?.name === 'ink-style'
    }, { timeout: 5_000 }).toBe(true)
    wire = await wireNodeData(page)
    expect(wire.lora).toEqual([{ name: 'ink-style', strength: 1.2 }])
  })

  test('RECIPE-02: 仅编辑 steps → 重生成 → execute 请求体整袋断言(未编辑字段原样透传)', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    // 仅编辑 steps(其余字段不碰——整袋 spread 证明的对照面)
    await page.locator('[data-testid="param-input-steps"]').fill('50')
    await page.locator('[data-testid="prompt-save"]').click()
    await expect.poll(async () => (await wireNodeData(page))?.steps, { timeout: 5_000 }).toBe(50)

    // 已保存(非 dirty)→ 重生成可用;点击走 executeNode 整袋 spread 通道
    await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeEnabled()
    await page.locator('[data-testid="prompt-regenerate"]').click()

    // ② 请求体层:mock logCall 完整 body(phase52 REGEN-01-a 同款轮询)
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/execute')
      return exec?.body?.params?.steps
    }, { timeout: 5_000 }).toBe(50)

    // 编辑值到达请求体(RECIPE-02);nodeId = 产出资产 id(地雷 #4)
    expect(exec.body.nodeId).toBe(ADV_NODE_ID)
    expect(exec.body.nodeType).toBe('storyboard')
    expect(exec.body.params?.steps).toBe(50)
    // 未编辑字段原样透传——窄通道不再丢弃(RECIPE-03 整袋 spread 证明)
    expect(exec.body.params?.quant).toBe('fp8')
    expect(exec.body.params?.cfg).toBe(7)
    expect(exec.body.params?.sageAttention).toBe(true)
    expect(exec.body.params?.lora).toEqual([{ name: 'xl-light', strength: 0.6 }])
    expect(exec.body.params?.prompt).toBe(INITIAL.prompt)
  })

  test('RECIPE-03-b(Pitfall 1): 清空 steps → 保存 → wire 键消失 + reload 不复活', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    // 清空(留空 = 未设置,UI-SPEC §5)
    await page.locator('[data-testid="param-input-steps"]').fill('')
    await page.locator('[data-testid="prompt-save"]').click()

    // ① wire 层:58-01 delete 传播——data.steps 键消失(防 rawData 陈旧值复活)
    await expect.poll(async () => (await wireNodeData(page))?.steps, { timeout: 5_000 }).toBeUndefined()
    const wire = await wireNodeData(page)
    expect(wire).not.toHaveProperty('steps')
    // 其余字段不受清空波及
    expect(wire.cfg).toBe(7)

    // reload → migrate recipeParams 不再提取 → canonical params.steps === undefined(清空不复活)
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)
    const params = await canonicalParams(page)
    expect(params).not.toBeNull()
    expect(params.steps).toBeUndefined()
    expect(params.cfg).toBe(7)

    // 面板侧:重开面板后输入框为空(未设置态),其余字段仍在
    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('')
    await expect(page.locator('[data-testid="param-input-cfg"]')).toHaveValue('7')
  })

  test('RECIPE-03-c(Pitfall 2): 删光 lora 行 → 保存 → wire data.lora === undefined 非 [] + 空态', async ({ page }) => {
    await loadCanvas(page)
    await injectAdvancedFixture(page)

    await openDetailPanel(page, ADV_NODE_ID)
    await openAdvanced(page)
    await page.locator('[data-testid="lora-remove-0"]').click()
    await page.locator('[data-testid="prompt-save"]').click()

    // ① wire 层:空 lora 归一化为 undefined——非 [](Pitfall 2:[] 是合法值会被写入
    // params.lora=[],与「空 lora = 字段删除」语义冲突)
    await expect.poll(async () => (await wireNodeData(page))?.lora, { timeout: 5_000 }).toBeUndefined()
    const wire = await wireNodeData(page)
    expect(wire).not.toHaveProperty('lora')

    // 面板 advanced 区显示「暂无 LoRA」空态(graph:saved 回读后 draft 重置为 0 行)
    await expect(page.locator('[data-testid="advanced-section"]')).toContainText('暂无 LoRA')
    // steps 未动,仍在(空 lora 不波及其他字段)
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('30')
  })

  test('落选只读: advanced 控件随整块 disabled + 「落选变体」锁死文案', async ({ page }) => {
    await loadCanvas(page)
    await page.request.post('/api/canvas/v2/save-v2', {
      data: { projectId: 1, episodesId: 1, graph: loserVariantGraph() },
    })
    await page.reload({ waitUntil: 'networkidle' })
    await switchToCanvasView(page)
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)

    // 落选候选不上画布(P12 折叠进 winner 牌堆)——走分镜浏览侧栏卡点击(52-08 gap#7b 真实路径)
    await page.getByRole('button', { name: '分镜浏览', exact: true }).click()
    const loserCard = page.locator('[data-testid^="shot-card-"]').filter({ hasText: '高级候选 B' }).first()
    await expect(loserCard).toBeVisible({ timeout: 5_000 })
    await loserCard.click()
    await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
    await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })

    // 锁死文案(UI-SPEC e2e 锁定,逐字不可改) + 保存/重生成 disabled
    await expect(page.locator('[data-testid="prompt-readonly-hint"]')).toContainText('落选变体')
    await expect(page.locator('[data-testid="prompt-save"]')).toBeDisabled()
    await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeDisabled()

    // 高级控件随整块 disabled(值可展开查看——显示主事件配方,Pitfall 7 折叠语义)
    await openAdvanced(page)
    await expect(page.locator('[data-testid="param-input-steps"]')).toBeDisabled()
    await expect(page.locator('[data-testid="param-input-steps"]')).toHaveValue('44')
    await expect(page.locator('[data-testid="param-input-cfg"]')).toBeDisabled()
    await expect(page.locator('[data-testid="param-select-quant"]')).toBeDisabled()
    await expect(page.locator('[data-testid="param-select-sage"]')).toBeDisabled()
    await expect(page.locator('[data-testid="lora-name-0"]')).toBeDisabled()
    await expect(page.locator('[data-testid="lora-remove-0"]')).toBeDisabled()
    await expect(page.locator('[data-testid="lora-add"]')).toBeDisabled()
  })
})
