/**
 * src/components/pipeline/DagEdge.tsx — DAG 依赖边（SVG 贝塞尔曲线 + 箭头）。
 *
 * 在 PipelineStateMachine 的 SVG 边层渲染（z 序在节点卡之下）。视觉：
 *  - active（hover 命中的上下游路径）：亮冷白 0.55，实线
 *  - dimmed（hover 时其余边）：冷白 0.05
 *  - 默认：冷白 0.16；上游已完成 = 实线，未完成 = 虚线
 * 箭头用父级 <defs> 里的 marker（dag-arrow / dag-arrow-hi），按 active 切换。
 */
import { memo } from 'react'

export type EdgeTone = 'default' | 'active' | 'dimmed'

interface DagEdgeProps {
  d: string
  tone: EdgeTone
  /** 上游（源节点）是否已完成 → 实线；否则虚线。active 态强制实线。 */
  upstreamDone: boolean
}

function DagEdgeImpl({ d, tone, upstreamDone }: DagEdgeProps): React.ReactElement {
  const active = tone === 'active'
  const dimmed = tone === 'dimmed'
  const stroke = active ? 'rgba(237,238,241,0.55)' : dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.16)'
  const dashed = !active && !upstreamDone
  return (
    <path
      d={d}
      stroke={stroke}
      strokeWidth={active ? 1.8 : 1.3}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={dashed ? '4 4' : undefined}
      markerEnd={active ? 'url(#dag-arrow-hi)' : 'url(#dag-arrow)'}
      style={{ transition: 'stroke 120ms ease, stroke-width 120ms ease' }}
    />
  )
}

const DagEdge = memo(DagEdgeImpl)
export default DagEdge
