/**
 * v1.7 Playwright 测试用 Mock Backend
 *
 * 提供以下接口模拟主项目的 canvas 路由:
 *  - GET  /                          → 静态文件 (canvas dist/)
 *  - POST /api/canvas/load           → 读取画布
 *  - POST /api/canvas/v2/save-v2     → 保存画布 (mock 在内存,广播 graph:saved)
 *  - POST /api/canvas/convert        → 项目数据转画布 (返回 mock 节点)
 *  - POST /api/canvas/orchestrate    → 一键成片编排 (Phase 36)
 *  - POST /api/canvas/execute        → 单节点执行
 *  - POST /api/canvas/storyboard/preview → 分镜构图预览 (Phase 38)
 *  - POST /api/canvas/projects       → 项目列表
 *  - POST /api/canvas/projectData    → 项目剧本数据
 *  - GET  /api/v1/skills/:id/node-types → Skill 注册表
 *
 * WebSocket 命名空间: /ws/projects
 *  - 广播 node:state / execution:progress / orchestrate:start/progress/done / node:preview
 *  - Phase 59: execute(body 含 regenSource)回放 node:updated { node, changedFields:["data.stale"] }
 *
 * 测试控制接口 (测试代码用来注入 / 验证状态):
 *  - GET  /__mock/state              → 当前 mock 数据库
 *  - POST /__mock/reset              → 重置 mock 状态
 *  - POST /__mock/emit               → 主动广播事件 (用于测试 WebSocket 接收)
 *  - GET  /__mock/calls              → 已记录的 API 调用日志
 */
import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.MOCK_PORT ?? 9876)
const app = express()
app.use(express.json({ limit: '50mb' }))

const server = http.createServer(app)
const io = new Server(server, {
  // 默认 path 是 /socket.io — 与客户端 useCanvasSocket 默认配置匹配
  cors: { origin: '*' },
})

// ─── Mock State ────────────────────────────────────────────

const DEFAULT_NODES = [
  {
    id: 'script-0',
    type: 'script',
    position: { x: 50, y: 50 },
    size: { width: 260, height: 180 },
    data: { label: '剧本', type: 'script', content: '一段测试剧本...', state: 'success' },
    state: 'success',
  },
  {
    id: 'asset-1',
    type: 'asset',
    position: { x: 400, y: 50 },
    size: { width: 260, height: 180 },
    data: {
      label: '主角', type: 'asset', assetType: 'role', assetId: 1,
      prompt: 'a brave hero', filePath: null, thumbnailUrl: null, state: 'idle',
      cameraMovement: undefined,
    },
    state: 'idle',
  },
  {
    id: 'storyboard-1',
    type: 'storyboard',
    position: { x: 400, y: 500 },
    size: { width: 260, height: 180 },
    data: {
      label: '分镜 1', type: 'storyboard', storyboardId: 1, duration: 3,
      prompt: '主角进入场景', filePath: null, thumbnailUrl: null, state: 'idle',
      linkedAssetIds: [1],
      // Phase 35 — 默认带一个 chip 用于测试
      cameraMovement: 'zoom_in',
    },
    state: 'idle',
  },
  {
    id: 'storyboard-2',
    type: 'storyboard',
    position: { x: 700, y: 500 },
    size: { width: 260, height: 180 },
    data: {
      label: '分镜 2', type: 'storyboard', storyboardId: 2, duration: 4,
      prompt: '特写镜头', filePath: null, thumbnailUrl: null, state: 'idle',
      linkedAssetIds: [1],
      framing: 'close_up',
      composition: 'rule_of_thirds',
      pacing: 'medium',
    },
    state: 'idle',
  },
  {
    id: 'video-1',
    type: 'video',
    position: { x: 400, y: 850 },
    size: { width: 260, height: 180 },
    data: { label: '视频 1', type: 'video', videoId: 1, filePath: null, thumbnailUrl: null, state: 'idle' },
    state: 'idle',
  },
  {
    id: 'audio-1',
    type: 'audio',
    position: { x: 400, y: 1100 },
    size: { width: 260, height: 180 },
    data: { label: '音频 1', type: 'audio', audioId: 1, filePath: null, thumbnailUrl: null, state: 'idle' },
    state: 'idle',
  },
]

