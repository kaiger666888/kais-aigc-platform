/**
 * src/v3/serialize.ts — canonical V3 → FlowGraphV2 正向序列化器（Phase 51 WRITE-01）。
 *
 * migrateV2toV3 / adapter.buildMeta 的逆变换，与 adapter.ts 同目录成对。
 * 画布保存唯一入口：handleSave / handleOrchestrate / handleBatchExecute 三处
 * 均调本函数，输出 POST /api/canvas/v2/save-v2（zod 校验 + 结构化参数强制 +
 * graph:saved 广播）。纯函数，不 throw（rawDataByNodeId === null 时退化为纯
 * flattenMeta——地雷 #6：fixture / V3 直通模式没有原始袋）。
 *
 * 对 @kais/flowgraph-v3 的导入纪律（Phase 58 起更新）：类型导入照旧只许
 * `import type`（tsx 下类型擦除，根 scripts/verify-phase-51.ts 可直接 import 本文件
 * 做断言）；运行时导入仅限纯常量（recipe.ts，Phase 58 起——其零 import 纯常量，
 * tsx 直连链无解析风险；verify-phase-51 断言已注记允许恰这一条）。
 *
 * 映射依据（51-RESEARCH Task 2 逆变换映射表，逐行推导自 migrate.ts §14 / buildMeta）：
 *  - stage script→'script'（content→data.prompt，§14 prompt→content 的逆）；
 *    storyboard→'storyboard'（flat 补 shotId/shotType/durationS/cameraMovement/framing/
 *    composition/pacing——reload 时 buildMeta 只读 flat 字段，故必须摊平而非嵌套 data.meta）；
 *    keyframe/global→'asset'（global 补 assetType；rawData.type 合法时优先还原原始类型）；
 *    video/composite→'video'（composite 摊平 meta.edlRef，inferVideoStage 靠它判 composite）；
 *    voice/foley/bgm→'audio' + data.audioType（migrate 按 audioType 拆 stage 的唯一线索）；
 *    mix→'audio' audioType 缺省（有损，research 裁定，记 warning）；
 *    media.original/thumbnail→data.filePath/data.thumbnailUrl（P15）。
 *  - data 袋重建公式（关键，地雷 #1）：{ ...rawDataByNodeId?.get(id), ...flattenMeta(meta),
 *    filePath, thumbnailUrl }——rawDataByNodeId 是 audio 必填字段（shot_id/engine/duration_sec）
 *    与白名单外字段的唯一存活地，不合并 = 首存抹字段、后续保存被 save-v2 400 拒绝。
 *  - state failed→'error'（V2 枚举无 failed）；reviewStatus/aiScore/curation=='selected'
 *    →顶层 reviewStatus/aiScore/isWinner。
 *  - event 节点 + role:'output' 边不落盘（折叠语义同 graphToViewModel：event 经 output 边
 *    映射到产出资产，非 output 边端点是 event 则替换为该资产，自环丢弃；与旧 v1
 *    持久化层剔除 evt_* 合成节点的语义一致）。
 *  - 事件配方反向覆盖（Phase 52-02，地雷 #1 成败手）：event 不落盘，而 reload 时
 *    migrate §14 只从产出资产 flat data.prompt/seed/engine 重建 EventNodeV3.params——
 *    序列化必须把产生事件的配方覆盖回产出资产 data 袋（在 {...raw, ...flattenMeta}
 *    之后覆盖，canonical 事件配方为最终真值），否则 updateEventParams 的编辑
 *    保存+刷新后无声丢失。窄通道解除声明（Phase 58）：round-trip 扩为
 *    RECIPE_ROUNDTRIP_KEYS 九键全集（steps/cfg/lora/quant/sageAttention/negative
 *    全配方持久化），且事件 params 缺键时同步 delete data 同键——delete 传播
 *    （「空 = 未设置」清空语义，防 rawData 陈旧值复活，与 canvasStore
 *    updateEventParams 空值删除语义对称）。script stage 跳过 prompt 覆盖
 *    （其真值是 content，flattenMeta 已处理，P4 防两处抄）。
 *  - stale 上 wire（Phase 52-02，地雷 #2）：asset.stale != null → data.stale
 *    {since, triggerAssetId, triggerEventId}；服务端 orchestrate 只读持久化 blob，
 *    stale-success 不跳过（REGEN-03）需要信息源；顺带修复 stale 刷新即丢
 *    （migrate.ts d.stale 已配套还原）。stale 为 null 不写键（不伪造）。
 *  - link role→dataType（自由字符串，reload 时 migrate 负责 role 推断）；isExplore/isInactive
 *    透传。link refType/sourceHandle 在 V3 链路本就不存活（graphToViewModel 不带）——
 *    现状既有损耗，本序列化器不引入新损耗（地雷 #8）。
 *  - branches shim {id,label:name,parentId,status:'active',forkReason:'',createdAt,updatedAt}
 *    ——status 不回真（有损，与 adapter 现状同级，不在本 phase 治本，地雷 #7）。
 *  - variantGroups selectMode 'locked'→'single' + warning（地雷 #3：服务端 zod 枚举仅
 *    single|multi，原样序列化会让整图 400；解构集锁定语义仅前端展示层）。
 */
