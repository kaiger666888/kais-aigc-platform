/**
 * 视图 · 资产层级（62-04，第 5 Tab assetView='hierarchy'）—— 三层资产组织：
 *   L1 域导航树（左栏 220px：全部 + 设定资产/媒体产物/文本产物 固定纲，C2）
 *   L2 候选组折叠卡（getGroupKey 轴，C3）+ 每域末尾「单件资产」桶（C3 单件变体）
 *   L3 候选卡（复用 renderAssetCard，层级模式按卡自身三态出按钮，C5）
 *
 * 数据派生全部在 buildHierarchyModel（groupCanvasLinkage 纯函数家，D-04 判定式单套）；
 * 单组选定/取消/恢复走 assetHierarchy.ts 共享 handler（selectGroupWinner 含 D-05
 * 画布 best-effort 同步），与资产库同调用点（HIER-04）。
 * 数据源 useRealAssets 与资产库同一模块级缓存（同源计数）。
 * 冗余配置右栏（340px，toolbar「⚙ 冗余配置」）62-06 落——本 plan 栅格两列，
 * 不渲染第三列。批量决策条/组 checkbox/手动 chip（C4，D-06/D-07）62-05 已落。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useVariantPickerStore } from '../variants/variantPickerStore'
import type { AssetDetail } from '../../services/canvasApi'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import {
  assetPhaseOf,
  buildHierarchyModel,
  findVariantGroupForAsset,
  resolveAssetNodeId,
  type HierarchyCounts,
  type HierarchyDomainNode,
  type HierarchyGroup,
} from './groupCanvasLinkage'
import type { AssetDomain } from './generationConfigKeys'
import {
  deselectAsset,
  restoreAsset,
  runBatchEliminate,
  runBatchSelect,
  selectGroupWinner,
} from './assetHierarchy'
import { renderAssetCard, type AssetCardDeps, type AssetCardSingletonPhase } from './AssetLibrary'
import { useRealAssets } from './useRealAssets'
import { inferSubtype, type AssetItem } from './assetManagerData'

/** L1 域固定纲（UI-SPEC 层间指派规则；标签逐字 UI-SPEC Copywriting 域标签行）。 */
const DOMAIN_META: ReadonlyArray<{ key: AssetDomain; label: string; icon: string }> = [
  { key: 'setting', label: '设定资产', icon: '🧩' },
  { key: 'media', label: '媒体产物', icon: '🎞️' },
  { key: 'text', label: '文本产物', icon: '📝' },
]

/** C7 计数芯片：★N（青）/ ○N（中性）/ ✕N（玫）+ 灰 mono「共 N」；
 *  每个数字独立 data-count-* 属性供 e2e 精确断言（非 innerText 抓取）。 */
function CountChips({ counts, tree = false }: { counts: HierarchyCounts; tree?: boolean }) {
  return (
    <span className={`am-hier__counts${tree ? ' am-hier__counts--tree' : ''}`}>
      <span className="am-hier__c am-hier__c--sel" data-count-selected={counts.selected}>★{counts.selected}</span>
      <span className="am-hier__c" data-count-pending={counts.pending}>○{counts.pending}</span>
      <span className="am-hier__c am-hier__c--cut" data-count-eliminated={counts.eliminated}>✕{counts.eliminated}</span>
      <span className="am-hier__c am-hier__c--total">共 {counts.total}</span>
    </span>
  )
}

