/**
 * 视图D · 对白管理 —— TTS 对白资产（P10 voice_clips）展示 + 音频试听。
 *
 * 【数据源】对白资产 = P10 voice_clips 节点（data.clip_type='dialogue'，含 text/speaker/
 *   emotion/shot_id/duration_sec/filePath/engine）。这些节点不在 assets-registry（o_assets）里，
 *   而是存在于 canvas graph（FlowGraphV3 + rawDataByNodeId 穿透袋）。因此本视图直接消费 store
 *   的 graph，与 StoryboardTimeline 同源；store 图缺数据时回退 convertProjectData（与时间轴
 *   extraFrameShots 同一手法），保证两边数据一致。
 *
 * 【角色名映射】对白 speaker/characterId 是拼音（shenzhiyi/zhoulin），而角色设定图（type=
 *   'character', subtype='character_design'）的 characterId 也是拼音、name 是中文（「沈知意 v1」）。
 *   故从 useRealAssets 的角色设定图建 pinyin→中文 + pinyin→头像 映射，让左栏与卡片显示可读中文名。
 *   无映射的角色回退显示拼音原值。
 *
 * 布局复用 .am-scene（左角色列表 + 右对白列表），与 CharacterWardrobe 同构：
 *   - 左栏：说话角色分组（含「全部」入口），每项带头像 + 中文名 + 对白数
 *   - 右栏：选中角色的对白卡片（按 shot_id 排序），每条 = 试听按钮 + 镜号/情感/时长 + 对白原文 + 进度条
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useRealAssets } from './useRealAssets'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { convertProjectData } from '../../services/canvasApi'
import { inferSubtype } from './assetManagerData'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

/** 一条 TTS 对白（来自 P10 voice_clips 节点）/ 一条音频轨（P12b stems）。 */
interface DialogueClip {
  nodeId: string
  /** 分镜标识（S01_B04）。 */
  shotId: string
  /** 说话人 ID（拼音，如 shenzhiyi）；stems 模式 = 音轨类型中文名（分组键）。 */
  speaker: string
  /** 角色 ID（通常同 speaker）。 */
  characterId: string
  /** 对白原文；stems 模式 = 轨描述（"BGM 音轨 · 温情 · 92 BPM"）。 */
  text: string
  /** 情感标签（坚定 / 中性 …）。 */
  emotion: string
  /** 时长（秒）。 */
  durationSec: number
  /** TTS 引擎（Qwen3-TTS-1.7B）。 */
  engine: string
  /** 音频文件路径（/oss/… 或相对路径）。 */
  filePath: string
}

export type DialoguePanelMode = 'dialogue' | 'stems'

/** stems 模式的轨类型判定：canvas-sync 展开标记（clip_type）优先，audioType 兜底。 */
function stemKindOf(raw: Record<string, unknown>): { key: string; label: string } | null {
  const ct = raw.clip_type as string | undefined
  const at = raw.audioType as string | undefined
  if (ct === 'bgm' || at === 'bgm') return { key: 'bgm', label: 'BGM 音轨' }
  if (ct === 'sfx' || at === 'foley') return { key: 'foley', label: '环境音效' }
  if (ct === 'voice_mix') return { key: 'voice_mix', label: '人声合轨' }
  if (ct === 'mix' || at === 'mix') return { key: 'mix', label: '混音母带' }
  return null
}

/**
 * 从 { nodeId, raw } 列表抽取对白片段（clip_type='dialogue' 且有 text），
 * 或 stems 模式抽取音频轨（P12b bgm/sfx/voice_mix/mix）。
 * store graph 与 convert 两条路径共用此纯函数。
 */
