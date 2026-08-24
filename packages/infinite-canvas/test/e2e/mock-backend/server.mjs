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
 * Phase 62 (资产层级/选定/冗余配置) mock 扩面:
 *  - PATCH /api/v1/assets-registry/:id        → 资产更新 (白名单 isPrimaryView/state/tags)
 *  - POST /api/canvas/v2/variant-groups/:groupId/select-winner → 变体组选定 (镜像 select-winner.ts)
 *  - GET  /api/canvas/v2/generation-config    → 冗余配置三源合并读 (查表生成)
 *  - PUT  /api/canvas/v2/generation-config/overrides/:phaseKey → 覆盖层写 (writeState 可注入)
 *  多组 search fixture 经 /__mock/config { assetFixture:'rich' } 激活,/__mock/reset 归位默认。
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

// ─── Phase 62 fixtures(资产层级/选定/冗余配置)──────────────

// 62-03: 默认 search fixture——原 search 路由内联字面量原样抽取(字节等价,
// phase61-debt 的 .am-card 可见性断言零扰动)。PATCH 写通道命中默认行时先
// structuredClone 物化到 state.fixtureAssets 再改,本常量永不原地突变。
const DEFAULT_ASSET_FIXTURE = [
  { id: 90001, uuid: 'e2e-asset-90001', name: 'E2E拖入资产A', type: 'character', prompt: null, describe: null, projectId: 1, characterId: null, viewAngle: 'front', isPrimaryView: true, model: null, tags: null, state: 'active', meta: null, filePath: '/oss/e2e/asset-a.png', imageState: null, imageModel: null, resolution: null },
  { id: 90002, uuid: 'e2e-asset-90002', name: 'E2E拖入资产B', type: 'character', prompt: null, describe: null, projectId: 1, characterId: null, viewAngle: 'front', isPrimaryView: false, model: null, tags: null, state: 'active', meta: null, filePath: '/oss/e2e/asset-b.png', imageState: null, imageModel: null, resolution: null },
]

// 62-03: 内存 variantGroups 注册表(select-winner mock 直查此表——「图未加载不是
// 失败模式」的 mock 等价物)。vg-e2e-1 成员指向 rich fixture 的 asset-91001/91002;
// e2e 用 rich 前必注入。__mock/config { fixtureVariantGroups:[...] } 可覆盖注入自定义组。
const DEFAULT_VARIANT_GROUPS = [
  { groupId: 'vg-e2e-1', variantNodeIds: ['asset-91001', 'asset-91002'], winnerNodeId: null, selectMode: 'single' },
]

// 62-03: 冗余配置 14 键内联精简表(11 嵌套——transition 已并入 shot_list(RESEARCH F 漂移 2)
// + 3 扁平)。mock 只锁 UI 断言面不背键面一致性责任——键集与真表一致由 62-07 S-门对
// generationConfigKeys.ts 锁;此处 tier/label 与 UI-SPEC phase_key 显示名表对齐。
const GENERATION_CONFIG_MOCK_KEYS = [
  { phaseKey: 'p01_hook.topic_kernel', tier: 'llm', label: '选题钩子·题核' },
  { phaseKey: 'p06_script.spatio_temporal', tier: 'llm', label: '时空剧本' },
  { phaseKey: 'p09_shotlist.shot_list', tier: 'llm', label: '分镜列表·参数' },
  { phaseKey: 'p11_video.video_render', tier: 'engine', label: '视频渲染', gpuHint: 'GPU 成本护栏 · 谨慎调高' },
  { phaseKey: 'p07_style.style_vector', tier: 'deterministic', label: '风格·风格向量', preCap1: true },
  { phaseKey: 'p07_style.color_intent', tier: 'deterministic', label: '风格·色彩意图', preCap1: true },
  { phaseKey: 'p12_compose.master_timeline', tier: 'deterministic', label: '合成·主时间线', preCap1: true },
  { phaseKey: 'p12_compose.audio_mix', tier: 'deterministic', label: '合成·混音', preCap1: true },
  { phaseKey: 'p13_master.master_mp4', tier: 'deterministic', label: '母版·成片', preCap1: true },
  { phaseKey: 'p12_audio.bgm', tier: 'engine', label: '音频·BGM', unwired: true },
  { phaseKey: 'p12_audio.foley', tier: 'engine', label: '音频·Foley', unwired: true },
  { phaseKey: 'p01_hook', tier: 'text', label: '选题钩子（文本候选）' },
  { phaseKey: 'p02_outline', tier: 'text', label: '故事大纲（文本候选）' },
  { phaseKey: 'p03_script', tier: 'text', label: '剧本（文本候选）' },
]

