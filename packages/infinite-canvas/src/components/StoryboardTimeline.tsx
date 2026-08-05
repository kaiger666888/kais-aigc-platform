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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { METADATA_LABELS } from '../constants'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { UiIcon } from './canvas/icons'
import { updateCanvasNode, updateAsset, convertProjectData } from '../services/canvasApi'
import { fetchProjectAssets } from './assetManager/useRealAssets'

// ─── 类型 ──────────────────────────────────────────────

/** P10 音频轨（voice / foley / bgm）描述。 */
interface AudioTrack {
  clipType: string // dialogue / ambient / sfx / bgm
  audioType: string // 人声 / 环境音 / 音效 / 背景音乐
  speaker?: string
  durationS: number
  filePath: string
  /** 对白/旁白原文（仅 voice 节点有；竖幅对白轨展示截断文字用）。 */
  text?: string
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
  /**
   * P11 首尾帧变体（phase_name='p11_first_last_frames'）：每组 v1/v2/v3 三张并排，
   * 用户点选最佳变体（三态：选定 ★ / 待选 ○ / 淘汰 ✕）。首帧尾帧各一组。
   */
  frameVariants?: { first: FrameVariant[]; last: FrameVariant[] }
}

/**
 * 首尾帧三态（复用 AssetLibrary 三态模型）：
 *   - selected   ★ 选定：每组仅一个，isPrimaryView=true
 *   - candidate  ○ 待选：同组备选变体
 *   - eliminated ✕ 淘汰：被新选定取代（点淘汰图可恢复为待选）
 */
type FrameCuration = 'selected' | 'candidate' | 'eliminated'

