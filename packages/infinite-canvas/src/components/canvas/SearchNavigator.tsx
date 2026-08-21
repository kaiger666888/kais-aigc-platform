/**
 * SearchNavigator.tsx — 搜索导航器(Phase 55-04 / NAV-03,UI-SPEC §1)。
 *
 * `/` 打开的浮层:输入即时过滤(无 debounce),结果按场景分组(sceneNumOf
 * 口径,55-02 共享 util),↑↓ 跨组移动/Enter 跳转(setFocusAssetNodeId,
 * 既有聚焦 effect 语义不改)/Esc 关闭。搜索期间画布节点零隐藏过滤(Do-Not-Regress 3——Phase 45 的隐藏式路径已删除,本组件纯只读派生)。
 *
 * 本文件的纯派生部分 deriveSearchResults 先行(Task 1),组件壳在后
 * (Task 2);cmdk 已否决(RESEARCH),自建列表。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { sceneNumOf, sceneColorOf } from '../../utils/sceneGrouping'
import { theme } from '../../theme/catppuccin'

// ─── 纯派生(Task 1) ───────────────────────────────────────────────────────

export interface SearchHit {
  nodeId: string;
  label: string;
  sub: string;
  sceneNum: number | null;
  kind: 'shot' | 'other';
}

export interface SearchGroup {
  sceneNum: number | null;
  title: string;
  hits: SearchHit[];
}

export interface SearchResult {
  groups: SearchGroup[];
  truncated: boolean;
}

const MAX_HITS = 200;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * 纯只读派生:索引 label/shot_id/prompt/description + raw 穿透
 * (video_prompt/ltx_prompt),大小写不敏感子串;shot 节点按 sceneNumOf
 * 分组升序,非 shot 归「其他资产」末组;>200 截断。不 mutate 输入。
 */
export function deriveSearchResults(
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  query: string,
  rawDataByNodeId?: Record<string, Record<string, unknown>> | null,
): SearchResult {
  const q = query.trim().toLowerCase()
  if (q === '') return { groups: [], truncated: false }

  const byScene = new Map<number, SearchHit[]>()
  const others: SearchHit[] = []
  let total = 0
  let truncated = false

  for (const node of nodes) {
    const data = node.data ?? {}
    const raw = rawDataByNodeId?.[node.id] ?? {}
    const shotId = str(data.shot_id) ?? str(raw.shot_id)
    const label =
      str(data.label) ?? shotId ?? str(data.name) ?? node.id
    const prompt = str(data.prompt) ?? str(raw.video_prompt) ?? str(raw.ltx_prompt) ?? null
    const description = str(data.description) ?? null

    const haystack = [label, shotId, prompt, description]
      .filter((s): s is string => s != null)
      .join('\n')
      .toLowerCase()
    if (!haystack.includes(q)) continue

    if (total >= MAX_HITS) {
      truncated = true
      break
    }
    total++

    const hit: SearchHit = {
      nodeId: node.id,
      label,
      sub: prompt != null ? prompt.slice(0, 60) : (description?.slice(0, 60) ?? ''),
      sceneNum: shotId != null ? sceneNumOf(shotId) : null,
      kind: shotId != null ? 'shot' : 'other',
    }
    if (hit.kind === 'shot' && hit.sceneNum != null && hit.sceneNum > 0) {
      const arr = byScene.get(hit.sceneNum)
      if (arr == null) byScene.set(hit.sceneNum, [hit])
      else arr.push(hit)
    } else {
      others.push(hit)
    }
  }

  const groups: SearchGroup[] = [...byScene.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sceneNum, hits]) => ({
      sceneNum,
      title: `场景 ${sceneNum}`,
      hits,
    }))
  if (others.length > 0) {
    groups.push({ sceneNum: null, title: '其他资产', hits: others })
  }
  return { groups, truncated }
}

// ─── 组件壳(Task 2) ───────────────────────────────────────────────────────