// 快照默认(runner 实码口径):嵌套键 pre=final=1;扁平键 pre=3、p02/p03 final=1、
// p01 不落数字 final 键 → final 缺省=pre(_vision_review.py 哨兵语义)。
function snapshotDefaults(phaseKey) {
  if (!phaseKey.includes('.')) {
    if (phaseKey === 'p01_hook') return { pre: 3, final: 3 }
    return { pre: 3, final: 1 }
  }
  return { pre: 1, final: 1 }
}

/**
 * 62-03: Phase 62 层级/三态/计数断言面 fixture(rich preset);组键对齐 62-01
 * getGroupKey 词表(char:/scene:/keyframe:/type:name)。期望组键集:
 *   char:shenzhiyi:concept ×3(1 selected + 2 pending)/ scene:宴会厅 ×2(手动组)/
 *   char:shenzhiyi:voice ×2(手动组,meta.subtype='voice_print')/
 *   keyframe:S01:S01_first ×2(剥 _v 同键;meta.phaseCode='P09' 直读样本)/
 *   video:SH01 ×1 / outline:* ×1(isPrimaryView=true)/ document:* ×1(reportAudit 单件)。
 * 每条含完整 AssetDetail 形状 + createdAt(排序键面,UI-GREY-1)+ filePath 非空(除文档型)。
 */
function buildRichFixture() {
  const t0 = 1756000000000
  const row = (id, extra) => ({
    id,
    uuid: `e2e-rich-${id}`,
    name: null,
    type: null,
    prompt: null,
    describe: null,
    projectId: 1,
    characterId: null,
    viewAngle: null,
    isPrimaryView: false,
    model: null,
    tags: null,
    state: 'active',
    meta: null,
    filePath: `/oss/e2e/rich-${id}.png`,
    imageState: null,
    imageModel: null,
    resolution: null,
    createdAt: t0 + id * 1000,
    ...extra,
  })
  return [
    // char 组 char:shenzhiyi:concept(meta.subtype 缺省 → concept 键)
    row(91001, { name: '沈知意·概念设定A', type: 'character', characterId: 'shenzhiyi', viewAngle: 'front', isPrimaryView: true }),
    row(91002, { name: '沈知意·概念设定B', type: 'character', characterId: 'shenzhiyi', viewAngle: 'front' }),
    row(91003, { name: '沈知意·概念设定C', type: 'character', characterId: 'shenzhiyi', viewAngle: 'front' }),
    // scene 手动组 scene:宴会厅(getGroupKey 场景分支按 name 分组——name 必须同串)
    row(91004, { name: '宴会厅', type: 'scene' }),
    row(91005, { name: '宴会厅', type: 'scene' }),
    // voice 手动组 char:shenzhiyi:voice(getGroupKey 仅经 meta.subtype='voice_print' 到达)
    row(91006, { name: '沈知意·声纹A', type: 'voice', characterId: 'shenzhiyi', meta: '{"subtype":"voice_print"}', filePath: '/oss/e2e/rich-91006.mp3' }),
    row(91007, { name: '沈知意·声纹B', type: 'voice', characterId: 'shenzhiyi', meta: '{"subtype":"voice_print"}', filePath: '/oss/e2e/rich-91007.mp3' }),
    // keyframe 组 keyframe:S01:S01_first(剥 _v 后同键)+ phaseCode 直读样本
    row(91008, { name: 'S01_first_v1', type: 'keyframe', characterId: 'S01', meta: '{"phaseCode":"P09"}' }),
    row(91009, { name: 'S01_first_v2', type: 'keyframe', characterId: 'S01', meta: '{"phaseCode":"P09"}' }),
    // 媒体单件 video:SH01
    row(91010, { name: 'SH01', type: 'video', filePath: '/oss/e2e/rich-91010.mp4' }),
    // 文本单件(outline,文档型 filePath 空;isPrimaryView=true)
    row(91011, { name: '故事大纲v1', type: 'outline', isPrimaryView: true, filePath: null }),
    // reportAudit 单件(meta.subtype='delivery_package';文档型 filePath 空)
    row(91012, { name: '交付包审计报告', type: 'document', meta: '{"subtype":"delivery_package","phaseCode":"P13"}', filePath: null }),
  ]
}
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
  // ─── Phase 62 (62-03) 扩展态 ────────────────────────────
  // null = 用 DEFAULT_ASSET_FIXTURE(默认路径字节等价 61);'rich' 注入后为 buildRichFixture() 数组
  fixtureAssets: null,
  fixtureVariantGroups: structuredClone(DEFAULT_VARIANT_GROUPS),
  // 冗余配置 mock 态:fileShape 由 /__mock/config { fileShape } 注入('not-found'|'requirement-v25'|'legacy');
  // overrides 由 PUT 覆盖层写累积;writeState 三态经 /__mock/config { genCfgWriteState } 注入(读侧在 state.config)。
  generationConfig: { overrides: {}, fileShape: 'not-found' },
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
  // 62-03: Phase 62 扩展态归位(fixture 回默认;config 归位由下方 keepConfig 分支负责)
  state.fixtureAssets = null
  state.fixtureVariantGroups = structuredClone(DEFAULT_VARIANT_GROUPS)
  state.generationConfig = { overrides: {}, fileShape: 'not-found' }
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
// 默认返回 DEFAULT_ASSET_FIXTURE 2 条(id 90001/90002,filePath 非空供缩略图渲染)——
// 与 61 版内联字面量字节等价,phase61-debt 回归锚零扰动。
// 62-03: rich 多组 fixture 经 POST /__mock/config { assetFixture:'rich' } 激活
// (state.fixtureAssets),/__mock/reset 归位 null=默认。不校验查询参数(客户端分页
// limit 200,默认 2 条/rich 12 条 < 200 自然收敛,不会二次翻页)。
app.post('/api/v1/assets-registry/search', (req, res) => {
  logCall('POST', '/api/v1/assets-registry/search', req.body ?? {}, null)
  res.json({
    code: 200,
    data: {
      assets: state.fixtureAssets ?? DEFAULT_ASSET_FIXTURE,
    },
  })
})

