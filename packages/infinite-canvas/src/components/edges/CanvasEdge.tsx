/**
 * src/components/edges/CanvasEdge.tsx — 边三态 + reference 点线族（设计 §6，宪法 P11 落地）。
 *
 * tokens §2.3 冲突裁决已执行：
 *  - sequence 蓝实线+箭头 → 1.6px 暖灰虚线 dash 3 6（P11：排序约束不是因果，视觉退场）；
 *  - parallel 绿虚线并入 reference 点线族（dash 2 5）；branchColors 不再给单条边染色
 *    （分支是导航语义，归属由 zone/面板表达，getBranchColor 调用点已移出边渲染）；
 *  - 默认 dataType 彩色 2px 实线 → 因果边 = 产物模态色 @75% 透明度 2px，
 *    无箭头（方向由布局保证左→右），端点 2.5px 圆点 = 100% 模态色。
 *    可见度提升（2026-07）：边线原本 1px + 10–16% alpha 实测几乎不可见，整体
 *    提到 ≥1.6px / 中性族 alpha 0.42 / 因果族 alpha 0.55→0.75。
 *    【偏差】起止 24px 渐变淡出（规范允许的唯一渐变）未实现：直给 75% 均匀描边 +
 *    端点圆点；渐变需 per-edge userSpaceOnUse 渐变定义，收益低于复杂度，待 review 回定。
 *  - isInactive 5 5 @0.4 → dash 4 4 @22%（与 sequence 同族更低明度，统一进 token）。
 *  - 选中/溯源高亮（data.highlighted 或 RF selected）→ 2.5px + 100% 不透明（P18，C 接线）。
 *  - LOD L0（§7）：全部边 → 1px 暖灰直线（不画贝塞尔，性能与视觉双重退场）。
 */
import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getStraightPath, type EdgeProps } from '@xyflow/react'
import { v3theme, type Modality } from '../../theme/catppuccin'
import { useLodLevel } from '../../hooks/useLod'
import EdgeOpChip from './EdgeOpChip'

type EdgeData = {
  // V3 通道（adapter + useLayout 富化）
  role?: string
  isInactive?: boolean
  isExplore?: boolean
  branchId?: string
  productModality?: Modality
  /** C 的 P18 溯源高亮通道 */
  highlighted?: boolean
  /** C 的 P18 溯源压暗：非祖先边在 trace 激活时压暗（与节点 dimmed 对称） */
  dimmed?: boolean
  /** P19：折叠 event 的 op 配方（边中点 op 芯片 = 拓扑线说明标签） */
  op?: string
  eventId?: string
  executor?: 'human' | 'gpu0' | 'gpu1' | 'cloud' | string
  durationS?: number
  params?: Record<string, unknown>
  // 旧通道（非 graph 路径过渡兼容）
  linkType?: string
  dataType?: string
  refType?: string
}

// 可见度提升（2026-07）：theme tokens 的中性冷白灰族 alpha 仅 0.10–0.16，
// 是为 badge/panel 复用而刻意压低的（见 catppuccin.edge）。边线在此用更亮的
// 本地覆盖值，避免牵连 badge/panel，同时把因果边 alpha 从 55% 提到 75%。
const NEUTRAL = 'rgba(255,255,255,0.42)' // sequence
const INACTIVE = 'rgba(255,255,255,0.22)' // isInactive（相对更弱，保持置灰语义）
const REF = 'rgba(255,255,255,0.42)' // reference 点线族

const REF_ROLES = new Set(['reference', 'lora_ref', 'prompt_ref'])

/** 模态 hex + 75% 透明度（因果边描边；可见度提升：55%→75%）。 */
function causalStroke(mod: Modality | undefined): string {
  const hex = mod ? v3theme.modality[mod] : '#6B7080'
  return `${hex}BF`
}

