/**
 * StyleLibraryPanel.tsx — Krea 风格库选择器侧栏浮层(wt/style-library, 2026-09-06)。
 *
 * Krea 2 StyleSwitching 3548 条轻量风格词库(Kai 终审拍板全量接入,与 art_skills
 * 11 套重风格并存互补)。抽屉与 BranchPanel 同构(absolute 右浮层 + Esc 关 +
 * token-only 色彩);只做「查词 + 组装 prompt + 复制」,不碰管线/节点——风格应用
 * 是复制进用户自己的生成提示词,零写操作。
 *
 * probe_verdict 契约(数据由 data/style-library/inject_probe_verdict.py 烧入):
 *  - reject(探针唯一 1 条 glitch)服务端 list 缺省已隐藏;「显示已否决」开关
 *    显式传 includeRejected=true,可见时卡片打 ⚠ 角标;
 *  - pass/fix 不做卡片级标记(选词场景无差别),详情区以 chip 如实展示。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../../theme/catppuccin'
import {
  fetchStyleCategories,
  fetchStyleList,
  composeStylePrompt,
  copyText,
  type StyleCategoryRow,
  type StyleListItem,
  type StyleProbeVerdict,
} from '../../services/styleLibraryApi'

const PAGE_SIZE = 60

/** 一级 tab 聚合模型:全部分类按 group 键求和(服务端 categories 已带 group_*)。 */
interface GroupTab {
  key: string
  label: string
  count: number
}