/** 单个首/尾帧变体（一个 p11_first_last_frames 节点）。 */
interface FrameVariant {
  nodeId: string
  /** v1 / v2 / v3。 */
  variant: string
  filePath: string
  thumbnailUrl?: string
  /** 从节点 data 派生的初始三态（isPrimaryView + tags/curationState）。 */
  initialCuration: FrameCuration
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

/**
 * 从任意 shot 标识（S01 / S01_B01 / s1_1 …）提取零填充 `S{NN}` 形式，
 * 用于把 storyboard/video shot 关联到首尾帧组（帧组以 shot_id=S01 为键）。
 * 取首个数字段：S01_B01 → S01、s1_1 → S01、S44 → S44。
 */
function paddedShotIdOf(shotId: string | null | undefined): string | null {
  if (!shotId) return null
  const m = shotId.match(/s?0*(\d+)/i)
  if (!m) return null
  return `S${String(Number(m[1])).padStart(2, '0')}`
}

/**
 * 从首尾帧节点的原始 data 袋派生初始三态。
 * 权威信号是 isPrimaryView（selected ⟺ isPrimaryView=true，每组仅一个）；
 * curationState='eliminated' 覆盖为淘汰。**不**用 tags 作回退——历史 tags（'★ 选定'）
 * 在点选后会与 isPrimaryView 失步（patch 改 isPrimaryView 不改 tags），用 tags 回退会
 * 把已退选的变体误判为选定（reload 后出现同组双选定）。默认 candidate。
 * 注意：节点的顶层 `state`（NodeState 枚举 success/failed…）不可复用为三态，
 * 故三态全部落在 data 内（isPrimaryView + curationState）。
 */
function deriveInitialCuration(raw: Record<string, unknown>): FrameCuration {
  // 用户手动选定之前，所有变体默认待选（不自动选 v1）
  return 'candidate'
}

/** 三态 → 同义 tags 标签（patch 时同步写回，保持 data 自洽可读）。 */
function curationTags(c: FrameCuration): string[] {
  if (c === 'selected') return ['★ 选定']
  if (c === 'eliminated') return ['✕ 淘汰']
  return ['○ 待选']
}

/**
 * 从 nodeId + rawDataByNodeId 中提取 assets-registry 的 assetId（数字主键）。
 * 三路 fallback：
 *   (1) data.assetId / data.asset_id（显式字段）
 *   (2) nodeId 格式 `asset-{id}`（V2 convert 产物）
 *   (3) data.name / data.label → 查 nameMap（keyframe 节点用 `S01_first_v1` 格式 ID）
 */
function assetIdOf(
  nodeId: string,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
  nameMap?: Map<string, number>,
): number | null {
  const raw = rawDataByNodeId?.get(nodeId) ?? {}
  const a = raw.assetId ?? raw.asset_id
  if (typeof a === 'number') return a
  if (typeof a === 'string') {
    const n = Number(a)
    if (!isNaN(n)) return n
  }
  // fallback 1: nodeId 格式 `asset-{id}`
  const m = nodeId.match(/^asset-(\d+)$/)
  if (m) return Number(m[1])
  // fallback 2: 通过 name/label 查 nameMap
  if (nameMap) {
    const name = (raw.name as string) ?? (raw.label as string) ?? null
    if (name) {
      // label 可能是 "S01 first v1"（有空格），normalize 为 "S01_first_v1"
      const normalized = name.replace(/\s+/g, '_')
      const aid = nameMap.get(normalized) ?? nameMap.get(name)
      if (aid != null) return aid
    }
  }
  return null
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
      // 对白/旁白原文（voice 节点 raw.text），竖幅对白轨展示截断文字
      text: (raw.text as string) ?? undefined,
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

  // Pass 5：P11 首尾帧变体（assetType='keyframe'）→ 按 {shotId}_{frameType} 分组。
  // 两种 data 格式兼容：
  //   (A) canvas-saved: data 含 frame_type/variant/groupKey/shot_id（经 patchFrameNode 写入）
  //   (B) convert 产物: data 含 assetType='keyframe'/viewAngle/label/characterId（原始 V2 convert）
  const frameGroups = new Map<string, { shotId: string; frameType: string; variants: FrameVariant[] }>()
  for (const node of graph.nodes) {
    if (node.kind !== 'asset') continue
    const raw = rawDataByNodeId?.get(node.id) ?? {}

    // 格式 A：显式帧变体字段
    let frameType = raw.frame_type as string | undefined
    let variant = raw.variant as string | undefined
    let groupKey = raw.groupKey as string | undefined
    let shotId = raw.shot_id as string | undefined

    // 格式 B：convert 产物 — 从 assetType/label 推断
    if ((!frameType || !variant || !groupKey || !shotId) && raw.assetType === 'keyframe') {
      const label = raw.label as string | undefined ?? ''
      const viewAngle = raw.viewAngle as string | undefined
      // label 格式: S01_first_v1 → shotId=S01, frameType=first, variant=v1
      const m = label.match(/^(S\d+)_(first|last)_(v\d+)$/i)
      if (m) {
        shotId = shotId ?? m[1]
        frameType = frameType ?? m[2].toLowerCase()
        variant = variant ?? m[3].toLowerCase()
        groupKey = groupKey ?? `${m[1]}_${m[2].toLowerCase()}`
      } else if (viewAngle) {
        // fallback: 用 characterId + viewAngle
        shotId = shotId ?? (raw.characterId as string)
        frameType = frameType ?? viewAngle.toLowerCase()
      }
    }

    if (!frameType || !variant || !groupKey || !shotId) continue
    if (frameType !== 'first' && frameType !== 'last') continue // 防御：仅 first/last
    let g = frameGroups.get(groupKey)
    if (!g) {
      g = { shotId, frameType, variants: [] }
      frameGroups.set(groupKey, g)
    }
    g.variants.push({
      nodeId: node.id,
      variant,
      filePath: (raw.filePath as string) ?? '',
      thumbnailUrl: raw.thumbnailUrl as string | undefined,
      initialCuration: deriveInitialCuration(raw),
    })
  }
  for (const g of frameGroups.values()) g.variants.sort((a, b) => a.variant.localeCompare(b.variant))

  // shot_id → { first, last } 变体组
  const variantsByShot = new Map<string, { first: FrameVariant[]; last: FrameVariant[] }>()
  for (const g of frameGroups.values()) {
    let entry = variantsByShot.get(g.shotId)
    if (!entry) {
      entry = { first: [], last: [] }
      variantsByShot.set(g.shotId, entry)
    }
    if (g.frameType === 'first') entry.first = g.variants
    else entry.last = g.variants
  }

  // 挂回已有 shot（按零填充 S{NN} 匹配 shot 标识）。
  // 注意：首尾帧 shot_id 是场景级（S01），storyboard 分镜是 S01_B01~B05。
  // paddedShotIdOf 把 S01_B01 → S01，导致同场景多个分镜都匹配到同一组帧变体。
  // 修复：每个帧变体组只挂到第一个匹配的分镜，避免重复。
  // 同时：当场景有首尾帧变体时，把该 shotId 从 S01_B01 改为 S01（场景级），
  // 并过滤掉同场景无变体的子分镜行（S01_B02~B05），避免显示废弃的分镜旧数据。
  const matchedShotIds = new Set<string>()
  const usedFrameGroups = new Set<string>() // 已挂载的帧组 shotId
  for (const shot of shots) {
    const sid = paddedShotIdOf(shot.shotId)
    if (!sid) continue
    if (usedFrameGroups.has(sid)) continue // 该帧组已挂到其他分镜，跳过
    const fv = variantsByShot.get(sid)
    if (fv && (fv.first.length || fv.last.length)) {
      shot.frameVariants = fv
      // 场景级帧变体 → shotId 改为场景标识（S01 而非 S01_B01）
      shot.shotId = sid
      matchedShotIds.add(sid)
      usedFrameGroups.add(sid)
    }
  }

  // 当某场景有首尾帧变体时，过滤掉同场景无变体的分镜子行（S01_B02~B05）。
  // 这些子行的数据来自旧 storyboard 快照（scene_ref 指向废弃的旧图片），
  // 会误导用户以为分镜仍使用旧素材。有变体覆盖的分镜行（S01_B01→已改名为 S01）保留。
  const filteredShots = shots.filter((shot) => {
    const sid = paddedShotIdOf(shot.shotId)
    // 该 shot 自身有变体 → 保留
    if (shot.frameVariants) return true
    // 该 shot 无变体，但同场景有变体 → 过滤（废弃子分镜）
    if (sid && usedFrameGroups.has(sid)) return false
    // 该 shot 无变体、同场景也无变体 → 保留（可能是真正无帧的分镜）
    return true
  })

  // 无 storyboard/video shot 但有首尾帧的 shot_id → 合成 shot
  // （本项目形态：仅有 264 张首尾帧、无分镜/视频节点，否则 extractShots 返回空）。
  // 代表节点取该 shot 的首帧 v1（首帧缺失退回尾帧首项），承载 state/reviewStatus 供行渲染。
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const [sid, fv] of variantsByShot) {
    if (matchedShotIds.has(sid)) continue
    const repNodeId = fv.first[0]?.nodeId ?? fv.last[0]?.nodeId
    const repNode = repNodeId ? nodeById.get(repNodeId) : undefined
    if (!repNode || repNode.kind !== 'asset') continue
    filteredShots.push({
      node: repNode,
      shotId: sid,
      durationS: 0,
      thumbnail: null,
      frameVariants: fv,
    })
  }

