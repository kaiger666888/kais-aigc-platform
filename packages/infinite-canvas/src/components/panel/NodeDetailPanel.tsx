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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import type { AssetNodeV3, EventNodeV3, AIScore, StaleInfo, NodeState } from '@kais/flowgraph-v3'
import { theme, v3theme, getScoreColor } from '../../theme/catppuccin'
import { RAW_FIELD_LABELS, RAW_FIELD_NOISE, RAW_FIELD_GROUPS } from '../../constants'
import { useCanvasStore } from '../../store/canvasStore'
import { executeNode } from '../../services/canvasApi'
import { triggerStaleCascade } from '../../hooks/useStale'
import FileViewer from '../FileViewer'
import ScoreRadar from './ScoreRadar'
import ReviewCard from '../ReviewCard'
import FeedbackPanel from '../FeedbackPanel'
import IterationPanel from '../IterationPanel'
import MetaRenderer from './MetaRenderer'
import TimelineStructure from '../timeline/TimelineStructure'
import { resolveMediaUrl, resolveRelativeAssetPath, ossDirOf } from '../../utils/mediaUrl'

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
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const raw = rawDataByNodeId?.get(node.id) ?? undefined
  return (
    <>
      <MediaViewer asset={asset} raw={raw} onImageClick={onImageClick} />
      <CurationBadge curation={asset.curation} />
      <MetaRenderer asset={asset} node={node} />
      <ShotIntentSection raw={raw} />
      <PromptSection asset={asset} />
      <RawDataSection nodeId={node.id} />
      <ReviewSection asset={asset} node={node} />
      <ScoreSection aiScore={asset.aiScore} />
      <StaleSection stale={asset.stale} graph={graph} />
      <FileViewer filePath={asset.media.original ?? undefined} />
      {asset.stage === 'composite' && asset.timeline && <TimelineStructure asset={asset} />}
    </>
  )
}

/**
 * 原始字段区：渲染 migrate 白名单之外、经 adapter sidecar 穿透的富字段（后端 data 袋）。
 * 过滤噪音键（已映射到 media/params/标题）、按 RAW_FIELD_GROUPS 分组、键值行呈现；
 * 长文本（台词/提示词/描述）走可折叠块。rawDataByNodeId 缺省（fixture 直通）→ 不渲染。
 */
const RAW_LONG_KEYS = new Set(['text', 'dialogue', 'ltx_prompt', 'ltxPrompt', 'description', 'negative', 'negative_prompt', 'premise'])

function RawDataSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const raw = rawDataByNodeId?.get(nodeId)
  if (!raw) return null

  const entries = Object.entries(raw).filter(([, v]) => v != null && v !== '' &&
    !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === 'object' && !Array.isArray(v)))
    .filter(([k]) => !RAW_FIELD_NOISE.has(k))
  if (entries.length === 0) return null

  const groups: Array<[string, Array<[string, unknown]>]> = []
  for (const g of RAW_FIELD_GROUPS) {
    const items = entries.filter(([k]) => g.keys.has(k))
    if (items.length > 0) groups.push([g.title, items])
  }
  const others = entries.filter(([k]) => !RAW_FIELD_GROUPS.some((g) => g.keys.has(k)))
  if (others.length > 0) groups.push(['其他', others])

  return (
    <>
      {groups.map(([title, items]) => (
        <Fragment key={title}>
          <SectionLabel>{title}</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map(([k, v]) => {
              const label = RAW_FIELD_LABELS[k] ?? k
              const isLong = RAW_LONG_KEYS.has(k) || (typeof v === 'string' && v.length > 80)
              return isLong ? <LongField key={k} label={label} value={v} /> : <KvRow key={k} label={label} value={v} />
            })}
          </div>
        </Fragment>
      ))}
    </>
  )
}

