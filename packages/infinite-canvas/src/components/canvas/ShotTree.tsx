/**
 * src/components/canvas/ShotTree.tsx — 左侧「集 → 场景 → 镜头」导航树。
 *
 * 参考设计 canvas.html v1 左栏。从 graph 派生层级：
 *  - 集（episode）：当前画布即一集（P10），根标签取 episodesId。
 *  - 镜头：storyboard 节点（每节点 = 一镜），按 shotId 前缀（分隔符前段）派生「场景」
 *    分组；若全体同前缀（无场景结构，如 shot-001…shot-093）则平铺不强行造场景。
 *  - 全局资产：scope='global' 节点（角色/场景/LoRA/BGM 主题）独立一栏。
 *
 * 点击镜头/资产 → reactFlow.setCenter 居中到该节点中心 + setSelectedNode 触发溯源高亮
 * （P18）与右侧详情面板。93 镜项目靠这棵树跳转，不靠 minimap 翻找。
 *
 * 浮层式左侧栏（镜像 NodeDetailPanel 的 overlay 风格，不重构 flex）：top 起在工具栏下方，
 * 避开 top-left 工具栏 Panel；可折叠为左缘窄轨。
 */
import { sceneNumOf, sceneColorOf } from '../../utils/sceneGrouping'
import { useCallback, useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../../store/canvasStore'
import { theme } from '../../theme/catppuccin'
import { METADATA_LABELS } from '../../constants'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import type { Node } from '@xyflow/react'

interface ShotItem {
  id: string
  shotId: string
  label: string
}
interface SceneGroup {
  scene: string
  shots: ShotItem[]
}
interface GlobalItem {
  id: string
  label: string
  sub: string
}

// 55-05(binding 4 收口):本地场景前缀函数已删,场景口径统一 sceneNumOf(55-02 共享 util)。

/** 景别展示：enum key → 中文，否则原样。 */
function framingLabel(raw?: string): string {
  if (!raw) return ''
  return (METADATA_LABELS.framing as Record<string, string>)[raw] ?? raw
}

/** 取「干净」字符串：非空且非 'unknown'（V3 迁移对缺失字段常填字面 'unknown'，需滤掉）。 */
function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s && s.toLowerCase() !== 'unknown' ? s : undefined
}

/** 从 graph 派生导航层级。shotId/景别优先取 rawDataByNodeId（V3 meta 的 shotId/shotType
 *  常被迁移污染为 asset id 片段 / 字面 'unknown'），保证镜头行显示干净的 S1_01 / medium。 */
function deriveTree(
  graph: FlowGraphV3 | null,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
) {
  if (!graph) return null
  const shots: ShotItem[] = []
  const globals: GlobalItem[] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'asset') continue
    const a = n as AssetNodeV3
    const m = a.meta // 按 meta.stage 判别窄化（AssetStageMeta 联合由 meta.stage 区分）
    const raw = rawDataByNodeId?.get(a.id) ?? {}
    if (m.stage === 'storyboard') {
      const shotId =
        clean(raw.shot_id) ?? clean(m.shotId) ?? a.id
      const framing = clean(raw.shot_type) ?? clean(raw.shot_scale) ?? clean(m.shotType) ?? clean(m.framing)
      shots.push({ id: a.id, shotId, label: framing ? framingLabel(framing) : '' })
    } else if (m.stage === 'global' && a.scope === 'global') {
      const name =
        clean(raw.characterCanonical) ?? clean(raw.characterId) ?? clean(raw.name) ?? clean(raw.label)
      const sub = clean(m.assetType) ?? clean(raw.assetType) ?? clean(raw.archetype) ?? 'asset'
      globals.push({ id: a.id, label: name ?? a.phaseName ?? a.id, sub })
    }
  }
  // 自然序：按 shotId 排（含数字时按数值升序）
  const natCmp = (x: string, y: string) =>
    x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
  shots.sort((a, b) => natCmp(a.shotId, b.shotId))
  globals.sort((a, b) => natCmp(a.label, b.label))

  // 55-05 场景分组:sceneNumOf 数字段口径(全仓统一,binding 4)。
  // 场景号 0(无数字段)归平铺;≥2 个不同场景号才分组(单场景 header 无意义)。
  const sceneNumOfShot = (s: ShotItem) => {
    const n = sceneNumOf(s.shotId)
    return n > 0 ? n : 0
  }
  const distinct = new Set(shots.map(sceneNumOfShot).filter((n) => n > 0))
  let scenes: SceneGroup[] = []
  if (distinct.size >= 2) {
    const map = new Map<number, ShotItem[]>()
    for (const s of shots) {
      const n = sceneNumOfShot(s)
      if (n === 0) continue // 无场景号 → flatShots 路径(下行为 shots 全量;保持既有单集语义由分组承担)
      if (!map.has(n)) map.set(n, [])
      map.get(n)!.push(s)
    }
    scenes = [...map.entries()]
      .map(([n, ss]) => ({ scene: String(n), shots: ss }))
      .sort((a, b) => Number(a.scene) - Number(b.scene))
  }
  return { episodesId: graph.meta.episodesId, scenes, flatShots: scenes.length ? [] : shots, globals }
}

