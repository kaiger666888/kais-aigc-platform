/**
 * 分镜时间轴视图 — 无限画布的第二种浏览模式。
 *
 * 布局对齐 kais-shot-timeline 双面板设计：
 *   ┌ 统计栏 ─────────────────────────────────────────────┐
 *   ├ 左面板：分镜列表（flex:1） ── ┬─ 右面板：垂直时间轴（400px） ┤
 *   │  序号 + 首帧缩略 + 时间 +      │  时间刻度 + 分镜边界 +       │
 *   │  元数据 chips + prompt         │  按时长比例的块 + 审核色编码  │
 *   └────────────────────────────────┴──────────────────────────────┘
 *
 *   - 左右面板垂直滚动比例同步（自适应模式）
 *   - 点击左侧分镜 → 右面板对应块居中高亮；点击右侧块 → 左侧对应行居中高亮
 *   - 点击任一块 → setSelectedNode + setDetailNode（打开右详情面板，复用画布交互）
 *
 * 数据直接消费 useCanvasStore.graph（FlowGraphV3）+ rawDataByNodeId（V2 穿透），
 * 无需额外 API 调用。Socket 实时同步、审核操作全部复用现有 store 逻辑。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { METADATA_LABELS } from '../constants'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { UiIcon } from './canvas/icons'

// ─── 类型 ──────────────────────────────────────────────

interface StoryboardShot {
  node: AssetNodeV3
  shotId: string
  durationS: number
  thumbnail: string | null
  cameraMovement?: string
  framing?: string
  composition?: string
  pacing?: string
  promptText?: string
  promptFacets?: {
    subject?: string
    action?: string
    camera?: string
    scene?: string
    lighting?: string
    style?: string
  }
}

/** 带累计起止时间的分镜（时间轴几何用）。 */
interface TimedShot extends StoryboardShot {
  startSec: number
  endSec: number
  /** 布局用时长（durationS 缺失时兜底，保证块有最小可见高度）。 */
  layoutDur: number
}

// ─── 提取分镜数据 ──────────────────────────────────────

function extractShots(graph: FlowGraphV3 | null, rawDataByNodeId: Map<string, Record<string, unknown>> | null): StoryboardShot[] {
  if (!graph) return []

  const shots: StoryboardShot[] = []
  for (const node of graph.nodes) {
    if (node.kind !== 'asset' || node.stage !== 'storyboard') continue
    const meta = node.meta
    if (meta.stage !== 'storyboard') continue

    // rawData = V2 穿透字段（thumbnailUrl, prompt, duration, cameraMovement 等）
    const raw = rawDataByNodeId?.get(node.id) ?? {}

    // 从 raw 或 meta 中获取最佳字段
    const durationS = meta.durationS ?? node.media.durationS ?? (raw.duration as number) ?? 0
    const thumbnail = node.media.thumbnail ?? node.media.original ?? (raw.thumbnailUrl as string) ?? null
    const cameraMovement = meta.cameraMovement ?? (raw.cameraMovement as string)
    const framing = meta.framing ?? (raw.framing as string)
    const composition = meta.composition ?? (raw.composition as string)
    const pacing = meta.pacing ?? (raw.pacing as string)

    // prompt 来源优先级：content > raw.prompt > promptMeta facets
    const promptText = node.content ?? (raw.prompt as string) ?? undefined

    // shotId 显示优化：meta.shotId 可能是冗长的 asset ID，
    // 尝试从 label 中提取更短的显示名
    let displayShotId = meta.shotId
    if (raw.label) {
      displayShotId = raw.label as string
    }

    shots.push({
      node,
      shotId: displayShotId,
      durationS,
      thumbnail,
      cameraMovement,
      framing,
      composition,
      pacing,
      promptText,
      promptFacets: meta.promptMeta,
    })
  }

  // 按 shotId 排序（自然排序：S01, S02, ..., S10）
  shots.sort((a, b) => a.shotId.localeCompare(b.shotId, undefined, { numeric: true, sensitivity: 'base' }))
  return shots
}

