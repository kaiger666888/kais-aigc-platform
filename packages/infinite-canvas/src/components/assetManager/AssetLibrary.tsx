/**
 * 视图A · 资产库 —— 左栏类型树 + Masonry 卡片网格 + 搜索/标签筛选。
 *
 * 数据来源：真实 `/api/v1/assets-registry/search`（useRealAssets 缓存）。
 * 管线产出的资产经 canvas_sync 自动注册后即出现在此处，无需手动同步。
 * 缩略图从 JOIN o_image 的 filePath 经 resolveMediaUrl 渲染；缺图回退类型 emoji。
 *
 * 三态资产模型：
 *   - 选定 (isPrimaryView=true, state='active') —— 管线下游实际使用的版本，每组仅一个。
 *   - 待选 (isPrimaryView=false, state='active') —— 同组备选变体，未被管线使用。
 *   - 淘汰 (state='eliminated') —— 同组被淘汰的变体，isPrimaryView 必为 false。
 * 切换流转（乐观更新，绝不 reload）：
 *   - 待选→选定：新选资产置 selected，同组旧选定自动淘汰。
 *   - 选定→待选：该资产退回待选，同组淘汰资产自动恢复待选。
 *   - 淘汰→待选：手动恢复。
 *
 * 点击卡片 → openAssetDetail(uuid)（store 驱动切到详情子视图）。
 * 卡片 hover「添加到画布」→ 画布联动（占位 · TODO 待后端 place 端点）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { placeAssetOnCanvas, updateAsset, type AssetDetail } from '../../services/canvasApi'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { useRealAssets } from './useRealAssets'
import DialoguePanel from './DialoguePanel'
import {
  TYPE_LABEL, realTags,
  assetDetailToItem, modalityVar, modalityWeakVar,
  inferLevel, inferSceneId, inferShotId, inferFullShotId, inferSubtype,
  isBeatShotId, shotPrefix, beatShortLabel,
  SUBTYPE_LABEL, SUBTYPE_EMOJI, LEVEL_LABEL,
  type AssetItem, type AssetType, type AssetLevel, type AssetSubtype,
} from './assetManagerData'

type AssetTab = 'selected' | 'candidate' | 'eliminated'

/** 分镜列表 shot→beat 两级节点。shotId 为 S 前缀（S01）；beats 为其下 beat 行（S01_B01）。
 *  n = 该 shot 下所有资产数（含 beat 级）；beats 可为空（shot 级资产无 beat 细分）。 */
interface ShotGroupNode {
  shotId: string
  beats: { id: string; n: number }[]
  n: number
}

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

/** 缩略图：优先 filePath 真图，加载失败/缺图回退类型 emoji。
 *  声纹卡片：左侧展示角色设定图 + 右侧音频播放器（左右分栏）。
 */
// 声纹卡片底部紧凑播放条：圆形播放/暂停按钮 + 进度条 + 时长。
// 自定义渲染（非原生 <audio controls>）以便完全控制尺寸：整体高 28px，
// 确保声纹卡片 thumb 压到 ~220px，整张卡片 < 300px，始终在 .am-scroll 可视区内。
function VoicePlayBar({ audioUrl }: { audioUrl: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)   // 0~1
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause() } else { if (!el.duration || !isFinite(el.duration)) el.load(); void el.play().catch(() => {}) }
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
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        pointerEvents: 'auto',
        background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 60%, transparent 100%)',
        padding: '7px 8px 7px',
        display: 'flex', alignItems: 'center', gap: '7px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 隐藏的真实 audio 元素，仅作播放引擎 */}
      <audio
        ref={audioRef}
        preload="metadata"
        src={audioUrl}
        style={{ display: 'none' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrent(0) }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget
          setCurrent(el.currentTime)
          if (el.duration) setProgress(el.currentTime / el.duration)
        }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? '暂停' : '播放'}
        style={{
          flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%',
          border: 'none', cursor: 'pointer', padding: 0,
          background: 'rgba(255,255,255,0.92)', color: '#111',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {playing ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div
        onClick={onSeek}
        style={{
          flex: '1 1 auto', height: 4, borderRadius: 2, cursor: 'pointer',
          background: 'rgba(255,255,255,0.28)', minWidth: 0, position: 'relative',
        }}
      >
        <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 2, background: 'rgba(255,255,255,0.92)' }} />
      </div>
      <span style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', fontSize: 9.5, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--cv-font-mono)' }}>
        {fmt(current)}/{fmt(duration)}
      </span>
    </div>
  )
}