/** 单值键值行（值做轻量格式化：布尔/数组/数字）。 */
function KvRow({ label, value }: { label: string; value: unknown }) {
  const text = Array.isArray(value) ? value.join(', ')
    : typeof value === 'boolean' ? (value ? '是' : '否')
    : String(value)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
      <span style={{ color: theme.text.secondary, flexShrink: 0 }}>{label}</span>
      <span style={{ color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)', textAlign: 'right', wordBreak: 'break-word' }}>{text}</span>
    </div>
  )
}

/** 长文本字段：可折叠多行块。 */
function LongField({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false)
  const text = String(value)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 'none', color: theme.text.secondary, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 2 }}
      >
        {label} {open ? '▾' : `▸ (${text.length}字)`}
      </button>
      {open && (
        <div style={{ background: theme.bg.input, borderRadius: 6, padding: 8, color: theme.text.primary, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </div>
      )}
    </div>
  )
}

function MediaViewer({ asset, raw, onImageClick }: { asset: AssetNodeV3; raw: Record<string, unknown> | undefined; onImageClick: (src: string) => void }) {
  const m = asset.media
  if (asset.modality === 'text') {
    // 正文：content 优先，缺省取 description / premise（富字段穿透）；空则不渲染。
    const text = asset.content
      ?? (typeof raw?.description === 'string' ? raw.description : undefined)
      ?? (typeof raw?.premise === 'string' ? raw.premise : undefined)
      ?? ''
    if (!text) return null
    return (
      <>
        <SectionLabel>正文</SectionLabel>
        <div style={{ background: theme.bg.input, borderRadius: 8, padding: 12, color: theme.text.primary, fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '48vh', overflowY: 'auto', border: `1px solid ${theme.border.default}` }}>{text}</div>
      </>
    )
  }
  if (asset.modality === 'video') {
    const src = resolveMediaUrl(m.proxy ?? m.original)
    const poster = resolveMediaUrl(m.thumbnail) ?? undefined
    if (!src && !poster) {
      return (
        <>
          <SectionLabel>视频</SectionLabel>
          <MissingPlaceholder path={m.proxy ?? m.original} />
        </>
      )
    }
    return (
      <>
        <SectionLabel>视频</SectionLabel>
        {src ? (
          <video controls poster={poster} style={{ width: '100%', borderRadius: 8, background: theme.bg.image, border: `1px solid ${theme.border.default}` }}>
            <source src={src} type="video/mp4" />浏览器不支持视频播放
          </video>
        ) : poster ? (
          <div onClick={() => onImageClick(poster)} style={{ borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${theme.border.default}` }}>
            <img src={poster} alt={asset.phaseName} style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain', background: theme.bg.image }} />
          </div>
        ) : null}
      </>
    )
  }
  if (asset.modality === 'audio') {
    const src = resolveMediaUrl(m.original)
    const waveform = resolveMediaUrl(m.waveform)
    return (
      <>
        <SectionLabel>音频</SectionLabel>
        {waveform && <img src={waveform} alt="waveform" style={{ width: '100%', borderRadius: 6, background: theme.bg.image }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        {src && <audio controls style={{ width: '100%', marginTop: 6 }}><source src={src} />浏览器不支持音频播放</audio>}
        {!src && !waveform && <div style={{ color: theme.text.secondary, fontSize: 12 }}>无音频文件</div>}
      </>
    )
  }
  // image：原图大图 + 相关图集（thumbnail / turnaround_sheet / crops），URL 经 mediaUrl 解析。
  return <ImageGallery asset={asset} raw={raw} onImageClick={onImageClick} />
}

/**
 * 图片资产图集：原图（大图，可点开 lightbox）+ 转面表 / 各视角裁切。
 *
 * 加载失败有友好兜底（对齐 AssetCardNode.Cover 的三层兜底，解决「双击弹窗看不到原图」）：
 *  - 主图：原图 404 → 退缩略图 → 退「文件缺失」占位（显示路径，定位死链），
 *    不再显示裸 broken-image 图标；
 *  - 相关图：单张 404 → 保留格子标注「缺失」，不再 parentElement.display='none' 静默消失。
 *  缩略图不再单列于相关图——它现在是主图 original 失败时的兜底源，避免重复。
 */
function ImageGallery({ asset, raw, onImageClick }: { asset: AssetNodeV3; raw: Record<string, unknown> | undefined; onImageClick: (src: string) => void }) {
  const m = asset.media
  const ossDir = ossDirOf(m.original ?? m.thumbnail)
  const original = resolveMediaUrl(m.original)
  const thumb = resolveMediaUrl(m.thumbnail)
  // 相关图：turnaround_sheet → crops.{front,three_quarter,side,back,...}（缩略图改作主图兜底，不单列）
  const related: Array<{ label: string; src: string }> = []
  if (typeof raw?.turnaround_sheet === 'string') {
    const u = resolveRelativeAssetPath(raw.turnaround_sheet, ossDir)
    if (u) related.push({ label: '转面表', src: u })
  }
  if (raw?.crops && typeof raw.crops === 'object') {
    for (const [k, v] of Object.entries(raw.crops as Record<string, unknown>)) {
      if (typeof v !== 'string') continue
      const u = resolveRelativeAssetPath(v, ossDir)
      if (u) related.push({ label: k, src: u })
    }
  }
  if (!original && !thumb && related.length === 0) return null
  return (
    <>
      <SectionLabel>{original ? '原图' : '预览图'}</SectionLabel>
      <MainImage
        original={original}
        fallback={thumb}
        alt={asset.phaseName}
        missingPath={m.original ?? m.thumbnail ?? undefined}
        onImageClick={onImageClick}
      />
      {related.length > 0 && (
        <>
          <SectionLabel>相关图片</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            {related.map((r) => (
              <GalleryImage key={r.label + r.src} label={r.label} src={r.src} onImageClick={onImageClick} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** 主图三层兜底：原图 → 缩略图 → 文件缺失占位（对齐 AssetCardNode.Cover）。 */
function MainImage({ original, fallback, alt, missingPath, onImageClick }: {
  original: string | null
  fallback: string | null
  alt: string
  missingPath: string | undefined
  onImageClick: (src: string) => void
}) {
  const [stage, setStage] = useState<'original' | 'fallback' | 'failed'>(
    original ? 'original' : fallback ? 'fallback' : 'failed',
  )
  // 切换节点（original/fallback 引用变）时重试，避免上个节点的失败态串到新节点。
  useEffect(() => {
    setStage(original ? 'original' : fallback ? 'fallback' : 'failed')
  }, [original, fallback])
  if (stage === 'failed') {
    return <MissingPlaceholder path={missingPath} />
  }
  const src = stage === 'original' ? original : fallback
  return (
    <div onClick={() => src && onImageClick(src)} style={{ borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${theme.border.default}`, marginBottom: 12 }}>
      <img
        src={src ?? undefined}
        alt={alt}
        style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain', background: theme.bg.image }}
        onError={() => setStage((s) => (s === 'original' && fallback ? 'fallback' : 'failed'))}
      />
    </div>
  )
}

/** 相关图：单张 404 → 保留格子标注「缺失」（不静默消失，让用户知道有这图但加载失败）。 */
function GalleryImage({ label, src, onImageClick }: { label: string; src: string; onImageClick: (src: string) => void }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (failed) {
    return (
      <div style={{ borderRadius: 6, overflow: 'hidden', border: `1px solid ${theme.border.default}`, position: 'relative', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.bg.image }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, opacity: 0.4 }}>🖼</div>
          <div style={{ fontSize: 9, color: theme.text.disabled, marginTop: 2 }}>缺失</div>
        </div>
        <span style={{ position: 'absolute', left: 0, bottom: 0, right: 0, padding: '2px 6px', fontSize: 10, color: theme.text.primary, background: 'rgba(0,0,0,0.55)' }}>{label}</span>
      </div>
    )
  }
  return (
    <div onClick={() => onImageClick(src)} style={{ borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${theme.border.default}`, position: 'relative', aspectRatio: '1' }}>
      <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', background: theme.bg.image }} />
      <span style={{ position: 'absolute', left: 0, bottom: 0, right: 0, padding: '2px 6px', fontSize: 10, color: theme.text.primary, background: 'rgba(0,0,0,0.55)' }}>{label}</span>
    </div>
  )
}

/**
 * 文件缺失占位：弱色虚线框 + 🖼 + 路径 + 排查提示。
 * 用于原图/视频文件不可达（如 scifi-epic 这类源目录已删除的死链项目）——
 * 把不可见的 404 变成可定位的诊断信息，而非裸 broken-image 图标。
 */
function MissingPlaceholder({ path }: { path: string | null | undefined }) {
  return (
    <div style={{
      borderRadius: 8, marginBottom: 12, padding: 20,
      background: theme.bg.image, border: `1px dashed ${theme.border.subtle}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
      color: theme.text.disabled, textAlign: 'center',
    }}>
      <div style={{ fontSize: 26, opacity: 0.5 }}>🖼</div>
      <div style={{ fontSize: 12, color: theme.text.secondary }}>文件缺失，无法预览</div>
      {path && (
        <div style={{ fontSize: 10, fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.disabled, wordBreak: 'break-all', maxWidth: '100%', lineHeight: 1.4 }}>
          {path}
        </div>
      )}
      <div style={{ fontSize: 10, color: theme.text.disabled, maxWidth: 320, lineHeight: 1.4 }}>
        源文件可能已迁移或删除。检查 data/oss/ 下该项目的符号链接是否存在、指向是否有效。
      </div>
    </div>
  )
}

/**
 * 创作意图（shot_intent）：视频资产的完整创作意图（felt/visible/camera/lighting/audio/continuity）。
 * 后端给的是大型 JSON 对象，RawDataSection 跳过对象值 → 此处专门结构化渲染。
 * 标题用「创作意图」而非「镜头意图」：MetaRenderer 内嵌的下拉编辑器已占用「镜头意图」标题
 * （phase35 e2e 契约，4 select），此处避免出现两个「镜头意图」。
 */
function ShotIntentSection({ raw }: { raw: Record<string, unknown> | undefined }) {
  const si = raw?.shot_intent
  if (!si || typeof si !== 'object') return null
  const s = si as {
    felt_intent?: string
    visible_behavior?: string
    camera_intent?: { shot_size?: string; movement?: string; axis?: string; endpoint?: string }
    lighting_intent?: { key_source?: string; ratio?: string; temperature?: string }
    audio_intent?: string
    continuity?: { already_happened?: unknown[]; this_clip_only?: unknown[]; reserved_for_later?: unknown[]; locks?: unknown[] }
  }
  const arr = (x: unknown) => (Array.isArray(x) ? (x as unknown[]) : [])
  const Row = ({ label, value }: { label: string; value: string | undefined }) =>
    value ? (
      <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
        <span style={{ color: theme.text.secondary, flexShrink: 0, minWidth: 56 }}>{label}</span>
        <span style={{ color: theme.text.primary }}>{value}</span>
      </div>
    ) : null
  const List = ({ label, items }: { label: string; items: unknown[] }) =>
    items.length > 0 ? (
      <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
        <span style={{ color: theme.text.secondary, flexShrink: 0, minWidth: 56 }}>{label}</span>
        <span style={{ color: theme.text.primary }}>{items.map((x) => String(x)).join('、')}</span>
      </div>
    ) : null
  const cam = s.camera_intent ?? {}
  const light = s.lighting_intent ?? {}
  const cont = s.continuity ?? {}
  const chips = [cam.shot_size, cam.movement, cam.axis, light.ratio, light.temperature].filter(Boolean)
  return (
    <>
      <SectionLabel>创作意图</SectionLabel>
      <div style={{ background: theme.bg.input, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, border: `1px solid ${theme.border.default}`, marginBottom: 4 }}>
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {chips.map((c) => (
              <span key={c} style={{ padding: '2px 8px', borderRadius: 4, background: theme.bg.surface, color: theme.text.primary, fontSize: 11, fontFamily: 'var(--cv-font-mono, monospace)' }}>{c}</span>
            ))}
          </div>
        )}
        <Row label="意图" value={s.felt_intent} />
        <Row label="行为" value={s.visible_behavior} />
        <Row label="运镜" value={cam.movement ? `${cam.movement}${cam.endpoint ? ' → ' + cam.endpoint : ''}` : undefined} />
        <Row label="光照" value={[light.key_source, light.ratio, light.temperature].filter(Boolean).join(' · ') || undefined} />
        <Row label="声音" value={s.audio_intent} />
        <List label="本镜" items={arr(cont.this_clip_only)} />
        <List label="预留" items={arr(cont.reserved_for_later)} />
        <List label="锁定" items={arr(cont.locks)} />
      </div>
    </>
  )
}

