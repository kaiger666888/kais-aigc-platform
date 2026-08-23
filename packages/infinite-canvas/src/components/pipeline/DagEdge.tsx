/**
 * src/components/pipeline/DagEdge.tsx — DAG 依赖边（SVG 贝塞尔曲线 + 箭头）。
 *
 * 在 PipelineStateMachine 的 SVG 边层渲染（z 序在节点卡之下）。视觉：
 *  - active（hover 命中的上下游路径）：亮冷白 0.55，实线
 *  - dimmed（hover 时其余边）：冷白 0.05
 *  - 默认：冷白 0.16；上游已完成 = 实线，未完成 = 虚线
 * 边型（kind；信号色复用 DAG_STATE_META 词汇，不引入新色）：
 *  - 'gate' 门控边：金色（running 同源 #E0B665）虚线 5 4 —— phase 级 quorum/depends_on 门
 *  - 'back' 回环边：玫红（rejected 同源 #DD6A82）虚线 3 4 —— 打回上游重做的迭代方向
 * 语义边恒虚线（不随上游完成转实线）；active 态统一亮白优先（路径语义压过边型）。
 * 箭头用父级 <defs> 里的 marker（dag-arrow / dag-arrow-hi），按 active 切换。
 */
import { memo } from 'react'

export type EdgeTone = 'default' | 'active' | 'dimmed'
export type DagEdgeKind = 'gate' | 'back'

interface DagEdgeProps {
  d: string
  tone: EdgeTone
  /** 上游（源节点）是否已完成 → 实线；否则虚线。active 态强制实线。 */
  upstreamDone: boolean
  /** 边型：缺省 = slot 数据流；gate/back 见文件头注释。 */
  kind?: DagEdgeKind
}

function DagEdgeImpl({ d, tone, upstreamDone, kind }: DagEdgeProps): React.ReactElement {
  const active = tone === 'active'
  const dimmed = tone === 'dimmed'
  const kindStroke =
    kind === 'gate' ? 'rgba(224,182,101,0.55)' : kind === 'back' ? 'rgba(221,106,130,0.50)' : null
  const stroke = active
    ? 'rgba(237,238,241,0.55)'
    : dimmed
      ? 'rgba(255,255,255,0.05)'
      : (kindStroke ?? 'rgba(255,255,255,0.16)')
  const dash =
    kind === 'gate' ? '5 4' : kind === 'back' ? '3 4' : !active && !upstreamDone ? '4 4' : undefined
  return (
    <path
      d={d}
      stroke={stroke}
      strokeWidth={active ? 1.8 : kind ? 1.5 : 1.3}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={dash}
      markerEnd={active ? 'url(#dag-arrow-hi)' : 'url(#dag-arrow)'}
      style={{ transition: 'stroke 120ms ease, stroke-width 120ms ease' }}
    />
  )
}

const DagEdge = memo(DagEdgeImpl)
export default DagEdge