const DEFAULT_EDGES = [
  { id: 'e1', source: 'script-0', target: 'asset-1', data: { dataType: 'text' } },
  { id: 'e2', source: 'script-0', target: 'storyboard-1', data: { dataType: 'text' } },
  { id: 'e3', source: 'asset-1', target: 'storyboard-1', data: { dataType: 'image' } },
  { id: 'e4', source: 'storyboard-1', target: 'video-1', data: { dataType: 'video' } },
  { id: 'e5', source: 'asset-1', target: 'audio-1', data: { dataType: 'audio' } },
]

const state = {
  canvas: {
    nodes: structuredClone(DEFAULT_NODES),
    links: structuredClone(DEFAULT_EDGES),
    groups: [],
    variantGroups: [],
  },
  calls: [],
  config: {
    orchDelay: 50,    // ms per node during orchestrate
    previewDelay: 100,
    failSecondNode: false,
  },
  activeRuns: new Set(),  // runId 集合; reset 时清空,orchestrate 循环检查
  // WR-02(review-60): per-scope 保存事件计数——save-v2 按请求的 (projectId,
  // episodesId) 归账,health 逐 scope 各吐各的 eventCount(旧版把所有 save 记到
  // scope 1/1 头上: 其他 project 的保存会抬 1/1 的 eventCount,页面 health-poll
  // 基线若在抬升前学到 → 假「检测到 pipeline 远端更新」toast + reload——phase 60
  // 要消灭的假 reload 类)。
  // 与真实后端的已知分歧(保持记录,FLAG-2 锁死真侧禁改): 真实 health.ts 不吐
  // eventCount(第二 reload 通道在产线是死的);mock 保留 eventCount 使 e2e 能
  // 行为覆盖 health-poll 通道。零事件的 scope 不出现在 scopes(更贴真形)。
  scopeEvents: new Map(),  // key `${projectId}:${episodesId}` → { eventCount, lastEventId, lastEventAt }
}

function reset() {
  state.canvas = {
    nodes: structuredClone(DEFAULT_NODES),
    links: structuredClone(DEFAULT_EDGES),
    groups: [],
    variantGroups: [],
  }
  state.calls = []
  state.scopeEvents = new Map() // WR-02: per-scope 计数随 reset 清零
}

function logCall(method, path, body, response) {
  state.calls.push({ method, path, body, response, ts: Date.now() })
}

function broadcastToProject(projectId, event, data) {
  io.of('/ws/projects').to(`project:${projectId}`).emit(event, data)
}

// ─── Canvas API ────────────────────────────────────────────

app.post('/api/canvas/load', (req, res) => {
  const { projectId, episodesId } = req.body
  logCall('POST', '/api/canvas/load', { projectId, episodesId }, state.canvas)
  res.json({ code: 200, data: state.canvas })
})

// V2 加载端点 —— 前端 loadCanvasGraph 改打此路径（与真后端 /api/canvas/v2/load-v2
// 对齐）。mock 复用同一份 state.canvas：adaptV2Graph 对缺 meta 的 v1-ish 形状同样
// 宽松消费（meta 缺失默认 0 + warning），故 e2e 行为与原 /api/canvas/load 一致。
app.post('/api/canvas/v2/load-v2', (req, res) => {
  const { projectId, episodesId } = req.body
  logCall('POST', '/api/canvas/v2/load-v2', { projectId, episodesId }, state.canvas)
  res.json({ code: 200, data: state.canvas })
})

