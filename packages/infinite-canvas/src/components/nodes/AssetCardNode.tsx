/**
 * src/components/nodes/AssetCardNode.tsx — V3 资产卡片（设计 §4 节点解剖学 + §7 LOD）。
 *
 * 注册键 = 10 个 stage（adapter 契约：资产 RF type = stage 字符串）。
 *  - L2 近景（§4.1）：240×160 卡（global 168×120 / composite 280×180+胶片条 / text 自适应），
 *    左 3px 模态边条 + 12px 模态图标、标题 12/600 单行截断、封面区 224×96（缺封面 =
 *    模态弱色底 + 32px 图标 @40%，这是常态路径）、底行 mono 10px `#037 · 3.3s`。
 *  - L1 中景：160×100（封面缩略 + 9px 标题 + 3px 边条；角标只留 stale/selected）。
 *  - L0 全景：24×14 模态色块（text 用 70% 明度版 #9E9378；stale 改 #F0A52E 描边 1px；
 *    牌堆 → 单块 + 右侧 2px 厚度条）。
 *  - 牌堆 chrome（§4.8）：≤3 层残影（4px/4px 偏移、brightness ×0.85 逐层）+ ×N 计数章；
 *    展开/选定交互归 C（slots.registerVariantStackHandlers），B 默认 = 扇形铺开（P17 折叠持久化）。
 *  - stale 三重冗余（§4.5）：三角角标 + 整卡 1.5px 虚线描边（dash 4 3）+ 封面 saturate(0.6)。
 *  - locked 参考（§1.3）：封面 saturate(0.55) brightness(0.9)。
 *  - 溯源通道（给 C 的 P18 接缝）：data.traceState = 'highlighted' | 'dimmed'。
 *  - 视频 hover 200ms 内联播 480p proxy（P15，L2 专属）；audio 24 柱波形 + 播放键。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { AssetNodeV3, Stage } from '@kais/flowgraph-v3'
import { V3_NODE_SIZES } from '../../constants'
import { v3theme, type Modality } from '../../theme/catppuccin'
import { useLodLevel, type LodLevel } from '../../hooks/useLod'
import { useCanvasUiStore } from '../canvas/canvasUiStore'
import {
  getNodeBadgesRenderer,
  getVariantStackHandlers,
  registerNodeBadgesRenderer,
} from '../canvas/slots'
import NodeBadgesDefault from '../canvas/NodeBadgesDefault'
import { ModalityIcon, type ModalityIconKind } from '../canvas/icons'
import ScoreMiniBar from '../badges/ScoreMiniBar'
import type { VariantStackData } from '../../v3/adapter'

type AssetCardData = {
  v3?: AssetNodeV3
  stage?: Stage
  modality?: Modality
  label?: string
  content?: string
  curation?: AssetNodeV3['curation']
  stale?: AssetNodeV3['stale']
  variantStack?: VariantStackData
  /** C 的 P18 溯源接缝：'highlighted' 祖先链 / 'dimmed' 其余压暗 */
  traceState?: 'highlighted' | 'dimmed'
  // 旧组件过渡别名（非 graph 路径兜底）
  thumbnailUrl?: string | null
  filePath?: string | null
  state?: string
}

type AssetCardNodeType = Node<AssetCardData>

// B 注册默认角标实现（C 可通过 registerNodeBadgesRenderer 覆盖为完整四角系统）
registerNodeBadgesRenderer(NodeBadgesDefault)

/** stage → 渲染用模态（资产自带 modality 权威；stage 仅兜底）。 */
function modalityOf(data: AssetCardData): Modality {
  if (data.modality) return data.modality
  switch (data.stage) {
    case 'script': return 'text'
    case 'video': case 'composite': return 'video'
    case 'voice': case 'foley': case 'bgm': case 'mix': return 'audio'
    default: return 'image'
  }
}

