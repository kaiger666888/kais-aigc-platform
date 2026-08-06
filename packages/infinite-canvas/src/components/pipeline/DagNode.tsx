/**
 * src/components/pipeline/DagNode.tsx — 单个 DAG 资产步骤节点卡（BlueOcean 风格）。
 *
 * 绝对定位的 HTML 卡（在 SVG 边层之上）。结构：
 *  ┌─┬──────────────────────┐
 *  │▎● P04  灰底Turnaround   │  左 3px 分组色条 + 状态圆点 + 阶段码 + 中文名
 *  │  8/8 ✓                  │  计数（完成/总数）+ 状态字形；待决策 → 金色 ⚠
 *  │  ████░░ 50%             │  进度条（部分完成 / 待决策时）
 *  └─┴──────────────────────┘
 * tone: normal / active（hover 命中上下游路径）/ dimmed（hover 时其余）。
 */
import { memo } from 'react'
import type { DagNodeModel } from './model'
import { DAG_STATE_META } from './model'
import { v3theme } from '../../theme/catppuccin'
import { NODE_WIDTH, NODE_HEIGHT } from './dagLayout'

export type NodeTone = 'normal' | 'active' | 'dimmed'

interface DagNodeProps {
  model: DagNodeModel
  x: number
  y: number
  tone: NodeTone
  onClick: () => void
  onHover: (id: string | null) => void
}

function DagNodeImpl({
  model,
  x,
  y,
  tone,
  onClick,
  onHover,
}: DagNodeProps): React.ReactElement {
  const { def, state, total, completed, selected, candidates, expected, progress } = model
  const meta = DAG_STATE_META[state]
  const groupColor = v3theme.phaseGroup[def.group]
  const active = tone === 'active'
  const dimmed = tone === 'dimmed'

  // 计数文案
  const denom = expected ?? total
  const countText = total === 0
    ? (expected != null ? `0/${expected}` : '—')
    : denom > 0 ? `${completed}/${denom}` : `${total} 项`
  const hasProgress = total > 0 && progress > 0 && progress < 1
  const showProgressBar = hasProgress || (state === 'has-candidates' && total > 0)

  return (
    <div
      data-dag-node="1"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onMouseEnter={() => onHover(def.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_WIDTH,
        // 有进度条时 +10 高度
        height: showProgressBar ? NODE_HEIGHT + 12 : NODE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        background: active ? '#1E2128' : '#16181D',
        border: `1px solid ${active ? groupColor : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 8,
        boxShadow: active
          ? `0 0 0 1px ${groupColor}55, 0 6px 16px rgba(0,0,0,0.5)`
          : '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset',
        overflow: 'hidden',
        cursor: 'pointer',
        opacity: dimmed ? 0.4 : 1,
        transition: 'opacity 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      {/* 左侧分组色条 */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: groupColor }} />

      {/* 主行：阶段码 + 标签 + 状态字形 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 0 10px' }}>
        <span
          title={def.phaseCode}
          style={{
            flex: '0 0 auto',
            color: groupColor,
            fontSize: 9.5,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            letterSpacing: '0.02em',
            opacity: 0.85,
          }}
        >
          {def.phaseCode}
        </span>
        <span
          style={{
            flex: '1 1 auto',
            color: '#EDEEF1',
            fontSize: 11.5,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {def.label}
        </span>
        <span
          title={meta.glyph}
          style={{
            flex: '0 0 auto',
            color: meta.color,
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            animation: meta.spin ? 'cv-pipe-spin 0.9s linear infinite' : undefined,
          }}
        >
          {total === 0 && state === 'pending' ? '○' : meta.glyph}
        </span>
      </div>

      {/* 计数行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 8px 5px 10px' }}>
        <span
          style={{
            fontFamily: 'var(--cv-font-mono, monospace)',
            fontSize: 10,
            color: total === 0 ? '#6B7080' : '#9A9FA8',
          }}
        >
          {countText}
        </span>
        {selected > 0 && (
          <span style={{ fontSize: 9.5, color: v3theme.signal.approved }}>
            ★{selected}
          </span>
        )}
        {state === 'has-candidates' && candidates > 0 && (
          <span
            title={`${candidates} 个资产待决策`}
            style={{ fontSize: 9.5, color: v3theme.signal.running, fontWeight: 600 }}
          >
            ⚠{candidates}待选
          </span>
        )}
      </div>

      {/* 进度条 */}
      {showProgressBar && (
        <div style={{ padding: '0 8px 6px 10px' }}>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                background: state === 'failed' ? meta.color : groupColor,
                borderRadius: 2,
                transition: 'width 220ms ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const DagNode = memo(DagNodeImpl)
export default DagNode
