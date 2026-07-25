/**
 * src/components/edges/EdgeOpChip.tsx — 边中点 op 芯片（P19：事件是边上的小芯片，不是节点）。
 *
 * V3 adapter 把 asset→event→asset 折叠为 asset→asset 直连边时，已把中间 event 的 op 配方
 * 挂到 edge.data（adapter graphToViewModel）。本组件在边的贝塞尔中点（getBezierPath 的
 * labelX/labelY）渲染一颗 op 芯片 = 「拓扑线上的说明标签」（设计参考 canvas.html v1）。
 *
 * 可见性策略（对齐参考图「标签始终清晰可读」）：
 *  - 反缩放 scale(1/zoom) → 芯片在屏幕上恒定尺寸，不随画布缩放变小（节点会缩放，但
 *    边标签的职责是「随时可读」，故独立保持屏幕尺寸）。
 *  - L1（中景）= 带框图标珠（无文字，避免密集时拥挤）；L2（近景）= 图标 + op 名文字。
 *  - hover 出摘要 tooltip（op · executor · duration · seed）；点击经 eventChipBus 出参数
 *    popover（eventId 透传，popover 据 id 从 graph 查完整 params）。
 *  - 溯源/选中（highlighted）→ 模态色描边 + 柔光升格，呼应边提亮。
 *  LOD L0 不渲染（CanvasEdge 在 L0 提前 return；全景概览不带标签）。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useViewport } from '@xyflow/react'
import { EventOpIcon } from '../canvas/icons'
import { V3_NODE_SIZES } from '../../constants'
import { v3theme, type Modality } from '../../theme/catppuccin'
import { useEventChipClick } from '../canvas/eventChipBus'

interface Props {
  labelX: number
  labelY: number
  op: string
  eventId?: string
  executor?: 'human' | 'gpu0' | 'gpu1' | 'cloud' | string
  durationS?: number
  params?: Record<string, unknown>
  modality?: Modality
  highlighted?: boolean
  lod: number
}

/** 一行摘要（§4.7：`op · executor · duration · seed`，缺项略过）。 */
function summary(p: Pick<Props, 'op' | 'executor' | 'durationS' | 'params'>): string {
  const parts: string[] = [p.op]
  if (p.executor) parts.push(p.executor)
  if (typeof p.durationS === 'number') parts.push(`${p.durationS}s`)
  const seed = p.params && typeof p.params.seed === 'number' ? p.params.seed : undefined
  if (seed !== undefined) parts.push(`seed ${seed}`)
  return parts.join(' · ')
}

function EdgeOpChipComponent({
  labelX,
  labelY,
  op,
  eventId,
  executor,
  durationS,
  params,
  modality,
  highlighted,
  lod,
}: Props): React.ReactElement {
  const onEventChipClick = useEventChipClick()
  const { zoom } = useViewport()
  const [hover, setHover] = useState(false)
  const [tipVisible, setTipVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const handleEnter = useCallback(() => {
    setHover(true)
    timer.current = setTimeout(() => setTipVisible(true), 150) // --cv-d-chip-tooltip-delay
  }, [])
  const handleLeave = useCallback(() => {
    setHover(false)
    setTipVisible(false)
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      onEventChipClick({
        eventId: eventId ?? op,
        op,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top,
      })
    },
    [eventId, op, onEventChipClick],
  )

  // 反缩放：芯片保持恒定屏幕尺寸（1/zoom 抵消视口缩放）。zoom=0 时退回 1（防除零）。
  const inv = zoom > 0 ? 1 / zoom : 1
  const showText = lod === 2 // L2 近景才显 op 名文字；L1 仅图标珠
  const size = V3_NODE_SIZES.chip.size // 恒定 26（屏幕尺寸，反缩放后不随 zoom 变）
  const accent = modality ? v3theme.modality[modality] : v3theme.signal.select
  const iconColor = highlighted ? accent : '#9A9FA8'
  const borderColor = highlighted ? accent : 'var(--cv-chip-border, rgba(255,255,255,0.10))'

  return (
    // 外层：定位到边中点 + 居中；承载 tooltip（不反缩放，保证文字恒定可读）。
    <div
      data-testid="edge-op-chip"
      data-op={op}
      className="nodrag nopan"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }}
    >
      {/* 内层：反缩放芯片本体（恒定屏幕尺寸） */}
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: showText ? 'auto' : size,
          maxWidth: V3_NODE_SIZES.chip.maxW,
          height: size,
          padding: showText ? '0 6px' : 0,
          justifyContent: showText ? 'flex-start' : 'center',
          background: 'var(--cv-chip-bg, #1E2128)',
          border: `1px solid ${borderColor}`,
          borderRadius: V3_NODE_SIZES.chip.radius,
          cursor: 'pointer',
          transform: `scale(${inv})`,
          transformOrigin: 'center',
          boxShadow: highlighted ? `0 0 0 1px ${accent}40, 0 0 10px ${accent}30` : hover ? `0 0 0 1px ${accent}30` : 'none',
          transition: 'border-color var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
      >
        <EventOpIcon op={op} executor={executor ?? 'gpu0'} size={V3_NODE_SIZES.chip.icon} color={iconColor} />
        {showText && (
          <span
            style={{
              fontFamily: 'var(--cv-font-mono, monospace)',
              fontSize: 10,
              color: 'var(--cv-text-secondary, #9A9FA8)',
              maxWidth: 56,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {op}
          </span>
        )}
      </div>
      {tipVisible && (
        <div
          data-testid="edge-op-chip-summary"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '3px 8px',
            borderRadius: 4,
            background: 'var(--cv-bg-overlay, #1E2128)',
            border: '1px solid var(--cv-chip-border, rgba(255,255,255,0.10))',
            color: 'var(--cv-text-primary, #EDEEF1)',
            fontSize: 11, // T3
            fontFamily: 'var(--cv-font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
            animation: 'cv-chip-tip var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
          }}
        >
          {summary({ op, executor, durationS, params })}
        </div>
      )}
    </div>
  )
}

export default memo(EdgeOpChipComponent)