// ─── 工具 ──────────────────────────────────────────────

const PX_PER_SEC = 30 // 右面板每秒像素（线性时间轴）
const MIN_LAYOUT_DUR = 0.6 // durationS 缺失/0 时的兜底时长

function formatDuration(sec: number): string {
  if (sec <= 0) return '—'
  if (sec < 10) return `${sec.toFixed(1)}s`
  return `${Math.round(sec)}s`
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  if (sec < 10) return sec.toFixed(1)
  return String(Math.round(sec))
}

function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  // data: URI 直接返回
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  // /oss/ 路径 → 需要 :10588 后端代理
  if (url.startsWith('/oss/')) return url
  // http/https 直接返回
  if (url.startsWith('http')) return url
  // 相对路径加前缀
  return url
}

/** 选一个「好看」的时间刻度步长（秒），使整条轴约 6–10 个刻度。 */
function niceStep(total: number): number {
  if (total <= 0) return 1
  const target = total / 8
  const pow = Math.pow(10, Math.floor(Math.log10(target)))
  for (const m of [1, 2, 5, 10]) {
    const step = m * pow
    if (step >= target) return step
  }
  return 10 * pow
}

/** 审核状态 → 语义色（复用模态/信号色，不引入新色）。 */
function reviewColor(status?: string): string {
  if (status === 'approved') return v3theme.signal.approved
  if (status === 'rejected') return v3theme.signal.rejected
  return v3theme.signal.pending
}

// ─── 子组件 ────────────────────────────────────────────