  // 替换 shots 为过滤后的列表
  shots.length = 0
  shots.push(...filteredShots)

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
      gap: 4,
      padding: compact ? '4px 9px' : '4px 11px',
      borderRadius: 6,
      fontSize: compact ? 13 : 14,
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

// ─── 首尾帧变体选择器（三态） ──────────────────────────

/**
 * 单个首/尾帧变体缩略（9:16 竖屏）。三态视觉：
 *   - selected ★   绿色边框 + ★ 角标
 *   - candidate ○  灰色边框 + ○ 角标
 *   - eliminated ✕ 半透明 + ✕ 覆盖
 * 点击：待选→选定（onSelect）；淘汰→恢复待选（onRestore）；选定→无操作。
 */
function FrameVariantThumb({
  v,
  curation,
  size,
  onSelect,
  onRestore,
}: {
  v: FrameVariant
  curation: FrameCuration
  size: number
  onSelect: (nodeId: string) => void
  onRestore: (nodeId: string) => void
}) {
  const url = resolveMediaUrl(v.thumbnailUrl ?? v.filePath)
  const isSelected = curation === 'selected'
  const isEliminated = curation === 'eliminated'
  return (
    <button
      data-testid="frame-variant"
      onClick={(e) => {
        e.stopPropagation()
        if (curation === 'eliminated') onRestore(v.nodeId)
        else if (curation === 'candidate') onSelect(v.nodeId)
        // selected → 无操作（如需取消选定，恢复淘汰池中的变体即可）
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={`${v.variant} · ${isSelected ? '选定' : isEliminated ? '淘汰（点击恢复为待选）' : '待选（点击选定，其余自动淘汰）'}`}
      style={{
        position: 'relative',
        width: size,
        flexShrink: 0,
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
      }}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '9 / 16',
        borderRadius: 4,
        overflow: 'hidden',
        border: `2px solid ${isSelected ? v3theme.signal.approved : isEliminated ? 'transparent' : theme.border.default}`,
        opacity: isEliminated ? 0.45 : 1,
        background: v3theme.surface.canvas,
        transition: 'border-color 0.15s, opacity 0.15s',
      }}>
        {url ? (
          <img
            src={url}
            alt={v.variant}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme.text.tertiary, fontSize: 9,
          }}>
            {v.variant}
          </div>
        )}
        {isEliminated && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: v3theme.signal.rejected, fontSize: size * 0.4, fontWeight: 700,
            background: 'rgba(0,0,0,0.45)',
          }}>✕</div>
        )}
      </div>
      {/* 三态角标 */}
      <span style={{
      position: 'absolute', top: 3, right: 3,
      fontSize: 16, lineHeight: 1, padding: '2px 5px', borderRadius: 4,
      background: 'rgba(0,0,0,0.72)',
      color: isSelected ? v3theme.signal.approved : isEliminated ? v3theme.signal.rejected : theme.text.secondary,
      }}>
      {isSelected ? '★' : isEliminated ? '✕' : '○'}
      </span>
      {/* variant 名 */}
      <span style={{
      position: 'absolute', bottom: 3, left: 3,
      fontSize: 11, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      background: 'rgba(0,0,0,0.6)', color: '#fff',
      fontFamily: 'var(--cv-font-mono, monospace)',
      }}>{v.variant}</span>
    </button>
  )
}

/**
 * 一组首/尾帧变体选择器（v1/v2/v3 并排）。curation 为本组各节点的当前三态覆盖表
 * （由 StoryboardTimeline 维护，点击乐观更新、不 reload）。
 */
