// probe-66-poweron.mjs — Phase 66 (PWR-03) 真机通电探针(REAL 10588 + 引擎 8002)。
//
// 验证 review F01 修复后的完整链路(此前 :10588 无 GOLD_TEAM_URL,重生成恒
// simulateOnly 假成功——有 success 无产物):
//   1. 捕获 9999/1 全图(load-v2,零足迹恢复基线——59-02 的 stale 级联会波及
//      下游节点 data.stale,仅恢复锚点节点不够,必须全图恢复)
//   2. 经 kap execute 路由真实重生成锚点节点 a-p04-art4(与 probe-52/58 同锚,
//      nodeType=global,同 prompt 重生成)
//   3. 断言引擎侧出现 canvas-a-p04-art4-* 任务且 completed(GET :8002/api/v1/tasks)
//   4. 断言节点 data.filePath 更新为新产物(/oss/ 前缀)
//   5. save-v2 恢复捕获图 → 复核 load-v2 锚点 filePath 回到原值(净足迹=0;
//      引擎任务记录与 /mnt/agents/output 产物文件保留——那是本探针要的证据)
//
// 前置:scripts/serve-production.sh 已带 GOLD_TEAM_URL 启动(启动日志含
// 「[引擎通道]: GOLD_TEAM_URL=…」);引擎容器 :8002 healthy。
// Run: node test/e2e/probe-66-poweron.mjs   (在 packages/infinite-canvas 下)

const KAP = 'http://localhost:10588'
const ENG = 'http://127.0.0.1:8002'
const projectId = 9999
const episodesId = 1
const NODE_ID = 'a-p04-art4' // 与 probe-52-real / probe-58-real 同锚

const failures = []
const note = (k, ok, v) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${k}: ${v}`)
  if (!ok) failures.push(`${k}: ${v}`)
}
const post = async (base, path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`)
  return j
}

async function loadGraph() {
  const j = await post(KAP, '/api/canvas/v2/load-v2', { projectId, episodesId })
  return j?.data ?? null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // ── 0. 前置健康 ──
  const engHealth = await fetch(`${ENG}/health`).then((r) => r.ok).catch(() => false)
  note('引擎 :8002 健康', engHealth, engHealth ? 'ok' : '不可达')
  if (!engHealth) process.exit(1)

  // ── 1. 捕获基线 ──
  const before = await loadGraph()
  const anchor = before?.nodes?.find((n) => n.id === NODE_ID)
  note('锚点节点存在', !!anchor, `${NODE_ID} type=${anchor?.type ?? '?'} filePath=${String(anchor?.data?.filePath ?? '').slice(0, 60)}`)
  if (!anchor) process.exit(1)
  const prompt = anchor?.data?.prompt ?? anchor?.data?.v3?.prompt ?? ''
  note('锚点 prompt 提取', !!prompt, `${String(prompt).slice(0, 40)}…`)
  const beforePath = anchor?.data?.filePath ?? null

  // ── 2. 经 kap execute 真实重生成 ──
  const t0 = Date.now()
  const exec = await post(KAP, '/api/canvas/execute', {
    projectId, episodesId, nodeId: NODE_ID, nodeType: 'global', prompt, regenSource: 'panel-regen',
  })
  note('execute 提交受理', exec?.code === 200, `code=${exec?.code}(${Date.now() - t0}ms 后台执行)`)

  // ── 3. 引擎侧轮询 canvas-* 任务(只认本轮新任务:task_id 尾部时间戳 > t0,
  //        防命中上一轮探针的历史任务——首个真机任务曾因此被误读)──
  let task = null
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const list = await fetch(`${ENG}/api/v1/tasks`).then((r) => r.json()).catch(() => null)
    const items = Array.isArray(list) ? list : (list?.tasks ?? list?.data ?? [])
    task = [...items].find((t) => {
      const id = String(t.task_id ?? t.id ?? '')
      return id.startsWith(`canvas-${NODE_ID}-`) && Number(id.split('-').pop()) > t0 - 5_000
    })
    if (task && ['completed', 'failed', 'cancelled'].includes(String(task.status))) break
    await sleep(4_000)
  }
  const tid = String(task?.task_id ?? task?.id ?? '')
  note('引擎出现 canvas-* 任务', !!task, tid || '轮询窗口内未见')
  note('引擎任务终态 completed', task?.status === 'completed', `status=${task?.status ?? '?'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  if (!task || task.status !== 'completed') { await restore(before); report() }

  // ── 4. 节点 filePath 更新 ──
  await sleep(1_500) // filePath 落库在引擎 completed 后由 _simulate 写
  const mid = await loadGraph()
  const midAnchor = mid?.nodes?.find((n) => n.id === NODE_ID)
  const afterPath = midAnchor?.data?.filePath ?? null
  note('filePath 已更新为新产物', !!afterPath && afterPath !== beforePath, `${String(afterPath).slice(0, 70)}`)
  note('新产物为 /oss/ web 路径', String(afterPath).startsWith('/oss/'), String(afterPath).slice(0, 40))

  // ── 5. 零足迹恢复(save-v2 捕获图)──
  await restore(before)

  const restored = await loadGraph()
  const rAnchor = restored?.nodes?.find((n) => n.id === NODE_ID)
  note('恢复后 filePath 回原值', (rAnchor?.data?.filePath ?? null) === beforePath, `${String(rAnchor?.data?.filePath ?? '').slice(0, 60)}`)
  report()
}

async function restore(graph) {
  try {
    await post(KAP, '/api/canvas/v2/save-v2', { projectId, episodesId, graph, savedBy: 'probe-66-poweron' })
    console.log('[restore] save-v2 捕获图已写回')
  } catch (e) {
    note('恢复失败', false, String(e.message))
  }
}

function report() {
  console.log(failures.length === 0
    ? '\n✅ probe-66-poweron 全绿:画布重生成经 kap→引擎全链真机闭环(F01 simulateOnly 假成功已消除)'
    : `\n❌ ${failures.length} 项失败:\n  - ${failures.join('\n  - ')}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('probe crashed:', e); process.exit(2) })
