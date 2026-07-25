/**
 * src/v3/adapter.ts — V2 → V3 适配层（SPEC-step5 A.2，宪法 P22 消费端宽松）。
 *
 * 两个出口：
 *  - adaptV2Graph(raw)：真实后端 V2 payload（_recon/flowgraph-v2.ts 形状）→ FlowGraphV3。
 *    复用包内 migrateV2toV3；shape 不吻合处在本层预归一化。单节点/边解析失败 → 跳过 + warning，
 *    绝不 throw 崩画布；产出保证过包内 zod（validateFlowGraphV3），修不好就降级为空图 + warnings。
 *  - graphToViewModel(graph)：V3 → React Flow 视图模型。位置来自包内 layoutFlowGraph
 *    （dagre 被替换，P7/P8/P9/P11 由布局引擎保证）；deprecated 变体不生成独立 RF 节点
 *    （牌堆数据挂 winner 的 node.data.variantStack）；事件节点 → 26×26 chip；边 role/isInactive → data 通道。
 *
 * orchestrator 裁定的归一化（详见报告映射表）：
 *  - NodeState：cached → success（且 stale=null）；skipped → failed；idle → pending。
 *  - meta 时间戳：ISO string → number(ms)。
 *  - 叙事线 timeline（1975/2000/2025/dream/flashback）：V3 无合法槽位（storyboard meta strict），
 *    不私建字段 → 逐节点进 warnings，等宪法补字段。
 *  - VariantGroup：一律后端 V2 → migrate → VariantGroupV3；前端旧 {groupId,parentNodeId} 模型废弃。
 */
import {
  migrateV2toV3,
  validateFlowGraphV3,
  checkReferentialIntegrity,
  layoutFlowGraph,
  type FlowGraphV3,
  type FlowNodeV3,
  type AssetNodeV3,
  type FlowLinkV3,
  type VariantGroupV3,
  type Stage,
  type FlowGraphV2Export,
  type FlowNodeV2,
  type FlowLinkV2,
} from '@kais/flowgraph-v3'
import type { Node, Edge } from '@xyflow/react'

// ─── 常量 ────────────────────────────────────────────────

/** 事件芯片尺寸（SPEC A.2：事件节点 → 26×26 chip）。 */
export const EVENT_CHIP_SIZE = 26

/** RF 节点 type 命名（B 代理注册 nodeTypes 的接缝）：资产 = stage 字符串；事件/结构固定键。 */
export const RF_TYPE_EVENT_CHIP = 'eventChip'
export const RF_TYPE_STRUCTURE = 'structure'

/** migrate 支持的 V2 节点类型（§14 左列）。 */
const MIGRATE_SUPPORTED_TYPES = new Set([
  'script', 'storyboard', 'video', 'audio', 'asset',
  'upscale', 'face_restore', 'variant', 'reference',
])

// ─── V2 预归一化 ─────────────────────────────────────────

type Warn = (msg: string) => void

/** ISO string → number(ms)；number 原样；其它 → null。 */
function toMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return null
}

/**
 * NodeState 归一（orchestrator 裁定）：
 *  cached → 'success'（§2.5：缓存命中即有效产物，非 stale——stale 由迁移默认 null 满足）
 *  skipped → 'failed'（编排跳过的节点按失败侧归类，UI 沿用 failed 通道展示）
 *  idle → 'pending'（V2 前端枚举余值，V3 无 idle）
 */
function normalizeNodeState(v: unknown, nodeId: string, warn: Warn): FlowNodeV2['state'] {
  switch (v) {
    case 'pending':
    case 'running':
    case 'success':
    case 'failed':
      return v
    case 'cached':
      return 'success'
    case 'skipped':
      return 'failed'
    case 'idle':
      return 'pending'
    case undefined:
    case null:
      return undefined // 交 migrate 默认
    default:
      warn(`节点 ${nodeId}: state "${String(v)}" 无法识别，默认 success`)
      return 'success'
  }
}

