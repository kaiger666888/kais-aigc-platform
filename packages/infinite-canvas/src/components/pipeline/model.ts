/**
 * src/components/pipeline/model.ts — 管线状态机视图的纯数据层。
 *
 * 完全从现有画布数据派生（不引入新后端 API）：
 *  - 管线骨架 = 17 阶段权威注册表（PIPELINE_PHASES，P01–P15 含 P09b/P10b/P10c 子阶段）；
 *  - 每阶段执行状态 = 该 phaseIndex 下 RF 节点 data.state 聚合（success/failed/running/pending）；
 *  - slot 完成度 = 同阶段资产按 stage 子类分组计数（dynamic 显示 [N files]）；
 *  - 资产三态 = V3 curation（selected/candidate/deprecated/locked）+ 旧 isPrimaryView/curationState 回退；
 *  - 待决策数 = candidate（未选定）资产数 → ⚠️「N 个待选资产需人工决策」。
 *
 * 与 flowgraph-v3 解耦：经最小类型守卫读取 node.data.v3，data 形态由 adapter (getViewModel)
 * 保证（资产 RF node data.v3 = AssetNodeV3）。无 v3 时回退到 data 顶层字段。
 */
import type { Node } from '@xyflow/react'
import type { AssetNodeV3, Stage } from '@kais/flowgraph-v3'
import { PHASE_GROUPS, type PhaseGroup } from '../../constants'

export type { PhaseGroup }

// ─── 阶段执行状态（展示态） ──────────────────────────────────
export type PhaseExecState = 'completed' | 'running' | 'failed' | 'awaiting_review' | 'pending'

// ─── 管线骨架（权威注册表） ──────────────────────────────────
export interface PipelinePhaseDef {
  /** 全局排序键（1..17），决定横向流水线顺序与依赖链。 */
  sortKey: number
  /** 阶段码：P01 / P09b …（UI 序号，英文） */
  code: string
  /** 中文名 */
  name: string
  /** 所属分组 */
  group: PhaseGroup
  /** 图数据整数 phaseIndex（子阶段复用主阶段 index；sub=true 不参与资产计数） */
  phaseIndex: number
  /** 审计/预览 gate：不承载独立资产槽位 */
  sub?: boolean
}

/**
 * KMC pipeline PHASE_REGISTRY 的前端固化镜像（17 阶段）。
 * 顺序即依赖链（线性 depends_on）。phaseIndex 与图节点 phaseIndex 对齐用于数据匹配；
 * P09b/P10c/P10b 为 gate 子阶段（shot_audit / voice_audit / rapid_preview），
 * 复用主阶段 phaseIndex 但 sub=true → 仅作流水线节点展示，不重复计入资产。
 */
export const PIPELINE_PHASES: readonly PipelinePhaseDef[] = [
  { sortKey: 1, code: 'P01', name: '选题/钩子', group: 'research', phaseIndex: 1 },
  { sortKey: 2, code: 'P02', name: '大纲', group: 'research', phaseIndex: 2 },
  { sortKey: 3, code: 'P03', name: '剧本审计', group: 'story', phaseIndex: 3 },
  { sortKey: 4, code: 'P04', name: '角色设计', group: 'story', phaseIndex: 4 },
  { sortKey: 5, code: 'P06', name: '时空剧本', group: 'production', phaseIndex: 6 },
  { sortKey: 6, code: 'P07', name: '场景图生成', group: 'production', phaseIndex: 7 },
  { sortKey: 7, code: 'P08', name: '场景选择', group: 'production', phaseIndex: 8 },
  { sortKey: 8, code: 'P09', name: '分镜拆解', group: 'production', phaseIndex: 9 },
  { sortKey: 9, code: 'P09b', name: '镜头审计', group: 'production', phaseIndex: 9, sub: true },
  { sortKey: 10, code: 'P10', name: '语音合成', group: 'post', phaseIndex: 10 },
  { sortKey: 11, code: 'P10c', name: '语音审计', group: 'post', phaseIndex: 10, sub: true },
  { sortKey: 12, code: 'P10b', name: '快速预览', group: 'post', phaseIndex: 10, sub: true },
  { sortKey: 13, code: 'P11', name: '视频渲染', group: 'post', phaseIndex: 11 },
  { sortKey: 14, code: 'P12', name: '合成', group: 'post', phaseIndex: 12 },
  { sortKey: 15, code: 'P13', name: '交付', group: 'post', phaseIndex: 13 },
  { sortKey: 16, code: 'P14', name: '质量审计', group: 'post', phaseIndex: 14 },
  { sortKey: 17, code: 'P15', name: '反馈', group: 'post', phaseIndex: 15 },
]

/** 分组展示顺序 + 中文名。 */
export const PHASE_GROUP_ORDER: readonly PhaseGroup[] = ['research', 'story', 'production', 'post']

export const PHASE_GROUP_LABELS: Record<PhaseGroup, string> = {
  research: '选题研究',
  story: '故事剧本',
  production: '制作生产',
  post: '后期合成',
}

/** stage → 中文 slot 标签（资产子类分组）。 */
export const STAGE_LABELS: Record<string, string> = {
  global: '角色/世界观',
  script: '剧本',
  storyboard: '分镜',
  keyframe: '关键帧',
  video: '视频',
  voice: '配音',
  foley: '音效',
  bgm: '配乐',
  mix: '混音',
  composite: '成片',
}

// ─── 派生模型 ────────────────────────────────────────────────

export type AssetTriState = 'selected' | 'candidate' | 'eliminated'

export interface AssetSlotGroup {
  /** stage 键（资产子类） */
  stage: string
  /** 中文标签 */
  label: string
  /** 该子类资产数（dynamic：[N files]） */
  count: number
  /** 该子类聚合状态 */
  state: PhaseExecState
}

export interface PipelineAsset {
  nodeId: string
  label: string
  stage: string
  modality: string
  triState: AssetTriState
  reviewStatus: 'approved' | 'pending' | 'rejected' | undefined
  thumbnail: string | null
  state: string
}

export interface PhaseModel {
  def: PipelinePhaseDef
  /** 该阶段是否有真实图节点（false = 未到达/规划中） */
  present: boolean
  execState: PhaseExecState
  /** 该阶段下资产节点数 */
  assetCount: number
  /** 按 stage 分组的 slot 摘要 */
  slots: AssetSlotGroup[]
  /** 资产明细（点击展开看） */
  assets: PipelineAsset[]
  /** 待选（candidate，未选定）资产数 → 需人工决策 */
  pendingDecisionCount: number
}

// ─── 节点字段读取（最小类型守卫，无 any） ──────────────────────

type DataBag = Record<string, unknown>

function dataOf(node: Node): DataBag {
  return (node.data ?? {}) as DataBag
}

function v3Of(node: Node): AssetNodeV3 | undefined {
  const v3 = dataOf(node).v3
  return v3 && typeof v3 === 'object' ? (v3 as AssetNodeV3) : undefined
}