function MetaChip({ label, value, color }: { label: string; value: string; color?: string }) {
  if (!value) return null
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 7px',
      borderRadius: 5,
      fontSize: 10,
      fontWeight: 500,
      background: color ? `${color}14` : 'rgba(255,255,255,0.06)',
      color: color ?? theme.text.secondary,
      border: `1px solid ${color ? `${color}30` : 'rgba(255,255,255,0.08)'}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </span>
  )
}

function ReviewBadge({ status }: { status?: string }) {
  if (!status) return null
  const config: Record<string, { color: string; label: string }> = {
    approved: { color: v3theme.signal.approved, label: '✓ 通过' },
    rejected: { color: v3theme.signal.rejected, label: '✕ 驳回' },
    pending: { color: v3theme.signal.pending, label: '待审' },
  }
  const cfg = config[status]
  if (!cfg) return null
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      background: `${cfg.color}18`,
      color: cfg.color,
      border: `1px solid ${cfg.color}40`,
    }}>
      {cfg.label}
    </span>
  )
}

function ScoreBadge({ score }: { score?: { overall: number; dimensions?: Record<string, number> } | null }) {
  if (!score || typeof score.overall !== 'number') return null
  const s = score.overall
  const color = s >= 80 ? v3theme.signal.approved : s >= 60 ? v3theme.signal.running : v3theme.signal.rejected
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 7px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 700,
      fontFamily: 'var(--cv-font-mono, monospace)',
      background: `${color}14`,
      color,
      border: `1px solid ${color}30`,
    }}>
      {Math.round(s)}
    </span>
  )
}

function StateDot({ state }: { state: string }) {
  const config: Record<string, string> = {
    pending: v3theme.signal.pending,
    running: v3theme.signal.running,
    success: v3theme.signal.approved,
    failed: v3theme.signal.rejected,
  }
  const color = config[state] ?? v3theme.signal.pending
  return (
    <span style={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
      boxShadow: state === 'running' ? `0 0 6px ${color}` : 'none',
      animation: state === 'running' ? 'cv-spin 1s linear infinite' : 'none',
    }} />
  )
}

// ─── 左面板：分镜行 ────────────────────────────────────

function ShotRow({
  shot,
  index,
  total,
  onClick,
  isSelected,
  rowRef,
}: {
  shot: TimedShot
  index: number
  total: number
  onClick: () => void
  isSelected: boolean
  rowRef: (el: HTMLDivElement | null) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { node } = shot

  // 构造 prompt 摘要
  const promptSummary = useMemo(() => {
    if (shot.promptText) return shot.promptText
    if (shot.promptFacets) {
      const parts = [
        shot.promptFacets.subject,
        shot.promptFacets.action,
        shot.promptFacets.scene,
      ].filter(Boolean)
      if (parts.length > 0) return parts.join('，')
    }
    return ''
  }, [shot.promptText, shot.promptFacets])

  const thumbUrl = resolveMediaUrl(shot.thumbnail)

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: `1px solid ${theme.border.dim}`,
        background: isSelected
          ? 'rgba(86,184,154,0.08)'
          : hovered
            ? theme.bg.cardHover
            : 'transparent',
        borderLeft: isSelected ? `2px solid ${v3theme.signal.approved}` : '2px solid transparent',
        transition: 'background 120ms',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 序号 */}
      <span style={{
        width: 34,
        flexShrink: 0,
        paddingTop: 4,
        textAlign: 'right',
        fontSize: 12,
        fontWeight: 700,
        color: v3theme.modality.image,
        fontFamily: 'var(--cv-font-mono, monospace)',
      }}>
        {index + 1}
      </span>

      {/* 首帧缩略图（仅一张 → 单张显示） */}
      <div style={{
        flexShrink: 0,
        width: 132,
        aspectRatio: '16 / 9',
        borderRadius: 3,
        overflow: 'hidden',
        background: v3theme.surface.canvas,
        position: 'relative',
        border: `1px solid ${theme.border.default}`,
      }}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={shot.shotId}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme.text.tertiary,
          }}>
            <UiIcon kind="image" size={22} />
          </div>
        )}
        {/* 时长徽章 */}
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          padding: '1px 6px', borderRadius: 4,
          background: 'rgba(0,0,0,0.75)', color: '#fff',
          fontSize: 10, fontWeight: 600,
          fontFamily: 'var(--cv-font-mono, monospace)',
          backdropFilter: 'blur(4px)',
        }}>
          {formatDuration(shot.durationS)}
        </div>
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 时间信息 + 审核角标 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600, color: theme.text.primary,
          }}>
            <StateDot state={node.state} />
            <span style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}>{shot.shotId}</span>
          </span>
          <span style={{
            fontSize: 10, color: theme.text.tertiary,
            fontFamily: 'var(--cv-font-mono, monospace)',
          }}>
            {formatTime(shot.startSec)}→{formatTime(shot.endSec)}
            <span style={{ color: v3theme.modality.text, marginLeft: 3 }}>({formatDuration(shot.durationS)})</span>
          </span>
          <span style={{ flex: 1 }} />
          <ReviewBadge status={node.reviewStatus} />
          <ScoreBadge score={node.aiScore} />
        </div>

        {/* 元数据 chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: promptSummary ? 4 : 0 }}>
          {shot.cameraMovement && (
            <MetaChip
              label="🎥"
              value={METADATA_LABELS.cameraMovement[shot.cameraMovement as keyof typeof METADATA_LABELS.cameraMovement] ?? shot.cameraMovement}
              color={v3theme.modality.video}
            />
          )}
          {shot.framing && (
            <MetaChip
              label="🖼"
              value={METADATA_LABELS.framing[shot.framing as keyof typeof METADATA_LABELS.framing] ?? shot.framing}
              color={v3theme.modality.image}
            />
          )}
          {shot.composition && (
            <MetaChip
              label="📐"
              value={METADATA_LABELS.composition[shot.composition as keyof typeof METADATA_LABELS.composition] ?? shot.composition}
            />
          )}
          {shot.pacing && (
            <MetaChip
              label="⚡"
              value={METADATA_LABELS.pacing[shot.pacing as keyof typeof METADATA_LABELS.pacing] ?? shot.pacing}
              color={v3theme.modality.audio}
            />
          )}
          <span style={{
            fontSize: 9, color: theme.text.tertiary, alignSelf: 'center',
            fontFamily: 'var(--cv-font-mono, monospace)', marginLeft: 'auto',
          }}>
            {index + 1}/{total}
          </span>
        </div>

        {/* Prompt 摘要 */}
        {promptSummary && (
          <div style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: theme.text.secondary,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {promptSummary}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 右面板：时间轴块 ──────────────────────────────────

function ShotBlock({
  shot,
  index,
  onClick,
  isSelected,
  blockRef,
}: {
  shot: TimedShot
  index: number
  onClick: () => void
  isSelected: boolean
  blockRef: (el: HTMLDivElement | null) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { node } = shot
  const height = Math.max(shot.layoutDur * PX_PER_SEC, MIN_LAYOUT_DUR * PX_PER_SEC)
  const accent = reviewColor(node.reviewStatus)
  const showBody = height >= 56

  const promptSummary = useMemo(() => {
    if (shot.promptText) return shot.promptText
    if (shot.promptFacets) {
      const parts = [shot.promptFacets.subject, shot.promptFacets.action, shot.promptFacets.scene].filter(Boolean)
      if (parts.length > 0) return parts.join('，')
    }
    return ''
  }, [shot.promptText, shot.promptFacets])

  const thumbUrl = resolveMediaUrl(shot.thumbnail)

  return (
    <div
      ref={blockRef}
      style={{
        height,
        display: 'flex',
        alignItems: 'stretch',
        gap: 6,
        padding: showBody ? '4px 8px' : '0 8px',
        cursor: 'pointer',
        background: isSelected
          ? `${accent}1f`
          : hovered
            ? `${accent}14`
            : 'transparent',
        borderLeft: `3px solid ${accent}`,
        borderBottom: `1px solid ${theme.border.dim}`,
        transition: 'background 120ms',
        overflow: 'hidden',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${shot.shotId} · ${formatTime(shot.startSec)}→${formatTime(shot.endSec)}`}
    >
      {/* 缩略图缩略（块够高才显示） */}
      {showBody && (
        <div style={{
          flexShrink: 0,
          width: 48,
          alignSelf: 'center',
          aspectRatio: '16 / 9',
          borderRadius: 2,
          overflow: 'hidden',
          background: v3theme.surface.canvas,
          border: `1px solid ${theme.border.default}`,
        }}>
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={shot.shotId}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : null}
        </div>
      )}

      {/* 文本 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: v3theme.modality.image,
            fontFamily: 'var(--cv-font-mono, monospace)',
          }}>
            #{index + 1}
          </span>
          <span style={{
            fontSize: 10, color: theme.text.secondary, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {shot.shotId}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: 10, fontWeight: 600, color: v3theme.modality.text,
            fontFamily: 'var(--cv-font-mono, monospace)', flexShrink: 0,
          }}>
            {formatDuration(shot.durationS)}
          </span>
        </div>
        {showBody && promptSummary && (
          <div style={{
            fontSize: 10,
            lineHeight: 1.4,
            color: theme.text.tertiary,
            marginTop: 2,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: height >= 90 ? 2 : 1,
            WebkitBoxOrient: 'vertical',
          }}>
            {promptSummary}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────

export default function StoryboardTimeline() {
  const graph = useCanvasStore((s) => s.graph)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const detailNode = useCanvasStore((s) => s.detailNode)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)

  const baseShots = useMemo(() => extractShots(graph, rawDataByNodeId), [graph, rawDataByNodeId])

  // 计算累计起止时间 → 时间轴几何
  const shots = useMemo<TimedShot[]>(() => {
    let cum = 0
    return baseShots.map((s) => {
      const layoutDur = s.durationS > 0 ? s.durationS : MIN_LAYOUT_DUR
      const startSec = cum
      cum += layoutDur
      return { ...s, startSec, endSec: startSec + layoutDur, layoutDur }
    })
  }, [baseShots])

  const totalDuration = shots.length ? shots[shots.length - 1].endSec : 0
  const timelinePxHeight = totalDuration * PX_PER_SEC

  // 统计
  const stats = useMemo(() => {
    const totalDurationSum = shots.reduce((sum, s) => sum + s.durationS, 0)
    const approved = shots.filter((s) => s.node.reviewStatus === 'approved').length
    const rejected = shots.filter((s) => s.node.reviewStatus === 'rejected').length
    const pending = shots.filter((s) => !s.node.reviewStatus || s.node.reviewStatus === 'pending').length
    const withThumbs = shots.filter((s) => s.thumbnail).length
    const scores = shots.filter((s) => s.node.aiScore?.overall != null).map((s) => s.node.aiScore!.overall)
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    return { totalDurationSum, approved, rejected, pending, withThumbs, avgScore, count: shots.length }
  }, [shots])

  // 时间刻度
  const ticks = useMemo(() => {
    const step = niceStep(totalDuration)
    const arr: number[] = []
    for (let t = 0; t <= totalDuration + 0.001; t += step) arr.push(Math.round(t * 100) / 100)
    return arr
  }, [totalDuration])

  // 查找 RF Node（用于打开详情面板）
  const nodes = useCanvasStore((s) => s.nodes)

  // ─── 双面板滚动同步 ──────────────────────────────────
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  const leftRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rightBlockRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const syncing = useRef(false)

  /** 比例同步：把 dst 滚到与 src 相同的滚动比例（自适应模式，两面板总高不同）。 */
  const proportionallySync = (src: HTMLElement, dst: HTMLElement) => {
    const srcMax = src.scrollHeight - src.clientHeight
    const dstMax = dst.scrollHeight - dst.clientHeight
    if (srcMax <= 0 || dstMax <= 0) return
    dst.scrollTop = (src.scrollTop / srcMax) * dstMax
  }

  const handleScroll = (which: 'left' | 'right') => {
    if (syncing.current) return
    syncing.current = true
    const src = which === 'left' ? leftRef.current : rightRef.current
    const dst = which === 'left' ? rightRef.current : leftRef.current
    if (src && dst) proportionallySync(src, dst)
    requestAnimationFrame(() => { syncing.current = false })
  }

  /** 点击分镜 → 把「另一面板」对应元素居中到视口。 */
  const centerOther = (from: 'left' | 'right', id: string) => {
    const dst = from === 'left' ? rightRef.current : leftRef.current
    const el = from === 'left' ? rightBlockRefs.current[id] : leftRowRefs.current[id]
    if (!dst || !el) return
    syncing.current = true
    const cRect = dst.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const offsetTop = eRect.top - cRect.top + dst.scrollTop
    const target = offsetTop - (dst.clientHeight - eRect.height) / 2
    dst.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    window.setTimeout(() => { syncing.current = false }, 350)
  }

  const selectShot = (shot: StoryboardShot, from: 'left' | 'right') => {
    const rfNode = nodes.find((n) => n.id === shot.node.id)
    if (rfNode) {
      setSelectedNode(rfNode)
      setDetailNode(rfNode)
    }
    centerOther(from, shot.node.id)
  }

  // ─── 响应式：<1100px 隐藏右面板 ──────────────────────
  const [showTimeline, setShowTimeline] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1100 : true,
  )
  useEffect(() => {
    const onResize = () => setShowTimeline(window.innerWidth >= 1100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ─── 空状态 ──────────────────────────────────────────
  if (shots.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
        color: theme.text.tertiary,
        background: theme.bg.canvas,
      }}>
        <UiIcon kind="film" size={48} />
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text.secondary }}>
          暂无分镜数据
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, textAlign: 'center', maxWidth: 360 }}>
          请先运行管线生成分镜（P06 分镜师阶段），<br />
          分镜节点将在此处以时间轴方式展示。
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: theme.bg.canvas, overflow: 'hidden',
    }}>
      {/* ─── 统计概览栏 ─── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '10px 24px',
        background: theme.bg.panel,
        borderBottom: `1px solid ${theme.border.default}`,
        fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: theme.text.tertiary }}>分镜总数</span>
          <span style={{ fontWeight: 700, color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)' }}>{stats.count}</span>
        </div>
        <div style={{ width: 1, height: 14, background: theme.border.default }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: theme.text.tertiary }}>总时长</span>
          <span style={{ fontWeight: 700, color: v3theme.modality.video, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            {stats.totalDurationSum > 0 ? formatDuration(stats.totalDurationSum) : '—'}
          </span>
        </div>
        {stats.avgScore != null && (
          <>
            <div style={{ width: 1, height: 14, background: theme.border.default }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: theme.text.tertiary }}>平均评分</span>
              <span style={{ fontWeight: 700, color: v3theme.signal.approved, fontFamily: 'var(--cv-font-mono, monospace)' }}>
                {Math.round(stats.avgScore)}
              </span>
            </div>
          </>
        )}
        <div style={{ width: 1, height: 14, background: theme.border.default }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: theme.text.tertiary }}>审核</span>
          <span style={{ color: v3theme.signal.approved, fontWeight: 600 }}>✓ {stats.approved}</span>
          <span style={{ color: v3theme.signal.pending, fontWeight: 600 }}>○ {stats.pending}</span>
          <span style={{ color: v3theme.signal.rejected, fontWeight: 600 }}>✕ {stats.rejected}</span>
        </div>
        <div style={{ width: 1, height: 14, background: theme.border.default }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: theme.text.tertiary }}>缩略图</span>
          <span style={{ fontWeight: 600, color: theme.text.secondary }}>{stats.withThumbs}/{stats.count}</span>
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ color: theme.text.tertiary, fontSize: 11 }}>
          💡 点击分镜查看详情，左右面板滚动同步
        </span>
      </div>

      {/* ─── 双面板 ─── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左面板：分镜列表 */}
        <div
          ref={leftRef}
          onScroll={() => handleScroll('left')}
          style={{
            flex: '1 1 auto',
            minWidth: 320,
            overflowY: 'auto',
            borderRight: showTimeline ? `1px solid ${theme.border.default}` : 'none',
          }}
        >
          {shots.map((shot, i) => (
            <ShotRow
              key={shot.node.id}
              shot={shot}
              index={i}
              total={shots.length}
              onClick={() => selectShot(shot, 'left')}
              isSelected={detailNode?.id === shot.node.id}
              rowRef={(el) => { leftRowRefs.current[shot.node.id] = el }}
            />
          ))}
        </div>

        {/* 右面板：垂直时间轴 */}
        {showTimeline && (
          <div
            ref={rightRef}
            onScroll={() => handleScroll('right')}
            style={{
              flex: '0 0 400px',
              overflowY: 'auto',
              overflowX: 'hidden',
              position: 'relative',
              background: theme.bg.panel,
            }}
          >
            <div style={{ position: 'relative', height: timelinePxHeight }}>
              {/* 时间刻度轴（左侧 36px） */}
              <div style={{
                position: 'absolute', left: 0, top: 0, width: 36, bottom: 0,
                borderRight: `1px solid ${theme.border.default}`,
                zIndex: 5,
              }}>
                {ticks.map((t) => (
                  <div key={t} style={{
                    position: 'absolute', right: 4,
                    top: t * PX_PER_SEC,
                    transform: 'translateY(-50%)',
                    fontSize: 9, color: theme.text.tertiary,
                    fontFamily: 'var(--cv-font-mono, monospace)',
                  }}>
                    {formatTime(t)}s
                  </div>
                ))}
              </div>

              {/* 分镜块（右移让出时间轴） */}
              <div style={{ position: 'absolute', left: 36, right: 0, top: 0 }}>
                {shots.map((shot, i) => (
                  <ShotBlock
                    key={shot.node.id}
                    shot={shot}
                    index={i}
                    onClick={() => selectShot(shot, 'right')}
                    isSelected={detailNode?.id === shot.node.id}
                    blockRef={(el) => { rightBlockRefs.current[shot.node.id] = el }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
