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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { METADATA_LABELS } from '../constants'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { UiIcon } from './canvas/icons'
import { convertProjectData } from '../services/canvasApi'
import { fetchProjectAssets } from './assetManager/useRealAssets'

// ─── 类型 ──────────────────────────────────────────────

/** P10 音频轨（voice / foley / bgm）描述。 */
interface AudioTrack {
  clipType: string // dialogue / ambient / sfx / bgm
  audioType: string // 人声 / 环境音 / 音效 / 背景音乐
  speaker?: string
  /** 说话人展示名（raw.speaker_label，"说话人0"…）；竖幅对白说话人 lane tooltip 用。 */
  speakerLabel?: string
  durationS: number
  filePath: string
  /** 对白/旁白原文（仅 voice 节点有；竖幅对白轨展示截断文字用）。 */
  text?: string
  /** 播放窗口（[start, end] 秒）— Demucs stem 按分镜片段播放用；P10 轨无窗口（全曲播）。 */
  windowSec?: [number, number]
  /**
   * 绝对时间窗起点/终点（秒）—— 波形活动段数据（逆推项目 P10 重建形态）。
   * 时间是**全片绝对时间**，与分镜行 startSec/endSec 同坐标系：长段（BGM 106.5-135.5s）
   * 可横跨多个分镜行。两者均为 undefined 时走旧 shotKey 行内挂载（管线项目回归不变）。
   */
  startSec?: number
  endSec?: number
}

/**
 * 音轨是否携带绝对时间窗（start_sec/end_sec）→ 竖幅按时间坐标跨镜渲染。
 * 缺一个字段 / 非有限数 / 零长度即视为无窗（回退 shotKey 行内挂载）。
 */
export function hasSpanWindow(track: AudioTrack): boolean {
  return (
    typeof track.startSec === 'number' && isFinite(track.startSec) &&
    typeof track.endSec === 'number' && isFinite(track.endSec) &&
    track.endSec > track.startSec
  )
}

/** Demucs 4-stem（逆推资产集项目 storyboard data.audioStems 穯透）。 */
interface AudioStems {
  vocals?: string
  drums?: string
  bass?: string
  other?: string
}

/** stem 名 → 展示元信息（颜色对齐 TRACK_META 三轨色系 + 补 drums 独立色）。 */
const STEM_META: Record<string, { color: string; label: string }> = {
  vocals: { color: '#89B4FA', label: 'vocals 人声' },
  drums: { color: '#F9E2AF', label: 'drums 鼓' },
  bass: { color: '#A6E3A1', label: 'bass 贝斯' },
  other: { color: '#CBA6F7', label: 'other 其他' },
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
  /**
   * 原片片段（逆推资产集项目）：storyboard data.clipPath（原片 mp4 的 /oss/ 原样路径，
   * 含全角括号/空格——播放时 encodeURI）+ start_sec/end_sec 片段窗口。
   * 与 videoUrl（P11 单镜成片）互斥优先：clipPath 走片段播放器（#t=start,end）。
   */
  clipPath?: string | null
  /** 逆推富化键：首帧 jpg 原样路径（keyframe reverse 产物）。 */
  firstFrameUrl?: string | null
  /** 逆推富化键：尾帧 jpg 原样路径。 */
  lastFrameUrl?: string | null
  /** 原片内片段起止（秒）——clipPath 存在时用于 seek/暂停窗口。 */
  clipStartSec?: number
  clipEndSec?: number
  /** Demucs 4-stem 音轨路径（逆推资产集项目；无则不渲染 stem mini 轨）。 */
  audioStems?: AudioStems
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
 *
 * 两遍扫描：第一遍对**全部**候选跑 beat 正则（管线项目行为逐字节不变）；仅当全部
 * miss 时第二遍回退 paddedShotIdOf 场景键（`S001`→`S01`）—— 逆推资产集项目的
 * shot_id 是纯场景号（无 beat 段），storyboard（`a-shot_list-S001`）与 audio
 * （`a-aud_S001_dialogue`）两侧同走此回退即可对上（修竖幅三音轨列恒空）。
 * 场景键零填充 `S{NN}` 与 beat 键 `s{n}_{m}` 形制不同，永不相撞；场景号 >99 时
 * padStart(2) 仍产 3 位（S100 ≠ S10），亦无碰撞。
 */
export function shotKeyFromCandidates(...candidates: Array<unknown>): string | null {
  // Pass 1：beat 形式（S01_B01 → s1_1）—— 先扫全候选，任一命中即返回
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue
    const norm = c.toLowerCase().replace(/\s+/g, '_')
    const m = norm.match(/s0*(\d+)_[a-z]*0*(\d+)/)
    if (m) return `s${m[1]}_${m[2]}`
  }
  // Pass 2（回退）：纯场景号（S001 / s12）→ 零填充场景键（S01 / S12）
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue
    const scene = paddedShotIdOf(c)
    if (scene) return scene
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

/**
 * 资产名去噪归一（查 nameMap 用）：去空白 + 去「帧」字。
 * o_assets 注册名 "S01_B01 first帧 v1" ↔ canvas label "S01_B01 first v1" 归一后同为
 * "S01_B01firstv1"，两侧一致才能把注册表策展（isPrimaryView）同步回时间轴。
 */
function normalizeAssetName(s: string): string {
  return s.replace(/\s+/g, '').replace(/帧/g, '')
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
      // label 可能是 "S01 first v1"（有空格），normalize 为 "S01_first_v1"。
      // 再备一版去「帧」归一：o_assets 侧注册名是 "S01_B01 first帧 v1"（含帧字），
      // canvas label 无帧字——两侧同走 normalizeAssetName 才能对上（修注册表策展
      // 同步不回时间轴：beat 级帧组永远 candidate → 时间轴恒显「未选定」）。
      const normalized = name.replace(/\s+/g, '_')
      const aid = nameMap.get(normalized) ?? nameMap.get(name)
        ?? nameMap.get(normalizeAssetName(name))
      if (aid != null) return aid
    }
  }
  return null
}

