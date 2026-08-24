import { test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView } from '../helpers.mjs'

/**
 * Phase 60-04 — D-09 四用例: 保存后面板保持 e2e(mock :9876)
 *
 * 用例地图(标题内嵌 -g 组词 → D-09/VALIDATION tag):
 *  1. "self-save" + "silent"      → PANEL-01/D-05: 客户端「保存」→ save-v2 200 →
 *     自回声跳过 → 面板原地不动(同标题/同锚/DOM 延续)+ 零 reload toast + 零
 *     load-v2 后续请求(savedBy ^tab_ 上 wire 机制证据)。
 *  2. "other-client" + "symmetry" → PANEL-02/D-06/D-07: 他端保存(page.request
 *     直写不带 savedBy → 广播无身份 → 客户端按他端处理,60-02 契约)→ toast +
 *     reload → 同 id 重锚 + 标题随新真相刷新 + tab/宽度不重置 + 选中对称保持。
 *  3. "anchor-miss"               → D-03: 重载图锚 id 消失 → 面板诚实收起 +
 *     console.warn([panel-persist])。
 *  4. "no-revival"                → D-08/SC4 销案: rerun 重跑后 stale 角标归零
 *     且 2500ms 采样窗内保持零(mock 回声活性保留,自回声跳过客户端消化)。
 *
 * ⚠️ 地雷 #10: e2e 跑 dist 非源码——运行本文件前必须
 *    `npm run build`(packages/infinite-canvas),否则测的是旧构建产物。
 *
 * D-04 契约对齐: mock 断言即真机行为——自回声跳过在客户端实现(savedBy 回显
 * 判定,FlowCanvas onGraphSaved),mock save-v2 广播恒发零旁路(旋钮已随 60-02
 * 退役),本文件全部断言直接映射真机语义。
 *
 * 断言纪律(UI-SPEC §7): 零新增 data-testid(仅引用既有 detail-panel /
 * stale-rerun-btn / prompt-regenerate / prompt-section);脉动/装饰性不断言
 * (59-UI-SPEC §2 flake-bait 沿袭);宽度断言容差 ±2px。
 */

const TRIG = 'trig-1'
const MID = 'mid-1'
const DOWN = 'down-1'
const DOWN_B = 'down-2'
const UNREL = 'unrel-1'
const ADDED = 'added-1'
const PID = 1
const EID = 1

const SAVE_V2 = '/api/canvas/v2/save-v2'
const LOAD_V2 = '/api/canvas/v2/load-v2'

// 两条 reload toast 精确串(FlowCanvas.tsx L351/L830,ASCII 逗号)
const TOAST_OTHER_CLIENT = 'Pipeline 同步了新数据,正在刷新画布…'
const TOAST_HEALTH_FALLBACK = '检测到 pipeline 远端更新,正在刷新画布…'

/**
 * fixture 节点: wire 顶层 phaseName 是 V2 公共字段(§7)——migrate 落成
 * AssetNodeV3.phaseName,adapter 派生 RF data.label = phaseName || id,面板标题
 * (data.label ?? phaseName)由此可区分(wire data.label 本体不进 V3 标题链)。
 */
function fixtureNode(id, type, x, y, data) {
  return { id, type, phaseName: data.label, position: { x, y }, size: { width: 260, height: 180 }, data, state: 'idle' }
}

/**
 * 三节点裁剪版 fixture(用例 1-3): trig-1 → mid-1 / down-1 两条 image 链。
 * 形状照搬 phase59 cascadeFixtureGraph(storyboard 资产,adaptV2Graph 宽松消费)。
 */
