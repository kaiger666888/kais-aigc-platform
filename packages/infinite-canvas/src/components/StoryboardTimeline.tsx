/**
 * 分镜时间轴视图 — 无限画布的第二种浏览模式。
 *
 * 布局：播放器 + 单列分镜列表（占满宽度）
 *   ┌ 统计栏 ─────────────────────────────────────────────┐
 *   ├ 横版：[ 播放器 | 分镜列表（flex:1） ]                  │
 *   ├ 竖版：[ 播放器 ] → [ 分镜列表（flex:1） ]              │
 *   │  序号 + 首尾帧 + 时间 + 元数据 chips + 音轨 chips +     │
 *   │  prompt + 审核色编码                                    │
 *   └────────────────────────────────────────────────────────┘
 *
 *   - 单击分镜 → 选中（高亮）+ 滚动加载视频播放器（不弹详情）
 *   - 双击分镜 → 额外打开右详情面板（复用画布交互）
 *   - 点击音轨 chip → 底部 mini 音频播放器
 *
 * 数据直接消费 useCanvasStore.graph（FlowGraphV3）+ rawDataByNodeId（V2 穿透），
 * 无需额外 API 调用。Socket 实时同步、审核操作全部复用现有 store 逻辑。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { METADATA_LABELS } from '../constants'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { UiIcon } from './canvas/icons'

// ─── 类型 ──────────────────────────────────────────────

/** P10 音频轨（voice / foley / bgm）描述。 */
interface AudioTrack {
  clipType: string // dialogue / ambient / sfx / bgm
  audioType: string // 人声 / 环境音 / 音效 / 背景音乐
  speaker?: string
  durationS: number
  filePath: string
}

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
  /** P11 视频产物（.mp4）路径 — 经 resolveMediaUrl 后供 <video> 播放。 */
  videoUrl?: string | null
  /** 首帧图：优先 P11 video 节点 thumbnailUrl，兜底 storyboard 场景图。 */
  firstFrame?: string | null
  /** 尾帧图：P11 I-frame `*_frame_last` 节点（多数分镜缺失）。 */
  lastFrame?: string | null
  /** P09 文字首帧描述（无首帧图时降级展示）。 */
  startFrameDesc?: string
  /** P09 文字尾帧描述（无尾帧图时降级展示）。 */
  endFrameDesc?: string
  /** 规一化 shot 键（s1_1）— 跨 storyboard↔video↔audio 无 link，靠它关联。 */
  shotKey?: string | null
  /** P10 音频轨（每分镜 1–2 条）。 */
  audioTracks?: AudioTrack[]
}

/** 带累计起止时间的分镜（时间轴几何用）。 */
interface TimedShot extends StoryboardShot {
  startSec: number
  endSec: number
  /** 布局用时长（durationS 缺失时兜底，保证块有最小可见高度）。 */
  layoutDur: number
}

// ─── 提取分镜数据 ──────────────────────────────────────

/**
 * 规一化 shot 键：从任意候选串（shot_id / label / node id / filePath）中提取 `s{n}_{m}`。
 * storyboard 与 P11 video 间无 link，且 video 节点 shot_id 字段常坏（`S1 1` 带空格），
 * 故统一从多源正则提取 + 空格→下划线 + 抹前导零，保证两侧能对上。
 *
 * 正则第二段 `[a-z]*0*(\d+)`：容忍 Scene/Beat 记法 `S01_B01` —— 大小写归一后 `B` 变成
 * `b`，夹在 `_` 与数字之间；旧正则 `_0*(\d+)` 要求下划线后紧跟数字，遇到 `b` 即失配，
 * 导致所有分镜 shotKey 落空、去重永不触发（同一 shot 的 shot_list/e_konte/transition
 * 三类节点各占一个序号位）。`[a-z]*` 吞掉该字母前缀再取数字。
 */
