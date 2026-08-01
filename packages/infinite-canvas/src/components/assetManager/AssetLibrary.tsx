/**
 * 视图A · 资产库 —— 左栏类型树 + Masonry 卡片网格 + 搜索/作用域/标签筛选。
 *
 * 数据来源：真实 `/api/v1/assets-registry/search`（useRealAssets 缓存）。
 * 管线产出的资产经 canvas_sync 自动注册后即出现在此处，无需手动同步。
 * 缩略图从 JOIN o_image 的 filePath 经 resolveMediaUrl 渲染；缺图回退类型 emoji。
 *
 * 点击卡片 → openAssetDetail(uuid)（store 驱动切到详情子视图）。
 * 卡片 hover「添加到画布」→ 画布联动（占位 · TODO 待后端 place 端点）。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { placeAssetOnCanvas } from '../../services/canvasApi'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { useRealAssets } from './useRealAssets'
import {
  REAL_TYPE_GROUPS, TYPE_LABEL, realTags,
  assetDetailToItem, modalityVar, modalityWeakVar,
  type AssetItem, type AssetType,
} from './assetManagerData'

type LibScope = 'all' | 'current' | 'library'

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

export default function AssetLibrary() {
  const openAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  const { assets, loading, error, reload } = useRealAssets(projectId)

  const [scope, setScope] = useState<LibScope>('current')
  const [typeFilter, setTypeFilter] = useState<AssetType | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const tags = useMemo(() => realTags(assets.map(assetDetailToItem)), [assets])

  const scopeMatches = useMemo(() => {
    return (d: typeof assets[number]) => {
      if (scope === 'library') return d.projectId == null
      if (scope === 'current') return projectId != null && d.projectId === projectId
      return true // all
    }
  }, [scope, projectId])

  const filtered = useMemo(() => assets.filter((d) => {
    if (!scopeMatches(d)) return false
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
  }), [assets, scopeMatches, typeFilter, tagFilter, search])

  const items = useMemo(() => filtered.map(assetDetailToItem), [filtered])

  const countByType = (t: string) => assets.filter((d) => d.type === t && scopeMatches(d)).length
  const countAll = assets.filter(scopeMatches).length

  const scopeOptions: LibScope[] = projectId
    ? ['all', 'current', 'library']
    : ['all', 'library']
  const scopeLabel = (s: LibScope): string =>
    s === 'all' ? '全部资产' : s === 'current' ? '本项目' : '全局资产'

  const handleAddToCanvas = async (a: AssetItem) => {
    if (!projectId || episodesId == null) {
      showToast('请先在顶栏选择项目和剧集，再添加到画布', 'warning')
      return
    }
    // TODO(backend): placeAssetOnCanvas 真实持久化待 POST /api/v1/assets/:uuid/place 落地。
    await placeAssetOnCanvas(projectId, episodesId, a.uuid)
    showToast(`已添加到画布 · ${a.name}（占位 · 待后端 place 端点）`, 'success')
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
            {scopeOptions.map((sc) => (
              <button key={sc} className={scope === sc ? 'is-on' : ''} onClick={() => setScope(sc)}>
                {scopeLabel(sc)}
              </button>
            ))}
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
          <span className="am-lib__count">{filtered.length} 项资产</span>
        </div>

        <div className="am-scroll" style={{ flex: 1, overflowY: 'auto' }}>
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
          ) : items.length === 0 ? (
            <div className="am-empty">
              没有匹配的资产。<br />
              {assets.length === 0
                ? '资产库为空 —— 运行管线（P04 角色设计 / P07 场景）后会自动注册到这里。'
                : '试试清除筛选或搜索。'}
            </div>
          ) : (
            <div className="am-grid">
              {items.map((a) => {
                const isKey = a.type === 'prop_key'
                return (
                  <div
                    key={a.uuid}
                    className="am-card"
                    data-uuid={a.uuid}
                    style={cssVars({ '--cardc': `var(${modalityVar(a.modality)})`, '--cardw': `var(${modalityWeakVar(a.modality)})` })}
                    onClick={() => openAssetDetail(a.uuid)}
                  >
                    {isKey && <span className="am-card__keyflag">🔒 关键</span>}
                    {a.reuses ? <span className="am-card__reuse am-badge am-badge--reuse">{a.reuses} 集</span> : null}
                    <button
                      className="am-card__add"
                      onClick={(e) => { e.stopPropagation(); void handleAddToCanvas(a) }}
                      title="添加到当前画布"
                    >＋ 画布</button>
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
