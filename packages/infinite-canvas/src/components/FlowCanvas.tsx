import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type OnConnect,
  type Connection,
  Panel,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import ScriptNodeComponent from './nodes/ScriptNode'
import AssetNodeComponent from './nodes/AssetNode'
import StoryboardNodeComponent from './nodes/StoryboardNode'
import VideoNodeComponent from './nodes/VideoNode'
import AudioNodeComponent from './nodes/AudioNode'
import CanvasEdgeComponent from './edges/CanvasEdge'
import CanvasContextMenu from './CanvasContextMenu'
import ProjectSelector from './ProjectSelector'
import NodeDetailPanel from './NodeDetailPanel'
import LoadingOverlay from './LoadingOverlay'

import type { NodeState, ReviewStatus } from '../types/canvas'
import { CanvasActionsContext } from './CanvasActionsContext'
import { flowGraphToCanvas, canvasToFlowGraph } from '../utils/flowDataMapper'
import { loadCanvasGraph, saveCanvasGraph, convertProjectData } from '../services/canvasApi'
import { useCanvasSocket } from '../hooks/useCanvasSocket'
import { useToast, ToastContainer } from '../hooks/useToast'
import { theme, miniMapNodeColors } from '../theme/catppuccin'
import { LAYOUT, VIEWPORT } from '../constants'

const nodeTypes = {
  script: ScriptNodeComponent,
  asset: AssetNodeComponent,
  storyboard: StoryboardNodeComponent,
  video: VideoNodeComponent,
  audio: AudioNodeComponent,
}

const edgeTypes = {
  canvas: CanvasEdgeComponent,
}

