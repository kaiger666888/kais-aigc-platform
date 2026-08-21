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

/**
 * blockingPhaseIndex（54-06 / GATE-02）:当前阻塞 phase 列索引(纯展示,
 * pointer-events:none 保持)。null/undefined = 无阻塞,渲染与改造前逐字节
 * 等价。列由节点 median 投影派生,兼容 Phase 55 zone 重构——无 zone hack。
 *
 * 阻塞列签名处理(UI-SPEC C-2):竖带 0.04→0.08 + 左边界双层金描边(底层
 * 4px/0.16 常伴,上层 1.5px 0.35↔0.7 呼吸,2.4s = 1.2s×2 既有慢拍组合)+
 * P0X 前缀提金/名称提亮。只 animate stroke-opacity/opacity(GPU 友好,
 * 画布缩放性能在案);零 SVG 滤镜;reduced-motion 静止 0.7。
 */
export default function PhaseColumns({
  geometry,
  blockingPhaseIndex = null,
}: {
  geometry: CanvasGeometry
  blockingPhaseIndex?: number | null
}): React.ReactElement | null {
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
      {/* 54-06 阻塞列呼吸/进场(名字作用域,非全局规则;reduced-motion 静止) */}
      <style>{`
        @keyframes cv-gate-col-breathe { 0%, 100% { stroke-opacity: 0.35 } 50% { stroke-opacity: 0.7 } }
        @keyframes cv-gate-col-enter { 0% { opacity: 0 } 25% { opacity: 1 } 50% { opacity: 0.3 } 100% { opacity: 1 } }
        .cv-gate-col-breathe { animation: cv-gate-col-breathe calc(var(--cv-d-running-spin) * 2) var(--cv-e-inout) infinite; }
        .cv-gate-col-enter { animation: cv-gate-col-enter calc(var(--cv-d-stale-pulse) * 2) var(--cv-e-inout) forwards; }
        @media (prefers-reduced-motion: reduce) {
          .cv-gate-col-breathe { animation: none; stroke-opacity: 0.7; }
          .cv-gate-col-enter { animation: none; opacity: 1; }
        }
      `}</style>
      {phaseColumns.map((col) => {
        const groupColor = v3theme.phaseGroup[col.group] ?? v3theme.laneLabel
        // 名称去掉前导 "P0X · " 前缀（P0X 序号单独用分组色渲染）
        const label = col.name.replace(/^P\d{2}\s*[·\-]?\s*/u, '') || col.name
        const prefix = `P${String(col.index).padStart(2, '0')}`
        const blocked = blockingPhaseIndex != null && col.index === blockingPhaseIndex
        return (
          <g key={`phase-${col.index}`}>
            {/* 阶段分组色竖带（极淡，不抢泳道色;阻塞列提亮到 0.08 + 金） */}
            <rect
              x={col.x0}
              y={0}
              width={Math.max(0, col.x1 - col.x0)}
              height={canvasBottom}
              fill={blocked ? v3theme.signal.running : groupColor}
              opacity={blocked ? 0.08 : 0.04}
            />
            {blocked ? (
              /* 左边界双层呼吸描边:底层 4px/0.16 常伴 + 上层 1.5px 呼吸(签名元素) */
              <>
                <line x1={col.x0} y1={0} x2={col.x0} y2={canvasBottom} stroke={v3theme.signal.running} strokeWidth={4} strokeOpacity={0.16} />
                <line className="cv-gate-col-breathe cv-gate-col-enter" x1={col.x0} y1={0} x2={col.x0} y2={canvasBottom} stroke={v3theme.signal.running} strokeWidth={1.5} />
              </>
            ) : (
              /* 左边界竖发丝线 */
              <line x1={col.x0} y1={0} x2={col.x0} y2={canvasBottom} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            )}
            {/* 带顶阶段标签：P0X（分组色;阻塞列提金）+ 名称（弱色;阻塞列提亮） */}
            <text
              x={col.x0 + 8}
              y={headerY}
              fill={blocked ? v3theme.signal.running : groupColor}
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
              fill={blocked ? v3theme.laneLabel : v3theme.phaseGroupLabel}
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