export function extractShots(graph: FlowGraphV3 | null, rawDataByNodeId: Map<string, Record<string, unknown>> | null): StoryboardShot[] {
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
      // 逆推资产集：原片片段窗口 + Demucs stems（富化脚本写入；缺席时 undefined → 行为不变）
      clipPath: typeof raw.clipPath === 'string' && raw.clipPath ? raw.clipPath : undefined,
      firstFrameUrl: typeof raw.firstFrameUrl === 'string' && raw.firstFrameUrl ? raw.firstFrameUrl : undefined,
      lastFrameUrl: typeof raw.lastFrameUrl === 'string' && raw.lastFrameUrl ? raw.lastFrameUrl : undefined,
      clipStartSec: typeof raw.start_sec === 'number' ? raw.start_sec : undefined,
      clipEndSec: typeof raw.end_sec === 'number' ? raw.end_sec : undefined,
      audioStems:
        raw.audioStems && typeof raw.audioStems === 'object'
          ? (raw.audioStems as AudioStems)
          : undefined,
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

    // Pass 3.5（逆推资产集）：富化键兜底——本项目无 P11 video / frame_last 节点，
    // 首尾帧直接取 storyboard data 的 firstFrameUrl / lastFrameUrl（keyframe jpg）。
    if (!shot.firstFrame && shot.firstFrameUrl) shot.firstFrame = shot.firstFrameUrl
    if (!shot.lastFrame && shot.lastFrameUrl) shot.lastFrame = shot.lastFrameUrl

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

  // Pass 4：P10 音频节点（voice / foley / bgm）→ 按 shotKey 建映射，挂回分镜
  // 不能仅靠 migrate 后的 node.kind/stage/modality 判定音频节点——
  //   ① load-v2 返回的 audio 节点经迁移后 kind 可能不是 'asset'（落入事件/其他类），
  //      旧判断 `node.kind !== 'asset' → continue` 会把它们整批跳过；
  //   ② modality/stage 也可能因 audioType 是中文（"人声"）等而未落到 'audio'/'voice'。
  //   故优先用 rawDataByNodeId 的原始 V2 字段（clip_type / audio_type / audio_path /
  //   音频扩展名）识别，再回退到 modality/stage 判断，确保全部对白都能被拾取
  //   （修「时间轴音轨只显示 1 条、实际 7 条」）。DialoguePanel 走同源逻辑证明 raw 数据齐全。
  const audioByShot = new Map<string, AudioTrack[]>()
  // 场景级（S01）音频聚合：分镜级对白常挂在 beat（S01_B04）上，而首尾帧变体会把同场景
  // 多个 beat 折叠成单个场景行（S01），beat 级 shotKey 挂载的对白会随被过滤的子分镜丢失。
  // 此聚合用于折叠后回挂到场景行，确保对白不被首尾帧折叠吞掉（修音轨只显示 1 条）。
  const audioByScene = new Map<string, AudioTrack[]>()
  let dbgAudioTotal = 0   // 识别为音频的节点数（含无 shotKey 的）
  let dbgAudioMatched = 0 // 成功解析出 shotKey 并挂载的节点数
  for (const node of graph.nodes) {
    const raw = rawDataByNodeId?.get(node.id) ?? {}
    // node 可能是 event（无 media）—— 仅 asset 取 media 兜底字段
    const media = node.kind === 'asset' ? node.media : undefined
    const filePath = (raw.filePath as string) ?? media?.original ?? null
    // 优先：原始 data 字段命中音频信号（clip_type / audio_type / audio_path / 音频文件扩展名）
    const isAudioByRaw = !!(
      raw.clip_type ||
      raw.audio_type ||
      raw.audioType ||
      raw.audio_path ||
      (filePath && /\.(wav|mp3|aac|flac|ogg|m4a|webm)$/i.test(filePath))
    )
    // 回退：migrate 后的 modality/stage（兼容仅有元数据、raw 缺字段的节点）
    const isAudioByMeta =
      node.kind === 'asset' &&
      (node.modality === 'audio' || node.stage === 'voice' || node.stage === 'foley' || node.stage === 'bgm')
    if (!isAudioByRaw && !isAudioByMeta) continue
    dbgAudioTotal++
    if (!filePath) continue
    const key = shotKeyFromCandidates(raw.shot_id, raw.label, node.id, filePath)
    if (!key) continue
    dbgAudioMatched++
    // 波形活动段绝对时间窗（逆推项目重建形态）：有限数才透传，否则保持 undefined
    // → 竖幅回退旧 shotKey 行内挂载（管线项目行为逐字节不变）。
    const rawStart = raw.start_sec
    const rawEnd = raw.end_sec
    const startSec = typeof rawStart === 'number' && isFinite(rawStart) ? rawStart : undefined
    const endSec = typeof rawEnd === 'number' && isFinite(rawEnd) ? rawEnd : undefined
    const track: AudioTrack = {
      clipType: (raw.clip_type as string) ?? '',
      audioType: (raw.audio_type as string) ?? (raw.audioType as string) ?? '',
      // speaker 仅人声有意义；'none' / 'null' / 空 视为无
      speaker: normalizeSpeaker(raw.speaker as string),
      // 说话人展示名（"说话人0"…）；仅有效 speaker 时透传
      speakerLabel: typeof raw.speaker_label === 'string' && raw.speaker_label.trim()
        ? raw.speaker_label
        : undefined,
      // duration_sec 缺失时用时间窗宽度兜底（活动段文件即按窗切出，二者等价）
      durationS: (raw.duration_sec as number) ?? media?.durationS
        ?? (startSec != null && endSec != null ? endSec - startSec : 0),
      filePath,
      // 对白/旁白原文（voice 节点 raw.text），竖幅对白轨展示截断文字
      text: (raw.text as string) ?? undefined,
      ...(startSec != null && endSec != null ? { startSec, endSec } : {}),
    }
    const arr = audioByShot.get(key)
    if (arr) arr.push(track)
    else audioByShot.set(key, [track])
    // 同时按场景（S01）聚合：beat 级对白（S01_B04 → s1_4）回挂到折叠后的场景行用
    const sceneId = paddedShotIdOf((raw.shot_id as string) ?? (raw.label as string))
    if (sceneId) {
      const s = audioByScene.get(sceneId)
      if (s) s.push(track)
      else audioByScene.set(sceneId, [track])
    }
  }
  for (const shot of shots) {
    if (shot.shotKey) {
      const tracks = audioByShot.get(shot.shotKey)
      if (tracks && tracks.length) shot.audioTracks = tracks
    }
  }
  // 调试日志：确认 V3 graph 中拾取到的音频节点数与命中 shotKey 的数。
  // （修「音轨只显示 1 条」时定位用——期望 detected=7、matchedShotKey=7）
  if (dbgAudioTotal > 0) {
    // eslint-disable-next-line no-console
    console.debug('[StoryboardTimeline] Pass4 audio', {
      detected: dbgAudioTotal,
      matchedShotKey: dbgAudioMatched,
      shotsWithAudio: shots.filter((s) => s.audioTracks && s.audioTracks.length).length,
      totalTracks: shots.reduce((n, s) => n + (s.audioTracks?.length ?? 0), 0),
    })
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

  // 挂回已有 shot（两级）：
  //   ① beat 级精确挂载 —— 帧组 shot_id 是 beat 形（S01_B01），按 shotKey 归一后挂到
  //      同 beat 的分镜行，不折叠不改名（各行展示各自组内已选定的条件帧）。
  //   ② 场景级折叠挂载（回退）—— 帧组 shot_id 是纯场景号（S001，逆推资产集项目），
  //      挂到该场景第一个 beat 行并改名为场景标识，随后过滤掉同场景无变体的子分镜行
  //      （S01_B02~B05 旧快照行），避免显示废弃的分镜旧数据。
  // 归一化键：beat 形走 shotKeyFromCandidates（s1_1），场景形走 paddedShotIdOf（S01），
  // 两形制不同永不相撞。
  const normGroupKey = (rawSid: string | undefined): string | null => {
    if (!rawSid) return null
    return shotKeyFromCandidates(rawSid) ?? paddedShotIdOf(rawSid)
  }
  const variantsByNorm = new Map<string, { shotId: string; first: FrameVariant[]; last: FrameVariant[] }>()
  for (const [rawSid, fv] of variantsByShot) {
    const k = normGroupKey(rawSid)
    if (k && !variantsByNorm.has(k)) variantsByNorm.set(k, { shotId: rawSid, ...fv })
  }
  const matchedShotIds = new Set<string>()
  const usedFrameGroups = new Set<string>() // 已挂载的帧组归一键
  // ① beat 级精确挂载
  for (const shot of shots) {
    const key = shotKeyFromCandidates(shot.shotId, shot.node.id)
    if (!key || usedFrameGroups.has(key)) continue
    const entry = variantsByNorm.get(key)
    if (entry && (entry.first.length || entry.last.length)) {
      shot.frameVariants = { first: entry.first, last: entry.last }
      matchedShotIds.add(key)
      usedFrameGroups.add(key)
    }
  }
  // ② 场景级折叠挂载（仅未被 ① 命中的帧组；改名为场景标识并标记折叠）
  for (const shot of shots) {
    if (shot.frameVariants) continue
    const sid = paddedShotIdOf(shot.shotId)
    if (!sid || usedFrameGroups.has(sid)) continue
    const entry = variantsByNorm.get(sid)
    if (entry && (entry.first.length || entry.last.length)) {
      shot.frameVariants = { first: entry.first, last: entry.last }
      shot.shotId = sid // 场景级帧变体 → 行改用场景标识（折叠行）
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
  // 已挂载到现有行的帧组跳过（matchedShotIds 记录归一键）——防同身份双行。
  //
  // 行集权威：项目已有 storyboard 分镜行时，合成行整体抑制——未挂上的帧组
  // （多为资产注册中心同步进来的旧版/异版条件帧，如 44 场旧剧本的 S01~S44）不再
  // 生成幽灵行；其策展仍在资产管理中心进行。仅纯帧项目（无任何分镜行）保留合成路径。
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const hasStoryboardRows = filteredShots.length > 0
  if (!hasStoryboardRows) {
    for (const [key, entry] of variantsByNorm) {
      if (matchedShotIds.has(key)) continue
      const fv = { first: entry.first, last: entry.last }
      const repNodeId = fv.first[0]?.nodeId ?? fv.last[0]?.nodeId
      const repNode = repNodeId ? nodeById.get(repNodeId) : undefined
      if (!repNode || repNode.kind !== 'asset') continue
      filteredShots.push({
        node: repNode,
        shotId: entry.shotId,
        durationS: 0,
        thumbnail: null,
        frameVariants: fv,
      })
    }
  }

  // 替换 shots 为过滤后的列表
  shots.length = 0
  shots.push(...filteredShots)

  // 场景级对白回挂：首尾帧变体把同场景多个 beat 折叠成单行后，beat 级 shotKey 挂载的对白
  // 会随被过滤的子分镜丢失（如 S01_B04 的对白随 B02~B05 一起被过滤）。此处仅对「场景折叠行」
  // （shotId 为场景级、无 beat 段的 frameVariants 行）按 paddedShotIdOf 把对白合并回折叠后的
  // 场景行——beat 行保留各自 beat 级挂载，不重复挂载。按 filePath 去重避免与 beat 级挂载重复。
  for (const shot of shots) {
    if (!shot.frameVariants) continue
    // 仅场景折叠行回挂：shotKey 为 beat 形（s1_1）说明是普通 beat 行，跳过
    if (shotKeyFromCandidates(shot.shotId)?.match(/^s\d+_[a-z]*\d+$/)) continue
    const sid = paddedShotIdOf(shot.shotId)
    if (!sid) continue
    const sceneTracks = audioByScene.get(sid)
    if (!sceneTracks || sceneTracks.length === 0) continue
    const existing = shot.audioTracks ?? []
    const seen = new Set(existing.map((t) => t.filePath))
    const merged = [...existing]
    for (const t of sceneTracks) {
      if (!seen.has(t.filePath)) { merged.push(t); seen.add(t.filePath) }
    }
    if (merged.length) shot.audioTracks = merged
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
 * 组内已选定条件帧（三态 selected）。时间轴只展示它——策展（选哪张）在资产管理中心
 * 进行，时间轴零策展交互；无选定时返回 undefined（行内渲染「未选定」占位指引）。
 */
function selectedVariantOf(
  variants: FrameVariant[] | undefined,
  curation: Record<string, FrameCuration> | undefined,
): FrameVariant | undefined {
  if (!variants?.length) return undefined
  return variants.find((v) => (curation?.[v.nodeId] ?? v.initialCuration) === 'selected')
}

/**
 * 单帧缩略盒：有图显图；无图降级为「标签 + 文字描述 + 播放提示」占位。
 * 用于 ShotRow 的首帧 / 尾帧并排展示。aspect 默认 16/9（管线单帧路径）；
 * 条件帧（9:16 竖屏）传 '9 / 16' 保构图不裁切。
 */
function FrameBox({
  url,
  label,
  placeholderTag,
  placeholderText,
  playHint,
  badge,
  width = 104,
  aspect = '16 / 9',
}: {
  url: string | null
  label: string
  placeholderTag?: string
  placeholderText?: string
  playHint?: boolean
  badge?: ReactNode
  width?: number
  aspect?: '16 / 9' | '9 / 16'
}) {
  return (
    <div
      title={label}
      style={{
        position: 'relative',
        width,
        aspectRatio: aspect,
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

      {/* 首尾帧区：仅展示已选定条件帧——策展（选哪张）在资产管理中心进行，时间轴零策展交互。
          有变体组的项目用 9:16 竖屏盒型（保构图不裁切），选定帧带 variant 角标回指资产中心；
          无变体组沿用 16:9 单帧盒（P11 video 缩略 / 帧描述降级）。 */}
      {(() => {
        const fv = shot.frameVariants
        const hasGroup = !!(fv && (fv.first.length || fv.last.length))
        const selFirst = selectedVariantOf(fv?.first, frameCuration)
        const selLast = selectedVariantOf(fv?.last, frameCuration)
        const variantTag = (v: FrameVariant | undefined) => v && (
          <span style={{
            position: 'absolute', bottom: 3, left: 3,
            padding: '0 4px', borderRadius: 3,
            background: 'rgba(0,0,0,0.72)', color: '#fff',
            fontSize: 9, fontWeight: 700, lineHeight: '14px',
            fontFamily: 'var(--cv-font-mono, monospace)',
            backdropFilter: 'blur(4px)',
          }}>{v.variant}</span>
        )
        if (!hasGroup) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <FrameBox
                url={firstFrameUrl}
                label={`${shot.shotId} · 首帧`}
                placeholderTag="首帧"
                placeholderText={shot.startFrameDesc}
                width={compact ? 88 : 104}
                playHint={!firstFrameUrl && (!!shot.videoUrl || !!shot.clipPath)}
                badge={shot.videoUrl || shot.clipPath ? (
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
                playHint={!!shot.videoUrl || !!shot.clipPath}
                badge={lastFrameUrl ? (
                  <span style={{
                    position: 'absolute', top: 3, right: 3,
                    padding: '0 4px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.72)', color: '#fff',
                    fontSize: 9, fontWeight: 700, lineHeight: '14px',
                    fontFamily: 'var(--cv-font-mono, monospace)',
                    backdropFilter: 'blur(4px)',
                  }}>尾</span>
                ) : undefined}
              />
            </div>
          )
        }
        // 条件帧（9:16）单帧路径：选定帧显图 + variant 角标；未选定 → 占位指引到资产中心
        const fw = compact ? 52 : 64
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <FrameBox
              url={selFirst ? resolveMediaUrl(selFirst.thumbnailUrl ?? selFirst.filePath) : null}
              label={selFirst ? `${shot.shotId} · 首帧已选定 ${selFirst.variant} · 资产管理中心可改选` : `${shot.shotId} · 首帧未选定 · 到资产管理中心选定`}
              placeholderTag={selFirst ? '首帧' : '未选定'}
              placeholderText={selFirst ? undefined : shot.startFrameDesc}
              width={fw}
              aspect="9 / 16"
              badge={variantTag(selFirst)}
            />
            <span style={{ color: theme.text.tertiary, fontSize: 11, flexShrink: 0 }}>→</span>
            <FrameBox
              url={selLast ? resolveMediaUrl(selLast.thumbnailUrl ?? selLast.filePath) : null}
              label={selLast ? `${shot.shotId} · 尾帧已选定 ${selLast.variant} · 资产管理中心可改选` : `${shot.shotId} · 尾帧未选定 · 到资产管理中心选定`}
              placeholderTag={selLast ? '尾帧' : '未选定'}
              placeholderText={selLast ? undefined : shot.endFrameDesc}
              width={fw}
              aspect="9 / 16"
              badge={variantTag(selLast)}
            />
          </div>
        )
      })()}

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
                  title={`${track.audioType || track.clipType || '音频'}${track.speaker ? ' · ' + (track.speakerLabel ?? track.speaker) : ''} · ${formatDuration(track.durationS)}`}
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
                  {track.speaker && <span style={{ fontWeight: 600 }}>{track.speakerLabel ?? track.speaker}</span>}
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
 * 播放器恒在左侧：
 *   - landscape（fixedWidth=undefined）：宽度由父级 flex 控制（0 0 38%），高度填满列。
 *   - portrait（fixedWidth=N）：固定宽度 N、高度填满列（竖版播放器左置改造）。
 *   - 旧 portrait 顶部全宽模式（mode='portrait' 且无 fixedWidth）保留为兜底，不再使用。
 * <video> 均 width/height 100% + objectFit: contain（保持视频比例）。
 */
function VideoPlayer({
  shotId,
  videoUrl,
  durationLabel,
  mode,
  portraitHeight,
  fixedWidth,
  onClose,
  clipWindow,
}: {
  shotId: string
  videoUrl: string
  durationLabel: string
  mode: LayoutMode
  portraitHeight: number
  /** portrait 左置时的固定列宽（px）；undefined → landscape flex 列。 */
  fixedWidth?: number
  onClose: () => void
  /**
   * 片段窗口 [startSec, endSec]（原片逆推模式）：src 加 #t=start,end 片段锚点 +
   * timeupdate 兜底（到 end 暂停）。P11 单镜成片无窗口（整片播）。
   */
  clipWindow?: [number, number] | null
}) {
  // <video> 元素的真实时长优先于 storyboard durationS（后者常因 duration_sec 未映射为 0）
  const [realDur, setRealDur] = useState<number | null>(null)
  const isLandscape = mode === 'landscape'
  const [startSec, endSec] = clipWindow ?? [null, null]
  // 片段窗口 seek 守卫：loadedmetadata 后只自动 seek 一次（用户拖走进度条不再拽回）
  const seekedRef = useRef(false)
  // 尺寸：portrait 左置（fixedWidth）优先；其次 landscape flex；最后兜底 portrait 顶部全宽。
  const selfStyle: CSSProperties = fixedWidth != null
    ? { width: fixedWidth, flexShrink: 0, height: '100%', borderRight: `1px solid ${theme.border.default}` }
    : isLandscape
      ? { flex: '0 0 38%', minWidth: 360, maxWidth: 520, height: '100%', borderRight: `1px solid ${theme.border.default}` }
      : { width: '100%', flexShrink: 0, height: portraitHeight, borderTop: `1px solid ${theme.border.default}`, borderBottom: `1px solid ${theme.border.default}` }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      ...selfStyle,
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
          src={startSec != null ? `${videoUrl}#t=${startSec},${endSec ?? ''}` : videoUrl}
          controls
          autoPlay
          playsInline
          onLoadedMetadata={(e) => {
            const el = e.currentTarget as HTMLVideoElement
            const d = el.duration
            if (isFinite(d) && d > 0) setRealDur(d)
            // 片段锚点支持不一（Chromium 忽略 hash）→ metadata 就绪后显式 seek 兜底
            if (startSec != null && !seekedRef.current && isFinite(startSec)) {
              seekedRef.current = true
              try { el.currentTime = startSec } catch { /* 未就绪静默 */ }
            }
          }}
          onTimeUpdate={(e) => {
            // 到片段末尾暂停（兜底；浏览器片段锚点行为不一）
            if (endSec != null && isFinite(endSec) && e.currentTarget.currentTime >= endSec) {
              e.currentTarget.pause()
            }
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
      {/* 片段窗口标签（原片逆推模式）：显示窗口区间提示 */}
      {startSec != null && (
        <div style={{
          flexShrink: 0, padding: '2px 16px 6px',
          fontSize: 10, color: theme.text.tertiary,
          fontFamily: 'var(--cv-font-mono, monospace)',
        }}>
          原片片段 {formatTime(startSec)}→{formatTime(endSec ?? startSec)}（播放到此自动暂停）
        </div>
      )}
    </div>
  )
}

/**
 * 播放器列占位框：未选中带视频的分镜时保留同尺寸占位（横/竖版均常驻），保持布局稳定。
 * - portrait（fixedWidth=N）：固定宽 N、高度填满。
 * - landscape（fixedWidth=undefined）：flex 0 0 38%。
 */
function PlayerPlaceholder({ fixedWidth }: { fixedWidth?: number }) {
  const selfStyle: CSSProperties = fixedWidth != null
    ? { width: fixedWidth, flexShrink: 0, height: '100%' }
    : { flex: '0 0 38%', minWidth: 360, maxWidth: 520, height: '100%' }
  return (
    <div style={{
      ...selfStyle,
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

/**
 * 播放器边缘的竖向折叠条（24px 宽）。恒位于播放器列与分镜列表之间——折叠态播放器列隐藏，
 * 窄条仍在左边缘原位，故可随时点 ▶ 展开：
 *   - 展开态：显示 ◀（点击收起播放器列）
 *   - 折叠态：显示 ▶（点击展开播放器列）
 * 鼠标悬停高亮。取代统计栏中的「收起/展开播放器」按钮，让折叠控件紧贴播放器。
 */
function PlayerCollapseStrip({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      data-testid="player-collapse-strip"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? '展开播放器' : '收起播放器'}
      style={{
        width: 24,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hovered ? theme.bg.cardHover : theme.bg.panel,
        border: 'none',
        borderRight: `1px solid ${theme.border.default}`,
        cursor: 'pointer',
        color: hovered ? theme.text.primary : theme.text.tertiary,
        fontSize: 14,
        lineHeight: 1,
        transition: 'background 120ms, color 120ms',
      }}
    >
      {collapsed ? '▶' : '◀'}
    </button>
  )
}

// ─── 竖幅时间轴（VerticalTimeline） ──────────────────────

/** 左侧分镜列表某行的实测几何（offsetTop/offsetHeight，相对列表内容原点）。 */
export interface RowMetric {
  top: number
  height: number
}

interface VerticalTimelineProps {
  shots: TimedShot[] // 复用父组件已计算的 shots（含 startSec/endSec/layoutDur）
  selectedNodeId: string | null // 当前 detailNode?.id
  onSelectShot: (shot: StoryboardShot) => void // 复用父组件 selectShot
  onAudioPlay: (track: AudioTrack) => void // 复用父组件 setActiveAudio
  activeAudioPath: string | null // 当前 activeAudio?.filePath
  /** 左侧分镜列表滚动容器 ref —— 用于测量行高 + 双向滚动同步。 */
  shotListRef: RefObject<HTMLDivElement | null>
  /** 各分镜行实测几何（与 shots 同序、同长）；未就绪时回退时间比例布局。 */
  rowMetrics: RowMetric[]
  /** 左侧列表内容总高（scrollHeight）—— 让时间轴滚动范围与列表一致。 */
  listContentHeight: number | null
  /** 当前播放中的 stem 标识（`${nodeId}:${stem}`）；null 无。 */
  activeStem?: string | null
  /** stem mini 轨点击 → 共享 audio 片段播放（父组件持有 <audio>）。 */
  onStemPlay?: (stem: string, filePath: string, windowSec: [number, number], id: string) => void
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

/**
 * 对白说话人 sub-lane 色板：现有 dialogue 蓝系（#89B4FA）内取 5 个可分辨变体——
 * 沿蓝→青→靛的邻近色相推进，保持「同属对白列」的视觉归组，同时 sub-lane 间可辨。
 * 第 5 个之后（>5 说话人，超出规格）回落基色。
 */
export const SPEAKER_LANE_COLORS = ['#89B4FA', '#74C7EC', '#8BE9FD', '#7AA2F7', '#B4BEFE'] as const

/** #RRGGBB → rgba(r,g,b,a)（说话人 lane 背景 alpha 用；非 hex 输入原样返回）。 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 说话人 → lane 色（≤5 按序取板；越界回落 dialogue 基色）。 */
function speakerLaneColor(speakerIndex: number): string {
  if (speakerIndex >= 0 && speakerIndex < SPEAKER_LANE_COLORS.length) return SPEAKER_LANE_COLORS[speakerIndex]!
  return TRACK_META.dialogue.border
}

/** 跨镜条块最小视觉高度（px）—— 极短活动段（<~0.4s）仍可见可点。 */
export const MIN_SPAN_TRACK_H = 6

/**
 * 全片绝对时间（秒）→ 竖幅时间轴 y 坐标（px，滚动内容坐标系）的分段线性映射。
 *
 * 背景：竖幅行高来自左侧 ShotRow 实测（rowMetrics），**与镜头时长非线性**（行内
 * prompt/首尾帧内容决定高度），故不能直接 `t × PX_PER_SEC`。改用分镜时间窗
 * [startSec, endSec] → 行几何 [top, top+height] 的分段线性插值：
 *   - 段内（t 落在窗 i 内）：行内线性插值；
 *   - 行间隙（t 在窗 i 末端与窗 i+1 首端之间）：按两侧行边界线性过渡（gap 被邻行
 *     平分——实测行通常无缝衔接，此为防御性兜底）；
 *   - 越界（t 在首窗前 / 末窗后）：用相邻段斜率外推（音轨段起点早于首个分镜时仍定位）。
 *   - 零长度窗（duration 0）：与下一窗共用边界，不参与插值（防除零）。
 *
 * shots 必须已按 startSec 升序（extractShots 输出 + 累计求和保证）。
 * 返回的 timeToY 单调不减，供条块 top/height 计算共用。
 */
export function createTimeToY(
  shots: TimedShot[],
  metricOf: (i: number) => { top: number; height: number },
): (t: number) => number {
  // 折点序列：tBreaks[i] = 窗 i 的 startSec、tBreaks[i+1] = 窗 i 的 endSec …
  // 逐段构造一次可重用的插值器。
  const n = shots.length
  if (n === 0) return () => 0
  const t0 = shots[0]!.startSec
  const tEnd = shots[n - 1]!.endSec
  const y0 = metricOf(0).top
  const yEnd = metricOf(n - 1).top + metricOf(n - 1).height

  const timeToY = (t: number): number => {
    if (!isFinite(t)) return y0
    // 首窗前：用首段斜率外推
    if (t <= t0) {
      const g1 = metricOf(0)
      const d1 = shots[0]!.endSec - shots[0]!.startSec
      if (d1 > 0) return g1.top + ((t - t0) / d1) * g1.height
      return g1.top
    }
    // 末窗后：用末段斜率外推
    if (t >= tEnd) {
      const gN = metricOf(n - 1)
      const dN = shots[n - 1]!.endSec - shots[n - 1]!.startSec
      if (dN > 0) return yEnd + ((t - tEnd) / dN) * gN.height
      return yEnd
    }
    // 段内 / 间隙：定位窗 i 为**最后一个 endSec < t 的窗之后继**——
    // 即 t 严格越过窗 i 的末端才前进。t 恰在边界（t=窗 j 的 start=end）时定位到
    // 左窗 j（插值退回其行底锚点），不前进到右窗（右窗从自身行顶起算）。
    let i = 0
    for (let k = 0; k < n; k++) {
      if (shots[k]!.endSec < t) i = k + 1
      else break
    }
    if (i >= n) i = n - 1
    const g = metricOf(i)
    const gTop = g.top
    const gBot = g.top + g.height
    const ws = shots[i]!.startSec
    const we = shots[i]!.endSec
    if (t <= we) {
      // 窗内线性插值（零长度窗退回行顶）
      if (we - ws <= 0) return gTop
      return gTop + ((t - ws) / (we - ws)) * g.height
    }
    // 间隙：t ∈ (we, shots[i+1].startSec)。左右锚点 = 本行底 / 下一行顶。
    const gNext = metricOf(i + 1)
    const tNext = shots[i + 1]!.startSec
    if (tNext - we <= 0) return gBot
    return gBot + ((t - we) / (tNext - we)) * (gNext.top - gBot)
  }
  return timeToY
}

/**
 * 跨镜条块几何：绝对时间窗 [startSec, endSec] → { top, height }。
 * timeToY 来自 createTimeToY（实测行几何）；无实测时退回时间比例布局。
 * 高度 = 时间跨度映射，最小 MIN_SPAN_TRACK_H（极短段可见）；顶底都夹进内容区。
 */
export function spanTrackGeometry(
  track: AudioTrack,
  timeToY: (t: number) => number,
): { top: number; height: number } {
  const s = track.startSec ?? 0
  const e = track.endSec ?? s
  const top = timeToY(s)
  const bottom = timeToY(e)
  return {
    top: Math.min(top, bottom),
    height: Math.max(MIN_SPAN_TRACK_H, Math.abs(bottom - top)),
  }
}

/**
 * 区间 lane 分配（贪心区间图着色）：把横向重叠的段分进不同 lane，无重叠的复用 lane 0。
 *
 * 语义：段 a、b 时间重叠（`b.start < a.end`，严格小于——首尾相接 0-2 / 2-4 不算重叠，
 * Demucs silencedetect 切段恰好相接，不该被横向推开）时必须异 lane；不重叠可同 lane。
 * 输入按 start 升序（buckets 已排好；乱序输入先排，稳定性不保证但正确性不变）。
 *
 * 贪心策略（等价于经典 interval graph coloring 的最优解）：
 *   维护每条已开 lane 的「末端时间」laneEnd[lane]；新段从 lane 0 起找第一条
 *   laneEnd ≤ seg.start 的 lane 复用（往右推平末端）；全部 lane 都没空 → 开新 lane。
 *   越早的 lane 末端越小，取第一条可容纳的即可（首例可证不会劣于最优）。
 *
 * 返回与输入同长的 lane 号数组（0-based）；调用方以 max(lane)+1 作 laneCount 列内等分。
 * 例外：空输入返回 []；全不重叠时全部 lane 0（laneCount=1 → 满宽，与第一批渲染一致）。
 */
export function assignIntervalLanes(
  spans: Array<{ start: number; end: number }>,
): number[] {
  if (spans.length === 0) return []
  const sorted = spans.map((s, i) => ({ s, i }))
  sorted.sort((a, b) => a.s.start - b.s.start || a.s.end - b.s.end)
  const lanes = new Array<number>(spans.length).fill(0)
  const laneEnd: number[] = [] // 每条 lane 当前最后一段的 end（未开 = -∞）
  for (const { s, i } of sorted) {
    let placed = false
    for (let l = 0; l < laneEnd.length; l++) {
      if (laneEnd[l]! <= s.start) { laneEnd[l] = s.end; lanes[i] = l; placed = true; break }
    }
    if (!placed) { laneEnd.push(s.end); lanes[i] = laneEnd.length - 1 }
  }
  return lanes
}

/**
 * 对白列说话人 lane 分配：不同 speaker 各占固定 sub-lane（说话人恒定 → 段沿整条
 * 时间轴在列内横向位置稳定，肉眼可按「列内位置」追踪同一说话人的对话流）。
 *
 * - 说话人 lane = spk 自然排序后的序号（spk0 < spk1 < … spk10，非字典序 'spk10'<'spk2'）。
 *   首个说话人占 lane 0（不浪费左缘）；后续按序号顺延。
 * - 同一说话人内部仍可能时间重叠（脏数据 / 多说话人投同一 spk）→ 该说话人 lane
 *   内跑一遍 assignIntervalLanes 做第二级分列，深排在「说话人 lane + 段内偏移」。
 *   laneCount = 说话人 lane 数与各说话人内部分列数的乘积形态（colOf 公式见下）。
 * - 无 speaker 字段的对白（回退要求）：全体并入伪组 `'__nospeaker__'` 走纯重叠分列
 *   （行为 = assignIntervalLanes），与有 speaker 的段之间不做区分（混合出现时对白列
 *   视为无说话人整体走纯重叠——真实数据不会混，防御两套坐标系打架）。
 *
 * 返回每段的 { col（列内横向序号）, cols（列内总列数 → 等分宽度）}。
 */
export interface DialogueLaneAssignment {
  /** 段的横向 sub-lane 序号（0-based；0 = 列左缘）。 */
  col: number
  /** 本列 sub-lane 总数（列宽等分依据）。 */
  cols: number
}

/** speaker 键自然排序比较器：'spk10' 排在 'spk2' 之后（抽尾部数字，无数字按字典序）。 */
function compareSpeakerKeys(a: string, b: string): number {
  const na = a.match(/(\d+)$/)
  const nb = b.match(/(\d+)$/)
  if (na && nb) {
    const diff = Number(na[1]) - Number(nb[1])
    if (diff !== 0) return diff
  }
  return a < b ? -1 : a > b ? 1 : 0
}

export function assignDialogueLanes(spans: AudioTrack[]): DialogueLaneAssignment[] {
  if (spans.length === 0) return []
  const hasAnySpeaker = spans.some((t) => !!t.speaker)
  // 回退：无任何 speaker 字段 → 纯重叠分列（要求 3：无 speaker 回退）
  if (!hasAnySpeaker) {
    const lanes = assignIntervalLanes(spans.map((t) => ({ start: t.startSec ?? 0, end: t.endSec ?? 0 })))
    const cols = Math.max(...lanes) + 1
    return lanes.map((l) => ({ col: l, cols }))
  }
  // 说话人自然排序（spk2 < spk10）→ 固定 lane 序；无 speaker 段并入伪组排最后
  const speakers = [...new Set(spans.map((t) => t.speaker).filter(Boolean) as string[])]
  speakers.sort(compareSpeakerKeys)
  const groupKeys: Array<string | null> = [...speakers]
  if (spans.some((t) => !t.speaker)) groupKeys.push(null)

  // 每组组内二级分列：同 speaker 的时间重叠段深排（脏数据防御；正常数据 innerCount=1）
  // innerOf[i] = 段 i 在其组内的 lane 号；groupCount[key] = 该组占的列数。
  const innerOf = new Array<number>(spans.length).fill(0)
  const groupCount = new Map<string | null, number>()
  for (const key of groupKeys) {
    const idxs: number[] = []
    spans.forEach((t, i) => { if ((t.speaker ?? null) === key) idxs.push(i) })
    if (idxs.length === 0) { groupCount.set(key, 0); continue }
    const lanes = assignIntervalLanes(idxs.map((i) => ({ start: spans[i]!.startSec ?? 0, end: spans[i]!.endSec ?? 0 })))
    idxs.forEach((spanIdx, k) => { innerOf[spanIdx] = lanes[k]! })
    groupCount.set(key, Math.max(...lanes) + 1)
  }
  // 组起始列 = 前序各组占用列数累加；总列数 = Σ。
  const groupBase = new Map<string | null, number>()
  let acc = 0
  for (const key of groupKeys) {
    groupBase.set(key, acc)
    acc += groupCount.get(key) ?? 0
  }
  return spans.map((t, i) => ({
    col: (groupBase.get(t.speaker ?? null) ?? 0) + innerOf[i]!,
    cols: acc,
  }))
}

/** 竖幅各列宽度（header 行与内容列严格对齐；bgm 列 flex 吸收右侧余量）。 */
const VT_COL = { time: 36, shot: 80, dialogue: 88, ambient: 60, bgm: 60 } as const/** stem mini 音轨列宽（4 条竖排小条，仅逆推资产集等有 audioStems 的项目渲染）。 */
const VT_COL_STEMS = 44
/** 分镜矩形按场景号循环的 4 模态色板（相邻 scene 不同色）。 */
const VT_SCENE_COLORS = [v3theme.modality.image, v3theme.modality.video, v3theme.modality.audio, v3theme.modality.text] as const
const VT_PANEL_W = 360
/** 含 stem 列时的面板总宽（stem 列 44px 追加在 bgm 列后）。 */
const VT_PANEL_W_STEMS = VT_PANEL_W + VT_COL_STEMS
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
 * 单条音轨矩形（对白/环境/BGM 共用）。绝对定位到所属 shot 行的实测几何（baseTop/spanHeight），
 * 在行内向下堆叠（每条偏移 16px），高度 ∝ durationS 但夹在本行剩余空间内。
 * 点击 → onAudioPlay（不做音频文件加载验证：磁盘 wav 可能 404，父组件 mini 播放器自然失败不崩）。
 */
function AudioTrackRect({
  baseTop,
  spanHeight,
  track,
  type,
  index,
  activeAudioPath,
  onAudioPlay,
}: {
  baseTop: number // 所属 shot 行的实测 top（与左侧 ShotRow 对齐）
  spanHeight: number // 所属 shot 行的实测 height
  track: AudioTrack
  type: 'dialogue' | 'ambient' | 'bgm'
  index: number
  activeAudioPath: string | null
  onAudioPlay: (track: AudioTrack) => void
}) {
  const meta = TRACK_META[type]
  const width = VT_COL[type]
  const top = baseTop + 2 + index * 16
  const remaining = Math.max(18, spanHeight - index * 16 - 4)
  const durH = Math.max(18, (track.durationS > 0 ? track.durationS : MIN_LAYOUT_DUR) * PX_PER_SEC)
  const height = Math.min(remaining, durH)
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

/**
 * 跨镜波形活动段条块（波形活动段数据：dialogue 精确时间窗 / ambient / bgm 长段）。
 * 与 AudioTrackRect 的区别：几何不再夹在单一分镜行内，而是按全片绝对时间窗
 * [startSec, endSec] 经 timeToY 映射为竖轴区间 —— 高度 = 时间跨度，可贯穿多个
 * 分镜行（每行一条水平分隔线穿过条块，视觉即「跨镜」）。整段播放：filePath 即按
 * 窗切出的 wav，直接 onAudioPlay（共享 audio 播放器整段播，无镜窗暂停语义）。
 * 高度夹到 [MIN_SPAN_TRACK_H, ∞)（极短段 ≥6px 可见可点）。
 */
function SpanTrackBar({
  track,
  type,
  index,
  timeToY,
  activeAudioPath,
  onAudioPlay,
  lane,
  laneCount,
  colorOverride,
}: {
  track: AudioTrack
  type: 'dialogue' | 'ambient' | 'bgm'
  /** 同列内序号（key 用；lane 未传时退回奇偶水平微移，兼容旧调用形态）。 */
  index: number
  timeToY: (t: number) => number
  activeAudioPath: string | null
  onAudioPlay: (track: AudioTrack) => void
  /** 本条 sub-lane 序号（0-based；与 laneCount 配合做列内横向等分）。 */
  lane?: number
  /** 本列 sub-lane 总数（1 = 满宽，与第一批渲染一致）。 */
  laneCount?: number
  /** 说话人 lane 色覆盖（对白列；缺省用 TRACK_META 基色）。 */
  colorOverride?: string
}) {
  const meta = TRACK_META[type]
  const width = VT_COL[type]
  const { top, height } = spanTrackGeometry(track, timeToY)
  // 列内横向等分：laneCount 路 sub-lane 平分列宽（各留 1px 间隙），条块归属 lane i。
  // 无 lane 信息（laneCount 未传 / ≤1）→ 满宽 + 旧奇偶微移（第一批行为）。
  const nLanes = laneCount && laneCount > 1 ? laneCount : 1
  const laneIdx = Math.min(Math.max(lane ?? 0, 0), nLanes - 1)
  const laneW = (width - 6) / nLanes
  const left = 2 + laneIdx * laneW + (nLanes > 1 ? 1 : 0)
  const barW = laneW - (nLanes > 1 ? 1.5 : 0)
  const leftShift = nLanes === 1 && index % 2 === 1 ? 6 : 0
  const isActive = activeAudioPath === track.filePath
  const border = colorOverride ?? meta.border
  const bg = colorOverride
    ? hexToRgba(colorOverride, isActive ? 0.5 : 0.3)
    : (isActive ? meta.bgActive : meta.bg)
  const label = track.speakerLabel ?? track.speaker ?? track.audioType ?? track.clipType ?? ''
  const title = [
    track.audioType || track.clipType || '音频',
    track.speaker ? (track.speakerLabel ?? track.speaker) : '',
    `${formatTime(track.startSec ?? 0)}→${formatTime(track.endSec ?? 0)}`,
    formatDuration(track.durationS),
  ].filter(Boolean).join(' · ') + (track.text ? `\n${track.text}` : '')
  return (
    <button
      data-testid="vt-span-bar"
      onClick={(e) => { e.stopPropagation(); onAudioPlay(track) }}
      title={title}
      style={{
        position: 'absolute',
        top,
        left: left + leftShift,
        width: barW - leftShift,
        height,
        overflow: 'hidden',
        cursor: 'pointer',
        padding: height >= 14 ? '2px 14px 2px 5px' : '0 12px 0 3px',
        borderRadius: 3,
        textAlign: 'left',
        background: bg,
        border: `1px solid ${border}`,
        borderLeft: `${isActive ? 3 : 2}px solid ${border}`,
        color: '#fff',
      }}
    >
      {height >= 14 && (
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
      )}
      {height >= 26 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 8, opacity: 0.75,
          fontFamily: 'var(--cv-font-mono, monospace)',
        }}>{formatDuration(track.durationS)}</span>
      )}
    </button>
  )
}

/** 单条音轨列（对白/环境/BGM）。bgm 列 flex 吸收面板右侧余量。
 *  两种条块共用本列：
 *   - spans（波形活动段，有 start_sec/end_sec）：按全片绝对时间坐标跨镜渲染——
 *     top/height 由 createTimeToY 分段线性映射换算，贯穿多个分镜行（BGM 106.5-135.5s
 *     跨 13 行不再压缩在起始镜行内）。点击整段播放（文件即按窗切出，无镜窗语义）。
 *   - items（旧数据，无时间窗）：沿用 AudioTrackRect 的 shotKey 行内挂载，逐字节不变。
 *  无活动段的行不画任何条块（列背景即空）。 */
function TrackLane({
  type,
  items,
  spans,
  timeToY,
  metricByNodeId,
  activeAudioPath,
  onAudioPlay,
  spanLanes,
  spanLaneCount,
  spanColors,
}: {
  type: 'dialogue' | 'ambient' | 'bgm'
  items: Array<{ shot: TimedShot; track: AudioTrack }>
  /** 波形活动段条块（绝对时间窗渲染，可跨镜）。 */
  spans?: AudioTrack[]
  /** 绝对时间 → y 坐标映射（createTimeToY 产物；spans 非空时必传）。 */
  timeToY?: (t: number) => number
  metricByNodeId: Map<string, { top: number; height: number }>
  activeAudioPath: string | null
  onAudioPlay: (track: AudioTrack) => void
  /** 各 span 的 sub-lane 号（与 spans 同序；横向分列）。 */
  spanLanes?: number[]
  /** 本列 sub-lane 总数（列宽等分）。 */
  spanLaneCount?: number
  /** 各 span 的颜色覆盖（对白说话人 lane 色；与 spans 同序）。 */
  spanColors?: Array<string | undefined>
}) {
  const containerStyle: CSSProperties = type === 'bgm'
    ? { flex: '1 1 auto', minWidth: VT_COL.bgm, position: 'relative', zIndex: 1 }
    : { width: VT_COL[type], position: 'relative', flexShrink: 0, zIndex: 1, borderRight: `1px solid ${theme.border.dim}` }
  return (
    <div style={containerStyle}>
      {spans && timeToY && spans.map((track, i) => (
        <SpanTrackBar
          key={`span-${track.filePath}-${i}`}
          track={track}
          type={type}
          index={i}
          timeToY={timeToY}
          activeAudioPath={activeAudioPath}
          onAudioPlay={onAudioPlay}
          lane={spanLanes?.[i]}
          laneCount={spanLaneCount}
          colorOverride={spanColors?.[i]}
        />
      ))}
      {items.map(({ shot, track }, i) => {
        const g = metricByNodeId.get(shot.node.id) ?? {
          top: shot.startSec * PX_PER_SEC,
          height: Math.max(28, shot.layoutDur * PX_PER_SEC),
        }
        return (
          <AudioTrackRect
            key={`${shot.node.id}-${i}`}
            baseTop={g.top}
            spanHeight={g.height}
            track={track}
            type={type}
            index={i}
            activeAudioPath={activeAudioPath}
            onAudioPlay={onAudioPlay}
          />
        )
      })}
    </div>
  )
}

// ─── Demucs stem mini 音轨（逆推资产集：storyboard data.audioStems） ───

/**
 * stem mini 音轨列：每分镜行右侧并排 4 条竖条（vocals/drums/bass/other），
 * 高度 ∝ duration_sec 等比（同 AudioTrackRect 的 durH 公式），颜色按 STEM_META 区分。
 * 点击某条 → onStemPlay(stem, filePath, [start_sec, end_sec]) 共享 audio 片段播放。
 * 无 audioStems 数据的项目整块不渲染（向后兼容管线产出项目）。
 */
function StemLane({
  shots,
  metricByNodeId,
  activeStem,
  onStemPlay,
}: {
  shots: TimedShot[]
  metricByNodeId: Map<string, { top: number; height: number }>
  /** 当前播放中的 stem 标识（`${nodeId}:${stem}`）；null 无。 */
  activeStem: string | null
  onStemPlay: (stem: string, filePath: string, windowSec: [number, number], id: string) => void
}) {
  const stems = ['vocals', 'drums', 'bass', 'other'] as const
  return (
    <div style={{
      width: VT_COL_STEMS, position: 'relative', flexShrink: 0, zIndex: 1,
      borderRight: `1px solid ${theme.border.dim}`,
    }}>
      {shots.map((shot) => {
        if (!shot.audioStems) return null
        const g = metricByNodeId.get(shot.node.id) ?? {
          top: shot.startSec * PX_PER_SEC,
          height: Math.max(28, shot.layoutDur * PX_PER_SEC),
        }
        const durH = Math.max(16, (shot.durationS > 0 ? shot.durationS : MIN_LAYOUT_DUR) * PX_PER_SEC)
        const height = Math.min(Math.max(18, g.height - 4), durH)
        return (
          <div
            key={`stems-${shot.node.id}`}
            style={{ position: 'absolute', top: g.top + 2, left: 2, display: 'flex', gap: 2, height }}
          >
            {stems.map((stem) => {
              const fp = shot.audioStems?.[stem]
              if (!fp) return null
              const meta = STEM_META[stem]
              const id = `${shot.node.id}:${stem}`
              const isActive = activeStem === id
              const win: [number, number] = [shot.clipStartSec ?? 0, shot.clipEndSec ?? shot.durationS]
              return (
                <button
                  key={stem}
                  data-testid="vt-stem-rect"
                  onClick={(e) => { e.stopPropagation(); onStemPlay(stem, fp, win, id) }}
                  title={`${meta.label} · ${shot.shotId} · ${formatTime(win[0])}→${formatTime(win[1])}`}
                  style={{
                    width: (VT_COL_STEMS - 6 - 6) / 4,
                    height: '100%',
                    minHeight: 14,
                    padding: 0,
                    borderRadius: 2,
                    cursor: 'pointer',
                    background: isActive ? `${meta.color}CC` : `${meta.color}55`,
                    border: `1px solid ${meta.color}`,
                    transition: 'background 120ms',
                  }}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 竖幅时间轴面板（页面右侧固定）。**行高与左侧 ShotRow 实测对齐**：
 *   - 父组件测量每个 ShotRow 的 offsetTop/offsetHeight（rowMetrics）传入；未就绪时回退时间比例。
 *   - 分镜矩形 / 音轨矩形 / 分隔线 / 时间标签 全部以 rowMetrics[i] 定位 → 与左侧逐行齐平。
 *   - 双向滚动同步：左侧列表滚动 ↔ 本面板滚动（补偿 VT 标题栏+列头高度 headerH）。
 *
 * 可折叠：展开 360px（默认），折叠 44px 仅留标题栏 + 竖向「时间轴」文字。
 */
function VerticalTimeline({
  shots,
  selectedNodeId,
  onSelectShot,
  onAudioPlay,
  activeAudioPath,
  shotListRef,
  rowMetrics,
  listContentHeight,
  activeStem,
  onStemPlay,
}: VerticalTimelineProps) {
  const [collapsed, setCollapsed] = useState(false)
  const vtScrollRef = useRef<HTMLDivElement>(null)
  // stem 列仅在有 audioStems 数据时渲染（面板相应加宽）
  const hasStems = shots.some((s) => s.audioStems && Object.values(s.audioStems).some(Boolean))

  // 音轨按类别分桶；波形活动段（有绝对时间窗）与旧数据（无窗）分流 ——
  // 前者跨镜渲染（时间坐标 + 时间重叠/说话人 sub-lane 分列），后者保持 shotKey 行内
  // 挂载（管线项目回归不变）。
  const buckets = useMemo(() => {
    const dialogue: Array<{ shot: TimedShot; track: AudioTrack }> = []
    const ambient: Array<{ shot: TimedShot; track: AudioTrack }> = []
    const bgm: Array<{ shot: TimedShot; track: AudioTrack }> = []
    const spanDialogue: AudioTrack[] = []
    const spanAmbient: AudioTrack[] = []
    const spanBgm: AudioTrack[] = []
    const seenSpan = new Set<string>() // filePath 去重：多镜挂载 + 场景级回挂会让同一段重复入桶
    for (const shot of shots) {
      for (const track of shot.audioTracks ?? []) {
        const cls = classifyAudioTrack(track)
        if (!cls) continue
        if (hasSpanWindow(track)) {
          if (seenSpan.has(track.filePath)) continue // 跨镜段只渲染一次（不被挂载镜数放大）
          seenSpan.add(track.filePath)
          if (cls === 'dialogue') spanDialogue.push(track)
          else if (cls === 'ambient') spanAmbient.push(track)
          else spanBgm.push(track)
        } else if (cls === 'dialogue') dialogue.push({ shot, track })
        else if (cls === 'ambient') ambient.push({ shot, track })
        else if (cls === 'bgm') bgm.push({ shot, track })
      }
    }
    // 活动段按 startSec 排序：视觉沿时间轴自上而下，重叠时 index 错开也稳定
    const byStart = (a: AudioTrack, b: AudioTrack) => (a.startSec ?? 0) - (b.startSec ?? 0)
    spanDialogue.sort(byStart)
    spanAmbient.sort(byStart)
    spanBgm.sort(byStart)
    // ── 时间重叠 / 说话人 sub-lane 分列 ──
    // 对白列：有 speaker → 每说话人固定 sub-lane（色相区分）；无 → 纯重叠分列。
    // 环境/BGM 列：区间图着色分列（重叠段横向等分列宽）。
    const dlgAssign = assignDialogueLanes(spanDialogue)
    const dlgLanes = dlgAssign.map((a) => a.col)
    const dlgLaneCount = dlgAssign.length ? dlgAssign[0]!.cols : 1
    const ambLanes = assignIntervalLanes(spanAmbient.map((t) => ({ start: t.startSec ?? 0, end: t.endSec ?? 0 })))
    const bgmLanes = assignIntervalLanes(spanBgm.map((t) => ({ start: t.startSec ?? 0, end: t.endSec ?? 0 })))
    const ambLaneCount = spanAmbient.length ? Math.max(...ambLanes) + 1 : 1
    const bgmLaneCount = spanBgm.length ? Math.max(...bgmLanes) + 1 : 1
    // 说话人 → lane 色映射（自然排序后按 SPEAKER_LANE_COLORS 取板）
    const hasSpeaker = spanDialogue.some((t) => !!t.speaker)
    let dlgColors: Array<string | undefined> | undefined
    if (hasSpeaker) {
      const speakers = [...new Set(spanDialogue.map((t) => t.speaker).filter(Boolean) as string[])]
      speakers.sort(compareSpeakerKeys)
      const colorOf = new Map<string, string>()
      speakers.forEach((sp, i) => colorOf.set(sp, speakerLaneColor(i)))
      dlgColors = spanDialogue.map((t) => (t.speaker ? colorOf.get(t.speaker) : undefined))
    }
    // 说话人图例（轨头 tooltip）：说话人 lane 序 + 颜色 + label
    const speakerLegend = hasSpeaker
      ? [...new Set(spanDialogue.map((t) => t.speaker).filter(Boolean) as string[])].sort(compareSpeakerKeys)
          .map((sp, i) => {
            const t = spanDialogue.find((x) => x.speaker === sp)
            return `${i + 1}. ${(t?.speakerLabel ?? sp)}（${speakerLaneColor(i)}）`
          })
      : null
    return {
      dialogue, ambient, bgm, spanDialogue, spanAmbient, spanBgm,
      dlgLanes, dlgLaneCount, dlgColors, speakerLegend,
      ambLanes, ambLaneCount, bgmLanes, bgmLaneCount,
    }
  }, [shots])

  const totalSec = shots.length ? shots[shots.length - 1].endSec : 0

  // ── 行几何：优先实测（rowMetrics），未就绪回退时间比例 ──
  const hasMetrics = rowMetrics.length > 0 && rowMetrics.length === shots.length
  const rowTopOf = (i: number) => hasMetrics ? rowMetrics[i]!.top : shots[i]!.startSec * PX_PER_SEC
  const rowHeightOf = (i: number) => hasMetrics ? rowMetrics[i]!.height : Math.max(28, shots[i]!.layoutDur * PX_PER_SEC)
  // 绝对时间 → y（分段线性；跨镜活动段条块定位用）。行几何或 shots 变化时重建。
  const timeToY = useMemo(
    () => createTimeToY(shots, (i) => ({ top: rowTopOf(i), height: rowHeightOf(i) })),
    // rowTopOf/rowHeightOf 闭包依赖 hasMetrics/rowMetrics/shots
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, hasMetrics, rowMetrics],
  )
  const metricByNodeId = useMemo(() => {
    const m = new Map<string, { top: number; height: number }>()
    shots.forEach((s, i) => m.set(s.node.id, { top: rowTopOf(i), height: rowHeightOf(i) }))
    return m
    // rowTopOf/rowHeightOf 依赖 hasMetrics/rowMetrics，列入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, hasMetrics, rowMetrics])

  // 内容区高度：有实测时取左侧列表 scrollHeight（滚动范围与列表一致）；否则时间比例兜底
  const contentHeight = useMemo(() => {
    if (hasMetrics && listContentHeight && listContentHeight > 0) return Math.max(listContentHeight, 60)
    let h = totalSec * PX_PER_SEC
    for (const s of shots) {
      const bottom = s.startSec * PX_PER_SEC + Math.max(28, s.layoutDur * PX_PER_SEC)
      if (bottom > h) h = bottom
    }
    return Math.max(h, 60)
  }, [hasMetrics, listContentHeight, totalSec, shots])

  // ── 双向滚动同步（VT 内部滚动区 ↔ 左侧 shotList）──
  // 几何推导：shotList 视口顶 = R（无表头）；VT 视口顶 = R + headerH（被标题栏+列头压下）。
  // 要让「列表内容偏移 T」与「VT 内容偏移 T」同屏 Y 对齐 ⇒ vt.scrollTop = list.scrollTop + headerH。
  // headerH = vtScrollRef.offsetTop（VT 根 position:relative 为其 offsetParent）。
  useLayoutEffect(() => {
    const list = shotListRef.current
    const vt = vtScrollRef.current
    if (!list || !vt) return
    const headerH = vt.offsetTop
    let syncing = false
    const syncToVt = () => {
      if (syncing) return
      syncing = true
      vt.scrollTop = Math.max(0, Math.min(vt.scrollHeight - vt.clientHeight, list.scrollTop + headerH))
      requestAnimationFrame(() => { syncing = false })
    }
    const syncToList = () => {
      if (syncing) return
      syncing = true
      list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, vt.scrollTop - headerH))
      requestAnimationFrame(() => { syncing = false })
    }
    list.addEventListener('scroll', syncToVt, { passive: true })
    vt.addEventListener('scroll', syncToList, { passive: true })
    syncToVt() // 初始对齐
    return () => {
      list.removeEventListener('scroll', syncToVt)
      vt.removeEventListener('scroll', syncToList)
    }
  }, [shotListRef, shots, hasMetrics, listContentHeight])

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
        position: 'relative', // 作为内部 vtScrollRef 的 offsetParent，使 offsetTop = 表头高度
        width: hasStems ? VT_PANEL_W_STEMS : VT_PANEL_W, height: '100%', flexShrink: 0,
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
        <div
          style={{ ...headerCellStyle, ...colBorder, width: VT_COL.dialogue }}
          title={buckets.speakerLegend ? `对白说话人分列（列内从左到右）：\n${buckets.speakerLegend.join('\n')}` : '对白（按时间重叠分列）'}
        >
          💬 对白{buckets.speakerLegend ? ` ×${buckets.dlgLaneCount}` : ''}
        </div>
        <div style={{ ...headerCellStyle, ...colBorder, width: VT_COL.ambient }}>🔊 环境</div>
        <div style={{ ...headerCellStyle, flex: '1 1 auto', minWidth: VT_COL.bgm }}>🎵 BGM</div>
      </div>

      {/* 滚动内容区 —— ref 供滚动同步；position:relative 让行内绝对定位以本区为原点 */}
      <div ref={vtScrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ position: 'relative', height: contentHeight, display: 'flex' }}>
          {/* 分镜行分隔线层（全宽，每行顶部一条 —— 与 ShotRow 行高对齐） */}
          {shots.map((shot, i) => (
            <div key={`grid-${shot.node.id}`} style={{
              position: 'absolute', top: rowTopOf(i), left: 0, right: 0, height: 0,
              borderTop: `1px solid ${theme.border.dim}`, pointerEvents: 'none', zIndex: 0,
            }} />
          ))}

          {/* 时间刻度列（36px）—— 每行顶部标累计起始秒 */}
          <div style={{ width: VT_COL.time, position: 'relative', flexShrink: 0, ...colBorder, zIndex: 1 }}>
            {shots.map((shot, i) => (
              <span key={`tick-${shot.node.id}`} style={{
                position: 'absolute', top: rowTopOf(i) + 2, left: 3,
                fontSize: 9, fontFamily: 'var(--cv-font-mono, monospace)',
                color: theme.text.tertiary, lineHeight: 1,
              }}>{formatTime(shot.startSec)}</span>
            ))}
          </div>

          {/* 分镜矩形轨（80px）—— top/height 取实测，与左侧 ShotRow 对齐 */}
          <div style={{ width: VT_COL.shot, position: 'relative', flexShrink: 0, ...colBorder, zIndex: 1 }}>
            {shots.map((shot, i) => {
              const top = rowTopOf(i)
              const height = Math.max(20, rowHeightOf(i))
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

          {/* 三类音轨列（对白 88 / 环境 60 / BGM 60→flex）。
              spans=波形活动段跨镜条块（绝对时间坐标 + 时间重叠/说话人 sub-lane 分列）；
              items=无窗旧数据（shotKey 行内挂载）。 */}
          <TrackLane type="dialogue" items={buckets.dialogue} spans={buckets.spanDialogue} timeToY={timeToY} metricByNodeId={metricByNodeId} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} spanLanes={buckets.dlgLanes} spanLaneCount={buckets.dlgLaneCount} spanColors={buckets.dlgColors} />
          <TrackLane type="ambient" items={buckets.ambient} spans={buckets.spanAmbient} timeToY={timeToY} metricByNodeId={metricByNodeId} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} spanLanes={buckets.ambLanes} spanLaneCount={buckets.ambLaneCount} />
          <TrackLane type="bgm" items={buckets.bgm} spans={buckets.spanBgm} timeToY={timeToY} metricByNodeId={metricByNodeId} activeAudioPath={activeAudioPath} onAudioPlay={onAudioPlay} spanLanes={buckets.bgmLanes} spanLaneCount={buckets.bgmLaneCount} />
          {/* Demucs stem mini 音轨列（仅逆推资产集等有 audioStems 的项目渲染） */}
          {hasStems && onStemPlay && (
            <StemLane shots={shots} metricByNodeId={metricByNodeId} activeStem={activeStem ?? null} onStemPlay={onStemPlay} />
          )}
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

  // 视频播放器：单击选中带 P11 视频的分镜即加载。
  // clipWindow 仅原片逆推模式（clipPath）携带——P11 单镜成片整片播。
  const [activeVideo, setActiveVideo] = useState<{
    shotId: string
    videoUrl: string
    durationS: number
    clipWindow?: [number, number] | null
  } | null>(null)
  // 左侧播放器区域折叠/展开：折叠时隐藏播放器列、分镜列表占满宽度、点击分镜只高亮选中不自动播放
  const [playerCollapsed, setPlayerCollapsed] = useState(false)
  // 音频 mini 播放器：点击分镜音轨 chip 即加载
  const [activeAudio, setActiveAudio] = useState<AudioTrack | null>(null)
  // Demucs stem 片段播放（逆推资产集）：单个共享 <audio>，点击 stem mini 轨加载
  // 对应 wav 的 [start_sec, end_sec] 窗口（currentTime 设 start，timeupdate 到 end 停）。
  const [activeStem, setActiveStem] = useState<{
    id: string // `${nodeId}:${stem}` — 激活高亮键
    stem: string
    filePath: string // 已 encodeURI 的可播 URL
    windowSec: [number, number]
  } | null>(null)
  const stemAudioRef = useRef<HTMLAudioElement>(null)
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
          if (a.name) {
            nameMap.set(a.name, a.id)
            // 去噪归一键（"S01_B01 first帧 v1" → "S01_B01firstv1"），与 assetIdOf 查询侧对称
            const norm = normalizeAssetName(a.name)
            if (!nameMap.has(norm)) nameMap.set(norm, a.id)
          }
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
          // 权威三态：isPrimaryView=选定（时间轴仅展示已选定条件帧）；state=eliminated 淘汰；
          // 其余待选（用户手动选定前不自动选 v1）。策展动作在资产管理中心完成。
          if (a.isPrimaryView) curationUpdate[nodeId] = 'selected'
          else if (a.state === 'eliminated') curationUpdate[nodeId] = 'eliminated'
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

  // 查找 RF Node（用于打开详情面板）
  const nodes = useCanvasStore((s) => s.nodes)

  // 单击：只选中（高亮）+ 加载视频播放器（不弹详情）
  const selectShot = (shot: StoryboardShot) => {
    const rfNode = nodes.find((n) => n.id === shot.node.id)
    if (rfNode) setSelectedNode(rfNode)
    // 仅在播放器展开时才自动播放；折叠态只高亮选中。
    // 优先 P11 单镜成片（videoUrl）；原片逆推项目走 clipPath 片段窗口（encodeURI——
    // 片名含全角括号/空格，原样路径会被浏览器截断在首个非法字符）。
    if (!playerCollapsed) {
      if (shot.videoUrl) {
        setActiveVideo({ shotId: shot.shotId, videoUrl: shot.videoUrl, durationS: shot.durationS })
      } else if (shot.clipPath) {
        setActiveVideo({
          shotId: shot.shotId,
          videoUrl: encodeURI(shot.clipPath),
          durationS: shot.durationS,
          clipWindow: [shot.clipStartSec ?? 0, shot.clipEndSec ?? shot.durationS],
        })
      }
    }
  }

  // 双击：额外打开右侧详情面板（在单击选中的基础上）
  const openDetail = (shot: StoryboardShot) => {
    const rfNode = nodes.find((n) => n.id === shot.node.id)
    if (rfNode) setDetailNode(rfNode)
  }

  // stem mini 轨点击：共享 <audio> 加载 wav（encodeURI——片名含全角括号/空格）并
  // 在 metadata 就绪后 seek 到窗口起点；timeupdate 由 <audio> 元素 onTimeUpdate 停。
  const handleStemPlay = useCallback((
    stem: string,
    filePath: string,
    windowSec: [number, number],
    id: string,
  ) => {
    // 再点同一条 → 停止并收起
    if (activeStem?.id === id) {
      setActiveStem(null)
      return
    }
    setActiveStem({ id, stem, filePath: encodeURI(filePath), windowSec })
  }, [activeStem])

  // 折叠/展开播放器列（由播放器边缘竖条触发）：折叠时清除当前视频，避免后台继续播放。
  const togglePlayer = useCallback(() => {
    setPlayerCollapsed((v) => {
      const next = !v
      if (next && activeVideo) setActiveVideo(null)
      return next
    })
  }, [activeVideo])

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

  // ── 竖幅时间轴行对齐：实测左侧 ShotRow 每行的 offsetTop/offsetHeight ──
  // 传给 VerticalTimeline 做定位，使其分镜行与左侧逐行齐平（而非各自按不同高度公式）。
  const shotListRef = useRef<HTMLDivElement>(null)
  const [rowMetrics, setRowMetrics] = useState<RowMetric[]>([])
  const [listContentHeight, setListContentHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const root = shotListRef.current
    if (!root) return
    const measure = () => {
      const rows = root.querySelectorAll<HTMLElement>('[data-testid="shot-row"]')
      const metrics: RowMetric[] = []
      rows.forEach((r) => metrics.push({ top: r.offsetTop, height: r.offsetHeight }))
      setRowMetrics(metrics)
      setListContentHeight(root.scrollHeight)
    }
    measure()
    // ResizeObserver 捕获行高变化（文字换行 / 首尾帧展开收起 / 窗口缩放），重测以保持对齐
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [shots, compactRows])

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

  // ─── 播放器 + 分镜列表（播放器恒在左侧） ──────────────
  // 竖版播放器左置固定宽度（窗口宽 35%，上限 360）；横版由 VideoPlayer flex 自适应。
  const portraitPlayerW = Math.min(winSize.w * 0.35, 360)
  const playerFixedWidth = isLandscape ? undefined : portraitPlayerW
  const player = activeVideo ? (
    <VideoPlayer
      shotId={activeVideo.shotId}
      videoUrl={resolveMediaUrl(activeVideo.videoUrl) ?? ''}
      durationLabel={formatDuration(activeVideo.durationS)}
      mode={layoutMode}
      portraitHeight={portraitPlayerH}
      fixedWidth={playerFixedWidth}
      onClose={() => setActiveVideo(null)}
      clipWindow={activeVideo.clipWindow ?? null}
    />
  ) : null

  const shotList = (
    <div
      ref={shotListRef}
      data-testid="shot-list"
      style={{ flex: '1 1 auto', minWidth: 320, overflowY: 'auto', position: 'relative' }}
    >
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
              {playerCollapsed ? '💡 单击选中分镜' : '💡 单击播放视频'}
            </span>
          </>
        )}
      </div>

      {/* 主体：左=播放器（恒在左）+分镜列表，右=竖幅时间轴（固定宽度，可折叠）。
          横/竖版均 flexDirection:row；竖版播放器固定宽 portraitPlayerW，无视频时常驻占位。 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minWidth: 0 }}>
          {/* 左：播放器列 — 可折叠；展开时常驻（有视频播放/无视频占位），折叠时隐藏让分镜列表占满宽度 */}
          {!playerCollapsed && (activeVideo ? player : <PlayerPlaceholder fixedWidth={playerFixedWidth} />)}
          {/* 播放器边缘竖向折叠条（恒在；折叠态播放器列隐藏，窄条仍在左边缘原位，可点 ▶ 展开） */}
          <PlayerCollapseStrip collapsed={playerCollapsed} onToggle={togglePlayer} />
          {/* 右：分镜列表（占满剩余宽度） */}
          {shotList}
        </div>
        {/* 竖幅时间轴（右侧固定面板） */}
        <VerticalTimeline
          shots={shots}
          selectedNodeId={detailNode?.id ?? null}
          onSelectShot={selectShot}
          onAudioPlay={(track) => setActiveAudio(track)}
          activeAudioPath={activeAudio?.filePath ?? null}
          shotListRef={shotListRef}
          rowMetrics={rowMetrics}
          listContentHeight={listContentHeight}
          activeStem={activeStem?.id ?? null}
          onStemPlay={handleStemPlay}
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
            {activeAudio.speaker ? ` · ${activeAudio.speakerLabel ?? activeAudio.speaker}` : ''}
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

      {/* ─── Demucs stem 片段播放器（共享 <audio>；点击 stem mini 轨滑出） ─── */}
      {activeStem && (
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 16px',
          background: theme.bg.panel,
          borderTop: `1px solid ${theme.border.default}`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: STEM_META[activeStem.stem]?.color ?? v3theme.modality.audio }}>
            🎚 {STEM_META[activeStem.stem]?.label ?? activeStem.stem}
          </span>
          <span style={{ fontSize: 10, color: theme.text.tertiary, whiteSpace: 'nowrap', fontFamily: 'var(--cv-font-mono, monospace)' }}>
            {formatTime(activeStem.windowSec[0])}→{formatTime(activeStem.windowSec[1])}
          </span>
          {/* key 含 id：切 stem/切分镜都重挂载 → autoPlay 生效 */}
          <audio
            key={activeStem.id}
            ref={stemAudioRef}
            src={activeStem.filePath}
            controls
            autoPlay
            onLoadedMetadata={(e) => {
              // seek 到片段起点（wav 支持 Range，metadata 就绪即可定位）
              const el = e.currentTarget as HTMLAudioElement
              const s = activeStem.windowSec[0]
              if (isFinite(s) && s > 0) {
                try { el.currentTime = s } catch { /* 未就绪静默 */ }
              }
            }}
            onTimeUpdate={(e) => {
              // 到片段末尾停（与视频片段窗口同一兜底策略）
              const end = activeStem.windowSec[1]
              if (isFinite(end) && e.currentTarget.currentTime >= end) {
                e.currentTarget.pause()
              }
            }}
            style={{ height: 28, flex: 1, maxWidth: 480, minWidth: 160 }}
          />
          <button
            onClick={() => setActiveStem(null)}
            title="关闭 stem 播放"
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
