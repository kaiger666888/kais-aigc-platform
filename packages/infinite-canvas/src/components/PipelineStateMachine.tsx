/**
 * src/components/PipelineStateMachine.tsx — 管线状态机视图（Jenkins BlueOcean 风格）。
 *
 * 第四个 viewMode='pipeline'。横向流水线：4 分组块（选题研究→故事剧本→制作生产→后期合成）
 * 侧向排列，块间大箭头；块内阶段卡纵向堆叠。每张卡显示阶段执行状态、slot 完成度、
 * 资产三态与依赖链。完全从现有画布数据派生（pipeline/model.ts），无新后端 API。
 *
 * 数据源：store.nodes（RF 节点，data.v3 = AssetNodeV3）+ store.graph.meta（项目/剧集/时间）。
 * 交互：点阶段卡展开/折叠；点资产缩略图 → 跳画布并选中（onLocateNode）；
 *      hover 阶段 → 高亮依赖链（上游高亮 / 下游虚化）；点分组头 → 折叠该分组。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'
import { UiIcon } from './canvas/icons'
import {
  derivePipelineModels,
  dependencyChain,
  execStateLabel,
  EXEC_STATE_META,
  PIPELINE_PHASES,
  PHASE_GROUP_ORDER,
  PHASE_GROUP_LABELS,
  type PhaseModel,
  type PhaseExecState,
} from './pipeline/model'
import PhaseGroupBlock from './pipeline/PhaseGroupBlock'
import DependencyArrow from './pipeline/DependencyArrow'

interface PipelineStateMachineProps {
  onRefresh?: () => void
  onLocateNode?: (nodeId: string) => void
}

export default function PipelineStateMachine({
  onRefresh,
  onLocateNode,
}: PipelineStateMachineProps): React.ReactElement {
  const nodes = useCanvasStore((s) => s.nodes)
  const graph = useCanvasStore((s) => s.graph)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const setViewMode = useCanvasStore((s) => s.setViewMode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)

  const [expandedSortKeys, setExpandedSortKeys] = useState<Set<number>>(() => new Set())
  const [hoverSortKey, setHoverSortKey] = useState<number | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  // 派生全阶段模型（按 sortKey 排序）
  const models = useMemo(() => derivePipelineModels(nodes), [nodes])

  // 依赖链预计算（sortKey → code 链）
  const dependencyChains = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const mod of models) {
      const chain = mod.def.sortKey >= 1000
        ? [mod.def.code]
        : dependencyChain(mod.def, PIPELINE_PHASES)
      m.set(mod.def.sortKey, chain)
    }
    return m
  }, [models])

  // 默认展开"当前阶段"：首个 running，否则最高已到达 sortKey
  const currentPhase = useMemo<PhaseModel | null>(() => {
    const running = models.find((m) => m.execState === 'running')
    if (running) return running
    const reached = models.filter((m) => m.present)
    if (reached.length === 0) return null
    return reached[reached.length - 1]
  }, [models])

  // 分组 → 阶段
  const grouped = useMemo(() => {
    const byGroup = new Map<string, PhaseModel[]>()
    for (const g of PHASE_GROUP_ORDER) byGroup.set(g, [])
    for (const mod of models) {
      const arr = byGroup.get(mod.def.group)
      if (arr) arr.push(mod)
    }
    return byGroup
  }, [models])

  // 统计概览
  const stats = useMemo(() => {
    let reached = 0, completed = 0, running = 0, failed = 0, decisions = 0
    for (const m of models) {
      if (m.present) reached++
      if (m.execState === 'completed') completed++
      if (m.execState === 'running') running++
      if (m.execState === 'failed') failed++
      decisions += m.pendingDecisionCount
    }
    return { reached, completed, running, failed, decisions, total: models.length }
  }, [models])

  function handleTogglePhase(sortKey: number) {
    setExpandedSortKeys((prev) => {
      const next = new Set(prev)
      if (next.has(sortKey)) next.delete(sortKey)
      else next.add(sortKey)
      return next
    })
  }

  function handleToggleAll() {
    setExpandedSortKeys((prev) => {
      if (prev.size === models.filter((m) => m.present).length) return new Set()
      return new Set(models.filter((m) => m.present).map((m) => m.def.sortKey))
    })
  }

  function handleToggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  function handleLocate(nodeId: string) {
    if (onLocateNode) {
      onLocateNode(nodeId)
      return
    }
    // 兜底：直切画布并选中（不经导航历史）
    const target = nodes.find((n) => n.id === nodeId) ?? null
    setViewMode('canvas')
    setSelectedNode(target)
    setDetailNode(target)
  }

  const meta = graph?.meta
  const updatedMs = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : null

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.bg.panel }}>
      <style>{`@keyframes cv-pipe-spin { to { transform: rotate(360deg) } }`}</style>

      {/* 头部 */}
      <div style={{ padding: '12px 18px 10px', borderBottom: `1px solid ${theme.border.default}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', color: theme.text.primary }}>
            <UiIcon kind="pipeline" size={16} />
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
            管线状态机
          </span>
          <span style={{ width: 1, height: 14, background: theme.border.default }} />
          <span style={{ color: theme.text.secondary, fontSize: 11.5, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            项目 {projectId ?? meta?.projectId ?? '—'} · 剧集 {episodesId ?? meta?.episodesId ?? '—'}
            {updatedMs != null && (
              <> · {new Date(updatedMs).toISOString().slice(0, 16).replace('T', ' ')}</>
            )}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <HeaderButton onClick={() => onRefresh?.()} disabled={!onRefresh}>
              <UiIcon kind="iterate" size={12} />刷新
            </HeaderButton>
            <HeaderButton onClick={handleToggleAll}>
              {expandedSortKeys.size > 0 ? '收起全部' : '展开全部'}
            </HeaderButton>
          </div>
        </div>

        {/* 概览条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
          <StatChip label="已到达" value={`${stats.reached}/${stats.total}`} color={theme.text.primary} />
          <StatChip label="完成" value={stats.completed} color={v3theme.signal.approved} />
          <StatChip label="运行中" value={stats.running} color={v3theme.signal.running} />
          <StatChip label="失败" value={stats.failed} color={v3theme.signal.rejected} />
          {stats.decisions > 0 && (
            <StatChip label="待决策资产" value={stats.decisions} color={v3theme.signal.running} warn />
          )}
          {currentPhase && (
            <span style={{ color: theme.text.secondary, fontSize: 11.5, marginLeft: 'auto' }}>
              当前阶段：
              <span style={{ color: v3theme.phaseGroup[currentPhase.def.group], fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)', marginLeft: 4 }}>
                {currentPhase.def.code}
              </span>
              <span style={{ marginLeft: 4 }}>{currentPhase.def.name}</span>
              <span style={{ color: EXEC_STATE_META[currentPhase.execState].color, marginLeft: 6 }}>
                · {execStateLabel(currentPhase.execState)}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 流水线主体（横向滚动） */}
      <div
        style={{
          flex: '1 1 auto',
          overflow: 'auto',
          padding: '18px 18px 24px',
        }}
        onMouseLeave={() => setHoverSortKey(null)}
      >
        {nodes.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 'min-content' }}>
            {PHASE_GROUP_ORDER.map((group, gi) => {
              const phases = grouped.get(group) ?? []
              return (
                <div key={group} style={{ display: 'flex', alignItems: 'stretch' }}>
                  {gi > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <DependencyArrow variant="group" title={`${PHASE_GROUP_LABELS[PHASE_GROUP_ORDER[gi - 1]]} → ${PHASE_GROUP_LABELS[group]}`} />
                    </div>
                  )}
                  <PhaseGroupBlock
                    group={group}
                    title={PHASE_GROUP_LABELS[group]}
                    phases={phases}
                    expandedSortKeys={expandedSortKeys}
                    onTogglePhase={handleTogglePhase}
                    onAssetClick={handleLocate}
                    onPhaseHover={setHoverSortKey}
                    dependencyChains={dependencyChains}
                    hoverSortKey={hoverSortKey}
                    collapsed={collapsedGroups.has(group)}
                    onToggleCollapse={() => handleToggleGroup(group)}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* 图例 */}
        <Legend />
      </div>
    </div>
  )
}

// ─── 子部件 ──────────────────────────────────────────────────

function HeaderButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: theme.bg.card,
        color: disabled ? theme.text.disabled : theme.text.secondary,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 6,
        padding: '5px 10px',
        fontSize: 11.5,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)',
        transition: 'color 120ms ease, border-color 120ms ease',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text.primary; e.currentTarget.style.borderColor = theme.border.strong } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text.secondary; e.currentTarget.style.borderColor = theme.border.default } }}
    >
      {children}
    </button>
  )
}

function StatChip({
  label,
  value,
  color,
  warn,
}: {
  label: string
  value: number | string
  color: string
  warn?: boolean
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        background: warn ? 'rgba(224,182,101,0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${warn ? 'rgba(224,182,101,0.22)' : theme.border.subtle}`,
      }}
    >
      <span style={{ fontSize: 10.5, color: theme.text.tertiary }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--cv-font-mono, monospace)' }}>{value}</span>
    </div>
  )
}

