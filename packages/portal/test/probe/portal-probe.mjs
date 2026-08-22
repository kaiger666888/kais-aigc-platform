#!/usr/bin/env node
/**
 * portal-probe.mjs — Phase 57-08 headless 真后端探针（playwright chromium @10588）。
 *
 * 先例：
 *  - packages/infinite-canvas/canvas-real-screenshot.mjs（launch / goto /
 *    waitForSelector / console 收集的探针模板）
 *  - packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs（深链
 *    round-trip 同口径：DOM rect 屏幕坐标断言，非 store 布局缓存）
 *
 * probe A 门户首页 /portal：navbar 在位（aria-current 自判档）；项目分节或
 *   空态二择一断言——存在性守卫：先 POST /api/canvas/projects 判有无数据再
 *   选分支，两分支都必须有断言文案（不跳过）。
 * probe B 交付页 /deliver/:ep：三区块标题（成片/交付清单/终审）渲染；p13
 *   守卫（episodes[].phases 直方图 p13 段 > 0 + load-v2 video 形判定）→
 *   有成片断言 <video> src 非空，否则断言无成片空态文案。
 * probe C 深链 round-trip：/canvas?project&ep&focus=<load-v2 真实节点 id> →
 *   302 → 画布加载 → 节点 selected/detail（detail-panel 打开）+ 目标节点
 *   视觉居中（DOM rect ≈ pane 中心）+ URL 留 focus 可重放。
 *
 * 只读（GET + 既有 POST projects/load-v2 查询，T-57-08a）；zone 词汇单源：
 * 解析 phaseRegistry.ts 源文件取 p13 phaseIndex（不在探针里内联 22 条表）。
 * Run: npm run probe（packages/portal）· Exit: 0 全绿 / 1 任一红
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.KAP_PROBE_BASE ?? 'http://localhost:10588'
const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const REGISTRY_SRC = path.join(PKG_DIR, 'infinite-canvas', 'src', 'constants', 'phaseRegistry.ts')

// ── p13 phaseIndex 单源解析（e2e phase57-deeplink.mjs 同款纪律） ──────────
function p13PhaseIndex() {
  const src = readFileSync(REGISTRY_SRC, 'utf8')
  const m = [...src.matchAll(/phaseIndex: (\d+),( sub: true,)? khsPrefix: '([^']+)'/g)]
    .find((x) => x[3] === 'p13')
  if (!m) throw new Error(`phaseRegistry.ts 未解析出 p13 条目（${REGISTRY_SRC}）`)
  return Number(m[1])
}

const results = []
function record(pass, name, detail = '') {
  results.push({ pass, name })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`)
}

async function fetchJson(pathname, opts) {
  const res = await fetch(`${BASE}${pathname}`, opts)
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`)
  return res.json()
}

const post = (pathname, body = '{}') => fetchJson(pathname, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
})

async function listProjects() {
  const body = await post('/api/canvas/projects')
  return body.data ?? []
}

/** e2e 同款可聚焦资产判定（focus 目标池）。 */
const ASSET_TYPES = new Set(['asset', 'script', 'storyboard', 'video', 'audio'])
const isFocusableAsset = (n) =>
  ASSET_TYPES.has(n.type) && !n.id.startsWith('evt_') && !n.id.startsWith('nvar_')
  && n.data?.curation !== 'deprecated'

/** A4 video 形判定（镜像 delivery.ts isVideoLike：type=video 或 delivery+.mp4）。 */
const isVideoLike = (n) =>
  n.type === 'video'
  || (n.data?.assetType === 'delivery' && /\.mp4$/i.test(n.data?.filePath ?? n.data?.path ?? ''))

async function loadV2(projectId, episodesId) {
  const g = await post('/api/canvas/v2/load-v2', JSON.stringify({ projectId, episodesId }))
  return g.data?.nodes ?? []
}

function attachConsoleWatch(page, sink) {
  page.on('pageerror', (e) => sink.push(e.message))
  page.on('console', (msg) => { if (msg.type() === 'error') sink.push(msg.text()) })
}