export default function SearchNavigator({ open, onClose, initialQuery = '' }: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}): React.ReactElement | null {
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const setFocusAssetNodeId = useCanvasStore((s) => s.setFocusAssetNodeId)
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setActive(0)
      // 打开即聚焦输入框(键盘流入口)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, initialQuery])

  const flatNodes = useMemo(
    () => (graph?.nodes ?? []).map((n) => ({ id: n.id, data: n as unknown as Record<string, unknown> })),
    [graph],
  )

  const result = useMemo(
    () => deriveSearchResults(flatNodes, query, rawDataByNodeId as unknown as Record<string, Record<string, unknown>> | null),
    [flatNodes, query, rawDataByNodeId],
  )

  // 打开态无输入:全部分组骨架(全部 shot 节点按场景分组——空格查询的退化路径)
  const browse = useMemo(
    () => (query.trim() === '' ? deriveSearchResults(flatNodes, ' ', rawDataByNodeId as unknown as Record<string, Record<string, unknown>> | null) : null),
    [flatNodes, query, rawDataByNodeId],
  )
  const effective = query.trim() === '' ? browse : result
  const flatHits = useMemo(
    () => (effective?.groups ?? []).flatMap((g) => g.hits),
    [effective],
  )

  if (!open) return null

  const jump = (nodeId: string) => {
    setFocusAssetNodeId(nodeId)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(0, flatHits.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const hit = flatHits[active]
      if (hit != null) jump(hit.nodeId)
    }
  }

  let runningIndex = -1

  return (
    <div
      data-testid="search-navigator"
      role="dialog"
      aria-label="搜索导航器"
      onKeyDown={onKey}
      style={{
        position: 'fixed',
        top: '15vh',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(560px, 90vw)',
        background: 'var(--cv-bg-panel)',
        boxShadow: 'var(--cv-shadow-pop, var(--cv-shadow-card))',
        backdropFilter: 'blur(4px)',
        borderRadius: 10,
        border: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '60vh',
        overflow: 'clip',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))' }}>
        <input
          ref={inputRef}
          className="cv-search-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          placeholder="搜索镜头 / 场景 / 节点…"
          aria-label="搜索镜头 / 场景 / 节点"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--cv-bg-card)', border: '1px solid var(--cv-line-panel, rgba(255,255,255,0.08))', borderRadius: 6, color: theme.text.primary, fontSize: 12, padding: '7px 10px', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {effective == null || effective.groups.length === 0 ? (
          query.trim() === '' ? (
            <div style={{ padding: 24, textAlign: 'center', color: theme.text.secondary, fontSize: 11 }}>
              本集暂无分镜/资产节点
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>未找到匹配项</div>
              <div style={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.7 }}>
                试试场景号（如 S03）、景别（近景 / 特写）或运镜（推镜 / 摇镜）关键词
              </div>
            </div>
          )
        ) : (
          effective.groups.map((g) => (
            <div key={g.title}>
              <div style={{ position: 'sticky', top: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--cv-bg-panel)', borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.04))', zIndex: 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: g.sceneNum != null ? sceneColorOf(g.sceneNum) : 'var(--cv-lane-label)' }} />
                <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, fontWeight: 600, color: g.sceneNum != null ? sceneColorOf(g.sceneNum) : 'var(--cv-lane-label)' }}>{g.title}</span>
                <span style={{ fontSize: 10, color: theme.text.tertiary }}>{g.hits.length}</span>
              </div>
              {g.hits.map((hit) => {
                runningIndex++
                const idx = runningIndex
                const isActive = idx === active
                return (
                  <button
                    key={hit.nodeId}
                    onClick={() => jump(hit.nodeId)}
                    onMouseEnter={() => setActive(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      minHeight: 28, padding: '5px 12px 5px 14px', cursor: 'pointer',
                      background: isActive ? 'rgba(237,238,241,0.10)' : 'none',
                      boxShadow: isActive ? 'inset 2px 0 0 var(--cv-text-primary, #EDEEF1)' : 'none',
                      border: 'none', textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ fontSize: 11, color: theme.text.primary, flex: 1, overflow: 'clip', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.label}</span>
                    <span style={{ fontSize: 10, color: theme.text.tertiary, maxWidth: '55%', overflow: 'clip', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.sub}</span>
                  </button>
                )
              })}
            </div>
          ))
        )}
        {effective?.truncated === true && (
          <div style={{ padding: '6px 12px', fontSize: 10, color: theme.text.tertiary }}>
            结果超过 200 条已截断——输入更精确的关键词
          </div>
        )}
      </div>

      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))', fontSize: 10, color: theme.text.tertiary }}>
        ↑↓ 选择 · Enter 跳转 · Esc 关闭
      </div>
    </div>
  )
}