/** 底行元信息 `#037 · 3.3s`（shot 编号 · 时长；§4.1）。 */
function metaLine(asset: AssetNodeV3 | undefined): string | null {
  if (!asset) return null
  const meta = asset.meta as { shotId?: string; durationS?: number }
  const parts: string[] = []
  if (meta.shotId) {
    const digits = meta.shotId.match(/(\d+)\D*$/)
    parts.push(`#${(digits?.[1] ?? meta.shotId).padStart(3, '0')}`)
  }
  const dur = meta.durationS ?? asset.media.durationS
  if (typeof dur === 'number') parts.push(`${dur.toFixed(1)}s`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 卡片盒尺寸（§4.6 变体尺寸表）。 */
function cardSize(stage: Stage | undefined): { w: number; h: number } {
  if (stage === 'global') return { w: V3_NODE_SIZES.globalCard.width, h: V3_NODE_SIZES.globalCard.height }
  if (stage === 'composite') return { w: V3_NODE_SIZES.compositeCard.width, h: V3_NODE_SIZES.compositeCard.height }
  return { w: V3_NODE_SIZES.card.width, h: V3_NODE_SIZES.card.height }
}

// ─── L0 全景色块 ────────────────────────────────────────────

function L0Block({ data }: { data: AssetCardData }) {
  const mod = modalityOf(data)
  const stale = data.stale != null
  const stackCount = data.variantStack?.count ?? 0
  return (
    <div data-testid="asset-card-l0" style={{ position: 'relative', width: V3_NODE_SIZES.l0.width, height: V3_NODE_SIZES.l0.height }}>
      <Handle type="target" position={Position.Left} style={hiddenHandle} />
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 3,
          background: mod === 'text' ? v3theme.modalityDim.text : v3theme.modality[mod],
          border: stale ? `1px solid ${v3theme.signal.stale}` : 'none',
        }}
      />
      {stackCount > 1 && (
        <div style={{ position: 'absolute', right: -3, top: 0, width: 2, height: '100%', background: v3theme.modality[mod], opacity: 0.6, borderRadius: 1 }} />
      )}
      <Handle type="source" position={Position.Right} style={hiddenHandle} />
    </div>
  )
}

// ─── 封面区（L1/L2 共用） ───────────────────────────────────