function miniFixtureGraph() {
  return {
    nodes: [
      fixtureNode(TRIG, 'storyboard', 400, 50, {
        label: '触发资产', type: 'storyboard', storyboardId: 91, duration: 3,
        prompt: '触发配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(MID, 'storyboard', 220, 420, {
        label: '链中资产', type: 'storyboard', storyboardId: 92, duration: 3,
        prompt: '链中配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(DOWN, 'storyboard', 700, 420, {
        label: '链尾资产', type: 'storyboard', storyboardId: 93, duration: 3,
        prompt: '链尾配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
    ],
    links: [
      { id: 'cl1', source: TRIG, target: MID, data: { dataType: 'image' } },
      { id: 'cl2', source: TRIG, target: DOWN, data: { dataType: 'image' } },
    ],
    groups: [],
    variantGroups: [],
  }
}

/**
 * 完整五节点 cascade fixture(用例 4 专用,phase59 cascadeFixtureGraph 同款):
 * trig-1 ─┬→ mid-1 → down-2(链)+ trig-1 → down-1(独立叶子)+ unrel-1(无关系负向锚)。
 */
function cascadeFixtureGraph() {
  return {
    nodes: [
      fixtureNode(TRIG, 'storyboard', 400, 50, {
        label: '触发资产', type: 'storyboard', storyboardId: 91, duration: 3,
        prompt: '触发配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(MID, 'storyboard', 220, 420, {
        label: '链中资产', type: 'storyboard', storyboardId: 92, duration: 3,
        prompt: '链中配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(DOWN_B, 'storyboard', 220, 780, {
        label: '链尾资产', type: 'storyboard', storyboardId: 93, duration: 3,
        prompt: '链尾配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(DOWN, 'storyboard', 700, 420, {
        label: '独立下游', type: 'storyboard', storyboardId: 94, duration: 3,
        prompt: '独立配方', filePath: null, thumbnailUrl: null, state: 'idle',
      }),
      fixtureNode(UNREL, 'audio', 700, 780, {
        label: '无关节点', type: 'audio', audioId: 9, filePath: null, thumbnailUrl: null, state: 'idle',
      }),
    ],
    links: [
      { id: 'cl1', source: TRIG, target: MID, data: { dataType: 'image' } },
      { id: 'cl2', source: MID, target: DOWN_B, data: { dataType: 'image' } },
      { id: 'cl3', source: TRIG, target: DOWN, data: { dataType: 'image' } },
    ],
    groups: [],
    variantGroups: [],
  }
}

/** 注入 fixture 并 reload(load-v2 → migrate 合成 evt_ 事件链;58-03 范式)。 */
async function injectFixture(page, graph) {
  await page.request.post(SAVE_V2, { data: { projectId: PID, episodesId: EID, graph } })
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

/** 面板重生成提交(panelRegen 范式):开面板 → 点重生成(regenSource=panel-regen)。 */
async function panelRegen(page, nodeId) {
  await openDetailPanel(page, nodeId)
  await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeEnabled()
  await page.locator('[data-testid="prompt-regenerate"]').click()
}

/** 节点 stale 角标 locator(UI-SPEC §8 canonical 选择器,禁新增 testid)。 */
const staleBadge = (page, nodeId) => page.locator(`${nodeSelector(nodeId)} svg[aria-label="stale"]`)

/** 最近一条指定 path 的 mock 调用(getCalls 观测点)。 */
async function lastCall(page, path) {
  const calls = await getCalls(page)
  const hits = calls.filter((c) => c.path === path)
  return hits[hits.length - 1]
}

/** mock 调用计数(用例 1 的「零 load-v2 后续请求」最硬信号)。 */
async function callCount(page, path) {
  const calls = await getCalls(page)
  return calls.filter((c) => c.path === path).length
}

/** 等 store 编排态离开 running(useStaleRerun「编排进行中」守卫——双出口串行前提)。 */
async function waitForOrchIdle(page, timeout = 8_000) {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const st = window.__kaisCanvas?.getOrchestration?.()?.status
      return st === 'running' ? 'running' : 'idle-or-done'
    })
  }, { timeout }).toBe('idle-or-done')
}

/**
 * 页内 toast spy(T-60-06 accept: 只读 DOM 文本,零 store 写):
 * MutationObserver 监听 body 增节点,文本命中两条 reload toast 精确串之一即
 * push 进 window.__toastLog——3s 自灭瞬态(ToastContainer 3s 定时移除)的可靠
 * 捕获,替代事后 locator 竞态。
 */
