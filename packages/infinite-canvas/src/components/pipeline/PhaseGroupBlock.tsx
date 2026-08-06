/**
 * src/components/pipeline/PhaseGroupBlock.tsx — 分组容器（research/story/production/post）。
 *
 * 极淡分组色背景（opacity 0.04，复用 v3theme.phaseGroup）+ 顶部分组标题（中文名 + 计数）。
 * 同组阶段按 sortKey 纵向堆叠；点击分组头折叠/展开。
 * hover 依赖链高亮：上游（含自身，sortKey ≤ 悬停项）高亮，下游虚化 —— 纯 sortKey 顺序判定。
 */
import type { PhaseModel } from './model'
import type { PhaseGroup } from '../../constants'
import { theme, v3theme } from '../../theme/catppuccin'
import PhaseNode, { type HighlightState } from './PhaseNode'

interface PhaseGroupBlockProps {
  group: PhaseGroup
  title: string
  phases: PhaseModel[]
  expandedSortKeys: Set<number>
  onTogglePhase: (sortKey: number) => void
  onAssetClick: (nodeId: string) => void
  onPhaseHover: (sortKey: number | null) => void
  dependencyChains: Map<number, string[]>
  /** 当前悬停的阶段 sortKey（null = 无悬停） */
  hoverSortKey: number | null
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function PhaseGroupBlock({
  group,
  title,
  phases,
  expandedSortKeys,
  onTogglePhase,
  onAssetClick,
  onPhaseHover,
  dependencyChains,
  hoverSortKey,
  collapsed,
  onToggleCollapse,
}: PhaseGroupBlockProps): React.ReactElement {
  const color = v3theme.phaseGroup[group]
  const reached = phases.filter((p) => p.present).length
  const completed = phases.filter((p) => p.execState === 'completed').length

  function highlightOf(sortKey: number): HighlightState {
    if (hoverSortKey == null) return 'normal'
    return sortKey <= hoverSortKey ? 'highlighted' : 'dimmed'
  }

  return (
    <div
      style={{
        flex: '0 0 auto',
        width: 244,
        borderRadius: 11,
        background: `${color}0a`, // opacity ~0.04
        border: `1px solid ${color}22`,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* 分组头 */}
      <button
        onClick={onToggleCollapse}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '4px 2px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: theme.text.primary,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: '0 0 auto' }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.02em' }}>{title}</span>
        <span style={{ fontSize: 10, color: theme.text.tertiary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
          {reached}/{phases.length} 阶段 · {completed} 完成
        </span>
        <span style={{ marginLeft: 'auto', color: theme.text.tertiary, fontSize: 10 }}>
          {collapsed ? '▸ 展开' : '▾ 折叠'}
        </span>
      </button>

      {/* 阶段堆叠 */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {phases.map((m) => (
            <PhaseNode
              key={m.def.sortKey}
              model={m}
              expanded={expandedSortKeys.has(m.def.sortKey)}
              onToggle={() => onTogglePhase(m.def.sortKey)}
              onAssetClick={onAssetClick}
              onHover={onPhaseHover}
              dependencyChain={dependencyChains.get(m.def.sortKey) ?? [m.def.code]}
              highlightState={highlightOf(m.def.sortKey)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