function shotKeyFromCandidates(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue
    const norm = c.toLowerCase().replace(/\s+/g, '_')
    const m = norm.match(/s0*(\d+)_[a-z]*0*(\d+)/)
    if (m) return `s${m[1]}_${m[2]}`
  }
  return null
}

/**
 * 同一 shotKey 下三类 storyboard 节点的优先级（数字越小越优先）。
 * shot_list 字段最完整（镜头/运镜/构图/prompt 齐全），e_konte_sheets 次之，
 * transition_design 仅转场信息。去重时每 key 只保留最高优先级的一条。
 */
function storyboardTypeRank(nodeId: string): number {
  if (nodeId.includes('shot_list')) return 0
  if (nodeId.includes('e_konte_sheets')) return 1
  if (nodeId.includes('transition_design')) return 2
  return 3
}

/** 音频类型 → 图标。按 clip_type / audio_type 关键词匹配。 */
function audioIcon(clipType: string, audioType: string): string {
  const t = `${clipType} ${audioType}`.toLowerCase()
  if (/人声|dialogue|voice/.test(t)) return '🎙️'
  if (/环境|ambient/.test(t)) return '🌊'
  if (/音效|sfx|effect/.test(t)) return '🔊'
  if (/背景音乐|bgm|music/.test(t)) return '🎵'
  return '🔈'
}

/** 规范化 speaker：'none' / 'null' / 空 → undefined（仅人声有实际值）。 */
function normalizeSpeaker(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s || /^(none|null|无|未知)$/i.test(s)) return undefined
  return s
}