async function installToastSpy(page) {
  await page.evaluate(([a, b]) => {
    const patterns = [a, b]
    window.__toastLog = []
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added instanceof HTMLElement) {
            const text = added.innerText ?? ''
            if (patterns.some((p) => text.includes(p))) window.__toastLog.push(text.trim())
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, [TOAST_OTHER_CLIENT, TOAST_HEALTH_FALLBACK])
}

const readToastLog = (page) => page.evaluate(() => [...(window.__toastLog ?? [])])

const panelLocator = (page) => page.locator('[data-testid="detail-panel"]')

/** 面板标题 span(标题栏首个 div 内第 2 个 span: 图标 span → 标题 span;锚同一性代理)。 */
const panelTitle = (page) => panelLocator(page).locator('div').first().locator('span').nth(1)

/** DOM 延续探针(RESEARCH Pitfall 6): 测试侧运行时打标记——同 id 重锚不 unmount
 *  则 React 复用同一 DOM 节点、标记存活;unmount→remount 则标记随节点消失。 */
const tagPanelDom = (page) =>
  page.evaluate(() => { document.querySelector('[data-testid="detail-panel"]')?.setAttribute('data-pw60-keep', '1') })
const panelDomTagged = (page) =>
  page.evaluate(() => document.querySelector('[data-testid="detail-panel"]')?.hasAttribute('data-pw60-keep') ?? false)

/** 拖拽面板左缘把手改宽(resize handle: right:panelWidth 宽 6px,onMove:
 * width = startW + startX − clientX——左拖增宽)。480 默认宽下宽度断言无区分度,
 * 用例 2 先拖到非默认宽再断言「重锚不重置」。 */
async function resizePanelWider(page, delta = 80) {
  const box = await panelLocator(page).boundingBox()
  const handleX = box.x - 3 // 把手中心(把手贴面板左缘外侧)
  const y = box.y + box.height / 2
  await page.mouse.move(handleX, y)
  await page.mouse.down()
  await page.mouse.move(handleX - delta, y, { steps: 8 })
  await page.mouse.up()
}

test.describe('Phase 60-04 — 保存后面板保持 (D-09 四用例)', () => {
  test('self-save keeps panel open, silent (PANEL-01, D-05)', async ({ page }) => {
    await loadCanvas(page)
    await injectFixture(page, miniFixtureGraph())

    await openDetailPanel(page, TRIG)
    const titleBefore = (await panelTitle(page).innerText()).trim()
    expect(titleBefore).toBe('触发资产')
    expect(await page.evaluate(() => window.__kaisCanvas?.getDetailNode()?.id ?? null)).toBe(TRIG)
    await tagPanelDom(page)

    await installToastSpy(page)
    // 工具栏保存按钮(top-left Panel)——面板 PromptSection 另有同名「保存」
    // (prompt-save),全局 locator 会 strict-mode 撞车,必须按容器收窄
    const saveBtn = page.locator('.react-flow__panel.top.left').getByRole('button', { name: '保存', exact: true })
    const loadV2Before = await callCount(page, LOAD_V2)

    await saveBtn.click()

    // 机制证据: 客户端身份上 wire——save-v2 body.savedBy 匹配 ^tab_(clientTabId.ts
    // 契约,canvasApi.saveCanvasGraph 单点附加)。mock logCall 记 savedBy(60-02)。
    let saved = null
    await expect.poll(async () => {
      saved = await lastCall(page, SAVE_V2)
      return typeof saved?.body?.savedBy === 'string' && /^tab_/.test(saved.body.savedBy)
    }, { timeout: 5_000 }).toBe(true)
    expect(saved.body.savedBy).toMatch(/^tab_/)

    // 5ms 回声(mock broadcast setTimeout)+ 余量;回声活性保留,跳过纯客户端
    await page.waitForTimeout(900)

    // 面板原地不动: 可见 / 同标题 / 同锚 id / DOM 节点延续(stay-mounted)
    await expect(panelLocator(page)).toBeVisible()
    await expect(panelTitle(page)).toHaveText(titleBefore)
    expect(await page.evaluate(() => window.__kaisCanvas?.getDetailNode()?.id ?? null)).toBe(TRIG)
    expect(await panelDomTagged(page)).toBe(true)
    // silent: 两条 reload toast 精确串零命中(页内 spy,不靠事后 locator)
    expect(await readToastLog(page)).toEqual([])
    // 最硬信号: 未 reload——load-v2 调用计数不变
    expect(await callCount(page, LOAD_V2)).toBe(loadV2Before)
    // 保存按钮文本回归「保存」(200 即反馈;D-05: 唯一自保存成功反馈面)
    await expect(saveBtn).toContainText('保存')
    await expect(saveBtn).not.toContainText('保存中')
  })

  test('other-client save reloads and re-anchors, symmetry preserved (PANEL-02, D-06, D-07)', async ({ page }) => {
    await loadCanvas(page)
    await injectFixture(page, miniFixtureGraph())

    await openDetailPanel(page, TRIG)
    // tab 离开 detail(「🔄 迭代」)——重锚后 tab 不回 'detail' 即「未 unmount」证明
    await panelLocator(page).locator('button', { hasText: '迭代' }).click()
    // 宽度拖到非默认(480 初值无区分度;≈560)
    await resizePanelWider(page, 80)
    const widthBefore = (await panelLocator(page).boundingBox()).width
    expect(widthBefore).toBeGreaterThan(500) // 拖拽生效门(拖失败此处先红)
    // D-07 选中对称前置: dblclick(onNodeDoubleClick)已同时设 selectedNode +
    // detailNode 双锚。注: 计划原文用 setSelectedNodeIds 桥——那是 RF 瞬态镜像
    // (onSelectionChange 在 setGraph 节点换血时被 RF 清空,FlowCanvas L621),
    // 重载后结构性必丢;对称真锚是 store.selectedNode(见收尾断言)。
    expect(await page.evaluate(() => window.__kaisCanvas?.getSelectedNode()?.id ?? null)).toBe(TRIG)
    await tagPanelDom(page)
    await installToastSpy(page)

    // 他端保存: page.request 直写不带 savedBy → 广播无身份 → 客户端按他端处理
    // (60-02 契约)。图改造: trig-1 保留但改名(wire 顶层 phaseName——面板标题真值
    // 源,fixtureNode 注释),另加 added-1。
    const otherGraph = miniFixtureGraph()
    otherGraph.nodes[0].data.label = '他端改名'
    otherGraph.nodes[0].phaseName = '他端改名'
    otherGraph.nodes.push(fixtureNode(ADDED, 'audio', 950, 780, {
      label: '他端新增', type: 'audio', audioId: 7, filePath: null, thumbnailUrl: null, state: 'idle',
    }))
    await page.request.post(SAVE_V2, { data: { projectId: PID, episodesId: EID, graph: otherGraph } })

    // reload toast 只属他端(自保存零 toast 的对照面)
    await expect.poll(async () => (await readToastLog(page)).length, { timeout: 5_000 }).toBeGreaterThan(0)
    expect((await readToastLog(page)).some((t) => t.includes(TOAST_OTHER_CLIENT))).toBe(true)

    // reload 落地: 同 id 重锚 + 新节点进入派生模型
    await expect.poll(async () => {
      return page.evaluate(() => window.__kaisCanvas?.getDetailNode()?.id ?? null)
    }, { timeout: 8_000 }).toBe(TRIG)
    await expect.poll(async () => {
      return page.evaluate((nid) => (window.__kaisCanvas?.getNodes() ?? []).some((n) => n.id === nid), ADDED)
    }, { timeout: 8_000 }).toBe(true)

    // 面板可见 + 标题随新真相刷新(D-06: 同 id 锚 + 内容跟随,非冻结快照)
    await expect(panelLocator(page)).toBeVisible()
    await expect(panelTitle(page)).toHaveText('他端改名')
    // DOM 延续(未 unmount → panelWidth/tab 内部态未丢)
    expect(await panelDomTagged(page)).toBe(true)
    // tab 未重置: 「🔄 迭代」仍 active(NodeDetailPanel reset effect 仅 node?.id
    // 变化时触发——同 id 重锚不触发;TabButton active 态 fontWeight 600)
    const iterFontWeight = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-testid="detail-panel"] button')]
      const b = btns.find((el) => (el.textContent ?? '').includes('迭代'))
      return b ? getComputedStyle(b).fontWeight : null
    })
    expect(iterFontWeight).toBe('600')
    // 宽度保持(±2px 容差;unmount 会回 480 默认)
    const widthAfter = (await panelLocator(page).boundingBox()).width
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(2)
    // 选中对称保持(D-07: store.selectedNode 与 detailNode 同语义存活——setGraph
    // L452/L455 相邻行同 id 重锚,双锚要么同活要么同收)
    expect(await page.evaluate(() => window.__kaisCanvas?.getSelectedNode()?.id ?? null)).toBe(TRIG)
  })

  test('anchor-miss collapses honestly (D-03)', async ({ page }) => {
    await loadCanvas(page)
    await injectFixture(page, miniFixtureGraph())

    await openDetailPanel(page, DOWN)
    await expect(panelTitle(page)).toHaveText('链尾资产')

    // console 收集须在触发前挂(graph:saved reload 是页内 store reload 非导航,监听存活)
    const consoleTexts = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))

    // 他端保存的图删除了 down-1 → 重锚 miss
    const shrunkGraph = miniFixtureGraph()
    shrunkGraph.nodes = shrunkGraph.nodes.filter((n) => n.id !== DOWN)
    shrunkGraph.links = shrunkGraph.links.filter((l) => l.source !== DOWN && l.target !== DOWN)
    await page.request.post(SAVE_V2, { data: { projectId: PID, episodesId: EID, graph: shrunkGraph } })

    // reload 落地: 图中 down-1 消失
    await expect.poll(async () => {
      return page.evaluate((nid) => (window.__kaisCanvas?.getNodes() ?? []).some((n) => n.id === nid), DOWN)
    }, { timeout: 8_000 }).toBe(false)
    // 真收起: 面板 count === 0(无占位/无模糊重锚漂移——count 0 即未漂到别的节点)
    await expect(panelLocator(page)).toHaveCount(0)
    // 诚实路径验收钩子(60-03): console.warn 默认串含 [panel-persist] + 丢失锚 id
    const warnHits = consoleTexts.filter((t) => t.includes('[panel-persist]') && t.includes(DOWN))
    expect(warnHits.length).toBeGreaterThanOrEqual(1)
  })

  test('no-revival after rerun (D-08, SC4 closure)', async ({ page }) => {
    await loadCanvas(page)
    await injectFixture(page, cascadeFixtureGraph())

    // SC1 前置: 面板重生成 → 三下游角标(mid-1/down-2 链 + down-1 独立叶子)
    await panelRegen(page, TRIG)
    await expect(staleBadge(page, MID)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_B)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, UNREL)).toHaveCount(0) // 无下游关系节点全程无角标

    // 出口 1(面板): down-1 StaleSection「重跑下游」→ rerunStaleChain 保存
    // (saveCanvasGraph 单点自动带 savedBy → graph:saved 自回声被 D-01 跳过)
    // + orchestrate 子集 [down-1] → node:state success 清 stale(52-01 链)
    await openDetailPanel(page, DOWN)
    await page.locator('[data-testid="stale-rerun-btn"]').click()
    await expect(staleBadge(page, DOWN)).toHaveCount(0, { timeout: 8_000 })
    // mid-1/down-2 链未进本次子集,角标保持(SC4 既有语义)
    await expect(staleBadge(page, MID)).toBeVisible()
    await expect(staleBadge(page, DOWN_B)).toBeVisible()
    await waitForOrchIdle(page) // 「编排进行中」守卫解除后才可出口 2

    // 出口 2(角标): mid-1 链子集 [mid-1, down-2] → 全画布角标归零
    // (Rule 3 补步: 计划采样断言读「全画布」计数,须双出口清完三条链才有 0 可保持)
    await staleBadge(page, MID).click()
    await expect(staleBadge(page, MID)).toHaveCount(0, { timeout: 8_000 })
    await expect(staleBadge(page, DOWN_B)).toHaveCount(0, { timeout: 8_000 })

    // 采样窗: 每 300ms 读全画布 stale 角标计数,持续 2500ms 全程 === 0。
    // 无 suppressGraphSaved 旋钮(60-02 退役,广播恒发)——两次 rerun 保存的
    // graph:saved 回声活性保留,由客户端 savedBy 自回声跳过消化;跳过失效则
    // 自回声 reload 与 node:state success 清 stale 的写-写竞态复活角标
    // (59 Known Issue #1 回归,观测复活窗 ~1s < 2500ms 采样窗)。
    const badgeAll = page.locator('.react-flow__node svg[aria-label="stale"]')
    await expect(badgeAll).toHaveCount(0)
    const samples = []
    const deadline = Date.now() + 2_500
    while (Date.now() < deadline) {
      await page.waitForTimeout(300)
      samples.push(await badgeAll.count())
    }
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((c) => c === 0)).toBe(true)
  })
})
