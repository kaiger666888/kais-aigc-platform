import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type OnConnect,
  type Connection,
  Panel,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import ScriptNodeComponent from './nodes/ScriptNode'
import AssetNodeComponent from './nodes/AssetNode'
import StoryboardNodeComponent from './nodes/StoryboardNode'
import VideoNodeComponent from './nodes/VideoNode'
import AudioNodeComponent from './nodes/AudioNode'
import FallbackNodeComponent from './nodes/FallbackNode'
import ZoneNodeComponent from './nodes/ZoneNode'
import CanvasEdgeComponent from './edges/CanvasEdge'
import CanvasContextMenu from './CanvasContextMenu'
import ProjectSelector from './ProjectSelector'
import NodeDetailPanel from './NodeDetailPanel'
import IterationPanel from './IterationPanel'
import LoadingOverlay from './LoadingOverlay'

import type { NodeState } from '../types/canvas'
import { useCanvasStore } from '../store/canvasStore'
import { ToastContainer } from '../hooks/useToast'
import { flowGraphToCanvas, canvasToFlowGraph } from '../utils/flowDataMapper'
import { getLayoutedElements } from '../utils/autoLayout'
import { loadCanvasGraph, saveCanvasGraph, convertProjectData, fetchSkillNodeTypes, orchestrateCanvas, fetchCanvasHealth } from '../services/canvasApi'
import { useCanvasSocket } from '../hooks/useCanvasSocket'
import { theme, miniMapNodeColors } from '../theme/catppuccin'
import { LAYOUT, VIEWPORT } from '../constants'

/**
 * Platform built-in node renderers (Phase 32 CANVAS-02).
 *
 * These five renderers — `script`, `asset`, `storyboard`, `video`, `audio` —
 * are PLATFORM PRIMITIVES keyed by `default_renderer`. They are NOT movie-v1
 * properties. A skill manifest references them via each `node_types[].default_renderer`
 * field; future skills can declare new node types that reuse these renderers
 * without a canvas bundle repack.
 *
 * `default` is the fallback for any `node.type` value that is not in the
 * built-in map (CANVAS-03 — unknown types render via FallbackNode instead of
 * crashing the canvas).
 */