function extractShots(graph: FlowGraphV3 | null, rawDataByNodeId: Map<string, Record<string, unknown>> | null): StoryboardShot[] {
  if (!graph) return []

  // Pass 1：storyboard 节点 → 分镜（保留原逻辑，仅追加帧描述 / shotKey）
  const collected: StoryboardShot[] = []
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

    collected.push({
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
      startFrameDesc: (raw.start_frame_description as string) ?? undefined,
      endFrameDesc: (raw.end_frame_description as string) ?? undefined,
      shotKey: shotKeyFromCandidates(raw.shot_id, raw.label, meta.shotId, node.id),
    })
  }

  // 去重：a-shot_list-* / a-e_konte_sheets-* / a-transition_design-* 三类节点共享同一
  // shot_id（如 S01_B01），每个 shotKey 只保留优先级最高的一条（见 storyboardTypeRank）。
  // 无 shotKey 的分镜（shotKey 解析失败）原样保留。
  const byKey = new Map<string, StoryboardShot>()
  const shots: StoryboardShot[] = []
  for (const shot of collected) {
    const key = shot.shotKey
    if (!key) {
      shots.push(shot)
      continue
    }
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, shot)
      shots.push(shot)
    } else if (storyboardTypeRank(shot.node.id) < storyboardTypeRank(prev.node.id)) {
      // 当前优先级更高 → 就地替换（顺序无关）
      const idx = shots.indexOf(prev)
      if (idx >= 0) shots[idx] = shot
      byKey.set(key, shot)
    }
  }

  // Pass 2：P11 video / I-frame 节点 → 按 shotKey 建映射（storyboard↔video 无 link）
  const videoByShot = new Map<string, { filePath: string | null; thumbnail: string | null }>()
  const lastFrameByShot = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.kind !== 'asset') continue
    const raw = rawDataByNodeId?.get(node.id) ?? {}
    const filePath = (raw.filePath as string) ?? node.media.original ?? null
    const thumb = (raw.thumbnailUrl as string) ?? node.media.thumbnail ?? null

    // P11 视频产物（.mp4 等）— 首帧缩略取其 thumbnailUrl
    if (node.stage === 'video' || (filePath && /\.(mp4|mov|webm|mkv)$/i.test(filePath))) {
      const key = shotKeyFromCandidates(raw.shot_id, raw.label, node.id, filePath)
      if (key && !videoByShot.has(key)) videoByShot.set(key, { filePath, thumbnail: thumb })
      continue
    }
    // P11 末帧抽帧（`*_frame_last.*`）— 尾帧图（多数分镜缺失）
    if (filePath && /_frame_last\./i.test(filePath)) {
      const key = shotKeyFromCandidates(raw.shot_id, raw.label, node.id, filePath)
      if (key && thumb && !lastFrameByShot.has(key)) lastFrameByShot.set(key, thumb)
    }
  }

  // Pass 3：视频 / 末帧挂回分镜（video 缺失时 firstFrame 兜底 storyboard 场景图）
  for (const shot of shots) {
    const key = shot.shotKey
    const v = key ? videoByShot.get(key) : undefined
    if (v) {
      shot.videoUrl = v.filePath
      shot.firstFrame = v.thumbnail ?? shot.thumbnail
    } else {
      shot.firstFrame = shot.thumbnail
    }
    if (key) {
      const lf = lastFrameByShot.get(key)
      if (lf) shot.lastFrame = lf
    }

    // Pass 3 兜底：从 P11 video 节点的 OSS 路径直接构造首尾帧 URL。
    // 磁盘上有成对 first_frames_*/last_frames_* 文件且已生成 .webp 缩略图，
    // 但它们不以独立节点出现在 canvas（Pass 2 的 *_frame_last 匹配不到），
    // 故据 videoUrl 反推缩略图目录、shotKey 反构造文件名补齐缺失的帧。
    const videoOssPath = shot.videoUrl
    if (videoOssPath && key && videoOssPath.startsWith('/oss/')) {
      const slash = videoOssPath.lastIndexOf('/')
      if (slash > 0) {
        const ossDir = videoOssPath.substring(0, slash) // /oss/pipeline/7052cea6
        const thumbDir = ossDir.replace(/^\/oss\//, '/oss/_thumbs/') // /oss/_thumbs/pipeline/7052cea6
        // shotKey 规一化为小写（s1_1）；磁盘文件名首字母大写（S1_1）
        const shotFileName = key.replace(/^s/, 'S')
        if (!shot.firstFrame) {
          shot.firstFrame = `${thumbDir}/first_frames_${shotFileName}.webp`
        }
        if (!shot.lastFrame) {
          shot.lastFrame = `${thumbDir}/last_frames_${shotFileName}.webp`
        }
      }
    }
  }

  // Pass 4：P10 音频节点（voice / foley / bgm，modality=audio）→ 按 shotKey 建映射，挂回分镜
  const audioByShot = new Map<string, AudioTrack[]>()
  for (const node of graph.nodes) {
    if (node.kind !== 'asset') continue
    const isAudio = node.modality === 'audio' || node.stage === 'voice' || node.stage === 'foley' || node.stage === 'bgm'
    if (!isAudio) continue
    const raw = rawDataByNodeId?.get(node.id) ?? {}
    const filePath = (raw.filePath as string) ?? node.media.original ?? null
    if (!filePath) continue
    const key = shotKeyFromCandidates(raw.shot_id, raw.label, node.id, filePath)
    if (!key) continue
    const track: AudioTrack = {
      clipType: (raw.clip_type as string) ?? '',
      audioType: (raw.audio_type as string) ?? (raw.audioType as string) ?? '',
      // speaker 仅人声有意义；'none' / 'null' / 空 视为无
      speaker: normalizeSpeaker(raw.speaker as string),
      durationS: (raw.duration_sec as number) ?? node.media.durationS ?? 0,
      filePath,
    }
    const arr = audioByShot.get(key)
    if (arr) arr.push(track)
    else audioByShot.set(key, [track])
  }
  for (const shot of shots) {
    if (shot.shotKey) {
      const tracks = audioByShot.get(shot.shotKey)
      if (tracks && tracks.length) shot.audioTracks = tracks
    }
  }

  // 按 shotId 排序（自然排序：S01, S02, ..., S10）
  shots.sort((a, b) => a.shotId.localeCompare(b.shotId, undefined, { numeric: true, sensitivity: 'base' }))
  return shots
}

// ─── 响应式布局 ────────────────────────────────────────