// 62-03: PATCH assets-registry mock——镜像真端点 src/routes/v1/assets-registry/index.ts
// 最小写语义(白名单 isPrimaryView/state/tags;响应 { code, data:{ asset } })。
// 刻意不模拟服务端 PATCH-linkage 联动(RESEARCH C:真侧 isPrimaryView=true 会自动
// applyRegistrySelectionToCanvas;mock 保持两通道分离——客户端 select-winner POST 的
// 真实增量 = 恰一次调用可观测,D-05 断言纪律按「POST 发出 + 最终态正确」写)。
// logCall 全尝试记录惯例(含 404 未命中,e2e 恰-N 计数断言面);写时物化:
// 默认 fixture 首次被写先 clone 到 state.fixtureAssets,DEFAULT_ASSET_FIXTURE 永不原地突变。
app.patch('/api/v1/assets-registry/:id', (req, res) => {
  logCall('PATCH', `/api/v1/assets-registry/${req.params.id}`, req.body ?? {}, null)
  if (state.fixtureAssets == null) state.fixtureAssets = structuredClone(DEFAULT_ASSET_FIXTURE)
  const row = state.fixtureAssets.find((a) => a.id === Number(req.params.id))
  if (!row) {
    return res.status(404).json({ code: 404, message: '资产不存在' })
  }
  const body = req.body ?? {}
  for (const key of ['isPrimaryView', 'state', 'tags']) {
    if (key in body) row[key] = body[key]
  }
  res.json({ code: 200, data: { asset: row } })
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
  const body = req.body ?? {}
  // ─── Phase 62 (62-03) 注入旋钮(特殊键先消费,再照旧并入 state.config 供观测)───
  if ('assetFixture' in body) {
    // 'rich' → 多组 fixture;null/其他 → 清回默认 2 条
    state.fixtureAssets = body.assetFixture === 'rich' ? buildRichFixture() : null
    if (body.assetFixture === 'rich') {
      // rich preset 同步挂上 variantGroups 注册表(reset 已归位,此处幂等兜底)
      state.fixtureVariantGroups = structuredClone(DEFAULT_VARIANT_GROUPS)
    }
  }
  if ('fixtureVariantGroups' in body) {
    // 自定义组注入(null/非数组 → 归位内置注册表)
    state.fixtureVariantGroups = Array.isArray(body.fixtureVariantGroups)
      ? body.fixtureVariantGroups
      : structuredClone(DEFAULT_VARIANT_GROUPS)
  }
  if ('fileShape' in body) {
    // 冗余配置文件形态三档('not-found'|'requirement-v25'|'legacy';非法值归位 not-found)
    state.generationConfig.fileShape = ['not-found', 'requirement-v25', 'legacy'].includes(body.fileShape)
      ? body.fileShape
      : 'not-found'
  }
  // genCfgWriteState('override'|'synced'|'file-fail')/ failSelectWinner(500 注入)/
  // orchDelay 等既有旋钮走通用合并——读侧直接查 state.config。
  state.config = { ...state.config, ...body }
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
