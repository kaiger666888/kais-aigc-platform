import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { edgeTypeColors } from '../../utils/styles'

function CanvasEdgeComponent(props: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  const data = props.data as { dataType?: string; isInactive?: boolean } | undefined
  const dataType = data?.dataType ?? 'data'
  const color = edgeTypeColors[dataType] ?? edgeTypeColors.data

  // 非活跃连线样式
  if (data?.isInactive) {
    return (
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: '#45475a',
          strokeWidth: 1,
          strokeDasharray: '5 5',
          opacity: 0.4,
        }}
      />
    )
  }

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
