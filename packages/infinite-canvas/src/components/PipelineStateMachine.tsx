/**
 * src/components/PipelineStateMachine.tsx — 管线状态机视图 v2（细粒度 DAG，BlueOcean 风格）。
 *
 * 第四个 viewMode='pipeline'。v1 的 17 个 phase 大卡片重构为**资产子流程步骤 DAG**：
 * 每个节点 = 一类生产步骤（灰底Turnaround / 首尾帧 / 视频片段 …），节点间是真实依赖边
 *（分支/汇合），dagre 分层布局（LR），SVG 渲染贝塞尔边 + HTML 节点卡。
 *
 * 数据完全派生：store.nodes（RF 节点，data.v3 = AssetNodeV3）+ store.rawDataByNodeId
 *（assetType/turnaroundType 等白名单外字段）→ deriveDagModels。无新后端 API。
 *
 * 交互：滚轮缩放（向光标）、拖拽平移、fit-to-screen；hover 节点高亮上下游路径；
 * 点击节点 → 右侧 NodeDetailPanel（资产缩略图网格 + 依赖来源/输出去向 + 三态）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { UiIcon } from './canvas/icons'
import {
  deriveDagModels,
  dagAncestorsOf,
  dagDescendantsOf,
  DAG_NODES,
  DAG_EDGES,
  DAG_STATE_META,
  PHASE_GROUP_ORDER,
  PHASE_GROUP_LABELS,
  type DagNodeModel,
  type DagNodeState,
  type PhaseGroup,
} from './pipeline/model'
import { layoutDag, edgePathD, type LayoutNode } from './pipeline/dagLayout'
import DagNode, { type NodeTone } from './pipeline/DagNode'
import DagEdge, { type EdgeTone } from './pipeline/DagEdge'
import NodeDetailPanel from './pipeline/NodeDetailPanel'

interface PipelineStateMachineProps {
  onRefresh?: () => void
  onLocateNode?: (nodeId: string) => void
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.6
/** 点击 vs 拖拽判定阈值（px）。超过则视为拖拽，抑制 click。 */
const DRAG_THRESHOLD = 4