import type { FlowGraphV3, AssetNodeV3, EventNodeV3, AssetStageMeta, VariantGroupV3 } from '@kais/flowgraph-v3'
// Phase 58（路线 A 裁决）：唯一一条运行时常量导入——recipe.ts 零 import 纯常量，
// alias 双通（tsconfig + vite.config，STAGE_ORDER 运行时导入先例）；根 verify 脚本
// 侧只做文本断言，tsx 直连链不受影响（verify-phase-51 已注记允许恰这一条）。
import { RECIPE_ROUNDTRIP_KEYS } from '@kais/flowgraph-v3'

// ─── V2 wire 形状（镜像 src/types/flowgraph-v2-schema.ts 服务端 zod 契约） ───

/** 服务端 NodeStateSchema 枚举（V2 无 'failed'——序列化时映射为 'error'）。 */
export type NodeStateV2Wire = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'skipped'

export interface FlowNodeV2Wire {
  id: string
  type: string
  branchId: string
  phaseIndex: number
  phaseName: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  data: Record<string, unknown>
  state: NodeStateV2Wire
  reviewStatus?: 'pending' | 'approved' | 'rejected'
  aiScore?: unknown
  isWinner?: boolean
  variantGroupId?: string
}

export interface FlowLinkV2Wire {
  id: string
  source: string
  target: string
  branchId: string
  dataType: string
  isExplore?: boolean
  isInactive?: boolean
}

export interface FlowBranchV2Wire {
  id: string
  label: string
  parentId?: string
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'rejected'
  forkReason?: string
  createdAt: number
  updatedAt: number
}

export interface VariantGroupV2Wire {
  id: string
  phaseIndex: number
  branchId: string
  variantNodeIds: string[]
  winnerNodeId?: string
  selectMode: 'single' | 'multi'
}

export interface FlowGraphV2WireShape {
  meta: {
    version: '2'
    projectId: number
    episodesId: number
    pipelineId?: string
    createdAt: number
    updatedAt: number
    viewport?: { x: number; y: number; zoom: number }
  }
  nodes: FlowNodeV2Wire[]
  links: FlowLinkV2Wire[]
  branches: FlowBranchV2Wire[]
  variantGroups: VariantGroupV2Wire[]
}

// ─── 内部映射 ────────────────────────────────────────────

type Warn = (msg: string) => void

/**
 * 服务端 NodeTypeSchema 枚举（src/types/flowgraph-v2-schema.ts）。
 * rawData.type 优先还原原始类型时必须先过这道白名单——例如历史 'scene_image'
 * 在 zod 枚举中没有槽位，原样写回会让整图 400（比丢类型更糟），故回退 'asset'。
 */