function Cover({ data, mod, width, height, lod }: {
  data: AssetCardData
  mod: Modality
  width: number
  height: number
  lod: LodLevel
}) {
  const asset = data.v3
  const rawThumb = asset?.media.thumbnail ?? data.thumbnailUrl ?? null
  // 缩略图加载失败 → 退回「缺封面」常态路径（弱色底 + 模态图标 @40%）
  const [thumbFailed, setThumbFailed] = useState(false)
  useEffect(() => setThumbFailed(false), [rawThumb])
  const thumb = thumbFailed ? null : rawThumb
  const locked = data.curation === 'locked'
  const stale = data.stale != null
  const [videoPlaying, setVideoPlaying] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])

  const filter = [
    locked ? 'saturate(0.55) brightness(0.9)' : '',
    stale ? 'saturate(0.6)' : '',
  ].filter(Boolean).join(' ') || undefined

  // text 卡展开/收起（§4.6：max 220 折叠 + 展开；P17 折叠态持久化）
  const assetId = asset?.id ?? ''
  const textExpanded = useCanvasUiStore((s) => s.expandedTexts.includes(assetId))
  const toggleText = useCanvasUiStore((s) => s.toggleText)

  const videoSrc = mod === 'video' ? (asset?.media.proxy ?? asset?.media.original ?? data.filePath ?? null) : null
  const audioSrc = mod === 'audio' ? (asset?.media.original ?? data.filePath ?? null) : null

  // L2 视频：hover 200ms 后内联播 480p proxy（P15）
  const onEnter = useCallback(() => {
    if (lod !== 2 || !videoSrc) return
    hoverTimer.current = setTimeout(() => setVideoPlaying(true), 200)
  }, [lod, videoSrc])
  const onLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setVideoPlaying(false)
  }, [])

  // 缺封面 = 常态路径（§4.1：弱色底 + 32px 模态图标 @40%）
  const placeholder = (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: v3theme.modalityWeak[mod], borderRadius: 4,
    }}>
      <span style={{ opacity: 0.4, display: 'flex' }}>
        <ModalityIcon kind={mod as ModalityIconKind} size={32} color={v3theme.modality[mod]} />
      </span>
    </div>
  )

  let body: React.ReactNode = placeholder
  if (mod === 'text') {
    // text 模态：内容前 3 行 11px（无封面区概念，直接渲染正文）；§4.6 展开/收起
    const text = (asset?.content ?? data.content ?? '') as string
    body = (
      <div style={{
        width: '100%', height: textExpanded ? 'auto' : '100%', maxHeight: textExpanded ? 180 : undefined,
        padding: 4, background: v3theme.modalityWeak.text, borderRadius: 4, position: 'relative',
        color: 'var(--cv-text-secondary, #A69F8F)', fontSize: 11, lineHeight: 1.5,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: textExpanded ? 'unset' : 3, WebkitBoxOrient: 'vertical',
      }}>
        {text || <ModalityIcon kind="text" size={32} color={v3theme.modality.text} />}
        {lod === 2 && text.length > 60 && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleText(assetId) }}
            style={{
              position: 'absolute', right: 2, bottom: 2, padding: '0 6px', height: 16,
              background: 'var(--cv-bg-overlay, #313244)', border: '1px solid var(--cv-line-panel, #313244)',
              borderRadius: 3, color: 'var(--cv-text-secondary, #A69F8F)', fontSize: 9, cursor: 'pointer',
            }}
          >
            {textExpanded ? '收起' : '展开'}
          </button>
        )}
      </div>
    )
  } else if (mod === 'audio') {
    body = <WaveformCover seed={asset?.id ?? 'audio'} color={v3theme.modality.audio} audioSrc={audioSrc} enabled={lod === 2} />
  } else if (videoPlaying && videoSrc) {
    body = <video src={videoSrc} autoPlay muted loop style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, filter }} />
  } else if (thumb) {
    body = (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <img src={thumb} alt="" loading="lazy" onError={() => setThumbFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, filter }} />
        {mod === 'video' && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F2E9D8' }}>
            <ModalityIcon kind="video" size={24} color="#F2E9D8" />
          </span>
        )}
      </div>
    )
  } else if (mod === 'video' && videoSrc && lod === 2) {
    // 无封面但有 proxy：弱色底 + ▶（hover 200ms 起播由外层事件驱动）
    body = (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: v3theme.modalityWeak.video, borderRadius: 4,
      }}>
        <span style={{ opacity: 0.6, display: 'flex' }}><ModalityIcon kind="video" size={24} color={v3theme.modality.video} /></span>
      </div>
    )
  }

  return (
    <div
      data-testid="asset-card-cover"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ width, height: mod === 'text' && textExpanded ? 'auto' : height, borderRadius: 4, overflow: 'hidden', flex: '0 0 auto' }}
    >
      {body}
    </div>
  )
}

/** audio 封面：24 柱波形（沿用现有 AudioNode 柱数）+ 播放键。
 *  真实波形数据走 media.waveform（P15 三件套，管线生成）；波形 URL 缺省时按
 *  资产 id 哈希合成确定性占位柱高——接口留 waveformUrl，接入后替换 heights 来源。 */
