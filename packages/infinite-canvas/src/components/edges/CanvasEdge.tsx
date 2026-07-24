/**
 * src/components/edges/CanvasEdge.tsx — 边三态 + reference 点线族（设计 §6，宪法 P11 落地）。
 *
 * tokens §2.3 冲突裁决已执行：
 *  - sequence 蓝实线+箭头 → 1px 暖灰虚线 dash 2 6（P11：排序约束不是因果，视觉退场）；
 *  - parallel 绿虚线并入 reference 点线族（dash 1 4）；branchColors 不再给单条边染色
 *    （分支是导航语义，归属由 zone/面板表达，getBranchColor 调用点已移出边渲染）；
 *  - 默认 dataType 彩色 2px 实线 → 因果边 = 产物模态色 @40% 透明度 1.5px，
 *    无箭头（方向由布局保证左→右），端点 4px 圆点 = 100% 模态色。
 *    【偏差】起止 24px 渐变淡出（规范允许的唯一渐变）未实现：直给 40% 均匀描边 +
 *    端点圆点；渐变需 per-edge userSpaceOnUse 渐变定义，收益低于复杂度，待 review 回定。
 *  - isInactive 5 5 @0.4 → dash 4 4 @25%（与 sequence 同族更低明度，统一进 token）。
 *  - 选中/溯源高亮（data.highlighted 或 RF selected）→ 2.5px + 100% 不透明（P18，C 接线）。
 *  - LOD L0（§7）：全部边 → 1px 暖灰直线（不画贝塞尔，性能与视觉双重退场）。
 */
import { memo } from 'react'
import { BaseEdge, getBezierPath, getStraightPath, type EdgeProps } from '@xyflow/react'
import { v3theme, type Modality } from '../../theme/catppuccin'
import { useLodLevel } from '../../hooks/useLod'

type EdgeData = {
  // V3 通道（adapter + useLayout 富化）
  role?: string
  isInactive?: boolean
  isExplore?: boolean
  branchId?: string
  productModality?: Modality
  /** C 的 P18 溯源高亮通道 */
  highlighted?: boolean
  // 旧通道（非 graph 路径过渡兼容）
  linkType?: string
  dataType?: string
  refType?: string
}

const NEUTRAL = v3theme.edge.neutral // sequence
const INACTIVE = v3theme.edge.inactive // isInactive
const REF = v3theme.edge.ref // reference 点线族

const REF_ROLES = new Set(['reference', 'lora_ref', 'prompt_ref'])

/** 模态 hex + 40% 透明度（因果边描边）。 */
function causalStroke(mod: Modality | undefined): string {
  const hex = mod ? v3theme.modality[mod] : '#6E6A5E'
  return `${hex}66`
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

  // L0 全景：1px 暖灰直线（§7：200 条贝塞尔在 L0 是性能与视觉双重浪费）
  if (lod === 0) {
    const [path] = getStraightPath(pathArgs)
    return <BaseEdge id={props.id} path={path} style={{ stroke: NEUTRAL, strokeWidth: 1 }} />
  }

  const [edgePath] = getBezierPath(pathArgs)

  // 三态优先级：isInactive > sequence > reference 族 > 因果
  if (data?.isInactive) {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{ stroke: INACTIVE, strokeWidth: 1, strokeDasharray: '4 4' }}
      />
    )
  }

  if (role === 'sequence' || linkType === 'sequence') {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{ stroke: NEUTRAL, strokeWidth: 1, strokeDasharray: '2 6', strokeLinecap: 'round' }}
      />
    )
  }

  if ((role && REF_ROLES.has(role)) || linkType === 'reference' || linkType === 'parallel' || data?.refType === 'reference') {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{ stroke: REF, strokeWidth: 1, strokeDasharray: '1 4', strokeLinecap: 'round' }}
      />
    )
  }

  // 因果边（含全部输入槽位 role 与 output）：产物模态色 @40% 1.5px，端点 4px 圆点
  const highlighted = data?.highlighted === true || props.selected === true
  const mod = data?.productModality
  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: highlighted ? (mod ? v3theme.modality[mod] : v3theme.signal.select) : causalStroke(mod),
          strokeWidth: highlighted ? 2.5 : 1.5,
          transition: 'stroke-width var(--cv-d-ancestor, 160ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), stroke var(--cv-d-ancestor, 160ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
      />
      {/* 端点圆点 4px = 100% 模态色（无箭头；方向由布局左→右保证） */}
      <circle
        cx={props.targetX}
        cy={props.targetY}
        r={2}
        fill={mod ? v3theme.modality[mod] : '#6E6A5E'}
        style={{ pointerEvents: 'none' }}
      />
    </>
  )
}

export default memo(CanvasEdgeComponent)