// ═══ probe A 门户首页 ════════════════════════════════════════════════════
async function probeA(browser) {
  console.log('\n=== probe A 门户首页 /portal（navbar + 项目分节|空态 守卫分支）===')
  const projects = await listProjects()
  const hasData = projects.length > 0
  console.log(`  守卫:projects=${projects.length} → 走${hasData ? '数据' : '空态'}分支`)

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  attachConsoleWatch(page, errors)
  await page.goto(`${BASE}/portal`, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // navbar 升级在位（portal 宿主无 data-active 显式属性——自判档经 aria-current 可见）
  const nav = page.locator('kap-navbar')
  await nav.waitFor({ state: 'visible', timeout: 10_000 })
  record(true, 'A: kap-navbar 可见')
  const current = nav.locator('a[aria-current="page"]')
  record(await current.count() === 1 && (await current.textContent()) === '门户', 'A: navbar 当前项=门户(aria-current)')
  record(await nav.locator('a').count() === 6, 'A: navbar 6 链接(品牌 KAP + 5 项)')

  if (hasData) {
    const sections = page.locator('main section[aria-label], section[aria-label]')
    await page.locator('h1', { hasText: '项目' }).first().waitFor({ timeout: 10_000 })
    record(await sections.count() > 0, 'A: 数据分支——项目分节渲染', `sections=${await sections.count()}`)
  } else {
    await page.getByText('暂无项目').waitFor({ timeout: 10_000 })
    record(true, 'A: 空态分支——「暂无项目」文案在位')
  }
  record(errors.length === 0, 'A: 无页面错误', errors.slice(0, 2).join(' | ') || '0 errors')
  await page.close()
}

// ═══ probe B 交付页 ══════════════════════════════════════════════════════
async function probeB(browser) {
  console.log('\n=== probe B 交付页 /deliver/:ep（三区块 + p13 守卫分支）===')
  const p13Idx = p13PhaseIndex()
  const projects = await listProjects()

  // 守卫：镜像 DeliveryPage.resolveProjectId——ep → 列表序第一个含该 ep 的项目。
  // 57-05 Deviation 1 实测：存量库多项目共享 ep id，守卫若不按同序反查会与页面
  // 落到不同项目（页面看 p13 空集、探针却期望成片）。只接受反查一致且 p13 > 0 的集。
  const firstProjOfEp = new Map()
  for (const p of projects) {
    for (const e of p.episodes ?? []) {
      if (!firstProjOfEp.has(e.id)) firstProjOfEp.set(e.id, p.id)
    }
  }
  let target = null
  let best = null
  for (const p of projects) {
    for (const e of p.episodes ?? []) {
      if (firstProjOfEp.get(e.id) !== p.id) continue // 页面反查不会落本项目——排除
      const n13 = Number(e.phases?.[String(p13Idx)] ?? 0)
      if (!target && n13 > 0) target = { proj: p, ep: e, n13 }
      if (!best || (e.nodeCount ?? 0) > (best.ep.nodeCount ?? 0)) best = { proj: p, ep: e }
    }
  }
  const scope = target ?? best
  if (!scope) throw new Error('真实后端无任何项目/集（数据前置缺失）')

  let branch
  let expectVideo = false
  if (target) {
    const nodes = await loadV2(scope.proj.id, scope.ep.id)
    const p13Videos = nodes.filter((n) => n.phaseIndex === p13Idx && isVideoLike(n))
    expectVideo = p13Videos.length > 0
    branch = expectVideo ? `p13-成片(${p13Videos.length} video 形)` : 'p13-无 video 形(空态)'
  } else {
    branch = '无 p13 集(空态)'
  }
  console.log(`  守卫:ep=${scope.ep.id} proj=${scope.proj.id} → 走${branch}分支`)

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  attachConsoleWatch(page, errors)
  await page.goto(`${BASE}/deliver/${scope.ep.id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // 三区块标题（交付 vernacular：成片/交付清单/终审）——load-v2 大图宽限 30s
  for (const label of ['成片', '交付清单']) {
    await page.locator(`section[aria-label="${label}"]`).waitFor({ timeout: 30_000 })
    record(true, `B: 区块「${label}」渲染`)
  }
  await page.locator('aside[aria-label="终审"]').waitFor({ timeout: 10_000 })
  record(true, 'B: 区块「终审」渲染')
  record(await page.locator('aside[aria-label="终审"] h2', { hasText: '成片终审' }).count() === 1, 'B: 终审卡标题「成片终审」')

  if (expectVideo) {
    const video = page.locator('section[aria-label="成片"] video')
    record(await video.count() >= 1, 'B: p13 分支——<video> 元素在位', `count=${await video.count()}`)
    const src = await video.first().getAttribute('src').catch(() => null)
    record(Boolean(src), 'B: video src 非空(resolveMediaUrl 同链)', src?.slice(0, 60) ?? 'null')
  } else {
    await page.getByText('本集尚未产出成片').waitFor({ timeout: 10_000 })
    record(true, 'B: 无成片空态——「本集尚未产出成片」文案在位')
  }
  record(errors.length === 0, 'B: 无页面错误', errors.slice(0, 2).join(' | ') || '0 errors')
  await page.close()
}

// ═══ probe C 深链 round-trip ═════════════════════════════════════════════
async function probeC(browser) {
  console.log('\n=== probe C 深链 round-trip /canvas?focus（302 → 定位 → selected）===')
  // scope：节点最多的 (proj, ep)——与 e2e discoverScope 同口径
  const projects = await listProjects()
  let best = null
  for (const p of projects) {
    for (const e of p.episodes ?? []) {
      if (!best || (e.nodeCount ?? 0) > (best.ep.nodeCount ?? 0)) best = { proj: p, ep: e }
    }
  }
  if (!best || !(best.ep.nodeCount > 0)) throw new Error('真实后端无带节点的项目/集（数据前置缺失）')
  const nodes = await loadV2(best.proj.id, best.ep.id)
  const focusNode = nodes.find(isFocusableAsset)
  if (!focusNode) throw new Error('load-v2 图无可聚焦资产节点')

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  attachConsoleWatch(page, errors)
  const qs = new URLSearchParams({
    project: String(best.proj.id),
    ep: String(best.ep.id),
    focus: focusNode.id,
  })
  // 经 /canvas 302（D-05 契约入口）——playwright 自动跟随到 /infinite-canvas/
  await page.goto(`${BASE}/canvas?${qs.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // 图就绪（无 testMode 桥——DOM 级轮询；大图首拉+布局宽限 40s）
  await page
    .locator('.react-flow__node')
    .first()
    .waitFor({ timeout: 40_000 })
  record(true, 'C: 302 后画布加载（react-flow 节点渲染）')
  record(page.url().includes('focus=' + focusNode.id), 'C: URL 留 focus 可重放', page.url().slice(0, 100))

  // 节点 selected → detail-panel 打开（既有 focusAssetNodeId effect 副作用）
  await page.locator('[data-testid="detail-panel"]').waitFor({ timeout: 30_000 })
  record(true, 'C: 目标节点 selected（detail-panel 打开）')

  // 视觉居中：DOM rect ≈ pane 中心（渲染真值，e2e 同口径）
  const tol = 200
  let dist = null
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    dist = await page.evaluate((nid) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
      const pane = document.querySelector('.react-flow')
      if (!el || !pane) return null
      const r = el.getBoundingClientRect()
      const p = pane.getBoundingClientRect()
      const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      return Math.max(Math.abs(c.x - (p.x + p.width / 2)), Math.abs(c.y - (p.y + p.height / 2)))
    }, focusNode.id)
    if (dist != null && dist <= tol) break
    await page.waitForTimeout(500)
  }
  record(dist != null && dist <= tol, `C: 目标节点视觉居中(≤${tol}px)`, `dist=${dist ?? 'null'}`)
  record(errors.length === 0, 'C: 无页面错误', errors.slice(0, 2).join(' | ') || '0 errors')
  await page.close()
}

// ═══ 主流程 ══════════════════════════════════════════════════════════════
async function main() {
  console.log(`=== Phase 57-08 portal-probe（headless 真后端 @${BASE}）===`)
  const health = await fetch(`${BASE}/health`).catch(() => null)
  if (!health?.ok) {
    console.error(`FATAL: ${BASE}/health 不可达（HTTP ${health?.status ?? '网络异常'}）——探针须真实后端`)
    process.exit(1)
  }
  const browser = await chromium.launch({ headless: true })
  try {
    await probeA(browser)
    await probeB(browser)
    await probeC(browser)
  } finally {
    await browser.close()
  }
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n=== portal-probe Summary: ${results.length - failed}/${results.length} passed, FAIL = ${failed} ===`)
  if (failed === 0) {
    console.log('✅ Phase 57-08 三 probe 全绿（A 门户首页 / B 交付页 / C 深链 round-trip）')
    process.exit(0)
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name}`)
  process.exit(1)
}

main().catch((err) => {
  console.error('portal-probe.mjs crashed:', err)
  process.exit(2)
})
