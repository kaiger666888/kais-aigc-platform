/**
 * src/components/panel/NodeDetailPanel.tsx — D 层节点详情面板（SPEC D.1 / 宪法 P20 重写）。
 *
 * 读 RF 节点 data.v3（AssetNodeV3 权威载荷）全量渲染 V3 字段：media 三件套查看器、
 * meta 按 stage 判别联合（MetaRenderer）、reviewStatus + ReviewCard、aiScore(overall+dimensions)、
 * curation、stale 溯源行；composite 内嵌 TimelineStructure。迁移既有 FileViewer / FeedbackPanel /
 * IterationPanel(compact) 的审核·反馈·迭代能力。
 *
 * 契约（phase35 e2e 不退化）：根 data-testid="detail-panel"、✕ 关闭、detail/feedback/iteration 三 tab、
 * storyboard「镜头意图」4 select（MetaRenderer 内）。Props={node,onClose} 签名不变。
 */
import { useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import type { AssetNodeV3, AIScore, StaleInfo, NodeState } from '@kais/flowgraph-v3'
import { theme, v3theme, getScoreColor } from '../../theme/catppuccin'
import { useCanvasStore } from '../../store/canvasStore'
import { triggerStaleCascade } from '../../hooks/useStale'
import FileViewer from '../FileViewer'
import ReviewCard from '../ReviewCard'
import FeedbackPanel from '../FeedbackPanel'
import IterationPanel from '../IterationPanel'
import MetaRenderer from './MetaRenderer'
import TimelineStructure from '../timeline/TimelineStructure'

interface Props {
  node: Node | null
  onClose: () => void
}

export default function NodeDetailPanel({ node, onClose }: Props): React.ReactElement | null {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth * 0.75 : 960
    return Math.max(400, w)
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [tab, setTab] = useState<'detail' | 'feedback' | 'iteration'>('detail')

  // P13：审核通过（pending→approved）触发下游 stale 重算（C 接线，D 消费 triggerStaleCascade）。
  const graph = useCanvasStore((s) => s.graph)
  const reviewStatus = node ? readReviewStatus(graph, node.id) : undefined
  const prevStatusRef = useRef<ReviewStatusLike | undefined>(undefined)
  const trackedIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = node?.id ?? null
    if (trackedIdRef.current !== id) {
      trackedIdRef.current = id
      prevStatusRef.current = reviewStatus
      return
    }
    if (prevStatusRef.current === 'pending' && reviewStatus === 'approved' && id) {
      triggerStaleCascade([id])
    }
    prevStatusRef.current = reviewStatus
  }, [reviewStatus, node?.id, graph])

  useEffect(() => { setTab('detail') }, [node?.id])

  // 拖拽改宽
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      setPanelWidth(Math.max(400, dragRef.current.startW + (dragRef.current.startX - e.clientX)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  if (!node) return null

  const data = node.data as Record<string, unknown>
  const asset = data.v3 as AssetNodeV3 | undefined
  const isAsset = asset?.kind === 'asset'
  const title = (data.label as string) ?? asset?.phaseName ?? node.id
  const stage = isAsset ? asset!.stage : (node.type ?? 'node')

  return (
    <>
      {/* 拖拽柄 */}
      <div
        onMouseDown={(e) => { dragRef.current = { startX: e.clientX, startW: panelWidth }; setDragging(true) }}
        style={{ position: 'absolute', top: 0, right: panelWidth, width: 6, height: '100%', cursor: 'col-resize', background: dragging ? theme.border.subtle : 'transparent', zIndex: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ width: 3, height: 40, borderRadius: 2, background: dragging ? theme.node.script : theme.border.dim, opacity: dragging ? 1 : 0.5 }} />
      </div>

      <div data-testid="detail-panel" style={{
        position: 'absolute', top: 0, right: 0, width: panelWidth, height: '100%',
        background: theme.bg.panel, borderLeft: `1px solid ${theme.border.default}`, zIndex: 10,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight 0.25s ease-out',
      }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{stageIcon(stage)}</span>
            <span style={{ color: theme.text.primary, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: panelWidth - 160 }}>{title}</span>
            {isAsset && <StateBadge state={asset!.state} />}
          </div>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* Tab */}
        <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.panel, flexShrink: 0 }}>
          <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>📋 详情</TabButton>
          <TabButton active={tab === 'feedback'} onClick={() => setTab('feedback')}>💬 反馈</TabButton>
          <TabButton active={tab === 'iteration'} onClick={() => setTab('iteration')}>🔄 迭代</TabButton>
        </div>

        {/* 内容 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {tab === 'feedback' ? (
            <FeedbackPanel nodeId={node.id} />
          ) : tab === 'iteration' ? (
            <IterationPanel filterNodeId={node.id} compact />
          ) : isAsset ? (
            <AssetDetail asset={asset!} node={node} onImageClick={setLightboxSrc} />
          ) : (
            <LegacyDetail node={node} data={data} />
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setLightboxSrc(null) }} style={{ position: 'absolute', inset: 0, background: theme.chrome.lightboxOverlay, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <img src={lightboxSrc} alt="预览" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: 8, boxShadow: `0 0 40px ${theme.chrome.shadow}` }} />
        </div>
      )}

      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  )
}

// ─── V3 资产详情 ────────────────────────────────────────────

function AssetDetail({ asset, node, onImageClick }: { asset: AssetNodeV3; node: Node; onImageClick: (src: string) => void }) {
  const graph = useCanvasStore((s) => s.graph)
  return (
    <>
      <MediaViewer asset={asset} onImageClick={onImageClick} />
      <CurationBadge curation={asset.curation} />
      <MetaRenderer asset={asset} node={node} />
      <ReviewSection asset={asset} node={node} />
      <ScoreSection aiScore={asset.aiScore} />
      <StaleSection stale={asset.stale} graph={graph} />
      <FileViewer filePath={asset.media.original ?? undefined} />
      {asset.stage === 'composite' && asset.timeline && <TimelineStructure asset={asset} />}
    </>
  )
}

function MediaViewer({ asset, onImageClick }: { asset: AssetNodeV3; onImageClick: (src: string) => void }) {
  const m = asset.media
  if (asset.modality === 'text') {
    const text = asset.content ?? ''
    if (!text) return null
    return (
      <>
        <SectionLabel>正文</SectionLabel>
        <div style={{ background: theme.bg.input, borderRadius: 8, padding: 12, color: theme.text.primary, fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '40vh', overflowY: 'auto' }}>{text}</div>
      </>
    )
  }
  if (asset.modality === 'video') {
    const src = m.proxy ?? m.original
    if (!src) return null
    return (
      <>
        <SectionLabel>视频</SectionLabel>
        <video controls poster={m.thumbnail ?? undefined} style={{ width: '100%', borderRadius: 8, background: theme.bg.image, border: `1px solid ${theme.border.default}` }}>
          <source src={src} type="video/mp4" />浏览器不支持视频播放
        </video>
      </>
    )
  }
  if (asset.modality === 'audio') {
    const src = m.original
    return (
      <>
        <SectionLabel>音频</SectionLabel>
        {m.waveform && <img src={m.waveform} alt="waveform" style={{ width: '100%', borderRadius: 6, background: theme.bg.image }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        {src && <audio controls style={{ width: '100%', marginTop: 6 }}><source src={src} />浏览器不支持音频播放</audio>}
        {!src && !m.waveform && <div style={{ color: theme.text.secondary, fontSize: 12 }}>无音频文件</div>}
      </>
    )
  }
  // image
  const img = m.thumbnail ?? m.original
  if (!img) return null
  return (
    <>
      <SectionLabel>预览图</SectionLabel>
      <div onClick={() => onImageClick(img)} style={{ borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${theme.border.default}`, marginBottom: 12 }}>
        <img src={img} alt={asset.phaseName} style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain', background: theme.bg.image }} />
      </div>
    </>
  )
}

function CurationBadge({ curation }: { curation: AssetNodeV3['curation'] }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    candidate: { label: '候选', bg: theme.bg.surface, color: theme.text.secondary },
    selected: { label: '策展选定', bg: v3theme.signal.select, color: '#100E0A' },
    deprecated: { label: '落选', bg: v3theme.edge.inactive, color: theme.text.secondary },
    locked: { label: '锁定参考', bg: v3theme.signal.locked, color: '#100E0A' },
  }
  const c = cfg[curation]
  if (!c) return null
  return (
    <div style={{ marginTop: 4, marginBottom: 4 }}>
      <span style={{ padding: '3px 10px', borderRadius: 6, background: c.bg, color: c.color, fontSize: 11, fontWeight: 600 }}>{c.label}</span>
    </div>
  )
}

function ReviewSection({ asset, node }: { asset: AssetNodeV3; node: Node }) {
  const rs = asset.reviewStatus
  const cfg: Record<string, { label: string; bg: string }> = {
    pending: { label: '待审核', bg: theme.status.awaiting },
    approved: { label: '已通过', bg: theme.status.approved },
    rejected: { label: '已驳回', bg: theme.status.rejected },
  }
  return (
    <>
      {rs && (
        <>
          <SectionLabel>审核</SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, background: cfg[rs].bg, color: theme.text.onAccent, fontWeight: 600 }}>{cfg[rs].label}</span>
          </div>
        </>
      )}
      {rs === 'pending' && (
        <div style={{ marginBottom: 16 }}>
          <ReviewCard filePath={asset.media.original ?? undefined} nodeId={node.id} />
        </div>
      )}
    </>
  )
}

function ScoreSection({ aiScore }: { aiScore: AIScore | undefined }) {
  if (!aiScore || typeof aiScore.overall !== 'number') return null
  const overall = aiScore.overall
  const dims = aiScore.dimensions
  return (
    <>
      <SectionLabel>AI 评分</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: dims ? 8 : 0 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: getScoreColor(overall) }}>{Math.round(overall * 100)}</span>
        <span style={{ fontSize: 12, color: theme.text.secondary }}>/ 100</span>
      </div>
      {dims && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(dims).map(([k, v]) => (
            <DimBar key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </>
  )
}

function DimBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ color: theme.text.secondary, minWidth: 64 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: theme.bg.surface, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: getScoreColor(value) }} />
      </div>
      <span style={{ color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)', minWidth: 28, textAlign: 'right' }}>{pct}</span>
    </div>
  )
}

function StaleSection({ stale, graph }: { stale: StaleInfo | null; graph: ReturnType<typeof useCanvasStore.getState>['graph'] }) {
  if (!stale) return null
  const triggerLabel = graph?.nodes.find((n) => n.id === stale.triggerAssetId)?.phaseName ?? stale.triggerAssetId.slice(-8)
  const since = new Date(stale.since).toLocaleString()
  return (
    <>
      <SectionLabel>过期状态</SectionLabel>
      <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(240,165,46,0.10)', border: `1px solid ${v3theme.signal.stale}`, color: v3theme.signal.stale, fontSize: 12, lineHeight: 1.6 }}>
        ⚠ 已过期（上游变更触发）<br />
        <span style={{ color: theme.text.secondary, fontSize: 11 }}>触发：{triggerLabel} · 自 {since}</span>
      </div>
    </>
  )
}

// ─── 旧路径 / 结构 / 事件 节点兜底 ──────────────────────────

function LegacyDetail({ node, data }: { node: Node; data: Record<string, unknown> }) {
  return (
    <>
      <SectionLabel>节点 ID</SectionLabel>
      <div style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 12, color: theme.text.secondary, wordBreak: 'break-all' }}>{node.id}</div>
      <FileViewer filePath={(data.filePath as string) ?? undefined} />
    </>
  )
}

// ─── 通用子组件 ─────────────────────────────────────────────

type ReviewStatusLike = 'pending' | 'approved' | 'rejected' | undefined
function readReviewStatus(graph: ReturnType<typeof useCanvasStore.getState>['graph'], nodeId: string): ReviewStatusLike {
  const n = graph?.nodes.find((x) => x.id === nodeId)
  return n && n.kind === 'asset' ? n.reviewStatus : undefined
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: theme.text.secondary, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, marginTop: 16 }}>{children}</div>
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '4px 10px', borderRadius: 6, background: active ? theme.bg.surface : 'transparent', color: active ? theme.text.primary : theme.text.secondary, border: 'none', fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer' }}>{children}</button>
}

function StateBadge({ state }: { state: NodeState }) {
  const cfg: Record<string, { label: string; color: string }> = {
    pending: { label: '等待中', color: v3theme.signal.pending },
    running: { label: '生成中', color: v3theme.signal.running },
    success: { label: '完成', color: v3theme.signal.approved },
    failed: { label: '失败', color: v3theme.signal.rejected },
  }
  const c = cfg[state] ?? cfg.pending
  return <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: c.color, color: theme.text.onAccent, fontWeight: 600 }}>{c.label}</span>
}

function stageIcon(stage: string): string {
  const map: Record<string, string> = {
    script: '📄', storyboard: '🎬', keyframe: '🖼', video: '🎥', composite: '🎞',
    voice: '🗣', foley: '🔊', bgm: '🎵', mix: '🎚', global: '🌍', eventChip: '⚡',
  }
  return map[stage] ?? '📦'
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 18, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1,
}