const nodeTypes = {
  default: FallbackNodeComponent,
  script: ScriptNodeComponent,
  asset: AssetNodeComponent,
  reference: AssetNodeComponent,
  storyboard: StoryboardNodeComponent,
  video: VideoNodeComponent,
  audio: AudioNodeComponent,
  zone: ZoneNodeComponent,
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
  const reactFlow = useReactFlow()

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setEdges = useCanvasStore((s) => s.setEdges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)

  const loading = useCanvasStore((s) => s.loading)
  const setLoading = useCanvasStore((s) => s.setLoading)
  const loadError = useCanvasStore((s) => s.loadError)
  const setLoadError = useCanvasStore((s) => s.setLoadError)
  const hasData = useCanvasStore((s) => s.hasData)
  const setHasData = useCanvasStore((s) => s.setHasData)
  const saving = useCanvasStore((s) => s.saving)
  const setSaving = useCanvasStore((s) => s.setSaving)

  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const setProject = useCanvasStore((s) => s.setProject)

  // Phase 32 — active skill + declared node types (registry-driven metadata)
  const activeSkillId = useCanvasStore((s) => s.activeSkillId)
  const declaredNodeTypes = useCanvasStore((s) => s.declaredNodeTypes)
  const setDeclaredNodeTypes = useCanvasStore((s) => s.setDeclaredNodeTypes)

  const menuPos = useCanvasStore((s) => s.menuPos)
  const setMenuPos = useCanvasStore((s) => s.setMenuPos)
  const selectedNode = useCanvasStore((s) => s.selectedNode)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  // Phase 37 — 多选
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds)

  const showToast = useCanvasStore((s) => s.showToast)
  const toasts = useCanvasStore((s) => s.toasts)
  const dismissToast = useCanvasStore((s) => s.dismissToast)
  const selectWinner = useCanvasStore((s) => s.selectWinner)

  // Phase 36 — 编排状态
  const orchestration = useCanvasStore((s) => s.orchestration)
  const startOrchestration = useCanvasStore((s) => s.startOrchestration)
  const updateOrchestrationProgress = useCanvasStore((s) => s.updateOrchestrationProgress)
  const finishOrchestration = useCanvasStore((s) => s.finishOrchestration)

  // Iteration Engine
  const iteration = useCanvasStore((s) => s.iteration)
  const setIterationPanelOpen = useCanvasStore((s) => s.setIterationPanelOpen)
  const updateIterationProgress = useCanvasStore((s) => s.updateIterationProgress)

  const initialParams = getInitialParams()

  // Health-poll baseline ref — 必须在 useCanvasSocket 之前声明,
  // 以便 onGraphSaved 回调里能重置基线避免双触发 reload。
  const lastEventCountRef = useRef<number | null>(null)

  const { connected } = useCanvasSocket({
    projectId: projectId ?? 0,
    onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => {
      setNodes((nds) =>
        (nds as any[]).map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, state, ...(progress != null && { progress }) } }
            : n,
        ),
      )
    },
    onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => {
      setNodes((nds) =>
        (nds as any[]).map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, thumbnailUrl } }
            : n,
        ),
      )
    },
    onNewAsset: (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) => [...(nds as any[]), {
        id: nodeId,
        type: 'asset',
        position: { x: LAYOUT.NEW_NODE_X_MIN + Math.random() * LAYOUT.NEW_NODE_X_RANGE, y: LAYOUT.NEW_NODE_Y_MIN + Math.random() * LAYOUT.NEW_NODE_Y_RANGE },
        data,
      }])
    },
    onOrchestrateStart: (p) => {
      startOrchestration(p.runId, p.total, p.mode)
      showToast(p.mode === 'batch' ? `批量执行开始 (${p.total} 个节点)` : `一键成片开始 (${p.total} 个节点)`, 'info')
    },
    onOrchestrateProgress: (p) => {
      updateOrchestrationProgress({
        completed: p.completed,
        total: p.total,
        failed: p.failed,
        currentNodeId: p.currentNodeId,
        runId: p.runId,
        mode: p.mode,
      })
    },
    onOrchestrateDone: (p) => {
      finishOrchestration({
        completed: p.completed, total: p.total, failed: p.failed, failedNodes: p.failedNodes, mode: p.mode,
      })
      const label = p.mode === 'batch' ? '批量执行完成' : '一键成片完成'
      if (p.failed > 0) {
        showToast(`${label} (${p.completed}/${p.total} 成功,${p.failed} 失败): ${p.failedNodes.join(', ')}`, 'warning')
      } else {
        showToast(`${label} (${p.completed}/${p.total} 节点成功)`, 'success')
      }
    },
    onGraphSaved: (payload) => {
      // Pipeline 通过 /api/canvas/v2/save-v2 全量写入 — 仅当事件作用于当前
      // 显示的 project/episode 时重新加载,避免跨项目串扰。
      if (
        projectId &&
        episodesId != null &&
        payload.projectId === projectId &&
        payload.episodesId === episodesId
      ) {
        showToast('Pipeline 同步了新数据,正在刷新画布…', 'info')
        // 重置 health 轮询基线,避免 30 秒后再次触发重复 reload
        lastEventCountRef.current = null
        loadCanvas(projectId, episodesId)
      }
    },
  })

  const loadCanvas = useCallback(async (pid: number, eid: number) => {
    setLoading(true)
    setLoadError(null)
    setProject(pid, eid)

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
  }, [setNodes, setEdges, setLoading, setLoadError, setProject, setHasData])

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...params, type: 'canvas', data: { dataType: 'data' } },
          eds as any[],
        ) as any[]
      )
    },
    [setEdges],
  )

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: any) => {
    event.preventDefault()
    const container = (event.currentTarget as HTMLElement).closest('.react-flow')
    const rect = container?.getBoundingClientRect()
    setMenuPos({
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
      nodeId: node.id,
    })
  }, [setMenuPos])

  // Phase 37 — 空白画布右键 (用于多选后批量执行入口)
  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault()
    const container = document.querySelector('.react-flow')
    const rect = container?.getBoundingClientRect()
    const clientX = 'clientX' in event ? event.clientX : 0
    const clientY = 'clientY' in event ? event.clientY : 0
    setMenuPos({
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
      nodeId: undefined,
    })
  }, [setMenuPos])

  // Phase 37 — 跟踪多选状态
  const onSelectionChange = useCallback((params: { nodes: any[] }) => {
    setSelectedNodeIds(params.nodes.map((n) => n.id))
  }, [setSelectedNodeIds])

  const onPaneClick = useCallback(() => {
    setMenuPos(null)
    setSelectedNode(null)
  }, [setMenuPos, setSelectedNode])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: any) => {
    setSelectedNode(node)
  }, [setSelectedNode])

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
  }, [nodes, edges, projectId, episodesId, reactFlow, setSaving])

  // 自动整理布局 (dagre)
  const handleAutoLayout = useCallback(() => {
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(
      nodes as any[],
      edges as any[],
      'LR',
    )
    setNodes(layouted)
    setEdges(layoutedEdges)
    // 短延迟后 fitView，等待 React 重渲染拿到 measured 尺寸
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.15, duration: 600 })
    }, 50)
    showToast?.('已整理为紧凑布局', 'success')
  }, [nodes, edges, setNodes, setEdges, reactFlow, showToast])

  // Phase 36 — 一键成片编排触发
  const handleOrchestrate = useCallback(async () => {
    if (!projectId || !episodesId) return
    if (orchestration.status === 'running') return
    try {
      // 先保存当前画布,确保编排器读到最新数据
      const viewport = reactFlow.getViewport()
      const graph = canvasToFlowGraph(nodes as any, edges as any, viewport)
      await saveCanvasGraph(projectId, episodesId, graph)
      // 触发编排 (mode='full',不传 nodeIds)
      await orchestrateCanvas(projectId, episodesId)
      // 状态由 WebSocket orchestrate:start 推送后正式进入 running
    } catch (err: any) {
      showToast(err.message || '一键成片触发失败', 'error')
    }
  }, [projectId, episodesId, orchestration.status, nodes, edges, reactFlow, showToast])

  // Iteration Engine — 切换 panel 显隐 (诊断由 panel 内的「开始诊断」按钮触发)
  const handleIterate = useCallback(() => {
    if (iteration.status === 'idle') {
      setIterationPanelOpen(true)
    } else {
      updateIterationProgress({ panelOpen: !iteration.panelOpen })
    }
  }, [iteration.status, iteration.panelOpen, setIterationPanelOpen, updateIterationProgress])

  const miniMapNodeColor = useCallback((node: any) => {
    return miniMapNodeColors[node.type || ''] ?? theme.border.dim
  }, [])

  // Phase 32 CANVAS-01 — pull declared node types from the skill registry on
  // mount. The result is descriptive metadata (used by future UI affordances
  // like an "Add Node" menu); it does NOT drive renderer selection — the five
  // built-in renderers (script/asset/storyboard/video/audio) are platform
  // primitives keyed by `default_renderer`. Unknown types fall through to
  // FallbackNode via the `default` entry in the nodeTypes map (CANVAS-03).
  useEffect(() => {
    let cancelled = false
    fetchSkillNodeTypes(activeSkillId)
      .then((decls) => {
        if (!cancelled) setDeclaredNodeTypes(decls)
      })
    return () => {
      cancelled = true
    }
  }, [activeSkillId, setDeclaredNodeTypes])

  // Health-poll fallback: 如果 socket 事件丢失(graph:saved 未到达),
  // 通过轮询 /api/canvas/v2/health 的 eventCount 变化兜底触发 reload。
  // 仅在外部写入(pipeline)时生效;前端自己的 loadCanvas 不会改变
  // 当前 scope 的 eventCount 之外的位置。
  useEffect(() => {
    if (!projectId || episodesId == null) {
      lastEventCountRef.current = null
      return
    }
    const POLL_INTERVAL_MS = 30_000
    const timer = setInterval(async () => {
      const health = await fetchCanvasHealth()
      if (!health) return
      const scope = health.scopes.find(
        (s) => s.projectId === projectId && s.episodesId === episodesId,
      )
      if (!scope) return
      if (lastEventCountRef.current === null) {
        lastEventCountRef.current = scope.eventCount
        return
      }
      if (scope.eventCount > lastEventCountRef.current) {
        lastEventCountRef.current = scope.eventCount
        showToast('检测到 pipeline 远端更新,正在刷新画布…', 'info')
        loadCanvas(projectId, episodesId)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [projectId, episodesId, loadCanvas])

  // 全屏加载 — 骨架屏
  if (loading && !hasData) {
    return <LoadingOverlay />
  }

  return (
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
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          fitView={hasData}
          fitViewOptions={{ padding: 0.15, minZoom: 0.2, maxZoom: 1.5, duration: 600 }}
          minZoom={0.05}
          maxZoom={4}
          selectionOnDrag
          panOnDrag={[1]}
          selectionKeyCode="Shift"
          style={{ background: theme.bg.canvas }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={theme.border.default} gap={20} size={1} />
          <Controls
            position="bottom-left"
            showInteractive={false}
            fitViewOptions={{ padding: 0.15, duration: 600 }}
            style={{ background: theme.bg.card, borderRadius: 8, border: `1px solid ${theme.border.default}` }}
          />
          <MiniMap
            nodeColor={miniMapNodeColor}
            nodeStrokeColor={theme.border.default}
            nodeStrokeWidth={3}
            nodeBorderRadius={4}
            maskColor="rgba(0, 0, 0, 0.4)"
            pannable
            zoomable
            ariaLabel="画布概览"
            style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 8 }}
          />

          <Panel position="top-left" style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <ToolbarButton onClick={handleSave} disabled={saving || !projectId}>
              {saving ? '保存中...' : '💾 保存'}
            </ToolbarButton>
            <ToolbarButton onClick={handleAutoLayout} disabled={!projectId || nodes.length === 0}>
              📐 整理布局
            </ToolbarButton>
            <ToolbarButton onClick={() => reactFlow.fitView({ padding: 0.15, duration: 600 })}>
              🔍 适配视图
            </ToolbarButton>
            {/* Phase 36 — 一键成片 */}
            <ToolbarButton
              onClick={handleOrchestrate}
              disabled={orchestration.status === 'running' || !projectId || nodes.length === 0}
              accent
            >
              {orchestration.status === 'running'
                ? `🚀 运行中 (${orchestration.completed}/${orchestration.total})`
                : orchestration.status === 'done' && orchestration.total > 0
                ? `🚀 完成 (${orchestration.completed}/${orchestration.total})`
                : '🚀 一键成片'}
            </ToolbarButton>
            {orchestration.status === 'running' && orchestration.total > 0 && (
              <div style={{
                width: 120,
                height: 6,
                borderRadius: 3,
                background: theme.bg.surface,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(orchestration.completed / orchestration.total) * 100}%`,
                  height: '100%',
                  background: theme.status.connected,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
            {/* Iteration Engine — 诊断 / 重生成 / 确认 */}
            <ToolbarButton
              onClick={handleIterate}
              disabled={!projectId || nodes.length === 0}
            >
              {iteration.status === 'planning'
                ? '🔄 诊断中...'
                : iteration.status === 'executing'
                ? '🔄 迭代中...'
                : iteration.status === 'plan_ready'
                ? '🔄 计划就绪'
                : iteration.status === 'done'
                ? '🔄 待审阅'
                : '🔄 迭代'}
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
              selectedNodeIds={selectedNodeIds}
              onClose={() => setMenuPos(null)}
              projectId={projectId}
              episodesId={episodesId}
            />
          )}
        </ReactFlow>

        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />

        {iteration.panelOpen && (
          <IterationPanel />
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

function ToolbarButton({ onClick, children, disabled, accent }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: accent && !disabled ? theme.button.primary : theme.bg.card,
        color: accent && !disabled ? theme.text.onAccent : (disabled ? theme.text.disabled : theme.text.primary),
        border: `1px solid ${accent && !disabled ? theme.button.primary : theme.border.default}`,
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontWeight: accent ? 600 : 400,
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
