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
import CanvasEdgeComponent from './edges/CanvasEdge'
import CanvasContextMenu from './CanvasContextMenu'
import ProjectSelector from './ProjectSelector'

import type { NodeState } from '../types/canvas'
import { flowGraphToCanvas, canvasToFlowGraph } from '../utils/flowDataMapper'
import { loadCanvasGraph, saveCanvasGraph, convertProjectData } from '../services/canvasApi'
import { useCanvasSocket } from '../hooks/useCanvasSocket'

const nodeTypes = {
  script: ScriptNodeComponent,
  asset: AssetNodeComponent,
  storyboard: StoryboardNodeComponent,
  video: VideoNodeComponent,
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
  const reactFlow = useReactFlow()

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
        position: { x: 400 + Math.random() * 600, y: 50 + Math.random() * 400 },
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
      // 先尝试加载已保存的画布图
      const savedGraph = await loadCanvasGraph(pid, eid)
      if (savedGraph?.nodes?.length) {
        const { nodes: loadedNodes, edges: loadedEdges } = flowGraphToCanvas(savedGraph)
        setNodes(loadedNodes)
        setEdges(loadedEdges)
      } else {
        // 从数据库转换项目数据
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

      // 更新 URL（不刷新页面）
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

  const onPaneClick = useCallback(() => setMenuPos(null), [])

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
    const colors: Record<string, string> = {
      script: '#89b4fa', asset: '#a6e3a1', storyboard: '#f9e2af', video: '#cba6f7',
    }
    return colors[node.type || ''] ?? '#585b70'
  }, [])

  // 全屏加载
  if (loading && !hasData) {
    return (
      <div style={overlayStyle}>
        <div style={loadingBoxStyle}>
          <div style={spinnerStyle} />
          <div style={{ color: '#cdd6f4', marginTop: 16, fontSize: 14 }}>加载画布数据...</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* 顶部导航栏 */}
      <div style={topBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={backLinkStyle}>← 返回 Toonflow</a>
          <div style={{ width: 1, height: 20, background: '#313244' }} />
          <span style={{ color: '#89b4fa', fontWeight: 600, fontSize: 14 }}>无限画布</span>
        </div>

        <ProjectSelector
          initialProjectId={initialParams.projectId}
          initialEpisodesId={initialParams.episodesId}
          onSelect={loadCanvas}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: connected ? '#a6e3a1' : '#f38ba8', fontSize: 11 }}>
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
            style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', marginLeft: 8 }}
          >
            x
          </button>
        </div>
      )}

      {/* 画布区域 */}
      <div style={{ width: '100%', height: 'calc(100vh - 48px)' }}>
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
          fitView={hasData}
          fitViewOptions={{ padding: 0.2 }}
          selectionOnDrag
          panOnDrag={[1]}
          selectionKeyCode="Shift"
          style={{ background: '#11111b' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#313244" gap={20} size={1} />
          <Controls
            position="bottom-right"
            style={{ background: '#1e1e2e', borderRadius: 8, border: '1px solid #313244' }}
          />
          <MiniMap
            nodeColor={miniMapNodeColor}
            maskColor="rgba(17,17,27,0.8)"
            style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: 8 }}
          />

          <Panel position="top-left" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <ToolbarButton onClick={handleSave} disabled={saving || !projectId}>
              {saving ? '保存中...' : '💾 保存'}
            </ToolbarButton>
            <ToolbarButton onClick={() => reactFlow.fitView({ padding: 0.2 })}>
              🔍 适配视图
            </ToolbarButton>
          </Panel>

          {/* 空状态引导 */}
          {!hasData && !loading && (
            <Panel position="top-center" style={{ marginTop: 60 }}>
              <div style={{
                background: '#1e1e2e',
                border: '1px solid #313244',
                borderRadius: 12,
                padding: '32px 48px',
                textAlign: 'center',
                maxWidth: 400,
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎨</div>
                <div style={{ color: '#cdd6f4', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                  欢迎使用无限画布
                </div>
                <div style={{ color: '#a6adc8', fontSize: 13, lineHeight: 1.6 }}>
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
            />
          )}
        </ReactFlow>
      </div>
    </>
  )
}

function ToolbarButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#1e1e2e',
        color: disabled ? '#585b70' : '#cdd6f4',
        border: '1px solid #313244',
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
  background: '#181825',
  borderBottom: '1px solid #313244',
  gap: 12,
  overflow: 'hidden',
}

const backLinkStyle: React.CSSProperties = {
  color: '#a6adc8',
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
  background: '#302030',
  borderBottom: '1px solid #f38ba844',
  color: '#f38ba8',
  fontSize: 12,
}

const overlayStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100vw',
  height: '100vh',
  background: '#11111b',
}

const loadingBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: '3px solid #313244',
  borderTopColor: '#89b4fa',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
}

export default function FlowCanvas() {
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
