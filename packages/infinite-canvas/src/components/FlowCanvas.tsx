import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { applyLayout, selectVariant } from '@kais/flowgraph-v3'
import { FITVIEW_MIN_ZOOM, LodProvider } from '../hooks/useLod'

import AssetNodeComponent from './nodes/AssetNode'
import FallbackNodeComponent from './nodes/FallbackNode'
import ZoneNodeComponent from './nodes/ZoneNode'
import AssetCardNode from './nodes/AssetCardNode'
import EventChipNode from './nodes/EventChipNode'
import LaneBands from './canvas/LaneBands'
import PhaseColumns from './canvas/PhaseColumns'
import Legend from './canvas/Legend'
import ShotTree from './canvas/ShotTree'
import { EventChipClickContext, type EventChipClickInfo } from './canvas/eventChipBus'
import CanvasEdgeComponent from './edges/CanvasEdge'
import CanvasContextMenu from './CanvasContextMenu'
import ProjectSelector from './ProjectSelector'
import NodeDetailPanel from './panel/NodeDetailPanel'
import IterationPanel from './IterationPanel'
import LoadingOverlay from './LoadingOverlay'
// C/D 层接线（SPEC-step5 C/D）：变体候选列表、事件参数 popover、溯源高亮、C 角标/牌堆注册。
import VariantPicker from './variants/VariantPicker'
import EventParamsPopover from './eventParams/EventParamsPopover'
import { useVariantPickerStore } from './variants/variantPickerStore'
import './variants/registerCInteractions'
import { useTraceHighlight } from '../hooks/useTraceHighlight'

import type { NodeState } from '../types/canvas'
import { useCanvasStore, type ViewMode } from '../store/canvasStore'
import { ToastContainer } from '../hooks/useToast'
import { canvasToFlowGraph } from '../utils/flowDataMapper'
import { getLayoutedElements } from '../utils/autoLayout'
import { loadCanvasGraph, saveCanvasGraph, convertProjectData, fetchSkillNodeTypes, orchestrateCanvas, fetchCanvasHealth } from '../services/canvasApi'
import { useCanvasSocket } from '../hooks/useCanvasSocket'
import StoryboardTimeline from './StoryboardTimeline'
import AssetManager from './assetManager/AssetManager'
import PipelineStateMachine from './PipelineStateMachine'
import StoryboardBoard from './storyboard/StoryboardBoard'
import { useLayout } from '../hooks/useLayout'
import { canvasStateKey, loadCanvasState, useCanvasPersistence } from '../hooks/useCanvasPersistence'
import { useNavHistory, type NavSnapshot } from '../hooks/useNavHistory'
import { getFixtureMode } from '../v3/fixtureSource'
import { theme, miniMapNodeColors, v3theme } from '../theme/catppuccin'
import { UiIcon } from './canvas/icons'
import { LAYOUT, V3_LAYOUT } from '../constants'

/**
 * Platform built-in node renderers (Phase 32 CANVAS-02) + V3 stage renderers。
 *
 * V3 契约（adapter graphToViewModel）：资产 RF type = stage 字符串（10 个），
 * 事件 → 'eventChip'（P19 芯片），结构 → 'structure'。stage 键统一映射到
 * AssetCardNode（§4 节点解剖学 + §7 LOD 三级，按 data.v3 渲染）；
 * `default` 仍是未知类型的 FallbackNode（CANVAS-03）。
 * 旧五渲染器键（script/asset/storyboard/video/audio）与 stage 键撞名——
 * 全部加载已走 V3 adapter（SPEC-step5 B.8），撞名键以 V3 卡为准；
 * 非 graph 兜底路径保留 'asset'/'reference'/'zone' 旧渲染器。
 */
