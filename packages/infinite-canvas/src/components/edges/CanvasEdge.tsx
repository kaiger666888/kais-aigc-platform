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

  const data = props.data as { dataType?: string } | undefined
  const dataType = data?.dataType ?? 'data'
  const color = edgeTypeColors[dataType] ?? edgeTypeColors.data

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
