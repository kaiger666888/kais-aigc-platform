import { test, expect, loadCanvas } from '../helpers.mjs'

/**
 * Phase 55-07 — NAV-03/04/05 e2e 冒烟(55-VALIDATION Wave 0 最后缺口)。
 *
 * 覆盖:
 *  - search-navigator-open:`/` 打开导航器(dialog+自动聚焦);输入框聚焦时 `/` 不劫持(Pitfall 7)
 *  - search-grouped-jump:场景分组结果 + Enter 跳转;查询期间画布节点零隐藏(Do-Not-Regress 3)
 *  - new-asset-placement:经 55-04 testMode 桥 addNodeForTest 驱动——落点与
 *    live getViewCenter() 各轴 ≤64px(有界断言,成功标准 4 e2e 口径)
 *  - lane-focus-readable:列头「聚焦本阶段」→ zoom ≥0.6(恢复下限,预置 laneZoom 记忆)
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——先 `npm run build`。
 * 真实后端模式(可选):REAL_BACKEND=true 时打 localhost:10588 真实 projectId
 * (默认 mock;placement 用例只走客户端 store 桥,零生产写)。
 */

const REAL_BACKEND = process.env.REAL_BACKEND === 'true'
const REAL_BASE = 'http://localhost:10588'

/** 等视口安定(初始 fitView 600ms 动画内中心仍在移动——注入/断言前必须稳)。 */
async function waitViewportSettled(page) {
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      await page.waitForTimeout(250)
      const b = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      return a != null && b != null && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 ? 1 : 0
    }, { timeout: 8_000 })
    .toBe(1)
}

/** 读取 .react-flow__viewport transform 的 scale(即当前 zoom)。 */
async function viewportZoom(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.react-flow__viewport')
    if (!el) return null
    const m = el.style.transform.match(/scale\(([\d.]+)\)/)
    return m ? Number(m[1]) : null
  })
}