// ─── Pipeline sync (Phase 41 fix) ─────────────────────────
// 模拟 kais-movie-pipeline 通过 /api/canvas/v2/save-v2 全量写入。
// Phase 51-02 起这也是前端 saveCanvasGraph 的唯一保存通道（v1 save 已删除，契约诚实）。
// 替换 mock canvas 状态,然后广播 graph:saved 事件 — 与真 backend
// src/routes/canvas/v2/save-v2.ts:60 的行为对齐。
// 60-02: 59-04 的 graph:saved 抑制旋钮已退役——自回声跳过改由客户端 D-01
// 机制(savedBy 回声判定)实现,广播恒发(mock 不设旁路,D-04 契约对齐)。
app.post('/api/canvas/v2/save-v2', (req, res) => {
  const { projectId, episodesId, graph, savedBy } = req.body
  state.canvas = graph?.nodes?.length ? graph : state.canvas
  // WR-02: per-scope 事件计数(health 观测面)——按请求的 (projectId, episodesId)
  // 归账,不再全局混计(跨 scope 污染 scope 1/1 的 eventCount)。
  if (projectId != null && episodesId != null) {
    const key = `${projectId}:${episodesId}`
    const prev = state.scopeEvents.get(key) ?? { eventCount: 0, lastEventId: 0, lastEventAt: Date.now() }
    state.scopeEvents.set(key, {
      eventCount: prev.eventCount + 1,
      lastEventId: prev.lastEventId + 1,
      lastEventAt: Date.now(),
    })
  }
  // 60-02: body 记 savedBy(?? null)——e2e 断言客户端真的发了身份的观测面(60-04 用例 1)。
  logCall('POST', '/api/canvas/v2/save-v2', { projectId, episodesId, nodeCount: graph?.nodes?.length, savedBy: req.body?.savedBy ?? null }, null)
  res.json({ code: 200, data: null })
  setTimeout(() => {
    // 60-02 D-04: savedBy 条件回显,与真后端 save-v2.ts 同形;不带身份的调用广播形状不变。
    broadcastToProject(projectId, 'graph:saved', { projectId, episodesId, timestamp: Date.now(), ...(savedBy != null ? { savedBy } : {}) })
  }, 5)
})

// 61-01 DEBT-01: 镜像真实 nodes.ts L48-97 最小语义(400 载荷非法 / 409 查重 /
// 200 append + node:created 回放)——拖入持久化通道的 mock 面。真侧是
// zod nodeInputSchema 门 + validateNodeData + 单行 UPSERT + broadcastToProject;
// mock 只锁 e2e 消费的最小契约:同 id 二次 POST → 409「节点已存在」。
app.post('/api/canvas/v2/nodes/', (req, res) => {
  const { projectId, episodesId, node } = req.body ?? {}
  // 观测面:每次尝试都落 /__mock/calls(含 409 二次拖入——e2e 恰-2-条计数断言;
  // 与 load/orchestrate/execute 的全请求记录惯例一致,不记 response 以副作用断言)。
  // WR-02(review-61): data 袋联动键 assetId/assetUuid 防御性提取入记录——e2e 断言
  // 拖入 POST 真携带注册表主键(StoryboardTimeline.assetIdOf 联动链的 wire 证据)。
  logCall('POST', '/api/canvas/v2/nodes/', {
    projectId,
    episodesId,
    nodeId: typeof node?.id === 'string' ? node.id : null,
    x: typeof node?.position?.x === 'number' ? node.position.x : null,
    y: typeof node?.position?.y === 'number' ? node.position.y : null,
    assetId: typeof node?.data?.assetId === 'number' ? node.data.assetId : null,
    assetUuid: typeof node?.data?.assetUuid === 'string' ? node.data.assetUuid : null,
  }, null)
  if (
    node == null || typeof node !== 'object' ||
    typeof node.id !== 'string' ||
    typeof node.position?.x !== 'number' || !Number.isFinite(node.position.x) ||
    typeof node.position?.y !== 'number' || !Number.isFinite(node.position.y)
  ) {
    return res.json({ code: 400, message: '节点载荷非法' })
  }
  if ((state.canvas.nodes ?? []).some((n) => n.id === node.id)) {
    return res.json({ code: 409, message: `节点 ${node.id} 已存在` })
  }
  state.canvas.nodes.push({ ...node })
  res.json({ code: 200, data: { node } })
  // save-v2 同款 5ms 回放:广播携带落库后的真值节点(e2e 断言 truth-first 三点一线)
  setTimeout(() => {
    broadcastToProject(projectId, 'node:created', { node: state.canvas.nodes.at(-1) })
  }, 5)
})

