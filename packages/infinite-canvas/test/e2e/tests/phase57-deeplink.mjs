import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Phase 57-03 — D-05 深链画布半边 + D-06 topbar navbar compact e2e(真实后端 10588)。
 *
 * 覆盖(57-03-PLAN Task 2 三 case):
 *  - case A(focus):/infinite-canvas/?projectId&episodesId&focus=<真实节点id> →
 *    既有 focusAssetNodeId effect 副作用:详情面板打开 + 视口中心逼近该节点;
 *    URL 留 focus 参数(replaceState 只回写 projectId/episodesId,可重放)。
 *  - case B(zone):&zone=<khsPrefix> → 该 phase 首个资产节点定位(视口中心逼近
 *    resolveDeepLinkTarget 的落点——与前端同一 nodes 集上复制查找逻辑)。
 *  - case C(回归):无 focus/zone 直链只加载不定位(详情面板不出现);topbar
 *    navbar compact 在位(高 ≤30px,不产生第二层 40px 横条)且视图切换簇可见。
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——先 `npm run build` + `bash scripts/deploy-canvas.sh`。
 * 真实后端:prod systemd @10588;项目/集/节点运行时发现(POST /api/canvas/projects
 * + load-v2 取真实值),只读零写。zone 词汇单源:解析 phaseRegistry.ts 源文件
 * (不在测试里复制 22 条表——55-D04 纪律)。
 */

const REAL_BASE = 'http://localhost:10588'
const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// ── 注册表单源解析:phaseIndex → khsPrefix(非 sub 条目优先占位) ──
const ZONE_BY_PHASE_INDEX = new Map()
{
  const src = readFileSync(path.join(PKG_DIR, 'src', 'constants', 'phaseRegistry.ts'), 'utf8')
  for (const m of src.matchAll(/phaseIndex: (\d+),( sub: true,)? khsPrefix: '([^']+)'/g)) {
    const phaseIndex = Number(m[1])
    const sub = Boolean(m[2])
    if (!sub || !ZONE_BY_PHASE_INDEX.has(phaseIndex)) ZONE_BY_PHASE_INDEX.set(phaseIndex, m[3])
  }
}

const ASSET_TYPES = new Set(['asset', 'script', 'storyboard', 'video', 'audio'])
const isFocusableAsset = (n) =>
  ASSET_TYPES.has(n.type) && !n.id.startsWith('evt_') && !n.id.startsWith('nvar_')
  && n.data?.curation !== 'deprecated'

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