export default function ShotTree(): React.ReactElement | null {
  const graph = useCanvasStore((s) => s.graph)
  const nodes = useCanvasStore((s) => s.nodes)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const selectedNode = useCanvasStore((s) => s.selectedNode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)
  const reactFlow = useReactFlow()
  const [open, setOpen] = useState(true)
  // 分类折叠态：key = `scene:<前缀>` / `shots` / `globals`。默认全展开。
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const tree = useMemo(() => deriveTree(graph, rawDataByNodeId), [graph, rawDataByNodeId])

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 单击 → 居中 + 选中（驱动溯源高亮，不开右面板），且若右面板已开则自动缩回
  /** 55-05 (Q3 并列入口):场景行聚焦——fitView 该场景全部 shot 节点(jumpTo 同款时序)。 */
  const focusScene = (sg: { scene: string; shots: Array<{ id: string }> }) => {
    const ids = sg.shots.map((s) => s.id)
    if (ids.length === 0) return
    reactFlow.fitView({ nodes: ids.map((id) => ({ id })), duration: 600, maxZoom: 1.0 })
  }

  const jumpTo = (nodeId: string) => {
    const rfNode = reactFlow.getNode(nodeId) ?? nodes.find((n) => n.id === nodeId)
    if (rfNode) {
      const cx = (rfNode.position?.x ?? 0) + (rfNode.width ?? 0) / 2
      const cy = (rfNode.position?.y ?? 0) + (rfNode.height ?? 0) / 2
      reactFlow.setCenter(cx, cy, { zoom: 1.0, duration: 600 })
    }
    const full = nodes.find((n) => n.id === nodeId)
    setSelectedNode((full ?? ({ id: nodeId } as unknown as Node)))
    setDetailNode(null)
  }

  // 双击 → 在单击已选中+居中的基础上，钉选到右详情面板（setDetailNode）
  const openDetail = (nodeId: string) => {
    const full = nodes.find((n) => n.id === nodeId)
    setDetailNode((full ?? ({ id: nodeId } as unknown as Node)))
  }

  if (!tree) return null
  const selectedId = selectedNode?.id

  const cardStyle: React.CSSProperties = {
    position: 'absolute',
    left: 8,
    top: 56, // 让出 top-left 工具栏 Panel
    bottom: 8,
    width: 216,
    background: 'rgba(17,19,23,0.92)',
    border: `1px solid ${theme.border.default}`,
    borderRadius: 8,
    backdropFilter: 'blur(4px)',
    boxShadow: theme.shadow.pop,
    display: 'flex',
    flexDirection: 'column',
    color: theme.text.primary,
    zIndex: 20,
    overflow: 'hidden',
  }

  // 折叠态：左缘窄轨
  if (!open) {
    return (
      <div style={{ ...cardStyle, width: 28, alignItems: 'center', padding: '6px 0' }}>
        <button
          data-testid="shottree-expand"
          onClick={() => setOpen(true)}
          style={{ background: 'transparent', border: 'none', color: theme.text.tertiary, cursor: 'pointer', fontSize: 14, writingMode: 'vertical-rl', letterSpacing: 2 }}
          title="展开镜头导航"
        >
          镜头 ›
        </button>
      </div>
    )
  }

  const shotCount = tree.scenes.reduce((n, s) => n + s.shots.length, 0) + tree.flatShots.length

  return (
    <div data-testid="shot-tree" style={cardStyle}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px', borderBottom: `1px solid ${theme.border.default}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>EP{tree.episodesId}</span>
          <span style={{ fontSize: 9.5, color: theme.text.tertiary, letterSpacing: 0.5 }}>
            {shotCount > 0 ? `${shotCount} 镜 · ${tree.globals.length} 全局` : '无镜头'}
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'transparent', border: 'none', color: theme.text.tertiary, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 2 }}
          title="收起"
        >
          ‹
        </button>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px 4px' }}>
        {tree.scenes.length === 0 && tree.flatShots.length === 0 && tree.globals.length === 0 && (
          <Empty>本集无分镜节点</Empty>
        )}

        {/* 场景分组（可折叠） */}
        {tree.scenes.map((sg) => (
          <CollapsibleSection
            key={sg.scene}
            title={`场景 ${sg.scene}`}
            count={sg.shots.length}
            collapsed={collapsed.has(`scene:${sg.scene}`)}
            onToggle={() => toggle(`scene:${sg.scene}`)}
            headerExtra={
              <span
                title="聚焦本场景"
                role="button"
                tabIndex={0}
                aria-label={`聚焦本场景 ${sg.scene}`}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') focusScene(sg) }}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); focusScene(sg) }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', pointerEvents: 'auto' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sceneColorOf(Number(sg.scene)), flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: theme.text.tertiary }}>◎</span>
              </span>
            }
          >
            {sg.shots.map((s) => (
              <TreeItem key={s.id} active={s.id === selectedId}
                onClick={() => jumpTo(s.id)}
                onDoubleClick={() => openDetail(s.id)}>
                <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary, fontSize: 10.5 }}>{s.shotId}</span>
                {s.label && <span style={{ color: theme.text.tertiary, fontSize: 10 }}> · {s.label}</span>}
              </TreeItem>
            ))}
          </CollapsibleSection>
        ))}

        {/* 平铺镜头（无场景结构）→ 单一可折叠「镜头」分类 */}
        {tree.flatShots.length > 0 && (
          <CollapsibleSection
            title="镜头"
            count={tree.flatShots.length}
            collapsed={collapsed.has('shots')}
            onToggle={() => toggle('shots')}
          >
            {tree.flatShots.map((s) => (
              <TreeItem key={s.id} active={s.id === selectedId}
                onClick={() => jumpTo(s.id)}
                onDoubleClick={() => openDetail(s.id)}>
                <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary, fontSize: 10.5 }}>{s.shotId}</span>
                {s.label && <span style={{ color: theme.text.tertiary, fontSize: 10 }}> · {s.label}</span>}
              </TreeItem>
            ))}
          </CollapsibleSection>
        )}

        {/* 全局资产（可折叠） */}
        {tree.globals.length > 0 && (
          <CollapsibleSection
            title="全局资产"
            count={tree.globals.length}
            collapsed={collapsed.has('globals')}
            onToggle={() => toggle('globals')}
          >
            {tree.globals.map((g) => (
              <TreeItem key={g.id} active={g.id === selectedId}
                onClick={() => jumpTo(g.id)}
                onDoubleClick={() => openDetail(g.id)}>
                <span style={{ color: theme.text.secondary, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                <span style={{ color: theme.text.tertiary, fontSize: 9.5, marginLeft: 4 }}>· {g.sub}</span>
              </TreeItem>
            ))}
          </CollapsibleSection>
        )}

        {/* 操作提示 */}
        <div style={{ padding: '10px 10px 6px', fontSize: 9.5, color: theme.text.tertiary, lineHeight: 1.6, letterSpacing: 0.2 }}>
          单击选中溯源 · 双击查看详情
        </div>
      </div>
    </div>
  )
}