/** 后端节点类型 → migrate 可消费类型；不可消费 → null（跳过 + warning）。 */
function normalizeNodeType(t: unknown, nodeId: string, warn: Warn): string | null {
  if (typeof t !== 'string') {
    warn(`节点 ${nodeId}: type 缺失/非字符串（${String(t)}），跳过`)
    return null
  }
  if (MIGRATE_SUPPORTED_TYPES.has(t)) return t
  switch (t) {
    case 'zone':
    case 'phase':
      // P8：泳道由资产 stage 派生，zone/phase 分区节点在 V3 无实体，布局引擎接管分区语义。
      warn(`节点 ${nodeId}: type '${t}' 在 V3 无实体（泳道/分区由 stage 派生，P8），跳过`)
      return null
    case 'suggestion':
      // V3 无 suggestion 实体（AI 建议不建仓，P3 三实体分权）。
      warn(`节点 ${nodeId}: type 'suggestion' 在 V3 无实体，跳过`)
      return null
    case '3d':
      // 3d 无对应 Stage/modality 枚举，待宪法裁决；消费端宽松 = 跳过不崩。
      warn(`节点 ${nodeId}: type '3d' 无对应 V3 stage/modality（待宪法裁决），跳过`)
      return null
    default:
      warn(`节点 ${nodeId}: 未知 type '${t}'，跳过（P22 消费端宽松）`)
      return null
  }
}

/** 单节点归一化（消费端宽松：任何字段坏都只影响该节点）。 */
function normalizeNode(raw: unknown, warn: Warn): FlowNodeV2 | null {
  if (raw == null || typeof raw !== 'object') {
    warn(`节点条目非对象（${typeof raw}），跳过`)
    return null
  }
  const n = raw as Record<string, unknown>
  const id = typeof n.id === 'string' && n.id ? n.id : null
  if (!id) {
    warn(`节点缺 id，跳过: ${JSON.stringify(raw).slice(0, 120)}`)
    return null
  }
  try {
    const type = normalizeNodeType(n.type, id, warn)
    if (!type) return null
    const data = (n.data != null && typeof n.data === 'object'
      ? { ...(n.data as Record<string, unknown>) }
      : {}) as NonNullable<FlowNodeV2['data']>

    // orchestrator 裁定：叙事线 timeline（1975/2000/2025/dream/flashback）在 V3
    // storyboard meta 判别联合（strict）中无合法槽位——不私建字段，进 warnings 待宪法补位。
    if (data.timeline != null) {
      warn(
        `节点 ${id}: data.timeline="${String(data.timeline)}"（叙事线枚举）在 V3 meta 无合法槽位，` +
        `按裁定不私建字段，记入 warnings 待宪法补字段`,
      )
      delete data.timeline
    }

    const out: FlowNodeV2 = {
      id,
      type: type as FlowNodeV2['type'],
      branchId: typeof n.branchId === 'string' && n.branchId ? n.branchId : 'br_main',
      data,
    }
    if (typeof n.phaseIndex === 'number') out.phaseIndex = n.phaseIndex
    if (typeof n.phaseName === 'string') out.phaseName = n.phaseName
    if (n.position != null && typeof n.position === 'object') {
      const p = n.position as Record<string, unknown>
      if (typeof p.x === 'number' && typeof p.y === 'number') out.position = { x: p.x, y: p.y }
    }
    if (n.size != null && typeof n.size === 'object') {
      const s = n.size as Record<string, unknown>
      if (typeof s.width === 'number' && typeof s.height === 'number')
        out.size = { width: s.width, height: s.height }
    }
    const state = normalizeNodeState(n.state, id, warn)
    if (state !== undefined) out.state = state
    if (n.isWinner === true) out.isWinner = true
    if (n.reviewStatus === 'pending' || n.reviewStatus === 'approved' || n.reviewStatus === 'rejected') {
      out.reviewStatus = n.reviewStatus
    } else if (n.reviewStatus != null) {
      warn(`节点 ${id}: reviewStatus "${String(n.reviewStatus)}" 非法，丢弃`)
    }
    if (typeof n.aiScore === 'number') out.aiScore = n.aiScore
    else if (n.aiScore != null && typeof n.aiScore === 'object') out.aiScore = n.aiScore as FlowNodeV2['aiScore']
    // variantOf/variantGroupId（后端 V2 节点级冗余字段）不进包内迁移输入——
    // 组成员关系一律以后端 variantGroups 数组为准（见 synthesizeVariantNodes）。
    return out
  } catch (err) {
    warn(`节点 ${id}: 归一化异常（${(err as Error).message}），跳过`)
    return null
  }
}

