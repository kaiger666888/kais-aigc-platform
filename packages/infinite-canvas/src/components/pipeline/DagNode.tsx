/**
 * src/components/pipeline/DagNode.tsx — 单个 DAG 资产步骤节点卡（BlueOcean 风格）。
 *
 * 绝对定位的 HTML 卡（在 SVG 边层之上）。结构：
 *  ┌─┬──────────────────────┐
 *  │▎● P04  灰底Turnaround   │  左 3px 分组色条 + 阶段码 + 中文名 + 状态圆点
 *  │  8/8 •                  │  计数（完成/总数）；待决策 → 金色 ⚠
 *  │  ████░░ 50%             │  进度条（部分完成 / 待决策时）
 *  └─┴──────────────────────┘
 * tone: normal / active（hover 命中上下游路径）/ dimmed（hover 时其余）。
 *
 * 视觉增强：标题字号加大、分组色微染背景、状态字形改为醒目圆点
 * （completed 绿实心 / running 金色脉冲 / failed 红实心 / has-candidates 金色脉冲 / pending 灰空心）。
 */
import { memo } from 'react'
import type { DagNodeModel } from './model'
import { DAG_STATE_META, dagStateLabel } from './model'
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

/**
 * 运行中 / 待决策圆点的扩散脉冲动画（box-shadow 雷达环）。
 * 注入一次到 <head>（避免每个节点重复渲染 <style>）；SSR 安全、严格模式幂等。
 * 金色硬编码：running 与 has-candidates 的 meta.color 同为 #E0B665。
 */
let pulseKeyframesInjected = false
function ensurePulseKeyframes(): void {
  if (pulseKeyframesInjected || typeof document === 'undefined') return
  pulseKeyframesInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-cv-dag', 'pulse')
  el.textContent =
    '@keyframes cv-pipe-pulse{0%{box-shadow:0 0 0 0 rgba(224,182,101,0.55)}' +
    '70%{box-shadow:0 0 0 6px rgba(224,182,101,0)}' +
    '100%{box-shadow:0 0 0 0 rgba(224,182,101,0)}}'
  document.head.appendChild(el)
}

function DagNodeImpl({
  model,
  x,
  y,
  tone,
  onClick,
  onHover,
}: DagNodeProps): React.ReactElement {
  ensurePulseKeyframes()
  const { def, state, total, completed, selected, candidates, expected, progress } = model
  const meta = DAG_STATE_META[state]
  const groupColor = v3theme.phaseGroup[def.group]
  const active = tone === 'active'
  const dimmed = tone === 'dimmed'
  // 审计/Gate 弱节点（dim:true）→ 缩小 + 降不透明度，视觉上从主流程弱化。
  const isDimNode = def.dim === true

  // 计数文案
  const denom = expected ?? total
  const countText = total === 0
    ? (expected != null ? `0/${expected}` : '—')
    : denom > 0 ? `${completed}/${denom}` : `${total} 项`
  const hasProgress = total > 0 && progress > 0 && progress < 1
  const showProgressBar = hasProgress || (state === 'has-candidates' && total > 0)

  // 圆点是否带脉冲（运行中 / 待决策 → 金色扩散环）
  const pulse = state === 'running' || state === 'has-candidates'

  // 分组色微染背景：completed/running/待决策 → 暖色弱底渐变；failed → 红染；pending → 纯暗底。
  // active 命中时基面提亮到 #1E2128（hover 反馈），分组色边框 + 外发光见下方 border/boxShadow。
  const baseSurface = active ? '#1E2128' : '#16181D'
  const tintedBg = (() => {
    switch (state) {
      case 'completed':      return `linear-gradient(90deg, ${groupColor}1F 0%, ${baseSurface} 55%)`
      case 'has-candidates': return `linear-gradient(90deg, ${groupColor}2B 0%, ${baseSurface} 60%)`
      case 'running':        return `linear-gradient(90deg, ${groupColor}38 0%, ${baseSurface} 65%)`
      case 'failed':         return `linear-gradient(90deg, ${meta.color}26 0%, ${baseSurface} 60%)`
      default:               return baseSurface // pending → 纯暗底
    }
  })()

  // dim:true 审计节点渲染降级：缩小到 0.85 + 不透明度 0.55。
  // 用 transform-origin: top left 保持 x/y 左上角定位语义不变（缩放后不偏移网格）。
  // active 命中（hover 上下游路径高亮）时取消降级，便于聚焦查看审计节点状态。
  const dimScale = isDimNode && !active ? 0.85 : 1
  const dimOpacity = isDimNode && !active ? 0.55 : 1

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
        background: tintedBg,
        border: `1px solid ${active ? groupColor : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 8,
        boxShadow: active
          ? `0 0 0 1px ${groupColor}55, 0 6px 16px rgba(0,0,0,0.5)`
          : '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset',
        overflow: 'hidden',
        cursor: 'pointer',
        opacity: (dimmed ? 0.4 : 1) * dimOpacity,
        transform: dimScale !== 1 ? `scale(${dimScale})` : undefined,
        transformOrigin: 'top left',
        transition: 'opacity 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      {/* 左侧分组色条 */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: groupColor }} />

      {/* 主行：阶段码 + 标签 + 状态圆点 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 0 10px' }}>
        <span
          title={def.phaseCode}
          style={{
            flex: '0 0 auto',
            color: groupColor,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            letterSpacing: '0.02em',
            opacity: 0.95,
          }}
        >
          {def.phaseCode}
        </span>
        <span
          style={{
            flex: '1 1 auto',
            color: '#EDEEF1',
            fontSize: 13,
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {def.label}
        </span>
        {/* 状态圆点：completed 绿实心 / running 金色脉冲 / failed 红实心 / has-candidates 金色脉冲 / pending 灰空心 */}
        <div
          title={dagStateLabel(state)}
          style={{
            flex: '0 0 auto',
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: state === 'pending' ? 'transparent' : meta.color,
            border: state === 'pending' ? `1.5px solid ${meta.color}` : undefined,
            boxShadow: state === 'pending' || pulse ? undefined : `0 0 5px ${meta.color}66`,
            animation: pulse ? 'cv-pipe-pulse 1.2s ease-out infinite' : undefined,
          }}
        />
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
