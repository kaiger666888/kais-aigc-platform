// probe-60-real.mjs — Phase 60-05 Task 2 真机零足迹探针(REAL backend :10588)。
//
//   PANEL-01 真机收口(D-10): SC3 的真机侧半边——mock 侧行为(60-04 四用例)
//   在真机逐 note 复证:
//     段一(协议段,无浏览器): saveV2 原图 + savedBy:'tab_probe60' → 等
//     graph:saved 广播(≤5s)→ payload.savedBy === 'tab_probe60'(真机回显
//     契约);再 saveV2 原图不带 savedBy → 等广播 → payload 无 savedBy 键
//     (他端形状——kmc pipeline 等既有调用方的兼容面,60-02 条件展开语义)。
//     段二(真浏览器段): playwright.chromium 直连 :10588 已部署 dist
//     (?projectId&episodesId&testMode=1 桥挂载前提,helpers.loadCanvas 同型;
//     不走 playwright.config 的 :9876 baseURL)→ 切画布视图 → 选视口内资产
//     节点 dblclick 开面板 → 记标题/锚 id/装 toast spy(60-04 MutationObserver
//     同款)/记 load-v2 响应计数 → 点工具栏「保存」→ waitForResponse save-v2
//     断言 200 且 postData.savedBy 匹配 /^tab_/(真机客户端身份上 wire)→
//     等 1500ms(回声)→ 断言: 面板仍可见/标题不变/锚 id 不变/__toastLog 空
//     (两条 reload toast 精确串零命中)/load-v2 响应计数不变(零 reload,
//     PANEL-01 决定性真机信号)。
//
//   finally 零足迹恢复(恢复即被测语义,probe-59-real 范式): saveV2 原图回存 →
//   ≤15s 轮询 load-v2,stripUpdatedAt 深比对全等 + firstDiff 诊断(净足迹=0;
//   footprint 失败 → note FAIL → exitCode 1)。两次探针性保存均回存原图内容
//   (T-60-08 mitigate);浏览器段保存为当前已部署真相的序列化往返,无破坏性
//   操作(T-60-10 accept)。
//
//   部署前置纪律(地雷 #10:10588 跑 build 产物,须 rebuild+restart;真机探针
//   依赖 60-02 savedBy 代码已部署——协议段断言的就是部署产物行为):
//     cd packages/infinite-canvas && npm run build
//     → 根仓 bash scripts/deploy-canvas.sh(自带备份,dist → data/web/infinite-canvas)
//     → 根仓 npm run build:server(src/app.ts → data/serve/app.js)
//     → 重启 :10588:kill 旧 pid 后
//       NODE_ENV=production PORT=10588 setsid nohup node data/serve/app.js \
//         > data/serve/app-10588.log 2>&1 &
//     → health check: curl http://localhost:10588/api/canvas/v2/health
//   若 :10588 不可达且重启失败:输出 SKIP 理由并退出非零(RESEARCH fallback
//   条款——延后探针不阻塞 verify 门,但 SUMMARY 必须记录补跑命令)。
//
// Run: node test/e2e/probe-60-real.mjs   (在 packages/infinite-canvas 下)
import { io } from 'socket.io-client'
import { chromium } from 'playwright'

const BASE = 'http://localhost:10588'
// probe-59-real / diagnose-60-roundtrip 同款探测序(2026-08-24 实测 load-v2 200,
// 类型全集 migrate 支持): 2/1=31 节点, 2001/1=31 节点。
const SCOPES = [[2, 1], [2001, 1]]
// migrate planNode 支持的 V2 类型全集(migrate.ts case 表)——选 scope 前全图校验
// (混入不支持类型的图 V3 客户端同样不可加载,59-04/probe-59 同款守卫)。
const MIGRATE_SUPPORTED = new Set([
  'script', 'storyboard', 'keyframe', 'video', 'voice', 'foley', 'bgm', 'global',
  'mix', 'composite', 'asset', 'audio', 'scene_image', 'upscale', 'face_restore',
  'variant', 'reference',
])

// 两条 reload toast 精确串(FlowCanvas.tsx onGraphSaved / health-poll,ASCII 逗号)
const TOAST_OTHER_CLIENT = 'Pipeline 同步了新数据,正在刷新画布…'
const TOAST_HEALTH_FALLBACK = '检测到 pipeline 远端更新,正在刷新画布…'