test.describe('phase55-nav 导航冒烟', () => {
  test.beforeEach(async ({ page }) => {
    // 预置泳道缩放记忆(phaseIndex 9 → 0.9):lane-focus 用例的恢复值(≥0.6 下限)
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          'kais:canvas:v1:p1:e1',
          JSON.stringify({ laneZoom: { 9: 0.9 } }),
        )
      } catch { /* 隐私模式等:降级为无记忆(fitView 结果即好) */ }
    })
    if (REAL_BACKEND) {
      await page.goto(`${REAL_BASE}/?projectId=1787033533354&episodesId=1&testMode=1`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
      await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
    } else {
      await loadCanvas(page)
    }
  })

  test('search-navigator-open:`/` 打开 dialog;输入框聚焦时不劫持', async ({ page }) => {
    // 画布态(非输入焦点)按 `/` → 打开 + 输入框自动聚焦
    await page.keyboard.press('/')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('[data-testid="search-navigator"] input')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeHidden()

    // 工具栏搜索输入框聚焦时按 `/` → 字符照常输入,不打开(Pitfall 7)
    const toolbarInput = page.locator('.cv-search-input').first()
    await toolbarInput.click()
    // 聚焦工具栏输入框本身会打开导航器(onFocus 入口)——先 Esc 关掉再测字符不劫持
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeHidden()
    await page.keyboard.press('/')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeHidden()
  })

  test('search-grouped-jump:场景分组 + Enter 跳转 + 查询期零隐藏', async ({ page }) => {
    // 经 testMode 桥注入分镜节点(data.shot_id → sceneNumOf 分组 + label 可命中)
    const injected = await page.evaluate(() => {
      const mk = (id, shotId) => ({
        id, type: 'storyboard', branchId: 'main',
        position: { x: 1200, y: 600 }, size: { width: 240, height: 160 },
        state: 'success',
        data: { shot_id: shotId, label: shotId, filePath: null, thumbnailUrl: null, state: 'success' },
      })
      window.__kaisCanvas?.addNodeForTest(mk('e2e-shot-s01', 'S01_001'))
      return window.__kaisCanvas?.addNodeForTest(mk('e2e-shot-s03', 'S03_001'))
    })
    expect(injected).toBe(true)
    // DOM 反射(setGraph 重建 → layoutedNodes → RF 渲染)
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.react-flow__node[data-id="e2e-shot-s01"]')))
      .toBe(true)

    await page.keyboard.press('/')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeVisible()
    await page.keyboard.type('S0')
    // 场景分组头出现(场景 1 / 场景 3,sceneNumOf 升序)
    await expect(page.locator('[data-testid="search-navigator"]').getByText('场景 1')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('[data-testid="search-navigator"]').getByText('场景 3')).toBeVisible()

    // 查询激活期间画布节点零隐藏(Do-Not-Regress 3:Phase 45 hidden 路径已删)
    const hiddenCount = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].filter((n) =>
        n.classList.contains('hidden') || n.style.display === 'none' || n.style.visibility === 'hidden',
      ).length,
    )
    expect(hiddenCount).toBe(0)

    // Enter → 跳转聚焦(聚焦 effect 打开右详情面板 setDetailNode + fitView)
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeHidden()
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible({ timeout: 5_000 })
  })

  test('new-asset-placement:无 position 节点落点与 live 视口中心 ≤64px', async ({ page }) => {
    // live 桥就绪前置(getViewCenter 读 FlowCanvas live ref;必须 poll,一次性 evaluate 会竞态)
    await expect.poll(() => page.evaluate(() => window.__kaisCanvas?.getViewCenter() ?? null), { timeout: 5_000 }).not.toBeNull()

    const added = await page.evaluate(() => {
      const id = `e2e-place-${Date.now()}`
      const ok = window.__kaisCanvas?.addNodeForTest({
        id, type: 'asset', branchId: 'main',
        // 无 position → placeNewAsset(视口中心 8px 网格)分支
        size: { width: 240, height: 160 }, state: 'success',
        data: { label: id, assetType: 'role', filePath: null, state: 'idle' },
      })
      return ok ? id : null
    })
    expect(added).toBeTruthy()

    // DOM 反射 + canonical 断言(rfNodes position 是布局缓存;放置决策在 graph)
    await expect
      .poll(() => page.evaluate((nid) => !!document.querySelector(`.react-flow__node[data-id="${nid}"]`), added))
      .toBe(true)

    // 有界断言:canonical graph 节点 position 与「再次读取的 live 视口中心」各轴 ≤64px
    // (两侧均实时值;桥不触发聚焦 → 视口不动,测的是放置决策本身)
    const dist = await page.evaluate((nid) => {
      const g = window.__kaisCanvas?.getGraph()
      const n = g?.nodes.find((x) => x.id === nid)
      const c = window.__kaisCanvas?.getViewCenter()
      if (!n || !c) return null
      return { dx: Math.abs(n.position.x - c.x), dy: Math.abs(n.position.y - c.y) }
    }, added)
    expect(dist).not.toBeNull()
    expect(dist.dx).toBeLessThanOrEqual(64)
    expect(dist.dy).toBeLessThanOrEqual(64)
  })

  test('lane-focus-readable:列头聚焦恢复 zoom ≥0.6', async ({ page }) => {
    await waitViewportSettled(page)
    // 注入 phaseIndex=9 节点驱动 phase-columns 渲染
    await page.evaluate(() => {
      return window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-lane-9', type: 'asset', branchId: 'main',
        position: { x: 900, y: 300 }, size: { width: 240, height: 160 },
        phaseIndex: 9, state: 'success',
        data: { label: 'e2e-lane-9', assetType: 'role', filePath: null, state: 'success' },
      })
    })
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('[data-testid="phase-columns"] [aria-label*="聚焦本阶段"]').length))
      .toBeGreaterThanOrEqual(1)

    // CSS 属性选择器定位(匹配 DOM 属性,不经 a11y 树——与 55-05 aria-hidden 删除互补);
    // 点击热区内的 rect(g 级 bbox 动作性不稳);目标列 = 注入节点的 phaseIndex 9(P09)
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('[aria-label="聚焦本阶段 P09"]')))
      .toBe(true)
    // evaluate 直发 click:命中矩形可能在顶栏/面板之下,actionability 点击会被
    // 遮挡拦截——冒烟验证的是 focusColumn 处理链,不做命中几何断言
    await page.evaluate(() => {
      document.querySelector('[aria-label="聚焦本阶段 P09"] rect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // fitView 600ms + 恢复 120ms;预置记忆 laneZoom{9:0.9} → 终值 ≥0.6(下限)
    await expect
      .poll(() => viewportZoom(page), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(0.6)
  })

  test('收尾:无未捕获页面错误', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.keyboard.press('/')
    await expect(page.locator('[data-testid="search-navigator"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    expect(errors).toEqual([])
  })
})