/** 整数 phaseIndex（v3.phaseIndex 优先，回退 data.phaseIndex）。 */
export function phaseIndexOf(node: Node): number | null {
  const v3 = v3Of(node)
  const idx = v3?.phaseIndex ?? dataOf(node).phaseIndex
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : null
}

function strField(node: Node, key: string): string | undefined {
  const v = dataOf(node)[key]
  return typeof v === 'string' ? v : undefined
}

function boolField(node: Node, key: string): boolean | undefined {
  const v = dataOf(node)[key]
  return typeof v === 'boolean' ? v : undefined
}

function stateOf(node: Node): string {
  const v3 = v3Of(node)
  const s = dataOf(node).state ?? v3?.state
  return typeof s === 'string' ? s : 'pending'
}

function stageOf(node: Node): string {
  const v3 = v3Of(node)
  return (v3?.stage ?? dataOf(node).stage ?? 'asset') as Stage | string
}

function reviewStatusOf(node: Node): 'approved' | 'pending' | 'rejected' | undefined {
  const v3 = v3Of(node)
  const rs = v3?.reviewStatus ?? dataOf(node).reviewStatus
  if (rs === 'approved' || rs === 'pending' || rs === 'rejected') return rs
  return undefined
}

/** 缩略图 URL（v3.media.thumbnail → data.thumbnailUrl → v3.media.original → data.filePath）。 */
function thumbnailOf(node: Node): string | null {
  const v3 = v3Of(node)
  const media = v3?.media
  return media?.thumbnail ?? media?.original
    ?? strField(node, 'thumbnailUrl')
    ?? strField(node, 'filePath')
    ?? null
}

/**
 * 资产三态。权威 = V3 curation；缺失时回退 raw sidecar（curationState / isPrimaryView）。
 *  - V3 selected / isPrimaryView=true → selected (★)
 *  - V3 deprecated / curationState='eliminated' → eliminated (✕)
 *  - 其余 → candidate (○)
 *
 * @param raw adapter sidecar 袋（assetType/curationState/isPrimaryView 等白名单外富字段；
 *            migrate 不保留这些字段到 V3，故须经 rawDataByNodeId 穿透读取）。
 */
function triStateOf(node: Node, raw?: Record<string, unknown>): AssetTriState {
  const v3 = v3Of(node)
  const data = dataOf(node)
  const curation = v3?.curation ?? raw?.curation ?? data.curation
  if (curation === 'selected') return 'selected'
  if (curation === 'deprecated') return 'eliminated'
  // locked（解构集）/ candidate 走 raw curationState + isPrimaryView 回退
  const curationState = raw?.curationState ?? data.curationState
  if (curationState === 'eliminated') return 'eliminated'
  if (curationState === 'selected') return 'selected'
  if (raw?.isPrimaryView === true || data.isPrimaryView === true) return 'selected'
  return 'candidate'
}

/**
 * 四态 curation 分类（DAG 细粒度用，比 triStateOf 多一个 'neutral'）。
 * 区分**显式** candidate（raw curationState 明确标 candidate/active，=真待决策）
 * 与 **neutral**（无 curation 信息——多数结构化资产属此类）。
 *
 * ⚠️ 关键：migrate 对**每个**资产默认写入 v3.curation='candidate'（isWinner?'selected':'candidate'），
 * 这是迁移占位而非真实决策。故此处**不**把 v3.curation==='candidate' 当作显式待选——
 * 否则全图泛金。显式信号只认 raw curationState（canvas sync 写入）与 isPrimaryView。
 *  - selected：v3.curation selected（migrate isWinner）/ raw curationState selected / isPrimaryView
 *  - eliminated：v3.curation deprecated / raw curationState eliminated
 *  - candidate：raw curationState 显式 candidate/active
 *  - neutral：无上述显式信号（含 migrate 默认 candidate）
 */
function curationBucket(node: Node, raw?: Record<string, unknown>): 'selected' | 'eliminated' | 'candidate' | 'neutral' {
  const v3 = v3Of(node)
  const data = dataOf(node)
  const curation = v3?.curation ?? raw?.curation ?? data.curation
  const curationState = raw?.curationState ?? data.curationState
  if (curation === 'selected' || curationState === 'selected') return 'selected'
  if (raw?.isPrimaryView === true || data.isPrimaryView === true) return 'selected'
  if (curation === 'deprecated' || curationState === 'eliminated') return 'eliminated'
  // 显式待选：仅认 raw curationState（migrate 默认 candidate 不算）
  if (curationState === 'candidate' || curationState === 'active') return 'candidate'
  return 'neutral'
}

// ─── 聚合 ────────────────────────────────────────────────────

/** 把单个节点 data.state 归一为展示态。 */
function nodeExecState(s: string): PhaseExecState {
  if (s === 'success' || s === 'cached') return 'completed'
  if (s === 'running') return 'running'
  if (s === 'failed' || s === 'error') return 'failed'
  return 'pending'
}

/**
 * 聚合一组节点的执行状态 → 阶段展示态。
 * 规则：有 running → running；有 failed → failed；全 success 且有待审资产 → awaiting_review；
 *      全 success → completed；有 success 也有 pending → running（进行中）；否则 pending。
 */
function aggregateExecState(allNodes: Node[], assetNodes: Node[]): PhaseExecState {
  if (allNodes.length === 0) return 'pending'
  const states = allNodes.map(stateOf)
  if (states.some((s) => s === 'running')) return 'running'
  if (states.some((s) => s === 'failed' || s === 'error')) return 'failed'
  const done = states.every((s) => s === 'success' || s === 'cached')
  if (done) {
    const needsReview = assetNodes.some((n) => reviewStatusOf(n) === 'pending')
    return needsReview ? 'awaiting_review' : 'completed'
  }
  const anySuccess = states.some((s) => s === 'success' || s === 'cached')
  return anySuccess ? 'running' : 'pending'
}

/** 是否为资产节点（承载 media / 用于 slot 与三态计数）。 */
function isAssetNode(node: Node): boolean {
  const v3 = v3Of(node)
  if (v3?.kind === 'asset') return true
  const d = dataOf(node)
  return d.thumbnailUrl != null || d.filePath != null
}