const failures = []
const note = (k, ok, v) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${k}: ${v}`)
  if (!ok) failures.push(`${k}: ${v}`)
}

// ── 共用 HTTP(probe-59-real 同款) ──
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
const saveV2 = (projectId, episodesId, graph, savedBy) =>
  post('/api/canvas/v2/save-v2', savedBy != null
    ? { projectId, episodesId, graph, savedBy }
    : { projectId, episodesId, graph })

// ── 深度比对(剔除 meta.updatedAt/lastEventId;键序无关;probe-58/59 同款) ──
function stripUpdatedAt(v, path = '') {
  if (Array.isArray(v)) return v.map(x => stripUpdatedAt(x))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      // meta.updatedAt / meta.lastEventId = save-v2 的保存簿记字段——非图内容,剔除。
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

const isEvt = (n) => String(n.id).startsWith('evt_') || n.type === 'eventChip'

// ═══ main:协议段(savedBy 回显契约)+ 真浏览器段(PANEL-01)═══
let socket = null
let browser = null
let originalGraph = null
let scope = null
try {
  // 前置:逐 scope 探测可达性与 V3 可加载性(不可达 → SKIP,非假绿)
  for (const [pid, eid] of SCOPES) {
    let l
    try { l = await loadV2(pid, eid) } catch (err) { console.log(`  scope ${pid}/${eid}: load-v2 fetch 失败(${err.message}),跳过`); continue }
    if (l.status !== 200 || l.json?.code !== 200) { console.log(`  scope ${pid}/${eid}: load-v2 HTTP ${l.status} code=${l.json?.code},跳过`); continue }
    const unsupported = (l.json.data.nodes ?? []).some((n) => !MIGRATE_SUPPORTED.has(n.type))
    if (unsupported) { console.log(`  scope ${pid}/${eid}: 含 migrate 不支持的 V2 节点类型,跳过`); continue }
    if ((l.json.data.nodes ?? []).length === 0) { console.log(`  scope ${pid}/${eid}: 空图,跳过`); continue }
    scope = { pid, eid, graph: l.json.data }
    break
  }
  if (!scope) {
    console.error('SKIP: :10588 不可达(load-v2 非 200)或无 V3 可加载的非空 scope——按 RESEARCH fallback 延后探针;补跑:部署(build → deploy-canvas.sh → build:server → NODE_ENV=production PORT=10588 restart)后 node test/e2e/probe-60-real.mjs')
    process.exit(1)
  }
  originalGraph = scope.graph
  const pid = scope.pid
  const eid = scope.eid
  console.log(`  选定 scope ${pid}/${eid}: nodes=${originalGraph.nodes.length}(非 evt ${originalGraph.nodes.filter((n) => !isEvt(n)).length}),links=${(originalGraph.links ?? []).length}`)

  // socket 直收(:10588 /ws/projects,room=project:{id})——段一回显断言证据面
  const savedEvents = []
  socket = io(`${BASE}/ws/projects`, { query: { projectId: String(pid) }, transports: ['websocket', 'polling'] })
  socket.on('graph:saved', (payload) => { savedEvents.push({ ...payload, __t: Date.now() }) })
  await new Promise((resolve) => { socket.on('connect', resolve); setTimeout(resolve, 3_000) })

  // 等「第 fromIdx 条之后」的本 scope graph:saved(≤5s)
  const waitSaved = (fromIdx, timeoutMs = 5_000) => new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      for (let i = fromIdx; i < savedEvents.length; i++) {
        if (savedEvents[i].projectId === pid && savedEvents[i].episodesId === eid) return resolve(savedEvents[i])
      }
      if (Date.now() > deadline) return resolve(null)
      setTimeout(check, 100)
    }
    check()
  })

  // ── 段一(协议段): savedBy 真机回显契约 ──
  console.log('\n── 段一 协议段: save-v2 带/不带 savedBy 的广播回显(服务端契约)──')
  let idx = savedEvents.length
  const save1 = await saveV2(pid, eid, originalGraph, 'tab_probe60')
  const ev1 = await waitSaved(idx)
  note('段一 保存(带身份)', save1.status === 200 && save1.json?.code === 200, `save-v2 HTTP ${save1.status} code=${save1.json?.code}`)
  note('段一 回显(savedBy=tab_probe60)',
    ev1 != null && ev1.savedBy === 'tab_probe60',
    ev1 ? `广播 payload.savedBy=${JSON.stringify(ev1.savedBy)}(须 === 'tab_probe60')` : '5s 内未收到 graph:saved 广播')

  idx = savedEvents.length
  const save2 = await saveV2(pid, eid, originalGraph)
  const ev2 = await waitSaved(idx)
  note('段一 保存(不带身份)', save2.status === 200 && save2.json?.code === 200, `save-v2 HTTP ${save2.status} code=${save2.json?.code}`)
  note('段一 回显(无 savedBy 键)',
    ev2 != null && !('savedBy' in ev2),
    ev2 ? `广播 payload 键=[${Object.keys(ev2).filter((k) => !k.startsWith('__')).join(',')}](${'savedBy' in ev2 ? '含 savedBy——他端形状被破坏,kmc 兼容面回归!' : '无 savedBy——他端形状,与改造前逐键一致'})` : '5s 内未收到 graph:saved 广播')

  // ── 段二(真浏览器段): PANEL-01 面板保持 + 静默 + 零 reload ──
  console.log('\n── 段二 真浏览器段: 保存 → 面板保持/静默/零 reload(PANEL-01 真机)──')
  browser = await chromium.launch()
  const page = await browser.newPage()
  // load-v2 响应计数(零 reload 最硬信号)——注册须先于 goto,含首载
  let loadV2Responses = 0
  page.on('response', (r) => { if (r.url().includes('/api/canvas/v2/load-v2')) loadV2Responses += 1 })
  await page.goto(`${BASE}/infinite-canvas/?projectId=${pid}&episodesId=${eid}&testMode=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // 切画布视图(2026-08-02 起默认视图是资产管理中心;helpers.loadCanvas 同款)
  await page.getByRole('button', { name: '画布', exact: true }).click({ timeout: 10_000 })
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0, { timeout: 10_000 })
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 })
  await page.waitForTimeout(500) // 等 socket 就绪与初始渲染稳定

  // 选 dblclick 目标:视口内的首个资产节点(非 evt_;持久化 viewport 存在时
  // fitView 被跳过——P17,不在视口的节点真实鼠标点击不可达,故选视口内节点)
  const targetId = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')]
    const inView = nodes.find((el) => {
      const id = el.getAttribute('data-id') ?? ''
      if (id.startsWith('evt_')) return false
      const r = el.getBoundingClientRect()
      return r.width > 10 && r.x >= 0 && r.y >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
    })
    if (inView) return { id: inView.getAttribute('data-id'), mode: 'real-dblclick' }
    // 兜底:视口内无资产节点(极端 viewport)→ 合成 dblclick 事件(React 根委托,
    // onNodeDoubleClick 同链触发);如实记录模式
    const any = nodes.find((el) => !(el.getAttribute('data-id') ?? '').startsWith('evt_'))
    return any ? { id: any.getAttribute('data-id'), mode: 'synthetic-dispatch' } : { id: null, mode: 'none' }
  })
  if (!targetId.id) {
    note('段二 目标节点', false, '画布无可 dblclick 的资产节点(非 evt)')
  } else {
    console.log(`  目标节点 ${targetId.id}(交互模式: ${targetId.mode})`)
    if (targetId.mode === 'real-dblclick') {
      await page.locator(`.react-flow__node[data-id="${targetId.id}"]`).dblclick()
    } else {
      await page.evaluate((nid) => {
        document.querySelector(`.react-flow__node[data-id="${nid}"]`)
          ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      }, targetId.id)
    }
    await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 8_000 })
    console.log('  面板已开')

    // 页内 toast spy(60-04 MutationObserver 同款;T-60-06 accept: 只读 DOM 零 store 写)
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

    // 面板标题 span(60-04 同款结构:面板容器 div.first → span.nth(1))
    const panelTitleLoc = page.locator('[data-testid="detail-panel"]').locator('div').first().locator('span').nth(1)
    const titleBefore = (await panelTitleLoc.innerText({ timeout: 5_000 })).trim()
    const anchorBefore = await page.evaluate(() => window.__kaisCanvas?.getDetailNode()?.id ?? null)
    console.log(`  面板: 标题="${titleBefore}" 锚 id=${anchorBefore}`)
    note('段二 面板锚开点', anchorBefore === targetId.id, `getDetailNode().id=${anchorBefore}(dblclick 目标 ${targetId.id})`)

    // 工具栏保存按钮(top-left Panel;面板 PromptSection 另有同名「保存」,60-04 同款收窄)
    const saveBtn = page.locator('.react-flow__panel.top.left').getByRole('button', { name: '保存', exact: true })
    const loadV2Before = loadV2Responses

    const respPromise = page.waitForResponse((r) => r.url().includes('/api/canvas/v2/save-v2'), { timeout: 30_000 })
    await saveBtn.click()
    const resp = await respPromise
    let savedByWire = null
    try { savedByWire = JSON.parse(resp.request().postData() ?? 'null')?.savedBy ?? null } catch { /* non-json */ }
    note('段二 保存 200', resp.status() === 200, `save-v2 HTTP ${resp.status()}`)
    note('段二 savedBy 上 wire', typeof savedByWire === 'string' && /^tab_/.test(savedByWire),
      `postData.savedBy=${JSON.stringify(savedByWire)}(须 /^tab_/ 开头——真机客户端身份)`)

    // 等 1500ms(回声: 真机 broadcast 先于 HTTP 响应,到早到晚均覆盖)+ 余量
    await page.waitForTimeout(1500)

    // PANEL-01 五条真机断言
    const panelCount = await page.locator('[data-testid="detail-panel"]').count()
    note('段二 面板保持', panelCount === 1 && (await page.locator('[data-testid="detail-panel"]').isVisible()),
      `detail-panel count=${panelCount}(保存后仍可见)`)
    const titleAfter = panelCount === 1 ? (await panelTitleLoc.innerText()).trim() : '(面板已收起)'
    note('段二 标题不变', titleAfter === titleBefore, `"${titleAfter}"(保存前 "${titleBefore}")`)
    const anchorAfter = await page.evaluate(() => window.__kaisCanvas?.getDetailNode()?.id ?? null)
    note('段二 锚 id 不变', anchorAfter === anchorBefore, `getDetailNode().id=${anchorAfter}(保存前 ${anchorBefore})`)
    const toastLog = await page.evaluate(() => [...(window.__toastLog ?? [])])
    note('段二 静默(零 toast)', toastLog.length === 0,
      toastLog.length === 0 ? '两条 reload toast 精确串零命中(D-05)' : `命中: ${toastLog.join(' | ')}`)
    note('段二 零 reload', loadV2Responses === loadV2Before,
      `load-v2 响应计数 保存前=${loadV2Before} 保存后=${loadV2Responses}(须相等——PANEL-01 决定性真机信号)`)
  }
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  failures.push(`probe crash: ${err.message}`)
} finally {
  // 恢复:关浏览器与 socket → 原图回存 → load-v2 复核 stripUpdatedAt 深比对(净足迹=0)
  if (browser) { try { await browser.close() } catch { /* already closed */ } }
  if (socket) { try { socket.close() } catch { /* already closed */ } }
  if (!originalGraph || !scope) {
    if (!originalGraph) { console.error('恢复: 无捕获原图可恢复(前置失败)'); failures.push('恢复: 无捕获原图') }
  } else {
    try {
      const r = await saveV2(scope.pid, scope.eid, originalGraph)
      let restored = false
      let diff = ''
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const l = await loadV2(scope.pid, scope.eid)
        if (l.status === 200) {
          restored = deepEqual(originalGraph, l.json.data)
          if (!restored) diff = firstDiff(originalGraph, l.json.data) ?? ''
          if (restored) break
        }
        await new Promise((res) => setTimeout(res, 500))
      }
      note('恢复(净足迹)', r.status === 200 && restored,
        `原图回存 HTTP ${r.status};load-v2 深比对原图:${restored ? '全等(剔 meta.updatedAt/lastEventId,净足迹=0)' : '漂移 → ' + diff}`)
    } catch (err) {
      note('恢复(净足迹)', false, `恢复复核失败: ${err.message}——人工核查!`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项失败:`)
  for (const f of failures) console.error('  - ' + f)
  process.exitCode = 1
} else {
  console.log('\n✓ probe-60-real 全绿(savedBy 真机回显契约 + PANEL-01 面板保持/静默/零 reload + 零足迹恢复)')
}