function CurationBadge({ curation }: { curation: AssetNodeV3['curation'] }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    candidate: { label: '候选', bg: theme.bg.surface, color: theme.text.secondary },
    selected: { label: '策展选定', bg: v3theme.signal.select, color: '#0A0B0E' },
    deprecated: { label: '落选', bg: v3theme.edge.inactive, color: theme.text.secondary },
    locked: { label: '锁定参考', bg: v3theme.signal.locked, color: '#0A0B0E' },
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
  const dimCount = dims ? Object.keys(dims).length : 0
  return (
    <>
      <SectionLabel>AI 评分</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: dims ? 8 : 0 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: getScoreColor(overall) }}>{Math.round(overall * 100)}</span>
        <span style={{ fontSize: 12, color: theme.text.secondary }}>/ 100</span>
      </div>
      {dimCount >= 3 ? (
        // 任务 2B：≥3 维 → 雷达图（自适应 3–7 维，hover 显示精确数值）
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
          <ScoreRadar aiScore={aiScore} />
        </div>
      ) : dims ? (
        // <3 维不成图，退回逐维条
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(dims).map(([k, v]) => (
            <DimBar key={k} label={k} value={v} />
          ))}
        </div>
      ) : null}
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

/**
 * Prompt 编辑区（REGEN-01，52-03）：反查产生事件（event→asset role:'output' 边），
 * 编辑 evt.params.prompt（P4：配方唯一合法存放处）。
 * 保存 = persistEventParams（52-01：乐观写 canonical + save-v2 + 失败回滚 + toast 全在 store）；
 * 重生成 = executeNode 复用 /canvas/execute 通道（52-02 extra 契约）。
 *
 * 地雷 #4 裁定：重生成 nodeId 用产出资产 id 而非 evt_* id——持久化 V2 blob 无 evt_* 节点，
 * 传 eventId 时 simulate readNode 为 null，且 node:state 回写只更新不可见 canonical 事件节点，
 * 画布资产卡无 running/success 反馈、stale 清除链（52-01 applySocketNodeState）不生效。
 * eventId 仅用于 canonical 写回（persistEventParams）。
 *
 * 边缘 case（research Task 2 实证矩阵）：落选变体（候选事件被删、output 边重指 winner
 * 主事件、配方并入 variantRecipes）与无产生事件的资产（fixture 手造图）→ 整块只读，
 * 保存/重生成 disabled（地雷 #5）；import 种子事件可编辑（prompt 初始空，语义=补配方后
 * 重抽，放行）；多产生事件取第一条 + console.warn，不阻塞。
 */
