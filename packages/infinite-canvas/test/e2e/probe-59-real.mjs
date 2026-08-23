// probe-59-real.mjs — Phase 59-04 Task 2 真机零足迹探针(REAL backend 10588)。
//
//   STALE-01/02 真机级联实证 + SC3 真机负向(59-01..59-03 改造在 build/deploy 后
//   真实链路的生产实证,非 mock):
//     段一(级联):loadV2 选真项目真 episodes,找 type 命中 NODE_TYPE_TO_TASK_TYPE
//     映射表且存在 ≥1 下游节点的触发资产(优先 asset/storyboard/global,最小下游
//     集优先)→ POST /api/canvas/execute { ..., regenSource: "panel-regen" } →
//     轮询 load-v2(≤180s,2s 间隔)直到任一下游节点 data.stale 出现 → 断言
//     stale.triggerAssetId === 触发节点 id、三字段齐全(since number /
//     triggerAssetId·triggerEventId string)。同时记录触发节点 data.filePath
//     是否落库(引擎路径被走到时应有——A1 真机证据;GOLD_TEAM_URL 未配置的环境
//     落 simulateOnly,探针打印实际路径并如实记录)。
//     段二(SC3 真机负向):另选无下游映射节点(或同节点二次)POST execute
//     **不带 regenSource** → 等 node:state 完成(socket.io-client 直收)→ 断言
//     data.stale 新增行数为 0(与段一后的 stale 集合全等)。
//
//   finally 零足迹恢复(恢复即被测语义,probe-52/58-real 模式):saveV2 POST 原图
//   (捕获态)→ 复核 load-v2 后 stripUpdatedAt 深比对原图相等(净足迹 = 0;
//   firstDiff 输出首个差异点)。引擎侧产生的任务文件(:8002 output)非画布足迹,
//   本环境 GOLD_TEAM_URL 未配置走 simulateOnly,如实记录;若在引擎配置环境跑出
//   filePath,仅记录该 /oss/ 路径,不清理引擎输出。
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
// Run: node test/e2e/probe-59-real.mjs   (在 packages/infinite-canvas 下)
import { io } from 'socket.io-client'

const BASE = 'http://localhost:10588'
// 探测序(2026-08-24 实测):
//   2/1 —— 31 节点 demo 图,类型 [asset,audio,script,storyboard,video] 全部
//          migrate 支持,候选 n-p08/n-p04-character-* 等(下游 4-9);
//   2001/1 —— 31 节点,类型全支持,最小候选 a-scene-6(下游 3)。
//   注:1/2(p10_images→p11_video 爆炸半径最小)**不可用**——其图含 'phase' 型
//   节点,migrateV2toV3 planNode 对不支持类型 throw → markStaleAndBroadcast 在
//   migrate 阶段即失败(execute.ts try/catch 仅 console.error,任务仍 success、
//   零 stale 写)——legacy 图级联结构性失效是真机实测发现,如实记录(SUMMARY);
//   该图同样无法被 V3 客户端加载(migrate 同一函数),非本 phase 回归。
const SCOPES = [[2, 1], [2001, 1]]
// _simulate.ts NODE_TYPE_TO_TASK_TYPE 键集(script 短路模拟;mix/composite 有意
// 不进表——A2 裁定)。probe 只挑映射命中的节点,保证引擎路径(若配置)会被走到。
const MAPPED = new Set(['asset', 'storyboard', 'global', 'keyframe', 'voice', 'foley', 'bgm', 'video'])
// migrate planNode 支持的 V2 类型全集(migrate.ts case 表)——选 scope 前全图校验,
// 混入不支持类型(如 'phase')的 legacy 图 markStaleAndBroadcast 会结构性 throw。
const MIGRATE_SUPPORTED = new Set([
  'script', 'storyboard', 'keyframe', 'video', 'voice', 'foley', 'bgm', 'global',
  'mix', 'composite', 'asset', 'audio', 'scene_image', 'upscale', 'face_restore',
  'variant', 'reference',
])
const PREFERRED = ['asset', 'storyboard', 'global']

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