/** 把一组资产按 stage 分组为 slot 摘要。 */
function deriveSlots(assetNodes: Node[]): AssetSlotGroup[] {
  const byStage = new Map<string, Node[]>()
  for (const n of assetNodes) {
    const stage = stageOf(n)
    const arr = byStage.get(stage) ?? []
    arr.push(n)
    byStage.set(stage, arr)
  }
  const groups: AssetSlotGroup[] = []
  for (const [stage, ns] of byStage) {
    groups.push({
      stage,
      label: STAGE_LABELS[stage] ?? stage,
      count: ns.length,
      state: aggregateExecState(ns, ns),
    })
  }
  // 按 stage 在 STAGE_LABELS 中的顺序排序，未知 stage 靠后
  const order = Object.keys(STAGE_LABELS)
  groups.sort((a, b) => {
    const ia = order.indexOf(a.stage)
    const ib = order.indexOf(b.stage)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  return groups
}

function deriveAssets(assetNodes: Node[]): PipelineAsset[] {
  return assetNodes.map((n) => {
    const v3 = v3Of(n)
    return {
      nodeId: n.id,
      label: v3?.phaseName
        ? v3.phaseName.replace(/^P\d{2}[a-z]?\s*[·\-]?\s*/u, '')
        : strField(n, 'label') ?? n.id,
      stage: stageOf(n),
      modality: v3?.modality ?? strField(n, 'modality') ?? 'image',
      triState: triStateOf(n),
      reviewStatus: reviewStatusOf(n),
      thumbnail: thumbnailOf(n),
      state: stateOf(n),
    }
  })
}

/**
 * 派生单个阶段模型。
 * @param def 阶段定义；@param phaseNodes 该 phaseIndex 下全部节点（含事件/结构）。
 */
function derivePhase(def: PipelinePhaseDef, phaseNodes: Node[]): PhaseModel {
  // sub 阶段（gate）不重复计入主阶段资产：仅按 curation/审核态给展示态，资产为空
  const assetNodes = def.sub ? [] : phaseNodes.filter(isAssetNode)
  const execState = def.sub
    ? aggregateExecState(phaseNodes, [])
    : aggregateExecState(phaseNodes, assetNodes)
  return {
    def,
    present: phaseNodes.length > 0,
    execState,
    assetCount: assetNodes.length,
    slots: deriveSlots(assetNodes),
    assets: deriveAssets(assetNodes),
    pendingDecisionCount: assetNodes.filter((n) => triStateOf(n) === 'candidate').length,
  }
}

/**
 * 主派生入口：节点列表 → 全阶段模型数组（含未到达阶段，按 sortKey 排序）。
 * 图中存在但不在注册表内的 phaseIndex 会作为附加阶段追加（防数据丢失）。
 */
export function derivePipelineModels(nodes: Node[]): PhaseModel[] {
  // 按 phaseIndex 分桶（phaseIndex 0 = 未标注/全局资产哨兵，非真实管线阶段 → 排除）
  const byPhase = new Map<number, Node[]>()
  for (const n of nodes) {
    const idx = phaseIndexOf(n)
    if (idx == null || idx <= 0) continue
    const arr = byPhase.get(idx) ?? []
    arr.push(n)
    byPhase.set(idx, arr)
  }

  const seen = new Set<number>()
  const models: PhaseModel[] = PIPELINE_PHASES.map((def) => {
    seen.add(def.phaseIndex)
    const phaseNodes = byPhase.get(def.phaseIndex) ?? []
    // 同 phaseIndex 下，主阶段与子阶段共享节点池：子阶段（gate）拿全部节点算状态，
    // 主阶段（非 sub）也拿全部节点（aggregateExecState 用全节点判运行/失败，资产只计 asset）。
    return derivePhase(def, phaseNodes)
  })

  // 注册表外的 phaseIndex → 追加为兜底阶段（按 index 排序插入末尾前）
  const extras = [...byPhase.keys()].filter((idx) => !seen.has(idx)).sort((a, b) => a - b)
  for (const idx of extras) {
    const group = PHASE_GROUPS[idx] ?? 'post'
    models.push(
      derivePhase(
        {
          sortKey: 1000 + idx,
          code: `P${String(idx).padStart(2, '0')}`,
          name: `阶段 ${idx}`,
          group,
          phaseIndex: idx,
        },
        byPhase.get(idx) ?? [],
      ),
    )
  }

  return models
}

/** 按 sortKey 给出某阶段的上游依赖链（含自身）code 列表，供「Depends on」面包屑展示。 */
export function dependencyChain(def: PipelinePhaseDef, all: readonly PipelinePhaseDef[]): string[] {
  return all.filter((p) => p.sortKey <= def.sortKey).map((p) => p.code)
}

/** 节点展示态 → 中文文案（图例 / 详情用）。 */
export function execStateLabel(s: PhaseExecState): string {
  switch (s) {
    case 'completed': return '完成'
    case 'running': return '运行中'
    case 'failed': return '失败'
    case 'awaiting_review': return '待审核'
    case 'pending': return '待执行'
  }
}

/** 展示态 → 字形 + 信号色（v3theme.signal 词汇表）。 */
export interface ExecStateVisual {
  glyph: string
  color: string
  spin?: boolean
}

export const EXEC_STATE_META: Record<PhaseExecState, ExecStateVisual> = {
  completed: { glyph: '✓', color: '#56B89A' },
  running: { glyph: '⟳', color: '#E0B665', spin: true },
  awaiting_review: { glyph: '⏳', color: '#E0B665' },
  failed: { glyph: '✕', color: '#DD6A82' },
  pending: { glyph: '○', color: '#9A9FA8' },
}

// ═══════════════════════════════════════════════════════════════════════
// v2 — 细粒度 DAG（资产子流程步骤粒度，BlueOcean 风格）
//
// v1 按 17 个 phase 大卡片横向排列，看不出 phase 内部子流程；v2 拆到
// asset-step（一个 ASSET_SCHEMA slot 对应的生产步骤）粒度，节点间是真实
// 依赖边（DAG 分支/汇合），用 dagre 分层布局 + SVG 渲染。
//
// 每个 DAG 节点 = 一类资产子流程步骤（如「灰底Turnaround」「首尾帧」），
// 其状态/计数从画布 RF 节点经 match 规则派生（phaseIndex + id/stage/
// assetType/turnaroundType/audioType 组合匹配）。
// ═══════════════════════════════════════════════════════════════════════

/**
 * KMC PHASE_REGISTRY slot 依赖镜像（从 pipeline/phases/__init__.py + 各 phase INPUT_SLOTS/OUTPUT_SLOTS 提取）。
 * 这是 DAG_EDGES 的权威依据 —— 每条 DAG 边必须能追溯到某个 phase 的 INPUT_SLOTS 中存在对应 OUTPUT_SLOTS。
 * 更新 KMC slot 时必须同步此处。
 */
export interface KmcSlotEntry {
  phaseCode: string
  inputs: string[]   // 该 phase 从 asset bus 读取的 slot
  outputs: string[]  // 该 phase 写入 asset bus 的 slot
}

export const KMC_SLOT_REGISTRY: readonly KmcSlotEntry[] = [
  { phaseCode: 'P01',  inputs: ['requirement'],                          outputs: ['topic-kernel', 'hook-design'] },
  { phaseCode: 'P02',  inputs: ['topic-kernel'],                         outputs: ['story-framework'] },
  { phaseCode: 'P03',  inputs: ['story-framework'],                      outputs: ['script-draft', 'audit-report'] },
  { phaseCode: 'P04',  inputs: ['script-draft'],                         outputs: ['character-bible', 'character-assets'] },
  { phaseCode: 'P06',  inputs: ['script-draft', 'character-bible'],      outputs: ['spatio-temporal-script', 'final-audit', 'visual-direction', 'production-design', 'physics-precheck-report'] },
  { phaseCode: 'P07',  inputs: ['spatio-temporal-script', 'character-assets'], outputs: ['scene-images', 'style-vector', 'color-intent', 'scene-blueprint', 'scene-temporal-variants'] },
  { phaseCode: 'P08',  inputs: ['scene-images', 'spatio-temporal-script'],     outputs: ['scene-selection'] },
  { phaseCode: 'P09',  inputs: ['scene-selection', 'spatio-temporal-script', 'character-bible', 'character-assets', 'style-vector', 'color-intent', 'scene-images'], outputs: ['shot-list', 'e-konte-sheets', 'transition-design'] },
  { phaseCode: 'P09b', inputs: ['shot-list', 'hook-design', 'requirement'],    outputs: ['shot-audit'] },
  { phaseCode: 'P10',  inputs: ['shot-list', 'script-draft', 'voice-design'],           outputs: ['voice-clips', 'voice-timeline'] },
  { phaseCode: 'P10c', inputs: ['voice-clips', 'voice-timeline', 'shot-list'], outputs: ['voice-audit'] },
  { phaseCode: 'P10b', inputs: ['voice-clips', 'voice-timeline', 'e-konte-sheets'], outputs: ['rapid-preview-clips', 'episode-meta'] },
  { phaseCode: 'P11',  inputs: ['shot-list', 'scene-images', 'character-assets', 'voice-timeline', 'voice-clips'], outputs: ['video-clips', 'lip-sync-reports', 'take-log'] },
  { phaseCode: 'P12',  inputs: ['video-clips', 'voice-clips', 'lip-sync-reports', 'style-vector'], outputs: ['master-timeline', 'audio-stems', 'foley-stems', 'bgm-tracks'] },
  { phaseCode: 'P13',  inputs: ['master-timeline', 'audio-stems', 'color-intent', 'transition-design'], outputs: ['master-mp4', 'delivery-package'] },
  { phaseCode: 'P14',  inputs: ['master-mp4'],                           outputs: ['quality-audit'] },
  { phaseCode: 'P15',  inputs: ['quality-audit'],                        outputs: ['feedback-log'] },
]

/** DAG 节点状态词汇表（has-candidates = 完成但有待选资产需人工决策）。 */
export type DagNodeState = 'completed' | 'running' | 'failed' | 'has-candidates' | 'pending'

/** 单个 DAG 节点的数据匹配规则：从画布 RF 节点派生该步骤的状态/计数。 */
export interface DagNodeMatch {
  /** 图节点 phaseIndex（v3.phaseIndex 优先）。可选——Notion 导入等节点无 phaseIndex 时省略。 */
  phaseIndex?: number
  /** v3.stage / RF node.type（如 'global'/'script'/'video'/'voice'）。 */
  stage?: string
  /** v3.modality（'text'/'image'/'audio'/'video'）。 */
  modality?: string
  /** node.id 子串包含（大小写敏感，命中如 'first_last_frames'）。 */
  idIncludes?: string
  /** node.id 前缀。 */
  idPrefix?: string
  /** raw 袋 assetType（穿透 migrate 白名单，由 rawDataByNodeId 提供）。 */
  assetType?: string
  /** raw 袋 turnaroundType（'gray_base' / 'costume'）。 */
  turnaroundType?: string
  /** raw 袋 audioType（'voice' / 'bgm' / 'foley'）。 */
  audioType?: string
  /** 反向：要求 raw.turnaroundType 不等于该值（区分 character-bible vs turnaround）。 */
  turnaroundNot?: string
  /** 要求 raw.turnaroundType 缺省（character-bible 概念图，区别于灰底/换装 TR）。 */
  turnaroundAbsent?: boolean
  /** 仅匹配产品节点（id 以 'a-' 开头），排除 'n-p0X' 步骤节点与 zone。默认 true。 */
  artifactsOnly?: boolean
}

export interface DagNodeDef {
  id: string
  label: string
  /** 阶段码：P01 / P09b …（UI 序号）。 */
  phaseCode: string
  phaseIndex: number
  group: PhaseGroup
  match: DagNodeMatch
  /** 预期计数（数字 = 固定预期；'dynamic' = 按实际匹配数显示）。 */
  expectedCount?: number | 'dynamic'
  /** 审计/Gate 弱节点：渲染时缩小 + 降低不透明度 */
  dim?: boolean
}

export interface DagEdgeDef {
  from: string
  to: string
}

/**
 * DAG 节点清单（27 个 asset-step）。匹配规则基于真实数据
 *（项目 1785508691757 ep1：canvas sync 写入的语义化 id 如 a-turnaround-* /
 *  a-first_last_frames-* / a-shot_list-*，以及 raw 袋 turnaroundType/audioType）。
 * 真实数据缺的阶段（P03/P06/P12/P13）→ 匹配 0 节点 → 显示 pending（规划中）。
 */
export const DAG_NODES: readonly DagNodeDef[] = [
  // ── P01 选题/钩子（research） ──
  { id: 'topic-kernel', label: '选题核', phaseCode: 'P01', phaseIndex: 1, group: 'research',
    match: { phaseIndex: 1, idIncludes: 'topic_kernel' }, expectedCount: 'dynamic' },
  { id: 'hook-candidates', label: '钩子候选', phaseCode: 'P01', phaseIndex: 1, group: 'research',
    match: { phaseIndex: 1, idIncludes: 'hook_design' }, expectedCount: 'dynamic' },
  // ── P02 大纲（research） ──
  { id: 'story-framework', label: '故事框架', phaseCode: 'P02', phaseIndex: 2, group: 'research',
    match: { phaseIndex: 2 }, expectedCount: 'dynamic' },
  // ── P03 剧本审计（story） ──
  { id: 'script-draft', label: '剧本初稿', phaseCode: 'P03', phaseIndex: 3, group: 'story',
    match: { phaseIndex: 3 }, expectedCount: 1 },
  { id: 'audit-report', label: '审计报告', phaseCode: 'P03', phaseIndex: 3, group: 'story', dim: true,
    match: { phaseIndex: 3, idIncludes: 'audit' }, expectedCount: 'dynamic' },
  // ── P04 角色设计（story） ──
  { id: 'character-bible', label: '角色设定', phaseCode: 'P04', phaseIndex: 4, group: 'story',
    match: { idPrefix: 'notion-character_bible', assetType: 'character', turnaroundAbsent: true, artifactsOnly: false },
    expectedCount: 'dynamic' },
  { id: 'turnaround-sheets', label: '灰底Turnaround', phaseCode: 'P04', phaseIndex: 4, group: 'story',
    match: { phaseIndex: 4, idPrefix: 'a-turnaround-', turnaroundType: 'gray_base' }, expectedCount: 'dynamic' },
  { id: 'costume-turnarounds', label: '换装Turnaround', phaseCode: 'P04', phaseIndex: 4, group: 'story',
    match: { phaseIndex: 4, idPrefix: 'a-turnaround-', turnaroundType: 'costume' }, expectedCount: 'dynamic' },
  { id: 'voice-design', label: '声纹设计', phaseCode: 'P04', phaseIndex: 4, group: 'story',
    match: { phaseIndex: 4, idPrefix: 'a-voice_design-', artifactsOnly: true }, expectedCount: 'dynamic' },
  // ── P06 时空剧本（production） ──
  { id: 'spatio-temporal-script', label: '时空剧本', phaseCode: 'P06', phaseIndex: 6, group: 'production',
    match: { phaseIndex: 6 }, expectedCount: 1 },
  // ── P07 场景图生成（production） ──
  // 场景图节点（a-scene_refs-*）落在 phaseIndex=0 全局哨兵列（非 P07），raw assetType='scene_image'。
  // 用 phaseIndex=0 + idPrefix 精确匹配，避免误伤同列的 keyframe 节点；def.phaseIndex 仍标 7
  // 用于依赖链/分组定位（PI=7 无 n-* 报错，不会被 phase-error 检测误判失败）。
  { id: 'scene-images', label: '场景图', phaseCode: 'P07', phaseIndex: 7, group: 'production',
    match: { phaseIndex: 0, idPrefix: 'a-scene_refs-' }, expectedCount: 'dynamic' },
  { id: 'style-vector', label: '风格向量', phaseCode: 'P07', phaseIndex: 7, group: 'production',
    match: { phaseIndex: 7, idIncludes: 'style_vector' }, expectedCount: 1 },
  { id: 'color-intent', label: '色彩意图', phaseCode: 'P07', phaseIndex: 7, group: 'production',
    match: { phaseIndex: 7, idIncludes: 'color_intent' }, expectedCount: 1 },
  // ── P08 场景选择（production） ──
  { id: 'scene-selection', label: '场景选择', phaseCode: 'P08', phaseIndex: 8, group: 'production',
    match: { phaseIndex: 8, idIncludes: 'scene_selection' }, expectedCount: 'dynamic' },
  // ── P09 分镜拆解（production） ──
  { id: 'shot-list', label: '分镜表', phaseCode: 'P09', phaseIndex: 9, group: 'production',
    match: { phaseIndex: 9, idIncludes: 'shot_list' }, expectedCount: 'dynamic' },
  { id: 'e-konte-sheets', label: 'E-Konte绘卷', phaseCode: 'P09', phaseIndex: 9, group: 'production',
    match: { phaseIndex: 9, idIncludes: 'e_konte_sheets' }, expectedCount: 'dynamic' },
  { id: 'transition-design', label: '转场设计', phaseCode: 'P09', phaseIndex: 9, group: 'production',
    match: { phaseIndex: 9, idIncludes: 'transition_design' }, expectedCount: 'dynamic' },
  // ── P09b 镜头审计（production gate） ──
  { id: 'shot-audit', label: '镜头审计', phaseCode: 'P09b', phaseIndex: 9, group: 'production', dim: true,
    match: { phaseIndex: 9, idIncludes: 'shot-audit' }, expectedCount: 'dynamic' },
  // ── P10 语音合成（post） ──
  { id: 'voice-clips', label: '语音片段', phaseCode: 'P10', phaseIndex: 10, group: 'post',
    match: { phaseIndex: 10, idIncludes: 'voice_clips' }, expectedCount: 'dynamic' },
  { id: 'voice-timeline', label: '语音时间线', phaseCode: 'P10', phaseIndex: 10, group: 'post',
    match: { phaseIndex: 10, idIncludes: 'voice_timeline' }, expectedCount: 1 },
  // ── P10c 语音审计（post gate） ──
  { id: 'voice-audit', label: '语音审计', phaseCode: 'P10c', phaseIndex: 10, group: 'post', dim: true,
    match: { phaseIndex: 10, idIncludes: 'voice-audit' }, expectedCount: 'dynamic' },
  // ── P10b 快速预览（post gate） ──
  { id: 'rapid-preview-clips', label: '快速预览', phaseCode: 'P10b', phaseIndex: 10, group: 'post', dim: true,
    match: { phaseIndex: 10, idIncludes: 'rapid' }, expectedCount: 'dynamic' },
  // ── P11 视频渲染（post） ──
  // 条件帧生成（首/尾帧变体）：P11 video render 的多种条件输入之一。命名反映其本质——
  // 按条件（纯 prompt / 仅首帧 / 仅尾帧 / 首尾帧 / 多参考）生成帧，而非固定首尾帧产物。
  { id: 'iframe-generation', label: '条件帧生成', phaseCode: 'P11', phaseIndex: 11, group: 'post',
    match: { phaseIndex: 11, idIncludes: 'first_last_frames' }, expectedCount: 'dynamic' },
  { id: 'video-clips', label: '视频片段', phaseCode: 'P11', phaseIndex: 11, group: 'post',
    match: { phaseIndex: 11, stage: 'video' }, expectedCount: 'dynamic' },
  // P11 唇形同步报告（KMC P11 OUTPUT_SLOTS 含 lip-sync-reports）：video render 后口型对齐校验产物
  { id: 'lip-sync-reports', label: '唇形同步', phaseCode: 'P11', phaseIndex: 11, group: 'post', dim: true,
    match: { phaseIndex: 11, idIncludes: 'lip_sync' }, expectedCount: 'dynamic' },
  // ── P12 合成（post） ──
  { id: 'master-timeline', label: '主时间轴', phaseCode: 'P12', phaseIndex: 12, group: 'post',
    match: { phaseIndex: 12 }, expectedCount: 1 },
  // P12 音频混音（对白混音 + BGM + Foley 合成），KMC 产出 audio-stems slot
  { id: 'audio-mix', label: '音频混音', phaseCode: 'P12', phaseIndex: 12, group: 'post',
    match: { phaseIndex: 12, idIncludes: 'audio' }, expectedCount: 1 },
  // ── P13 交付（post） ──
  { id: 'master-mp4', label: '成片', phaseCode: 'P13', phaseIndex: 13, group: 'post',
    match: { phaseIndex: 13 }, expectedCount: 1 },
  // ── P14 质量审计（post） ──
  { id: 'quality-audit', label: '质量审计', phaseCode: 'P14', phaseIndex: 14, group: 'post', dim: true,
    match: { phaseIndex: 14 }, expectedCount: 'dynamic' },
  // ── P15 反馈（post） ──
  { id: 'feedback-loop', label: '反馈闭环', phaseCode: 'P15', phaseIndex: 15, group: 'post', dim: true,
    match: { phaseIndex: 15 }, expectedCount: 'dynamic' },
]

/**
 * DAG 依赖边 —— 基于 KMC_SLOT_REGISTRY 派生。
 * 规则：DAG 节点 N 的 phaseCode 对应的 KMC phase 的 INPUT_SLOTS 中每个 slot，
 *      如果该 slot 出现在另一个 KMC phase 的 OUTPUT_SLOTS 中，
 *      则画一条从「产出该 slot 的 phase 的 DAG 节点」到「N」的边。
 *
 * 例外处理（手动调整）：
 *   - phase 级线性门控边（P09b→P10, P10c→P10b→P11）是 KMC depends_on 链，
 *     不完全等价于 slot 数据流。这些边从 PHASE_REGISTRY 的 depends_on 派生。
 *   - P11 的 'character-assets' INPUT_SLOT 在 DAG 中不画为 turnaround-sheets → video-clips 边，
 *     因为 P11 不直接消费 turnaround_sheet —— P09 从 character-assets 解析出 turnaround_path
 *     写入 shot-list，P11 通过 shot-list 间接消费（P09 _resolve_character_refs）。
 *     DAG 边用 costume-turnarounds → iframe-generation 表示 L2 换装参考链。
 */
export const DAG_EDGES: readonly DagEdgeDef[] = [
  // P01 → P02：选题核 + 钩子候选 共同输入故事框架
  { from: 'topic-kernel', to: 'story-framework' },
  { from: 'hook-candidates', to: 'story-framework' },
  // P02 → P03：故事框架 → 剧本初稿 → 审计报告
  { from: 'story-framework', to: 'script-draft' },
  { from: 'script-draft', to: 'audit-report' },
  // P03 → P04：剧本初稿 → 角色设定
  { from: 'script-draft', to: 'character-bible' },
  // P04 内部链：角色设定 → 灰底Turnaround → 换装Turnaround；角色设定 → 声纹设计
  { from: 'character-bible', to: 'turnaround-sheets' },
  { from: 'turnaround-sheets', to: 'costume-turnarounds' },
  { from: 'character-bible', to: 'voice-design' },
  // P04 声纹设计 → P10 语音片段：TTS 两阶段工作流（先 VoiceDesign 生成声纹，再 VoiceClone 批量克隆对白）
  { from: 'voice-design', to: 'voice-clips' },
  // P04 → P06：角色设定 → 时空剧本
  { from: 'character-bible', to: 'spatio-temporal-script' },
  // P06 → P07：时空剧本 → 场景图 / 风格向量 / 色彩意图；风格向量 → 场景图
  { from: 'spatio-temporal-script', to: 'scene-images' },
  { from: 'spatio-temporal-script', to: 'style-vector' },
  { from: 'spatio-temporal-script', to: 'color-intent' },
  { from: 'style-vector', to: 'scene-images' },
  // P07 → P08：场景图 → 场景选择
  { from: 'scene-images', to: 'scene-selection' },
  // P06 → P09：时空剧本 → 分镜表；分镜表 → E-Konte / 转场设计 / 镜头审计
  { from: 'spatio-temporal-script', to: 'shot-list' },
  { from: 'shot-list', to: 'e-konte-sheets' },
  { from: 'shot-list', to: 'transition-design' },
  { from: 'shot-list', to: 'shot-audit' },
  // P09 → P10：分镜表 → 语音片段（数据流 + 门控双边）；语音片段 → 语音时间线 / 语音审计；语音审计 → 快速预览
  // 数据流：P10 INPUT_SLOTS 含 shot-list（真读 shot-list）；门控：P09b depends_on 通过才跑 P10
  { from: 'shot-list', to: 'voice-clips' },       // 数据流：P10 读 shot-list
  { from: 'shot-audit', to: 'voice-clips' },       // 门控：P09b 审计通过才能跑 P10
  { from: 'voice-clips', to: 'voice-timeline' },
  { from: 'voice-clips', to: 'voice-audit' },
  { from: 'voice-audit', to: 'rapid-preview-clips' },
  // P10b 数据流：KMC P10b INPUT_SLOTS 含 e-konte-sheets（快速预览读 E-Konte 分镜图）
  { from: 'e-konte-sheets', to: 'rapid-preview-clips' },
  // P11 条件帧生成（多输入）：场景选择 + 换装TR(服化道信息，P09解析首选参考) + E-Konte
  // 注：灰底TR 不直接连 P11 子步骤 — P09 _resolve_character_refs 从 character-assets 选出
  //     turnaround_path（首选L2换装，fallback L1灰底）写入 shot-list，P11 通过 shot-list 间接消费
  { from: 'scene-selection', to: 'iframe-generation' },
  { from: 'costume-turnarounds', to: 'iframe-generation' },
  { from: 'e-konte-sheets', to: 'iframe-generation' },
  // P11 视频渲染（H3 ref2va 核心依赖）：分镜表(prompt/duration/角色 + turnaround_path) +
  //   场景图(背景参考) + 语音片段(对口型) + 条件帧(首/尾帧条件)
  // 注：turnaround-sheets 不直连 — 角色参考图通过 shot-list.character_refs[].turnaround_path
  //     传入（P09 已从 L2换装/L1灰底 中解析选定）
  { from: 'shot-list', to: 'video-clips' },
  { from: 'scene-images', to: 'video-clips' },
  { from: 'voice-clips', to: 'video-clips' },
  { from: 'iframe-generation', to: 'video-clips' },
  // P10c/P10b 门控：视频渲染必须经过快速预览（KMC: p11 depends_on=[p10b_rapid_preview]）
  { from: 'rapid-preview-clips', to: 'video-clips' },
  // P12：视频片段 → 主时间轴；语音片段 → 音频混音 → 主时间轴；唇形同步报告 → 主时间轴
  // P11 产出 lip-sync-reports，P12 INPUT_SLOTS 含 lip-sync-reports（合成校验口型对齐）
  { from: 'video-clips', to: 'lip-sync-reports' },
  { from: 'lip-sync-reports', to: 'master-timeline' },
  { from: 'video-clips', to: 'master-timeline' },
  { from: 'voice-clips', to: 'audio-mix' },
  { from: 'audio-mix', to: 'master-timeline' },
  // P12 → P13：主时间轴 → 成片；P13 INPUT_SLOTS 还含 color-intent / transition-design
  { from: 'master-timeline', to: 'master-mp4' },
  { from: 'color-intent', to: 'master-mp4' },
  { from: 'transition-design', to: 'master-mp4' },
  // P13 → P14 → P15：成片 → 质量审计 → 反馈闭环
  { from: 'master-mp4', to: 'quality-audit' },
  { from: 'quality-audit', to: 'feedback-loop' },
]

// ─── DAG 派生模型 ───────────────────────────────────────────

export interface DagAssetRef {
  nodeId: string
  label: string
  thumbnail: string | null
  triState: AssetTriState
  state: string
  modality: string
}

export interface DagNodeModel {
  def: DagNodeDef
  state: DagNodeState
  /** 匹配到的画布节点总数。 */
  total: number
  /** 成功（success/cached）数。 */
  completed: number
  /** 选定（curation selected / isPrimaryView / isWinner）数。 */
  selected: number
  /** 待决策数 = total - selected - eliminated（含无 curation 信息）。 */
  candidates: number
  /** 预期计数（null = dynamic）。 */
  expected: number | null
  /** 进度 0..1（completed/expected 或 completed/total）。 */
  progress: number
  assets: DagAssetRef[]
  present: boolean
}

/** DAG 节点展示态 → 中文文案。 */
export function dagStateLabel(s: DagNodeState): string {
  switch (s) {
    case 'completed': return '完成'
    case 'running': return '运行中'
    case 'failed': return '失败'
    case 'has-candidates': return '待决策'
    case 'pending': return '待执行'
  }
}

/** DAG 节点展示态 → 字形 + 信号色（has-candidates 复用金色 ⚠）。 */
export interface DagStateVisual {
  glyph: string
  color: string
  spin?: boolean
}

export const DAG_STATE_META: Record<DagNodeState, DagStateVisual> = {
  completed: { glyph: '✓', color: '#56B89A' },
  running: { glyph: '⟳', color: '#E0B665', spin: true },
  failed: { glyph: '✕', color: '#DD6A82' },
  'has-candidates': { glyph: '⚠', color: '#E0B665' },
  pending: { glyph: '○', color: '#9A9FA8' },
}

/** raw 袋字段读取（穿透 migrate 白名单）。 */
function rawField(raw: Record<string, unknown> | undefined, key: string): unknown {
  return raw?.[key]
}

/** 单节点是否匹配某 DAG match 规则。 */
function nodeMatchesDag(
  node: Node,
  raw: Record<string, unknown> | undefined,
  m: DagNodeMatch,
): boolean {
  const pi = phaseIndexOf(node)
  if (m.phaseIndex != null && pi !== m.phaseIndex) return false
  if ((m.artifactsOnly ?? true) && !node.id.startsWith('a-')) return false
  if (m.stage != null && stageOf(node) !== m.stage) return false
  if (m.modality != null) {
    const v3 = v3Of(node)
    const mod = v3?.modality ?? dataOf(node).modality
    if (mod !== m.modality) return false
  }
  if (m.idIncludes != null && !node.id.includes(m.idIncludes)) return false
  if (m.idPrefix != null && !node.id.startsWith(m.idPrefix)) return false
  if (m.assetType != null && rawField(raw, 'assetType') !== m.assetType) return false
  if (m.turnaroundType != null && rawField(raw, 'turnaroundType') !== m.turnaroundType) return false
  if (m.turnaroundAbsent === true && rawField(raw, 'turnaroundType') != null) return false
  if (m.turnaroundNot != null && rawField(raw, 'turnaroundType') === m.turnaroundNot) return false
  if (m.audioType != null && rawField(raw, 'audioType') !== m.audioType) return false
  return true
}

function isDoneState(s: string): boolean {
  return s === 'success' || s === 'cached'
}

function isFailState(s: string): boolean {
  return s === 'failed' || s === 'error'
}

/** 标签：v3.phaseName 去阶段前缀 → data.label → id。 */
function dagLabelOf(node: Node): string {
  const v3 = v3Of(node)
  if (v3?.phaseName) {
    const stripped = v3.phaseName.replace(/^P\d{2}[a-z]?\s*[·\-]?\s*/u, '')
    if (stripped) return stripped
  }
  return strField(node, 'label') ?? node.id
}

function modalityOf(node: Node): string {
  const v3 = v3Of(node)
  return v3?.modality ?? strField(node, 'modality') ?? 'image'
}

/**
 * 主派生入口：画布 RF 节点 + raw 袋 → DAG 节点模型数组（顺序同 DAG_NODES）。
 * @param nodes 画布 RF 节点（data.v3 = AssetNodeV3）
 * @param rawMap adapter sidecar（assetType/turnaroundType/audioType 等白名单外字段）
 */
export function deriveDagModels(
  nodes: Node[],
  rawMap: Map<string, Record<string, unknown>> | null,
): DagNodeModel[] {
  // 预取每个节点的 raw 袋（O(n) 一次）
  const rawCache = new Map<string, Record<string, unknown> | undefined>()
  for (const n of nodes) rawCache.set(n.id, rawMap?.get(n.id))

  // phase 级错误检测：收集存在 n-* 脚本节点（管线执行步骤）state=error/failed 的 phaseIndex。
  // asset 节点 a-* 的失败由 per-node failed 处理；此处只看执行脚本节点的报错
  // （如 P11 GLM 429 → phaseIndex 11 整体降级），避免历史成功产物掩盖管线已崩
  // （「video-clips 显示 completed 但 P11 实际 error」的根因）。
  const phaseErrors = new Set<number>()
  for (const n of nodes) {
    if (!n.id.startsWith('n-')) continue
    if (!isFailState(stateOf(n))) continue
    const pi = phaseIndexOf(n)
    if (pi != null && pi > 0) phaseErrors.add(pi)
  }

  const models = DAG_NODES.map((def): DagNodeModel => {
    const matched = nodes.filter((n) => nodeMatchesDag(n, rawCache.get(n.id), def.match))
    const total = matched.length
    const completed = matched.filter((n) => isDoneState(stateOf(n))).length
    const buckets = matched.map((n) => curationBucket(n, rawCache.get(n.id)))
    const selected = buckets.filter((b) => b === 'selected').length
    const eliminated = buckets.filter((b) => b === 'eliminated').length
    const explicitCandidates = buckets.filter((b) => b === 'candidate').length
    const failed = matched.some((n) => isFailState(stateOf(n)))
    // 待决策 = 既未选定也未淘汰（含 neutral 与显式 candidate）
    const candidates = Math.max(0, total - selected - eliminated)
    const expected = def.expectedCount === 'dynamic' ? null : (def.expectedCount ?? null)
    const denom = expected ?? total
    const progress = denom > 0 ? Math.min(1, completed / denom) : 0

    // 真实待决策：存在未定资产 且 有 curation 活动迹象（已选定 ≥1 或显式 candidate ≥1）。
    // 仅「无 curation 信息的结构化产物」（neutral）不触发金色——避免整图泛金。
    const needsDecision = candidates > 0 && (selected > 0 || explicitCandidates > 0)

    const state = deriveDagState({
      total, completed, needsDecision, failed,
      phaseHasError: phaseErrors.has(def.phaseIndex),
      expected,
    })

    const assets: DagAssetRef[] = matched.map((n) => ({
      nodeId: n.id,
      label: dagLabelOf(n),
      thumbnail: thumbnailOf(n),
      triState: triStateOf(n, rawCache.get(n.id)),
      state: stateOf(n),
      modality: modalityOf(n),
    }))

    return { def, state, total, completed, selected, candidates, expected, progress, assets, present: total > 0 }
  })

  // 后处理：派生完成。match 命中 0 且仍 pending 的步骤，若其下游已有成功产物（见
  // deriveImplicitCompletion），则反推为 completed。仅提升 pending→completed，绝不覆盖 failed
  //（phase 报错时尊重失败态）。total/completed 置 1 以与「完成」展示态自洽——卡计数 1/1、
  // 详情统计「完成 1」、头部「完成 +1」均一致；assets 维持空（这些步骤无独立画布产物，
  // 点击详情见「尚无产物」属预期，非 bug）。
  const modelMap = new Map(models.map((m) => [m.def.id, m]))
  for (const m of models) {
    if (m.total === 0 && m.state === 'pending' && deriveImplicitCompletion(m.def.id, modelMap)) {
      m.state = 'completed'
      m.present = true
      m.total = 1
      m.completed = 1
      m.progress = 1
    }
  }

  return models
}

/** DAG 节点状态聚合规则（见任务文档「节点计数派生规则」）。 */
function deriveDagState(args: {
  total: number
  completed: number
  needsDecision: boolean
  failed: boolean
  /** 同 phaseIndex 是否存在 n-* 脚本节点报错（phase 级错误检测）。 */
  phaseHasError: boolean
  /** 预期计数（null = dynamic，按实际匹配数）。 */
  expected: number | null
}): DagNodeState {
  const { total, completed, needsDecision, failed, phaseHasError, expected } = args
  if (failed) return 'failed'
  // phase 级错误检测：同 phaseIndex 存在 n-* 节点 state=error/failed（如 P11 GLM 429），
  // 且该 asset-step 未达预期完成度 → 失败。expected 为 dynamic（null）时用 Infinity 兜底——
  // phase 报错即视为该 step 失败（历史成功产物 ≠ 当前管线成功，需提醒用户管线已崩，勿被旧 LTX
  // 成功产物误导为 completed）。仅影响 phaseErrors 命中的 phase，phase 未报错的节点不受影响。
  if (phaseHasError && completed < (expected ?? Infinity)) return 'failed'
  if (total === 0) return 'pending'
  if (completed === 0) return 'running' // 有匹配节点但无成功产物 → 进行中
  const allDone = completed >= total
  if (allDone) {
    // 完成度满；若存在真实待决策（选定进行中但仍有未定）→ 金色提醒，否则完成
    return needsDecision ? 'has-candidates' : 'completed'
  }
  return 'running' // 部分完成
}

/**
 * 派生完成：某些上游步骤的产物未同步为独立画布节点（存在于 o_assets 但无对应 canvas node），
 * 故 match 命中 0 → 默认 pending。但其**下游步骤**有成功产物即反证上游已完成——
 *   character-bible：灰底Turnaround（turnaround-sheets）有成功节点 → 角色设定必然已完成
 *   voice-design：P10 语音片段（voice-clips）有成功节点 → 声纹设计必然已完成
 * 用下游 completed>0 反推上游，避免这些步骤永远显示 pending。
 */
function deriveImplicitCompletion(
  defId: string,
  modelMap: ReadonlyMap<string, DagNodeModel>,
): boolean {
  switch (defId) {
    case 'character-bible':
      return (modelMap.get('turnaround-sheets')?.completed ?? 0) > 0
    case 'voice-design':
      // 声纹设计有独立的画布节点（canvas_sync P04 voice_design 映射），
      // 不再需要从 voice-clips 反推完成状态。
      return false
    default:
      return false
  }
}

/** 直连父节点 id 列表（DAG_EDGES 中 to === nodeId 的 from）。 */
export function dagParentsOf(nodeId: string): string[] {
  return DAG_EDGES.filter((e) => e.to === nodeId).map((e) => e.from)
}

/** 直连子节点 id 列表（DAG_EDGES 中 from === nodeId 的 to）。 */
export function dagChildrenOf(nodeId: string): string[] {
  return DAG_EDGES.filter((e) => e.from === nodeId).map((e) => e.to)
}

/** 祖先闭包（含自身）—— hover 时高亮上游路径。 */
export function dagAncestorsOf(nodeId: string): Set<string> {
  const out = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const p of dagParentsOf(cur)) {
      if (!out.has(p)) {
        out.add(p)
        stack.push(p)
      }
    }
  }
  out.add(nodeId)
  return out
}