function aggregateGroups(rows: StyleCategoryRow[]): GroupTab[] {
  const map = new Map<string, GroupTab>()
  for (const r of rows) {
    const cur = map.get(r.group_en)
    if (cur) cur.count += r.count
    else map.set(r.group_en, { key: r.group_en, label: r.group_cn, count: r.count })
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

const VERDICT_LABEL: Record<NonNullable<StyleProbeVerdict>, string> = {
  pass: '探针 pass',
  fix: '探针 fix(修后可用)',
  reject: '探针 reject(已否决)',
}

export default function StyleLibraryPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [categories, setCategories] = useState<StyleCategoryRow[] | null>(null)
  const [catsError, setCatsError] = useState(false)
  const [group, setGroup] = useState<string | null>(null) // null = 全部
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('') // 防抖后的生效值
  const [showRejected, setShowRejected] = useState(false)
  const [items, setItems] = useState<StyleListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState(false)
  const [selected, setSelected] = useState<StyleListItem | null>(null)
  const [subject, setSubject] = useState('')
  const [copied, setCopied] = useState(false)

  const requestIdRef = useRef(0)
  const copiedTimerRef = useRef<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // Esc 关闭(BranchPanel 同款)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 类目(一次;失败置错态,面板降级为可关闭的空态)
  useEffect(() => {
    let alive = true
    fetchStyleCategories().then((rows) => {
      if (!alive) return
      if (rows == null) setCatsError(true)
      setCategories(rows)
    })
    return () => { alive = false }
  }, [])

  // 搜索防抖 300ms
  useEffect(() => {
    const tid = window.setTimeout(() => setSearch(searchInput), 300)
    return () => window.clearTimeout(tid)
  }, [searchInput])

  // 列表加载(group / search / showRejected 变化 → 重置第一页)
  useEffect(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    setListError(false)
    fetchStyleList({ group: group ?? undefined, search: search || undefined, page: 1, pageSize: PAGE_SIZE, includeRejected: showRejected })
      .then((res) => {
        if (requestIdRef.current !== reqId) return // 竞态守卫:旧响应丢弃
        if (res == null) {
          setListError(true)
          setItems([])
          setTotal(0)
        } else {
          setItems(res.items)
          setTotal(res.total)
          setPage(1)
        }
        setLoading(false)
      })
    gridRef.current?.scrollTo({ top: 0 })
  }, [group, search, showRejected])

  useEffect(() => () => {
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
  }, [])

  const groups = useMemo(() => (categories ? aggregateGroups(categories) : []), [categories])

  const loadMore = () => {
    const reqId = ++requestIdRef.current
    setLoadingMore(true)
    fetchStyleList({ group: group ?? undefined, search: search || undefined, page: page + 1, pageSize: PAGE_SIZE, includeRejected: showRejected })
      .then((res) => {
        if (requestIdRef.current !== reqId) return
        if (res != null) {
          setItems((prev) => [...prev, ...res.items])
          setTotal(res.total)
          setPage(res.page)
        }
        setLoadingMore(false)
      })
  }

  const pick = (item: StyleListItem) => {
    setSelected((prev) => (prev?.id === item.id ? null : item))
    setSubject('')
    setCopied(false)
  }

  const composed = selected ? composeStylePrompt(selected.prompt, subject) : ''
  const doCopy = async () => {
    if (!selected) return
    const ok = await copyText(composed)
    setCopied(ok)
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      data-testid="style-library-panel"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 460,
        background: 'var(--cv-bg-panel)',
        backdropFilter: 'blur(6px)',
        borderLeft: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
        boxShadow: theme.shadow.pop,
        zIndex: 60,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* 头部 */}
      <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary }}>
          风格库
          <span style={{ fontSize: 10, fontWeight: 400, color: theme.text.tertiary, marginLeft: 8 }}>Krea 2 · 3548 条 · 复制 prompt 供生成用</span>
        </span>
        <button onClick={onClose} title="关闭 (Esc)" style={{ background: 'none', border: 'none', color: theme.text.secondary, cursor: 'pointer', fontSize: 14, padding: '4px 8px', borderRadius: 6 }}>✕</button>
      </div>

      {/* 搜索 + 选项 */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索风格名(中/英文,大小写不敏感)"
          style={{
            height: 30, padding: '0 10px', fontSize: 12, borderRadius: 7,
            background: theme.bg.input, border: `1px solid ${theme.border.default}`,
            color: theme.text.primary, outline: 'none', width: '100%',
          }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.text.secondary, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showRejected}
            onChange={(e) => setShowRejected(e.target.checked)}
            style={{ accentColor: theme.status.rejected, cursor: 'pointer' }}
          />
          显示已否决(probe reject,1 条 glitch 类)
        </label>
      </div>

      {/* 一级分类 tab */}
      <div style={{ padding: '0 16px 10px', display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0, borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.04))' }}>
        {catsError && <span style={{ fontSize: 11, color: theme.status.rejected }}>类目加载失败——风格库 API 不可用(需部署后端)</span>}
        {!catsError && categories == null && <span style={{ fontSize: 11, color: theme.text.tertiary }}>类目加载中…</span>}
        {groups.length > 0 && (
          <TabPill active={group == null} onClick={() => setGroup(null)} label="全部" count={groups.reduce((s, g) => s + g.count, 0)} />
        )}
        {groups.map((g) => (
          <TabPill key={g.key} active={group === g.key} onClick={() => setGroup(group === g.key ? null : g.key)} label={g.label} count={g.count} />
        ))}
      </div>

      {/* 缩略图网格(60/页 + 加载更多) */}
      <div ref={gridRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: theme.text.tertiary }}>加载中…</div>
        ) : listError ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: theme.status.rejected, lineHeight: 1.7 }}>列表加载失败——请确认后端 style-library 路由已部署</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: theme.text.secondary, lineHeight: 1.7 }}>无匹配风格——换个关键词或类目试试</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {items.map((it) => (
                <StyleCard key={it.id} item={it} active={selected?.id === it.id} onClick={() => pick(it)} />
              ))}
            </div>
            {items.length < total ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  display: 'block', margin: '12px auto 4px', height: 28, padding: '0 16px',
                  fontSize: 11, borderRadius: 7, cursor: loadingMore ? 'wait' : 'pointer',
                  background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                  color: theme.text.secondary,
                }}
              >
                {loadingMore ? '加载中…' : `加载更多(已加载 ${items.length}/${total})`}
              </button>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 10, color: theme.text.tertiary, padding: '12px 0 4px' }}>已全部加载 {total} 条</div>
            )}
          </>
        )}
      </div>

      {/* 详情 + prompt 组装 */}
      {selected && (
        <div style={{ flexShrink: 0, maxHeight: '46%', overflowY: 'auto', borderTop: `1px solid ${theme.border.default}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>{selected.name_cn}</span>
            {selected.name !== selected.name_cn && (
              <span style={{ fontSize: 10, color: theme.text.tertiary, fontFamily: 'var(--cv-font-mono, monospace)' }}>{selected.name}</span>
            )}
            {selected.probe_verdict != null && (
              <span
                title="Z-Image Turbo 迁移探针 Kai 终审结论"
                style={{
                  fontSize: 9, fontWeight: 600, borderRadius: 4, padding: '1px 6px',
                  color: selected.probe_verdict === 'reject' ? theme.status.rejected : theme.text.secondary,
                  border: `1px solid ${selected.probe_verdict === 'reject' ? theme.status.rejected : theme.border.strong}`,
                }}
              >
                {VERDICT_LABEL[selected.probe_verdict]}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: theme.text.tertiary }}>{selected.category_cn}</div>
          <div style={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.6 }}>
            最终 prompt(<code style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}>{'{prompt}'}</code> 为 subject 占位符,留空 = 只用风格词)
          </div>
          <div
            style={{
              background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 7,
              padding: '8px 10px', fontSize: 11, lineHeight: 1.6, color: theme.text.primary,
              fontFamily: 'var(--cv-font-mono, monospace)', maxHeight: 96, overflowY: 'auto', userSelect: 'text',
            }}
          >
            {composed}
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="subject(画面主体,可选,如:a lone samurai in the rain)"
            style={{
              height: 28, padding: '0 10px', fontSize: 11, borderRadius: 7,
              background: theme.bg.input, border: `1px solid ${theme.border.default}`,
              color: theme.text.primary, outline: 'none', width: '100%',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => void doCopy()}
              style={{
                height: 28, padding: '0 14px', fontSize: 11, fontWeight: 600, borderRadius: 7,
                cursor: 'pointer', background: theme.button.primary, color: theme.text.onAccent,
                border: `1px solid ${theme.button.primary}`,
              }}
            >
              {copied ? '已复制 ✓' : '复制 prompt'}
            </button>
            <span style={{ fontSize: 10, color: theme.text.tertiary }}>{composed.length} 字符</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TabPill({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      style={{
        height: 22, padding: '0 9px', fontSize: 11, borderRadius: 11, cursor: 'pointer',
        background: active ? theme.bg.cardHover : 'transparent',
        border: `1px solid ${active ? theme.border.strong : theme.border.default}`,
        color: active ? theme.text.primary : theme.text.secondary,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span style={{ fontSize: 9, color: theme.text.tertiary, marginLeft: 4 }}>{count}</span>
    </button>
  )
}

function StyleCard({ item, active, onClick }: { item: StyleListItem; active: boolean; onClick: () => void }): React.ReactElement {
  const isReject = item.probe_verdict === 'reject'
  return (
    <button
      onClick={onClick}
      title={`${item.name_cn}\n${item.prompt}`}
      style={{
        padding: 0, textAlign: 'left', cursor: 'pointer', background: 'transparent',
        border: `1px solid ${isReject ? theme.status.rejected : active ? theme.score.high : theme.border.default}`,
        borderRadius: 8, overflow: 'hidden', position: 'relative', display: 'block', width: '100%',
      }}
    >
      <div style={{ aspectRatio: '1 / 1', background: theme.bg.card, width: '100%' }}>
        <img
          src={item.thumbUrl}
          alt={item.name_cn}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
        />
      </div>
      {isReject && (
        <span
          style={{
            position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700,
            background: theme.status.rejected, color: theme.bg.canvas,
            borderRadius: 4, padding: '1px 5px',
          }}
        >
          ⚠ 已否决
        </span>
      )}
      <div
        style={{
          padding: '4px 6px', fontSize: 10, lineHeight: 1.4, color: active ? theme.text.primary : theme.text.secondary,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          background: active ? theme.bg.cardHover : 'transparent',
        }}
      >
        {item.name_cn}
      </div>
    </button>
  )
}