/** 单边归一化。 */
function normalizeLink(raw: unknown, index: number, warn: Warn): FlowLinkV2 | null {
  if (raw == null || typeof raw !== 'object') {
    warn(`边[${index}] 非对象，跳过`)
    return null
  }
  const l = raw as Record<string, unknown>
  if (typeof l.source !== 'string' || !l.source || typeof l.target !== 'string' || !l.target) {
    warn(`边[${index}]（id=${String(l.id)}）source/target 缺失，跳过`)
    return null
  }
  const out: FlowLinkV2 = { source: l.source, target: l.target }
  out.id = typeof l.id === 'string' && l.id ? l.id : `lv2_${index}`
  // dataType 原样透传（string，含 'output'/'sequence'/'reference'/'variant' 等实际值），
  // 角色推断由 migrate 负责（RECON §3：后端 dataType 无枚举约束）。
  if (typeof l.dataType === 'string') out.dataType = l.dataType
  if (l.isExplore === true) out.isExplore = true
  return out
}

interface BackendVariantGroup {
  id: string
  phaseIndex?: number
  branchId?: string
  variantNodeIds: string[]
  winnerNodeId?: string
  selectMode?: 'single' | 'multi' | string
}

/** 宽松读取后端 VariantGroupV2（{id, phaseIndex, branchId, variantNodeIds, winnerNodeId?, selectMode}）。 */
function normalizeBackendGroup(raw: unknown, index: number, warn: Warn): BackendVariantGroup | null {
  if (raw == null || typeof raw !== 'object') {
    warn(`variantGroups[${index}] 非对象，跳过`)
    return null
  }
  const g = raw as Record<string, unknown>
  const id = typeof g.id === 'string' && g.id ? g.id : typeof g.groupId === 'string' && g.groupId ? g.groupId : null
  if (!id) {
    warn(`variantGroups[${index}] 缺 id，跳过`)
    return null
  }
  const members = Array.isArray(g.variantNodeIds)
    ? g.variantNodeIds.filter((x): x is string => typeof x === 'string' && !!x)
    : []
  if (members.length === 0) {
    warn(`变体组 ${id}: variantNodeIds 为空，跳过`)
    return null
  }
  return {
    id,
    phaseIndex: typeof g.phaseIndex === 'number' ? g.phaseIndex : undefined,
    branchId: typeof g.branchId === 'string' ? g.branchId : undefined,
    variantNodeIds: members,
    winnerNodeId: typeof g.winnerNodeId === 'string' ? g.winnerNodeId : undefined,
    selectMode: typeof g.selectMode === 'string' ? g.selectMode : undefined,
  }
}

/**
 * 后端 VariantGroupV2 → 合成 type:'variant' 节点 + 'variant' 归属边（包内 migrate Pass 3 的输入）。
 * orchestrator 裁定：一律以后端 V2 → migrate → VariantGroupV3 为准，
 * 借用 migrate 的多输出归组语义（候选事件合并、非 winner 配方留存 variantRecipes、下游边置灰）。
 * 返回组 id → selectMode 的后处理表。
 */
function synthesizeVariantNodes(
  groups: BackendVariantGroup[],
  nodes: FlowNodeV2[],
  links: FlowLinkV2[],
  warn: Warn,
): { selectModeBySynthId: Map<string, 'single' | 'multi'> } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const selectModeBySynthId = new Map<string, 'single' | 'multi'>()

  // 已被显式 type:'variant' 节点消费的候选集合（避免重复建组）
  const consumed = new Set<string>()
  const variantNodeIds = new Set(nodes.filter((n) => n.type === 'variant').map((n) => n.id))
  for (const l of links) {
    if (l.dataType === 'variant' && variantNodeIds.has(l.target)) consumed.add(l.source)
  }

  for (const g of groups) {
    const members = g.variantNodeIds.filter((id) => nodeById.has(id) && !consumed.has(id))
    if (members.length === 0) {
      warn(`变体组 ${g.id}: 成员均不存在或已被 variant 节点消费，跳过建组`)
      continue
    }
    const branchId = g.branchId ?? nodeById.get(members[0]!)?.branchId ?? 'br_main'
    const synthId = `nvar_${g.id}`
    if (nodeById.has(synthId)) {
      warn(`变体组 ${g.id}: 合成 variant 节点 id ${synthId} 冲突，跳过建组`)
      continue
    }
    // winner：组级 winnerNodeId 为权威（覆盖节点级 isWinner）
    if (g.winnerNodeId && members.includes(g.winnerNodeId)) {
      for (const m of members) {
        const n = nodeById.get(m)!
        n.isWinner = m === g.winnerNodeId
      }
    } else if (g.winnerNodeId) {
      warn(`变体组 ${g.id}: winnerNodeId ${g.winnerNodeId} 不在成员内，winner 由迁移按 isWinner/首候选裁定`)
    }
    const synthNode: FlowNodeV2 = {
      id: synthId,
      type: 'variant',
      branchId,
      phaseIndex: g.phaseIndex ?? nodeById.get(members[0]!)?.phaseIndex,
      phaseName: 'variant',
      state: 'success',
      data: {},
    }
    nodes.push(synthNode)
    nodeById.set(synthId, synthNode)
    for (const m of members) {
      links.push({
        id: `lv_${g.id}_${m}`,
        source: m,
        target: synthId,
        dataType: 'variant',
      })
    }
    if (g.selectMode === 'multi') selectModeBySynthId.set(`vg_${synthId}`, 'multi')
    else if (g.selectMode != null && g.selectMode !== 'single') {
      warn(`变体组 ${g.id}: selectMode "${String(g.selectMode)}" 非法，默认 single（V3 另支持 locked，由解构管线写入）`)
    }
  }
  return { selectModeBySynthId }
}