/** 后代闭包（含自身）—— hover 时高亮下游路径。 */
export function dagDescendantsOf(nodeId: string): Set<string> {
  const out = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const c of dagChildrenOf(cur)) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  out.add(nodeId)
  return out
}

// ─── 构建时校验（dev/CI 入口，运行时不调用） ────────────────

/**
 * 构建时校验：检查 DAG_EDGES 与 KMC_SLOT_REGISTRY 的一致性。
 * - 每条数据流边 from→to 必须能追溯到 from 的 phaseCode 在 KMC 中 outputs 某 slot，且 to 的 phaseCode inputs 该 slot
 * - 门控边（gate edges）豁免此检查（它们来自 PHASE_REGISTRY depends_on 而非 slot 流）
 * - 输出不一致列表（空 = 完全一致）
 *
 * 不在运行时调用（避免 bundle 体积），只作为开发参考 + 未来 CI 校验入口。
 */
export function validateDagEdges(): string[] {
  const issues: string[] = []
  const nodeById = new Map(DAG_NODES.map((n) => [n.id, n]))
  const regByCode = new Map(KMC_SLOT_REGISTRY.map((e) => [e.phaseCode, e]))

  // 门控边（来自 PHASE_REGISTRY depends_on 线性门控链，非 slot 数据流）→ 豁免。
  const GATE_EDGES = new Set<string>([
    'shot-audit|voice-clips',           // P09b → P10
    'voice-audit|rapid-preview-clips',  // P10c → P10b
    'rapid-preview-clips|video-clips',  // P10b → P11
  ])
  // 前端建模边：DAG 刻意表达比 KMC slot 粒度更细的依赖（KMC 未单列对应 slot）→ 豁免并记录原因。
  const DESIGN_INTENT_EDGES = new Map<string, string>([
    ['scene-selection|iframe-generation', '条件帧按所选场景生成；KMC P11 INPUT_SLOTS 未单列 scene-selection'],
  ])

  for (const e of DAG_EDGES) {
    const key = `${e.from}|${e.to}`
    if (GATE_EDGES.has(key)) continue
    if (DESIGN_INTENT_EDGES.has(key)) continue
    const from = nodeById.get(e.from)
    const to = nodeById.get(e.to)
    if (!from || !to) {
      issues.push(`边 ${e.from}→${e.to} 引用了未定义的 DAG 节点`)
      continue
    }
    // phase 内子步骤排序（同 phaseCode）非跨 phase slot 流 → 豁免
    if (from.phaseCode === to.phaseCode) continue
    const fr = regByCode.get(from.phaseCode)
    const tr = regByCode.get(to.phaseCode)
    if (!fr || !tr) {
      issues.push(`边 ${e.from}→${e.to} 的 phaseCode 不在 KMC_SLOT_REGISTRY（${from.phaseCode}/${to.phaseCode}）`)
      continue
    }
    // 数据流成立：共享 slot / from 节点 id 即被 to 消费的 slot / to 节点 id 即 from 产出的 slot
    const ok =
      fr.outputs.some((s) => tr.inputs.includes(s)) ||
      tr.inputs.includes(e.from) ||
      fr.outputs.includes(e.to)
    if (!ok) {
      issues.push(
        `数据流边 ${e.from}(${from.phaseCode})→${e.to}(${to.phaseCode}) 无 KMC slot 依据：` +
        `outputs=${JSON.stringify(fr.outputs)} ∩ inputs=${JSON.stringify(tr.inputs)}`,
      )
    }
  }
  return issues
}