/** 可折叠分类头：caret 旋转指示态 + 标题 + 右侧计数。折叠时隐藏子项但保留计数。 */
function CollapsibleSection({ title, count, collapsed, onToggle, headerExtra, children }: {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  /** 55-05:节头右侧附加交互区(场景聚焦入口);不参与折叠 toggle。 */
  headerExtra?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: '6px 8px',
          border: 'none',
          background: 'transparent',
          color: theme.text.tertiary,
          cursor: 'pointer',
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          fontWeight: 600,
          textAlign: 'left',
          borderRadius: 4,
          transition: 'background 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), color 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = theme.text.secondary }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.text.tertiary }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            fontSize: 8,
            lineHeight: 1,
            color: theme.text.tertiary,
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
          }}
        >
          ▾
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 9.5, fontWeight: 500, opacity: 0.7 }}>{count}</span>
      {headerExtra}
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  )
}

function TreeItem({ active, onClick, onDoubleClick, children }: { active: boolean; onClick: () => void; onDoubleClick?: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={onDoubleClick ? '单击选中 · 双击查看详情' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        width: '100%',
        textAlign: 'left',
        padding: '4px 8px',
        borderRadius: 5,
        background: active ? 'rgba(237,238,241,0.10)' : 'transparent',
        color: active ? theme.text.primary : theme.text.secondary,
        border: 'none',
        borderLeft: active ? `2px solid ${theme.text.primary}` : '2px solid transparent',
        cursor: 'pointer',
        fontSize: 11,
        transition: 'background 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ padding: '20px 12px', color: theme.text.tertiary, fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>{children}</div>
}