function FrameVariantSelector({
  label,
  variants,
  curation,
  size,
  onSelect,
  onRestore,
}: {
  label: string
  variants: FrameVariant[]
  curation: Record<string, FrameCuration>
  size: number
  onSelect: (nodeId: string) => void
  onRestore: (nodeId: string) => void
}) {
  if (variants.length === 0) {
    return (
      <div style={{
        width: size * 3 + 8,
        display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
      }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: theme.text.tertiary, letterSpacing: 0.3 }}>{label}</div>
        <div style={{
          aspectRatio: '9 / 16', width: '100%', maxWidth: size + 6,
          borderRadius: 4, border: `1px dashed ${theme.border.dim}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: theme.text.tertiary, fontSize: 9,
        }}>
          无{label}
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.tertiary, letterSpacing: 0.3, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {variants.map((v) => (
          <FrameVariantThumb
            key={v.nodeId}
            v={v}
            curation={curation[v.nodeId] ?? v.initialCuration}
            size={size}
            onSelect={onSelect}
            onRestore={onRestore}
          />
        ))}
      </div>
    </div>
  )
}



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
  frameCuration,
  onSelectVariant,
  onRestoreVariant,
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
  /** 首尾帧三态覆盖表（nodeId → 三态），由 StoryboardTimeline 维护。 */
  frameCuration?: Record<string, FrameCuration>
  onSelectVariant?: (nodeId: string) => void
  onRestoreVariant?: (nodeId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(true)
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
        gap: 16,
        padding: '16px 24px',
        cursor: 'pointer',
        borderBottom: `1px solid ${theme.border.dim}`,
        background: isSelected
          ? 'rgba(86,184,154,0.08)'
          : hovered
            ? theme.bg.cardHover
            : 'transparent',
        borderLeft: isSelected ? `3px solid ${v3theme.signal.approved}` : '3px solid transparent',
        transition: 'background 120ms',
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 序号 */}
      <span style={{
        width: 44,
        flexShrink: 0,
        paddingTop: 8,
        textAlign: 'right',
        fontSize: 18,
        fontWeight: 700,
        color: v3theme.modality.image,
        fontFamily: 'var(--cv-font-mono, monospace)',
      }}>
        {index + 1}
      </span>

      {/* 首尾帧区：有 p11 变体时渲染三态选择器（v1/v2/v3 并排），否则退回单帧缩略盒 */}
      {shot.frameVariants && onSelectVariant && onRestoreVariant ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <FrameVariantSelector
            label="首帧"
            variants={shot.frameVariants.first}
            curation={frameCuration ?? {}}
            size={compact ? 84 : 112}
            onSelect={onSelectVariant}
            onRestore={onRestoreVariant}
          />
          <span style={{ color: theme.text.tertiary, fontSize: 20, flexShrink: 0 }}>→</span>
          <FrameVariantSelector
            label="尾帧"
            variants={shot.frameVariants.last}
            curation={frameCuration ?? {}}
            size={compact ? 84 : 112}
            onSelect={onSelectVariant}
            onRestore={onRestoreVariant}
          />
        </div>
      ) : (
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
      )}

      {/* 主体 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 时间信息 + 审核角标 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 16, fontWeight: 600, color: theme.text.primary,
          }}>
            <StateDot state={node.state} />
            <span style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}>{shot.shotId}</span>
          </span>
          <span style={{
            fontSize: 13, color: theme.text.tertiary,
            fontFamily: 'var(--cv-font-mono, monospace)',
          }}>
            {formatTime(shot.startSec)}→{formatTime(shot.endSec)}
            <span style={{ color: v3theme.modality.text, marginLeft: 4 }}>({formatDuration(shot.durationS)})</span>
          </span>
          <span style={{ flex: 1 }} />
          <ReviewBadge status={node.reviewStatus} />
          <ScoreBadge score={node.aiScore} />
        </div>

        {/* 元数据 chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: (promptSummary || audioTracks.length > 0) ? 6 : 0 }}>
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
            fontSize: 12, color: theme.text.tertiary, alignSelf: 'center',
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
            fontSize: 14,
            lineHeight: 1.6,
            color: theme.text.secondary,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}>
            {promptSummary}
          </div>
        )}

        {/* 首尾帧文字描述（默认展开；无帧图时为主要画面信息） */}
        {hasFrameDesc && (
          <div style={{ marginTop: 6, maxWidth: 420 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 12, color: theme.text.tertiary,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {expanded ? '▴ 收起首尾帧' : '▾ 首尾帧描述'}
            </button>
            {expanded && (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {shot.startFrameDesc && (
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: theme.text.secondary }}>
                    <span style={{ color: v3theme.modality.video, fontWeight: 700, marginRight: 6 }}>首</span>
                    {shot.startFrameDesc}
                  </div>
                )}
                {shot.endFrameDesc && (
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: theme.text.secondary }}>
                    <span style={{ color: v3theme.modality.video, fontWeight: 700, marginRight: 6 }}>尾</span>
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

// ─── 竖幅时间轴（VerticalTimeline） ──────────────────────

interface VerticalTimelineProps {
  shots: TimedShot[] // 复用父组件已计算的 shots（含 startSec/endSec/layoutDur）
  selectedNodeId: string | null // 当前 detailNode?.id
  onSelectShot: (shot: StoryboardShot) => void // 复用父组件 selectShot
  onAudioPlay: (track: AudioTrack) => void // 复用父组件 setActiveAudio
  activeAudioPath: string | null // 当前 activeAudio?.filePath
}

/** 竖幅时间轴：每秒高度（px）。值小 → 长分镜不至撑爆屏幕，便于纵观全局节奏。 */
const PX_PER_SEC = 14

/**
 * 音轨 → 轨道类别（对白 / 环境 / BGM / null）。按 clip_type / audio_type 关键词匹配。
 * 对白含 narration（旁白也走人声轨）。无法归类的返回 null（竖幅不展示）。
 */
function classifyAudioTrack(track: AudioTrack): 'dialogue' | 'ambient' | 'bgm' | null {
  const t = `${track.clipType} ${track.audioType}`.toLowerCase()
  if (/人声|dialogue|voice/.test(t)) return 'dialogue'
  if (/背景音乐|bgm|music/.test(t)) return 'bgm'
  if (/环境|ambient|sfx|effect|音效/.test(t)) return 'ambient'
  return null
}

/** 三类音轨视觉元信息（背景 / 激活背景 / 左边框 / 轨头标签）。 */
const TRACK_META = {
  dialogue: { bg: 'rgba(137,180,250,0.30)', bgActive: 'rgba(137,180,250,0.50)', border: '#89B4FA', label: '💬 对白' },
  ambient: { bg: 'rgba(166,227,161,0.25)', bgActive: 'rgba(166,227,161,0.45)', border: '#A6E3A1', label: '🔊 环境' },
  bgm: { bg: 'rgba(203,166,247,0.25)', bgActive: 'rgba(203,166,247,0.45)', border: '#CBA6F7', label: '🎵 BGM' },
} as const

/** 竖幅各列宽度（header 行与内容列严格对齐；bgm 列 flex 吸收右侧余量）。 */
const VT_COL = { time: 36, shot: 80, dialogue: 88, ambient: 60, bgm: 60 } as const
/** 分镜矩形按场景号循环的 4 模态色板（相邻 scene 不同色）。 */
const VT_SCENE_COLORS = [v3theme.modality.image, v3theme.modality.video, v3theme.modality.audio, v3theme.modality.text] as const
const VT_PANEL_W = 360
const VT_COLLAPSED_W = 44

/** 从 shotId 取场景号（首个数字段），用于分镜矩形交替着色。 */
function sceneNumOf(shotId: string): number {
  const m = shotId.match(/s?0*(\d+)/i)
  return m ? Number(m[1]) : 0
}

/** 累计总时长 → MM:SS（标题栏显示）。 */
function formatTotalDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 单条音轨矩形（对白/环境/BGM 共用）。绝对定位到所属 shot 的 startSec，高度 ∝ durationS。
 * 点击 → onAudioPlay（不做音频文件加载验证：磁盘 wav 可能 404，父组件 mini 播放器自然失败不崩）。
 * 同 shot 多条同类轨按 idx 向下偏移 16px 错开，避免完全重叠。
 */
function AudioTrackRect({
  shot,
  track,
  type,
  index,
  activeAudioPath,
  onAudioPlay,
}: {
  shot: TimedShot
  track: AudioTrack
  type: 'dialogue' | 'ambient' | 'bgm'
  index: number
  activeAudioPath: string | null
  onAudioPlay: (track: AudioTrack) => void
}) {
  const meta = TRACK_META[type]
  const width = VT_COL[type]
  const top = shot.startSec * PX_PER_SEC + index * 16
  const dur = track.durationS > 0 ? track.durationS : MIN_LAYOUT_DUR
  const height = Math.max(18, dur * PX_PER_SEC)
  const isActive = activeAudioPath === track.filePath
  const label = track.speaker ?? track.audioType ?? track.clipType ?? ''
  const title = [
    track.audioType || track.clipType || '音频',
    track.speaker ? track.speaker : '',
    formatDuration(track.durationS),
  ].filter(Boolean).join(' · ') + (track.text ? `\n${track.text}` : '')
  return (
    <button
      data-testid="vt-audio-rect"
      onClick={(e) => { e.stopPropagation(); onAudioPlay(track) }}
      title={title}
      style={{
        position: 'absolute',
        top,
        left: 2,
        width: width - 6,
        height,
        minHeight: 18,
        overflow: 'hidden',
        cursor: 'pointer',
        padding: '2px 14px 2px 5px',
        borderRadius: 3,
        textAlign: 'left',
        background: isActive ? meta.bgActive : meta.bg,
        border: `1px solid ${meta.border}`,
        borderLeft: `${isActive ? 3 : 2}px solid ${meta.border}`,
        color: '#fff',
      }}
    >
      {/* 文字：对白优先显示原文（截断 2 行），否则显示 speaker/audioType 标签 */}
      <div style={{
        fontSize: 9, fontWeight: 600, lineHeight: 1.25,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        wordBreak: 'break-word',
      }}>
        {track.text ? (
          <>
            {label && <span style={{ opacity: 0.9 }}>{label}： </span>}
            {track.text}
          </>
        ) : label}
      </div>
      {/* 小播放图标 */}
      <span style={{
        position: 'absolute', top: 3, right: 3,
        fontSize: 9, lineHeight: 1, opacity: 0.9,
      }}>▶</span>
      {height >= 30 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 8, opacity: 0.75,
          fontFamily: 'var(--cv-font-mono, monospace)',
        }}>{formatDuration(track.durationS)}</span>
      )}
    </button>
  )
}

/** 单条音轨列（对白/环境/BGM）。bgm 列 flex 吸收面板右侧余量。 */
function TrackLane({
  type,
  items,
  activeAudioPath,
  onAudioPlay,
}: {
  type: 'dialogue' | 'ambient' | 'bgm'
  items: Array<{ shot: TimedShot; track: AudioTrack }>
  activeAudioPath: string | null
  onAudioPlay: (track: AudioTrack) => void
}) {
  const containerStyle: CSSProperties = type === 'bgm'
    ? { flex: '1 1 auto', minWidth: VT_COL.bgm, position: 'relative', zIndex: 1 }
    : { width: VT_COL[type], position: 'relative', flexShrink: 0, zIndex: 1, borderRight: `1px solid ${theme.border.dim}` }
  return (
    <div style={containerStyle}>
      {items.map(({ shot, track }, i) => (
        <AudioTrackRect
          key={`${shot.node.id}-${i}`}
          shot={shot}
          track={track}
          type={type}
          index={i}
          activeAudioPath={activeAudioPath}
          onAudioPlay={onAudioPlay}
        />
      ))}
    </div>
  )
}

/**
 * 竖幅时间轴面板（页面右侧固定）。分镜 + 三类音轨按累计时间纵向铺开：
 *   - 时间刻度（每 5s 一标签 + 全宽水平网格线）
 *   - 分镜矩形（高度 ∝ 时长，最小 28px；按场景号循环 4 模态色；首帧缩略图作背景）
 *   - 对白 / 环境 / BGM 三轨（按 clipType/audioType 分类，高度 ∝ durationS）
 *
 * 可折叠：展开 360px（默认），折叠 44px 仅留标题栏 + 竖向「时间轴」文字。
 * 矩形/音轨均绝对定位对齐到 shot.startSec（父组件累计时间几何），整个内容区纵向滚动。
 */
function VerticalTimeline({
  shots,
  selectedNodeId,
  onSelectShot,
  onAudioPlay,
  activeAudioPath,
}: VerticalTimelineProps) {
  const [collapsed, setCollapsed] = useState(false)

  // 音轨按类别分桶（保留所属 shot，供定位 top = shot.startSec * PX_PER_SEC）
  const buckets = useMemo(() => {
    const dialogue: Array<{ shot: TimedShot; track: AudioTrack }> = []
    const ambient: Array<{ shot: TimedShot; track: AudioTrack }> = []
    const bgm: Array<{ shot: TimedShot; track: AudioTrack }> = []
    for (const shot of shots) {
      for (const track of shot.audioTracks ?? []) {
        const cls = classifyAudioTrack(track)
        if (cls === 'dialogue') dialogue.push({ shot, track })
        else if (cls === 'ambient') ambient.push({ shot, track })
        else if (cls === 'bgm') bgm.push({ shot, track })
      }
    }
    return { dialogue, ambient, bgm }
  }, [shots])

  const totalSec = shots.length ? shots[shots.length - 1].endSec : 0

  // 内容区高度：以 totalSec 为基线，短分镜最小高度可能让尾部超出，取两者 max
  const contentHeight = useMemo(() => {
    let h = totalSec * PX_PER_SEC
    for (const s of shots) {
      const bottom = s.startSec * PX_PER_SEC + Math.max(28, s.layoutDur * PX_PER_SEC)
      if (bottom > h) h = bottom
    }
    return Math.max(h, 60)
  }, [shots, totalSec])

  // 时间刻度：每 5s 一个标签
  const ticks = useMemo(() => {
    if (totalSec <= 0) return [0]
    const arr: number[] = []
    const max = Math.ceil(totalSec / 5) * 5
    for (let t = 0; t <= max; t += 5) arr.push(t)
    return arr
  }, [totalSec])

  // 折叠态：44px 窄轨，仅标题栏（▶ 展开）+ 竖向「时间轴」文字
  if (collapsed) {
    return (
      <div
        data-testid="vertical-timeline"
        style={{
          width: VT_COLLAPSED_W, height: '100%', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: theme.bg.panel,
          borderLeft: `1px solid ${theme.border.default}`,
        }}
      >
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '6px 0', borderBottom: `1px solid ${theme.border.dim}`,
        }}>
          <button
            onClick={() => setCollapsed(false)}
            title="展开竖幅时间轴"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
              borderRadius: 3, color: theme.text.secondary, fontSize: 13, lineHeight: 1,
            }}
          >▶</button>
        </div>
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          writingMode: 'vertical-rl', textOrientation: 'mixed',
          fontSize: 11, fontWeight: 600, letterSpacing: 2,
          color: theme.text.tertiary, userSelect: 'none',
        }}>
          竖幅时间轴
        </div>
      </div>
    )
  }

  const headerCellStyle: CSSProperties = {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: theme.text.secondary,
    fontWeight: 600,
    padding: '0 4px',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }
  const colBorder = { borderRight: `1px solid ${theme.border.dim}` }

  return (
    <div
      data-testid="vertical-timeline"
      style={{
        width: VT_PANEL_W, height: '100%', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: theme.bg.panel,
        borderLeft: `1px solid ${theme.border.default}`,
      }}
    >
      {/* 标题栏：折叠按钮 · 标题 · 分镜数 · 总时长 */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderBottom: `1px solid ${theme.border.default}`,
      }}>
        <button
          data-testid="vt-collapse"
          onClick={() => setCollapsed(true)}
          title="折叠"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
            borderRadius: 3, color: theme.text.secondary, fontSize: 11, lineHeight: 1,
          }}
        >▼</button>
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.text.primary }}>竖幅时间轴</span>
        <span style={{ fontSize: 10, color: theme.text.tertiary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
          · {shots.length} 分镜 · {formatTotalDuration(totalSec)}
        </span>
      </div>

      {/* 轨头标签行（24px，与内容列严格对齐） */}
      <div style={{
        flexShrink: 0, height: 24, display: 'flex',
        background: theme.bg.panel, borderBottom: `1px solid ${theme.border.default}`,
      }}>
        <div style={{ ...headerCellStyle, ...colBorder, width: VT_COL.time }}>时间</div>
        <div style={{ ...headerCellStyle, ...colBorder, width: VT_COL.shot }}>分镜</div>
        <div style={{ ...headerCellStyle, ...colBorder, width: VT_COL.dialogue }}>💬 对白</div>
        <div style={{ ...headerCellStyle, ...colBorder, width: VT_COL.ambient }}>🔊 环境</div>
        <div style={{ ...headerCellStyle, flex: '1 1 auto', minWidth: VT_COL.bgm }}>🎵 BGM</div>
      </div>

      {/* 滚动内容区 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ position: 'relative', height: contentHeight, display: 'flex' }}>
          {/* 水平网格线层（全宽，每 5s 一条） */}
          {ticks.map((t) => (
            <div key={`grid-${t}`} style={{
              position: 'absolute', top: t * PX_PER_SEC, left: 0, right: 0, height: 0,
              borderTop: `1px solid ${theme.border.dim}`, pointerEvents: 'none', zIndex: 0,
            }} />
          ))}

          {/* 时间刻度列（36px） */}
          <div style={{ width: VT_COL.time, position: 'relative', flexShrink: 0, ...colBorder, zIndex: 1 }}>
            {ticks.map((t) => (
              <span key={`tick-${t}`} style={{
                position: 'absolute', top: t * PX_PER_SEC - 5, left: 3,
                fontSize: 9, fontFamily: 'var(--cv-font-mono, monospace)',
                color: theme.text.tertiary, lineHeight: 1,
              }}>{t}s</span>
            ))}
          </div>

          {/* 分镜矩形轨（80px） */}
          <div style={{ width: VT_COL.shot, position: 'relative', flexShrink: 0, ...colBorder, zIndex: 1 }}>
            {shots.map((shot) => {
              const top = shot.startSec * PX_PER_SEC
              const height = Math.max(28, shot.layoutDur * PX_PER_SEC)
              const sceneIdx = Math.max(0, sceneNumOf(shot.shotId) - 1) % VT_SCENE_COLORS.length
              const color = VT_SCENE_COLORS[sceneIdx]
              const selected = shot.node.id === selectedNodeId
              const thumb = resolveMediaUrl(shot.firstFrame ?? shot.thumbnail)
              return (
                <button
                  key={shot.node.id}
                  data-testid="vt-shot-rect"
                  onClick={() => onSelectShot(shot)}
                  title={`${shot.shotId} · ${formatTime(shot.startSec)}→${formatTime(shot.endSec)} (${formatDuration(shot.durationS)})`}
                  style={{
                    position: 'absolute', top, left: 2,
                    width: VT_COL.shot - 6, height,
                    overflow: 'hidden', cursor: 'pointer', padding: 0,
                    borderRadius: 4,
                    border: selected ? `2px solid ${v3theme.signal.approved}` : `1px solid ${theme.border.default}`,
                    background: thumb ? `${color}22` : `${color}33`,
                    boxShadow: selected ? `0 0 0 1px ${v3theme.signal.approved}55` : 'none',
                    transition: 'border-color 120ms',
                  }}
                  onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.borderColor = theme.border.strong }}
                  onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.borderColor = theme.border.default }}
                >
                  {/* 首帧缩略图作背景（opacity 0.5） */}
                  {thumb && (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', opacity: 0.5, display: 'block',
                      }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                  )}
                  {/* 文字可读性渐变叠层 */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.5) 100%)',
                    pointerEvents: 'none',
                  }} />
                  <span style={{
                    position: 'relative', display: 'block',
                    padding: '3px 5px',
                    fontSize: 9, fontWeight: 700, color: '#fff',
                    fontFamily: 'var(--cv-font-mono, monospace)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    lineHeight: 1.2,
                  }}>{shot.shotId}</span>
                </button>
              )
            })}
          </div>

          {/* 三类音轨列（对白 88 / 环境 60 / BGM 60→flex） */}
          <TrackLane type="dialogue" items={buckets.dialogue} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} />
          <TrackLane type="ambient" items={buckets.ambient} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} />
          <TrackLane type="bgm" items={buckets.bgm} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} />
        </div>
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
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const showToast = useCanvasStore((s) => s.showToast)

  // 视频播放器：单击选中带 P11 视频的分镜即加载
  const [activeVideo, setActiveVideo] = useState<{ shotId: string; videoUrl: string; durationS: number } | null>(null)
  // 音频 mini 播放器：点击分镜音轨 chip 即加载
  const [activeAudio, setActiveAudio] = useState<AudioTrack | null>(null)
  /**
   * 首尾帧三态覆盖表（nodeId → 三态）。本地乐观状态为会话内权威源——点选只改这张表，
   * 不触碰 store.graph（任何 graph 变更都会经 useMemo 重跑 extractShots 全量重建列表 → 闪烁）。
   * 后端 PATCH 异步落库（node:updated 不触发前端重载），失败时回滚覆盖并 toast。
   */
  const [frameCuration, setFrameCuration] = useState<Record<string, FrameCuration>>({})

  const baseShots = useMemo(() => extractShots(graph, rawDataByNodeId), [graph, rawDataByNodeId])

  /**
   * 独立帧数据加载：当 canvas graph 中没有帧变体时（savedGraph 只保存了角色等部分节点），
   * 直接从 convert API 拉取全量节点，提取 keyframe 节点构建额外的 shots。
   * 这解决了 load-v2 savedGraph 只有 8 个角色节点、首尾帧节点缺失的问题。
   */
  const [extraFrameShots, setExtraFrameShots] = useState<StoryboardShot[]>([])
  // 存储 convert API 的 extraRaw 数据，供 assets sync effect 使用
  // （store 的 rawDataByNodeId 不包含 convert 返回的节点）
  const extraRawRef = useRef<Map<string, Record<string, unknown>> | null>(null)
  const hasFrameVariants = baseShots.some((s) => s.frameVariants && (s.frameVariants.first.length || s.frameVariants.last.length))
  useEffect(() => {
    if (hasFrameVariants || !projectId || !episodesId) return
    let cancelled = false
    void (async () => {
      try {
        const converted = await convertProjectData(projectId, episodesId)
        if (cancelled || !converted?.nodes?.length) return
        // 构建 rawDataByNodeId map
        const extraRaw = new Map<string, Record<string, unknown>>()
        for (const n of converted.nodes) {
          if (n.id && n.data) extraRaw.set(n.id, n.data as Record<string, unknown>)
        }
        extraRawRef.current = extraRaw
        // 构建临时 V3-shaped graph
        const tempGraph = {
          ...converted,
          nodes: converted.nodes.map((n) => ({
            id: n.id,
            kind: 'asset' as const,
            stage: (n.data as Record<string, unknown>)?.assetType ?? 'global',
            meta: {},
            media: {},
            content: null,
            reviewStatus: null,
            aiScore: null,
          })),
        } as unknown as FlowGraphV3
        const shots = extractShots(tempGraph, extraRaw)
        if (!cancelled && shots.length > 0) setExtraFrameShots(shots)
      } catch {
        // 静默
      }
    })()
    return () => { cancelled = true }
  }, [hasFrameVariants, projectId, episodesId])

  // 合并 baseShots + extraFrameShots
  const allBaseShots = useMemo(() => {
    if (extraFrameShots.length === 0) return baseShots
    // 去重：按 shotId
    const existingIds = new Set(baseShots.map((s) => s.shotId))
    const extras = extraFrameShots.filter((s) => !existingIds.has(s.shotId))
    return [...baseShots, ...extras]
  }, [baseShots, extraFrameShots])

  /**
   * 从 assets-registry (o_assets) 同步权威三态。
   *
   * Canvas 节点的 isPrimaryView/curationState 是 convert 时的一次性快照，不会因用户在
   * 资产管理器中的操作而更新。资产管理器直接 PATCH o_assets 表（isPrimaryView + state），
   * 所以此处从 o_assets 拉取最新值，覆盖 frameCuration 的初始态，确保两处一致。
   * 只在 graph 加载完成且有帧变体时跑一次（projectId 变化也重跑）。
   */
  // extraFrameShots 变化时重置 assetsSynced，让三态同步重新跑
  useEffect(() => { setAssetsSynced(false) }, [extraFrameShots])

  const [assetsSynced, setAssetsSynced] = useState(false)
  useEffect(() => {
    if (!projectId || assetsSynced) return
    // 收集所有帧变体 nodeId
    const variantNodeIds: string[] = []
    for (const shot of allBaseShots) {
      if (!shot.frameVariants) continue
      for (const v of [...shot.frameVariants.first, ...shot.frameVariants.last]) {
        variantNodeIds.push(v.nodeId)
      }
    }
    if (variantNodeIds.length === 0) return

    let cancelled = false
    void (async () => {
      try {
        const assets = await fetchProjectAssets(projectId)
        if (cancelled) return
        // assetId → { isPrimaryView, state } 映射
        const map = new Map<number, { isPrimaryView: boolean; state: string }>()
        // name → assetId 映射（用于 keyframe 节点 fallback 查找）
        const nameMap = new Map<string, number>()
        for (const a of assets) {
          map.set(a.id, {
            isPrimaryView: !!a.isPrimaryView,
            state: a.state ?? 'active',
          })
          if (a.name) nameMap.set(a.name, a.id)
        }
        // 用 o_assets 数据覆盖三态
        const curationUpdate: Record<string, FrameCuration> = {}
        // 合并 store rawDataByNodeId + extraRawRef（convert API 返回的节点 raw）
        const mergedRaw = new Map(rawDataByNodeId ?? [])
        if (extraRawRef.current) {
          for (const [k, v] of extraRawRef.current) mergedRaw.set(k, v)
        }
        for (const nodeId of variantNodeIds) {
          const aid = assetIdOf(nodeId, mergedRaw, nameMap)
          if (aid == null) continue
          const a = map.get(aid)
          if (!a) continue
          // 用户手动选定前，全部默认待选（不自动选 v1）
          if (a.state === 'eliminated') curationUpdate[nodeId] = 'eliminated'
          else curationUpdate[nodeId] = 'candidate'
        }
        if (Object.keys(curationUpdate).length > 0 && !cancelled) {
          setFrameCuration((prev) => ({ ...prev, ...curationUpdate }))
        }
        setAssetsSynced(true)
      } catch {
        // 后端不可达时静默——退回 canvas 节点派生的初始三态
      }
    })()
    return () => { cancelled = true }
  }, [projectId, allBaseShots, rawDataByNodeId, assetsSynced])

  // 计算累计起止时间 → 时间轴几何
  const shots = useMemo<TimedShot[]>(() => {
    let cum = 0
    return allBaseShots.map((s) => {
      const layoutDur = s.durationS > 0 ? s.durationS : MIN_LAYOUT_DUR
      const startSec = cum
      cum += layoutDur
      return { ...s, startSec, endSec: startSec + layoutDur, layoutDur }
    })
  }, [allBaseShots])

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

  // nodeId → 同组（同 shot 的 first 或 last 集合）所有变体。三态流转需按组淘汰旧选定。
  const frameGroupOfNode = useMemo(() => {
    const m = new Map<string, FrameVariant[]>()
    for (const s of shots) {
      if (!s.frameVariants) continue
      for (const arr of [s.frameVariants.first, s.frameVariants.last]) {
        if (arr.length) for (const v of arr) m.set(v.nodeId, arr)
      }
    }
    return m
  }, [shots])

  // 查找 RF Node（用于打开详情面板）
  const nodes = useCanvasStore((s) => s.nodes)

  /**
   * 把单帧节点的三态写回后端：PATCH /canvas/v2/nodes/:nodeId，updates.data 为完整 data 袋
   * （顶层浅合并会整体替换 data）。从 store 的 rawDataByNodeId 取原始 data 叠加三态字段
   * （isPrimaryView + curationState + 同步刷新 tags，保持 data 自洽可读）。
   * 不 reload、不 toast —— 失败由调用方回滚本地覆盖并提示。
   *
   * 同时同步 o_assets 表（PATCH /v1/assets-registry/{assetId}），确保资产管理器与时间轴一致。
   */
  const patchFrameNode = useCallback(async (
    nodeId: string,
    curation: FrameCuration,
  ) => {
    if (!projectId || !episodesId) throw new Error('未选择项目/剧集')
    const raw = useCanvasStore.getState().rawDataByNodeId?.get(nodeId) ?? {}
    const isPrimary = curation === 'selected'
    const curationState = curation === 'eliminated' ? 'eliminated' : 'active'
    // 写 canvas 节点
    await updateCanvasNode(projectId, episodesId, nodeId, {
      data: { ...raw, isPrimaryView: isPrimary, curationState, tags: curationTags(curation) },
    })
    // 同步 o_assets（assetId 从 raw 中取）
    const aid = assetIdOf(nodeId, useCanvasStore.getState().rawDataByNodeId)
    if (aid != null) {
      try {
        await updateAsset(aid, {
          isPrimaryView: isPrimary,
          state: curationState === 'eliminated' ? 'eliminated' : 'active',
        })
      } catch {
        // o_assets 更新失败不阻断——canvas 节点已更新，下次 assets sync 会自愈
      }
    }
  }, [projectId, episodesId])

  /** 当前三态：本地覆盖优先，否则取节点派生初始值。 */
  const curationOf = useCallback((v: FrameVariant): FrameCuration =>
    frameCuration[v.nodeId] ?? v.initialCuration, [frameCuration])

  // 待选→选定：新选置 selected，同组其余全部 → eliminated。乐观更新 + 异步落库 + 失败回滚。
  const handleSelectVariant = useCallback((nodeId: string) => {
    const group = frameGroupOfNode.get(nodeId)
    if (!group) return
    // 同组其余全部淘汰（无论之前是选定还是待选）
    const others = group.filter((v) => v.nodeId !== nodeId)

    // 乐观更新本地覆盖（不触发 graph 重建 → 不闪烁）
    setFrameCuration((prev) => {
      const next = { ...prev, [nodeId]: 'selected' as FrameCuration }
      for (const v of others) next[v.nodeId] = 'eliminated'
      return next
    })

    void (async () => {
      try {
        await patchFrameNode(nodeId, 'selected')
        for (const v of others) await patchFrameNode(v.nodeId, 'eliminated')
      } catch (err) {
        showToast('帧选择保存失败: ' + (err as Error).message, 'error')
        // 回滚本地覆盖
        setFrameCuration((prev) => {
          const next = { ...prev }
          delete next[nodeId]
          for (const v of others) delete next[v.nodeId]
          return next
        })
      }
    })()
  }, [frameGroupOfNode, patchFrameNode, showToast])

  // 淘汰→待选：恢复为 candidate。乐观 + 异步落库 + 失败回滚。
  const handleRestoreVariant = useCallback((nodeId: string) => {
    setFrameCuration((prev) => ({ ...prev, [nodeId]: 'candidate' as FrameCuration }))
    void (async () => {
      try {
        await patchFrameNode(nodeId, 'candidate')
      } catch (err) {
        showToast('恢复失败: ' + (err as Error).message, 'error')
        setFrameCuration((prev) => {
          const next = { ...prev }
          delete next[nodeId]
          return next
        })
      }
    })()
  }, [patchFrameNode, showToast])


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
          frameCuration={frameCuration}
          onSelectVariant={handleSelectVariant}
          onRestoreVariant={handleRestoreVariant}
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

      {/* 主体：左=播放器+分镜列表（占满剩余宽度），右=竖幅时间轴（固定宽度，可折叠） */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: isLandscape ? 'row' : 'column', minWidth: 0 }}>
          {isLandscape ? (
            <>
              {/* 左：播放器列（无视频时同尺寸占位） */}
              {activeVideo ? player : <PlayerPlaceholder />}
              {/* 右：分镜列表（占满剩余宽度） */}
              {shotList}
            </>
          ) : (
            <>
              {/* 竖版：播放器在顶部（无视频不渲染，节省空间） */}
              {activeVideo && player}
              {/* 分镜列表（占满宽度） */}
              {shotList}
            </>
          )}
        </div>
        {/* 竖幅时间轴（右侧固定面板） */}
        <VerticalTimeline
          shots={shots}
          selectedNodeId={detailNode?.id ?? null}
          onSelectShot={selectShot}
          onAudioPlay={(track) => setActiveAudio(track)}
          activeAudioPath={activeAudio?.filePath ?? null}
        />
      </div>

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
