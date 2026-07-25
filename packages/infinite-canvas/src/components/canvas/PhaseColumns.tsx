/**
 * src/components/canvas/PhaseColumns.tsx — 竖向创作阶段叠加层（P01–P13）。
 *
 * 不动布局引擎：阶段列由 useLayout 从各阶段 laid-out 节点中心 x 的 median 投影而来
 *（computePhaseColumns），在十泳道背景带（LaneBands）之上、节点之下叠加第二维度——
 * 「这一竖列资产属于哪个创作阶段」。与横泳道（资产类型）正交，合读即二维矩阵。
 *
 * 渲染（SVG flow 坐标，套 useViewport translate/scale 与 LaneBands 同变换）：
 *  - 极淡阶段分组色竖带（opacity 0.04，不抢泳道色）；
 *  - 阶段边界竖发丝线（同 LaneBands 带顶线风格）；
 *  - 带顶阶段标签：`P0X`（分组色）+ 名称（弱色 mono），左对齐 x0，落 global 泳道空旷主区。
 * pointer-events:none 不挡交互；overflow:visible 不裁。
 */
import { useViewport } from '@xyflow/react'
import type { CanvasGeometry } from './laneGeometry'
import { V3_LAYOUT } from '../../constants'
import { v3theme } from '../../theme/catppuccin'

const SPAN = 100000

export default function PhaseColumns({ geometry }: { geometry: CanvasGeometry }): React.ReactElement | null {
  const { x, y, zoom } = useViewport()
  const { bands, phaseColumns } = geometry
  if (!phaseColumns || phaseColumns.length === 0) return null

  const lastBand = bands[bands.length - 1]
  const canvasBottom = lastBand ? lastBand.top + lastBand.height : SPAN
  const headerY = (bands[0]?.top ?? 0) + V3_LAYOUT.LANE_TOP_INSET

  return (
    <svg
      data-testid="phase-columns"
      aria-hidden="true"
      width={1}
      height={1}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 0,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      {phaseColumns.map((col) => {
        const groupColor = v3theme.phaseGroup[col.group] ?? v3theme.laneLabel
        // 名称去掉前导 "P0X · " 前缀（P0X 序号单独用分组色渲染）
        const label = col.name.replace(/^P\d{2}\s*[·\-]?\s*/u, '') || col.name
        const prefix = `P${String(col.index).padStart(2, '0')}`
        return (
          <g key={`phase-${col.index}`}>
            {/* 阶段分组色竖带（极淡，不抢泳道色） */}
            <rect x={col.x0} y={0} width={Math.max(0, col.x1 - col.x0)} height={canvasBottom} fill={groupColor} opacity={0.04} />
            {/* 左边界竖发丝线 */}
            <line x1={col.x0} y1={0} x2={col.x0} y2={canvasBottom} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            {/* 带顶阶段标签：P0X（分组色）+ 名称（弱色） */}
            <text
              x={col.x0 + 8}
              y={headerY}
              fill={groupColor}
              fontSize={9}
              fontFamily="var(--cv-font-mono, monospace)"
              fontWeight={600}
              dominantBaseline="hanging"
            >
              {prefix}
            </text>
            <text
              x={col.x0 + 8 + 26}
              y={headerY}
              fill={v3theme.phaseGroupLabel}
              fontSize={10}
              fontFamily="var(--cv-font-mono, monospace)"
              dominantBaseline="hanging"
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