/** 后端分支 → V3 FlowBranchV2（zod strict：只留 id/name/parentBranchId/createdAt）。 */
function normalizeBranch(raw: unknown, index: number, warn: Warn) {
  if (raw == null || typeof raw !== 'object') {
    warn(`branches[${index}] 非对象，跳过`)
    return null
  }
  const b = raw as Record<string, unknown>
  if (typeof b.id !== 'string' || !b.id) {
    warn(`branches[${index}] 缺 id，跳过`)
    return null
  }
  const name = typeof b.name === 'string' ? b.name : typeof b.label === 'string' ? b.label : null
  if (!name) {
    warn(`分支 ${b.id}: 缺 name/label，跳过`)
    return null
  }
  const createdAt = toMs(b.createdAt)
  if (b.createdAt != null && createdAt === null) warn(`分支 ${b.id}: createdAt 无法解析，丢弃`)
  const parent = typeof b.parentBranchId === 'string' ? b.parentBranchId
    : typeof b.parentId === 'string' ? b.parentId : undefined
  return {
    id: b.id,
    name,
    ...(parent ? { parentBranchId: parent } : {}),
    ...(createdAt != null ? { createdAt } : {}),
  }
}

/**
 * 创作阶段目录（P01–P13）：扫原始节点取 phaseIndex→name。
 *  - zone/phase 容器节点是权威（承载完整阶段名）；adapter 仍丢弃其 V3 实体（无 stage），
 *    但在此提取目录供画布竖向阶段叠加层（PhaseColumns）与卡片使用。
 *  - 无 zone 时退回资产节点的 phaseIndex/phaseName（仍能驱动阶段列）。
 *  - 名字优先级：phaseName > data.label > `P0X`。
 *  zone 与资产同名阶段冲突时 zone 胜（更完整）。
 */
export interface PhaseCatalogEntry {
  index: number
  name: string
}

export function buildPhaseCatalog(rawNodes: unknown[]): PhaseCatalogEntry[] {
  const zone = new Map<number, string>()
  const other = new Map<number, string>()
  const pad = (idx: number): string => `P${String(idx).padStart(2, '0')}`
  for (const raw of rawNodes) {
    if (raw == null || typeof raw !== 'object') continue
    const n = raw as Record<string, unknown>
    const idx = typeof n.phaseIndex === 'number' && Number.isFinite(n.phaseIndex) ? n.phaseIndex : null
    if (idx == null) continue
    const dataLabel = n.data != null && typeof n.data === 'object'
      ? (n.data as Record<string, unknown>).label : undefined
    const label = typeof n.phaseName === 'string' && n.phaseName
      ? n.phaseName
      : typeof dataLabel === 'string' && dataLabel
        ? dataLabel
        : pad(idx)
    const t = n.type
    if (t === 'zone' || t === 'phase') {
      if (!zone.has(idx)) zone.set(idx, label)
    } else if (!other.has(idx)) {
      other.set(idx, label)
    }
  }
  const merged = new Map<number, string>(other)
  for (const [idx, label] of zone) merged.set(idx, label) // zone 胜
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, name]) => ({ index, name }))
}

// ─── zod 修复环（消费端宽松的最后防线） ────────────────────

function emptyGraph(meta: FlowGraphV3['meta']): FlowGraphV3 {
  return { meta, nodes: [], links: [], branches: [], variantGroups: [] }
}

