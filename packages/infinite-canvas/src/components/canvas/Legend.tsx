/**
 * src/components/canvas/Legend.tsx — 浮动图例（参考 canvas.html v1 右上 legend）。
 *
 * 整套画布视觉语言是「颜色=模态 / 线型=边语义 / 芯片=生成步骤」，但此前没有一个
 * 解释入口。本组件作为可折叠浮层（默认收起为一个「图例」小胶囊，点击展开），
 * 把四模态色 + 三类边线型 + 边中点 op 芯片 + stale/选中态一次说清，降低新人门槛。
 *
 * 挂在 <Panel position="top-right">（FlowCanvas 内 ReactFlow 子树），与左上工具栏对称为
 * 右上角浮层；半透明卡 + backdrop-blur，跟现有浮层（Controls/MiniMap）同语言。
 */
import { useState } from 'react'
import { Panel } from '@xyflow/react'
import { v3theme } from '../../theme/catppuccin'
import { theme } from '../../theme/catppuccin'
import { MODALITY_LABELS, type LaneModality } from '../../v3/lanes'
import { EventOpIcon } from './icons'

const MOD_ORDER: LaneModality[] = ['text', 'image', 'audio', 'video']

export default function Legend(): React.ReactElement {
  const [open, setOpen] = useState(false)

  const cardStyle: React.CSSProperties = {
    background: 'rgba(17,19,23,0.92)',
    border: `1px solid ${theme.border.default}`,
    borderRadius: 8,
    backdropFilter: 'blur(4px)',
    boxShadow: theme.shadow.pop,
    color: theme.text.primary,
    userSelect: 'none',
  }

  if (!open) {
    return (
      <Panel position="top-right" style={{ marginTop: 8, marginRight: 8 }}>
        <button
          data-testid="legend-toggle"
          onClick={() => setOpen(true)}
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            fontSize: 11,
            color: theme.text.secondary,
          }}
          title="展开图例"
        >
          <ListIcon size={12} color={theme.text.secondary} />
          图例
        </button>
      </Panel>
    )
  }

  return (
    <Panel position="top-right" style={{ marginTop: 8, marginRight: 8 }}>
      <div data-testid="legend-panel" style={{ ...cardStyle, width: 188, padding: 10 }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: theme.text.tertiary, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
            图例
          </span>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'transparent', border: 'none', color: theme.text.tertiary, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 2 }}
            title="收起"
          >
            ✕
          </button>
        </div>

        {/* 模态色 */}
        <SectionTitle>模态 · 内容色</SectionTitle>
        {MOD_ORDER.map((m) => (
          <Row key={m}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: v3theme.modality[m] }} />
            <span>{MODALITY_LABELS[m]}</span>
          </Row>
        ))}

        {/* 边线型 */}
        <SectionTitle style={{ marginTop: 10 }}>边 · 拓扑</SectionTitle>
        <Row>
          <LineSwatch style={{ background: v3theme.modality.image, opacity: 0.55 }} />
          <span>因果（实线）</span>
        </Row>
        <Row>
          <LineSwatch style={{ borderTop: `1px dashed ${theme.text.tertiary}` }} />
          <span>sequence（虚线）</span>
        </Row>
        <Row>
          <LineSwatch style={{ borderTop: `1px dotted ${theme.text.tertiary}` }} />
          <span>reference（点线）</span>
        </Row>

        {/* op 芯片 */}
        <SectionTitle style={{ marginTop: 10 }}>事件 · 生成步骤</SectionTitle>
        <Row>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 5,
              background: theme.bg.overlay,
              border: `1px solid ${theme.border.subtle}`,
            }}
          >
            <EventOpIcon op="wan22_i2v" executor="gpu0" size={12} color={theme.text.secondary} />
          </span>
          <span>边中点 op 标签</span>
        </Row>

        {/* 状态 */}
        <SectionTitle style={{ marginTop: 10 }}>状态</SectionTitle>
        <Row>
          <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: v3theme.signal.stale, boxShadow: `0 0 6px ${v3theme.signal.stale}` }} />
          <span>stale · 待重跑</span>
        </Row>
        <Row>
          <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${v3theme.signal.select}`, boxShadow: `0 0 6px ${v3theme.signal.select}66` }} />
          <span>选中 · 溯源链</span>
        </Row>
      </div>
    </Panel>
  )
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): React.ReactElement {
  return (
    <div style={{ fontSize: 9, color: theme.text.tertiary, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: 4, ...style }}>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, color: theme.text.secondary, marginBottom: 3 }}>
      {children}
    </div>
  )
}

/** 16px 宽的线样例（实线用 background，虚/点线用 border-top）。 */
function LineSwatch({ style }: { style: React.CSSProperties }): React.ReactElement {
  return <span style={{ display: 'inline-block', width: 18, height: 0, ...style }} />
}

function ListIcon({ size, color }: { size: number; color: string }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}