function getInitialParams(): { projectId: number | null; episodesId: number | null } {
  if (typeof window === 'undefined') return { projectId: null, episodesId: null }
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('projectId')
  const episodesId = params.get('episodesId')
  return {
    projectId: projectId ? Number(projectId) : null,
    episodesId: episodesId ? Number(episodesId) : null,
  }
}

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [episodesId, setEpisodesId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [hasData, setHasData] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const reactFlow = useReactFlow()
  const { toasts, showToast, dismiss: dismissToast } = useToast()

  const initialParams = getInitialParams()

  const { connected } = useCanvasSocket({
    projectId: projectId ?? 0,
    onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, state, ...(progress != null && { progress }) } }
            : n,
        ),
      )
    },
    onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, thumbnailUrl } }
            : n,
        ),
      )
    },
    onNewAsset: (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) => [...nds, {
        id: nodeId,
        type: 'asset',
        position: { x: LAYOUT.NEW_NODE_X_MIN + Math.random() * LAYOUT.NEW_NODE_X_RANGE, y: LAYOUT.NEW_NODE_Y_MIN + Math.random() * LAYOUT.NEW_NODE_Y_RANGE },
        data,
      }])
    },
  })

  const loadCanvas = useCallback(async (pid: number, eid: number) => {
    setLoading(true)
    setLoadError(null)
    setProjectId(pid)
    setEpisodesId(eid)

    try {
      const savedGraph = await loadCanvasGraph(pid, eid)
      if (savedGraph?.nodes?.length) {
        const { nodes: loadedNodes, edges: loadedEdges } = flowGraphToCanvas(savedGraph)
        setNodes(loadedNodes)
        setEdges(loadedEdges)
      } else {
        const graph = await convertProjectData(pid, eid)
        if (graph?.nodes?.length) {
          const { nodes: convertedNodes, edges: convertedEdges } = flowGraphToCanvas(graph)
          setNodes(convertedNodes)
          setEdges(convertedEdges)
        } else {
          setNodes([])
          setEdges([])
          setLoadError('该项目暂无数据，请先在 Toonflow 中创建剧本和资产')
        }
      }
      setHasData(true)

      const url = new URL(window.location.href)
      url.searchParams.set('projectId', String(pid))
      url.searchParams.set('episodesId', String(eid))
      window.history.replaceState({}, '', url.toString())
    } catch (err: any) {
      console.error('加载画布数据失败:', err)
      setLoadError(err.message || '加载画布数据失败')
      setHasData(false)
    } finally {
      setLoading(false)
    }
  }, [setNodes, setEdges])

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...params, type: 'canvas', data: { dataType: 'data' } },
          eds,
        ),
      )
    },
    [setEdges],
  )

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    const container = (event.currentTarget as HTMLElement).closest('.react-flow')
    const rect = container?.getBoundingClientRect()
    setMenuPos({
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
      nodeId: node.id,
    })
  }, [])

  const onPaneClick = useCallback(() => {
    setMenuPos(null)
    setSelectedNode(null)
  }, [])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const handleSave = useCallback(async () => {
    if (!projectId || !episodesId) return
    setSaving(true)
    try {
      const viewport = reactFlow.getViewport()
      const graph = canvasToFlowGraph(nodes as any, edges as any, viewport)
      await saveCanvasGraph(projectId, episodesId, graph)
    } catch (err) {
      console.error('保存失败:', err)
    } finally {
      setSaving(false)
    }
  }, [nodes, edges, projectId, episodesId, reactFlow])

  const miniMapNodeColor = useCallback((node: Node) => {
    return miniMapNodeColors[node.type || ''] ?? theme.border.dim
  }, [])

  // ─── 审核操作（乐观更新 + Toast） ─────────────────────────
  const approveNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
    ))
    showToast(`审核通过: ${nodeId}`, 'success')
  }, [setNodes, showToast])

  const rejectNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
    ))
    showToast(`已驳回: ${nodeId}`, 'warning')
  }, [setNodes, showToast])

  // ─── 变体优胜选择 ─────────────────────────────────────────
  const selectWinner = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    const variantGroupId = node?.data.variantGroupId as string | undefined
    if (!variantGroupId) {
      showToast('该节点不属于变体组', 'warning')
      return
    }
    setNodes((nds) => nds.map((n) => {
      const vg = n.data.variantGroupId as string | undefined
      if (vg !== variantGroupId) return n
      if (n.id === nodeId) {
        return { ...n, data: { ...n.data, isWinner: true, reviewStatus: 'approved' } }
      }
      return { ...n, data: { ...n.data, isWinner: false } }
    }))
    setEdges((eds) => eds.map((e) => {
      const targetNode = nodes.find((n) => n.id === e.target)
      if (targetNode && targetNode.data.variantGroupId === variantGroupId && e.target !== nodeId) {
        return { ...e, data: { ...e.data, isInactive: true } }
      }
      return e
    }))
    showToast(`已选为优胜: ${nodeId}`, 'success')
  }, [setNodes, setEdges, nodes, showToast])

  const canvasActions = {
    approveNode,
    rejectNode,
    selectWinner,
    showToast,
    projectId: projectId ?? 0,
    episodesId: episodesId ?? 0,
  }

  // 全屏加载 — 骨架屏
  if (loading && !hasData) {
    return (
      <CanvasActionsContext.Provider value={canvasActions}>
        <LoadingOverlay />
      </CanvasActionsContext.Provider>
    )
  }

  return (
    <CanvasActionsContext.Provider value={canvasActions}>
    <>
      {/* 顶部导航栏 */}
      <div style={topBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={backLinkStyle}>← 返回 Toonflow</a>
          <div style={{ width: 1, height: 20, background: theme.border.default }} />
          <span style={{ color: theme.node.script, fontWeight: 600, fontSize: 14 }}>无限画布</span>
        </div>

        <ProjectSelector
          initialProjectId={initialParams.projectId}
          initialEpisodesId={initialParams.episodesId}
          onSelect={loadCanvas}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: connected ? theme.status.connected : theme.status.disconnected, fontSize: 11 }}>
            {connected ? '● 已连接' : '○ 未连接'}
          </span>
        </div>
      </div>

      {/* 错误提示 */}
      {loadError && (
        <div style={errorBarStyle}>
          <span>{loadError}</span>
          <button
            onClick={() => setLoadError(null)}
            style={{ background: 'none', border: 'none', color: theme.status.rejected, cursor: 'pointer', marginLeft: 8 }}
          >
            x
          </button>
        </div>
      )}

      {/* 画布区域 */}
      <div style={{ width: '100%', height: 'calc(100vh - 48px)', position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'canvas' }}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          fitView={hasData}
          fitViewOptions={{ padding: VIEWPORT.fitViewPadding }}
          selectionOnDrag
          panOnDrag={[1]}
          selectionKeyCode="Shift"
          style={{ background: theme.bg.canvas }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={theme.border.default} gap={20} size={1} />
          <Controls
            position="bottom-right"
            style={{ background: theme.bg.card, borderRadius: 8, border: `1px solid ${theme.border.default}` }}
          />
          <MiniMap
            nodeColor={miniMapNodeColor}
            maskColor={theme.chrome.miniMapMask}
            style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 8 }}
          />

          <Panel position="top-left" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <ToolbarButton onClick={handleSave} disabled={saving || !projectId}>
              {saving ? '保存中...' : '💾 保存'}
            </ToolbarButton>
            <ToolbarButton onClick={() => reactFlow.fitView({ padding: VIEWPORT.fitViewPadding })}>
              🔍 适配视图
            </ToolbarButton>
          </Panel>

          {/* 空状态引导 */}
          {!hasData && !loading && (
            <Panel position="top-center" style={{ marginTop: 60 }}>
              <div style={{
                background: theme.bg.card,
                border: `1px solid ${theme.border.default}`,
                borderRadius: 12,
                padding: '32px 48px',
                textAlign: 'center',
                maxWidth: 400,
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎨</div>
                <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                  欢迎使用无限画布
                </div>
                <div style={{ color: theme.text.secondary, fontSize: 13, lineHeight: 1.6 }}>
                  请从上方选择项目和剧本来加载数据，<br/>
                  或从 Toonflow 项目页面点击「无限画布」进入。
                </div>
              </div>
            </Panel>
          )}

          {menuPos && projectId && episodesId && (
            <CanvasContextMenu
              x={menuPos.x}
              y={menuPos.y}
              nodeId={menuPos.nodeId}
              onClose={() => setMenuPos(null)}
              projectId={projectId}
              episodesId={episodesId}
              setNodes={setNodes}
              setEdges={setEdges}
              showToast={showToast}
              onSelectWinner={selectWinner}
            />
          )}
        </ReactFlow>

        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
    </CanvasActionsContext.Provider>
  )
}

function ToolbarButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: theme.bg.card,
        color: disabled ? theme.text.disabled : theme.text.primary,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

// ─── 样式常量 ──────────────────────────────────────────────

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 48,
  padding: '0 16px',
  background: theme.chrome.topBar,
  borderBottom: `1px solid ${theme.border.default}`,
  gap: 12,
  overflow: 'hidden',
}

const backLinkStyle: React.CSSProperties = {
  color: theme.text.secondary,
  textDecoration: 'none',
  fontSize: 13,
  whiteSpace: 'nowrap',
  padding: '4px 8px',
  borderRadius: 4,
  transition: 'color 0.2s',
}

const errorBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 16px',
  background: theme.chrome.errorBar,
  borderBottom: `1px solid ${theme.chrome.errorBorder}`,
  color: theme.status.rejected,
  fontSize: 12,
}

export default function FlowCanvas() {
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes toast-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        .react-flow__node:hover > div > div:first-of-type > button { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