const nodeTypes = {
  default: FallbackNodeComponent,
  // V3 stage keys（P8 十泳道）
  global: AssetCardNode,
  script: AssetCardNode,
  storyboard: AssetCardNode,
  keyframe: AssetCardNode,
  video: AssetCardNode,
  voice: AssetCardNode,
  foley: AssetCardNode,
  bgm: AssetCardNode,
  mix: AssetCardNode,
  composite: AssetCardNode,
  // P19 事件芯片 / 结构节点兜底
  eventChip: EventChipNode,
  structure: FallbackNodeComponent,
  // legacy 非 graph 路径 — asset 也走 AssetCardNode 以获得 resolveMediaUrl 支持
  asset: AssetCardNode,
  reference: AssetCardNode,
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

  // Phase 45 (TEXT-03) — Tier 2 search filter state.
  const [searchQuery, setSearchQuery] = useState('')

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setEdges = useCanvasStore((s) => s.setEdges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const graph = useCanvasStore((s) => s.graph)
  const loadInitialGraph = useCanvasStore((s) => s.loadInitialGraph)
  const applyGraphTransform = useCanvasStore((s) => s.applyGraphTransform)

  // SPEC-step5 B.7：包内布局 → RF 坐标桥（tokens 泳道几何 + 边产物模态色富化）
  const { nodes: layoutedNodes, edges: layoutedEdges, geometry } = useLayout()

  // RF 12 handleBounds 时序修复：节点首帧 mount 后 RF 才注册 handleBounds；
  // 同帧传入 edges 会被 error008 静默丢弃且不重试。
  // 延迟传入 edges（setTimeout 0 = 下一个事件循环 tick，确保 DOM 测量完成）。
  const [edgesReady, setEdgesReady] = useState(false)
  useEffect(() => {
    if (layoutedNodes.length > 0 && !edgesReady) {
      const timer = setTimeout(() => setEdgesReady(true), 100)
      return () => clearTimeout(timer)
    }
    if (layoutedNodes.length === 0 && edgesReady) setEdgesReady(false)
  }, [layoutedNodes.length, edgesReady])
  const edgesDeferred = edgesReady ? layoutedEdges : []

  // SPEC-step5 B.8：fixture 模式（?fixture=decompose|valid，绕过 socket/REST）
  const fixtureMode = getFixtureMode()

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

  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const detailNode = useCanvasStore((s) => s.detailNode)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)
  // Phase 37 — 多选
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds)

  // 【资产↔画布交叉联动】资产库「定位」按钮设置的焦点节点 ID（非 null 时触发定位 + 高亮）
  const focusAssetNodeId = useCanvasStore((s) => s.focusAssetNodeId)
  const setFocusAssetNodeId = useCanvasStore((s) => s.setFocusAssetNodeId)

  const showToast = useCanvasStore((s) => s.showToast)
  const toasts = useCanvasStore((s) => s.toasts)
  const dismissToast = useCanvasStore((s) => s.dismissToast)
  const selectWinner = useCanvasStore((s) => s.selectWinner)

  // 视图模式切换：画布 / 时间轴
  const viewMode = useCanvasStore((s) => s.viewMode)
  const setViewMode = useCanvasStore((s) => s.setViewMode)

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

  // 事件芯片参数 popover 插槽（SPEC B.3：B 留出口，popover 本体归 D）
  const [activeChip, setActiveChip] = useState<EventChipClickInfo | null>(null)
  const handleEventChipClick = useCallback((info: EventChipClickInfo) => setActiveChip(info), [])

  // Health-poll baseline ref — 必须在 useCanvasSocket 之前声明,
  // 以便 onGraphSaved 回调里能重置基线避免双触发 reload。
  const lastEventCountRef = useRef<number | null>(null)

  const { connected } = useCanvasSocket({
    // fixture 模式绕过 socket（SPEC A.3：静态预览/离线开发不连后端）
    projectId: fixtureMode ? 0 : (projectId ?? 0),
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
    onVariantSelected: (payload) => {
      // Phase 49 (WR-08): 他端选定了变体组 winner — 本端画布同步应用。
      // 守卫① scope：仅当前显示的 project/episode（与 onGraphSaved 一致）；
      // 守卫② 回显：本端发起的选定已乐观应用（group.winnerNodeId 已等于
      // payload 值）→ 跳过，避免重复变换/闪烁。
      if (!projectId || episodesId == null) return
      if (payload.projectId !== projectId || payload.episodesId !== episodesId) return
      const st = useCanvasStore.getState()
      const graph = st.graph
      if (!graph) return
      const group = graph.variantGroups.find((g) => g.id === payload.groupId)
      if (!group) return
      if (group.winnerNodeId === payload.winnerNodeId) return // 本端回显
      try {
        st.applyGraphTransform((g) => selectVariant(g, payload.groupId, payload.winnerNodeId))
        showToast(`变体组 ${payload.groupId} 已由其他会话选定优胜`, 'info')
      } catch (err) {
        // locked/multi 等组态与本地视图不一致 — 不强推，留给下次全量加载收敛
        console.warn('[FlowCanvas] variant:selected 应用失败(等待下次全量同步):', err)
      }
    },
  })

  /**
   * 加载流程（SPEC-step5 B.8 接线）：全部走 store.loadInitialGraph ——
   * ?fixture=decompose|valid → fixture 直载（fixtureSource 决策树内识别，绕过 REST）；
   * 否则 loadBackend（REST 全量 V2）→ adaptV2Graph；后端不可达 → 自动 fallback
   * decompose fixture + toast（fallback 文案在 store/fixtureSource 内生效）。
   * 布局由包内引擎接管（P7/P8/P9/P11），不再做 dagre 加载重排。
   */
  const loadCanvas = useCallback(async (pid: number, eid: number) => {
    setLoadError(null)
    setProject(pid, eid)

    await loadInitialGraph(async () => {
      const savedGraph = await loadCanvasGraph(pid, eid)
      if (savedGraph?.nodes?.length) return savedGraph
      const converted = await convertProjectData(pid, eid)
      // 空项目：返回空骨架（不抛错——抛错会触发 fixture fallback，语义不对）
      return { meta: { projectId: pid, episodesId: eid }, nodes: [], links: [], branches: [], variantGroups: [] }
    })

    const loaded = useCanvasStore.getState().graph
    if (!getFixtureMode() && loaded && loaded.nodes.length === 0) {
      setNodes([])
      setEdges([])
      setLoadError('该项目暂无数据，请先运行管线生成剧本和资产')
    }

    const url = new URL(window.location.href)
    url.searchParams.set('projectId', String(pid))
    url.searchParams.set('episodesId', String(eid))
    window.history.replaceState({}, '', url.toString())
  }, [setNodes, setEdges, setLoadError, setProject, loadInitialGraph])

  // fixture 模式：免选项目直接加载（?fixture=decompose|valid），项目上下文取 fixture meta
  useEffect(() => {
    if (!fixtureMode) return
    void loadInitialGraph().then(() => {
      const g = useCanvasStore.getState().graph
      if (g && (g.meta.projectId || g.meta.episodesId)) {
        useCanvasStore.getState().setProject(g.meta.projectId, g.meta.episodesId)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureMode, loadInitialGraph])

  // ── P17 持久化（SPEC B.6）：viewport/折叠/选定 → localStorage（key 含 projectId+episodesId） ──
  // fixture 模式无 URL 项目参数时取 graph.meta；都不具备则不持久化（如未加载）
  const graphMetaIds = graph?.meta
  const effPid = projectId ?? graphMetaIds?.projectId ?? null
  const effEid = episodesId ?? graphMetaIds?.episodesId ?? null
  const persistenceKey = effPid != null && effEid != null ? canvasStateKey(effPid, effEid) : null
  const { onMoveEnd: persistViewport } = useCanvasPersistence(persistenceKey, layoutedNodes.length > 0)
  // 有持久化 viewport 时跳过 fitView（P17：刷新原样恢复优先于适配视图）；
  // 实际恢复 + 缩放下限钳制在 useCanvasPersistence（setViewport 处）统一做。
  const persistedViewport = useMemo(
    () => (persistenceKey ? loadCanvasState(persistenceKey).viewport : undefined),
    [persistenceKey],
  )

  // 应用级状态历史导航（全局后退/前进）：替代旧的画布视口历史。
  // getViewport 注入 reactFlow.getViewport() —— 始终精确、零 store 副作用
  // （store.setViewport 会改写 graph 引用触发 useLayout 全量重布，不可在每次平移调用）。
  const getViewport = useCallback(
    () => {
      const v = reactFlow.getViewport()
      return { x: v.x, y: v.y, zoom: v.zoom }
    },
    [reactFlow],
  )
  const navHistory = useNavHistory(getViewport)

  // navSkipRef 防止 apply（程序性恢复状态）触发递归 push：
  //  - apply 设置 true → setViewport 动画（duration 300）触发的 onMoveEnd 等回调检查它 → 跳过 push；
  //  - 兜底重置：覆盖无 onMoveEnd（视口为空/未移动）导致 flag 卡死的情形，
  //    350ms > 300ms 动画，确保动画结束前的 onMoveEnd 也被跳过，且用户下次交互能被记录。
  const navSkipRef = useRef(false)

  const handleMoveEnd = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (!navSkipRef.current) navHistory.push()
      persistViewport(viewport)
    },
    [navHistory, persistViewport],
  )

  // 应用一个历史快照：恢复完整应用状态（视图模式 / 子视图 / 选中 / 详情 / 视口）。
  const applyNavSnapshot = useCallback(
    (snap: NavSnapshot) => {
      navSkipRef.current = true
      const store = useCanvasStore.getState()
      store.setViewMode(snap.viewMode)
      store.setAssetView(snap.assetView)
      store.setSelectedAssetUuid(snap.selectedAssetUuid)
      // selectedNode / detailNode 需从当前 nodes 数组按 id 还原（保持引用一致）
      const nodes = store.nodes
      store.setSelectedNode(snap.selectedNodeId ? nodes.find((n) => n.id === snap.selectedNodeId) ?? null : null)
      store.setDetailNode(snap.detailNodeId ? nodes.find((n) => n.id === snap.detailNodeId) ?? null : null)
      if (snap.viewport) {
        reactFlow.setViewport(snap.viewport, { duration: 300 })
      }
      // 兜底重置（见 navSkipRef 注释）
      window.setTimeout(() => { navSkipRef.current = false }, 350)
    },
    [reactFlow],
  )

  // 把 navHistory.push 注入 store，让 AssetManager/AssetLibrary 等子组件的导航交互也进历史栈。
  // 同时注入 applyNavSnapshot，让 popstate 监听器能恢复完整应用状态。
  // （必须在 applyNavSnapshot 定义之后，否则 TDZ 报错。）
  useEffect(() => {
    useCanvasStore.getState().setNavPushCallback(navHistory.push)
    navHistory._setApplyFn?.(applyNavSnapshot)
    return () => {
      useCanvasStore.getState().setNavPushCallback(null)
      navHistory._setApplyFn?.(null)
    }
  }, [navHistory, applyNavSnapshot])

  const handleNavBack = useCallback(() => {
    // 应用内←按钮：直接调用浏览器 history.back()，由 popstate 监听器统一处理栈操作+状态恢复。
    // 这样浏览器前进后退和应用内按钮走完全相同的路径，不会产生状态不一致。
    if (navHistory.canBack) {
      try { window.history.back() } catch { /* noop */ }
    }
  }, [navHistory])

  const handleNavForward = useCallback(() => {
    // 应用内→按钮：同上，委托给浏览器 history.forward()。
    if (navHistory.canForward) {
      try { window.history.forward() } catch { /* noop */ }
    }
  }, [navHistory])

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
    if (!navSkipRef.current) navHistory.push()
    setSelectedNode(null)
    setDetailNode(null) // 单击空白画布 → 右详情面板自动缩回
    setActiveChip(null) // 关掉事件芯片 popover 插槽
  }, [navHistory, setMenuPos, setSelectedNode, setDetailNode])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: any) => {
    // 事件芯片自带点击行为（P19 参数 popover 出口），不进节点详情面板
    if (node?.type === 'eventChip') return
    // 单击 = 选中 + 溯源高亮（不开右面板），且若右面板已开则自动缩回（双击才再次打开）
    if (!navSkipRef.current) navHistory.push()
    setSelectedNode(node)
    setDetailNode(null)
  }, [navHistory, setSelectedNode, setDetailNode])

  // 双击 = 打开右详情面板（与单击解耦：单击只驱动溯源高亮 + 选中环）
  // 注意：ReactFlow 默认 zoomOnDoubleClick=true 会吞掉 dblclick 用于缩放，导致此回调不触发；
  // 已在 <ReactFlow> 上设 zoomOnDoubleClick={false} 放行。
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: any) => {
    if (node?.type === 'eventChip') return
    if (!navSkipRef.current) navHistory.push()
    setSelectedNode(node)
    setDetailNode(node)
  }, [navHistory, setSelectedNode, setDetailNode])

  // 视图模式切换：先拍当前状态进历史（记录切之前的视图），再切。
  const handleSetViewMode = useCallback((mode: ViewMode) => {
    if (navSkipRef.current) { setViewMode(mode); return }
    navHistory.push()
    setViewMode(mode)
  }, [navHistory, setViewMode])

  // 管线视图 → 画布定位：切到 canvas 并选中/打开该节点（资产缩略图点击）。
  const handleLocateNode = useCallback((nodeId: string) => {
    handleSetViewMode('canvas')
    const target = useCanvasStore.getState().nodes.find((n) => n.id === nodeId) ?? null
    setSelectedNode(target)
    setDetailNode(target)
    // 延迟触发画布聚焦高亮（等 ReactFlow 挂载测量；未命中由画布侧 toast 提示）
    window.setTimeout(() => setFocusAssetNodeId(nodeId), 140)
  }, [handleSetViewMode, setSelectedNode, setDetailNode, setFocusAssetNodeId])

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

  // 自动整理布局：V3 = 包内布局引擎全量重布（position 是计算缓存，宪法 §7；
  // 【优化口】增量只重布脏子图见 useLayout.ts 注释）；非 graph 兜底路径保留 dagre。
  const handleAutoLayout = useCallback(() => {
    if (graph) {
      applyGraphTransform((g) => applyLayout(g, { gap: V3_LAYOUT.NODE_GAP_X }))
    } else {
      const { nodes: layouted, edges: layoutedEdgeList } = getLayoutedElements(
        nodes as any[],
        edges as any[],
        'LR',
      )
      setNodes(layouted)
      setEdges(layoutedEdgeList)
    }
    // 短延迟后 fitView，等待 React 重渲染拿到 measured 尺寸
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.15, minZoom: FITVIEW_MIN_ZOOM, duration: 600 })
    }, 50)
    showToast?.('已整理为紧凑布局', 'success')
  }, [graph, applyGraphTransform, nodes, edges, setNodes, setEdges, reactFlow, showToast])

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
    // §2.1：minimap 节点色 = 模态色 + locked 石灰（拉片参考区一眼可辨）
    if (node.data?.curation === 'locked') return v3theme.signal.locked
    return miniMapNodeColors[node.type || ''] ?? theme.border.dim
  }, [])

  // Phase 32 CANVAS-01 — pull declared node types from the skill registry on
  // mount. The result is descriptive metadata (used by future UI affordances
  // like an "Add Node" menu); it does NOT drive renderer selection — the five
  // built-in renderers (script/asset/storyboard/video/audio) are platform
  // primitives keyed by `default_renderer`. Unknown types fall through to
  // FallbackNode via the `default` entry in the nodeTypes map (CANVAS-03).
  useEffect(() => {
    if (fixtureMode) return // fixture 模式绕过 REST（SPEC A.3）
    let cancelled = false
    fetchSkillNodeTypes(activeSkillId)
      .then((decls) => {
        if (!cancelled) setDeclaredNodeTypes(decls)
      })
    return () => {
      cancelled = true
    }
  }, [activeSkillId, setDeclaredNodeTypes, fixtureMode])

  // Phase 45 (TEXT-03) — Tier 2 search filter.
  // Debounced 200ms; filters visible nodes by case-insensitive substring
  // match against data.label / data.description / data.prompt.
  // Visibility-only — non-matched nodes get hidden:true (React Flow standard).
  // Clearing the input restores all nodes.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = searchQuery.trim().toLowerCase()
      setNodes((nds) =>
        nds.map((n) => {
          const label = (n.data?.label as string) ?? ''
          const description = (n.data?.description as string) ?? ''
          const prompt = (n.data?.prompt as string) ?? ''
          const matches =
            !q ||
            label.toLowerCase().includes(q) ||
            description.toLowerCase().includes(q) ||
            prompt.toLowerCase().includes(q)
          return { ...n, hidden: !matches }
        }),
      )
    }, 200)
    return () => clearTimeout(t)
  }, [searchQuery, setNodes])

  // Health-poll fallback: 如果 socket 事件丢失(graph:saved 未到达),
  // 通过轮询 /api/canvas/v2/health 的 eventCount 变化兜底触发 reload。
  // 仅在外部写入(pipeline)时生效;前端自己的 loadCanvas 不会改变
  // 当前 scope 的 eventCount 之外的位置。
  useEffect(() => {
    if (fixtureMode || !projectId || episodesId == null) {
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

  // P18 溯源高亮（SPEC C.3）：选中节点时把 traceState / highlighted 盖到派生模型——
  // AssetCardNode 读 data.traceState、CanvasEdge 读 data.highlighted，无需改 B 文件。
  // 仅 trace 激活时映射，避免常态无谓重算。
  // 在「渲染边集」（edgesDeferred = adapter 折叠边 + useLayout 派生的镜头级边）上求闭包，
  // 与用户实际看到的拓扑一致（点视频能沿 shot_link 亮到分镜、沿 reference 亮到角色）。
  const trace = useTraceHighlight(edgesDeferred)
  // 【资产↔画布交叉联动】focusAssetNodeId 叠加：定位时给该节点盖 traceState='highlighted'
  // （与溯源高亮同通道，复用 AssetCardNode 既有的 brightness(1.12) 视觉）。
  const tracedNodes = useMemo(
    () => {
      const fromTrace = trace.active
        ? layoutedNodes.map((n) => ({
            ...n,
            data: { ...n.data, traceState: trace.highlightedIds.has(n.id) ? 'highlighted' : 'dimmed' },
          }))
        : layoutedNodes
      // 叠加 focus 高亮（优先级高于 dimmed，让定位节点在压暗背景里仍醒目）
      if (!focusAssetNodeId) return fromTrace
      return fromTrace.map((n) =>
        n.id === focusAssetNodeId
          ? { ...n, data: { ...n.data, traceState: 'highlighted' as const } }
          : trace.active && (n.data as any).traceState !== 'highlighted'
            ? { ...n, data: { ...n.data, traceState: 'dimmed' as const } }
            : n,
      )
    },
    [layoutedNodes, trace, focusAssetNodeId],
  )
  const tracedEdges = useMemo(
    () => trace.active
      ? edgesDeferred.map((e) => {
          const hi = trace.highlightedEdges.has(e.id)
          return { ...e, data: { ...e.data, highlighted: hi, dimmed: !hi } }
        })
      : edgesDeferred,
    [edgesDeferred, trace],
  )

  // 【资产↔画布交叉联动】资产库「📍 定位」按钮的画布侧响应：
  // focusAssetNodeId 非 null → 在 nodes 里找节点 → 命中则 fitView + 选中 + 双击开详情，
  //   并通过上面 tracedNodes 的 focus 叠加做闪烁高亮；1.5s 后清 focusAssetNodeId 退高亮。
  // 未命中（资产未放置在画布）→ toast 提示，并清 focusAssetNodeId。
  useEffect(() => {
    if (!focusAssetNodeId) return
    const target = (nodes as any[]).find((n) => n.id === focusAssetNodeId)
    if (!target) {
      showToast('该资产尚未放置在画布上', 'info')
      // 微延迟清空，避免 tracedNodes memo 在同一帧内还看到旧值
      const t = setTimeout(() => setFocusAssetNodeId(null), 0)
      return () => clearTimeout(t)
    }
    // 命中：选中 + 打开详情面板（定位即聚焦）
    setSelectedNode(target)
    setDetailNode(target)
    // fitView 聚焦到该节点（下一帧执行，确保 React 已渲染 tracedNodes）
    const tFit = setTimeout(() => {
      reactFlow.fitView({ nodes: [{ id: focusAssetNodeId }], duration: 600, maxZoom: 1.5 })
    }, 50)
    // 1.5s 后清高亮 + 清 focusAssetNodeId
    const tClear = setTimeout(() => {
      setFocusAssetNodeId(null)
    }, 1500)
    return () => { clearTimeout(tFit); clearTimeout(tClear) }
  }, [focusAssetNodeId, nodes, reactFlow, setSelectedNode, setDetailNode, showToast, setFocusAssetNodeId])

  // Esc 退出溯源高亮 / 关芯片 popover（VariantPicker / EventParamsPopover 各自处理自身 Esc，
  // 有模态覆盖层时不在此连带关闭详情面板）。
  // 两段式：钉选详情面板开着 → 先关面板（保留溯源）；否则清选中退溯源。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useVariantPickerStore.getState().open || activeChip) return
      if (detailNode) { setDetailNode(null); return }
      setSelectedNode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedNode, setDetailNode, activeChip, detailNode])

  // 全屏加载 — 骨架屏
  if (loading && !hasData) {
    return <LoadingOverlay />
  }

  return (
    <>
      {/* 顶部导航栏 */}
      <div style={topBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', color: theme.node.script }}>
            <UiIcon kind="graph" size={16} />
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 600, fontSize: 13, letterSpacing: '0.02em' }}>无限画布</span>
          <span style={{ width: 1, height: 14, background: theme.border.default }} />

          {/* 视图模式切换 */}
          <div style={{ display: 'flex', gap: 2, background: theme.bg.input, borderRadius: 7, padding: 2, border: `1px solid ${theme.border.default}` }}>
            <ViewModeButton active={viewMode === 'canvas'} onClick={() => handleSetViewMode('canvas')}>
              <UiIcon kind="graph" size={13} />画布
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'timeline'} onClick={() => handleSetViewMode('timeline')}>
              <UiIcon kind="film" size={13} />时间轴
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'assets'} onClick={() => handleSetViewMode('assets')}>
              <UiIcon kind="assets" size={13} />资产
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'pipeline'} onClick={() => handleSetViewMode('pipeline')}>
              <UiIcon kind="pipeline" size={13} />管线
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'storyboard_board'} onClick={() => handleSetViewMode('storyboard_board')}>
              <UiIcon kind="layout" size={13} />分镜板
            </ViewModeButton>
          </div>

          {/* 应用级历史导航：后退 / 前进（全局功能，恢复完整应用状态） */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 7, overflow: 'hidden', border: `1px solid ${theme.border.default}`, boxShadow: 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)' }}>
            <NavArrowButton onClick={handleNavBack} disabled={!navHistory.canBack} title="后退到上一个状态" label="←" />
            <NavArrowButton onClick={handleNavForward} disabled={!navHistory.canForward} title="前进到下一个状态" label="→" />
          </div>
        </div>

        {fixtureMode ? (
          <span style={{ color: theme.text.secondary, fontSize: 11, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            fixture: {fixtureMode}
          </span>
        ) : (
          <ProjectSelector
            initialProjectId={initialParams.projectId}
            initialEpisodesId={initialParams.episodesId}
            onSelect={loadCanvas}
          />
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!fixtureMode && (
            <span style={{ color: connected ? theme.status.connected : theme.status.disconnected, fontSize: 11 }}>
              {connected ? '● 已连接' : '○ 未连接'}
            </span>
          )}
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

      {/* 画布区域 / 时间轴视图 */}
      <div style={{ width: '100%', height: 'calc(100vh - 48px)', position: 'relative' }}>
        {viewMode === 'timeline' ? (
          <>
            <StoryboardTimeline />
            {/* 右详情面板复用 */}
            <NodeDetailPanel
              node={detailNode}
              onClose={() => setDetailNode(null)}
            />
          </>
        ) : viewMode === 'assets' ? (
          <AssetManager />
        ) : viewMode === 'pipeline' ? (
          <PipelineStateMachine
            onRefresh={projectId && episodesId != null ? () => loadCanvas(projectId, episodesId) : undefined}
            onLocateNode={handleLocateNode}
          />
        ) : viewMode === 'storyboard_board' ? (
          <StoryboardBoard />
        ) : (
        <>
        <EventChipClickContext.Provider value={handleEventChipClick}>
        <LodProvider>
        <ReactFlow
          nodes={tracedNodes}
          edges={tracedEdges}
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
          onNodeDoubleClick={onNodeDoubleClick}
          onSelectionChange={onSelectionChange}
          onMoveEnd={handleMoveEnd}
          fitView={hasData && !persistedViewport}
          fitViewOptions={{ padding: 0.15, minZoom: FITVIEW_MIN_ZOOM, maxZoom: 1.5, duration: 600 }}
          minZoom={0.05}
          maxZoom={4}
          selectionOnDrag
          panOnDrag={[1]}
          selectionKeyCode="Shift"
          zoomOnDoubleClick={false}
          nodesDraggable={!graph}
          style={{ background: theme.bg.canvas }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={theme.border.canvas} gap={20} size={1} />

          {geometry && <LaneBands geometry={geometry} />}
          {geometry && geometry.phaseColumns && <PhaseColumns geometry={geometry} />}
          <Legend />
          <Controls
            position="bottom-left"
            showInteractive={false}
            fitViewOptions={{ padding: 0.15, minZoom: FITVIEW_MIN_ZOOM, duration: 600 }}
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

          <Panel position="top-left" style={{ display: 'flex', gap: 8, marginTop: 8, marginLeft: 8, alignItems: 'center' }}>
            <ToolbarButton onClick={handleSave} disabled={saving || !projectId}>
              <UiIcon kind="save" />{saving ? '保存中…' : '保存'}
            </ToolbarButton>
            <ToolbarButton onClick={handleAutoLayout} disabled={!projectId || nodes.length === 0}>
              <UiIcon kind="layout" />整理
            </ToolbarButton>
            <ToolbarButton onClick={() => reactFlow.fitView({ padding: 0.15, minZoom: FITVIEW_MIN_ZOOM, duration: 600 })}>
              <UiIcon kind="fit" />适配
            </ToolbarButton>
            <ToolbarButton
              onClick={handleOrchestrate}
              disabled={orchestration.status === 'running' || !projectId || nodes.length === 0}
              accent
            >
              <UiIcon kind="rocket" />
              {orchestration.status === 'running'
                ? `运行中 ${orchestration.completed}/${orchestration.total}`
                : orchestration.status === 'done' && orchestration.total > 0
                ? `完成 ${orchestration.completed}/${orchestration.total}`
                : '一键成片'}
            </ToolbarButton>
            {orchestration.status === 'running' && orchestration.total > 0 && (
              <div style={{
                width: 120, height: 4, borderRadius: 2,
                background: theme.bg.surface, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(orchestration.completed / orchestration.total) * 100}%`,
                  height: '100%',
                  background: theme.status.connected,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
            <ToolbarButton
              onClick={handleIterate}
              disabled={!projectId || nodes.length === 0}
            >
              <UiIcon kind="iterate" />
              {iteration.status === 'planning'
                ? '诊断中…'
                : iteration.status === 'executing'
                ? '迭代中…'
                : iteration.status === 'plan_ready'
                ? '计划就绪'
                : iteration.status === 'done'
                ? '待审阅'
                : '迭代'}
            </ToolbarButton>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 9, display: 'flex', color: theme.text.tertiary, pointerEvents: 'none' }}>
                <UiIcon kind="search" size={13} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索描述 / 标签…"
                className="cv-search-input"
                style={{
                  padding: '6px 10px 6px 28px',
                  borderRadius: 7,
                  background: theme.bg.input,
                  border: `1px solid ${theme.border.default}`,
                  color: theme.text.primary,
                  fontSize: 12,
                  minWidth: 200,
                  boxShadow: 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)',
                  transition: 'border-color 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = theme.border.strong }}
                onBlur={(e) => { e.currentTarget.style.borderColor = theme.border.default }}
              />
            </div>
          </Panel>

          {!hasData && !loading && (
            <Panel position="top-center" style={{ marginTop: 60 }}>
              <div style={{
                background: theme.bg.card,
                border: `1px solid ${theme.border.default}`,
                borderRadius: 12,
                padding: '32px 48px',
                textAlign: 'center',
                maxWidth: 400,
                boxShadow: 'var(--cv-shadow-pop, 0 12px 32px rgba(0,0,0,0.6))',
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', color: theme.text.tertiary, marginBottom: 14 }}>
                  <UiIcon kind="graph" size={40} />
                </div>
                <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                  欢迎使用无限画布
                </div>
                <div style={{ color: theme.text.secondary, fontSize: 13, lineHeight: 1.6 }}>
                  请从上方选择项目和剧本来加载数据，<br/>
                  或通过管线运行后自动同步数据。
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
        </LodProvider>
        </EventChipClickContext.Provider>

        <EventParamsPopover anchor={activeChip} onClose={() => setActiveChip(null)} />
        <ShotTree />
        <NodeDetailPanel node={detailNode} onClose={() => setDetailNode(null)} />
        <VariantPicker />
        {iteration.panelOpen && <IterationPanel />}
        </>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

function ToolbarButton({ onClick, children, disabled, accent, title }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; accent?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: accent && !disabled ? theme.button.primary : theme.bg.card,
        color: accent && !disabled ? theme.text.onAccent : (disabled ? theme.text.disabled : theme.text.secondary),
        border: `1px solid ${accent && !disabled ? theme.button.primary : theme.border.default}`,
        borderRadius: 7,
        padding: '6px 11px',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: accent && !disabled ? 'none' : 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)',
        transition: 'background 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), color 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), border-color 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text.primary; e.currentTarget.style.borderColor = theme.border.strong } }}
      onMouseLeave={(e) => { if (!accent) { e.currentTarget.style.color = disabled ? theme.text.disabled : theme.text.secondary; e.currentTarget.style.borderColor = theme.border.default } }}
    >
      {children}
    </button>
  )
}

/** 视口导航圆形箭头按钮 — 比普通工具栏按钮更大更醒目，视觉上类似浏览器后退/前进。 */
function NavArrowButton({ onClick, disabled, title, label }: { onClick: () => void; disabled?: boolean; title?: string; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 32,
        background: disabled ? theme.bg.surface : theme.bg.card,
        color: disabled ? theme.text.disabled : theme.text.primary,
        border: 'none',
        borderLeft: label === '→' ? `1px solid ${theme.border.default}` : 'none',
        fontSize: 18,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        transition: 'background 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), opacity 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = theme.bg.surface } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.background = theme.bg.card } }}
    >
      {label}
    </button>
  )
}

function ViewModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: active ? theme.bg.card : 'transparent',
        color: active ? theme.text.primary : theme.text.tertiary,
        border: 'none',
        borderRadius: 5,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), color 120ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
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
        /* Step 5 动效族（tokens --cv-*；时长/缓动在 var 内，此处只定义轨迹） */
        @keyframes cv-spin { to { transform: rotate(360deg) } }
        @keyframes cv-chip-tip { from { opacity: 0; transform: translate(-50%, 4px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes cv-stack-fan { from { opacity: 0; transform: translate(-8px, -8px) scale(0.9); } to { opacity: 1; transform: translate(0, 0) scale(1); } }
        @keyframes cv-stale-pulse {
          0% { filter: drop-shadow(0 0 0 rgba(240,165,46,0.0)); transform: scale(1); }
          50% { filter: drop-shadow(0 0 4px rgba(240,165,46,0.9)); transform: scale(1.25); }
          100% { filter: drop-shadow(0 0 0 rgba(240,165,46,0.0)); transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