const V2_NODE_TYPES = new Set([
  'script', 'asset', 'storyboard', 'video', 'audio',
  '3d', 'variant', 'reference', 'upscale', 'face_restore',
  'suggestion', 'zone', 'phase',
])

/** 资产 stage → V2 节点 type（§14 左列的逆）。 */
function wireTypeOf(asset: AssetNodeV3, rawType: unknown): string {
  switch (asset.stage) {
    case 'script':
      return 'script'
    case 'storyboard':
      return 'storyboard'
    case 'video':
    case 'composite':
      return 'video'
    case 'voice':
    case 'foley':
    case 'bgm':
    case 'mix':
      return 'audio'
    case 'keyframe':
    case 'global': {
      // rawData.type 优先（还原原始类型）；非法值（如历史 scene_image）回退 'asset' 防 zod 400。
      if (typeof rawType === 'string' && V2_NODE_TYPES.has(rawType)) return rawType
      return 'asset'
    }
  }
}

/**
 * meta 判别联合 → flat data 字段（buildMeta 各 stage 分支的逆）。
 * 必须摊平——reload 时 buildMeta 只读 flat 字段（d.cameraMovement），不读嵌套 data.meta。
 * script 的 content → data.prompt（§14 prompt→content 的逆）。
 * audio 各轨补 data.audioType（migrate 按 audioType 拆 voice/foley/bgm 的唯一线索）。
 */
function flattenMeta(
  asset: AssetNodeV3,
  warn: Warn,
): Record<string, unknown> {
  const meta = asset.meta as AssetStageMeta & Record<string, unknown>
  const { stage: _stage, ...rest } = meta
  const out: Record<string, unknown> = { ...rest }
  switch (asset.stage) {
    case 'script':
      // §14 逆：script 的 prompt → content；序列化时 content → data.prompt
      if (asset.content != null) out.prompt = asset.content
      break
    case 'voice':
    case 'foley':
    case 'bgm':
      out.audioType = asset.stage
      break
    case 'mix':
      // 服务端无 mix 强制 audioType，migrate 缺省 → 重载落 voice（有损，research 裁定）。
      warn(
        `节点 ${asset.id}: stage 'mix' 序列化为 type 'audio' 且 audioType 缺省，` +
        `重载将落 voice（有损，research 裁定）`,
      )
      break
    default:
      break
  }
  return out
}

/** V3 执行状态 → V2 wire 状态（failed→error；其余直通）。 */
function wireStateOf(asset: AssetNodeV3): NodeStateV2Wire {
  return asset.state === 'failed' ? 'error' : asset.state
}

// ─── serializeGraphToV2 ──────────────────────────────────

/**
 * canonical V3 graph → FlowGraphV2 wire 形状（save-v2 body.graph）。
 *
 * @param graph           store.graph（canonical，唯一真值源）
 * @param rawDataByNodeId adaptV2Graph 产出的原始 data 袋；null（fixture / V3 直通）
 *                        时退化为纯 flattenMeta，不 throw（地雷 #6）
 * @param viewport        当前画布视口（P17：viewport 是数据）；缺省回退 graph.meta.viewport
 * @param warningsOut     可选出参：有损映射（mix 缺省 audioType、locked→single、边丢弃）逐条推入
 */