function WaveformCover({ seed, color, audioSrc, enabled }: { seed: string; color: string; audioSrc: string | null; enabled: boolean }) {
  const heights = useMemo(() => pseudoWaveform(seed, 24), [seed])
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!audioSrc) return
    if (!audioRef.current) {
      audioRef.current = new Audio(audioSrc)
      audioRef.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      void audioRef.current.play().catch(() => setPlaying(false))
      setPlaying(true)
    }
  }, [audioSrc, playing])
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px',
      background: v3theme.modalityWeak.audio, borderRadius: 4, position: 'relative',
    }}>
      {heights.map((h, i) => (
        <div key={i} style={{ flex: 1, height: `${Math.round(h * 100)}%`, background: color, opacity: playing ? 1 : 0.7, borderRadius: 1 }} />
      ))}
      {enabled && audioSrc && (
        <button
          onClick={toggle}
          data-testid="asset-card-audio-toggle"
          style={{
            position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, borderRadius: '50%',
            background: 'var(--cv-bg-overlay, #313244)', border: 'none', color: '#E8E2D5',
            fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
      )}
    </div>
  )
}

/** 确定性占位波形（id 哈希 → 24 柱高 0.15–1.0）。 */
function pseudoWaveform(seed: string, bars: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out.push(0.15 + ((h >>> 0) % 1000) / 1000 * 0.85)
  }
  return out
}

// ─── 变体牌堆 chrome（§4.8） ────────────────────────────────

function StackChrome({ stack, cardW, cardH, mod, nodeId, children }: {
  stack: VariantStackData
  cardW: number
  cardH: number
  mod: Modality
  nodeId: string
  children: React.ReactNode
}) {
  const layers = Math.min(V3_NODE_SIZES.stack.layers, stack.count - 1)
  const handlers = getVariantStackHandlers()
  const toggleStack = useCanvasUiStore((s) => s.toggleStack)
  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (handlers.onStackToggle) handlers.onStackToggle(nodeId, stack) // C 接管：候选列表
      else toggleStack(nodeId) // B 默认：扇形展开/收起（P17 折叠持久化）
    },
    [handlers, nodeId, stack, toggleStack],
  )
  return (
    <div style={{ position: 'relative', width: cardW, height: cardH }}>
      {/* 残影层（视觉厚度 = min(3, N) 层，逐层 brightness ×0.85） */}
      {Array.from({ length: layers }, (_, i) => i + 1).map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0,
            transform: `translate(${i * V3_NODE_SIZES.stack.dx}px, ${i * V3_NODE_SIZES.stack.dy}px)`,
            background: 'var(--cv-bg-card, rgba(30,30,46,0.92))',
            border: `1px solid ${v3theme.modalityWeak[mod]}`,
            borderRadius: 8,
            filter: `brightness(${Math.pow(V3_NODE_SIZES.stack.dimStep, i)})`,
            zIndex: -i,
          }}
        />
      ))}
      {children}
      {/* ×N 计数章（右上外侧；C 的 P12 交互入口） */}
      {stack.count > 1 && (
        <button
          data-testid="variant-stack-count"
          data-stack-group-id={stack.groupId}
          onClick={onToggle}
          title={`${stack.count} 个候选（P12 变体牌堆）`}
          style={{
            position: 'absolute', top: -6, right: -28,
            width: V3_NODE_SIZES.stack.countSize, height: V3_NODE_SIZES.stack.countSize,
            borderRadius: '50%', background: 'var(--cv-bg-overlay, #313244)',
            border: '1px solid var(--cv-chip-border, #45475A)',
            color: 'var(--cv-text-secondary, #A69F8F)',
            fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10,
            cursor: 'pointer', zIndex: 4, padding: 0,
          }}
        >
          ×{stack.count}
        </button>
      )}
    </div>
  )
}

/** B 默认展开态：沿主轴扇形铺开（间距 16；deprecated 0.5 透明 + − 章，不隐藏）。
 *  C 接入后由 C 的候选列表取代本渲染。 */
