import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { edgeTypeColors } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { getBranchColor } from '../../theme/branchColors'
import type { LinkSemanticType, LinkRefType } from '../../types/canvas'

type EdgeData = {
  dataType?: string
  isInactive?: boolean
  branchId?: string
  isExplore?: boolean
  linkType?: LinkSemanticType
  refType?: LinkRefType
}

/** 判断 handle id 是否表示 ref 通道 */
function isRefHandle(h: string | null | undefined): boolean {
  return typeof h === 'string' && h.includes('ref')
}

function CanvasEdgeComponent(props: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  const data = props.data as EdgeData | undefined
  const linkType = data?.linkType
  const refType = data?.refType
  const branchColor = getBranchColor(data?.branchId, data?.isExplore)

  // 优先级1：ref 连线（targetHandle/sourceHandle 含 'ref'，或 refType=reference，或 linkType=reference）
  // 灰色细虚线 opacity 0.4
  if (
    isRefHandle(props.targetHandleId) ||
    isRefHandle(props.sourceHandleId) ||
    refType === 'reference' ||
    linkType === 'reference'
  ) {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: theme.border.subtle,
          strokeWidth: 1,
          strokeDasharray: '2 4',
          opacity: 0.4,
        }}
      />
    )
  }

  // 优先级2：sequence — 蓝色实线 + 箭头 marker
  if (linkType === 'sequence') {
    return (
      <>
        <SequenceMarker />
        <BaseEdge
          id={props.id}
          path={edgePath}
          markerEnd='url(#sequence-arrow)'
          style={{
            stroke: '#89b4fa',
            strokeWidth: 2,
          }}
        />
      </>
    )
  }

  // 优先级3：parallel — 绿色虚线
  if (linkType === 'parallel') {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: '#a6e3a1',
          strokeWidth: 2,
          strokeDasharray: '6 4',
        }}
      />
    )
  }

  // 优先级4：被淘汰的连线（变体组输家）
  if (data?.isInactive) {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: theme.border.subtle,
          strokeWidth: 1,
          strokeDasharray: '5 5',
          opacity: 0.4,
        }}
      />
    )
  }

  // 优先级5：探索性分支连线
  if (data?.isExplore) {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: branchColor.line,
          strokeWidth: 2,
          strokeDasharray: '8 4',
        }}
      />
    )
  }

  // 默认：按 dataType 着色
  const dataType = data?.dataType ?? 'data'
  const color = (data?.branchId && data?.branchId !== 'main')
    ? branchColor.line
    : edgeTypeColors[dataType] ?? edgeTypeColors.data

  return (
    <BaseEdge
      id={props.id}
      path={edgePath}
      style={{
        stroke: color,
        strokeWidth: 2,
      }}
    />
  )
}

/** sequence 边的箭头 marker（同 ID 重复定义无副作用，SVG 按首次出现解析） */
function SequenceMarker() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <marker
          id="sequence-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill="#89b4fa" />
        </marker>
      </defs>
    </svg>
  )
}

export default memo(CanvasEdgeComponent)