export default function AssetHierarchy() {
  const rawOpenAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  // VG 徽标反查/定位需要画布图；订阅 graph 让徽标随画布变化即时刷新。
  const graph = useCanvasStore((s) => s.graph)

  // 打开资产详情是导航交互 → 先拍快照进应用历史栈（AssetManager/AssetLibrary 同范式）。
  const openAssetDetail = useCallback((uuid: string) => {
    useCanvasStore.getState().navPushCallback?.()
    rawOpenAssetDetail(uuid)
  }, [rawOpenAssetDetail])

  const { assets, loading, error, reload, patchLocal } = useRealAssets(projectId)

  // ── 视图 state ──
  /** 域过滤（空集 = 全部；点击域节点切单选，再点/点「全部」清空）。 */
  const [domainFilter, setDomainFilter] = useState<Set<AssetDomain>>(new Set())
  /** 搜索（name/tags/prompt；命中组保留、组内未命中卡隐藏并计 data-count-filtered-out）。 */
  const [search, setSearch] = useState('')
  /** 组卡折叠状态（默认全展开；「折叠全部/展开全部」整集操作）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  /** 域树节点折叠（C2 parent 节点；树无第三级，折叠仅收纳视觉态）。 */
  const [collapsedDomains, setCollapsedDomains] = useState<Set<AssetDomain>>(new Set())

  // ── C4 批量决策 state（D-06/D-07，62-05） ──
  /** 组多选：选中组 key 集；≥1 时 toolbar 下方渲染批量条。 */
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set())
  /** 批量淘汰 armed 态（两段式 arm-confirm：首击武装文案变确认，5s 未二击自动解除）。 */
  const [armedEliminate, setArmedEliminate] = useState(false)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarmEliminate = useCallback(() => {
    if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null }
    setArmedEliminate(false)
  }, [])
  const armEliminate = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmedEliminate(true)
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null
      setArmedEliminate(false)
    }, 5000)
  }, [])
  // unmount 清理 timer。
  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current) }, [])
  // 选择集变化 → 解除武装（armed 文案内嵌组数 N，选择变了旧意图即失效）。
  useEffect(() => { disarmEliminate() }, [selectedGroupKeys, disarmEliminate])

  const toggleGroupSelect = useCallback((key: string) => {
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleDomainNode = useCallback((dom: AssetDomain) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(dom)) next.delete(dom)
      else next.add(dom)
      return next
    })
  }, [])
  const clickDomainNode = useCallback((dom: AssetDomain) => {
    setDomainFilter((prev) => (prev.has(dom) ? new Set() : new Set([dom])))
  }, [])

  // ── 派生模型（纯函数家承载全部数据派生，D-04 判定式单套） ──
  const model = useMemo(() => buildHierarchyModel(assets), [assets])
  const nodeOf = useCallback(
    (dom: AssetDomain): HierarchyDomainNode => model.domains.find((n) => n.domain === dom)!,
    [model],
  )
  /** 可见域（域过滤后；固定纲序）。 */
  const visibleDomains = useMemo(
    () => model.domains.filter((n) => domainFilter.size === 0 || domainFilter.has(n.domain)),
    [model, domainFilter],
  )

  // ── 搜索匹配（name/tags/prompt；空查询恒命中） ──
  const q = search.trim().toLowerCase()
  const itemMatches = useCallback(
    (d: AssetDetail) => !q || `${d.name ?? ''} ${d.tags ?? ''} ${d.prompt ?? ''}`.toLowerCase().includes(q),
    [q],
  )
  const titleMatches = useCallback((t: string) => !q || t.toLowerCase().includes(q), [q])

  // ── 声纹卡角色设定图映射 —— 与 AssetLibrary.charPortraitMap 同式镜像 ──
  //（renderAssetCard deps 需要；62-04 不动 AssetLibrary 既有结构，故在此复刻。）
  const charPortraitMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of assets) {
      if (d.state === 'eliminated') continue
      const st = inferSubtype(d)
      if (st !== 'character_concept' && st !== 'turnaround_sheet') continue
      if (!d.filePath) continue
      const cnName = (d.name || '').replace(/\s*v\d+\s*$/i, '').trim()
      if (!cnName) continue
      const url = resolveMediaUrl(d.filePath)
      if (url && (st === 'character_concept' || !m.has(cnName))) m.set(cnName, url)
    }
    return m
  }, [assets])

  // ── 导航 / 画布联动 handler ──

  /** 📍 定位到画布（双前缀反查 + focus + 切画布视图；AssetLibrary 同式）。 */
  const handleLocateOnCanvas = useCallback((a: AssetItem) => {
    const store = useCanvasStore.getState()
    const nodeId = (a.id != null ? resolveAssetNodeId(store.graph, a.id) : null) ?? `asset-${a.id}`
    store.navPushCallback?.()
    store.setFocusAssetNodeId(nodeId)
    store.setViewMode('canvas')
  }, [])

  /** 组→画布变体墙（C6-2）：命中 → openWallByGroup + 切画布；未命中 → 仅定位降级
   *  （AssetLibrary.handleGoCanvasSelect 同式——「去画布选片 →」既有行为原样）。 */
  const handleGoCanvas = useCallback((primary: AssetDetail, vg: { groupId: string } | null) => {
    const store = useCanvasStore.getState()
    store.navPushCallback?.()
    const nodeId = resolveAssetNodeId(store.graph, primary.id) ?? `asset-${primary.id}`
    store.setFocusAssetNodeId(nodeId)
    if (vg) useVariantPickerStore.getState().openWallByGroup(vg.groupId)
    store.setViewMode('canvas')
  }, [])

  // ── 三态流转（assetHierarchy.ts 共享 handler；与资产库同调用点，D-05 syncCanvas 注入） ──
  const baseCtx = useCallback(
    () => ({ assets, patchLocal, reload, showToast }),
    [assets, patchLocal, reload, showToast],
  )
  /** D-05 syncCanvas 注入：projectId/episodesId 均就绪（number）才构造，否则 undefined。 */
  const ctxWithSync = useCallback(() => {
    const s = useCanvasStore.getState()
    const syncCanvas = (projectId != null && s.episodesId != null)
      ? { projectId, episodesId: s.episodesId, graph: s.graph }
      : undefined
    return { ...baseCtx(), syncCanvas }
  }, [baseCtx, projectId])
  const handleSelect = useCallback((assetId: number, groupKey: string) => {
    return selectGroupWinner(assetId, groupKey, ctxWithSync())
  }, [ctxWithSync])

  // ── C4 批量决策（62-05）：选中组对象从全模型取（用户显式勾选，不受搜索/域过滤影响） ──
  const selectedGroups = useMemo(
    () => model.domains.flatMap((n) => n.groups).filter((g) => selectedGroupKeys.has(g.key)),
    [model, selectedGroupKeys],
  )
  /** 批量选定（D-06）：逐组走共享 selectGroupWinner（含 D-05 画布同步）；执行后清选择集。 */
  const handleBatchSelect = useCallback(async () => {
    await runBatchSelect(selectedGroups, ctxWithSync())
    setSelectedGroupKeys(new Set())
  }, [selectedGroups, ctxWithSync])
  /** 批量淘汰（D-06）：两段式 arm-confirm——首击武装（5s 自动解除），二击执行后立即复位
   *  并清选择集。淘汰不走 winner 选定，无需画布同步 ctx。 */
  const handleBatchEliminate = useCallback(async () => {
    if (!armedEliminate) {
      armEliminate()
      return
    }
    disarmEliminate()
    await runBatchEliminate(selectedGroups, baseCtx())
    setSelectedGroupKeys(new Set())
  }, [armedEliminate, armEliminate, disarmEliminate, selectedGroups, baseCtx])

  /** L3 卡 deps（层级模式：三态按钮按卡自身状态出）。 */
  const hierDeps: AssetCardDeps = {
    mode: 'hierarchy',
    assets,
    patchLocal,
    reload,
    showToast,
    onSelect: handleSelect,
    onDeselect: (d) => deselectAsset(d, baseCtx()),
    onRestore: (d) => restoreAsset(d, baseCtx()),
    onLocate: handleLocateOnCanvas,
    openAssetDetail,
    charPortraitMap,
  }

  /** 单件桶卡阶段徽标（空 phaseCode 不传 → 不渲染徽标）。 */
  const singletonPhaseOf = (d: AssetDetail): { singletonPhase?: AssetCardSingletonPhase } => {
    const p = assetPhaseOf(d)
    return p.phaseCode ? { singletonPhase: { phaseCode: p.phaseCode, source: p.source } } : {}
  }

  /** L2 组卡（C3）。搜索语义：组命中（title 或任一成员）保留；title 命中而成员
   *  全未命中时整组展示（组级命中），否则仅展示命中成员；隐藏数计入
   *  data-count-filtered-out。折叠只收 L3 网格，header 常驻 sticky（既有样式）。 */
  const renderGroupCard = (g: HierarchyGroup) => {
    const collapsed = collapsedGroups.has(g.key)
    const phase = assetPhaseOf(g.items[0])
    const primary = g.items.find((d) => d.isPrimaryView) ?? g.items[0]
    const vg = findVariantGroupForAsset(graph, primary.id)
    const titleHit = titleMatches(g.title)
    const matched = g.items.filter(itemMatches)
    const showItems = titleHit && matched.length === 0 ? g.items : matched
    const filteredOut = g.items.length - showItems.length
    return (
      <div
        key={g.key}
        className="am-group"
        data-testid="hier-group"
        data-group-key={g.key}
        data-collapsed={collapsed ? 'true' : 'false'}
        data-count-selected={g.counts.selected}
        data-count-pending={g.counts.pending}
        data-count-eliminated={g.counts.eliminated}
        data-count-total={g.counts.total}
        data-count-filtered-out={filteredOut}
      >
        <div className="am-group__header">
          {/* 组 checkbox（C4/D-06，62-05 落位）：组层多选入口；单件桶无 checkbox（无批量决策意义）。
              手动组不禁用——批量淘汰可用（D-07 只绑批量选定）。 */}
          <label className="am-hier__group-check" title="选中该组参与批量选定 / 批量淘汰">
            <input
              type="checkbox"
              data-testid="hier-group-check"
              data-group-key={g.key}
              checked={selectedGroupKeys.has(g.key)}
              onChange={() => toggleGroupSelect(g.key)}
            />
          </label>
          <span className="am-group__emoji">{g.emoji}</span>
          <span className="am-group__title">{g.hasPrimary ? `★ ${g.title}` : g.title}</span>
          {/* C6-1 阶段徽标：组首推导（空 phaseCode 不渲染）；tooltip 区分直读/推导 */}
          {phase.phaseCode && (
            <span
              className="am-badge"
              data-testid="hier-group-phase"
              title={phase.source === 'meta' ? '资产 meta 直读' : '按子类型推导'}
            >{phase.phaseCode}</span>
          )}
          {/* C6-2 VG 徽标：主资产（primary ?? first）反查命中 → 可点 chip 开变体墙；
              未命中/图未加载 → 「去画布选片 →」降级仅定位（既有串）。 */}
          {vg ? (
            <button
              className="am-badge am-hier__vg"
              data-testid="hier-group-vg"
              data-vg-id={vg.groupId}
              title={`在画布变体墙中并排对比选片 · ${vg.groupId}`}
              onClick={() => handleGoCanvas(primary, vg)}
            >⧉ 画布组 · {vg.size}</button>
          ) : (
            <button
              className="am-group__hint"
              title="在画布变体墙中并排对比选片"
              onClick={() => handleGoCanvas(primary, null)}
              style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0, font: 'inherit' }}
            >
              去画布选片 →
            </button>
          )}
          {/* D-07 手动组标注：场景/声纹组恒显（批量选定跳过且 toast 明示；checkbox 不禁用）。 */}
          {(g.isManualScene || g.isManualVoice) && (
            <span
              className="am-badge am-hier__manual-chip"
              data-testid="hier-manual-chip"
              title="场景/声纹不参与批量选定 · 需逐组手动选择"
            >✋ 手动选择</span>
          )}
          <span className="am-group__count"><CountChips counts={g.counts} /></span>
          <span
            className={`am-tree-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
            onClick={(e) => { e.stopPropagation(); toggleGroup(g.key) }}
            role="button"
            aria-label={collapsed ? '展开组' : '折叠组'}
          >▼</span>
        </div>
        {!collapsed && (
          <div className="am-group__grid">
            {showItems.map((d) => renderAssetCard(d, hierDeps))}
          </div>
        )}
      </div>
    )
  }

  /** 单件桶（C3 单件变体）：恒排本域末尾；空桶整卡不渲染。
   *  金竖条去除（.am-group--singleton，非互斥组）；桶内卡带阶段徽标（hier-card-phase）。 */
  const renderSingletons = (node: HierarchyDomainNode) => {
    const items = node.singletons.items.filter(itemMatches)
    if (items.length === 0) return null
    return (
      <div
        key={`__singletons_${node.domain}`}
        className="am-group am-group--singleton"
        data-testid="hier-singletons"
        data-domain={node.domain}
      >
        <div className="am-group__header">
          <span className="am-group__emoji">📦</span>
          <span className="am-group__title">单件资产</span>
          <span className="am-group__hint" title="无互斥组的单产物 · 不参与组间流转">无互斥组的单产物 · 不参与组间流转</span>
          <span className="am-group__count">共 {items.length}</span>
        </div>
        <div className="am-group__grid">
          {items.map((d) => renderAssetCard(d, hierDeps, singletonPhaseOf(d)))}
        </div>
      </div>
    )
  }

  /** 搜索命中组过滤（title 或任一成员命中）。 */
  const groupMatches = useCallback(
    (g: HierarchyGroup) => titleMatches(g.title) || g.items.some(itemMatches),
    [titleMatches, itemMatches],
  )

  const visibleGroupKeys = useMemo(
    () => visibleDomains.flatMap((n) => n.groups.map((g) => g.key)),
    [visibleDomains],
  )

  return (
    <div className="am-hier" data-testid="hierarchy-view">
      {/* ── L1 域导航树（C2；.am-tree 既有词汇原样） ── */}
      <aside className="am-tree">
        <div className="am-tree-group">
          <div className="am-tree-group__h"><span>资产层级</span></div>
          <button
            className={`am-tree-node ${domainFilter.size === 0 ? 'is-on' : ''}`}
            data-testid="hier-all-node"
            onClick={() => setDomainFilter(new Set())}
          >
            <span className="am-tree-node__ic">▦</span>全部
            <CountChips counts={model.all} tree />
          </button>
        </div>
        {DOMAIN_META.map(({ key, label, icon }) => {
          const node = nodeOf(key)
          const isEmpty = node.counts.total === 0
          const collapsed = collapsedDomains.has(key)
          return (
            <div className="am-tree-section" key={key}>
              <button
                className={`am-tree-node am-tree-node--parent ${domainFilter.has(key) ? 'is-on' : ''} ${isEmpty ? 'is-empty' : ''}`}
                data-testid="hier-domain-node"
                data-domain={key}
                data-count-selected={node.counts.selected}
                data-count-pending={node.counts.pending}
                data-count-eliminated={node.counts.eliminated}
                onClick={() => clickDomainNode(key)}
              >
                <span
                  className={`am-tree-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
                  onClick={(e) => { e.stopPropagation(); toggleDomainNode(key) }}
                  role="button"
                  aria-label={collapsed ? '折叠域' : '展开域'}
                >▼</span>
                <span className="am-tree-node__ic">{icon}</span>{label}
                {/* 域计数含 reportAudit 排除项（D-03） */}
                <CountChips counts={node.counts} tree />
              </button>
            </div>
          )
        })}
      </aside>

      {/* ── 主区：toolbar + 组卡列表 ── */}
      <div className="am-hier__main">
        <div className="am-hier__toolbar">
          <label className="am-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资产 / 组…" />
          </label>
          <button
            className="am-btn am-btn--ghost"
            data-testid="hier-expand-all"
            onClick={() => setCollapsedGroups(new Set())}
          >展开全部</button>
          <button
            className="am-btn am-btn--ghost"
            data-testid="hier-collapse-all"
            onClick={() => setCollapsedGroups(new Set(visibleGroupKeys))}
          >折叠全部</button>
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

        {/* ── C4 批量决策条（D-06/D-07）：in-flow 粘条（非浮层），选中组 ≥1 渲染 ── */}
        {selectedGroupKeys.size > 0 && (
          <div className="am-hier__batch" data-testid="hier-batch-bar">
            <span className="am-hier__batch-n">已选 {selectedGroupKeys.size} 组</span>
            <button
              className="am-btn am-btn--primary"
              data-testid="hier-batch-select"
              onClick={handleBatchSelect}
            >批量选定</button>
            <button
              className="am-btn am-btn--ghost am-hier__batch-eliminate"
              data-testid="hier-batch-eliminate"
              data-armed={armedEliminate ? 'true' : 'false'}
              onClick={handleBatchEliminate}
            >{armedEliminate ? `确认淘汰 ${selectedGroupKeys.size} 组待选？` : '批量淘汰'}</button>
            <button
              className="am-btn am-btn--ghost"
              data-testid="hier-batch-clear"
              onClick={() => { disarmEliminate(); setSelectedGroupKeys(new Set()) }}
            >清除</button>
          </div>
        )}

        <div className="am-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div className="am-loading" data-testid="hier-loading">
              {[1, 2, 3, 4, 5, 6].map((i) => <div className="am-skeleton-card" key={i} />)}
              <div className="am-loading__label">正在从资产注册表加载…</div>
            </div>
          ) : error ? (
            <div className="am-empty" data-testid="hier-error">
              资产加载失败：{error}<br />
              <button className="am-btn am-btn--ghost" style={{ marginTop: 12 }} onClick={reload}>重试</button>
            </div>
          ) : assets.length === 0 ? (
            <div className="am-empty">
              资产库为空 —— 运行管线（P04 角色设计 / P07 场景）后会自动注册到这里。
            </div>
          ) : (
            <div className="am-groups">
              {visibleDomains.map((node) => (
                <Fragment key={node.domain}>
                  {node.groups.filter(groupMatches).map(renderGroupCard)}
                  {renderSingletons(node)}
                  {node.counts.total === 0 && (
                    <div className="am-empty">该域暂无资产 —— 运行管线产出后自动注册到这里。</div>
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
