// probe-58-real.mjs — Phase 58-04 Task 2 真机零足迹探针(REAL backend 10588)。
//
//   RECIPE-01 真机闭环(58-01..58-03 改造在 build/deploy 后真实链路的生产实证,
//   非 mock):9999/1 深链 focus=a-p04-art4(与 probe-52-real 同锚,RESEARCH
//   Open Question 3 裁定:prompt-only,生产零 steps 存量 = 纯增量无回填)开面板
//   → 展开「高级参数」(默认收起,UI-SPEC §7)→ 编辑 steps=40 / cfg=6 → 点保存
//   → 断言 save-v2 200 → wire 断言(load-v2 该节点 data.steps===40 &&
//   data.cfg===6)→ 面板 reload 往返(focus 重进 → advanced-toggle 展开 →
//   param-input-steps 值 40)。
//
//   finally 零足迹恢复(恢复即被测语义,probe-52-real Part B 模式):saveV2 POST
//   原图(捕获态)→ 复核 load-v2 后 stripUpdatedAt 深比对原图相等(净足迹 = 0;
//   新增键的删除恰好走 Plan 01 delete 传播)。
//
//   部署前置纪律(地雷 #10:10588 跑 build 产物,须 rebuild+restart):
//     cd packages/infinite-canvas && npm run build
//     → 根仓 bash scripts/deploy-canvas.sh(自带备份,dist → data/web/infinite-canvas)
//     → 根仓 npm run build:server(src/app.ts → data/serve/app.js)
//     → 重启 dev server:kill 旧 pid 后
//       NODE_ENV=production PORT=10588 setsid nohup node data/serve/app.js \
//         > data/serve/app-10588.log 2>&1 &
//   若 :10588 不可达或重启失败:输出 SKIP 理由并退出非零(RESEARCH Environment
//   Availability fallback 条款——延后探针不阻塞 verify 门,但 SUMMARY 必须记录)。
//
// Run: node test/e2e/probe-58-real.mjs   (在 packages/infinite-canvas 下)
import { chromium } from 'playwright'

const BASE = 'http://localhost:10588'
const QS = 'projectId=9999&episodesId=1&testMode=1'
const NODE_A = 'a-p04-art4' // 老林-1975(与 probe-52-real 同锚;prompt-only,生产零 steps 存量)
const NEW_STEPS = '40'
const NEW_CFG = '6'

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

// ── 深度比对(剔除 meta.updatedAt/lastEventId;键序无关) ──
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
    if (path === 'meta' && (k === 'updatedAt' || k === 'lastEventId')) continue
    const child = path ? `${path}.${k}` : k
    if (!(k in a) || !(k in b)) return `${child}: 仅一侧存在`
    const d = firstDiff(a[k], b[k], child)
    if (d) return d
  }
  return `${path || '(root)'}: 深度不等(未定位)`
}