// 61-01 DEBT-01: 资产中心数据面——useRealAssets 唯一数据源 POST /v1/assets-registry/search。
// 返回 2 条固定 AssetDetail fixture(id 90001/90002,filePath 非空供缩略图渲染);
// 不校验查询参数(客户端分页 limit 200,fixture 2 条 < 200 自然收敛,不会二次翻页)。
app.post('/api/v1/assets-registry/search', (req, res) => {
  logCall('POST', '/api/v1/assets-registry/search', req.body ?? {}, null)
  res.json({
    code: 200,
    data: {
      assets: [
        { id: 90001, uuid: 'e2e-asset-90001', name: 'E2E拖入资产A', type: 'character', prompt: null, describe: null, projectId: 1, characterId: null, viewAngle: 'front', isPrimaryView: true, model: null, tags: null, state: 'active', meta: null, filePath: '/oss/e2e/asset-a.png', imageState: null, imageModel: null, resolution: null },
        { id: 90002, uuid: 'e2e-asset-90002', name: 'E2E拖入资产B', type: 'character', prompt: null, describe: null, projectId: 1, characterId: null, viewAngle: 'front', isPrimaryView: false, model: null, tags: null, state: 'active', meta: null, filePath: '/oss/e2e/asset-b.png', imageState: null, imageModel: null, resolution: null },
      ],
    },
  })
})

// Phase 56 G16 豁免回路 mock(56-05 g15-ops):受理即 200 applied。
app.post('/api/canvas/v2/g15-ops', (req, res) => {
  logCall('POST', '/api/canvas/v2/g15-ops', req.body ?? {}, null)
  res.json({ code: 200, data: { action: req.body?.action, applied: true } })
})

// Health 端点 mock — 用于前端兜底轮询。WR-02(review-60): per-scope eventCount
// (scopeEvents 按 projectId:episodesId 计数,只吐发生过保存的 scope);真实后端
// 不吐 eventCount(FLAG-2,mock/real 分歧有意保留——mock 使 e2e 可行为覆盖
// health-poll 通道)。
app.get('/api/canvas/v2/health', (req, res) => {
  const scopes = [...state.scopeEvents.entries()].map(([key, ev]) => {
    const [projectId, episodesId] = key.split(':').map(Number)
    return { projectId, episodesId, eventCount: ev.eventCount, lastEventId: ev.lastEventId, lastEventAt: ev.lastEventAt }
  })
  const totalEvents = scopes.reduce((sum, s) => sum + s.eventCount, 0)
  res.json({
    code: 200,
    data: {
      timestamp: Date.now(),
      canvas: {
        totalScopes: scopes.length,
        totalEvents,
        scopes,
      },
    },
  })
})

app.post('/api/canvas/convert', (req, res) => {
  const { projectId, episodesId } = req.body
  logCall('POST', '/api/canvas/convert', { projectId, episodesId }, state.canvas)
  res.json({ code: 200, data: state.canvas })
})

app.post('/api/canvas/projects', (req, res) => {
  res.json({
    code: 200,
    data: [{ id: 1, name: '测试项目', scriptCount: 1, assetCount: 1 }],
  })
})

app.post('/api/canvas/projectData', (req, res) => {
  res.json({
    code: 200,
    data: [{ id: 1, name: '剧本 1', content: '测试内容', assetCount: 1, storyboardCount: 2 }],
  })
})

