/**
 * src/components/ReversePipelineView.tsx — 逆向工程 DAG 视图（第六个 viewMode='reverse'）。
 *
 * 以 PipelineStateMachine（原管线状态机）为模板改写，交互全部保留（滚轮缩放/拖拽平移/
 * fit-to-screen/hover 高亮/点击 detail），差异点：
 *  - 数据 = reverseModel（静态：45 镜像节点 + G1/G2/G3 门 + L0 取证层），不派生画布执行态；
 *  - 布局 = layoutReverseDag()（LR + 结构性反转 + 水平镜像 + 取证行，见 reverseModel 头注释），
 *    视觉骨架与原管线同构、依赖边从右往左（hover 高亮的是「它的裁判链」而非「它的产出链」）；
 *  - 节点 = DagNode 的 reverse 附加变体（青紫系描边 +「逆」徽标 / 门旗标 / 取证虚线框）；
 *  - 详情 = ReverseDetailPanel（逆向语义：对应原管线节点 / 逆向状态+泳道 / kgr 证据路径）。
 *
 * 原管线视图零改动：本组件不写 store（只读 projectId/episodesId/graph.meta），不碰
 * PipelineStateMachine / model.ts。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { UiIcon } from './canvas/icons'
import {
  layoutReverseDag,
  reverseStatusOf,
  reverseAncestorsOf,
  reverseDescendantsOf,
  REVERSE_NODES,
  REVERSE_EDGES,
  REVERSE_NODE_IDS,
  REVERSE_NODE_BY_ID,
  REVERSE_STATUS_META,
  REVERSE_LANE_META,
  REVERSE_EVIDENCE_PATHS,
  REVERSE_EVIDENCE_FALLBACK,
  type ReverseNodeDef,
} from './pipeline/reverseModel'
import { PHASE_GROUP_LABELS, type PhaseGroup, type DagNodeModel, type DagNodeState } from './pipeline/model'
import { edgePathD, type LayoutNode } from './pipeline/dagLayout'
import DagNode, { type NodeTone, type ReverseNodeVisual } from './pipeline/DagNode'
import DagEdge, { type EdgeTone, type DagEdgeKind } from './pipeline/DagEdge'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.6
/** 点击 vs 拖拽判定阈值（px）。超过则视为拖拽，抑制 click。 */
const DRAG_THRESHOLD = 4

interface ReversePipelineViewProps {
  onRefresh?: () => void
}