type LayoutMode = 'landscape' | 'portrait'

/**
 * 窗口宽高比检测：超宽屏（width ≥ 1400 且 宽 > 高 × 1.2）→ 横版
 * （播放器在左、分镜列表在右）；否则竖版 / 窄窗口（播放器在顶部、列表在下方）。
 * 监听 resize 在两者间切换，切换时 activeVideo 状态保留不断。
 */
function detectLayout(w: number, h: number): LayoutMode {
  if (w >= 1400 && w > h * 1.2) return 'landscape'
  return 'portrait'
}

// ─── 工具 ──────────────────────────────────────────────

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

// ─── 子组件 ────────────────────────────────────────────

function MetaChip({ label, value, color, compact }: { label: string; value: string; color?: string; compact?: boolean }) {
  if (!value) return null
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: compact ? '2px 6px' : '2px 7px',
      borderRadius: 5,
      fontSize: compact ? 9 : 10,
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

// ─── 首尾帧缩略盒 ──────────────────────────────────────

/**
 * 单帧缩略盒：有图显图；无图降级为「标签 + 文字描述 + 播放提示」占位。
 * 用于 ShotRow 的首帧 / 尾帧并排展示。
 */
function FrameBox({
  url,
  label,
  placeholderTag,
  placeholderText,
  playHint,
  badge,
  width = 104,
}: {
  url: string | null
  label: string
  placeholderTag?: string
  placeholderText?: string
  playHint?: boolean
  badge?: ReactNode
  width?: number
}) {
  return (
    <div
      title={label}
      style={{
        position: 'relative',
        width,
        aspectRatio: '16 / 9',
        borderRadius: 3,
        overflow: 'hidden',
        flexShrink: 0,
        background: url ? v3theme.surface.canvas : v3theme.modalityWeak.video,
        border: `1px solid ${url ? theme.border.default : theme.border.dim}`,
      }}
    >
      {url ? (
        <img
          src={url}
          alt={label}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          padding: '3px 5px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          {placeholderTag && (
            <div style={{
              fontSize: 8, fontWeight: 700, letterSpacing: 0.4,
              color: v3theme.modality.video, textTransform: 'uppercase',
            }}>
              {placeholderTag}
            </div>
          )}
          <div style={{
            fontSize: 9, lineHeight: 1.25, color: theme.text.tertiary,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {placeholderText || '无帧描述'}
          </div>
          {playHint && (
            <div style={{
              fontSize: 8, fontWeight: 600, color: v3theme.modality.video,
              display: 'inline-flex', alignItems: 'center', gap: 2,
            }}>
              ▶ 点击播放
            </div>
          )}
        </div>
      )}
      {badge}
    </div>
  )
}

// ─── 分镜行 ────────────────────────────────────────────

function ShotRow({
  shot,
  index,
  total,
  onClick,
  onDoubleClick,
  isSelected,
  onAudioPlay,
  activeAudioPath,
  compact,
}: {
  shot: TimedShot
  index: number
  total: number
  onClick: () => void
  onDoubleClick: () => void
  isSelected: boolean
  onAudioPlay?: (track: AudioTrack) => void
  activeAudioPath?: string | null
  compact?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
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

  // 首帧：优先 P11 video 缩略；尾帧：P11 frame_last（多数缺失 → 文字占位）
  const firstFrameUrl = resolveMediaUrl(shot.firstFrame ?? shot.thumbnail)
  const lastFrameUrl = resolveMediaUrl(shot.lastFrame)
  const hasFrameDesc = !!(shot.startFrameDesc || shot.endFrameDesc)
  const audioTracks = shot.audioTracks ?? []

  return (
    <div
      data-testid="shot-row"
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
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 序号 */}
      <span style={{
        width: 30,
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

      {/* 首尾帧并排（首帧 = P11 video 缩略 / 场景图；尾帧 = frame_last 或文字占位） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <FrameBox
          url={firstFrameUrl}
          label={`${shot.shotId} · 首帧`}
          placeholderTag="首帧"
          placeholderText={shot.startFrameDesc}
          width={compact ? 88 : 104}
          playHint={!firstFrameUrl && !!shot.videoUrl}
          badge={shot.videoUrl ? (
            <div style={{
              position: 'absolute', top: 3, left: 3,
              display: 'inline-flex', alignItems: 'center', gap: 2,
              padding: '1px 5px', borderRadius: 4,
              background: 'rgba(0,0,0,0.72)', color: '#fff',
              fontSize: 9, fontWeight: 600,
              fontFamily: 'var(--cv-font-mono, monospace)',
              backdropFilter: 'blur(4px)',
            }}>
              ▶ {formatDuration(shot.durationS)}
            </div>
          ) : (
            <div style={{
              position: 'absolute', bottom: 3, right: 3,
              padding: '1px 6px', borderRadius: 4,
              background: 'rgba(0,0,0,0.72)', color: '#fff',
              fontSize: 10, fontWeight: 600,
              fontFamily: 'var(--cv-font-mono, monospace)',
              backdropFilter: 'blur(4px)',
            }}>
              {formatDuration(shot.durationS)}
            </div>
          )}
        />
        <span style={{ color: theme.text.tertiary, fontSize: 11, flexShrink: 0 }}>→</span>
        <FrameBox
          url={lastFrameUrl}
          label={`${shot.shotId} · 尾帧`}
          placeholderTag="尾帧"
          placeholderText={shot.endFrameDesc}
          width={compact ? 88 : 104}
          playHint={!!shot.videoUrl}
        />
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: (promptSummary || audioTracks.length > 0) ? 4 : 0 }}>
          {shot.cameraMovement && (
            <MetaChip
              label="🎥"
              value={METADATA_LABELS.cameraMovement[shot.cameraMovement as keyof typeof METADATA_LABELS.cameraMovement] ?? shot.cameraMovement}
              color={v3theme.modality.video}
              compact={compact}
            />
          )}
          {shot.framing && (
            <MetaChip
              label="🖼"
              value={METADATA_LABELS.framing[shot.framing as keyof typeof METADATA_LABELS.framing] ?? shot.framing}
              color={v3theme.modality.image}
              compact={compact}
            />
          )}
          {shot.composition && (
            <MetaChip
              label="📐"
              value={METADATA_LABELS.composition[shot.composition as keyof typeof METADATA_LABELS.composition] ?? shot.composition}
              compact={compact}
            />
          )}
          {shot.pacing && (
            <MetaChip
              label="⚡"
              value={METADATA_LABELS.pacing[shot.pacing as keyof typeof METADATA_LABELS.pacing] ?? shot.pacing}
              color={v3theme.modality.audio}
              compact={compact}
            />
          )}
          <span style={{
            fontSize: 9, color: theme.text.tertiary, alignSelf: 'center',
            fontFamily: 'var(--cv-font-mono, monospace)', marginLeft: 'auto',
          }}>
            {index + 1}/{total}
          </span>
        </div>

        {/* 音轨 chips（P10 音频：人声 / 环境音 / 音效 / 背景音乐） */}
        {audioTracks.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: promptSummary ? 4 : 0 }}>
            {audioTracks.map((track, ti) => {
              const isActive = activeAudioPath === track.filePath
              return (
                <button
                  key={ti}
                  data-testid="audio-chip"
                  onClick={(e) => { e.stopPropagation(); onAudioPlay?.(track) }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={`${track.audioType || track.clipType || '音频'}${track.speaker ? ' · ' + track.speaker : ''} · ${formatDuration(track.durationS)}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: compact ? '2px 6px' : '2px 7px',
                    borderRadius: 5,
                    fontSize: compact ? 9 : 10,
                    fontWeight: 500,
                    cursor: 'pointer',
                    background: isActive ? `${v3theme.modality.audio}30` : `${v3theme.modality.audio}14`,
                    color: v3theme.modality.audio,
                    border: `1px solid ${isActive ? v3theme.modality.audio : `${v3theme.modality.audio}30`}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{audioIcon(track.clipType, track.audioType)}</span>
                  {track.speaker && <span style={{ fontWeight: 600 }}>{track.speaker}</span>}
                  <span style={{ opacity: 0.85, fontFamily: 'var(--cv-font-mono, monospace)' }}>
                    {formatDuration(track.durationS)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

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

        {/* 首尾帧文字描述（可折叠；无帧图时为主要画面信息） */}
        {hasFrameDesc && (
          <div style={{ marginTop: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 10, color: theme.text.tertiary,
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
            >
              {expanded ? '▴ 收起首尾帧' : '▾ 首尾帧描述'}
            </button>
            {expanded && (
              <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {shot.startFrameDesc && (
                  <div style={{ fontSize: 10, lineHeight: 1.45, color: theme.text.secondary }}>
                    <span style={{ color: v3theme.modality.video, fontWeight: 700, marginRight: 4 }}>首</span>
                    {shot.startFrameDesc}
                  </div>
                )}
                {shot.endFrameDesc && (
                  <div style={{ fontSize: 10, lineHeight: 1.45, color: theme.text.secondary }}>
                    <span style={{ color: v3theme.modality.video, fontWeight: 700, marginRight: 4 }}>尾</span>
                    {shot.endFrameDesc}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 底部视频播放器 ────────────────────────────────────

/**
 * 内嵌播放器：选中带 P11 视频的分镜后滑出。src 变更经 key 重挂载触发 autoPlay；
 * 无视频数据的项目不渲染（graceful degradation）。
 *
 * mode='landscape'：宽度由父级 flex 控制（0 0 38%），高度填满列，置于列表左侧。
 * mode='portrait' ：宽度满、高度固定（portraitHeight 计算值），置于列表顶部。
 * 两种模式下 <video> 均 width/height 100% + objectFit: contain（保持视频比例）。
 */
function VideoPlayer({
  shotId,
  videoUrl,
  durationLabel,
  mode,
  portraitHeight,
  onClose,
}: {
  shotId: string
  videoUrl: string
  durationLabel: string
  mode: LayoutMode
  portraitHeight: number
  onClose: () => void
}) {
  // <video> 元素的真实时长优先于 storyboard durationS（后者常因 duration_sec 未映射为 0）
  const [realDur, setRealDur] = useState<number | null>(null)
  const isLandscape = mode === 'landscape'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      // landscape：宽度由父级 flex 控制（0 0 38%）、高度填满；portrait：宽度满、高度固定（计算值）
      ...(isLandscape
        ? { flex: '0 0 38%', minWidth: 360, maxWidth: 520, height: '100%', borderRight: `1px solid ${theme.border.default}` }
        : { width: '100%', flexShrink: 0, height: portraitHeight, borderTop: `1px solid ${theme.border.default}`, borderBottom: `1px solid ${theme.border.default}` }),
      background: theme.bg.panel,
    }}>
      {/* header：shotId + 时长 + ✕（两种模式均在顶部） */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 16px',
        borderBottom: `1px solid ${theme.border.dim}`,
      }}>
        <UiIcon kind="film" size={14} />
        <span style={{
          fontSize: 12, fontWeight: 600, color: theme.text.primary,
          fontFamily: 'var(--cv-font-mono, monospace)',
        }}>
          {shotId}
        </span>
        <span style={{ fontSize: 10, color: v3theme.modality.video, fontWeight: 600 }}>
          {realDur != null ? formatDuration(realDur) : durationLabel}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="关闭播放器"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '2px 7px', borderRadius: 3,
            color: theme.text.tertiary, fontSize: 13, lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      {/* <video> 居中填充；两种模式均 width/height 100% + objectFit: contain */}
      <div style={{ flex: 1, minHeight: 0, padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay
          playsInline
          onLoadedMetadata={(e) => {
            const d = (e.currentTarget as HTMLVideoElement).duration
            if (isFinite(d) && d > 0) setRealDur(d)
          }}
          style={{
            width: '100%', height: '100%', objectFit: 'contain',
            maxWidth: '100%', maxHeight: '100%',
            margin: '0 auto', borderRadius: 4,
            background: '#000',
            border: `1px solid ${theme.border.default}`,
          }}
        />
      </div>
    </div>
  )
}

/**
 * 横版占位框：未选中带视频的分镜时，播放器列（flex 0 0 38%）保留同尺寸占位，
 * 提示「点击分镜播放视频」。竖版无视频时直接不渲染播放器（节省空间）。
 */
function PlayerPlaceholder() {
  return (
    <div style={{
      flex: '0 0 38%', minWidth: 360, maxWidth: 520, height: '100%',
      display: 'flex', flexDirection: 'column',
      background: theme.bg.panel,
      borderRight: `1px solid ${theme.border.default}`,
    }}>
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, color: theme.text.tertiary,
      }}>
        <UiIcon kind="film" size={36} />
        <span style={{ fontSize: 13, fontWeight: 500, color: theme.text.secondary }}>▶ 点击分镜播放视频</span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>选中含 P11 视频的分镜自动播放</span>
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

  // 视频播放器：单击选中带 P11 视频的分镜即加载
  const [activeVideo, setActiveVideo] = useState<{ shotId: string; videoUrl: string; durationS: number } | null>(null)
  // 音频 mini 播放器：点击分镜音轨 chip 即加载
  const [activeAudio, setActiveAudio] = useState<AudioTrack | null>(null)

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

  // 统计
  const stats = useMemo(() => {
    const totalDurationSum = shots.reduce((sum, s) => sum + s.durationS, 0)
    const approved = shots.filter((s) => s.node.reviewStatus === 'approved').length
    const rejected = shots.filter((s) => s.node.reviewStatus === 'rejected').length
    const pending = shots.filter((s) => !s.node.reviewStatus || s.node.reviewStatus === 'pending').length
    const withThumbs = shots.filter((s) => s.thumbnail).length
    const withVideo = shots.filter((s) => s.videoUrl).length
    const withAudio = shots.filter((s) => s.audioTracks && s.audioTracks.length > 0).length
    const audioCount = shots.reduce((sum, s) => sum + (s.audioTracks?.length ?? 0), 0)
    const scores = shots.filter((s) => s.node.aiScore?.overall != null).map((s) => s.node.aiScore!.overall)
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    return { totalDurationSum, approved, rejected, pending, withThumbs, withVideo, withAudio, audioCount, avgScore, count: shots.length }
  }, [shots])

  // 查找 RF Node（用于打开详情面板）
  const nodes = useCanvasStore((s) => s.nodes)

  // 单击：只选中（高亮）+ 加载视频播放器（不弹详情）
  const selectShot = (shot: StoryboardShot) => {
    const rfNode = nodes.find((n) => n.id === shot.node.id)
    if (rfNode) setSelectedNode(rfNode)
    if (shot.videoUrl) {
      setActiveVideo({ shotId: shot.shotId, videoUrl: shot.videoUrl, durationS: shot.durationS })
    }
  }

  // 双击：额外打开右侧详情面板（在单击选中的基础上）
  const openDetail = (shot: StoryboardShot) => {
    const rfNode = nodes.find((n) => n.id === shot.node.id)
    if (rfNode) setDetailNode(rfNode)
  }

  // ─── 响应式：窗口尺寸 → 横/竖版布局 ──────────────────
  const [winSize, setWinSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }))
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const layoutMode: LayoutMode = detectLayout(winSize.w, winSize.h)
  const isLandscape = layoutMode === 'landscape'
  // 竖版播放器高度 = min(窗口宽 × 9/16, 280)
  const portraitPlayerH = Math.min(winSize.w * 9 / 16, 280)
  // 窄统计栏（<900）隐藏评分 / 审核 / 缩略图，只留核心数据
  const narrowStats = winSize.w < 900
  // 竖版分镜行紧凑：首尾帧 88px、chips 9px
  const compactRows = layoutMode === 'portrait'

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

  // ─── 播放器 + 分镜列表（横/竖版复用同一份 JSX） ──────────
  const player = activeVideo ? (
    <VideoPlayer
      shotId={activeVideo.shotId}
      videoUrl={resolveMediaUrl(activeVideo.videoUrl) ?? ''}
      durationLabel={formatDuration(activeVideo.durationS)}
      mode={layoutMode}
      portraitHeight={portraitPlayerH}
      onClose={() => setActiveVideo(null)}
    />
  ) : null

  const shotList = (
    <div style={{ flex: '1 1 auto', minWidth: 320, overflowY: 'auto' }}>
      {shots.map((shot, i) => (
        <ShotRow
          key={shot.node.id}
          shot={shot}
          index={i}
          total={shots.length}
          onClick={() => selectShot(shot)}
          onDoubleClick={() => openDetail(shot)}
          isSelected={detailNode?.id === shot.node.id}
          onAudioPlay={(track) => setActiveAudio(track)}
          activeAudioPath={activeAudio?.filePath ?? null}
          compact={compactRows}
        />
      ))}
    </div>
  )

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: theme.bg.canvas, overflow: 'hidden',
    }}>
      {/* ─── 统计概览栏 ─── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20,
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
        {!narrowStats && stats.avgScore != null && (
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
        {!narrowStats && (
          <>
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
          </>
        )}
        {stats.withVideo > 0 && (
          <>
            <div style={{ width: 1, height: 14, background: theme.border.default }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: theme.text.tertiary }}>视频</span>
              <span style={{ fontWeight: 600, color: v3theme.modality.video }}>{stats.withVideo}/{stats.count}</span>
            </div>
          </>
        )}
        {stats.audioCount > 0 && (
          <>
            <div style={{ width: 1, height: 14, background: theme.border.default }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: theme.text.tertiary }}>音轨</span>
              <span style={{ fontWeight: 600, color: v3theme.modality.audio }}>{stats.audioCount}</span>
            </div>
          </>
        )}
        {!narrowStats && (
          <>
            <span style={{ flex: 1 }} />
            <span style={{ color: theme.text.tertiary, fontSize: 11 }}>
              💡 单击播放视频，双击查看详情
            </span>
          </>
        )}
      </div>

      {/* 横版：播放器在左、分镜列表在右；竖版：播放器在顶、列表在下 */}
      {isLandscape ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* 左：播放器列（无视频时同尺寸占位） */}
          {activeVideo ? player : <PlayerPlaceholder />}
          {/* 右：分镜列表（占满剩余宽度） */}
          {shotList}
        </div>
      ) : (
        <>
          {/* 竖版：播放器在顶部（无视频不渲染，节省空间） */}
          {activeVideo && player}
          {/* 分镜列表（占满宽度） */}
          {shotList}
        </>
      )}

      {/* ─── 音频 mini 播放器（点击音轨 chip 滑出） ─── */}
      {activeAudio && (
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 16px',
          background: theme.bg.panel,
          borderTop: `1px solid ${theme.border.default}`,
        }}>
          <span style={{ fontSize: 13 }}>{audioIcon(activeAudio.clipType, activeAudio.audioType)}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: v3theme.modality.audio, whiteSpace: 'nowrap' }}>
            {activeAudio.audioType || activeAudio.clipType || '音频'}
            {activeAudio.speaker ? ` · ${activeAudio.speaker}` : ''}
          </span>
          <audio
            key={activeAudio.filePath}
            src={resolveMediaUrl(activeAudio.filePath) ?? ''}
            controls
            autoPlay
            style={{ height: 28, flex: 1, maxWidth: 480, minWidth: 160 }}
          />
          <button
            onClick={() => setActiveAudio(null)}
            title="关闭音频"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px 7px', borderRadius: 3,
              color: theme.text.tertiary, fontSize: 13, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

    </div>
  )
}