// ── 深度比对(剔除 meta.updatedAt/lastEventId;键序无关;probe-58-real 同款) ──
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

// ── 图分析:下游集合(镜像 59-02 级联遍历的 V2 侧形状:sequence/variant 边不进,
//    locked 资产为传播终点;mock/服务端语义真值在各自断言,这里只做探测选点) ──
function downstreamOf(graph, startId) {
  const links = graph?.links ?? []
  const nodeById = new Map((graph?.nodes ?? []).map((n) => [n.id, n]))
  const adj = new Map()
  for (const l of links) {
    if (l.dataType === 'sequence' || l.dataType === 'variant') continue
    if (!adj.has(l.source)) adj.set(l.source, new Set())
    adj.get(l.source).add(l.target)
  }
  const seen = new Set()
  const queue = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const t of adj.get(cur) ?? []) {
      if (seen.has(t)) continue
      seen.add(t)
      // locked 资产是传播终点(计入但不越过——与服务端 markStaleDownstream §13 一致)
      if (nodeById.get(t)?.data?.curation === 'locked') continue
      queue.push(t)
    }
  }
  seen.delete(startId)
  return [...seen].filter((id) => nodeById.has(id) && nodeById.get(id).type !== 'eventChip' && !String(id).startsWith('evt_'))
}

// extractPrompt 镜像(_simulate.ts 同链:prompt/text/description/data.prompt)
function extractPrompt(node) {
  if (typeof node.prompt === 'string') return node.prompt
  if (typeof node.text === 'string') return node.text
  if (typeof node.description === 'string') return node.description
  if (node.data && typeof node.data.prompt === 'string') return node.data.prompt
  return ''
}

// 选触发节点:映射命中的类型 + ≥1 下游;preferred 类型优先,下游集最小者优先
function pickTrigger(graph) {
  const cands = []
  for (const n of graph?.nodes ?? []) {
    if (!MAPPED.has(n.type)) continue
    const down = downstreamOf(graph, n.id)
    if (down.length >= 1) cands.push({ node: n, down })
  }
  if (cands.length === 0) return null
  cands.sort((a, b) => {
    const pa = PREFERRED.indexOf(a.node.type); const pb = PREFERRED.indexOf(b.node.type)
    const va = pa === -1 ? 99 : pa; const vb = pb === -1 ? 99 : pb
    return va !== vb ? va - vb : a.down.length - b.down.length
  })
  return cands[0]
}

// 选 SC3 负向节点:映射命中 + 零下游(无则 null → 同节点二次)
function pickNoDownstream(graph, excludeId) {
  return (graph?.nodes ?? []).find(
    (n) => n.id !== excludeId && MAPPED.has(n.type) && n.type !== 'eventChip' && !String(n.id).startsWith('evt_')
      && downstreamOf(graph, n.id).length === 0,
  ) ?? null
}

const staleIdsOf = (graph) => (graph?.nodes ?? []).filter((n) => n.data?.stale != null).map((n) => n.id).sort()