function PromptSection({ asset }: { asset: AssetNodeV3 }) {
  const graph = useCanvasStore((s) => s.graph)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const showToast = useCanvasStore((s) => s.showToast)
  const persistEventParams = useCanvasStore((s) => s.persistEventParams)

  // 反查产生事件（唯一正道）：graph.links role:'output' && target===asset.id → source 事件
  const evt = useMemo<EventNodeV3 | null>(() => {
    if (!graph) return null
    const producingIds = graph.links.filter((l) => l.role === 'output' && l.target === asset.id).map((l) => l.source)
    const evts = graph.nodes.filter((n): n is EventNodeV3 => n.kind === 'event' && producingIds.includes(n.id))
    if (evts.length > 1) console.warn(`[PromptSection] ${asset.id} 有 ${evts.length} 个产生事件，取第一条（link 序）`)
    return evts[0] ?? null
  }, [graph, asset.id])

  const canonicalPrompt = evt?.params.prompt ?? ''
  const [draft, setDraft] = useState(canonicalPrompt)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 切换节点/产生事件、或 canonical prompt 变化（保存成功 / 失败回滚）时重置草稿
  useEffect(() => { setDraft(canonicalPrompt) }, [evt?.id, canonicalPrompt])

  if (!graph) return null

  // ── 只读态：落选变体 / 无产生事件 ──
  // 落选变体（curation:'deprecated'）：migrate Pass 3 删除候选事件、把 output 边重指到
  // winner 主事件（配方并入 winner variantRecipes）——反查会命中共享主事件，但从落选卡
  // 编辑会改到 winner 配方（地雷 #5），故无论反查是否命中都整块只读。
  // 无产生事件（fixture 手造图）：同样只读。
  const isLoserVariant = asset.curation === 'deprecated'
  if (!evt || isLoserVariant) {
    const hint = asset.variantGroupId
      ? '落选变体配方已并入主事件 variantRecipes，不可单独编辑'
      : '无产生事件，prompt 不可编辑'
    return (
      <div data-testid="prompt-section">
        <SectionLabel>Prompt</SectionLabel>
        <div style={{ padding: '8px 12px', borderRadius: 8, background: theme.bg.input, border: `1px dashed ${theme.border.subtle}`, color: theme.text.disabled, fontSize: 12, lineHeight: 1.6 }}>
          {hint}
        </div>
      </div>
    )
  }

  const dirty = draft !== canonicalPrompt

  const handleSave = async () => {
    setSaving(true)
    try {
      await persistEventParams(evt.id, { prompt: draft })
    } finally {
      setSaving(false)
    }
  }

  const handleRegenerate = async () => {
    // 缺项目上下文 → toast 早退（deleteNode 店级范式）
    if (!projectId || !episodesId) {
      showToast('缺少项目上下文', 'warning')
      return
    }
    setSubmitting(true)
    try {
      // nodeId = 资产 id（地雷 #4 裁定，见组件头注释）；eventId 仅用于 canonical 写回
      await executeNode(projectId, episodesId, asset.id, asset.stage, {
        prompt: canonicalPrompt,
        params: { ...evt.params, prompt: canonicalPrompt },
      })
      // HTTP 200 即提交成功；running/success 反馈交给既有 node:state socket 链，不在此等待
      showToast('已提交重生成', 'success')
    } catch (err) {
      showToast(`重生成提交失败: ${(err as Error).message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div data-testid="prompt-section">
      <SectionLabel>Prompt</SectionLabel>
      <textarea
        data-testid="prompt-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder={evt.op === 'import' ? '（导入资产暂无 prompt，可在此补配方后重抽）' : ''}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: 10, color: theme.text.primary, fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 4 }}>
        <button
          data-testid="prompt-save"
          onClick={() => { void handleSave() }}
          disabled={!dirty || saving}
          style={{ padding: '4px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: !dirty || saving ? 'default' : 'pointer', background: dirty && !saving ? theme.node.script : theme.bg.surface, color: dirty && !saving ? theme.text.onAccent : theme.text.disabled }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          data-testid="prompt-regenerate"
          onClick={() => { void handleRegenerate() }}
          disabled={dirty || submitting}
          title={dirty ? '请先保存，再重生成（防半编辑误触发）' : '以当前配方重新生成'}
          style={{ padding: '4px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: dirty || submitting ? 'default' : 'pointer', background: !dirty && !submitting ? v3theme.signal.running : theme.bg.surface, color: !dirty && !submitting ? theme.text.onAccent : theme.text.disabled }}
        >
          {submitting ? '提交中…' : '重生成'}
        </button>
      </div>
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
