// probe-52-real.mjs — Phase 52-07 Task 3 两段式真机探针(REAL backend 10588)。
//
//   Part A 回放门(52-UAT gap#1 关闭证据):项目 1/2、2/1、2001/1、9999/1 各
//     load-v2 → 原图原样回发 save-v2 → 断言 200(修前同请求全 400)→ 回读
//     load-v2 深度比对原图(剔除 meta.updatedAt)——修复后的保存必须是 verified
//     no-op,任何字段漂移即非零 exit。
//   Part B REGEN-01 真机闭环(52-UAT gap#2 / Test 3 missing 项):9999/1 深链
//     focus=a-p04-art4 开面板 → 编辑 prompt(追加后缀)→ 保存(断言 200 +
//     无错误 toast)→ reload 往返仍显新 prompt → 点重生成 → 断言「已提交重生成」
//     toast + 节点 state running→success(node:state socket 链)→ 恢复原图 →
//     reload 验证回原值(零净足迹)。
//
// Run: node test/e2e/probe-52-real.mjs   (须先部署:build+deploy-canvas+build:server+restart)
import { chromium } from 'playwright'

const BASE = 'http://localhost:10588'
const QS = 'projectId=9999&episodesId=1&testMode=1'
const NODE_A = 'a-p04-art4' // 老林-1975(UAT 实证:有产生事件 + 902 字 prompt)
const SUFFIX = ' [52-07-verify]'
const SCOPES = [
  [1, 2], [2, 1], [2001, 1], [9999, 1],
]