// ─── Skill Registry (mock) ─────────────────────────────────

app.get('/api/v1/skills/:skillId/node-types', (req, res) => {
  res.json({
    ok: true,
    node_types: [
      { type: 'script', label: '剧本', icon: '📄', color: '#89b4fa', default_renderer: 'script' },
      { type: 'asset', label: '资产', icon: '📦', color: '#a6e3a1', default_renderer: 'asset' },
      { type: 'storyboard', label: '分镜', icon: '🎬', color: '#f9e2af', default_renderer: 'storyboard' },
      { type: 'video', label: '视频', icon: '🎥', color: '#cba6f7', default_renderer: 'video' },
      { type: 'audio', label: '音频', icon: '🎵', color: '#94e2d5', default_renderer: 'audio' },
    ],
  })
})

// ─── Phase 36 — Orchestrate ────────────────────────────────

const TOPOLOGY = ['script', 'asset', 'storyboard', 'video', 'audio']

app.post('/api/canvas/orchestrate', (req, res) => {
  const { projectId, episodesId, nodeIds } = req.body
  // V3：前端保存时会把生成事件芯片（type:'eventChip' / id 'evt_*'）一起写回画布。
  // 这些是迁移合成的「生成事件」产物，不是可编排的工作项——编排器只对真实资产
  // 节点计数（与真实后端语义一致），否则 skipped 会被 6 个 success 态事件芯片撑大。
  const all = (state.canvas.nodes ?? []).filter(
    (n) => n.type !== 'eventChip' && !String(n.id).startsWith('evt_'),
  )
  const filtered = Array.isArray(nodeIds) && nodeIds.length > 0
    ? all.filter((n) => nodeIds.includes(n.id))
    : all
  // 52-02: 镜像服务端 orchestrate.ts 同构改动——success/cached 且无 stale 标记才跳过
  // (stale 即需重跑语义,e2e 与生产语义不分叉)
  const targets = filtered.filter(
    (n) => (n.state !== 'success' && n.state !== 'cached') || (n.data != null && n.data.stale != null),
  )
  targets.sort((a, b) => TOPOLOGY.indexOf(a.type) - TOPOLOGY.indexOf(b.type))

  const total = targets.length
  const mode = Array.isArray(nodeIds) && nodeIds.length > 0 ? 'batch' : 'full'
  const runId = `run-${Date.now()}`

  res.json({ code: 200, data: { runId, total, skipped: filtered.length - total, mode } })
  // 52-02: logCall 记完整 body({...req.body} 全透传 + 计算字段 mode/total,
  // mode/total 不在 req.body 里但 phase36/37 e2e 断言依赖)——REGEN e2e 断言任务参数的观测点
  logCall('POST', '/api/canvas/orchestrate', { ...req.body, mode, total }, { runId, total, skipped: filtered.length - total, mode })

  // 把 runId 加入 active 集合;reset 会清空,使旧 run 自动终止
  state.activeRuns.add(runId)

  const delayMs = state.config.orchDelay
  let i = 0
  let completed = 0
  let failed = 0
  const failedNodes = []

  setTimeout(() => {
    if (!state.activeRuns.has(runId)) return
    broadcastToProject(projectId, 'orchestrate:start', { runId, total, mode })
  }, 5)

  function step() {
    // 如果 runId 被 reset 清掉,直接终止 (不再广播)
    if (!state.activeRuns.has(runId)) return
    if (i >= targets.length) {
      broadcastToProject(projectId, 'orchestrate:done', {
        runId, completed, total, failed, failedNodes, mode,
      })
      state.activeRuns.delete(runId)
      return
    }
    const node = targets[i]
    broadcastToProject(projectId, 'orchestrate:progress', {
      runId, completed, total, failed, currentNodeId: node.id, mode,
    })
    broadcastToProject(projectId, 'node:state', {
      nodeId: node.id, state: 'running', progress: 0,
    })
    setTimeout(() => {
      if (!state.activeRuns.has(runId)) return
      if (state.config.failSecondNode && i === 1) {
        broadcastToProject(projectId, 'node:state', { nodeId: node.id, state: 'error' })
        failed++
        failedNodes.push(node.id)
      } else {
        broadcastToProject(projectId, 'node:state', { nodeId: node.id, state: 'success' })
        const stored = state.canvas.nodes.find((n) => n.id === node.id)
        if (stored) {
          stored.state = 'success'
          stored.data.state = 'success'
        }
        completed++
      }
      i++
      step()
    }, delayMs)
  }

  setTimeout(step, 30)
})