/** 发现真实 scope:节点最多的(项目,集) + 该集 load-v2 节点集。 */
async function discoverScope() {
  const body = await fetchJson(`${REAL_BASE}/api/canvas/projects`, { method: 'POST' })
  let best = null
  for (const p of body.data ?? []) {
    for (const e of p.episodes ?? []) {
      if (!best || (e.nodeCount ?? 0) > (best.ep.nodeCount ?? 0)) best = { proj: p, ep: e }
    }
  }
  if (!best || !(best.ep.nodeCount > 0)) throw new Error('真实后端无带节点的项目/集(数据前置缺失)')
  const g = await fetchJson(`${REAL_BASE}/api/canvas/v2/load-v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: best.proj.id, episodesId: best.ep.id }),
  })
  const nodes = g.data?.nodes ?? []
  if (nodes.length === 0) throw new Error('load-v2 返回空图')
  return { projectId: best.proj.id, episodesId: best.ep.id, nodes }
}

function pickFocusNode(nodes) {
  return nodes.find(isFocusableAsset) ?? null
}

/** 节点最多的注册表内 phase → {zone, phaseIndex}(zone 深链落点断言基準)。 */
function pickZone(nodes) {
  const counts = new Map()
  for (const n of nodes) {
    if (!isFocusableAsset(n)) continue
    if (!ZONE_BY_PHASE_INDEX.has(n.phaseIndex)) continue
    counts.set(n.phaseIndex, (counts.get(n.phaseIndex) ?? 0) + 1)
  }
  let best = null
  for (const [phaseIndex, count] of counts) {
    if (!best || count > best.count) best = { phaseIndex, count }
  }
  return best ? { zone: ZONE_BY_PHASE_INDEX.get(best.phaseIndex), phaseIndex: best.phaseIndex } : null
}

async function openCanvas(page, params) {
  const qs = new URLSearchParams({ ...params, testMode: '1' })
  await page.goto(`${REAL_BASE}/infinite-canvas/?${qs.toString()}`, { waitUntil: 'domcontentloaded' })
}

/** 等图就绪:testMode 桥 + store 派生 RF nodes > 0(大图首拉+布局,宽限 30s)。 */
async function waitForGraphLoaded(page) {
  await expect
    .poll(() => page.evaluate(() => (window.__kaisCanvas ? 1 : 0)), { timeout: 10_000 })
    .toBe(1)
  await expect
    .poll(() => page.evaluate(() => window.__kaisCanvas?.getNodes()?.length ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0)
}

/** 与前端 resolveDeepLinkTarget 同一 nodes 集上复制落点逻辑(断言基准:目标 id)。 */
async function resolveZoneTargetIdInPage(page, phaseIndex) {
  return page.evaluate((pi) => {
    const nodes = window.__kaisCanvas?.getNodes() ?? []
    const hit = nodes.find((n) => {
      const v3 = n.data?.v3
      const idx = typeof v3?.phaseIndex === 'number' ? v3.phaseIndex : n.data?.phaseIndex
      const kind = v3?.kind
      return (kind == null || kind === 'asset') && idx === pi
    })
    return hit ? hit.id : null
  }, phaseIndex)
}

/**
 * 节点视觉居中断言:DOM rect 中心 ≈ RF pane 中心(屏幕坐标系)。
 * 注意不能用 store 节点 position——那是 adapter 布局缓存,渲染真值在
 * useLayout 重算后的 DOM transform(phase55 放置断言同教训)。
 */
async function expectNodeScreenCentered(page, nodeId, tol = 200) {
  await expect
    .poll(
      async () =>
        page.evaluate((nid) => {
          const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
          const pane = document.querySelector('.react-flow')
          if (!el || !pane) return null
          const r = el.getBoundingClientRect()
          const p = pane.getBoundingClientRect()
          const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          return Math.max(Math.abs(c.x - (p.x + p.width / 2)), Math.abs(c.y - (p.y + p.height / 2)))
        }, nodeId),
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(tol)
}

/** topbar 共享导航 compact 档断言(P-1:26px 内联,不产生第二层 40px 横条)。 */
async function expectCompactNavbar(page) {
  const nav = page.locator('kap-navbar[data-active="canvas"]')
  await expect(nav).toBeVisible({ timeout: 5_000 })
  const box = await nav.boundingBox()
  expect(box, 'kap-navbar boundingBox').not.toBeNull()
  expect(box.height).toBeLessThanOrEqual(30) // compact 26px(+容差),全宽档 40px 即红
  const links = nav.locator('a')
  // Phase 58 注记:6→5 —— b8be598a(2026-08-23)下线 Toonflow 项,kap-nav.ts NAV_ITEMS
  // 缩为 4 项(门户/画布/剧核/3D导演台,源注释即规则);旧 6 断言随之假红,随现实更新
  // (Phase 48「旧断言随现实更新并注记」先例,58-01 verify 门同款)。
  await expect(links).toHaveCount(5) // 品牌 KAP + 4 项(UI-SPEC P-1 词表 − Toonflow)
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('画布')
}

test.describe('phase57-deeplink 深链画布半边(真实后端)', () => {
  test('case A: focus 深链 → 既有 focus effect 定位 + URL 留参可重放', async ({ page }) => {
    const scope = await discoverScope()
    const target = pickFocusNode(scope.nodes)
    expect(target, '存在可聚焦资产节点').not.toBeNull()

    await openCanvas(page, {
      projectId: String(scope.projectId),
      episodesId: String(scope.episodesId),
      focus: target.id,
    })
    await waitForGraphLoaded(page)

    // focus effect 副作用(既有 762-786 语义):选中+详情打开
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible({ timeout: 15_000 })
    // fitView 定位:目标节点视觉居中(渲染真值 = DOM rect,非 store 布局缓存)
    await expectNodeScreenCentered(page, target.id)
    // replaceState 只回写 projectId/episodesId——focus 留在 URL,刷新可重放
    expect(page.url()).toContain('focus=')

    await expectCompactNavbar(page)
  })

  test('case B: zone 深链 → 该 phase 首个资产节点定位(泳道落点)', async ({ page }) => {
    const scope = await discoverScope()
    const z = pickZone(scope.nodes)
    expect(z, '存在注册表内有节点的 phase').not.toBeNull()

    await openCanvas(page, {
      projectId: String(scope.projectId),
      episodesId: String(scope.episodesId),
      zone: z.zone,
    })
    await waitForGraphLoaded(page)

    const resolvedId = await resolveZoneTargetIdInPage(page, z.phaseIndex)
    expect(resolvedId, '前端落点(该 phase 首个资产节点)').not.toBeNull()
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible({ timeout: 15_000 })
    await expectNodeScreenCentered(page, resolvedId)
    expect(page.url()).toContain(`zone=${z.zone}`)
  })

  test('case C: 无深链参数直链回归 — 只加载不定位,顶栏布局零回归', async ({ page }) => {
    const scope = await discoverScope()
    await openCanvas(page, {
      projectId: String(scope.projectId),
      episodesId: String(scope.episodesId),
    })
    await waitForGraphLoaded(page)

    // 不自动定位:详情面板不出现;给一次可能的错误定位留出窗口
    await page.waitForTimeout(1_200)
    await expect(page.locator('[data-testid="detail-panel"]')).toBeHidden()

    // navbar compact 在位且不挤视图切换簇(Do-Not-Regress 1:控件可见宽 > 0)
    await expectCompactNavbar(page)
    const timelineBtn = page.getByRole('button', { name: '时间轴', exact: true })
    await expect(timelineBtn).toBeVisible()
    const box = await timelineBtn.boundingBox()
    expect(box, '视图切换簇 boundingBox').not.toBeNull()
    expect(box.width).toBeGreaterThan(0)

    // 直链既有参数仍正常加载(?projectId/?episodesId 回归断言)
    const n = await page.evaluate(() => window.__kaisCanvas?.getNodes()?.length ?? 0)
    expect(n).toBeGreaterThan(0)
  })
})
