/**
 * src/components/nodes/EventChipNode.tsx — 事件芯片（P19：事件是边上的小芯片，不是节点）。
 *
 * 设计 §4.7 逐值：
 *  - 26×26 圆角 6，底 #313244 + 1px 边框 #45475A，图标 14px #A69F8F；
 *    executor=human → 人形图标，gpu/cloud → op 族图标（人机同构 P5 只靠图标区分）。
 *  - 常态零文字；hover（delay 150ms）出一行摘要 tooltip（T3 11px）：
 *    `wan22_i2v · gpu0 · 41s · seed 8842`；hover/选中关联时展开为「图标+op 名」横条
 *    （op 名 10px mono 截断至 56px，整条约 80px 上限）。
 *  - 点击 → onEventChipClick 出口（eventChipBus）；参数 popover 本体归 D。
 *  - LOD（§7）：L0 不渲染；L1 18×18 纯图标无框；L2 完整。
 *    选中节点的直接上下游芯片自动升至完整态（参数一键可达，P19）。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { EventNodeV3 } from '@kais/flowgraph-v3'
import { V3_NODE_SIZES } from '../../constants'
import { useLodLevel } from '../../hooks/useLod'
import { useCanvasStore } from '../../store/canvasStore'
import { useEventChipClick } from '../canvas/eventChipBus'
import { EventOpIcon } from '../canvas/icons'

type EventChipNodeType = Node<{
  v3?: EventNodeV3
  op?: EventNodeV3['op']
  params?: EventNodeV3['params']
  executor?: EventNodeV3['executor']
  durationS?: number
  label?: string
}>

const CHIP = V3_NODE_SIZES.chip.size // 26
const CHIP_L1 = V3_NODE_SIZES.chip.l1Size // 18

/** 一行摘要组装（§4.7：`op · executor · duration · seed`，缺项略过）。 */
export function chipSummary(data: EventChipNodeType['data']): string {
  const parts: string[] = []
  const op = data.op ?? 'event'
  parts.push(op)
  if (data.executor) parts.push(data.executor)
  if (typeof data.durationS === 'number') parts.push(`${data.durationS}s`)
  const seed = data.params && typeof data.params.seed === 'number' ? data.params.seed : undefined
  if (seed !== undefined) parts.push(`seed ${seed}`)
  return parts.join(' · ')
}

function EventChipNodeComponent({ id, data }: NodeProps<EventChipNodeType>) {
  const lod = useLodLevel()
  const onEventChipClick = useEventChipClick()
  const [hover, setHover] = useState(false)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // P19 升级规则：选中节点的直接上下游芯片 → 强制完整态
  const upgraded = useCanvasStore((s) => {
    const sel = s.selectedNode
    if (!sel || !s.graph) return false
    return s.graph.links.some(
      (l) => (l.source === sel.id && l.target === id) || (l.target === sel.id && l.source === id),
    )
  })

  useEffect(() => () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
  }, [])

  const handleEnter = useCallback(() => {
    setHover(true)
    tooltipTimer.current = setTimeout(() => setTooltipVisible(true), 150) // --cv-d-chip-tooltip-delay
  }, [])
  const handleLeave = useCallback(() => {
    setHover(false)
    setTooltipVisible(false)
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      onEventChipClick({
        eventId: id,
        op: String(data.op ?? 'event'),
        clientX: rect.left + rect.width / 2,
        clientY: rect.top,
      })
    },
    [id, data.op, onEventChipClick],
  )

  // L0 不渲染（§7：事件芯片/角标/标题全部不渲染）
  if (lod === 0 && !upgraded) return null

  const full = lod === 2 || upgraded
  const size = full ? CHIP : CHIP_L1
  const op = data.op ?? 'create'
  const executor = data.executor ?? 'gpu0'
  const expanded = full && (hover || upgraded)

  return (
    <div
      data-testid="event-chip"
      data-event-id={id}
      data-op={op}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: expanded ? 'auto' : size,
        maxWidth: V3_NODE_SIZES.chip.maxW,
        height: size,
        padding: expanded ? '0 6px' : 0,
        justifyContent: expanded ? 'flex-start' : 'center',
        background: full ? 'var(--cv-chip-bg, #313244)' : 'transparent',
        border: full ? '1px solid var(--cv-chip-border, #45475A)' : 'none',
        borderRadius: V3_NODE_SIZES.chip.radius,
        cursor: 'pointer',
        transition: 'width var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        overflow: 'visible',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 4, height: 4, border: 'none' }} />
      <EventOpIcon op={op} executor={executor} size={V3_NODE_SIZES.chip.icon} color={'#A69F8F'} />
      {expanded && (
        <span
          style={{
            fontFamily: 'var(--cv-font-mono, monospace)',
            fontSize: 10,
            color: 'var(--cv-text-secondary, #A69F8F)',
            maxWidth: 56,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {op}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 4, height: 4, border: 'none' }} />
      {tooltipVisible && (
        <div
          data-testid="event-chip-summary"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '3px 8px',
            borderRadius: 4,
            background: 'var(--cv-bg-overlay, #313244)',
            border: '1px solid var(--cv-chip-border, #45475A)',
            color: 'var(--cv-text-primary, #E8E2D5)',
            fontSize: 11, // T3
            fontFamily: 'var(--cv-font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
            animation: 'cv-chip-tip var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
          }}
        >
          {chipSummary(data)}
        </div>
      )}
    </div>
  )
}

export default memo(EventChipNodeComponent)