export default function ReversePipelineView({
  onRefresh,
}: ReversePipelineViewProps): React.ReactElement {
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const graph = useCanvasStore((s) => s.graph)

  // ── 静态逆向布局（模块级常量数据 → 只算一次） ──
  const layout = useMemo(() => layoutReverseDag(), [])
  const layoutById = useMemo(() => {
    const m = new Map<string, LayoutNode>()
    for (const n of layout.nodes) m.set(n.id, n)
    return m
  }, [layout])
  // 语义边型（gate 门控 / back 回环）查表：layoutDag 重建边对象不带自定义字段
  const edgeKindById = useMemo(() => {
    const m = new Map<string, DagEdgeKind>()
    for (const e of REVERSE_EDGES) if (e.kind) m.set(`${e.from}->${e.to}`, e.kind)
    return m
  }, [])

  // ── 视口变换 ──
  const viewportRef = useRef<HTMLDivElement>(null)
  const [tx, setTx] = useState(40)
  const [ty, setTy] = useState(40)
  const [zoom, setZoom] = useState(0.5)
  const dragRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; startTx: number; startTy: number }>({
    active: false, moved: false, startX: 0, startY: 0, startTx: 0, startTy: 0,
  })

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // hover 高亮集：右侧裁判链（祖先）+ 左侧被裁决链（后代）——方向语义与原管线相反
  const highlightSet = useMemo(() => {
    if (!hoveredId) return null
    const a = reverseAncestorsOf(hoveredId)
    const d = reverseDescendantsOf(hoveredId)
    return new Set([...a, ...d])
  }, [hoveredId])

  // fit-to-screen：按内容包围盒居中
  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el || layout.width === 0 || layout.height === 0) return
    const rect = el.getBoundingClientRect()
    const pad = 48
    const z = Math.min(
      (rect.width - pad) / layout.width,
      (rect.height - pad) / layout.height,
      MAX_ZOOM,
    )
    const nextZoom = Math.max(MIN_ZOOM, z)
    setZoom(nextZoom)
    setTx((rect.width - layout.width * nextZoom) / 2)
    setTy((rect.height - layout.height * nextZoom) / 2)
  }, [layout.width, layout.height])

  // 首次布局就绪 → 自动 fit（仅一次）
  const didFitRef = useRef(false)
  useEffect(() => {
    if (didFitRef.current) return
    if (layout.width === 0) return
    const el = viewportRef.current
    if (!el || el.clientWidth === 0) return
    fit()
    didFitRef.current = true
  }, [layout.width, fit])

  // ── 缩放（向光标） ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * (e.deltaY > 0 ? 0.9 : 1.1)))
      const factor = next / prev
      setTx((ptx) => mx - (mx - ptx) * factor)
      setTy((pty) => my - (my - pty) * factor)
      return next
    })
  }, [])

  // ── 平移（背景拖拽；节点卡 mousedown 不触发，留给 click） ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-dag-node]')) return
    dragRef.current = {
      active: true, moved: false,
      startX: e.clientX, startY: e.clientY,
      startTx: tx, startTy: ty,
    }
  }, [tx, ty])

  useEffect(() => {
    function onMove(ev: MouseEvent) {
      const d = dragRef.current
      if (!d.active) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) d.moved = true
      setTx(d.startTx + dx)
      setTy(d.startTy + dy)
    }
    function onUp() {
      dragRef.current.active = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 背景点击：未拖拽 → 关闭详情面板
  const handleBackgroundClick = useCallback(() => {
    if (dragRef.current.moved) return
    setSelectedId(null)
  }, [])

  const handleNodeClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  // ── 统计（逆向状态计数） ──
  const stats = useMemo(() => {
    let sealed = 0, active = 0, pending = 0, blocked = 0
    for (const id of REVERSE_NODE_IDS) {
      const s = reverseStatusOf(id)
      if (s === 'sealed') sealed++
      else if (s === 'active') active++
      else if (s === 'blocked') blocked++
      else pending++
    }
    return { sealed, active, pending, blocked, total: REVERSE_NODE_IDS.length }
  }, [])

  const meta = graph?.meta
  const updatedMs = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : null

  // 边 tone / 节点 tone（与原管线同规则；基线描边走 reverse 变体）
  function edgeToneOf(from: string, to: string): EdgeTone {
    if (!highlightSet) return 'reverse'
    if (highlightSet.has(from) && highlightSet.has(to)) return 'active'
    return 'dimmed'
  }
  function nodeToneOf(id: string): NodeTone {
    if (id === selectedId) return 'active'
    if (!highlightSet) return 'normal'
    return highlightSet.has(id) ? 'active' : 'dimmed'
  }
  function reverseVisualOf(def: ReverseNodeDef): ReverseNodeVisual {
    return {
      variant: def.kind === 'mirror' ? 'reverse' : def.kind,
      status: reverseStatusOf(def.id),
      lane: def.lane,
      gateTag: def.gateTag,
    }
  }

  // 分组色带：仅镜像节点按原 phaseGroup 画（门/取证不着泳道色）
  const groupBands = useMemo(() => {
    const bands: Array<{ group: PhaseGroup; x: number; y: number; w: number; h: number }> = []
    for (const g of ['research', 'story', 'production', 'post'] as const) {
      const ns = layout.nodes.filter((n) => {
        const def = REVERSE_NODE_BY_ID.get(n.id)
        return def?.kind === 'mirror' && def.group === g
      })
      if (ns.length === 0) continue
      const minX = Math.min(...ns.map((n) => n.x))
      const minY = Math.min(...ns.map((n) => n.y))
      const maxX = Math.max(...ns.map((n) => n.x + n.width))
      const maxY = Math.max(...ns.map((n) => n.y + n.height))
      bands.push({
        group: g,
        x: minX - 16, y: minY - 16,
        w: maxX - minX + 32, h: maxY - minY + 32,
      })
    }
    return bands
  }, [layout.nodes])

  const selectedDef = selectedId ? REVERSE_NODE_BY_ID.get(selectedId) ?? null : null

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.bg.panel }}>
      <style>{`@keyframes cv-pipe-spin { to { transform: rotate(360deg) } }`}</style>

      {/* 头部 */}
      <div style={{ padding: '12px 18px 10px', borderBottom: `1px solid ${theme.border.default}`, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', color: theme.text.primary, transform: 'scaleX(-1)' }}>
            <UiIcon kind="pipeline" size={16} />
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
            逆向工程 · DAG
          </span>
          <span style={{ width: 1, height: 14, background: theme.border.default }} />
          <span style={{ color: theme.text.secondary, fontSize: 11.5, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            项目 {projectId ?? meta?.projectId ?? '—'} · 剧集 {episodesId ?? meta?.episodesId ?? '—'}
            {updatedMs != null && (
              <> · {new Date(updatedMs).toISOString().slice(0, 16).replace('T', ' ')}</>
            )}
          </span>
          {/* 规格要求：右上角常驻小字 */}
          <span style={{ marginLeft: 'auto', color: theme.text.tertiary, fontSize: 10.5, fontFamily: 'var(--cv-font-mono, monospace)', letterSpacing: '0.03em' }}>
            逆向视图 · 真源 kgr closure_ledger · 方向 右→左
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <HeaderButton onClick={() => onRefresh?.()} disabled={!onRefresh} title="重新加载画布数据">
              <UiIcon kind="iterate" size={12} />刷新
            </HeaderButton>
            <HeaderButton onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))} title="放大">+</HeaderButton>
            <HeaderButton onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))} title="缩小">−</HeaderButton>
            <HeaderButton onClick={fit} title="适应屏幕">
              <UiIcon kind="fit" size={12} />适应
            </HeaderButton>
          </div>
        </div>

        {/* 概览条（逆向状态计数） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
          <StatChip label="节点" value={stats.total} color={theme.text.primary} />
          <StatChip label="已封存" value={stats.sealed} color={REVERSE_STATUS_META.sealed.color} />
          <StatChip label="进行中" value={stats.active} color={REVERSE_STATUS_META.active.color} />
          <StatChip label="待启动" value={stats.pending} color={REVERSE_STATUS_META.pending.color} />
          {stats.blocked > 0 && <StatChip label="受阻" value={stats.blocked} color={REVERSE_STATUS_META.blocked.color} />}
          <span style={{ fontSize: 10.5, color: theme.text.tertiary, marginLeft: 'auto', fontFamily: 'var(--cv-font-mono, monospace)' }}>
            zoom {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* DAG 视口（缩放/平移容器） */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onClick={handleBackgroundClick}
        style={{
          flex: '1 1 auto',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'grab',
          background: theme.bg.canvas,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0, top: 0,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: layout.width || 1,
            height: layout.height || 1,
          }}
        >
          {/* SVG 边层 + 分组色带 + 箭头 marker（先于节点卡渲染，z 序在下） */}
          <svg
            width={layout.width || 1}
            height={layout.height || 1}
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L6,4 L0,8 Z" fill="rgba(255,255,255,0.32)" />
              </marker>
              <marker id="dag-arrow-hi" markerWidth="9" markerHeight="9" refX="6.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L7,4.5 L0,9 Z" fill="rgba(237,238,241,0.7)" />
              </marker>
            </defs>

            {/* 分组色带（仅镜像骨架） */}
            {groupBands.map((b) => {
              const c = v3theme.phaseGroup[b.group]
              return (
                <rect
                  key={b.group}
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  rx={14}
                  fill={`${c}0a`}
                  stroke={`${c}1a`}
                  strokeWidth={1}
                />
              )
            })}
            {groupBands.map((b) => {
              const c = v3theme.phaseGroup[b.group]
              return (
                <text
                  key={`lbl-${b.group}`}
                  x={b.x + 6}
                  y={b.y + 12}
                  fill={`${c}99`}
                  fontSize={9}
                  fontWeight={700}
                  fontFamily="var(--cv-font-mono, monospace)"
                  letterSpacing="0.06em"
                >
                  {PHASE_GROUP_LABELS[b.group]}
                </text>
              )
            })}

            {/* 边（REVERSE_EDGES：从右往左的裁判链） */}
            {layout.edges.map((e) => {
              const fromStatus = reverseStatusOf(e.from)
              return (
                <DagEdge
                  key={`${e.from}->${e.to}`}
                  d={edgePathD(e, layoutById)}
                  tone={edgeToneOf(e.from, e.to)}
                  upstreamDone={fromStatus === 'sealed'}
                  kind={edgeKindById.get(`${e.from}->${e.to}`)}
                />
              )
            })}
          </svg>

          {/* HTML 节点卡层（z 序在 SVG 之上） */}
          {REVERSE_NODES.map((def) => {
            const ln = layoutById.get(def.id)
            if (!ln) return null
            const st = reverseStatusOf(def.id)
            const state: DagNodeState = st === 'sealed' ? 'completed' : st === 'active' ? 'running' : st === 'blocked' ? 'failed' : 'pending'
            const model: DagNodeModel = {
              def: { id: def.id, label: def.label, phaseCode: def.phaseCode, phaseIndex: 0, group: def.group, match: {} },
              state,
              total: 1,
              completed: st === 'sealed' ? 1 : 0,
              selected: st === 'sealed' ? 1 : 0,
              candidates: 0,
              expected: 1,
              progress: st === 'sealed' ? 1 : 0,
              assets: [],
              present: true,
            }
            return (
              <DagNode
                key={def.id}
                model={model}
                x={ln.x}
                y={ln.y}
                tone={nodeToneOf(def.id)}
                reverse={reverseVisualOf(def)}
                onClick={() => handleNodeClick(def.id)}
                onHover={setHoveredId}
              />
            )
          })}
        </div>

        {/* 详情抽屉（逆向语义） */}
        <ReverseDetailPanel
          def={selectedDef}
          onClose={() => setSelectedId(null)}
        />

        <ReverseLegend />
      </div>
    </div>
  )
}

