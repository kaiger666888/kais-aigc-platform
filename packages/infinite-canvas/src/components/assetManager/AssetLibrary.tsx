/**
 * 视图A · 资产库 —— 左栏类型树 + Masonry 卡片网格 + 搜索/作用域/标签筛选。
 * 点击卡片 → openAssetDetail(uuid)（store 驱动切到详情子视图）。
 * 卡片 hover「添加到画布」→ 画布联动（占位 · TODO 待后端 place 端点）。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { placeAssetOnCanvas } from '../../services/canvasApi'
import {
  ASSETS, TYPE_GROUPS, TYPE_LABEL, allTags,
  type AssetItem, type AssetScope, type AssetType,
  modalityVar, modalityWeakVar,
} from './assetManagerData'

/** 把自定义 CSS 变量安全注入 style（TS 不认 --foo 键）。 */
function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

const SCOPE_LABEL: Record<AssetScope, string> = { library: '全局库', series: '系列', project: '项目' }

export default function AssetLibrary() {
  const openAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  const [scope, setScope] = useState<AssetScope | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<AssetType | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => ASSETS.filter((a) => {
    if (scope !== 'all' && a.scope !== scope) return false
    if (typeFilter && a.type !== typeFilter) return false
    if (tagFilter && !(a.tags ?? []).includes(tagFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${a.name} ${a.desc ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [scope, typeFilter, tagFilter, search])

  const countByType = (t: AssetType) => ASSETS.filter((a) => a.type === t && (scope === 'all' || a.scope === scope)).length
  const countAll = ASSETS.filter((a) => scope === 'all' || a.scope === scope).length

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
        {TYPE_GROUPS.map((g) => (
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
          {/* 作用域分段 */}
          <div className="am-scope">
            {(['all', 'library', 'series', 'project'] as const).map((sc) => (
              <button
                key={sc}
                className={scope === sc ? 'is-on' : ''}
                onClick={() => setScope(sc)}
              >{sc === 'all' ? '全部' : SCOPE_LABEL[sc]}</button>
            ))}
          </div>
          {/* 搜索 */}
          <label className="am-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资产 / 标签…" />
          </label>
          <span className="am-head" style={{ marginLeft: 4 }}>标签</span>
          <button className={`am-chip ${!tagFilter ? 'is-on' : ''}`} onClick={() => setTagFilter(null)}>全部</button>
          {allTags().map((t) => (
            <button key={t} className={`am-chip ${tagFilter === t ? 'is-on' : ''}`} onClick={() => setTagFilter(t)}>{t}</button>
          ))}
          <span className="am-lib__count">{filtered.length} 项资产</span>
        </div>
        <div className="am-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="am-empty">没有匹配的资产。<br />试试清除筛选或搜索。</div>
          ) : (
            <div className="am-grid">
              {filtered.map((a) => {
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
                    <div className="am-card__thumb">{a.emoji}</div>
                    <div className="am-card__typebar" />
                    <div className="am-card__body">
                      <div className="am-card__name">{a.name}</div>
                      <div className="am-card__meta">
                        <span className="am-card__typetag">{TYPE_LABEL[a.type]}</span>
                        <span className="am-card__scope">{SCOPE_LABEL[a.scope]}</span>
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