const failures = []
const note = (k, ok, v) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${k}: ${v}`)
  if (!ok) failures.push(`${k}: ${v}`)
}

// ── 共用 HTTP ──
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* non-json */ }
  return { status: res.status, json }
}
const loadV2 = (projectId, episodesId) => post('/api/canvas/v2/load-v2', { projectId, episodesId })
const saveV2 = (projectId, episodesId, graph) => post('/api/canvas/v2/save-v2', { projectId, episodesId, graph })

// ── 深度比对(剔除 meta.updatedAt;键序无关) ──
function stripUpdatedAt(v, path = '') {
  if (Array.isArray(v)) return v.map(x => stripUpdatedAt(x))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      // meta.updatedAt / meta.lastEventId = save-v2 的保存簿记字段(每次保存必然
      // 变动:时间戳 + 事件序号,health-poll 靠它探变更)——非图内容,剔除;
      // 图内容(nodes/links/branches/variantGroups 及 meta 其余键)必须全等。
      if (path === 'meta' && (k === 'updatedAt' || k === 'lastEventId')) continue
      out[k] = stripUpdatedAt(v[k], path ? `${path}.${k}` : k)
    }
    return out
  }
  return v
}
function deepEqual(a, b) { return JSON.stringify(stripUpdatedAt(a)) === JSON.stringify(stripUpdatedAt(b)) }
function firstDiff(a, b, path = '') {
  if (deepEqual(a, b)) return null
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path || '(root)'}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (path === 'meta' && k === 'updatedAt') continue
    const child = path ? `${path}.${k}` : k
    if (!(k in a) || !(k in b)) return `${child}: 仅一侧存在`
    const d = firstDiff(a[k], b[k], child)
    if (d) return d
  }
  return `${path || '(root)'}: 深度不等(未定位)`
}

// ═══ Part A:4 项目回放门 + verified no-op ═══
async function partA() {
  console.log('═══ Part A: 4 项目回放门(load-v2 原图原样回发 save-v2)═══')
  for (const [pid, eid] of SCOPES) {
    const tag = `A ${pid}/${eid}`
    const l1 = await loadV2(pid, eid)
    if (l1.status !== 200) { note(tag, false, `load-v2 首读 ${l1.status}`); continue }
    const original = l1.json.data
    const nodeCount = original?.nodes?.length ?? 0
    const s = await saveV2(pid, eid, original)
    note(`${tag} save`, s.status === 200, `save-v2 HTTP ${s.status}(修前 400;nodes=${nodeCount})${s.status !== 200 ? ' — ' + JSON.stringify(s.json).slice(0, 300) : ''}`)
    if (s.status !== 200) continue
    const l2 = await loadV2(pid, eid)
    if (l2.status !== 200) { note(`${tag} 回读`, false, `load-v2 二读 ${l2.status}`); continue }
    const ok = deepEqual(original, l2.json.data)
    note(`${tag} no-op`, ok, ok ? '回读与原图深度全等(剔 meta.updatedAt)' : `漂移: ${firstDiff(original, l2.json.data)}`)
  }
}

// ═══ Part B:REGEN-01 真机闭环(捕获-恢复,零净足迹)═══
async function partB() {
  console.log('═══ Part B: REGEN-01 真机闭环(9999/1 → a-p04-art4)═══')
  // 捕获原图(恢复基线)
  const l = await loadV2(9999, 1)
  if (l.status !== 200) throw new Error(`Part B 捕获原图失败: load-v2 ${l.status}`)
  const originalGraph = l.json.data
  const originalPrompt = originalGraph.nodes
    .find(n => n.id === NODE_A)?.data?.prompt
  if (typeof originalPrompt !== 'string' || !originalPrompt) {
    throw new Error(`Part B 前置失败: ${NODE_A} 无 data.prompt(UAT 实证有 902 字 prompt,数据可能已变)`)
  }
  console.log(`  原图捕获: nodes=${originalGraph.nodes.length}, 原 prompt 长度=${originalPrompt.length}`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const saveStatuses = []
  const toastTexts = []
  page.on('response', async r => {
    if (r.url().includes('save-v2')) {
      saveStatuses.push(r.status())
      if (r.status() >= 400) { try { console.log('  (save-v2 error body:', (await r.text()).slice(0, 800), ')') } catch {} }
    }
  })
  // 采集 toast 文本(诊断 + 精确断言用)
  try {
    const openPanel = async () => {
      await page.goto(`${BASE}/infinite-canvas/?${QS}&focus=${NODE_A}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '画布', exact: true }).click()
      await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
      await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 20_000 })
      await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 10_000 })
      await page.waitForTimeout(600)
    }
    const textarea = () => page.locator('[data-testid="prompt-textarea"]')

    // B1 编辑 + 保存
    // 注:真后端 save-v2 200 后 graph:saved 广播触发整图 reload,detailPanel 随
    // setGraph 重置而收起(mock 后端无此现象)——「保存后面板保持打开」不属本探针
    // 断言范围,持久化真值由 B2 reload 往返承担(UAT Test 2 truth)。
    await openPanel()
    const newPrompt = originalPrompt + SUFFIX
    await textarea().fill(newPrompt)
    await page.locator('[data-testid="prompt-save"]').click()
    await page.waitForTimeout(3_000)
    const saveOk = saveStatuses.includes(200)
    // 诊断:保存后页面是否出现「保存失败」字样(精确词;reload 期加载类 toast 不算)。
    // 持久化真值由 B2 reload 往返承担——save 200 + B2 才是 gap#1/#2 的关闭证据。
    const saveFailText = await page.getByText(/保存(画布)?失败/).isVisible().catch(() => false)
    note('B1 保存', saveOk && !saveFailText,
      `save-v2=[${saveStatuses.join(',')}](须含 200,修前 400);保存失败toast:${saveFailText}`)

    // B2 reload 往返保真(UAT Test 2 truth)——openPanel 的 goto 即整页重载
    // (fresh page load → load-v2 → migrate §14 重建),无需再 page.reload
    await openPanel()
    const reloaded = await textarea().inputValue()
    note('B2 往返', reloaded === newPrompt, `reload 重开面板显示新 prompt:${reloaded === newPrompt}`)

    // B3 重生成:toast + 节点 running→success(UAT Test 3 missing 项)
    await page.locator('[data-testid="prompt-regenerate"]').click()
    let sawToast = false
    try { await page.waitForSelector('text=已提交重生成', { timeout: 10_000 }); sawToast = true } catch {}
    const stateSeq = []
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const st = await page.evaluate((nid) => {
        const n = window.__kaisCanvas?.getNodes()?.find(x => x.id === nid)
        return n?.data?.state ?? null
      }, NODE_A).catch(() => null)
      if (st && stateSeq[stateSeq.length - 1] !== st) stateSeq.push(st)
      if (stateSeq.includes('running') && stateSeq.includes('success')) break
      await page.waitForTimeout(400)
    }
    const sawRunning = stateSeq.includes('running')
    const sawSuccess = stateSeq.includes('success')
    note('B3 重生成', sawToast && sawRunning && sawSuccess,
      `toast=${sawToast}; state 序列=[${stateSeq.join(' → ')}](须含 running 与 success)`)
  } finally {
    // B4 恢复基线(任何情况都执行):原图回存 + reload 复核
    const r = await saveV2(9999, 1, originalGraph)
    let restored = false
    try {
      await page.goto(`${BASE}/infinite-canvas/?${QS}&focus=${NODE_A}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '画布', exact: true }).click()
      await page.waitForSelector('[data-testid="prompt-textarea"]', { timeout: 15_000 })
      await page.waitForTimeout(800)
      const finalVal = await page.locator('[data-testid="prompt-textarea"]').inputValue()
      restored = finalVal === originalPrompt
      note('B4 恢复', r.status === 200 && restored,
        `原图回存 HTTP ${r.status};reload 后 prompt 回原值:${restored}(净足迹=0)`)
    } catch (err) {
      note('B4 恢复', false, `恢复复核失败: ${err.message}(回存 HTTP ${r.status})——人工核查!`)
    }
    await browser.close()
  }
}

// ── main ──
try {
  await partA()
  await partB()
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  process.exitCode = 1
}
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项失败:`)
  for (const f of failures) console.error('  - ' + f)
  process.exitCode = 1
} else {
  console.log('\n✓ probe-52-real 全绿(Part A 回放门 + Part B REGEN-01 闭环,零净足迹)')
}
