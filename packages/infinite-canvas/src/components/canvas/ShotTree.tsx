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
import { useMemo, useState } from 'react'
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

/** shotId → 场景前缀（分隔符 [.\-_/] 前段）；无分隔符返回 null（平铺）。 */
function scenePrefix(shotId: string): string | null {
  const m = shotId.match(/^([^.\-_/]+)[.\-_/]/)
  return m ? m[1] : null
}

/** 景别展示：enum key → 中文，否则原样。 */
function framingLabel(raw?: string): string {
  if (!raw) return ''
  return (METADATA_LABELS.framing as Record<string, string>)[raw] ?? raw
}

/** 从 graph 派生导航层级。 */
function deriveTree(graph: FlowGraphV3 | null) {
  if (!graph) return null
  const shots: ShotItem[] = []
  const globals: GlobalItem[] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'asset') continue
    const a = n as AssetNodeV3
    const m = a.meta // 按 meta.stage 判别窄化（AssetStageMeta 联合由 meta.stage 区分）
    if (m.stage === 'storyboard') {
      shots.push({
        id: a.id,
        shotId: m.shotId ?? a.id,
        label: framingLabel(m.framing) || m.shotType || '',
      })
    } else if (m.stage === 'global' && a.scope === 'global') {
      globals.push({ id: a.id, label: a.phaseName || a.id, sub: m.assetType ?? 'asset' })
    }
  }
  // 自然序：按 shotId 排（含数字时按数值升序）
  const natCmp = (x: string, y: string) =>
    x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
  shots.sort((a, b) => natCmp(a.shotId, b.shotId))
  globals.sort((a, b) => natCmp(a.label, b.label))

  // 场景分组：前缀 ≥2 种才分组，否则平铺（单场景 header 无意义）
  const prefixOf = (s: ShotItem) => scenePrefix(s.shotId)
  const distinct = new Set(shots.map(prefixOf).filter((p): p is string => !!p))
  let scenes: SceneGroup[] = []
  if (distinct.size >= 2) {
    const map = new Map<string, ShotItem[]>()
    for (const s of shots) {
      const p = prefixOf(s) ?? '其它'
      if (!map.has(p)) map.set(p, [])
      map.get(p)!.push(s)
    }
    scenes = [...map.entries()]
      .map(([scene, ss]) => ({ scene, shots: ss }))
      .sort((a, b) => natCmp(a.scene, b.scene))
  }
  return { episodesId: graph.meta.episodesId, scenes, flatShots: scenes.length ? [] : shots, globals }
}

export default function ShotTree(): React.ReactElement | null {
  const graph = useCanvasStore((s) => s.graph)
  const nodes = useCanvasStore((s) => s.nodes)
  const selectedNode = useCanvasStore((s) => s.selectedNode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const reactFlow = useReactFlow()
  const [open, setOpen] = useState(true)

  const tree = useMemo(() => deriveTree(graph), [graph])

  // 点击 → 居中 + 选中
  const jumpTo = (nodeId: string) => {
    const rfNode = reactFlow.getNode(nodeId) ?? nodes.find((n) => n.id === nodeId)
    if (rfNode) {
      const cx = (rfNode.position?.x ?? 0) + (rfNode.width ?? 0) / 2
      const cy = (rfNode.position?.y ?? 0) + (rfNode.height ?? 0) / 2
      reactFlow.setCenter(cx, cy, { zoom: 1.0, duration: 600 })
    }
    const full = nodes.find((n) => n.id === nodeId)
    setSelectedNode((full ?? ({ id: nodeId } as unknown as Node)))
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {tree.scenes.length === 0 && tree.flatShots.length === 0 && (
          <Empty>本集无分镜节点</Empty>
        )}

        {/* 场景分组 */}
        {tree.scenes.map((sg) => (
          <div key={sg.scene} style={{ marginBottom: 4 }}>
            <SectionLabel>场景 {sg.scene} · {sg.shots.length}</SectionLabel>
            {sg.shots.map((s) => (
              <TreeItem key={s.id} active={s.id === selectedId} onClick={() => jumpTo(s.id)}>
                <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary, fontSize: 10.5 }}>{s.shotId}</span>
                {s.label && <span style={{ color: theme.text.tertiary, fontSize: 10 }}> · {s.label}</span>}
              </TreeItem>
            ))}
          </div>
        ))}

        {/* 平铺镜头（无场景结构） */}
        {tree.flatShots.map((s) => (
          <TreeItem key={s.id} active={s.id === selectedId} onClick={() => jumpTo(s.id)}>
            <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary, fontSize: 10.5 }}>{s.shotId}</span>
            {s.label && <span style={{ color: theme.text.tertiary, fontSize: 10 }}> · {s.label}</span>}
          </TreeItem>
        ))}

        {/* 全局资产 */}
        {tree.globals.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel>全局资产 · {tree.globals.length}</SectionLabel>
            {tree.globals.map((g) => (
              <TreeItem key={g.id} active={g.id === selectedId} onClick={() => jumpTo(g.id)}>
                <span style={{ color: theme.text.secondary, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                <span style={{ color: theme.text.tertiary, fontSize: 9.5, marginLeft: 4 }}>· {g.sub}</span>
              </TreeItem>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ fontSize: 9, color: theme.text.tertiary, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, padding: '6px 8px 3px' }}>
      {children}
    </div>
  )
}

function TreeItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      onClick={onClick}
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