function ExpandedStackFan({ stack }: { stack: VariantStackData }) {
  return (
    <div
      data-testid="variant-stack-fan"
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', left: 0,
        display: 'flex', gap: 16, zIndex: 5,
      }}
    >
      {stack.candidates.map((c, i) => (
        <div
          key={c.id}
          data-candidate-id={c.id}
          style={{
            width: 80, height: 56, borderRadius: 6, overflow: 'hidden', position: 'relative',
            background: 'var(--cv-bg-card, rgba(30,30,46,0.92))',
            border: c.id === stack.winnerNodeId ? `1.5px solid ${v3theme.signal.select}` : '1px solid var(--cv-line-panel, #313244)',
            opacity: c.curation === 'deprecated' ? 0.5 : 1,
            animation: `cv-stack-fan var(--cv-d-stack-open, 240ms) var(--cv-e-spring, cubic-bezier(0.34,1.3,0.4,1)) ${i * 30}ms backwards`,
          }}
        >
          {c.thumbnail
            ? <img src={c.thumbnail} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', background: v3theme.modalityWeak.image }} />}
          <span style={{
            position: 'absolute', left: 2, bottom: 2, fontFamily: 'var(--cv-font-mono, monospace)',
            fontSize: 9, color: 'var(--cv-text-secondary, #A69F8F)',
          }}>
            {c.seed != null ? `seed ${c.seed}` : c.id.slice(-6)}
          </span>
          {c.id === stack.winnerNodeId && (
            <span style={{ position: 'absolute', right: 2, top: 2, color: v3theme.signal.select, fontSize: 10 }}>✓</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────

function AssetCardNodeComponent({ id, data, selected }: NodeProps<AssetCardNodeType>) {
  const lod = useLodLevel()
  const asset = data.v3
  const mod = modalityOf(data)
  const stage = data.stage ?? asset?.stage
  const stale = data.stale != null
  const trace = data.traceState
  const stack = data.variantStack
  const expanded = useCanvasUiStore((s) => (stack ? s.expandedStacks.includes(id) : false))

  if (lod === 0) return <L0Block data={data} />

  const { w: cardW, h: cardH } = cardSize(stage)
  const isL1 = lod === 1
  const w = isL1 ? V3_NODE_SIZES.l1.width : cardW
  const h = isL1 ? V3_NODE_SIZES.l1.height : cardH
  const coverH = stage === 'global' ? V3_NODE_SIZES.globalCard.coverH : V3_NODE_SIZES.card.coverH

  const title = (data.label ?? asset?.phaseName ?? id) as string
  const meta = metaLine(asset)
  const Badges = getNodeBadgesRenderer() ?? NodeBadgesDefault
  // L2 近景且有评分 → 底部渲染 ScoreMiniBar（任务 2A）；卡高随之自适应避免裁切。
  const showScore = !isL1 && !!asset?.aiScore

  const card = (
    <div
      data-testid="asset-card"
      data-node-id={id}
      data-stage={stage}
      style={{
        position: 'relative',
        width: w,
        height: (stage === 'script' || showScore) ? 'auto' : h,
        minHeight: stage === 'script' && !isL1 ? V3_NODE_SIZES.textCard.minH : showScore ? h : undefined,
        background: 'var(--cv-bg-card, rgba(30,30,46,0.92))',
        borderRadius: V3_NODE_SIZES.card.radius,
        // 选中 2px 暖白环（outline 不占盒模型）；stale 1.5px 虚线描边（§4.5 三重冗余之二）
        outline: selected
          ? `2px solid ${v3theme.signal.select}`
          : stale
            ? `1.5px dashed ${v3theme.signal.stale}`
            : 'none',
        outlineOffset: stale && !selected ? 0 : 0,
        // P18 溯源通道（C 接线）：压暗 0.28 + saturate(0.4) / 祖先链提亮
        opacity: trace === 'dimmed' ? 0.28 : 1,
        filter: trace === 'dimmed' ? 'saturate(0.4)' : trace === 'highlighted' ? 'brightness(1.12)' : undefined,
        transition: 'opacity var(--cv-d-dim, 180ms) var(--cv-e-inout, cubic-bezier(0.45,0,0.25,1)), outline-color var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        color: 'var(--cv-text-primary, #E8E2D5)',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'visible',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ ...hiddenHandle, background: v3theme.modality[mod] }} />
      {/* 左 3px 模态边条（模态在卡片上的主权宣示位置） */}
      <div style={{ width: V3_NODE_SIZES.card.modBarW, alignSelf: 'stretch', background: v3theme.modality[mod], borderRadius: '8px 0 0 8px', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 顶行：模态图标 + 标题（单行截断） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: isL1 ? 14 : V3_NODE_SIZES.card.titleH - 8, flex: '0 0 auto' }}>
          <ModalityIcon kind={mod as ModalityIconKind} size={12} color={v3theme.modality[mod]} />
          <span
            title={title}
            style={{
              fontSize: isL1 ? 9 : 12,
              fontWeight: 600,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
        </div>
        {/* 封面区 */}
        <Cover data={data} mod={mod} width={w - V3_NODE_SIZES.card.modBarW - 16} height={isL1 ? 100 - 14 - 28 : coverH} lod={lod} />
        {/* composite 迷你胶片条（§4.6：宣示「我有内部结构」，点击开右面板 TimelineStructure —— D） */}
        {!isL1 && stage === 'composite' && <Filmstrip asset={asset} />}
        {/* 底行元信息 */}
        {!isL1 && meta && (
          <div style={{
            fontFamily: 'var(--cv-font-mono, monospace)', fontVariantNumeric: 'tabular-nums',
            fontSize: 10, color: 'var(--cv-text-secondary, #A69F8F)', flex: '0 0 auto',
          }}>
            {meta}
          </div>
        )}
        {/* 任务 2A：底部迷你评分条（overall 大字 + dimensions 迷你水平条） */}
        {showScore && <ScoreMiniBar score={asset?.aiScore} />}
      </div>
      {asset && <Badges nodeId={id} asset={asset} lod={lod} variant={stage === 'global' ? 'global' : 'full'} />}
      <Handle type="source" position={Position.Right} style={{ ...hiddenHandle, background: v3theme.modality[mod] }} />
    </div>
  )

  return (
    <div style={{ position: 'relative', width: w }}>
      {stack && stack.count > 1 && !isL1 ? (
        <StackChrome stack={stack} cardW={w} cardH={h} mod={mod} nodeId={id}>
          {card}
        </StackChrome>
      ) : card}
      {stack && expanded && !isL1 && <ExpandedStackFan stack={stack} />}
    </div>
  )
}

/** composite 卡迷你胶片条：8 等分 cell 各显示一个代表性 shot 首帧（h=24）。 */
function Filmstrip({ asset }: { asset: AssetNodeV3 | undefined }) {
  const shots = asset?.timeline?.shots ?? []
  const cells = useMemo(() => {
    if (shots.length === 0) return [] as Array<string | null>
    const picked: Array<string | null> = []
    for (let i = 0; i < 8; i++) {
      const shot = shots[Math.floor((i * shots.length) / 8)]
      picked.push(shot?.keyframes?.[0] ?? null)
    }
    return picked
  }, [shots])
  if (cells.length === 0) return null
  return (
    <div
      data-testid="composite-filmstrip"
      style={{ display: 'flex', height: V3_NODE_SIZES.compositeCard.filmstripH, borderRadius: 4, overflow: 'hidden', flex: '0 0 auto' }}
    >
      {cells.map((thumb, i) => (
        <div key={i} style={{ flex: 1, background: v3theme.modalityWeak.video, borderRight: i < 7 ? '1px solid var(--cv-bg-canvas, #100E0A)' : 'none' }}>
          {thumb && <img src={thumb} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
      ))}
    </div>
  )
}

const hiddenHandle: React.CSSProperties = {
  opacity: 0,
  width: 6,
  height: 6,
  border: 'none',
}

export default memo(AssetCardNodeComponent)