/**
 * 产出必须过包内 zod：失败时按错误路径定位丢弃顶层数组项（nodes/links/branches/variantGroups），
 * 最多 5 轮；meta 级错误无法逐项修复时也先尝试数组项修复，修不好 → 返回空图（保留 meta），绝不 throw。
 */
function repairToValid(graph: FlowGraphV3, warn: Warn): FlowGraphV3 {
  const current = graph
  for (let round = 0; round < 5; round++) {
    const result = validateFlowGraphV3(current)
    if (result.ok) return result.data
    const drop = new Map<string, Set<number>>()
    for (const e of result.errors) {
      const m = e.match(/^(nodes|links|branches|variantGroups)\.(\d+)/)
      if (m) {
        const set = drop.get(m[1]!) ?? new Set<number>()
        set.add(Number(m[2]))
        drop.set(m[1]!, set)
      } else {
        warn(`适配输出校验: ${e}`)
      }
    }
    if (drop.size === 0) {
      warn('适配输出 zod 校验失败且无法定位修复，降级为空图')
      return emptyGraph(current.meta)
    }
    for (const [key, idxs] of drop) {
      const arr = (current as unknown as Record<string, unknown[]>)[key]!
      const removed = [...idxs].sort((a, b) => b - a)
      for (const i of removed) {
        warn(`适配输出校验: ${key}[${i}] 未过 zod，丢弃该项（P22 消费端宽松）`)
        arr.splice(i, 1)
      }
    }
  }
  warn('适配输出 zod 修复超过 5 轮仍未通过，降级为空图')
  return emptyGraph(current.meta)
}

// ─── adaptV2Graph ────────────────────────────────────────

export interface AdaptResult {
  graph: FlowGraphV3
  warnings: string[]
  /** 来源判定：'v2-migrated'（V2 迁移）| 'v3-passthrough'（已是 V3，校验透传）。 */
  source: 'v2-migrated' | 'v3-passthrough'
  /**
   * 每节点原始 data 袋（migrate 白名单之外的字段经此穿透给卡片/详情面板）。
   * key = 节点 id（与 RF node id 一致）。V3 直通 / 空 payload 为空 Map。
   */
  rawDataByNodeId: Map<string, Record<string, unknown>>
  /** 创作阶段目录（P01–P13）；无 zone 时仍含资产所见阶段。详见 buildPhaseCatalog。 */
  phaseCatalog: PhaseCatalogEntry[]
}

/**
 * 真实后端 V2 payload → FlowGraphV3。绝不 throw（P22）。
 * 已是 V3（meta.version==='3'）时直接校验透传（fixture/未来后端直通）。
 */