export default function PipelineStateMachine({
  onRefresh,
  onLocateNode,
}: PipelineStateMachineProps): React.ReactElement {
  const nodes = useCanvasStore((s) => s.nodes)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const graph = useCanvasStore((s) => s.graph)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const setViewMode = useCanvasStore((s) => s.setViewMode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)

  // ── 派生 DAG 模型 + dagre 布局（memo：nodes/rawData 变才重算） ──
  const models = useMemo(
    () => deriveDagModels(nodes, rawDataByNodeId),
    [nodes, rawDataByNodeId],
  )
  const modelById = useMemo(() => new Map(models.map((m) => [m.def.id, m])), [models])

  const layout = useMemo(
    () => layoutDag(
      DAG_NODES.map((d) => d.id),
      DAG_EDGES,
    ),
    [],
  )
  const layoutById = useMemo(() => {
    const m = new Map<string, LayoutNode>()
    for (const n of layout.nodes) m.set(n.id, n)
    return m
  }, [layout])

  // ── 视口变换 ──
  const viewportRef = useRef<HTMLDivElement>(null)
  const [tx, setTx] = useState(40)
  const [ty, setTy] = useState(40)
  const [zoom, setZoom] = useState(0.85)
  const dragRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; startTx: number; startTy: number }>({
    active: false, moved: false, startX: 0, startY: 0, startTx: 0, startTy: 0,
  })

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // hover 高亮集（祖先 + 后代）
  const highlightSet = useMemo(() => {
    if (!hoveredId) return null
    const a = dagAncestorsOf(hoveredId)
    const d = dagDescendantsOf(hoveredId)
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

  // ── 节点交互 ──
  const handleNodeClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  function handleLocate(nodeId: string) {
    if (onLocateNode) {
      onLocateNode(nodeId)
      return
    }
    const target = nodes.find((n) => n.id === nodeId) ?? null
    setViewMode('canvas')
    setSelectedNode(target)
    setDetailNode(target)
  }

  // ── 统计 ──
  const stats = useMemo(() => {
    let reached = 0, completed = 0, running = 0, failed = 0, decisions = 0
    for (const m of models) {
      if (m.present) reached++
      if (m.state === 'completed') completed++
      if (m.state === 'running' || m.state === 'has-candidates') running++
      if (m.state === 'failed') failed++
      // 待决策资产：只计真实待决策节点（金色）的未定资产，与徽章口径一致
      if (m.state === 'has-candidates') decisions += m.candidates
    }
    return { reached, completed, running, failed, decisions, total: models.length }
  }, [models])

  const selectedModel = selectedId ? modelById.get(selectedId) ?? null : null

  const meta = graph?.meta
  const updatedMs = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : null

  // 边 tone：两端都在高亮集 → active；高亮集存在但不在 → dimmed；否则 default
  function edgeToneOf(from: string, to: string): EdgeTone {
    if (!highlightSet) return 'default'
    if (highlightSet.has(from) && highlightSet.has(to)) return 'active'
    return 'dimmed'
  }
  function nodeToneOf(id: string): NodeTone {
    if (id === selectedId) return 'active'
    if (!highlightSet) return 'normal'
    return highlightSet.has(id) ? 'active' : 'dimmed'
  }

  // 分组色带：按各 group 在布局中的 bbox 画极淡背景块
  const groupBands = useMemo(() => {
    const bands: Array<{ group: PhaseGroup; x: number; y: number; w: number; h: number }> = []
    for (const g of PHASE_GROUP_ORDER) {
      const ns = layout.nodes.filter((n) => {
        const def = DAG_NODES.find((d) => d.id === n.id)
        return def?.group === g
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

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.bg.panel }}>
      <style>{`@keyframes cv-pipe-spin { to { transform: rotate(360deg) } }`}</style>

      {/* 头部 */}
      <div style={{ padding: '12px 18px 10px', borderBottom: `1px solid ${theme.border.default}`, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', color: theme.text.primary }}>
            <UiIcon kind="pipeline" size={16} />
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
            管线状态机 · DAG
          </span>
          <span style={{ width: 1, height: 14, background: theme.border.default }} />
          <span style={{ color: theme.text.secondary, fontSize: 11.5, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            项目 {projectId ?? meta?.projectId ?? '—'} · 剧集 {episodesId ?? meta?.episodesId ?? '—'}
            {updatedMs != null && (
              <> · {new Date(updatedMs).toISOString().slice(0, 16).replace('T', ' ')}</>
            )}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
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

        {/* 概览条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
          <StatChip label="步骤" value={`${stats.reached}/${stats.total}`} color={theme.text.primary} />
          <StatChip label="完成" value={stats.completed} color={v3theme.signal.approved} />
          <StatChip label="进行中" value={stats.running} color={v3theme.signal.running} />
          {stats.failed > 0 && <StatChip label="失败" value={stats.failed} color={v3theme.signal.rejected} />}
          {stats.decisions > 0 && (
            <StatChip label="待决策资产" value={stats.decisions} color={v3theme.signal.running} warn />
          )}
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
        {nodes.length === 0 ? (
          <EmptyState />
        ) : (
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

              {/* 分组色带 */}
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
              {/* 分组色带标签 */}
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

              {/* 边 */}
              {layout.edges.map((e) => {
                const sm = modelById.get(e.from)
                return (
                  <DagEdge
                    key={`${e.from}->${e.to}`}
                    d={edgePathD(e, layoutById)}
                    tone={edgeToneOf(e.from, e.to)}
                    upstreamDone={(sm?.completed ?? 0) > 0}
                  />
                )
              })}
            </svg>

            {/* HTML 节点卡层（z 序在 SVG 之上） */}
            {models.map((m) => {
              const ln = layoutById.get(m.def.id)
              if (!ln) return null
              return (
                <DagNode
                  key={m.def.id}
                  model={m}
                  x={ln.x}
                  y={ln.y}
                  tone={nodeToneOf(m.def.id)}
                  onClick={() => handleNodeClick(m.def.id)}
                  onHover={setHoveredId}
                />
              )
            })}
          </div>
        )}

        {/* 详情抽屉 */}
        <NodeDetailPanel
          model={selectedModel}
          onClose={() => setSelectedId(null)}
          onLocate={handleLocate}
        />

        {nodes.length > 0 && <Legend />}
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
  warn,
}: {
  label: string
  value: number | string
  color: string
  warn?: boolean
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        background: warn ? 'rgba(224,182,101,0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${warn ? 'rgba(224,182,101,0.22)' : theme.border.subtle}`,
      }}
    >
      <span style={{ fontSize: 10.5, color: theme.text.tertiary }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--cv-font-mono, monospace)' }}>{value}</span>
    </div>
  )
}

const DAG_LEGEND_ITEMS: ReadonlyArray<{ state: DagNodeState; desc: string }> = [
  { state: 'completed', desc: '完成' },
  { state: 'has-candidates', desc: '待决策' },
  { state: 'running', desc: '运行中' },
  { state: 'failed', desc: '失败' },
  { state: 'pending', desc: '待执行' },
]

function Legend(): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: 14,
        bottom: 14,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
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
      {DAG_LEGEND_ITEMS.map((it) => {
        const m = DAG_STATE_META[it.state]
        return (
          <span key={it.state} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
            <span style={{ color: m.color, fontSize: 12, fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)' }}>{m.glyph}</span>
            {it.desc}
          </span>
        )
      })}
      <span style={{ width: 1, height: 12, background: theme.border.subtle }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
        <svg width="22" height="8"><path d="M1 4 H16" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" /><path d="M14 1 L19 4 L14 7" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" fill="none" /></svg>
        已完成依赖
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: theme.text.secondary }}>
        <svg width="22" height="8"><path d="M1 4 H16" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" strokeDasharray="3 3" /></svg>
        未完成依赖
      </span>
    </div>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: '36px 48px',
          textAlign: 'center',
          background: theme.bg.card,
          border: `1px solid ${theme.border.default}`,
          borderRadius: 12,
          boxShadow: 'var(--cv-shadow-pop, 0 12px 32px rgba(0,0,0,0.6))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', color: theme.text.tertiary, marginBottom: 14 }}>
          <UiIcon kind="pipeline" size={40} />
        </div>
        <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          暂无管线数据
        </div>
        <div style={{ color: theme.text.secondary, fontSize: 13, lineHeight: 1.6 }}>
          请先选择项目与剧集加载画布数据，<br />
          或运行创作管线后自动同步资产与阶段状态。
        </div>
      </div>
    </div>
  )
}
