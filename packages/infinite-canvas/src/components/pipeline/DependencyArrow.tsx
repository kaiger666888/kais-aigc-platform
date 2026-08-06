/**
 * src/components/pipeline/DependencyArrow.tsx — 阶段/分组之间的依赖箭头。
 *
 * 横向流水线方向（左→右）。两种粒度：
 *  - group：分组块之间的大箭头（视觉上分隔 research→story→production→post）；
 *  - phase：阶段卡之间的小箭头（细线 + 箭头头）。
 * 颜色用 v3theme.edge.neutral（冷白半透明），与画布边线同一词汇表。
 */
import { v3theme } from '../../theme/catppuccin'

export default function DependencyArrow({
  variant = 'phase',
  title,
}: {
  variant?: 'phase' | 'group'
  title?: string
}): React.ReactElement {
  const isGroup = variant === 'group'
  const color = v3theme.edge.neutral
  const w = isGroup ? 40 : 22
  const h = isGroup ? 22 : 14
  const stroke = isGroup ? 2 : 1.4
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        opacity: isGroup ? 0.9 : 0.7,
      }}
      title={title}
      aria-hidden="true"
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
        <path
          d={`M2 ${h / 2} H ${w - 7}`}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M${w - 9} 3 L${w - 2} ${h / 2} L${w - 9} ${h - 3}`}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