export function adaptV2Graph(raw: unknown): AdaptResult {
  const warnings: string[] = []
  const warn: Warn = (msg) => warnings.push(msg)

  // V3 直通
  if (raw != null && typeof raw === 'object') {
    const meta = (raw as Record<string, unknown>).meta
    if (meta != null && typeof meta === 'object' && (meta as Record<string, unknown>).version === '3') {
      const graph = repairToValid(raw as FlowGraphV3, warn)
      return { graph, warnings, source: 'v3-passthrough', rawDataByNodeId: new Map(), phaseCatalog: [] }
    }
  }

  if (raw == null || typeof raw !== 'object') {
    warn(`payload 非对象（${typeof raw}），返回空图`)
    return {
      graph: emptyGraph({ version: '3', projectId: 0, episodesId: 0, createdAt: 0, updatedAt: 0 }),
      warnings,
      source: 'v2-migrated',
      rawDataByNodeId: new Map(),
      phaseCatalog: [],
    }
  }

  const root = raw as Record<string, unknown>
  const rawMeta = (root.meta != null && typeof root.meta === 'object' ? root.meta : {}) as Record<string, unknown>

  // meta：ISO string → number(ms)（orchestrator 裁定）
  const createdAt = toMs(rawMeta.createdAt)
  const updatedAt = toMs(rawMeta.updatedAt)
  if (rawMeta.createdAt != null && createdAt === null) warn('meta.createdAt 无法解析为时间，默认 0')
  if (rawMeta.updatedAt != null && updatedAt === null) warn('meta.updatedAt 无法解析为时间，默认 0')
  const projectId = typeof rawMeta.projectId === 'number' ? rawMeta.projectId
    : Number(rawMeta.projectId) || 0
  const episodesId = typeof rawMeta.episodesId === 'number' ? rawMeta.episodesId
    : Number(rawMeta.episodesId) || 0
  if (!rawMeta.projectId) warn('meta.projectId 缺失/非法，默认 0')
  if (!rawMeta.episodesId) warn('meta.episodesId 缺失/非法，默认 0')

  // 节点 / 边 / 组 / 分支：逐条宽松归一
  const rawNodes = Array.isArray(root.nodes) ? root.nodes : []
  if (!Array.isArray(root.nodes)) warn('nodes 缺失/非数组，按空处理')
  // 阶段目录（P01–P13）：zone 容器节点为权威（adapter 丢弃其 V3 实体，仅取目录）。
  const phaseCatalog = buildPhaseCatalog(rawNodes)
  // 每节点原始 data 袋：穿透 migrate 白名单之外的字段（卡片/详情面板消费）。
  // 捕获原始 rn.data（normalizeNode 前的完整袋），key = 存活节点 id。
  const rawDataByNodeId = new Map<string, Record<string, unknown>>()
  const nodes: FlowNodeV2[] = []
  for (const rn of rawNodes) {
    const n = normalizeNode(rn, warn)
    if (n) {
      nodes.push(n)
      const d = (rn as Record<string, unknown> | null)?.data
      if (d != null && typeof d === 'object') rawDataByNodeId.set(n.id, { ...(d as Record<string, unknown>) })
    }
  }

  const rawLinks = Array.isArray(root.links) ? root.links : []
  if (!Array.isArray(root.links)) warn('links 缺失/非数组，按空处理')
  const links: FlowLinkV2[] = []
  rawLinks.forEach((rl, i) => {
    const l = normalizeLink(rl, i, warn)
    if (l) links.push(l)
  })

  const rawGroups = Array.isArray(root.variantGroups) ? root.variantGroups : []
  const groups: BackendVariantGroup[] = []
  rawGroups.forEach((rg, i) => {
    const g = normalizeBackendGroup(rg, i, warn)
    if (g) groups.push(g)
  })
  const { selectModeBySynthId } = synthesizeVariantNodes(groups, nodes, links, warn)

  const rawBranches = Array.isArray(root.branches) ? root.branches : []
  const branches = rawBranches
    .map((rb, i) => normalizeBranch(rb, i, warn))
    .filter((b): b is NonNullable<typeof b> => b != null)

  const v2: FlowGraphV2Export = {
    meta: {
      projectId,
      episodesId,
      ...(typeof rawMeta.pipelineId === 'string' ? { pipelineId: rawMeta.pipelineId } : {}),
      createdAt: createdAt ?? 0,
      updatedAt: updatedAt ?? 0,
      ...(rawMeta.viewport != null && typeof rawMeta.viewport === 'object'
        ? { viewport: rawMeta.viewport as { x: number; y: number; zoom: number } }
        : {}),
    },
    nodes,
    links,
    branches: branches as FlowGraphV2Export['branches'],
  }

  // 包内迁移（结构已归一，不应 throw；仍兜底——绝不崩画布）
  let graph: FlowGraphV3
  try {
    const migrated = migrateV2toV3(v2)
    graph = migrated.graph
    warnings.push(...migrated.report.warnings)
  } catch (err) {
    warn(`migrateV2toV3 异常（${(err as Error).message}），降级为空图`)
    return {
      graph: emptyGraph({
        version: '3', projectId, episodesId,
        ...(typeof rawMeta.pipelineId === 'string' ? { pipelineId: rawMeta.pipelineId } : {}),
        createdAt: createdAt ?? 0, updatedAt: updatedAt ?? 0,
      }),
      warnings,
      source: 'v2-migrated',
      rawDataByNodeId,
      phaseCatalog,
    }
  }

  // 后处理：后端 selectMode 落到迁移产物（migrate 固定产 'single'）
  for (const g of graph.variantGroups) {
    const mode = selectModeBySynthId.get(g.id)
    if (mode) g.selectMode = mode
  }

  // 引用完整性：迁移已自清，残留记 warnings（不静默透传）
  for (const issue of checkReferentialIntegrity(graph)) {
    warn(`引用完整性: ${issue.path} ${issue.message}`)
  }

  graph = repairToValid(graph, warn)
  return { graph, warnings, source: 'v2-migrated', rawDataByNodeId, phaseCatalog }
}

// ─── graphToViewModel ────────────────────────────────────

/** 变体牌堆数据（deprecated 成员不生成 RF 节点，挂在 winner 的 data 上，P12）。 */
export interface VariantStackData {
  groupId: string
  selectMode: VariantGroupV3['selectMode']
  winnerNodeId?: string
  /** 折叠的候选（deprecated 成员 + winner 自身按组序）。 */
  candidates: Array<{
    id: string
    thumbnail: string | null
    seed?: number
    state: FlowNodeV3['state']
    curation: AssetNodeV3['curation']
  }>
  count: number
}