// ─── 子部件 ──────────────────────────────────────────────────

function HeaderButton({
  onClick,
  children,
  disabled,
  title,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  title?: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        minWidth: 30,
        background: theme.bg.card,
        color: disabled ? theme.text.disabled : theme.text.secondary,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 6,
        padding: '5px 9px',
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)',
        transition: 'color 120ms ease, border-color 120ms ease',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text.primary; e.currentTarget.style.borderColor = theme.border.strong } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text.secondary; e.currentTarget.style.borderColor = theme.border.default } }}
    >
      {children}
    </button>
  )
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string
  value: number | string
  color: string
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${theme.border.subtle}`,
      }}
    >
      <span style={{ fontSize: 10.5, color: theme.text.tertiary }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--cv-font-mono, monospace)' }}>{value}</span>
    </div>
  )
}

/** 视图左下角固定图例卡（逆向状态 + 泳道 + 节点三类 + 边型）。 */
function ReverseLegend(): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: 14,
        bottom: 14,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: 'rgba(17,19,23,0.92)',
        backdropFilter: 'blur(6px)',
        border: `1px solid ${theme.border.subtle}`,
        borderRadius: 8,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <span style={{ fontSize: 10, color: theme.text.tertiary, letterSpacing: '0.04em' }}>状态</span>
      {(Object.keys(REVERSE_STATUS_META) as Array<keyof typeof REVERSE_STATUS_META>).map((s) => {
        const m = REVERSE_STATUS_META[s]
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
            <span style={{ color: m.color, fontSize: 12, fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)' }}>{m.glyph}</span>
            {m.label}
          </span>
        )
      })}
      <span style={{ width: 1, height: 12, background: theme.border.subtle }} />
      <span style={{ fontSize: 10, color: theme.text.tertiary, letterSpacing: '0.04em' }}>泳道</span>
      {(Object.keys(REVERSE_LANE_META) as Array<keyof typeof REVERSE_LANE_META>).map((lane) => {
        const m = REVERSE_LANE_META[lane]
        return (
          <span key={lane} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.text.secondary }}>
            {m.colors.map((c, i) => (
              <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
            ))}
            {m.label}
          </span>
        )
      })}
      <span style={{ width: 1, height: 12, background: theme.border.subtle }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
        <span style={{ width: 10, height: 10, border: '1px solid rgba(86,184,154,0.45)', borderRadius: 3 }} />
        镜像节点
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
        <span style={{ width: 10, height: 10, border: '1px dashed rgba(86,184,154,0.45)', borderRadius: 3 }} />
        L0 取证
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
        <span style={{ width: 10, height: 10, border: '1.5px solid rgba(86,184,154,0.8)', borderRadius: 2, outline: '1px solid rgba(86,184,154,0.35)', outlineOffset: 1 }} />
        Kai 审核门
      </span>
    </div>
  )
}

// ─── 逆向详情抽屉（规格 §3.4；复用 NodeDetailPanel 的视觉语言，逆向语义字段） ──

function ReverseDetailPanel({
  def,
  onClose,
}: {
  def: ReverseNodeDef | null
  onClose: () => void
}): React.ReactElement | null {
  if (!def) return null
  const status = reverseStatusOf(def.id)
  const statusMeta = REVERSE_STATUS_META[status]
  const laneMeta = def.lane != null ? REVERSE_LANE_META[def.lane] : null
  const evidence = REVERSE_EVIDENCE_PATHS[def.id] ?? REVERSE_EVIDENCE_FALLBACK
  // 裁判链 = 右侧（入边源）；被裁决断言 = 左侧（出边目标）
  const judges = REVERSE_EDGES.filter((e) => e.to === def.id).map((e) => e.from)
  const asserts = REVERSE_EDGES.filter((e) => e.from === def.id).map((e) => e.to)
  const accent = '#56B89A'

  const kindLabel = def.kind === 'gate'
    ? 'Kai 审核门'
    : def.kind === 'forensics'
      ? 'L0 取证通道'
      : def.kind === 'source'
        ? '真值源'
        : '原管线镜像节点'

  return (
    <>
      {/* 背景遮罩（点击关闭） */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40 }}
      />
      {/* 抽屉 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          background: theme.bg.panel,
          borderLeft: `1px solid ${theme.border.default}`,
          boxShadow: 'var(--cv-shadow-pop, 0 12px 32px rgba(0,0,0,0.6))',
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${theme.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 40,
                height: 20,
                padding: '0 7px',
                borderRadius: 4,
                background: `${accent}1f`,
                color: accent,
                fontSize: 10.5,
                fontWeight: 700,
                fontFamily: 'var(--cv-font-mono, monospace)',
              }}
            >
              {def.phaseCode}
            </span>
            <span style={{ flex: '1 1 auto', color: theme.text.primary, fontSize: 14, fontWeight: 700 }}>
              {def.label}
            </span>
            <span style={{ color: accent, fontSize: 10, fontWeight: 700 }}>逆</span>
            <button
              onClick={onClose}
              title="关闭"
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.text.tertiary,
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
          {/* 逆向状态徽章 */}
          <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: statusMeta.color, fontSize: 14, fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)' }}>
              {statusMeta.glyph}
            </span>
            <span style={{ color: statusMeta.color, fontSize: 12, fontWeight: 600 }}>
              {statusMeta.label}
            </span>
            <span style={{ color: theme.text.tertiary, fontSize: 11 }}>· {kindLabel}</span>
            {laneMeta && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.text.secondary }}>
                {laneMeta.colors.map((c, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                ))}
                {laneMeta.label}
              </span>
            )}
          </div>
        </div>

        {/* 滚动体 */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 16px 20px' }}>
          {/* 对应原管线节点（规格 §3.4 第 1 条） */}
          <Section title="对应原管线节点">
            {def.kind === 'mirror' ? (
              <Muted>{`${def.phaseCode} · ${def.label}（${PHASE_GROUP_LABELS[def.group]}）`}</Muted>
            ) : (
              <Muted>无（逆向视图专属节点 · {kindLabel}）</Muted>
            )}
          </Section>

          {/* 逆向状态（规格 §3.4 第 2 条） */}
          <Section title="逆向状态">
            <Muted>
              {`${statusMeta.glyph} ${statusMeta.label}`}
              {laneMeta ? ` · 泳道 ${laneMeta.label}` : ' · 不着泳道色'}
            </Muted>
          </Section>

          {/* kgr 证据路径（规格 §3.4 第 3 条） */}
          <Section title="kgr 证据路径">
            <Muted>
              <span style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}>{evidence}</span>
            </Muted>
          </Section>

          {/* 裁判链（右侧上游） */}
          <Section title="裁判链（右侧 · 它由谁裁决）">
            {judges.length === 0 ? (
              <Muted>无（逆向链源头）</Muted>
            ) : (
              <ChipRow ids={judges} />
            )}
          </Section>

          {/* 被裁决断言（左侧下游） */}
          <Section title="被裁决断言（左侧 · 它裁决谁）">
            {asserts.length === 0 ? (
              <Muted>无（逆向链末端）</Muted>
            ) : (
              <ChipRow ids={asserts} />
            )}
          </Section>

          {/* 资产占位（规格 §3.4 第 4 条：不强求资产数据） */}
          <Section title="资产">
            <Muted>该节点尚无画布资产时显示占位说明——逆向视图资产网格暂未接入。</Muted>
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        <span style={{ color: 'rgba(86,184,154,0.7)', fontSize: 11 }}>◈</span>
        <span style={{ fontSize: 10.5, color: theme.text.tertiary, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ color: theme.text.tertiary, fontSize: 11.5, padding: '2px 0', lineHeight: 1.6 }}>{children}</div>
}

function ChipRow({ ids }: { ids: string[] }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {ids.map((id) => {
        const d = REVERSE_NODE_BY_ID.get(id)
        return (
          <span
            key={id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 5,
              background: 'rgba(86,184,154,0.08)',
              border: '1px solid rgba(86,184,154,0.2)',
              color: theme.text.secondary,
              fontSize: 11,
            }}
          >
            <span style={{ color: 'rgba(86,184,154,0.85)', fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10 }}>
              {d?.phaseCode ?? '—'}
            </span>
            {d?.label ?? id}
          </span>
        )
      })}
    </div>
  )
}
