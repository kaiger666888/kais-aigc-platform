/**
 * src/components/panel/ScoreRadar.tsx — 详情面板的评分雷达图（任务 2B）。
 *
 * 纯 SVG（不引图表库）。消费 V3 aiScore.dimensions（Record<维度名, 0–1 分值>）：
 *  - 维度数自适应（≥3 才成图；N 维均匀分布在 360° 上，起点正上方顺时针）；
 *  - 同心参考环（0.25/0.5/0.75/1.0，recessive）+ N 条轴线；
 *  - 单系列评分多边形（fill/stroke 按 overall 的 getScoreColor 染色，承载总体质量语义）；
 *  - 顶点圆点按该维 getScoreColor 染色（次要编码：直接读出哪维弱）；
 *  - hover 顶点/轴标签 → tooltip 显示「维度名: 精确分值」；
 *  - 文本一律走 text token（secondary/primary），颜色只落在标记上（dataviz 约定）；
 *  - 深色主题：网格/轴用 border.subtle，环底用 bg.surface。
 *
 * dimensions 缺省 / <3 维 → 返回 null（由 ScoreSection 退回 overall 大字）。
 */
import { memo, useMemo, useState } from 'react'
import type { AIScore } from '@kais/flowgraph-v3'
import { theme, getScoreColor } from '../../theme/catppuccin'

interface ScoreRadarProps {
  aiScore: AIScore
  /** 雷达直径（px），默认 200。 */
  size?: number
}

const RING_FRACTIONS = [0.25, 0.5, 0.75, 1.0]

function toUnit(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function polar(cx: number, cy: number, r: number, angRad: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angRad), y: cy + r * Math.sin(angRad) }
}

function polygonPoints(pts: Array<{ x: number; y: number }>): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

function ScoreRadar({ aiScore, size = 200 }: ScoreRadarProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const dims = useMemo(() => {
    const entries = aiScore.dimensions
      ? Object.entries(aiScore.dimensions).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      : []
    return entries.length >= 3 ? entries : []
  }, [aiScore.dimensions])

  const cx = size / 2
  const cy = size / 2
  const labelPad = 26
  const R = size / 2 - labelPad
  const N = dims.length

  // <3 维不成图（退回 overall 大字）
  if (N < 3) return null

  const angles = dims.map((_, i) => ((-90 + (i * 360) / N) * Math.PI) / 180)
  const axisEnds = angles.map((a) => polar(cx, cy, R, a))
  const valuePts = dims.map(([, v], i) => polar(cx, cy, toUnit(v) * R, angles[i]))
  const scoreColor = getScoreColor(aiScore.overall)

  // 维度标签锚点（略超出外环）+ 文本对齐
  const labelLayout = axisEnds.map((p, i) => {
    const dx = p.x - cx
    const anchor: 'start' | 'middle' | 'end' = Math.abs(dx) < 6 ? 'middle' : dx > 0 ? 'start' : 'end'
    const lp = polar(cx, cy, R + 12, angles[i])
    return { ...lp, anchor, name: dims[i][0], value: dims[i][1] }
  })

  const hoveredDim = hovered != null ? dims[hovered] : null
  const hoveredPt = hovered != null ? valuePts[hovered] : null

  return (
    <div
      data-testid="score-radar"
      style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="AI 评分雷达图">
        {/* 参考环（recessive） */}
        {RING_FRACTIONS.map((f) => {
          const ringPts = angles.map((a) => polar(cx, cy, f * R, a))
          return (
            <polygon
              key={f}
              points={polygonPoints(ringPts)}
              fill={f === 1.0 ? theme.bg.surface : 'none'}
              stroke={theme.border.subtle}
              strokeWidth={1}
              strokeOpacity={f === 1.0 ? 0.9 : 0.5}
            />
          )
        })}
        {/* 1.0 环刻度（单标签即可读出量纲） */}
        <text x={cx + 3} y={cy - R + 3} fontSize={8} fill={theme.text.secondary} fillOpacity={0.7}>
          1.0
        </text>

        {/* 轴线（recessive） */}
        {axisEnds.map((p, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke={theme.border.subtle}
            strokeWidth={1}
            strokeOpacity={0.6}
          />
        ))}

        {/* 评分多边形（单系列，overall 质量色） */}
        <polygon
          points={polygonPoints(valuePts)}
          fill={scoreColor}
          fillOpacity={0.18}
          stroke={scoreColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* 顶点圆点（该维质量色，次要编码）+ hover 命中区 */}
        {valuePts.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={8}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              style={{ cursor: 'pointer' }}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill={getScoreColor(toUnit(dims[i][1]))}
              stroke={theme.bg.card}
              strokeWidth={1}
              pointerEvents="none"
            />
          </g>
        ))}

        {/* 维度名标签（text token） */}
        {labelLayout.map((l, i) => (
          <text
            key={l.name}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            dominantBaseline="middle"
            fontSize={9}
            fontWeight={hovered === i ? 700 : 400}
            fill={hovered === i ? theme.text.primary : theme.text.secondary}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {l.name}
          </text>
        ))}
      </svg>

      {/* hover tooltip：精确数值（HTML 层，svg 坐标 1:1 = px） */}
      {hoveredDim && hoveredPt && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: hoveredPt.x,
            top: hoveredPt.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
            padding: '3px 7px',
            borderRadius: 5,
            background: theme.bg.overlay ?? theme.bg.card,
            border: `1px solid ${theme.border.subtle}`,
            color: theme.text.primary,
            fontSize: 10,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            zIndex: 2,
          }}
        >
          <span style={{ color: theme.text.secondary }}>{hoveredDim[0]}: </span>
          <span style={{ color: getScoreColor(toUnit(hoveredDim[1])), fontWeight: 700 }}>
            {toUnit(hoveredDim[1]).toFixed(2)}
          </span>
          <span style={{ color: theme.text.secondary }}> ({Math.round(toUnit(hoveredDim[1]) * 100)})</span>
        </div>
      )}
    </div>
  )
}

export default memo(ScoreRadar)