export interface ViewModel {
  rfNodes: Node[]
  rfEdges: Edge[]
}

/** stage → RF 节点 type（B 注册 nodeTypes 的键；资产直接用 stage 字符串）。 */
function rfTypeOfAsset(node: AssetNodeV3): string {
  return node.stage
}

/** stage → 旧渲染器 key（过渡兼容：让 B 落地前旧节点组件仍能渲染主模态）。 */
function legacyTypeOfStage(stage: Stage): string {
  switch (stage) {
    case 'script': return 'script'
    case 'storyboard': return 'storyboard'
    case 'keyframe': return 'asset'
    case 'video':
    case 'composite': return 'video'
    case 'voice':
    case 'foley':
    case 'bgm':
    case 'mix': return 'audio'
    case 'global': return 'asset'
  }
}

/** role → 旧边语义（过渡兼容 CanvasEdge 的 linkType/dataType 着色）。 */
function legacyEdgeSemantics(link: FlowLinkV3): { linkType: string; dataType: string } {
  if (link.role === 'sequence') return { linkType: 'sequence', dataType: 'data' }
  if (link.role === 'reference' || link.role === 'lora_ref' || link.role === 'prompt_ref')
    return { linkType: 'reference', dataType: 'data' }
  return { linkType: 'data_flow', dataType: 'data' }
}

/** 资产对应产出事件的 seed（variantStack candidates 摘要用）。 */
function seedOfAsset(graph: FlowGraphV3, assetId: string): number | undefined {
  const outEdge = graph.links.find((l) => l.role === 'output' && l.target === assetId)
  if (!outEdge) return undefined
  const evt = graph.nodes.find((n) => n.id === outEdge.source)
  if (!evt || evt.kind !== 'event') return undefined
  const seed = (evt.params as Record<string, unknown>).seed
  return typeof seed === 'number' ? seed : undefined
}

/**
 * V3 → React Flow 视图模型（纯函数）。
 *  - 位置来自包内 layoutFlowGraph（替换 dagre；position 字段仅为缓存，不作权威）。
 *  - curation:'deprecated' 不生成独立 RF 节点；牌堆数据挂 winner node.data.variantStack。
 *  - 事件节点不渲染：asset→event→asset 折叠为 asset→asset 直连因果边（事件经其 role:'output'
 *    边映射到产出资产；output 边丢弃，非 output 边端点是 event 则替换为其资产）。画布只显示
 *    script/asset/storyboard/video 实体 + 它们之间的因果 link，不合成任何虚拟节点。
 *  - 边 role/isInactive/isExplore/slotParams/branchId → edge.data 通道；指向 deprecated 成员的边随节点折叠。
 */