const LEGEND_ITEMS: ReadonlyArray<{ state: PhaseExecState; desc: string }> = [
  { state: 'completed', desc: '完成' },
  { state: 'running', desc: '运行中' },
  { state: 'awaiting_review', desc: '待审核' },
  { state: 'failed', desc: '失败' },
  { state: 'pending', desc: '待执行' },
]

function Legend(): React.ReactElement {
  return (
    <div
      style={{
        marginTop: 18,
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        flexWrap: 'wrap',
        background: theme.bg.card,
        border: `1px solid ${theme.border.subtle}`,
        borderRadius: 8,
        maxWidth: 'min-content',
      }}
    >
      <span style={{ fontSize: 10.5, color: theme.text.tertiary, letterSpacing: '0.04em' }}>状态图例</span>
      {LEGEND_ITEMS.map((it) => {
        const meta = EXEC_STATE_META[it.state]
        return (
          <span key={it.state} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.text.secondary }}>
            <span style={{ color: meta.color, fontSize: 13, fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)' }}>{meta.glyph}</span>
            {it.desc}
          </span>
        )
      })}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.text.secondary }}>
        <span style={{ color: '#56B89A', fontSize: 13, fontWeight: 700 }}>★</span>选定
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.text.secondary }}>
        <span style={{ color: '#E0B665', fontSize: 13, fontWeight: 700 }}>○</span>待选
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.text.secondary }}>
        <span style={{ color: '#DD6A82', fontSize: 13, fontWeight: 700 }}>✕</span>淘汰
      </span>
    </div>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        margin: '48px auto',
        maxWidth: 420,
        padding: '36px 48px',
        textAlign: 'center',
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 12,
        boxShadow: 'var(--cv-shadow-pop, 0 12px 32px rgba(0,0,0,0.6))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', color: theme.text.tertiary, marginBottom: 14 }}>
        <UiIcon kind="pipeline" size={40} />
      </div>
      <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        暂无管线数据
      </div>
      <div style={{ color: theme.text.secondary, fontSize: 13, lineHeight: 1.6 }}>
        请先选择项目与剧集加载画布数据，<br />
        或运行创作管线后自动同步资产与阶段状态。
      </div>
    </div>
  )
}