// ─── Phase 38 — Storyboard Preview ─────────────────────────

app.post('/api/canvas/storyboard/preview', (req, res) => {
  const { projectId, episodesId, nodeId } = req.body
  if (!nodeId || !nodeId.startsWith('storyboard-')) {
    return res.status(400).json({ code: 400, message: '仅分镜节点支持预览' })
  }
  res.json({ code: 200, data: { nodeId, status: 'preview_triggered' } })
  logCall('POST', '/api/canvas/storyboard/preview', { projectId, episodesId, nodeId }, null)

  const delayMs = state.config.previewDelay
  setTimeout(() => {
    broadcastToProject(projectId, 'node:preview', {
      nodeId,
      thumbnailUrl: null,
      state: 'preview_ready',
    })
  }, delayMs)
})

// ─── Phase 37 — Single-node execute (back-compat) ──────────

// Phase 59 (59-04): mock 侧 stale 级联回放——严格镜像 59-02 服务端契约
// (markStaleAndBroadcast → node:updated { projectId, episodesId, node,
// changedFields:["data.stale"] };scope 字段为 59-fix CR-02 上 wire,客户端
// onNodeUpdated 守卫以其比对当前 project/episode)。
// mock 是**契约回放**非语义重实现:语义真值源在 59-02 服务端 spawn dispatch 断言
// (cascade 传递闭包 / sequence·isInactive 排除 / locked 终点 / evt_ 确定性 id),
// mock 只按 mock 图形状做最小等价回放供 e2e 消费(SC1/SC2/SC4)。
function replayStaleCascade(projectId, episodesId, triggerNodeId) {
  const nodes = state.canvas.nodes ?? []
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  if (!nodeById.has(triggerNodeId)) return
  // 下游 BFS(D-03 传递闭包的 mock 等价):沿 mock links 前向遍历;
  //  - 事件芯片(type 'eventChip' / id 'evt_*')是结构节点,穿过但不标记;
  //  - data.curation === 'locked' 视作终点跳过(D-04 服务端语义镜像);
  //  - mock 图未建模 isInactive/sequence 边则自然全走(语义归 59-02 服务端断言);
  //  - visited 去重做环防御(stale.ts BFS 去重先例)。
  const downstream = []
  const visited = new Set([triggerNodeId])
  const queue = [triggerNodeId]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const link of state.canvas.links ?? []) {
      if (link.source !== cur || visited.has(link.target)) continue
      visited.add(link.target)
      const target = nodeById.get(link.target)
      if (target == null) continue
      const isEventNode = target.type === 'eventChip' || String(target.id).startsWith('evt_')
      if (!isEventNode && target.data?.curation !== 'locked') downstream.push(target)
      if (target.data?.curation === 'locked') continue // 传播终点:不标不传
      queue.push(target.id)
    }
  }
  const now = Date.now()
  for (const target of downstream) {
    if (target.type === 'eventChip' || String(target.id).startsWith('evt_')) continue
    // 已 stale 不覆盖(宪法 §13「最早 since 保留」——59-02 服务端 diff 只取增量的镜像)
    if (target.data?.stale != null) continue
    target.data = {
      ...(target.data ?? {}),
      stale: {
        since: now,
        triggerAssetId: triggerNodeId,
        // evt_ 前缀确定性 id(migrate.ts L523 同规则;mock 图无独立事件节点 →
        // 合成 evt_<触发节点>,与服务端对 mock 形状图的合成结果一致)
        triggerEventId: `evt_${triggerNodeId}`,
      },
    }
    // 逐节点广播——payload 严格镜像 59-02 服务端 wire 契约(T-59-09 + CR-02 scope)
    broadcastToProject(projectId, 'node:updated', {
      projectId,
      episodesId,
      node: target,
      changedFields: ['data.stale'],
    })
  }
}