export function graphToViewModel(graph: FlowGraphV3): ViewModel {
  const boxes = layoutFlowGraph(graph)
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

  // P12：deprecated 成员 → winner 牌堆
  const stackByWinner = new Map<string, VariantStackData>()
  const foldedIds = new Set<string>() // 被折叠（不渲染）的 deprecated 节点
  for (const g of graph.variantGroups) {
    if (g.selectMode === 'locked') continue // 解构集整组锁定展示，正常布局（§11）
    const deprecated = g.variantNodeIds.filter((id) => {
      const n = nodeById.get(id)
      return n && n.kind === 'asset' && n.curation === 'deprecated'
    })
    if (deprecated.length === 0) continue
    const winnerId = g.winnerNodeId && nodeById.has(g.winnerNodeId) ? g.winnerNodeId : undefined
    if (!winnerId) continue // 无 winner 的 deprecated 退回正常布局（与包内 layout 一致）
    const candidates = g.variantNodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is AssetNodeV3 => !!n && n.kind === 'asset')
      .map((n) => ({
        id: n.id,
        thumbnail: n.media.thumbnail,
        seed: seedOfAsset(graph, n.id),
        state: n.state,
        curation: n.curation,
      }))
    stackByWinner.set(winnerId, {
      groupId: g.id,
      selectMode: g.selectMode,
      ...(g.winnerNodeId ? { winnerNodeId: g.winnerNodeId } : {}),
      candidates,
      count: candidates.length,
    })
    for (const id of deprecated) foldedIds.add(id)
  }

  // 事件不渲染：asset→event→asset 折叠为 asset→asset 直连因果边。
  // event 节点经其 role:'output' 边映射到产出资产；非 output 边端点是 event 则替换为该资产。
  const eventToAsset = new Map<string, string>() // eventId → 产出 assetId
  for (const l of graph.links) {
    if (l.role === 'output' && !eventToAsset.has(l.source)) eventToAsset.set(l.source, l.target)
  }
  const resolveEndpoint = (id: string): string => eventToAsset.get(id) ?? id

  const rfNodes: Node[] = []
  const present = new Set<string>()

  for (const n of graph.nodes) {
    if (foldedIds.has(n.id)) continue // P12：deprecated 无独立 RF 节点
    if (n.kind === 'event') continue // 事件不渲染：折叠为 asset→asset 因果边（见下方 resolveEndpoint）
    const box = boxes.get(n.id)
    const position = box ? { x: box.x, y: box.y } : n.position

    if (n.kind === 'asset') {
      const stack = stackByWinner.get(n.id)
      rfNodes.push({
        id: n.id,
        type: rfTypeOfAsset(n),
        position,
        width: n.size.width,
        height: n.size.height,
        data: {
          // V3 权威载荷（B/C/D 消费入口）
          v3: n,
          stage: n.stage,
          modality: n.modality,
          scope: n.scope,
          media: n.media,
          meta: n.meta,
          ...(n.content != null ? { content: n.content } : {}),
          ...(n.timeline != null ? { timeline: n.timeline } : {}),
          curation: n.curation,
          stale: n.stale,
          ...(n.variantGroupId != null ? { variantGroupId: n.variantGroupId } : {}),
          ...(stack ? { variantStack: stack } : {}),
          // 旧组件过渡别名（flowDataMapper/节点组件的既有 data 契约）
          label: n.phaseName || n.id,
          type: legacyTypeOfStage(n.stage),
          filePath: n.media.original,
          thumbnailUrl: n.media.thumbnail,
          state: n.state,
          ...(n.reviewStatus != null ? { reviewStatus: n.reviewStatus } : {}),
          ...(n.aiScore != null ? { aiScore: n.aiScore } : {}),
          isWinner: n.curation === 'selected' && n.variantGroupId != null,
        },
      })
      present.add(n.id)
    } else {
      rfNodes.push({
        id: n.id,
        type: RF_TYPE_STRUCTURE,
        position,
        width: n.size.width,
        height: n.size.height,
        data: { v3: n, label: n.phaseName || n.id, type: RF_TYPE_STRUCTURE, state: n.state },
      })
      present.add(n.id)
    }
  }

  const rfEdges: Edge[] = []
  for (const l of graph.links) {
    // output 边（event→asset）随 event 折叠丢弃
    if (l.role === 'output') continue
    // 端点是 event 则替换为其产出资产（asset→event→asset → asset→asset）
    const source = resolveEndpoint(l.source)
    const target = resolveEndpoint(l.target)
    // event 折叠后两端指向同一资产（自环）→ 无因果意义，丢弃
    if (source === target) continue
    // 折叠进牌堆的 deprecated 节点不渲染，其边随之折叠（含 isInactive 置灰边）
    if (!present.has(source) || !present.has(target)) continue
    const legacy = legacyEdgeSemantics(l)
    rfEdges.push({
      id: l.id,
      source,
      target,
      type: 'canvas',
      data: {
        // V3 通道（B 的边三态渲染消费）
        role: l.role,
        isInactive: l.isInactive === true,
        isExplore: l.isExplore === true,
        branchId: l.branchId,
        ...(l.slotParams != null ? { slotParams: l.slotParams } : {}),
        v3: l,
        // 旧 CanvasEdge 过渡别名
        linkType: legacy.linkType,
        dataType: legacy.dataType,
      },
    })
  }

  return { rfNodes, rfEdges }
}

// ─── memo 化派生 selector ────────────────────────────────

const viewModelCache = new WeakMap<FlowGraphV3, ViewModel>()

/**
 * graphToViewModel 的 memo 化版本：同一 graph 引用返回同一 ViewModel 引用
 * （store 派生 selector 接缝——RF nodes/edges 引用稳定，组件 memo 有效）。
 */
export function getViewModel(graph: FlowGraphV3): ViewModel {
  const hit = viewModelCache.get(graph)
  if (hit) return hit
  const vm = graphToViewModel(graph)
  viewModelCache.set(graph, vm)
  return vm
}