export function serializeGraphToV2(
  graph: FlowGraphV3,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
  viewport?: { x: number; y: number; zoom: number },
  warningsOut?: string[],
): FlowGraphV2WireShape {
  const warnings: string[] = []
  const warn: Warn = (msg) => {
    warnings.push(msg)
    if (warningsOut) warningsOut.push(msg)
  }

  // ── 事件配方反向覆盖索引（Phase 52-02，地雷 #1）：assetId → 产生事件 ──
  // 经 role:'output' 边反查（唯一正道）；资产无产生事件时不在表中 → 不写不伪造。
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const producingEventByAssetId = new Map<string, EventNodeV3>()
  for (const l of graph.links) {
    if (l.role !== 'output' || producingEventByAssetId.has(l.target)) continue
    const src = nodeById.get(l.source)
    if (src != null && src.kind === 'event') producingEventByAssetId.set(l.target, src)
  }

  // ── 节点：仅资产节点落盘；event 不落盘（折叠语义），structure 在 V2 无实体同弃 ──
  const nodes: FlowNodeV2Wire[] = []
  const persistedIds = new Set<string>()
  for (const n of graph.nodes) {
    if (n.kind !== 'asset') continue
    const raw = rawDataByNodeId?.get(n.id)
    // 地雷 #1 防线：rawData 合并为强制公式——audio 必填字段（shot_id/engine/duration_sec）
    // 与白名单外字段的唯一存活地。flattenMeta 在后，canonical meta 覆盖同名字段。
    const data: Record<string, unknown> = { ...raw, ...flattenMeta(n, warn) }

    // 事件配方反向覆盖（Phase 52-02 地雷 #1 + Phase 58 全集拓宽）：在
    // {...raw, ...flattenMeta} 之后覆盖，canonical 事件配方为最终真值。
    // Phase 58：九键全集 round-trip（RECIPE_ROUNDTRIP_KEYS 映射表驱动，
    // modelVersion→engine 键名映射由映射表承载）；params 有值→写，缺键→同步
    // delete data 同键（delete 传播：「空 = 未设置」清空语义，防 rawData 陈旧值
    // 复活——updateEventParams 空值删除的对称面，顺手覆盖 prompt 清空 '' 同款
    // 潜在复活）。script stage 跳过 prompt 覆盖（52-02 例外保留：真值是
    // content，flattenMeta 已处理，P4 防两处抄）。
    const producingEvt = producingEventByAssetId.get(n.id)
    if (producingEvt != null) {
      const p = producingEvt.params as Record<string, unknown>
      for (const { p: pk, d: dk } of RECIPE_ROUNDTRIP_KEYS) {
        if (n.stage === 'script' && pk === 'prompt') continue // 52-02 例外保留
        const v = p[pk]
        if (v != null) data[dk] = v
        else delete data[dk] // delete 传播：canonical 缺键 = 清空 → wire 同步删，防 rawData 复活
      }
    }
    // stale 上 wire（Phase 52-02 地雷 #2）：服务端 orchestrate 只读持久化 blob，
    // stale-success 不跳过需要信息源；顺带修复 stale 刷新即丢（migrate d.stale 还原）。
    if (n.stale != null) {
      data.stale = {
        since: n.stale.since,
        triggerAssetId: n.stale.triggerAssetId,
        triggerEventId: n.stale.triggerEventId,
      }
    }
    // filePath/thumbnailUrl 仅在非空时覆盖（不抹 rawData 里的原值；空媒体不伪造字段）。
    // 服务端 schema 的 filePath 对 asset 型已 nullish 宽容、audio/video 型同样 nullish
    // （52-UAT gap#1 存量先例：sync 写入路径无「管线数据保证必填」——该假设已被
    // 2026-08-22 修前诊断回放证伪；字段在场时形状仍强制），序列化器依旧不兜底。
    if (n.media.original != null) data.filePath = n.media.original
    if (n.media.thumbnail != null) data.thumbnailUrl = n.media.thumbnail
    // media.durationS 回写 data.durationS（storyboard 已由 flattenMeta 覆盖；video/audio
    // 等靠它 round-trip 媒体时长）。
    if (n.media.durationS != null && data.durationS == null) data.durationS = n.media.durationS

    const node: FlowNodeV2Wire = {
      id: n.id,
      type: wireTypeOf(n, raw?.type),
      branchId: n.branchId,
      phaseIndex: n.phaseIndex,
      phaseName: n.phaseName,
      position: { ...n.position },
      size: { ...n.size },
      data,
      state: wireStateOf(n),
    }
    if (n.reviewStatus != null) node.reviewStatus = n.reviewStatus
    if (n.aiScore != null) node.aiScore = n.aiScore
    // §14 逆：isWinner → curation:'selected'；序列化时 curation=='selected' → 顶层 isWinner
    if (n.curation === 'selected') node.isWinner = true
    if (n.variantGroupId != null) node.variantGroupId = n.variantGroupId
    nodes.push(node)
    persistedIds.add(n.id)
  }

  // ── 边：event 折叠（同 graphToViewModel）——event 经 role:'output' 边映射到产出资产，
  //    非 output 边端点是 event 则替换为该资产；output 边与自环丢弃 ──
  const eventToAsset = new Map<string, string>()
  for (const l of graph.links) {
    if (l.role === 'output' && !eventToAsset.has(l.source)) eventToAsset.set(l.source, l.target)
  }
  const links: FlowLinkV2Wire[] = []
  for (const l of graph.links) {
    if (l.role === 'output') continue // event→asset 闭环边不落盘（reload 时 migrate 1:1 重建）
    const source = eventToAsset.get(l.source) ?? l.source
    const target = eventToAsset.get(l.target) ?? l.target
    if (source === target) continue // event 折叠后自环 → 无因果意义，丢弃
    if (!persistedIds.has(source) || !persistedIds.has(target)) {
      warn(`边 ${l.id}（${l.source}→${l.target}）: 端点在 V2 无实体（event/structure），丢弃`)
      continue
    }
    links.push({
      id: l.id,
      source,
      target,
      branchId: l.branchId,
      dataType: l.role, // role→dataType（自由字符串；reload 由 migrate 重新推断 role）
      ...(l.isExplore === true ? { isExplore: true } : {}),
      ...(l.isInactive === true ? { isInactive: true } : {}),
    })
  }

  // ── 分支 shim（有损：status 不回真，与 adapter 现状同级——地雷 #7，本 phase 不治本） ──
  const now = Date.now()
  const branches: FlowBranchV2Wire[] = graph.branches.map((b) => ({
    id: b.id,
    label: b.name,
    ...(b.parentBranchId != null ? { parentId: b.parentBranchId } : {}),
    status: 'active',
    forkReason: '',
    createdAt: b.createdAt ?? now,
    updatedAt: now,
  }))

  // ── 变体组：locked→single + warning（地雷 #3：服务端 zod 无 locked 槽位，防整图 400） ──
  const variantGroups: VariantGroupV2Wire[] = graph.variantGroups.map((g: VariantGroupV3) => {
    let selectMode: 'single' | 'multi'
    if (g.selectMode === 'locked') {
      warn(
        `变体组 ${g.id}: selectMode 'locked' 在服务端 V2 zod 无槽位，映射 'single' 防整图 400` +
        `（解构集锁定语义仅前端展示层）`,
      )
      selectMode = 'single'
    } else {
      selectMode = g.selectMode
    }
    const members = g.variantNodeIds.filter((id) => persistedIds.has(id))
    return {
      id: g.id,
      phaseIndex: g.phaseIndex,
      branchId: g.branchId,
      variantNodeIds: members,
      ...(g.winnerNodeId != null && members.includes(g.winnerNodeId)
        ? { winnerNodeId: g.winnerNodeId }
        : {}),
      selectMode,
    }
  })

  const vp = viewport ?? graph.meta.viewport
  return {
    meta: {
      version: '2',
      projectId: graph.meta.projectId,
      episodesId: graph.meta.episodesId,
      ...(graph.meta.pipelineId != null ? { pipelineId: graph.meta.pipelineId } : {}),
      createdAt: graph.meta.createdAt,
      updatedAt: graph.meta.updatedAt,
      ...(vp ? { viewport: { ...vp } } : {}),
    },
    nodes,
    links,
    branches,
    variantGroups,
  }
}