function clipsFromRaw(
  entries: Array<{ id: string; raw: Record<string, unknown> }>,
  mode: DialoguePanelMode = 'dialogue',
): DialogueClip[] {
  const out: DialogueClip[] = []
  for (const { id, raw } of entries) {
    if (mode === 'stems') {
      const kind = stemKindOf(raw)
      const filePath = (raw.filePath as string) ?? (raw.audio_path as string) ?? ''
      if (!kind || !filePath) continue
      out.push({
        nodeId: id,
        shotId: (raw.shot_id as string) ?? (raw.label as string) ?? '',
        speaker: kind.label,
        characterId: '',
        text: String(raw.description ?? kind.label),
        emotion: '',
        durationSec: typeof raw.duration_sec === 'number' ? raw.duration_sec : 0,
        engine: (raw.engine as string) ?? '',
        filePath,
      })
      continue
    }
    if (raw.clip_type !== 'dialogue') continue
    const text = raw.text as string | undefined
    if (!text || !String(text).trim()) continue
    const filePath = (raw.filePath as string) ?? (raw.audio_path as string) ?? ''
    out.push({
      nodeId: id,
      shotId: (raw.shot_id as string) ?? (raw.label as string) ?? '',
      speaker: (raw.speaker as string) ?? (raw.characterId as string) ?? '',
      characterId: (raw.characterId as string) ?? '',
      text: String(text).trim(),
      emotion: (raw.emotion as string) ?? '',
      durationSec: typeof raw.duration_sec === 'number' ? raw.duration_sec : 0,
      engine: (raw.engine as string) ?? '',
      filePath,
    })
  }
  return out
}

/** 从 store graph + rawDataByNodeId 抽取对白片段 / 音频轨。 */
function extractClipsFromGraph(
  graph: FlowGraphV3 | null,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
  mode: DialoguePanelMode = 'dialogue',
): DialogueClip[] {
  if (!graph) return []
  return clipsFromRaw(
    graph.nodes.map((n) => ({ id: n.id, raw: rawDataByNodeId?.get(n.id) ?? {} })),
    mode,
  )
}

/** stems 模式的左栏分组 emoji（按轨类型中文名）。 */
function stemEmojiOf(label: string): string {
  if (label.includes('BGM')) return '🎵'
  if (label.includes('环境')) return '🔊'
  if (label.includes('人声')) return '🗣️'
  if (label.includes('混音')) return '🎚️'
  return '🎧'
}

/** 自然排序比较器（S01_B04 < S02_B02 < S10_B01）。 */
function shotIdCompare(a: DialogueClip, b: DialogueClip): number {
  return a.shotId.localeCompare(b.shotId, undefined, { numeric: true, sensitivity: 'base' })
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—'
  if (sec < 10) return `${sec.toFixed(1)}s`
  return `${Math.round(sec)}s`
}

/** 去掉角色名版本/换装后缀，取中文显示名（「沈知意 v1」→「沈知意」）。 */
function stripCharNameSuffix(raw: string): string {
  return raw.replace(/\s*v\d+\s*$/i, '').replace(/\s*(灰底Turnaround|场景换装Turnaround|日常换装Turnaround|休闲换装Turnaround|正装换装Turnaround|换装Turnaround)$/i, '').trim()
}

// ─── 单行内联回放（自带 <audio>，圆形播放/暂停按钮 + 进度条 + 时长） ───────

