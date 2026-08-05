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
import {
  TYPE_LABEL, realTags,
  assetDetailToItem, modalityVar, modalityWeakVar,
  inferLevel, inferSceneId, inferShotId, inferSubtype,
  SUBTYPE_LABEL, SUBTYPE_EMOJI, LEVEL_LABEL,
  type AssetItem, type AssetType, type AssetLevel, type AssetSubtype,
} from './assetManagerData'

type AssetTab = 'selected' | 'candidate' | 'eliminated'

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

/** 缩略图：优先 filePath 真图，加载失败/缺图回退类型 emoji。
 *  声纹卡片：左侧展示角色设定图 + 右侧音频播放器（左右分栏）。
 */
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
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
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
          {/* 底部渐变遮罩 + 播放器叠在角色图上 */}
          <div style={{
            position: 'absolute', bottom: '8px', left: 0, right: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
            padding: '4px 6px 2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <audio
              controls
              preload="none"
              src={audioUrl}
              style={{ width: '100%', height: '28px' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
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
 * 始终在层级树显示的子类型条目（即使 DB 暂无数据，也以 count=0 灰色不可点击呈现）。
 * 对应 Kai 管线中尚未注册到 o_assets 的中间产物：②灰底 Turnaround / ⑦分镜级 Turnaround。
 * （④三视角已废弃，不再常驻显示。）
 */
const ALWAYS_SHOW_SUBTYPES: ReadonlySet<AssetSubtype> = new Set([
  'turnaround_sheet', 'costume_turnaround',
  // Notion 新资产类型占位（count=0 时灰色显示，让用户知道这些分类存在）
  'scene_blueprint', 'scene_temporal_variant', 'scene_view_angle',
  'costume_temporal_variant', 'midframe',
  'foley_stem', 'bgm_track',
])

export default function AssetLibrary() {
  const rawOpenAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const rawCloseAssetDetail = useCanvasStore((s) => s.closeAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

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
        // 角色列表仅含角色设定图（①）—— 灰底 Turnaround 等另由 subtype 条目进入
        if (inferSubtype(d) !== 'character_concept') return false
      } else if (entityFilter.type === 'scene') {
        if (inferSceneId(d) !== entityFilter.id) return false
      } else if (entityFilter.type === 'shot') {
        if (inferShotId(d) !== entityFilter.id) return false
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
  // 全剧级 · 角色列表：仅角色设定图（①），按 characterId 分组，附带可读角色名
  const showCharacters = useMemo(() => {
    const counts = new Map<string, number>()
    const names = new Map<string, string>()
    for (const d of activeAssets) {
      if (inferLevel(d) !== 'show') continue
      if (inferSubtype(d) !== 'character_concept') continue
      if (!d.characterId) continue
      counts.set(d.characterId, (counts.get(d.characterId) ?? 0) + 1)
      if (!names.has(d.characterId)) {
        const nm = (d.name || '').replace(/\s*v\d+$/i, '').trim()
        if (nm) names.set(d.characterId, nm)
      }
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, label: names.get(id) || id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [activeAssets])

  // 全子类型计数（驱动各层级固定条目 + count 徽标）
  const subtypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of activeAssets) {
      const st = inferSubtype(d)
      counts[st] = (counts[st] ?? 0) + 1
    }
    return counts
  }, [activeAssets])
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

  // 分镜级 · 首尾帧列表（⑧⑨）：按 inferShotId 分组
  const shotGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of activeAssets) {
      if (inferLevel(d) !== 'shot') continue
      const sid = inferShotId(d)
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [activeAssets])

  // 各层级 section 计数（仅统计归属本 section 的资产）
  const showCount = sub('character_concept') + sub('turnaround_sheet') + sub('turnaround_view')
  // 场景级 = 场景设定图(③)（三视角已废弃，不再计入）
  const sceneCount = sub('scene_base')
  // 分镜级：首尾帧 + 场景角度图 + 人物定妆（三视角不再出现在分镜级）
  const shotCount =
    sub('keyframe_first') + sub('keyframe_last') + sub('scene_angle_shot') +
    sub('costume_turnaround')

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
              {/* ⑥ 全部首尾帧（仅 keyframe，shot 级目前仅有首尾帧） */}
              <button
                className={`am-tree-node am-tree-node--child ${levelFilter === 'shot' && !entityFilter ? 'is-on' : ''}`}
                onClick={() => {
                  setLevelFilter('shot'); setEntityFilter(null)
                  setTypeFilter(null); setTagFilter(null)
                }}
              >
                <span className="am-tree-node__ic">▦</span>全部首尾帧
                <span className="am-tree-node__n">{sub('keyframe_first') + sub('keyframe_last')}</span>
              </button>
              {shotGroups.map((s) => (
                <button
                  key={s.id}
                  className={`am-tree-node am-tree-node--grandchild ${entityFilter?.type === 'shot' && entityFilter.id === s.id ? 'is-on' : ''}`}
                  onClick={() => {
                    setLevelFilter('shot'); setEntityFilter({ type: 'shot', id: s.id })
                    setTypeFilter(null); setTagFilter(null)
                  }}
                >
                  <span className="am-tree-node__ic">·</span>{s.id}
                  <span className="am-tree-node__n">{s.n}</span>
                </button>
              ))}
              {/* ⑦ 分镜级 Turnaround（人物定妆）—— DB 无数据，count=0 灰色不可点击 */}
              {renderSubtypeNode('costume_turnaround', true)}
              {/* Notion §1.1c 服化道时段变体 */}
              {renderSubtypeNode('costume_temporal_variant', true)}
              {/* Notion §2d 关键中间帧（长镜头 >8s） */}
              {renderSubtypeNode('midframe', true)}
              {/* ⑥ 场景角度图（分镜级参考）—— 从场景级移到分镜级 */}
              {renderSubtypeNode('scene_angle_shot')}
              {/* Notion §5c Foley 独立音轨 */}
              {renderSubtypeNode('foley_stem', true)}
              {/* Notion §5d BGM 音轨 */}
              {renderSubtypeNode('bgm_track', true)}
            </div>
          )}
        </div>
      </aside>

      {/* 主区域 */}
      <div className="am-lib__main">
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
          ) : (
            <div className="am-grid">
              {tabFiltered.map((d) => {
                const a = assetDetailToItem(d)
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

                    <div className="am-card__thumb"><Thumb item={a} portraitUrl={a.type === 'voice' || a.type === 'audio' ? (a.characterId ? charPortraitMap.get(a.characterId) : null) : null} /></div>
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