app.post('/api/canvas/execute', (req, res) => {
  const { projectId, episodesId, nodeId, nodeType, regenSource } = req.body
  res.json({ code: 200, data: { nodeId, status: 'triggered' } })
  // 52-02: logCall 记完整 req.body(prompt/params/seed 等任务参数为 e2e 断言观测点);
  // 59 起含 regenSource —— SC1/SC2 请求体断言观测点(panel-regen / reroll-seed)
  logCall('POST', '/api/canvas/execute', req.body, null)
  setTimeout(() => {
    // 59-04: body 含 regenSource 时,在既有 node:state success 广播**之前**回放
    // 服务端级联契约(59-02 真实顺序:标记落库+广播 → success)。body 无 regenSource
    // 时行为与今天完全一致(SC3 mock 侧负向前提——回放逻辑严格在条件分支内)。
    if (regenSource) replayStaleCascade(projectId, episodesId, nodeId)
    broadcastToProject(projectId, 'node:state', { nodeId, state: 'success' })
  }, 30)
})

// ─── Mock control plane ────────────────────────────────────

app.get('/__mock/state', (req, res) => res.json(state))
app.post('/__mock/reset', (req, res) => {
  // 清空 activeRuns — 进行中的 orchestrate 会因 runId 不再存在而终止
  state.activeRuns.clear()
  reset()
  if (!req.body?.keepConfig) {
    state.config = { orchDelay: 50, previewDelay: 100, failSecondNode: false }
  }
  res.json({ ok: true })
})
app.post('/__mock/emit', (req, res) => {
  const { projectId, event, data } = req.body
  broadcastToProject(projectId, event, data)
  res.json({ ok: true })
})
app.get('/__mock/calls', (req, res) => res.json(state.calls))
app.post('/__mock/config', (req, res) => {
  state.config = { ...state.config, ...req.body }
  res.json({ ok: true, config: state.config })
})

// ─── Static canvas ─────────────────────────────────────────

const DIST_DIR = path.resolve(__dirname, '../../../dist')
app.use(express.static(DIST_DIR))

// Fallback to index.html for client-side routing (Express 5 syntax)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  if (req.path.startsWith('/api/') || req.path.startsWith('/__mock/')) {
    return res.status(404).json({ error: 'not found' })
  }
  // 静态文件已经处理过,这里只兜底 HTML
  if (req.path.includes('.') && !req.path.endsWith('.html')) {
    return res.status(404).send('not found')
  }
  res.sendFile(path.resolve(DIST_DIR, 'index.html'))
})

// ─── Socket.IO connection ──────────────────────────────────

io.of('/ws/projects').on('connection', (socket) => {
  const projectId = socket.handshake.query.projectId
  if (projectId) {
    socket.join(`project:${projectId}`)
  }
  socket.on('disconnect', () => {})
})

server.listen(PORT, () => {
  console.log(`[mock-backend] listening on http://localhost:${PORT}`)
  console.log(`[mock-backend] /ws/projects namespace ready`)
})

// ─── Capture graceful shutdown ─────────────────────────────

process.on('SIGTERM', () => {
  console.log('[mock-backend] shutting down')
  server.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[mock-backend] interrupt')
  server.close(() => process.exit(0))
})

export { app, io }