// ═══ main:RECIPE-01 真机闭环(捕获-编辑-往返-恢复,零净足迹)═══
let browser = null
let originalGraph = null
try {
  // 前置:后端可达性(不可达 → SKIP,非假绿)
  const health = await loadV2(9999, 1)
  if (health.status !== 200) {
    console.error(`SKIP: :10588 load-v2 非 200(HTTP ${health.status})——按 RESEARCH fallback 延后探针;补跑:部署(build → deploy-canvas.sh → build:server → restart)后 node test/e2e/probe-58-real.mjs`)
    process.exit(1)
  }
  // 捕获原图(恢复基线)
  originalGraph = health.json.data
  const nodeA = originalGraph.nodes.find(n => n.id === NODE_A)
  if (!nodeA) throw new Error(`前置失败: 原图无 ${NODE_A} 节点(数据可能已变)`)
  const hadSteps = nodeA.data?.steps
  const hadCfg = nodeA.data?.cfg
  console.log(`  原图捕获: nodes=${originalGraph.nodes.length}, ${NODE_A} 原存量 steps=${hadSteps ?? '(无)'} cfg=${hadCfg ?? '(无)'}(RESEARCH 裁定:生产零 steps 存量)`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const saveStatuses = []
  page.on('response', async r => {
    if (r.url().includes('save-v2')) {
      saveStatuses.push(r.status())
      if (r.status() >= 400) { try { console.log('  (save-v2 error body:', (await r.text()).slice(0, 800), ')') } catch {} }
    }
  })

  const openPanel = async () => {
    await page.goto(`${BASE}/infinite-canvas/?${QS}&focus=${NODE_A}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '画布', exact: true }).click()
    await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
    await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 20_000 })
    await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 10_000 })
    await page.waitForTimeout(600)
  }
  // 高级参数默认收起(UI-SPEC §7)——先等 toggle,收起态才点击展开,再等控件
  const openAdvanced = async () => {
    const toggle = page.locator('[data-testid="advanced-toggle"]')
    await toggle.waitFor({ timeout: 10_000 })
    if ((await toggle.getAttribute('data-state')) === 'collapsed') await toggle.click()
    await page.waitForSelector('[data-testid="param-input-steps"]', { timeout: 10_000 })
    await page.waitForTimeout(200)
  }
  const wireNodeData = async () => {
    const l = await loadV2(9999, 1)
    if (l.status !== 200) throw new Error(`load-v2 ${l.status}`)
    return l.json.data.nodes.find(n => n.id === NODE_A)?.data ?? {}
  }

  // P1 编辑 steps/cfg + 保存(共享「保存」按钮治理整个编辑器,58-02)
  await openPanel()
  await openAdvanced()
  await page.locator('[data-testid="param-input-steps"]').fill(NEW_STEPS)
  await page.locator('[data-testid="param-input-cfg"]').fill(NEW_CFG)
  await page.locator('[data-testid="prompt-save"]').click()
  const saveDeadline = Date.now() + 30_000
  while (!saveStatuses.includes(200) && Date.now() < saveDeadline) await page.waitForTimeout(300)
  note('P1 保存', saveStatuses.includes(200), `save-v2=[${saveStatuses.join(',')}](须含 200)`)

  // P2 wire 断言(RECIPE-01 服务端真值:serialize 九键写回 → DB data 袋)
  let wdata = await wireNodeData()
  const wDeadline = Date.now() + 10_000
  while ((wdata.steps !== Number(NEW_STEPS) || wdata.cfg !== Number(NEW_CFG)) && Date.now() < wDeadline) {
    await page.waitForTimeout(400)
    wdata = await wireNodeData()
  }
  note('P2 wire', wdata.steps === 40 && wdata.cfg === 6, `load-v2 ${NODE_A} data.steps=${wdata.steps} data.cfg=${wdata.cfg}(须 40/6)`)

  // P3 面板 reload 往返:openPanel 的 goto 即整页重载(fresh load-v2 → migrate
  // 全集提取 → 面板显示)——高级字段不回退 = migrate 窄通道解除的真机证明
  await openPanel()
  await openAdvanced()
  const reSteps = await page.locator('[data-testid="param-input-steps"]').inputValue()
  const reCfg = await page.locator('[data-testid="param-input-cfg"]').inputValue()
  note('P3 面板往返', reSteps === NEW_STEPS && reCfg === NEW_CFG, `reload 重开面板 steps=${reSteps} cfg=${reCfg}(须 ${NEW_STEPS}/${NEW_CFG})`)
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  failures.push(`probe crash: ${err.message}`)
} finally {
  // P4 零足迹恢复(任何情况都执行;恢复即被测语义):原图回存 → load-v2 复核
  // stripUpdatedAt 深比对(净足迹 = 0;新增 steps/cfg 的删除恰好走 Plan 01
  // delete 传播——原图无该键,回存后键消失)
  if (browser) { try { await browser.close() } catch {} }
  if (!originalGraph) {
    console.error('P4 恢复: 无捕获原图可恢复(前置失败)——人工核查!')
    failures.push('P4 恢复: 无捕获原图')
  } else {
    try {
      const r = await saveV2(9999, 1, originalGraph)
      let restored = false
      let diff = ''
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const l = await loadV2(9999, 1)
        if (l.status === 200) {
          restored = deepEqual(originalGraph, l.json.data)
          if (!restored) diff = firstDiff(originalGraph, l.json.data) ?? ''
          if (restored) break
        }
        await new Promise(res => setTimeout(res, 500))
      }
      note('P4 恢复', r.status === 200 && restored,
        `原图回存 HTTP ${r.status};load-v2 深比对原图:${restored ? '全等(剔 meta.updatedAt,净足迹=0)' : '漂移 → ' + diff}`)
    } catch (err) {
      note('P4 恢复', false, `恢复复核失败: ${err.message}——人工核查!`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项失败:`)
  for (const f of failures) console.error('  - ' + f)
  process.exitCode = 1
} else {
  console.log('\n✓ probe-58-real 全绿(RECIPE-01 真机编辑往返保真 + 零足迹恢复)')
}