// ═══ main:级联实证 + SC3 真机负向(捕获-改-断言-恢复,零净足迹)═══
let socket = null
let originalGraph = null
let scope = null
const socketEvents = []
try {
  // 前置:逐 scope 探测可达性与触发候选(不可达 → SKIP,非假绿)
  for (const [pid, eid] of SCOPES) {
    const l = await loadV2(pid, eid)
    if (l.status !== 200) { console.log(`  scope ${pid}/${eid}: load-v2 HTTP ${l.status},跳过`); continue }
    const unsupported = (l.json.data.nodes ?? []).some((n) => !MIGRATE_SUPPORTED.has(n.type))
    if (unsupported) { console.log(`  scope ${pid}/${eid}: 含 migrate 不支持的 V2 节点类型(markStaleAndBroadcast 会结构性 throw),跳过`); continue }
    const t = pickTrigger(l.json.data)
    if (!t) { console.log(`  scope ${pid}/${eid}: 无映射命中且带下游的触发候选,跳过`); continue }
    scope = { pid, eid, graph: l.json.data, trigger: t }
    break
  }
  if (!scope) {
    console.error('SKIP: :10588 不可达(load-v2 非 200)或无可用触发候选——按 RESEARCH fallback 延后探针;补跑:部署(build → deploy-canvas.sh → build:server → restart)后 node test/e2e/probe-59-real.mjs')
    process.exit(1)
  }
  originalGraph = scope.graph
  const trig = scope.trigger.node
  const prompt = extractPrompt(trig)
  console.log(`  选定 scope ${scope.pid}/${scope.eid}: 触发=${trig.id}(type=${trig.type}, prompt ${prompt.length} 字) 下游=[${scope.trigger.down.join(', ')}]`)

  // socket 直收(:10588 /ws/projects,room=project:{id})——段二完成信号 + 事件证据
  socket = io(`${BASE}/ws/projects`, { query: { projectId: String(scope.pid) }, transports: ['websocket', 'polling'] })
  socket.onAny((event, data) => {
    if (event === 'node:state' || event === 'node:updated') {
      socketEvents.push({ t: Date.now(), event, nodeId: data?.nodeId ?? data?.node?.id ?? '?', state: data?.state ?? '', changedFields: (data?.changedFields ?? []).join(',') })
    }
  })
  await new Promise((resolve) => { socket.on('connect', resolve); setTimeout(resolve, 3_000) })

  const preStale = staleIdsOf(originalGraph)
  console.log(`  原图捕获: nodes=${originalGraph.nodes.length}, 既有 stale=[${preStale.join(',') || '无'}]`)

  // ── 段一:窄路径 regen 级联实证(panel-regen)──
  const s1Start = Date.now()
  const execBody = {
    projectId: scope.pid, episodesId: scope.eid,
    nodeId: trig.id, nodeType: trig.type,
    regenSource: 'panel-regen',
  }
  if (prompt) execBody.prompt = prompt
  const s1 = await post('/api/canvas/execute', execBody)
  if (s1.status !== 200) note('段一 提交', false, `execute HTTP ${s1.status}: ${JSON.stringify(s1.json).slice(0, 200)}`)

  // 轮询 load-v2(≤180s,2s):任一下游出现 data.stale(新写入)
  let hit = null
  const deadline = Date.now() + 180_000
  while (!hit && Date.now() < deadline) {
    const l = await loadV2(scope.pid, scope.eid)
    if (l.status === 200) {
      const fresh = (l.json.data.nodes ?? []).filter((n) => n.data?.stale != null && !preStale.includes(n.id))
      if (fresh.length > 0) hit = fresh[0]
    }
    if (!hit) await new Promise((r) => setTimeout(r, 2_000))
  }
  if (!hit) {
    note('段一 级联', false, `180s 内下游未出现 data.stale(引擎/simulate 执行链未完成或级联未触发;socket 事件 ${socketEvents.length} 条)`)
  } else {
    const elapsed = ((Date.now() - s1Start) / 1000).toFixed(1)
    const st = hit.data.stale
    note('段一 级联', true, `${elapsed}s 后 ${hit.id} 出现 data.stale`)
    note('段一 triggerAssetId', st.triggerAssetId === trig.id,
      `stale.triggerAssetId=${st.triggerAssetId}(须 === 触发节点 ${trig.id})`)
    note('段一 三字段', typeof st.since === 'number' && typeof st.triggerAssetId === 'string' && typeof st.triggerEventId === 'string',
      `since=${st.since}(${typeof st.since}) triggerEventId=${st.triggerEventId}`)
    note('段一 下游成员', scope.trigger.down.includes(hit.id), `${hit.id} ∈ 预期下游集 [${scope.trigger.down.join(', ')}]`)
    // node:updated 契约事件实证(59-02 广播)
    const updated = socketEvents.filter((e) => e.event === 'node:updated' && e.nodeId === hit.id)
    note('段一 node:updated', updated.length >= 1,
      `socket 收到 ${updated.length} 条 ${hit.id} 的 node:updated${updated[0] ? `(changedFields=${updated[0].changedFields})` : ''}`)
  }
  // A1 真机证据判定:filePath 与原图快照比较——**只有本次新增**才算引擎路径产物
  // 落库;存量 filePath(如 pipeline-runs 绝对路径)不是本次执行的证据,不得误报。
  const trigFilePathBefore = trig.data?.filePath ?? null
  const lPost = await loadV2(scope.pid, scope.eid)
  const trigPost = lPost.json?.data?.nodes?.find((n) => n.id === trig.id)
  const filePath = trigPost?.data?.filePath ?? null
  const engineWrote = filePath != null && filePath !== trigFilePathBefore
  console.log(`  [INFO] 触发节点 data.filePath=${filePath ?? '(null)'}(原图快照=${trigFilePathBefore ?? '(null)'}) —— ${engineWrote ? '本次新增:引擎路径产物已落库(A1 真机证据)' : '本次未新增(GOLD_TEAM_URL 未配置 → simulateOnly,或引擎无 output;计划内合法降级,如实记录)'}`)

  // ── 段二:SC3 真机负向(无标记 execute,ContextMenu 形状)──
  const afterS1 = staleIdsOf(lPost.json.data)
  const negNode = pickNoDownstream(originalGraph, trig.id) ?? trig // 无候选则同节点二次
  const s2 = await post('/api/canvas/execute', {
    projectId: scope.pid, episodesId: scope.eid,
    nodeId: negNode.id, nodeType: negNode.type,
    ...(extractPrompt(negNode) ? { prompt: extractPrompt(negNode) } : {}),
    // 故意不带 regenSource —— ContextMenu 路径形状
  })
  if (s2.status !== 200) note('段二 提交', false, `execute HTTP ${s2.status}`)
  // 等完成:socket node:state success/error(simulateOnly 5-15s;引擎路径更长)
  const s2Deadline = Date.now() + 120_000
  while (Date.now() < s2Deadline) {
    const done = socketEvents.some((e) => e.event === 'node:state' && e.nodeId === negNode.id && (e.state === 'success' || e.state === 'error'))
    if (done) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const s2Done = socketEvents.find((e) => e.event === 'node:state' && e.nodeId === negNode.id && (e.state === 'success' || e.state === 'error'))
  if (!s2Done) console.log('  [WARN] 段二完成事件未在 120s 内收到(socket 视角)——按时限后快照断言兜底')
  else console.log(`  段二 ${negNode.id}(type=${negNode.type}) 无标记 execute → node:state ${s2Done.state}`)
  await new Promise((r) => setTimeout(r, 1_500))
  const lS2 = await loadV2(scope.pid, scope.eid)
  const afterS2 = staleIdsOf(lS2.json.data)
  const newRows = afterS2.filter((id) => !afterS1.includes(id))
  note('段二 零新增(SC3 真机负向)', newRows.length === 0,
    `无标记 execute ${s2Done ? `完成(state=${s2Done.state})` : '超时快照'} 后 stale 集合 [${afterS2.join(',')}] 新增 ${newRows.length} 行(须 0)`)
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  failures.push(`probe crash: ${err.message}`)
} finally {
  // 恢复:原图回存 → load-v2 复核 stripUpdatedAt 深比对(净足迹 = 0)
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
        `原图回存 HTTP ${r.status};load-v2 深比对原图:${restored ? '全等(剔 meta.updatedAt,净足迹=0)' : '漂移 → ' + diff}`)
    } catch (err) {
      note('恢复(净足迹)', false, `恢复复核失败: ${err.message}——人工核查!`)
    }
  }
}

console.log(`\n  socket 事件摘要: ${socketEvents.length} 条(node:state/node:updated;引擎侧任务文件(:8002 output)非画布足迹,本环境 GOLD_TEAM_URL 未配置 → simulateOnly,无引擎侧产物)`)
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项失败:`)
  for (const f of failures) console.error('  - ' + f)
  process.exitCode = 1
} else {
  console.log('\n✓ probe-59-real 全绿(窄路径 regen 级联真机实证 + SC3 真机负向 + 零足迹恢复)')
}