function DialogueRow({ clip, speakerName, quote = true }: { clip: DialogueClip; speakerName: string; quote?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0~1
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(clip.durationSec || 0)
  const [failed, setFailed] = useState(false)
  const audioUrl = resolveMediaUrl(clip.filePath)

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      if (!el.duration || !isFinite(el.duration)) el.load()
      void el.play().catch(() => setFailed(true))
    }
  }, [playing])

  const onSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el || !el.duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    el.currentTime = ratio * el.duration
    setProgress(ratio)
  }, [])

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const ss = Math.floor(s % 60)
    return `${m}:${ss.toString().padStart(2, '0')}`
  }

  return (
    <div
      data-testid="dialogue-row"
      className="am-dlg-row"
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--cv-bg-card)',
        border: '1px solid var(--cv-line-panel)',
      }}
    >
      {/* 隐藏 audio 引擎 */}
      {audioUrl && (
        <audio
          ref={audioRef}
          preload="metadata"
          src={audioUrl}
          style={{ display: 'none' }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0); setCurrent(0) }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (isFinite(d) && d > 0) setDuration(d)
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget
            setCurrent(el.currentTime)
            if (el.duration) setProgress(el.currentTime / el.duration)
          }}
          onError={() => setFailed(true)}
        />
      )}

      {/* 圆形播放按钮 */}
      <button
        onClick={toggle}
        title={playing ? '暂停' : '播放对白'}
        disabled={!audioUrl}
        style={{
          flex: '0 0 auto',
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: 'none',
          cursor: audioUrl ? 'pointer' : 'not-allowed',
          padding: 0,
          background: audioUrl ? 'var(--cv-mod-audio)' : 'var(--cv-bg-overlay)',
          color: 'var(--cv-text-on-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: audioUrl ? 1 : 0.5,
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>

      {/* 主体 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 镜号 / 情感 / 时长 / 说话人 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span
            className="am-badge"
            style={{ color: 'var(--cv-mod-image)', background: 'var(--cv-mod-image-weak)' }}
          >
            {clip.shotId || '—'}
          </span>
          {clip.emotion && (
            <span className="am-chip" style={{ background: 'var(--cv-mod-audio-weak)', color: 'var(--cv-mod-audio)', borderColor: 'rgba(224,133,71,.3)', padding: '3px 9px' }}>
              💬 {clip.emotion}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--cv-text-tertiary)', fontFamily: 'var(--cv-font-mono)' }}>
            {formatDuration(clip.durationSec)}
          </span>
          <span style={{ flex: 1 }} />
          {speakerName !== clip.speaker && (
            <span style={{ fontSize: 10.5, color: 'var(--cv-text-tertiary)', fontFamily: 'var(--cv-font-mono)' }}>
              {clip.speaker}
            </span>
          )}
        </div>

        {/* 对白原文 / 轨描述 */}
        <div style={{
          fontSize: 13.5,
          lineHeight: 1.7,
          color: 'var(--cv-text-primary)',
          marginBottom: audioUrl ? 8 : 0,
        }}>
          {quote ? `“${clip.text}”` : clip.text}
        </div>

        {/* 进度条 */}
        {audioUrl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              onClick={onSeek}
              title="拖动定位"
              style={{
                flex: '1 1 auto',
                height: 4,
                borderRadius: 2,
                cursor: 'pointer',
                background: failed ? 'var(--cv-bg-overlay)' : 'rgba(255,255,255,0.14)',
                position: 'relative',
                minWidth: 0,
              }}
            >
              <div style={{
                width: `${progress * 100}%`,
                height: '100%',
                borderRadius: 2,
                background: failed ? 'var(--cv-rejected)' : 'var(--cv-mod-audio)',
              }} />
            </div>
            <span style={{
              flex: '0 0 auto',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 10,
              color: failed ? 'var(--cv-rejected)' : 'var(--cv-text-tertiary)',
              fontFamily: 'var(--cv-font-mono)',
              whiteSpace: 'nowrap',
            }}>
              {failed ? '音频加载失败' : `${fmt(current)}/${fmt(duration)}`}
            </span>
          </div>
        )}
        {!audioUrl && (
          <div style={{ fontSize: 10.5, color: 'var(--cv-text-disabled)' }}>无音频文件</div>
        )}
      </div>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────

export default function DialoguePanel({ mode = 'dialogue' }: { mode?: DialoguePanelMode }) {
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const { assets } = useRealAssets(projectId)

  // 1) store graph 抽取
  const storeClips = useMemo(
    () => extractClipsFromGraph(graph, rawDataByNodeId, mode),
    [graph, rawDataByNodeId, mode],
  )

  // 2) store 无对白 → 回退 convert API（与 StoryboardTimeline extraFrameShots 同手法）
  const [extraClips, setExtraClips] = useState<DialogueClip[]>([])
  const hasStoreClips = storeClips.length > 0
  useEffect(() => {
    if (hasStoreClips || !projectId || episodesId == null) return
    let cancelled = false
    void (async () => {
      try {
        const converted = await convertProjectData(projectId, episodesId)
        if (cancelled || !converted?.nodes?.length) return
        const clips = clipsFromRaw(
          converted.nodes.map((n) => ({
            id: n.id,
            raw: (n.data as Record<string, unknown>) ?? {},
          })),
          mode,
        )
        if (!cancelled && clips.length > 0) setExtraClips(clips)
      } catch {
        // 静默
      }
    })()
    return () => { cancelled = true }
  }, [hasStoreClips, projectId, episodesId, mode])

  const clips = useMemo<DialogueClip[]>(() => {
    const all = hasStoreClips ? storeClips : extraClips
    return [...all].sort(shotIdCompare)
  }, [hasStoreClips, storeClips, extraClips])

  // 角色名 / 头像映射（pinyin → 中文 / portrait URL），来自角色设定图（character_concept）。
  // 角色设定图 characterId 为拼音、name 为中文（「沈知意 v1」），与对白 speaker 同形态。
  const { speakerNameMap, speakerPortraitMap } = useMemo(() => {
    const names = new Map<string, string>()
    const portraits = new Map<string, string>()
    for (const a of assets) {
      if (a.type !== 'character') continue
      if ((a.state ?? 'active') === 'eliminated') continue
      const cid = a.characterId
      if (!cid) continue
      const sub = inferSubtype(a)
      if (sub !== 'character_concept') continue
      // 中文名（去版本后缀），isPrimaryView 优先；同名只写一次
      const cn = stripCharNameSuffix(a.name || '')
      if (cn && !names.has(cid)) names.set(cid, cn)
      if (a.filePath && !portraits.has(cid)) {
        const url = resolveMediaUrl(a.filePath)
        // isPrimaryView 优先：覆盖非 primary 的写入
        if (url && (a.isPrimaryView || !portraits.has(cid))) portraits.set(cid, url)
      }
    }
    return { speakerNameMap: names, speakerPortraitMap: portraits }
  }, [assets])

  // 按说话人分组
  const speakers = useMemo(() => {
    const bySpeaker = new Map<string, DialogueClip[]>()
    for (const c of clips) {
      const key = c.speaker || c.characterId || '未知'
      const arr = bySpeaker.get(key)
      if (arr) arr.push(c)
      else bySpeaker.set(key, [c])
    }
    return [...bySpeaker.entries()]
      .map(([id, list]) => ({
        id,
        name: speakerNameMap.get(id) ?? id,
        portrait: speakerPortraitMap.get(id) ?? null,
        count: list.length,
        totalDur: list.reduce((s, c) => s + c.durationSec, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [clips, speakerNameMap, speakerPortraitMap])

  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null)
  // 默认选中第一个说话人（用 effect 在 speakers 就绪后设一次）
  useEffect(() => {
    if (selectedSpeaker == null && speakers.length > 0) {
      setSelectedSpeaker(speakers[0].id)
    }
  }, [speakers, selectedSpeaker])

  const showingAll = selectedSpeaker === '__all__'
  const visibleClips = useMemo(() => {
    if (showingAll) return clips
    if (!selectedSpeaker) return []
    return clips.filter((c) => (c.speaker || c.characterId) === selectedSpeaker)
  }, [clips, selectedSpeaker, showingAll])

  const totalDur = useMemo(() => clips.reduce((s, c) => s + c.durationSec, 0), [clips])
  const engineLabel = useMemo(() => {
    const set = new Set(clips.map((c) => c.engine).filter(Boolean))
    return [...set].sort().join(' / ')
  }, [clips])

  // 空状态
  if (clips.length === 0) {
    return (
      <div className="am-empty">
        {mode === 'stems' ? (
          <>本项目暂无音频轨资产。<br />
            运行管线 P12b（音频合成）后，BGM / 环境音效 / 人声合轨 / 混音母带会自动出现在此处。</>
        ) : (
          <>本项目暂无对白资产。<br />
            运行管线 P10（语音 TTS）后，voice_clips 对白节点会自动出现在此处。</>
        )}
      </div>
    )
  }

  return (
    <div className="am-scene" style={{ gridTemplateColumns: '220px 1fr' }}>
      {/* 左栏：说话角色分组 / 音轨类型分组 */}
      <aside className="am-scene__list">
        <div className="am-head" style={{ padding: '0 4px 8px' }}>
          {mode === 'stems' ? '音轨类型' : '角色'} · {speakers.length}
        </div>

        {/* 全部入口 */}
        <div
          className={`am-scene-card ${showingAll ? 'is-on' : ''}`}
          onClick={() => setSelectedSpeaker('__all__')}
          title={mode === 'stems' ? '展示全部音频轨' : '按镜头顺序展示全部对白'}
        >
          <div className="am-scene-card__ic" style={{ background: 'var(--cv-mod-audio-weak)' }}>
            <span style={{ fontSize: 18 }}>{mode === 'stems' ? '🎚️' : '🎙️'}</span>
          </div>
          <div>
            <b>{mode === 'stems' ? '全部音轨' : '全部对白'}</b>
            <span>{clips.length} 条 · {formatDuration(totalDur)}</span>
          </div>
        </div>

        {/* 各说话人 / 各轨类型 */}
        {speakers.map((s) => (
          <div
            key={s.id}
            className={`am-scene-card ${selectedSpeaker === s.id ? 'is-on' : ''}`}
            onClick={() => setSelectedSpeaker(s.id)}
          >
            <div className="am-scene-card__ic">
              {s.portrait ? (
                <img
                  src={s.portrait}
                  alt={s.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span style={{ fontSize: 18 }}>{stemEmojiOf(s.name)}</span>
              )}
            </div>
            <div>
              <b>{s.name}</b>
              <span>{s.count} 条 · {formatDuration(s.totalDur)}</span>
            </div>
          </div>
        ))}
      </aside>

      {/* 右栏：列表 */}
      <div className="am-scene__main">
        {/* 头部 */}
        <div className="am-scene__head">
          <h1>{showingAll
            ? (mode === 'stems' ? '全部音轨' : '全部对白')
            : (speakers.find((s) => s.id === selectedSpeaker)?.name ?? (mode === 'stems' ? '音频轨' : '对白管理'))}</h1>
          <span className="am-badge">{visibleClips.length} 条</span>
          <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>
            {formatDuration(visibleClips.reduce((s, c) => s + c.durationSec, 0))}
          </span>
        </div>
        <div className="am-scene__hint">
          {mode === 'stems'
            ? 'P12b audio_stems · BGM / 环境音效 / 人声合轨 / 混音母带'
            : 'TTS 对白资产 · P10 voice_clips'}
          {engineLabel && ` · 引擎 ${engineLabel}`}
          {mode === 'dialogue' && !showingAll && selectedSpeaker && selectedSpeaker !== speakerNameMap.get(selectedSpeaker) && (
            <> · 说话人 ID <code style={{ fontFamily: 'var(--cv-font-mono)' }}>{selectedSpeaker}</code></>
          )}
        </div>

        {/* 卡片列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {visibleClips.map((clip) => (
            <DialogueRow
              key={clip.nodeId}
              clip={clip}
              speakerName={speakerNameMap.get(clip.speaker || clip.characterId) ?? clip.speaker}
              quote={mode === 'dialogue'}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