function Thumb({ item, portraitUrl }: { item: AssetItem; portraitUrl?: string | null }) {
  const [broken, setBroken] = useState(false)
  const [portraitBroken, setPortraitBroken] = useState(false)
  // 声纹资产：从 meta 提取 ref_audio_path → 左角色图 + 右播放器
  if (item.type === 'voice' || item.type === 'audio') {
    let audioPath: string | null = null
    if (item.meta) {
      try {
        const m = typeof item.meta === 'string' ? JSON.parse(item.meta) : item.meta
        audioPath = m?.ref_audio_path ?? null
      } catch { /* meta 非 JSON */ }
    }
    if (!audioPath) audioPath = item.filePath ?? null
    const audioUrl = resolveMediaUrl(audioPath)
    if (audioUrl) {
      return (
        // 绝对定位填满 .am-card__thumb（其 position:relative）。
        // 用 inset:0 而非 width/height:100%：父级是 display:grid;place-items:center，
        // 百分比高度在此布局下解析不稳定（无肖像图时容器会塌缩为 0，播放条飘到卡片中段被裁剪），
        // inset:0 让根容器恒等于 thumb 的尺寸 → 播放条 bottom:0 必然贴在卡片底边。
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          {/* 底层：角色设定图铺满整个卡片 */}
          {portraitUrl && !portraitBroken && (
            <img
              src={portraitUrl}
              alt={item.name}
              loading="lazy"
              onError={() => setPortraitBroken(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
          {/* 底部播放条 overlay：覆盖在角色照片底部，紧贴卡片底边（bottom:0）。
              用自定义紧凑播放按钮 + 进度条替代原生 <audio controls>：
              原生控件最小渲染高度 ~30px 且在窄卡（195px）里裁剪严重，
              自定义按钮高 28px、宽仅 ~100px，声纹卡片整体高度可压到 ~256px，
              确保播放条始终在 .am-scroll 可视区域内（不再被 overflow 裁剪 → elementFromPoint 不再返回 null）。 */}
          <VoicePlayBar audioUrl={audioUrl} />
        </div>
      )
    }
  }
  const url = item.filePath ? resolveMediaUrl(item.filePath) : null
  if (url && !broken) {
    return (
      <img
        className="am-card__img"
        src={url}
        alt={item.name}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  return <span className="am-card__emoji">{item.emoji}</span>
}

/**
 * 分组键 —— 决定"哪几个资产互为同一角色的变体"。
 * 角色：characterId = "shenzhiyi" / "luyanzhou"；场景：characterId 存场景 ID 如 "S01"。
 * 角色类资产（character/turnaround 等）一律按 characterId 统一分组，不拼接 type ——
 * 这样同一角色的 turnaround_sheet / character_design / 3d_model 全归入同一组，
 * 否则不同 type 会被拆成多组、各组各选一个 primary，导致一个角色多张图进入选定资产。
 */
function getGroupKey(d: AssetDetail): string {
  // keyframe（首尾帧）按 characterId + name 前缀分组
  // 例如 S01_first_v1 和 S01_last_v1 是不同的帧，不应混在一组
  if (d.type === 'keyframe' && d.characterId) {
    // name 形如 "S01_first_v1"，取 _v 前的部分作为子组键
    const base = d.name?.replace(/_v\d+$/, '') || ''
    return `keyframe:${d.characterId}:${base}`
  }
  // 角色类资产（character/turnaround 等）一律按 characterId 统一分组
  if (d.characterId) {
    return `char:${d.characterId}`
  }
  // 场景类资产按 name 分组
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    return `scene:${d.name}`
  }
  return `${d.type}:${d.name}`
}

/**
 * 分组可读标题 + 图标 —— 仅用于待选资产分组的展示，不参与三态流转逻辑。
 * 根据 getGroupKey 的前缀推断分组类型，给出人眼可读的标题与表情图标。
 */
function getGroupDisplayInfo(d: AssetDetail): { title: string; emoji: string } {
  const key = getGroupKey(d)
  if (key.startsWith('char:')) {
    // 角色名：从 name 字段提取（去掉 v1 后缀）
    const name = (d.name || '').replace(/\s*v\d+\s*$/i, '').trim() || d.characterId || key
    return { title: name, emoji: '🎭' }
  }
  if (key.startsWith('scene:')) {
    return { title: d.name || key, emoji: '🏠' }
  }
  if (key.startsWith('keyframe:')) {
    // keyframe:CHARID:BASE → 提取 BASE（shot_id 前缀）
    const parts = key.split(':')
    const base = parts[2] || d.name || key
    return { title: base, emoji: '🎬' }
  }
  return { title: d.name || key, emoji: '📦' }
}

/** 待选资产分组容器（同组变体并列展示，便于对比选择）。 */
interface CandidateGroup {
  key: string
  title: string
  emoji: string
  items: AssetDetail[]
}

/** 分组排序优先级：角色(char:) > 场景(scene:) > 分镜(keyframe:) > 其他。 */
const groupOrder = (key: string): number => {
  if (key.startsWith('char:')) return 0
  if (key.startsWith('scene:')) return 1
  if (key.startsWith('keyframe:')) return 2
  return 3
}

/**
 * 始终在层级树显示的子类型条目（即使 DB 暂无数据，也以 count=0 灰色不可点击呈现）。
 * 对应 Kai 管线中尚未注册到 o_assets 的中间产物：②灰底 Turnaround / ⑦分镜级 Turnaround。
 * （④三视角已废弃，不再常驻显示。）
 */
const ALWAYS_SHOW_SUBTYPES: ReadonlySet<AssetSubtype> = new Set([
  'character_concept',
  'turnaround_sheet', 'costume_turnaround',
  // Notion 新资产类型占位（count=0 时灰色显示，让用户知道这些分类存在）
  'scene_blueprint', 'scene_temporal_variant', 'scene_view_angle',
  'costume_temporal_variant', 'midframe',
  'foley_stem', 'bgm_track',
  // Notion 文档型资产（创作需求/故事框架/分集剧本/场景设定/服化道/音色总谱/BGM总谱）
  'pipeline_requirement', 'story_framework', 'episode_script',
  'scene_design', 'costume_design', 'voice_profile', 'bgm_design',
  // 管线产出（P06+）：count=0 时也以灰色不可点击显示，让用户知道分类存在
  'spatio_temporal_script', 'shot_list', 'video_clips', 'master_timeline', 'master_mp4',
])

export default function AssetLibrary() {
  const rawOpenAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const rawCloseAssetDetail = useCanvasStore((s) => s.closeAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  // 对白资产（P10 voice_clips）不在 assets-registry，而是存在于 canvas graph，
  // 与 DialoguePanel / StoryboardTimeline 同源，故直接消费 store 的 graph。
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)

  // 打开 / 关闭资产详情都是导航交互 → 先拍快照进应用历史栈（navPushCallback 由 FlowCanvas 注入）。
  const openAssetDetail = useCallback((uuid: string) => {
    useCanvasStore.getState().navPushCallback?.()
    rawOpenAssetDetail(uuid)
  }, [rawOpenAssetDetail])
  const closeAssetDetail = useCallback(() => {
    useCanvasStore.getState().navPushCallback?.()
    rawCloseAssetDetail()
  }, [rawCloseAssetDetail])

  const { assets, loading, error, reload, patchLocal } = useRealAssets(projectId)

  const [tab, setTab] = useState<AssetTab>('selected')
  const [typeFilter, setTypeFilter] = useState<AssetType | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // ── 层级树筛选状态 ──
  // levelFilter: null=全部；entityFilter: 选中的具体实体（角色/场景/分镜/子类型）。
  type EntityFilter =
    | { type: 'character'; id: string }
    | { type: 'scene'; id: string }
    | { type: 'shot'; id: string }
    | { type: 'subtype'; id: AssetSubtype }
    | { type: 'dialogue' }
    | null
  const [levelFilter, setLevelFilter] = useState<AssetLevel | null>(null)
  const [entityFilter, setEntityFilter] = useState<EntityFilter>(null)
  // 各层级 section 的折叠状态（默认全展开）
  const [collapsedLevels, setCollapsedLevels] = useState<Set<AssetLevel>>(new Set())
  const toggleLevel = useCallback((lv: AssetLevel) => {
    setCollapsedLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lv)) next.delete(lv)
      else next.add(lv)
      return next
    })
  }, [])
  // 分镜级内「分镜列表」(S01–S44) 折叠父节点的展开状态（默认展开，保持原有可见性）
  const [shotListCollapsed, setShotListCollapsed] = useState(false)
  // 分镜列表中各 shot 节点（S01）的展开/折叠状态：默认全部折叠（点击 ▼ 展开 beat 行）
  const [expandedShots, setExpandedShots] = useState<Set<string>>(new Set())

  const tags = useMemo(() => realTags(assets.map(assetDetailToItem)), [assets])

  const filtered = useMemo(() => assets.filter((d) => {
    if (typeFilter && d.type !== typeFilter) return false
    if (tagFilter) {
      const dt = d.tags ? d.tags.split(',').map((s) => s.trim()) : []
      if (!dt.includes(tagFilter)) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const hay = `${d.name ?? ''} ${d.describe ?? ''} ${d.prompt ?? ''} ${d.tags ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    // 层级筛选
    if (levelFilter && inferLevel(d) !== levelFilter) return false
    // 实体筛选
    if (entityFilter) {
      if (entityFilter.type === 'character') {
        // id === '' 表示"全部角色"，仅校验层级已在上面完成
        if (entityFilter.id !== '' && d.characterId !== entityFilter.id) return false
        // 角色列表含角色设定图（①）+ 角色文字设定（Notion 导入纯文本 character_bible）；
        // 灰底 Turnaround 等另由 subtype 条目进入。
        if (inferSubtype(d) !== 'character_concept' && inferSubtype(d) !== 'character_bible') return false
      } else if (entityFilter.type === 'scene') {
        if (inferSceneId(d) !== entityFilter.id) return false
      } else if (entityFilter.type === 'shot') {
        // 兼容 shot 级（S01）与 beat 级（S01_B01）两种 entityFilter：
        //   - beat 级 id（含 _B）→ 用 inferFullShotId 精确匹配
        //   - shot 级 id（S01）→ 用 inferShotId 前缀匹配（该 shot 下全部资产含其 beats）
        if (isBeatShotId(entityFilter.id)) {
          if (inferFullShotId(d) !== entityFilter.id) return false
        } else {
          if (inferShotId(d) !== entityFilter.id) return false
        }
      } else if (entityFilter.type === 'subtype') {
        if (inferSubtype(d) !== entityFilter.id) return false
      }
    }
    return true
  }), [assets, typeFilter, tagFilter, search, levelFilter, entityFilter])

  // 按 tab 拆分三态：选定 / 待选 / 淘汰。
  // isPrimaryView 从 SQLite 返回的是整数 0/1，需用 !! 转换；state 为 'eliminated' 即淘汰。
  const tabFiltered = useMemo(() => {
    return filtered.filter((d) => {
      if (tab === 'selected') return !!d.isPrimaryView && d.state !== 'eliminated'
      if (tab === 'eliminated') return d.state === 'eliminated'
      return !d.isPrimaryView && d.state !== 'eliminated' // candidate
    })
  }, [filtered, tab])

  // 待选资产按 getGroupKey 分组 —— 让用户一眼识别同组变体、便于对比选择。
  // 仅 candidate tab 启用；selected（每组仅 1 张无对比需求）/eliminated（回收站）仍是平铺网格。
  const candidateGroups = useMemo<CandidateGroup[]>(() => {
    if (tab !== 'candidate') return []
    const map = new Map<string, AssetDetail[]>()
    for (const d of tabFiltered) {
      const key = getGroupKey(d)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    const groups: CandidateGroup[] = []
    for (const [key, items] of map) {
      const info = getGroupDisplayInfo(items[0])
      groups.push({ key, title: info.title, emoji: info.emoji, items })
    }
    // 层级优先（角色>场景>分镜>其他），同层级内按 title 自然序。
    groups.sort((a, b) => {
      const ord = groupOrder(a.key) - groupOrder(b.key)
      if (ord !== 0) return ord
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
    return groups
  }, [tabFiltered, tab])

  // 自动初始化：确保每个 characterId 组恰好有一个选定资产。
  // 用 ref 防重入 — 只跑一次，避免 reload → assets 变化 → effect 再跑 → 死循环。
  const initRef = useRef<string | null>(null)
  useEffect(() => {
    if (loading || assets.length === 0) return

    // 用 projectId 做初始化 key，不同项目各跑一次
    const initKey = String(projectId ?? 'global')
    if (initRef.current === initKey) return
    initRef.current = initKey

    const groups = new Map<string, AssetDetail[]>()
    for (const d of assets) {
      const key = getGroupKey(d)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(d)
    }

    const needsInit: number[] = []
    for (const group of groups.values()) {
      // 选定只能从非淘汰资产里挑；淘汰的不参与自动选定。
      const activeGroup = group.filter((d) => d.state !== 'eliminated')
      const hasPrimary = activeGroup.some((d) => !!d.isPrimaryView)
      // 场景资产不自动选定——由用户手动选择
      const isSceneGroup = activeGroup.some((d) => d.type === 'scene')
      // 声纹资产也不自动选定——由用户手动选择
      const isVoiceGroup = activeGroup.some((d) => d.type === 'voice' || d.type === 'audio')
      if (!hasPrimary && activeGroup.length > 0 && !isSceneGroup && !isVoiceGroup) {
        needsInit.push(activeGroup[0].id)
      }
    }

    if (needsInit.length > 0) {
      void (async () => {
        for (const id of needsInit) {
          try { await updateAsset(id, { isPrimaryView: true }) } catch { /* 忽略单项失败 */ }
        }
        await reload()
      })()
    }
  }, [assets, loading, projectId, reload])

  // 过滤掉淘汰资产——左侧树只统计 active 资产（淘汰资产仍在「淘汰」tab 卡片区显示）。
  // filtered/tabFiltered 不改，它们负责右侧卡片筛选。
  const activeAssets = useMemo(
    () => assets.filter((d) => d.state !== 'eliminated'),
    [assets]
  )

  const countAll = activeAssets.length

  // 角色设定图 URL 映射（角色中文名 → 设定图 URL），供声纹卡片左侧展示。
  // 声纹 characterId 是中文名（"沈知意"），角色资产 characterId 是拼音（"shenzhiyi"），
  // 通过角色名称去版本后缀（"沈知意 v1" → "沈知意"）建立中文名 → 图片 URL 的映射。
  // 优先用 character_concept，其次用选定的 turnaround_sheet（灰底整图也是有效的角色形象参考）。
  const charPortraitMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of activeAssets) {
      const st = inferSubtype(d)
      if (st !== 'character_concept' && st !== 'turnaround_sheet') continue
      if (!d.filePath) continue
      const cnName = (d.name || '').replace(/\s*v\d+\s*$/i, '').trim()
      if (!cnName) continue
      const url = resolveMediaUrl(d.filePath)
      // character_concept 优先；turnaround_sheet 仅在尚无映射时填充
      if (url && (st === 'character_concept' || !m.has(cnName))) {
        m.set(cnName, url)
      }
    }
    return m
  }, [activeAssets])

  // ── 层级树数据（useMemo 派生） ──
  // 全剧级 · 角色列表：角色设定图（①）+ 角色文字设定（character_bible，无图），
  // 按 characterId 分组，附带可读角色名。名称优先级：设定图（①）> 主文字设定
  // （name 含 character_bible，去掉 "- character_bible" 后缀）> 服化道等兜底名。
  const showCharacters = useMemo(() => {
    const counts = new Map<string, number>()
    const conceptNames = new Map<string, string>()
    const bibleNames = new Map<string, string>()
    const fallbackNames = new Map<string, string>()
    // 清理资产名为可读角色名：去版本后缀 + 去 Notion " - character_bible" 后缀。
    const cleanName = (s: string) =>
      s.replace(/\s*-\s*character_bible\s*$/i, '').replace(/\s*v\d+$/i, '').trim()
    for (const d of activeAssets) {
      if (inferLevel(d) !== 'show') continue
      const st = inferSubtype(d)
      if (st !== 'character_concept' && st !== 'character_bible') continue
      if (!d.characterId) continue
      counts.set(d.characterId, (counts.get(d.characterId) ?? 0) + 1)
      const nm = cleanName(d.name || '')
      if (!nm) continue
      let sink: Map<string, string>
      if (st === 'character_concept') sink = conceptNames
      else if ((d.name || '').toLowerCase().includes('character_bible')) sink = bibleNames
      else sink = fallbackNames
      if (!sink.has(d.characterId)) sink.set(d.characterId, nm)
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, label: conceptNames.get(id) ?? bibleNames.get(id) ?? fallbackNames.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [activeAssets])

  // 角色设定图概念图：从全量资产（含 eliminated）中提取——
  // 旧版 v1/v2/v3 概念图虽被淘汰，但它们是项目中唯一代表「角色设定图」的图片，
  // 按 Kai 资产管理设计原则：左栏=生产导向平铺所有三态。
  const characterConceptAssets = useMemo(
    () => assets.filter((d) => inferSubtype(d) === 'character_concept'),
    [assets]
  )
  // 服化道设定：同理从全量（含 eliminated）统计——这些是角色服装设计文档，
  // 因三态分组（按 characterId 与概念图同组）常被一并标为淘汰，但仍是项目唯一的
  // 服化道记录，左栏按「平铺所有三态」原则计数（节点点击后在「淘汰资产」tab 可见）。
  const costumeDesignAssets = useMemo(
    () => assets.filter((d) => inferSubtype(d) === 'costume_design'),
    [assets]
  )

  // 全子类型计数（驱动各层级固定条目 + count 徽标）
  const subtypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of activeAssets) {
      const st = inferSubtype(d)
      counts[st] = (counts[st] ?? 0) + 1
    }
    // character_concept / costume_design 从全量（含 eliminated）统计
    counts['character_concept'] = characterConceptAssets.length
    counts['costume_design'] = costumeDesignAssets.length
    return counts
  }, [activeAssets, characterConceptAssets, costumeDesignAssets])
  const sub = useCallback((st: AssetSubtype): number => subtypeCounts[st] ?? 0, [subtypeCounts])

  // 场景级 · 场景设定图列表（③）：仅 scene_base，按场景名分组
  const sceneGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of activeAssets) {
      if (inferLevel(d) !== 'scene') continue
      if (inferSubtype(d) !== 'scene_base') continue
      const sid = inferSceneId(d)
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [activeAssets])

  // 分镜级 · 首尾帧列表（⑧⑨）—— shot→beat 两级分组：
  //   ① 从 canvas graph 的 storyboard 节点（P09 shot_list）提取完整 shot_id（含 beat），
  //      得到「某 shot 下有哪些 beat」的权威结构，即使该 beat 暂无 keyframe 资产。
  //   ② 从 o_assets keyframe（inferFullShotId，保留 _B 后缀）统计每个 shot/beat 的资产数。
  //   shot 级（S01，无 _B）作为父节点；beat 级（S01_B01）作为子节点。
  const shotGroups = useMemo<ShotGroupNode[]>(() => {
    // 资产数量：按完整 shotId（含 beat）统计
    const counts = new Map<string, number>()
    for (const d of activeAssets) {
      if (inferLevel(d) !== 'shot') continue
      const sid = inferFullShotId(d)
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    // 从 graph 提取所有 beat 级 shot_id（S01_B01），用于补全 shot 结构
    const beatSet = new Set<string>()        // 所有 beat 级 id（S01_B01）
    if (graph) {
      for (const node of graph.nodes) {
        if (node.kind !== 'asset' || node.stage !== 'storyboard') continue
        const raw = rawDataByNodeId?.get(node.id) ?? {}
        const sid = typeof raw.shot_id === 'string' ? raw.shot_id : null
        if (!sid) continue
        if (isBeatShotId(sid)) {
          beatSet.add(sid)
        }
      }
    }
    // 构造 shot → beats 两级结构
    const groupMap = new Map<string, ShotGroupNode>()
    const natCmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    const getGroup = (shotId: string): ShotGroupNode => {
      let g = groupMap.get(shotId)
      if (!g) { g = { shotId, beats: [], n: 0 }; groupMap.set(shotId, g) }
      return g
    }
    // 资产驱动的分组（o_assets keyframe）
    for (const [fullId, n] of counts) {
      if (isBeatShotId(fullId)) {
        const pre = shotPrefix(fullId)
        const g = getGroup(pre)
        g.beats.push({ id: fullId, n })
        g.n += n
      } else {
        // shot 级资产（无 _B）
        const g = getGroup(fullId)
        g.n += n
      }
    }
    // graph 驱动：把 beatSet 中尚未被 keyframe 统计覆盖的 beat 补进对应 shot
    for (const beatId of beatSet) {
      const pre = shotPrefix(beatId)
      const g = getGroup(pre)
      const exists = g.beats.some((b) => b.id === beatId)
      if (!exists) g.beats.push({ id: beatId, n: counts.get(beatId) ?? 0 })
    }
    // 排序：shot 级按自然序；每组内 beats 按 B 序自然序
    const groups = [...groupMap.values()]
    for (const g of groups) g.beats.sort((a, b) => natCmp(a.id, b.id))
    groups.sort((a, b) => natCmp(a.shotId, b.shotId))
    return groups
  }, [activeAssets, graph, rawDataByNodeId])

  // 分镜级 · 对白数（P10 voice_clips：canvas graph 中 clip_type='dialogue' 的 audio 节点）。
  // 对白不在 assets-registry，与 DialoguePanel 同源从 store graph 抽取。
  // 识别与 DialoguePanel.clipsFromRaw 对齐：clip_type='dialogue' 或 assetType='voice'（且非空 text）。
  const dialogueCount = useMemo(() => {
    if (!graph) return 0
    let n = 0
    for (const node of graph.nodes) {
      const raw = rawDataByNodeId?.get(node.id) ?? {}
      if (raw.clip_type !== 'dialogue' && raw.assetType !== 'voice') continue
      const text = raw.text as string | undefined
      if (!text || !String(text).trim()) continue
      n++
    }
    return n
  }, [graph, rawDataByNodeId])

  // 各层级 section 计数（仅统计归属本 section 的资产）
  const showCount = sub('character_concept') + sub('turnaround_sheet') + sub('turnaround_view')
  // 场景级 = 场景设定图(③)（三视角已废弃，不再计入）
  const sceneCount = sub('scene_base')
  // 分镜级：首尾帧 + 场景角度图 + 人物定妆（三视角不再出现在分镜级）
  const shotCount =
    sub('keyframe_first') + sub('keyframe_last') + sub('scene_angle_shot') +
    sub('costume_turnaround')
  // 管线产出（P06+）：时空剧本 / 分镜参数 / E-Konte / 语音 / 快速预览 / 视频 / 合成母版 / 混音 / 成品 / 交付包
  const pipelineCount =
    sub('spatio_temporal_script') + sub('shot_list') + sub('e_konte') +
    sub('voice_clips') + sub('rapid_preview') + sub('video_clips') +
    sub('master_timeline') + sub('audio_stems') + sub('master_mp4') +
    sub('delivery_package')

  // ── 层级树 subtype 条目渲染辅助 ──
  const subtypeOn = (st: AssetSubtype) => entityFilter?.type === 'subtype' && entityFilter.id === st
  const clickSubtype = (st: AssetSubtype) => {
    setLevelFilter(null); setEntityFilter({ type: 'subtype', id: st })
    setTypeFilter(null); setTagFilter(null)
  }
  /** 渲染一个 subtype 条目；count=0 时仅 ALWAYS_SHOW 子类型以灰色不可点击显示。 */
  const renderSubtypeNode = (st: AssetSubtype, always = false) => {
    const n = sub(st)
    const empty = n === 0
    if (empty && !always && !ALWAYS_SHOW_SUBTYPES.has(st)) return null
    const showEmpty = empty && (always || ALWAYS_SHOW_SUBTYPES.has(st))
    return (
      <button
        key={st}
        className={`am-tree-node am-tree-node--child ${subtypeOn(st) ? 'is-on' : ''} ${showEmpty ? 'is-empty' : ''}`}
        disabled={showEmpty}
        onClick={showEmpty ? undefined : () => clickSubtype(st)}
      >
        <span className="am-tree-node__ic">{SUBTYPE_EMOJI[st]}</span>{SUBTYPE_LABEL[st]}
        <span className="am-tree-node__n">{n}</span>
      </button>
    )
  }

  const handleAddToCanvas = async (a: AssetItem) => {
    if (!projectId || episodesId == null) {
      showToast('请先在顶栏选择项目和剧集，再添加到画布', 'warning')
      return
    }
    // TODO(backend): placeAssetOnCanvas 真实持久化待 POST /api/v1/assets/:uuid/place 落地。
    await placeAssetOnCanvas(projectId, episodesId, a.uuid)
    showToast(`已添加到画布 · ${a.name}（占位 · 待后端 place 端点）`, 'success')
  }

  // 【资产↔画布交叉联动】从资产库卡片「定位」到画布上对应节点（asset-{id}）并高亮。
  // 拍历史快照 → 设 focusAssetNodeId（画布侧 useEffect 监听并 fitView + 闪烁）→ 切画布视图。
  // 资产未放置时由画布侧 toast 提示（节点不存在）。
  const handleLocateOnCanvas = useCallback((a: AssetItem) => {
    const nodeId = `asset-${a.id}`
    const store = useCanvasStore.getState()
    store.navPushCallback?.()
    store.setFocusAssetNodeId(nodeId)
    store.setViewMode('canvas')
  }, [])

  // 待选→选定：新选资产置 selected，同组其余所有变体自动淘汰（三态流转）。
  // 全程乐观更新——绝不 reload（避免列表闪烁/跳顶），仅在后端失败时回滚。
  const handleSelect = async (assetId: number, groupKey: string) => {
    const sameGroup = assets.filter((d) => getGroupKey(d) === groupKey)
    // 同组中除新选资产外的所有其他变体（旧选定 + 待选）全部淘汰
    const others = sameGroup.filter((d) => d.id !== assetId)

    // 1. 乐观更新 UI：其余变体 → 淘汰；新选 → 选定。
    for (const d of others) {
      patchLocal(d.id, { isPrimaryView: false, state: 'eliminated' })
    }
    patchLocal(assetId, { isPrimaryView: true, state: 'active' })

    // 2. 后端同步（不 reload；失败时整体回滚到真实状态）。
    try {
      for (const d of others) {
        try { await updateAsset(d.id, { isPrimaryView: false, state: 'eliminated' }) } catch { /* 忽略单项失败 */ }
      }
      await updateAsset(assetId, { isPrimaryView: true, state: 'active' })
      showToast('已设为选定资产，其余变体已自动淘汰', 'success')
    } catch (err) {
      showToast('设置失败: ' + (err as Error).message, 'error')
      await reload()
    }
  }

  // 单张资产卡片渲染（selected / candidate / eliminated 三 tab 完全共用同一份 JSX，
  // 仅外层容器不同：candidate 套分组容器，其余平铺网格）。
  const renderCard = (d: AssetDetail) => {
    const a = assetDetailToItem(d)
    // 无图文档型资产：用更精确的子类型 emoji 替代类型默认 emoji（👤/📦），
    // 让 Notion 文档（创作需求/故事框架/分集剧本/场景设定/服化道/音色总谱/BGM总谱/角色文字设定）
    // 一眼可辨为文字资产，而非误判为「缺图的角色设定图 / 通用占位」。
    if (!a.filePath) {
      const st = inferSubtype(d)
      if (st !== 'unknown') a.emoji = SUBTYPE_EMOJI[st]
    }
    const groupKey = getGroupKey(d)
    const isKey = a.type === 'prop_key'
    return (
      <div
        key={a.uuid}
        className="am-card"
        data-uuid={a.uuid}
        style={cssVars({ '--cardc': `var(${modalityVar(a.modality)})`, '--cardw': `var(${modalityWeakVar(a.modality)})` })}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); openAssetDetail(a.uuid) }}
      >
        {/* 选定资产徽标 */}
        {a.isPrimaryView && <span className="am-card__primary-flag">★ 选定</span>}

        {isKey && <span className="am-card__keyflag">🔒 关键</span>}
        {a.reuses ? <span className="am-card__reuse am-badge am-badge--reuse">{a.reuses} 集</span> : null}

        <button
          className="am-card__add"
          onClick={(e) => { e.stopPropagation(); void handleAddToCanvas(a) }}
          title="添加到当前画布"
        >＋ 画布</button>

        {/* 【资产↔画布交叉联动】定位到画布上对应节点（未放置时画布侧 toast 提示） */}
        <button
          className="am-card__locate"
          onClick={(e) => { e.stopPropagation(); handleLocateOnCanvas(a) }}
          title="在画布上定位此资产"
        >📍 定位</button>

        {/* 待选资产 tab 下显示「设为选定」按钮 */}
        {tab === 'candidate' && (
          <button
            className="am-card__select-btn"
            onClick={(e) => { e.stopPropagation(); void handleSelect(d.id, groupKey) }}
            title="设为选定资产（同组仅保留一个）"
          >★ 选定</button>
        )}

        {/* 选定资产 tab 下显示「取消选定」按钮（退回待选，同组淘汰自动恢复） */}
        {tab === 'selected' && (
          <button
            className="am-card__deselect-btn"
            onClick={async (e) => {
              e.stopPropagation()
              // 同组被淘汰的兄弟变体（不含自身）将随取消选定一并恢复为待选。
              const eliminated = assets.filter(
                (dd) => getGroupKey(dd) === groupKey && dd.id !== d.id && dd.state === 'eliminated',
              )
              // 乐观更新 UI：该资产 → 待选；同组淘汰 → 恢复待选。
              patchLocal(d.id, { isPrimaryView: false, state: 'active' })
              for (const dd of eliminated) patchLocal(dd.id, { state: 'active' })
              // 后端同步（不 reload；失败时回滚）。
              try {
                await updateAsset(d.id, { isPrimaryView: false, state: 'active' })
                for (const dd of eliminated) {
                  try { await updateAsset(dd.id, { state: 'active' }) } catch { /* 忽略单项失败 */ }
                }
                showToast('已退回待选资产', 'success')
              } catch (err) {
                showToast('操作失败: ' + (err as Error).message, 'error')
                await reload()
              }
            }}
            title="退回待选资产（同组淘汰将一并恢复）"
          >✕ 取消选定</button>
        )}

        {/* 淘汰资产 tab 下显示「恢复待选」按钮 */}
        {tab === 'eliminated' && (
          <button
            className="am-card__select-btn"
            onClick={async (e) => {
              e.stopPropagation()
              // 乐观更新 UI：淘汰 → 待选。
              patchLocal(d.id, { state: 'active', isPrimaryView: false })
              try {
                await updateAsset(d.id, { state: 'active' })
                showToast('已恢复到待选', 'success')
              } catch (err) {
                showToast('恢复失败: ' + (err as Error).message, 'error')
                await reload()
              }
            }}
            title="恢复到待选资产"
          >↻ 恢复</button>
        )}

        <div
          className="am-card__thumb"
          style={(a.type === 'voice' || a.type === 'audio') ? { aspectRatio: 'auto', height: 200 } : undefined}
        ><Thumb item={a} portraitUrl={a.type === 'voice' || a.type === 'audio' ? (a.characterId ? charPortraitMap.get(a.characterId) : null) : null} /></div>
        <div className="am-card__typebar" />
        <div className="am-card__body">
          <div className="am-card__name">{a.name}</div>
          <div className="am-card__meta">
            <span className="am-card__typetag">{TYPE_LABEL[a.type] ?? a.type}</span>
            <span className="am-card__scope">{a.scope === 'library' ? '全局资产' : '项目资产'}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="am-lib">
      {/* 左栏层级树（Show → Scene → Shot） */}
      <aside className="am-tree">
        <div className="am-tree-group">
          <div className="am-tree-group__h"><span>资产层级</span></div>
          <button
            className={`am-tree-node ${!levelFilter && !entityFilter && !typeFilter ? 'is-on' : ''}`}
            onClick={() => {
              setLevelFilter(null); setEntityFilter(null)
              setTypeFilter(null); setTagFilter(null)
            }}
          >
            <span className="am-tree-node__ic">▦</span>全部<span className="am-tree-node__n">{countAll}</span>
          </button>
        </div>

        {/* ── 全剧级 (Show) ── */}
        <div className="am-tree-section">
          <button
            className="am-tree-node am-tree-node--parent"
            onClick={() => toggleLevel('show')}
          >
            <span className={`am-tree-toggle ${collapsedLevels.has('show') ? 'is-collapsed' : 'is-expanded'}`}>▼</span>
            <span className="am-tree-node__ic">🎭</span>{LEVEL_LABEL.show}
            <span className="am-tree-node__n">{showCount}</span>
          </button>
          {!collapsedLevels.has('show') && (
            <div className="am-tree-children">
              {showCharacters.length > 0 && (
                <>
                  <button
                    className={`am-tree-node am-tree-node--child ${entityFilter?.type === 'character' && !entityFilter.id ? 'is-on' : ''}`}
                    onClick={() => {
                      setLevelFilter('show'); setEntityFilter({ type: 'character', id: '' })
                      setTypeFilter('character'); setTagFilter(null)
                    }}
                  >
                    <span className="am-tree-node__ic">👥</span>全部角色
                    <span className="am-tree-node__n">{showCharacters.reduce((s, c) => s + c.n, 0)}</span>
                  </button>
                  {showCharacters.map((c) => (
                    <button
                      key={c.id}
                      className={`am-tree-node am-tree-node--grandchild ${entityFilter?.type === 'character' && entityFilter.id === c.id ? 'is-on' : ''}`}
                      onClick={() => {
                        setLevelFilter('show'); setEntityFilter({ type: 'character', id: c.id })
                        setTypeFilter('character'); setTagFilter(null)
                      }}
                    >
                      <span className="am-tree-node__ic">·</span>{c.label}
                      <span className="am-tree-node__n">{c.n}</span>
                    </button>
                  ))}
                </>
              )}
              {/* ① 角色设定图（有数据才显示） */}
              {renderSubtypeNode('character_concept')}
              {/* ② 灰色紧身衣 Turnaround —— 始终显示，DB 无数据时 count=0 灰色不可点击 */}
              {renderSubtypeNode('turnaround_sheet', true)}
              {/* ③ 声纹参考（角色声纹，全剧级资产） */}
              {renderSubtypeNode('voice_print', true)}
              {/* Notion 文档型资产 · 音频总谱（全剧级） */}
              {renderSubtypeNode('voice_profile', true)}
              {renderSubtypeNode('bgm_design', true)}
              {/* Notion 文档型资产 · 创作文档（全剧级 / 分集级） */}
              {renderSubtypeNode('pipeline_requirement', true)}
              {renderSubtypeNode('story_framework', true)}
              {renderSubtypeNode('episode_script', true)}
              {/* 服化道设定（角色级，按 characterId 归属各角色；DB type=character，无图文档） */}
              {renderSubtypeNode('costume_design', true)}
            </div>
          )}
        </div>

        {/* ── 场景级 (Scene) ── */}
        <div className="am-tree-section">
          <button
            className="am-tree-node am-tree-node--parent"
            onClick={() => toggleLevel('scene')}
          >
            <span className={`am-tree-toggle ${collapsedLevels.has('scene') ? 'is-collapsed' : 'is-expanded'}`}>▼</span>
            <span className="am-tree-node__ic">🏠</span>{LEVEL_LABEL.scene}
            <span className="am-tree-node__n">{sceneCount}</span>
          </button>
          {!collapsedLevels.has('scene') && (
            <div className="am-tree-children">
              {/* ③ 全部场景设定（仅 scene_base，三视角/角度图已分离到独立条目） */}
              <button
                className={`am-tree-node am-tree-node--child ${subtypeOn('scene_base') ? 'is-on' : ''}`}
                onClick={() => clickSubtype('scene_base')}
              >
                <span className="am-tree-node__ic">▦</span>全部场景设定
                <span className="am-tree-node__n">{sub('scene_base')}</span>
              </button>
              {/* Notion 场景设定文档（场景级文字描述，区别于 scene_base 设定图） */}
              {renderSubtypeNode('scene_design', true)}
              {/* Notion §1.2a 场景蓝图（空间结构+灭点+地标） */}
              {renderSubtypeNode('scene_blueprint', true)}
              {/* Notion §1.2b 场景时空变体（时段/天气） */}
              {renderSubtypeNode('scene_temporal_variant', true)}
              {/* Notion §1.2c 场景视角矩阵（扩展角度） */}
              {renderSubtypeNode('scene_view_angle', true)}
              {sceneGroups.map((s) => (
                <button
                  key={s.id}
                  className={`am-tree-node am-tree-node--grandchild ${entityFilter?.type === 'scene' && entityFilter.id === s.id ? 'is-on' : ''}`}
                  onClick={() => {
                    setLevelFilter(null); setEntityFilter({ type: 'scene', id: s.id })
                    setTypeFilter(null); setTagFilter(null)
                  }}
                >
                  <span className="am-tree-node__ic">·</span>{s.id}
                  <span className="am-tree-node__n">{s.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 分镜级 (Shot) ── */}
        <div className="am-tree-section">
          <button
            className="am-tree-node am-tree-node--parent"
            onClick={() => toggleLevel('shot')}
          >
            <span className={`am-tree-toggle ${collapsedLevels.has('shot') ? 'is-collapsed' : 'is-expanded'}`}>▼</span>
            <span className="am-tree-node__ic">🎬</span>{LEVEL_LABEL.shot}
            <span className="am-tree-node__n">{shotCount}</span>
          </button>
          {!collapsedLevels.has('shot') && (
            <div className="am-tree-children">
              {/* ⑦ 分镜级 Turnaround（人物定妆）—— DB 无数据，count=0 灰色不可点击 */}
              {renderSubtypeNode('costume_turnaround', true)}
              {/* Notion §1.1c 服化道时段变体 */}
              {renderSubtypeNode('costume_temporal_variant', true)}
              {/* 对白（P10 voice_clips，clip_type='dialogue'）—— 来自 canvas graph，非 assets-registry。
                  点击在主区域展开对白列表（复用 DialoguePanel，无需独立 Tab）。 */}
              <button
                className={`am-tree-node am-tree-node--child ${entityFilter?.type === 'dialogue' ? 'is-on' : ''}`}
                onClick={() => {
                  setLevelFilter(null); setEntityFilter({ type: 'dialogue' })
                  setTypeFilter(null); setTagFilter(null)
                }}
              >
                <span className="am-tree-node__ic">🗣️</span>对白
                <span className="am-tree-node__n">{dialogueCount}</span>
              </button>
              {/* ⑥ 场景角度图（分镜级参考）—— 从场景级移到分镜级 */}
              {renderSubtypeNode('scene_angle_shot')}
              {/* Notion §5c Foley 独立音轨 */}
              {renderSubtypeNode('foley_stem', true)}
              {/* Notion §5d BGM 音轨 */}
              {renderSubtypeNode('bgm_track', true)}
              {/* 分镜列表（S01–S44 首尾帧变体，按 shot 自然序）—— 折叠父节点，置于分镜级最下方。
                  此前这 44 条分镜平铺在分镜级顶部，淹没了 定妆/对白/场景角度/音轨 等子类型；
                  现归入可折叠「分镜列表」父节点并下沉，让常用子类型优先可见，需要时展开查具体分镜。 */}
              {shotGroups.length > 0 && (
                <div className="am-tree-subsection">
                  <button
                    className="am-tree-node am-tree-node--parent am-tree-node--child"
                    onClick={() => setShotListCollapsed((v) => !v)}
                  >
                    <span className={`am-tree-toggle ${shotListCollapsed ? 'is-collapsed' : 'is-expanded'}`}>▼</span>
                    <span className="am-tree-node__ic">🎞️</span>分镜列表
                    <span className="am-tree-node__n">{shotGroups.length}</span>
                  </button>
                  {!shotListCollapsed && (
                    <div className="am-tree-children">
                      {shotGroups.map((g) => {
                        const shotOn = entityFilter?.type === 'shot' && entityFilter.id === g.shotId
                        const expanded = expandedShots.has(g.shotId)
                        const hasBeats = g.beats.length > 0
                        const toggleShot = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          setExpandedShots((prev) => {
                            const next = new Set(prev)
                            if (next.has(g.shotId)) next.delete(g.shotId)
                            else next.add(g.shotId)
                            return next
                          })
                        }
                        return (
                          <div key={g.shotId}>
                            <button
                              className={`am-tree-node am-tree-node--grandchild ${shotOn ? 'is-on' : ''}`}
                              onClick={() => {
                                setLevelFilter('shot'); setEntityFilter({ type: 'shot', id: g.shotId })
                                setTypeFilter(null); setTagFilter(null)
                              }}
                            >
                              {hasBeats ? (
                                <span
                                  className={`am-tree-toggle ${expanded ? 'is-expanded' : 'is-collapsed'}`}
                                  style={{ width: '14px', flexShrink: 0 }}
                                  onClick={toggleShot}
                                  role="button"
                                  aria-label={expanded ? '折叠 beat' : '展开 beat'}
                                >▼</span>
                              ) : (
                                <span className="am-tree-node__ic">·</span>
                              )}
                              {g.shotId}
                              <span className="am-tree-node__n">{g.n}</span>
                            </button>
                            {hasBeats && expanded && (
                              <div className="am-tree-children">
                                {g.beats.map((b) => {
                                  const beatOn = entityFilter?.type === 'shot' && entityFilter.id === b.id
                                  return (
                                    <button
                                      key={b.id}
                                      className={`am-tree-node am-tree-node--grandchild ${beatOn ? 'is-on' : ''}`}
                                      style={{ paddingLeft: 68 }}
                                      onClick={() => {
                                        setLevelFilter('shot'); setEntityFilter({ type: 'shot', id: b.id })
                                        setTypeFilter(null); setTagFilter(null)
                                      }}
                                    >
                                      <span className="am-tree-node__ic">·</span>{beatShortLabel(b.id)}
                                      <span className="am-tree-node__n">{b.n}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 管线产出 (Pipeline) ── */}
        <div className="am-tree-section">
          <button
            className="am-tree-node am-tree-node--parent"
            onClick={() => toggleLevel('pipeline')}
          >
            <span className={`am-tree-toggle ${collapsedLevels.has('pipeline') ? 'is-collapsed' : 'is-expanded'}`}>▼</span>
            <span className="am-tree-node__ic">🎬</span>{LEVEL_LABEL.pipeline}
            <span className="am-tree-node__n">{pipelineCount}</span>
          </button>
          {!collapsedLevels.has('pipeline') && (
            <div className="am-tree-children">
              {renderSubtypeNode('spatio_temporal_script', true)}
              {renderSubtypeNode('shot_list', true)}
              {renderSubtypeNode('e_konte')}
              {renderSubtypeNode('voice_clips')}
              {renderSubtypeNode('rapid_preview', true)}
              {renderSubtypeNode('video_clips', true)}
              {renderSubtypeNode('master_timeline', true)}
              {renderSubtypeNode('audio_stems', true)}
              {renderSubtypeNode('master_mp4', true)}
              {renderSubtypeNode('delivery_package')}
            </div>
          )}
        </div>
      </aside>

      {/* 主区域 */}
      <div className="am-lib__main">
        {entityFilter?.type === 'dialogue' ? (
          // 对白视图：复用 DialoguePanel（P10 voice_clips，非 assets-registry 资产）
          <DialoguePanel />
        ) : (
          <>
        <div className="am-lib__toolbar">
          <div className="am-scope">
            <button
              className={tab === 'selected' ? 'is-on' : ''}
              onClick={() => setTab('selected')}
            >
              ★ 选定资产
            </button>
            <button
              className={tab === 'candidate' ? 'is-on' : ''}
              onClick={() => setTab('candidate')}
            >
              ○ 待选资产
            </button>
            <button
              className={tab === 'eliminated' ? 'is-on' : ''}
              onClick={() => setTab('eliminated')}
            >
              ✕ 淘汰资产
            </button>
          </div>
          <label className="am-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资产 / 标签…" />
          </label>
          <span className="am-head" style={{ marginLeft: 4 }}>标签</span>
          <button className={`am-chip ${!tagFilter ? 'is-on' : ''}`} onClick={() => setTagFilter(null)}>全部</button>
          {tags.map((t) => (
            <button key={t} className={`am-chip ${tagFilter === t ? 'is-on' : ''}`} onClick={() => setTagFilter(t)}>{t}</button>
          ))}
          <span className="am-lib__count">{tabFiltered.length} 项</span>
          <button
            className={`am-btn am-btn--ghost am-btn--refresh ${loading ? 'is-spinning' : ''}`}
            onClick={reload}
            title="刷新资产列表"
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            刷新
          </button>
        </div>

        <div className="am-scroll" style={{ flex: 1, overflowY: 'auto' }} onClick={closeAssetDetail}>
          {loading ? (
            <div className="am-loading">
              {[1, 2, 3, 4, 5, 6].map((i) => <div className="am-skeleton-card" key={i} />)}
              <div className="am-loading__label">正在从资产注册表加载…</div>
            </div>
          ) : error ? (
            <div className="am-empty">
              资产加载失败：{error}<br />
              <button className="am-btn am-btn--ghost" style={{ marginTop: 12 }} onClick={reload}>重试</button>
            </div>
          ) : tabFiltered.length === 0 ? (
            <div className="am-empty">
              没有匹配的资产。<br />
              {assets.length === 0
                ? '资产库为空 —— 运行管线（P04 角色设计 / P07 场景）后会自动注册到这里。'
                : tab === 'selected'
                  ? '当前没有选定资产 —— 切换到「待选资产」选出一个作为正式版本。'
                  : tab === 'eliminated'
                    ? '当前没有淘汰资产 —— 待选中的资产被新选定取代后会自动归入此处。'
                    : '当前没有待选资产 —— 所有变体均已设为选定。'}
            </div>
          ) : tab === 'candidate' && candidateGroups.length > 0 ? (
            // 待选资产：按类型分组展示（同组变体并列对比，便于择优选定）
            <div className="am-groups">
              {candidateGroups.map((group) => (
                <div key={group.key} className="am-group">
                  <div className="am-group__header">
                    <span className="am-group__emoji">{group.emoji}</span>
                    <span className="am-group__title">{group.title}</span>
                    <span className="am-group__count">{group.items.length} 个待选</span>
                  </div>
                  <div className="am-group__grid">
                    {group.items.map((d) => renderCard(d))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // 选定 / 淘汰 tab：保持原平铺网格
            <div className="am-grid">
              {tabFiltered.map((d) => renderCard(d))}
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  )
}
