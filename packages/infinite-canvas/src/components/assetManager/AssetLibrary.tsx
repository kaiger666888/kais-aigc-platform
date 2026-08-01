/**
 * 视图A · 资产库 —— 左栏类型树 + Masonry 卡片网格 + 搜索/标签筛选。
 *
 * 数据来源：真实 `/api/v1/assets-registry/search`（useRealAssets 缓存）。
 * 管线产出的资产经 canvas_sync 自动注册后即出现在此处，无需手动同步。
 * 缩略图从 JOIN o_image 的 filePath 经 resolveMediaUrl 渲染；缺图回退类型 emoji。
 *
 * 两段式资产模型：
 *   - 选定资产 (isPrimaryView=true) —— 管线下游实际使用的版本，每个 characterId 组仅一个。
 *   - 待选资产 (isPrimaryView=false) —— 同组的备选变体，未被管线使用。
 * 切换"选定"：同 characterId 组内旧 primary 自动置 false，新选资产置 true。
 *
 * 点击卡片 → openAssetDetail(uuid)（store 驱动切到详情子视图）。
 * 卡片 hover「添加到画布」→ 画布联动（占位 · TODO 待后端 place 端点）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { placeAssetOnCanvas, updateAsset, type AssetDetail } from '../../services/canvasApi'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { useRealAssets } from './useRealAssets'
import {
  REAL_TYPE_GROUPS, TYPE_LABEL, realTags,
  assetDetailToItem, modalityVar, modalityWeakVar,
  type AssetItem, type AssetType,
} from './assetManagerData'

type AssetTab = 'selected' | 'candidate'

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
  if (d.characterId) {
    return `char:${d.characterId}`
  }
  // 场景类资产按 characterId（实际存的是场景ID如 S01）分组
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    return `scene:${d.name}`
  }
  return `${d.type}:${d.name}`
}

export default function AssetLibrary() {
  const openAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const closeAssetDetail = useCanvasStore((s) => s.closeAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  const { assets, loading, error, reload } = useRealAssets(projectId)

  const [tab, setTab] = useState<AssetTab>('selected')
  const [typeFilter, setTypeFilter] = useState<AssetType | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

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
    return true
  }), [assets, typeFilter, tagFilter, search])

  // 按 tab 拆分：选定资产 (isPrimaryView===true) / 待选资产 (其余)。
  const tabFiltered = useMemo(() => {
    return filtered.filter((d) => {
      // isPrimaryView 从 SQLite 返回的是整数 0/1，不能 === true 比较
      if (tab === 'selected') return !!d.isPrimaryView
      return !d.isPrimaryView
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
      const hasPrimary = group.some((d) => !!d.isPrimaryView)
      if (!hasPrimary && group.length > 0) {
        needsInit.push(group[0].id)
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

  const countByType = (t: string) => assets.filter((d) => d.type === t).length
  const countAll = assets.length

  const handleAddToCanvas = async (a: AssetItem) => {
    if (!projectId || episodesId == null) {
      showToast('请先在顶栏选择项目和剧集，再添加到画布', 'warning')
      return
    }
    // TODO(backend): placeAssetOnCanvas 真实持久化待 POST /api/v1/assets/:uuid/place 落地。
    await placeAssetOnCanvas(projectId, episodesId, a.uuid)
    showToast(`已添加到画布 · ${a.name}（占位 · 待后端 place 端点）`, 'success')
  }

  // 切换组内选定资产：先把同组其它 primary 全部置 false，再把目标置 true。
  const handleSelect = async (assetId: number, groupKey: string) => {
    const sameGroup = assets.filter((d) => getGroupKey(d) === groupKey)

    for (const d of sameGroup) {
      if (d.isPrimaryView) {
        try { await updateAsset(d.id, { isPrimaryView: false }) } catch { /* 忽略单项失败 */ }
      }
    }

    try {
      await updateAsset(assetId, { isPrimaryView: true })
      showToast('已设为选定资产', 'success')
      await reload()
    } catch (err) {
      showToast('设置失败: ' + (err as Error).message, 'error')
    }
  }

  return (
    <div className="am-lib">
      {/* 左栏类型树 */}
      <aside className="am-tree">
        <div className="am-tree-group">
          <div className="am-tree-group__h"><span>资产类型</span></div>
          <button
            className={`am-tree-node ${!typeFilter ? 'is-on' : ''}`}
            onClick={() => { setTypeFilter(null); setTagFilter(null) }}
          >
            <span className="am-tree-node__ic">▦</span>全部<span className="am-tree-node__n">{countAll}</span>
          </button>
        </div>
        {REAL_TYPE_GROUPS.map((g) => (
          <div className="am-tree-group" key={g.group}>
            <div className="am-tree-group__h" style={{ marginTop: 8 }}>{g.group}</div>
            {g.items.map((it) => (
              <button
                key={it.t}
                className={`am-tree-node ${typeFilter === it.t ? 'is-on' : ''}`}
                onClick={() => { setTypeFilter(it.t); setTagFilter(null) }}
              >
                <span className="am-tree-node__ic">{it.ic}</span>{it.n}
                <span className="am-tree-node__n">{countByType(it.t)}</span>
              </button>
            ))}
          </div>
        ))}
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

                    {/* 选定资产 tab 下显示「取消选定」按钮（退回待选） */}
                    {tab === 'selected' && (
                      <button
                        className="am-card__deselect-btn"
                        onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            await updateAsset(d.id, { isPrimaryView: false })
                            showToast('已退回待选资产', 'success')
                            await reload()
                          } catch (err) {
                            showToast('操作失败: ' + (err as Error).message, 'error')
                          }
                        }}
                        title="退回待选资产"
                      >✕ 取消选定</button>
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
