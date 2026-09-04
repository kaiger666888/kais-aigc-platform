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

/**
 * 'reverse' 附加变体（逆向工程 DAG 视图专用，原管线不传 → 行为零变化）。
 *  - variant: 'reverse' = 青紫系描边镜像节点卡（附「逆」徽标）；
 *             'gate'    = Kai 审核门旗标卡（菱形边框 + G1/G2/G3）；
 *             'forensics' = L0 取证通道卡（虚线边框）；
 *             'source'  = 真值源卡（src-master，最右端）。
 *  - status: 逆向状态（sealed 金绿 / active 琥珀 / pending 灰 / blocked 红，门 sealed 显示 ✓）。
 *  - lane:   三泳道着色点标（T 文本 / V 视觉 / V+A 双点；门/取证为 null 不着色）。
 */
export interface ReverseNodeVisual {
  variant: 'reverse' | 'gate' | 'forensics' | 'source'
  status: 'sealed' | 'active' | 'pending' | 'blocked'
  lane: 'text' | 'visual' | 'visual_audio' | null
  gateTag?: 'G1' | 'G2' | 'G3'
}

interface DagNodeProps {
  model: DagNodeModel
  x: number
  y: number
  tone: NodeTone
  onClick: () => void
  onHover: (id: string | null) => void
  /** 逆向视图附加视觉（缺省 = 原管线渲染路径，零差异）。 */
  reverse?: ReverseNodeVisual
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
  reverse,
}: DagNodeProps): React.ReactElement {
  ensurePulseKeyframes()
  // ── 逆向变体分支（reverse 传入时接管渲染；原管线不传 → 走下方原有路径，零差异） ──
  if (reverse) return <ReverseDagNode model={model} x={x} y={y} tone={tone} visual={reverse} onClick={onClick} onHover={onHover} />
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

// ═══════════════════════════════════════════════════════════════════════
// 逆向工程 DAG 视图节点卡（追加变体；原管线渲染路径不经过此区）
// ═══════════════════════════════════════════════════════════════════════

/** 逆向主色调（青紫系，KAP v3 image 青 #56B89A 词汇）。 */
const RV_ACCENT = '#56B89A'
/** 状态词表（sealed=金绿 / active=琥珀 / pending=灰 / blocked=红）。 */
const RV_STATUS_META: Record<ReverseNodeVisual['status'], { color: string; label: string }> = {
  sealed: { color: '#56B89A', label: '已封存' },
  active: { color: '#E0B665', label: '进行中' },
  pending: { color: '#9A9FA8', label: '待启动' },
  blocked: { color: '#DD6A82', label: '受阻' },
}
/** 泳道点标（post 双色 = V 青 + A 橙双点）。 */
const RV_LANE_COLORS: Record<Exclude<ReverseNodeVisual['lane'], null>, string[]> = {
  text: ['#E0B665'],
  visual: ['#56B89A'],
  visual_audio: ['#56B89A', '#E08547'],
}

function ReverseDagNode({
  model,
  x,
  y,
  tone,
  visual,
  onClick,
  onHover,
}: DagNodeProps & { visual: ReverseNodeVisual }): React.ReactElement {
  const active = tone === 'active'
  const dimmed = tone === 'dimmed'
  const statusMeta = RV_STATUS_META[visual.status]
  const gate = visual.variant === 'gate'
  const forensics = visual.variant === 'forensics' || visual.variant === 'source'

  // 边框：镜像/取证 = 青紫系描边（取证虚线）；门 = 旗标实边；active 高亮
  const border = (() => {
    if (active) return `1.5px solid ${RV_ACCENT}`
    if (gate) return `1.5px solid ${RV_ACCENT}`
    if (forensics) return `1px dashed rgba(86,184,154,0.45)`
    return `1px solid rgba(86,184,154,0.30)`
  })()

  // 门节点旗标样式：外层四角 L 形旗标（菱形视觉锚点）+ G 字徽标；sealed 显示 ✓
  const gateCheck = gate && visual.status === 'sealed' ? '✓' : null

  // 底面：active 提亮；门/取证 微青染；镜像 默认暗底
  const bg = active
    ? '#1E2128'
    : gate
      ? 'linear-gradient(90deg, rgba(86,184,154,0.16) 0%, #16181D 60%)'
      : forensics
        ? 'linear-gradient(90deg, rgba(86,184,154,0.08) 0%, #16181D 60%)'
        : '#16181D'

  return (
    <div
      data-dag-node="1"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onMouseEnter={() => onHover(model.def.id)}
      onMouseLeave={() => onHover(null)}
      title={`${model.def.label} · 逆向状态：${statusMeta.label}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        background: bg,
        border,
        borderRadius: gate ? 4 : 8,
        boxShadow: active
          ? `0 0 0 1px ${RV_ACCENT}55, 0 6px 16px rgba(0,0,0,0.5)`
          : '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset',
        overflow: 'hidden',
        cursor: 'pointer',
        opacity: dimmed ? 0.4 : 1,
        transition: 'opacity 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
        // 门旗标：旋转 45° 的外框线营造菱形张力（内层文字保持水平）
        outline: gate ? `1px solid rgba(86,184,154,0.35)` : undefined,
        outlineOffset: gate ? 3 : undefined,
      }}
    >
      {/* 左侧泳道点标（仅镜像节点；post = 双色点） */}
      {visual.lane != null && (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, display: 'flex', flexDirection: 'column' }}>
          {RV_LANE_COLORS[visual.lane].map((c, i) => (
            <div key={i} style={{ flex: 1, background: c, opacity: 0.85 }} />
          ))}
        </div>
      )}

      {/* 门节点：左上角 G 徽标（旗标字样）+ sealed ✓ */}
      {gate && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 5px',
            borderBottomLeftRadius: 5,
            background: 'rgba(86,184,154,0.16)',
            color: RV_ACCENT,
            fontSize: 9.5,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            letterSpacing: '0.05em',
          }}
        >
          {visual.gateTag}
          {gateCheck && <span style={{ color: '#56B89A' }}>✓</span>}
        </div>
      )}

      {/* 镜像节点：右上角「逆」小徽标 */}
      {!gate && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            padding: '1px 5px',
            borderBottomLeftRadius: 5,
            background: 'rgba(86,184,154,0.12)',
            color: RV_ACCENT,
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          逆
        </div>
      )}

      {/* 主行：阶段码 + 标签 + 状态点 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 0 10px' }}>
        <span
          style={{
            flex: '0 0 auto',
            color: gate || forensics ? RV_ACCENT : 'rgba(86,184,154,0.85)',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            letterSpacing: '0.02em',
          }}
        >
          {model.def.phaseCode}
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
            paddingRight: gate ? 34 : 16, // 给右上角徽标让位
          }}
        >
          {model.def.label}
        </span>
        {/* 逆向状态点（无脉冲——逆向静态表，非实时执行态） */}
        <div
          title={statusMeta.label}
          style={{
            flex: '0 0 auto',
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: visual.status === 'pending' ? 'transparent' : statusMeta.color,
            border: visual.status === 'pending' ? `1.5px solid ${statusMeta.color}` : undefined,
            boxShadow: visual.status === 'pending' ? undefined : `0 0 5px ${statusMeta.color}66`,
          }}
        />
      </div>

      {/* 计数行：逆向语义（状态文案） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 8px 5px 10px' }}>
        <span style={{ fontSize: 10, color: statusMeta.color, opacity: 0.85 }}>
          {statusMeta.label}
        </span>
      </div>
    </div>
  )
}
