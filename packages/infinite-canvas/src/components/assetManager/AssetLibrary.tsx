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

/** 缩略图：优先 filePath 真图，加载失败/缺图回退类型 emoji。 */
function Thumb({ item }: { item: AssetItem }) {
  const [broken, setBroken] = useState(false)
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
      if (!hasPrimary && activeGroup.length > 0 && !isSceneGroup) {
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

  const countAll = assets.length

  // ── 层级树数据（useMemo 派生） ──
  // 全剧级 · 角色列表：按 characterId 分组
  const showCharacters = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of assets) {
      if (inferLevel(d) === 'show' && d.type === 'character' && d.characterId) {
        counts.set(d.characterId, (counts.get(d.characterId) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [assets])

  // 全剧级 · Turnaround / 视角拆分 计数（按 subtype）
  const showSubtypeCounts = useMemo(() => {
    const counts = { turnaround_sheet: 0, turnaround_view: 0 }
    for (const d of assets) {
      if (inferLevel(d) !== 'show') continue
      const st = inferSubtype(d)
      if (st === 'turnaround_sheet') counts.turnaround_sheet++
      else if (st === 'turnaround_view') counts.turnaround_view++
    }
    return counts
  }, [assets])

  // 场景级 · 场景列表：按 inferSceneId 分组
  const sceneGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of assets) {
      if (inferLevel(d) !== 'scene') continue
      const sid = inferSceneId(d)
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [assets])

  // 分镜级 · 分镜列表：按 inferShotId 分组
  const shotGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of assets) {
      if (inferLevel(d) !== 'shot') continue
      const sid = inferShotId(d)
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [assets])

  const showCount = showCharacters.reduce((s, c) => s + c.n, 0)
    + showSubtypeCounts.turnaround_sheet
    + showSubtypeCounts.turnaround_view
  const sceneCount = sceneGroups.reduce((s, c) => s + c.n, 0)
  const shotCount = shotGroups.reduce((s, c) => s + c.n, 0)

  const handleAddToCanvas = async (a: AssetItem) => {
    if (!projectId || episodesId == null) {
      showToast('请先在顶栏选择项目和剧集，再添加到画布', 'warning')
      return
    }
    // TODO(backend): placeAssetOnCanvas 真实持久化待 POST /api/v1/assets/:uuid/place 落地。
    await placeAssetOnCanvas(projectId, episodesId, a.uuid)
    showToast(`已添加到画布 · ${a.name}（占位 · 待后端 place 端点）`, 'success')
  }

  // 待选→选定：新选资产置 selected，同组旧选定资产自动淘汰（三态流转）。
  // 全程乐观更新——绝不 reload（避免列表闪烁/跳顶），仅在后端失败时回滚。
  const handleSelect = async (assetId: number, groupKey: string) => {
    const sameGroup = assets.filter((d) => getGroupKey(d) === groupKey)
    const oldPrimaries = sameGroup.filter((d) => !!d.isPrimaryView && d.id !== assetId)

    // 1. 乐观更新 UI：旧选定 → 淘汰；新选 → 选定。
    for (const d of oldPrimaries) {
      patchLocal(d.id, { isPrimaryView: false, state: 'eliminated' })
    }
    patchLocal(assetId, { isPrimaryView: true, state: 'active' })

    // 2. 后端同步（不 reload；失败时整体回滚到真实状态）。
    try {
      for (const d of oldPrimaries) {
        try { await updateAsset(d.id, { isPrimaryView: false, state: 'eliminated' }) } catch { /* 忽略单项失败 */ }
      }
      await updateAsset(assetId, { isPrimaryView: true, state: 'active' })
      showToast('已设为选定资产', 'success')
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
                    className={`am-tree-node am-tree-node--child ${levelFilter === 'show' && entityFilter?.type === 'character' && !entityFilter.id ? 'is-on' : ''}`}
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
                        setTypeFilter(null); setTagFilter(null)
                      }}
                    >
                      <span className="am-tree-node__ic">·</span>{c.id}
                      <span className="am-tree-node__n">{c.n}</span>
                    </button>
                  ))}
                </>
              )}
              {showSubtypeCounts.turnaround_sheet > 0 && (
                <button
                  className={`am-tree-node am-tree-node--child ${entityFilter?.type === 'subtype' && entityFilter.id === 'turnaround_sheet' ? 'is-on' : ''}`}
                  onClick={() => {
                    setLevelFilter('show'); setEntityFilter({ type: 'subtype', id: 'turnaround_sheet' })
                    setTypeFilter(null); setTagFilter(null)
                  }}
                >
                  <span className="am-tree-node__ic">{SUBTYPE_EMOJI.turnaround_sheet}</span>{SUBTYPE_LABEL.turnaround_sheet}
                  <span className="am-tree-node__n">{showSubtypeCounts.turnaround_sheet}</span>
                </button>
              )}
              {showSubtypeCounts.turnaround_view > 0 && (
                <button
                  className={`am-tree-node am-tree-node--child ${entityFilter?.type === 'subtype' && entityFilter.id === 'turnaround_view' ? 'is-on' : ''}`}
                  onClick={() => {
                    setLevelFilter('show'); setEntityFilter({ type: 'subtype', id: 'turnaround_view' })
                    setTypeFilter(null); setTagFilter(null)
                  }}
                >
                  <span className="am-tree-node__ic">{SUBTYPE_EMOJI.turnaround_view}</span>{SUBTYPE_LABEL.turnaround_view}
                  <span className="am-tree-node__n">{showSubtypeCounts.turnaround_view}</span>
                </button>
              )}
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
              <button
                className={`am-tree-node am-tree-node--child ${levelFilter === 'scene' && !entityFilter ? 'is-on' : ''}`}
                onClick={() => {
                  setLevelFilter('scene'); setEntityFilter(null)
                  setTypeFilter(null); setTagFilter(null)
                }}
              >
                <span className="am-tree-node__ic">▦</span>全部场景
                <span className="am-tree-node__n">{sceneCount}</span>
              </button>
              {sceneGroups.map((s) => (
                <button
                  key={s.id}
                  className={`am-tree-node am-tree-node--grandchild ${entityFilter?.type === 'scene' && entityFilter.id === s.id ? 'is-on' : ''}`}
                  onClick={() => {
                    setLevelFilter('scene'); setEntityFilter({ type: 'scene', id: s.id })
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
              <button
                className={`am-tree-node am-tree-node--child ${levelFilter === 'shot' && !entityFilter ? 'is-on' : ''}`}
                onClick={() => {
                  setLevelFilter('shot'); setEntityFilter(null)
                  setTypeFilter(null); setTagFilter(null)
                }}
              >
                <span className="am-tree-node__ic">▦</span>全部首尾帧
                <span className="am-tree-node__n">{shotCount}</span>
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

                    <div className="am-card__thumb"><Thumb item={a} /></div>
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
