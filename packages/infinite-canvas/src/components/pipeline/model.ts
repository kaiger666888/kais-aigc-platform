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
 * 资产三态。权威 = V3 curation；缺失时回退旧 isPrimaryView + curationState。
 *  - V3 selected / isPrimaryView=true → selected (★)
 *  - V3 deprecated / curationState='eliminated' → eliminated (✕)
 *  - 其余 → candidate (○)
 */
function triStateOf(node: Node): AssetTriState {
  const v3 = v3Of(node)
  const curation = v3?.curation ?? dataOf(node).curation
  if (curation === 'selected') return 'selected'
  if (curation === 'deprecated') return 'eliminated'
  // locked（解构集）/ candidate 走 curationState + isPrimaryView 回退
  const curationState = dataOf(node).curationState
  if (curationState === 'eliminated') return 'eliminated'
  if (curationState === 'selected') return 'selected'
  if (boolField(node, 'isPrimaryView')) return 'selected'
  return 'candidate'
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
