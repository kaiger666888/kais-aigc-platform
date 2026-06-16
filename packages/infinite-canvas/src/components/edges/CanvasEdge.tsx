import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { edgeTypeColors } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { getBranchColor } from '../../theme/branchColors'

function CanvasEdgeComponent(props: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  const data = props.data as { dataType?: string; isInactive?: boolean; branchId?: string; isExplore?: boolean } | undefined
  const dataType = data?.dataType ?? 'data'
  const branchColor = getBranchColor(data?.branchId, data?.isExplore)

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

export default memo(CanvasEdgeComponent)