function CanvasEdgeComponent(props: EdgeProps) {
  const lod = useLodLevel()
  const data = props.data as EdgeData | undefined
  const role = data?.role
  const linkType = data?.linkType

  const pathArgs = {
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
  }

  // L0 全景：1px 直线（§7：200 条贝塞尔在 L0 是性能与视觉双重浪费），不渲染芯片。
  // 但溯源态不能丢——祖先直线高亮(模态色+加粗)、非祖先直线压暗，与 L1/L2 一致。
  if (lod === 0) {
    const [path] = getStraightPath(pathArgs)
    const hl0 = data?.highlighted === true || props.selected === true
    const dim0 = !!data?.dimmed
    const mod0 = data?.productModality
    const stroke0 = hl0 ? (mod0 ? v3theme.modality[mod0] : v3theme.signal.select) : NEUTRAL
    return (
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: stroke0,
          strokeWidth: hl0 ? 2.5 : 1.5,
          opacity: dim0 ? 0.12 : 1,
          transition: 'stroke-width var(--cv-d-ancestor, 160ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), opacity var(--cv-d-dim, 180ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
      />
    )
  }

  const [edgePath, labelX, labelY] = getBezierPath(pathArgs)

  // 三态优先级：isInactive > sequence > reference 族 > 因果。统一算描边态后一次渲染，
  // 便于在任意分支的边中点挂 op 芯片（折叠 event 的 op 配方 = 拓扑说明标签，P19）。
  const isInactive = !!data?.isInactive
  const isSequence = role === 'sequence' || linkType === 'sequence'
  const isReference =
    (role != null && REF_ROLES.has(role)) ||
    linkType === 'reference' ||
    linkType === 'parallel' ||
    data?.refType === 'reference'

  const highlighted = data?.highlighted === true || props.selected === true
  const dimmed = !!data?.dimmed
  const mod = data?.productModality

  let stroke: string
  let strokeWidth: number
  let strokeDasharray: string | undefined
  let strokeLinecap: 'round' | undefined
  let showEndpointDot = false

  if (isInactive) {
    stroke = INACTIVE
    strokeWidth = 1.4
    strokeDasharray = '4 4'
  } else if (isSequence) {
    stroke = NEUTRAL
    strokeWidth = 1.6
    strokeDasharray = '3 6'
    strokeLinecap = 'round'
  } else if (isReference) {
    stroke = REF
    strokeWidth = 1.6
    strokeDasharray = '2 5'
    strokeLinecap = 'round'
  } else {
    // 因果边（含全部输入槽位 role 与 output）：产物模态色 @75% 2px，端点圆点
    stroke = causalStroke(mod)
    strokeWidth = 2
    showEndpointDot = true
  }

  // 溯源/选中高亮：一律覆盖（不分分支）。sequence/reference 分支的祖先边也必须亮——
  // 否则点节点后这些拓扑线不变样（实测回归点：折叠后大量边落在 seq/ref 分支）。
  // 模态色 100% + 3px + 去 dash + glow。
  if (highlighted) {
    stroke = mod ? v3theme.modality[mod] : v3theme.signal.select
    strokeWidth = 3
    strokeDasharray = undefined
    strokeLinecap = undefined
    showEndpointDot = true
  }

  const showGlow = highlighted
  const hasOp = !!data?.op
  const edgeOpacity = dimmed ? 0.12 : 1

  return (
    <>
      {/* 高亮态柔光底层（溯源/选中：模态色大面积弥散，制造「亮起来」的层次） */}
      {showGlow && (
        <BaseEdge
          id={`${props.id}-glow`}
          path={edgePath}
          style={{ stroke, strokeWidth: 6, opacity: 0.18, filter: 'blur(2px)', pointerEvents: 'none' }}
        />
      )}
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray,
          strokeLinecap,
          opacity: edgeOpacity,
          transition:
            'stroke-width var(--cv-d-ancestor, 160ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), stroke var(--cv-d-ancestor, 160ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), opacity var(--cv-d-dim, 180ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
      />
      {/* 端点圆点 = 100% 模态色（无箭头；方向由布局左→右保证） */}
      {showEndpointDot && (
        <circle
          cx={props.targetX}
          cy={props.targetY}
          r={highlighted ? 3 : 2.5}
          fill={mod ? v3theme.modality[mod] : '#6B7080'}
          style={{ pointerEvents: 'none', opacity: edgeOpacity }}
        />
      )}
      {/* P19 边中点 op 芯片：折叠 event 的 op 配方标在拓扑线上（拓扑说明标签） */}
      {hasOp && (
        <EdgeLabelRenderer>
          <EdgeOpChip
            labelX={labelX}
            labelY={labelY}
            op={data!.op!}
            eventId={data!.eventId}
            executor={data!.executor}
            durationS={data!.durationS}
            params={data!.params}
            modality={mod}
            highlighted={highlighted}
            dimmed={dimmed}
            lod={lod}
          />
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(CanvasEdgeComponent)
