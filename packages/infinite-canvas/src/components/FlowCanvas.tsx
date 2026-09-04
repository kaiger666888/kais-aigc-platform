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
import type { AssetNodeV3 } from '@kais/flowgraph-v3'
import { syntheticDetailNode } from '../v3/adapter'
import { FITVIEW_MIN_ZOOM, LodProvider } from '../hooks/useLod'

import FallbackNodeComponent from './nodes/FallbackNode'
import ZoneNodeComponent from './nodes/ZoneNode'
import AssetCardNode from './nodes/AssetCardNode'
import EventChipNode from './nodes/EventChipNode'
import LaneBands from './canvas/LaneBands'
import PhaseColumns from './canvas/PhaseColumns'
import Legend from './canvas/Legend'
import GateTodoChip from './canvas/GateTodoChip'
import GateCenterPanel from './gate/GateCenterPanel'
import ShotTree from './canvas/ShotTree'
import { EventChipClickContext, type EventChipClickInfo } from './canvas/eventChipBus'
import CanvasEdgeComponent from './edges/CanvasEdge'
import CanvasContextMenu from './CanvasContextMenu'
import ProjectSelector from './ProjectSelector'
import NodeDetailPanel from './panel/NodeDetailPanel'
import IterationPanel from './IterationPanel'
import LoadingOverlay from './LoadingOverlay'
// C/D 层接线（SPEC-step5 C/D）：变体墙(53-02 取代 Picker 主体,store 协议保留)、事件参数 popover、溯源高亮、C 角标/牌堆注册。
import VariantWall from './variants/VariantWall'
import BlindSelectionOverlay from './variants/BlindSelection/BlindSelectionOverlay'
import { useBlindSelectionStore } from './variants/BlindSelection/blindSelectionStore'
import { buildBlindQueue } from './variants/BlindSelection/blindOrder'
import G15TriagePanel from './g15/G15TriagePanel'
// 迭代平台 M3 金标轨(B 轨)打分面板 — score-p09 + gold_auto APPLY 门
import GoldPanel from './g15/GoldPanel'
import { useG15TriageStore } from './g15/g15TriageStore'
import EventParamsPopover from './eventParams/EventParamsPopover'
import { useVariantPickerStore } from './variants/variantPickerStore'
import './variants/registerCInteractions'
import { useTraceHighlight } from '../hooks/useTraceHighlight'

import type { NodeState } from '../types/canvas'
import { useCanvasStore, type ViewMode } from '../store/canvasStore'
import { ToastContainer } from '../hooks/useToast'
import { serializeGraphToV2 } from '../v3/serialize'
import { getLayoutedElements } from '../utils/autoLayout'
import { loadCanvasGraph, saveCanvasGraph, convertProjectData, fetchSkillNodeTypes, orchestrateCanvas, fetchCanvasHealth, fetchGateState, placeAssetNode, ASSET_DRAG_MIME, type AssetDragPayload } from '../services/canvasApi'
// 60-02 (D-01): graph:saved 自回声判定身份(详见 clientTabId.ts 头注释)
import { getClientTabId } from '../services/clientTabId'
import { useGateStore, resolveRepresentativeNodeId } from '../store/gateStore'
import { useCanvasSocket } from '../hooks/useCanvasSocket'
// Phase 59 (59-03): node:updated stale 载荷 → 既有级联出口(幂等收敛+脉动)
import { triggerStaleCascade } from '../hooks/useStale'
import StoryboardTimeline from './StoryboardTimeline'
import AssetManager from './assetManager/AssetManager'
import PipelineStateMachine from './PipelineStateMachine'
import ReversePipelineView from './ReversePipelineView'
import StoryboardBoard from './storyboard/StoryboardBoard'
import SceneShotBrowser from './SceneShotBrowser'
import SearchNavigator from './canvas/SearchNavigator'
import BranchPanel from './BranchPanel'
import GroupViewTheater from './theater/GroupViewTheater'
import G16VoiceWorkbench from './g16/G16VoiceWorkbench'
import { theaterTargetOf } from './theater/groupMembership'
import { useTheaterStore } from './theater/theaterStore'
import { placeNewAsset } from '../utils/placeNewAsset'
// 57-03 (D-05): 深链 focus/zone 纯函数 —— 只解析,viewport 副作用全复用既有 effect
import { parseDeepLink, resolveDeepLinkTarget, type DeepLinkNodeLike } from '../lib/deepLink'
// 57-03 (D-06): KapNavbar 单源三宿主第二宿主——副作用 import 注册共享导航元素
// (跨包 alias '@portal-nav',flowgraph-v3 同式;样式走 index.html 稳定名产物)。
import '@portal-nav'
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

function getInitialParams(): {
  projectId: number | null
  episodesId: number | null
  focus?: string
  zone?: string
} {
  if (typeof window === 'undefined') return { projectId: null, episodesId: null }
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('projectId')
  const episodesId = params.get('episodesId')
  // 57-03 (D-05): 深链 focus/zone 增读（同函数追加,既有两键回归兼容）
  const { focus, zone } = parseDeepLink(window.location.search)
  return {
    projectId: projectId ? Number(projectId) : null,
    episodesId: episodesId ? Number(episodesId) : null,
    ...(focus ? { focus } : {}),
    ...(zone ? { zone } : {}),
  }
}

function CanvasInner() {
  const reactFlow = useReactFlow()

  // Phase 45 (TEXT-03) — Tier 2 search filter state.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchNavOpen, setSearchNavOpen] = useState(false)
  const [branchPanelOpen, setBranchPanelOpen] = useState(false)
  // 迭代平台 M3 金标轨(B 轨)面板开合(与 branchPanel 同款本地 useState 壳)
  const [goldPanelOpen, setGoldPanelOpen] = useState(false)

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setEdges = useCanvasStore((s) => s.setEdges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const graph = useCanvasStore((s) => s.graph)
  // Phase 54 (54-06): 阻塞 phase 列索引 = blocking 代表节点的 phaseIndex
  // (selector 订阅 gateStore,勿在列渲染内每帧扫描;派生列由 median 投影)。
  const gateBlocking = useGateStore((s) => s.snapshot?.blocking ?? null)
  const gateOpen = useGateStore((s) => s.open)
  // badge 数 = pending 门数(display==='pending' 且有 reviewId);0 不显示徽章
  const gatePendingCount = useGateStore(
    (s) => (s.snapshot?.gates ?? []).filter((g) => g.display === 'pending' && g.reviewId != null).length,
  )
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

  // 53-07:G15 分诊待处置数(工具栏徽章;fixture/Wave B 数据源同通道)
  const g15Rows = useG15TriageStore((s) => s.rows)
  const g15RowState = useG15TriageStore((s) => s.rowState)
  const g15Pending = g15Rows.filter((r) => g15RowState[r.shotId] == null).length
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

  // 57-03 (D-05): 深链 focus/zone 一次性快照与消费守卫——首载 mount 时解析一次,
  // 图加载 resolve 后消费一次(useRef 防重放;health-poll/socket 触发的 reload 不
  // 重跳,刷新重放属既定 UX——replaceState 回写不动 focus/zone,URL 留参可重放)。
  // 消费分两步:loadCanvas resolve 时解析目标 + 切画布视图(此处);目标投放交给
  // 下方 deepLinkPending effect(等 RF 初始 fitView 走完再设 focusAssetNodeId)。
  const deepLinkRef = useRef(initialParams)
  const deepLinkConsumedRef = useRef(false)
  const [deepLinkPending, setDeepLinkPending] = useState<string | null>(null)
  // ReactFlow init 门(onInit 置位):深链投放须等 RF 实例就绪
  const [rfReady, setRfReady] = useState(false)

  // 事件芯片参数 popover 插槽（SPEC B.3：B 留出口，popover 本体归 D）
  const [activeChip, setActiveChip] = useState<EventChipClickInfo | null>(null)
  // 52-04：注入项目上下文（popover 换 seed 重跑提交需要 pid/eid，芯片自身拿不到）
  const handleEventChipClick = useCallback(
    (info: EventChipClickInfo) => setActiveChip({ ...info, projectId, episodesId }),
    [projectId, episodesId],
  )

  // WRITE-03（Phase 51-02）：socket 写回走 store canonical action，不再直改派生缓存
  const applySocketNodeState = useCanvasStore((s) => s.applySocketNodeState)
  const applySocketNodePreview = useCanvasStore((s) => s.applySocketNodePreview)

  // Health-poll baseline ref — 必须在 useCanvasSocket 之前声明,
  // 以便 onGraphSaved 回调里能重置基线避免双触发 reload。
  const lastEventCountRef = useRef<number | null>(null)

  const { connected } = useCanvasSocket({
    // fixture 模式绕过 socket（SPEC A.3：静态预览/离线开发不连后端）
    projectId: fixtureMode ? 0 : (projectId ?? 0),
    onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => {
      applySocketNodeState(nodeId, state, progress)
    },
    // 56-01 (D-03):scored → canonical aiScore 写(不进状态机)
    onNodeScored: (nodeId, aiScore) => {
      useCanvasStore.getState().applySocketScored(nodeId, aiScore)
    },
    onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => {
      applySocketNodePreview(nodeId, thumbnailUrl)
    },
    onNewAsset: (node: Record<string, unknown>) => {
      // 55-04 (NAV-04):随机散布反模式已删——位置决策:服务端 position 有限
      // 即用(真相优先);否则视口中心(placeNewAsset 8px 网格,UI-SPEC §6)。
      // 写回走 canonical addNodeFromSocket(WRITE-03),不再 setNodes 直写。
      const rawPos = node.position as { x?: unknown; y?: unknown } | undefined
      const position =
        rawPos != null && typeof rawPos.x === 'number' && typeof rawPos.y === 'number'
        && Number.isFinite(rawPos.x) && Number.isFinite(rawPos.y)
          ? { x: rawPos.x, y: rawPos.y }
          : placeNewAsset({
              sourcePosition: null,
              viewportCenter: reactFlow.screenToFlowPosition({
                x: window.innerWidth / 2,
                y: window.innerHeight / 2,
              }),
              anchor: 'center',
            })
      const nodeId = typeof node.id === 'string' ? node.id : '(unknown)'
      const added = useCanvasStore.getState().addNodeFromSocket(node, position)
      if (added) setFocusAssetNodeId(nodeId)
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
        // FLAG-1(60-UI-SPEC §4): 基线重置无条件先行——mock health 的 eventCount
        // 把每次 save-v2 计为事件,自回声分支若丢重置,自保存后 ≤30s 会冒假
        // 「检测到 pipeline 远端更新」toast + 无谓 reload(违 D-05)。
        // 跳 reload 不跳基线;此序为 60-05 S2 静态锁锚定(重置行先于早退行)。
        lastEventCountRef.current = null
        // 60-02 (D-01): 自回声判定——本端 saveCanvasGraph 单点携带 savedBy,
        // 服务端原样回显;命中即本端保存(本地 store 已是 canonical 真相 +
        // 200 确认),静默早退:无 toast、无 reload(D-05)。他端(kmc pipeline /
        // 其他 tab,无 savedBy 或不同 tabId)走下方既有 reload 链,零回归。
        const selfEcho =
          typeof payload.savedBy === 'string' && payload.savedBy === getClientTabId()
        if (selfEcho) return
        showToast('Pipeline 同步了新数据,正在刷新画布…', 'info')
        loadCanvas(projectId, episodesId)
      }
    },
    // 55-06 (A5):branch:updated/branch_upsert 事件回流 → status 真相合并
    // (toLegacyBranches 硬编码 'active' 的运行时修正点,Pitfall 4 方案 b)。
    onBranchCreated: (branch) => {
      useCanvasStore.getState().applyBranchUpsert(branch.id, {
        ...(typeof branch.label === 'string' ? { label: branch.label } : {}),
        status: branch.status,
      })
    },
    onGateState: (payload) => {
      // Phase 54 (D-03): gate 中心状态推送。守卫 scope(与 onVariantSelected
      // 同法)——他项目的 payload 不进本端 store(防跨项目串扰)。
      if (!projectId || episodesId == null) return
      if (payload.projectId !== projectId || payload.episodesId !== episodesId) return
      useGateStore.getState().apply(payload)
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
    onNodeUpdated: (payload) => {
      // Phase 59 (D-01, FLAG-1 Option A): 服务端 stale 标记广播(59-02
      // markStaleAndBroadcast——带 regenSource 的 execute 任务成功后把下游落库
      // stale 并逐节点广播)。严格契约(UI-SPEC §5):只消费 stale 载荷——轻校验
      // node.data.stale 三字段形状(since 为 number、triggerAssetId 为 string),
      // 校验失败静默 return(校验失败分支无任何 store 写入);非 stale 载荷的
      // node:updated(如 nodes.ts PATCH 回声)一律忽略——不开面板、不改选中、
      // 不弹 toast。
      // 59-fix CR-02: scope 守卫(与 onGateState/onVariantSelected 同法)——
      // socket room 即 project:{id}(io join 按 projectId 隔离)只挡跨项目;
      // 同项目多 episodes 共享一室,且确定性节点 id 跨 episodes 复用,他集
      // 广播会对本集图误触发级联并随下次 save 落库。scope 不匹配(含缺字段的
      // 旧形状)静默 return。
      if (!projectId || episodesId == null) return
      if (payload.projectId !== projectId || payload.episodesId !== episodesId) return
      const data = payload.node?.data as
        | { stale?: { since?: unknown; triggerAssetId?: unknown } }
        | undefined
      const stale = data?.stale
      if (stale == null || typeof stale !== 'object') return
      if (typeof stale.since !== 'number') return
      if (typeof stale.triggerAssetId !== 'string') return
      // 合法 → 复用既有级联出口(角标/脉动/StaleSection/useStaleRerun 全部零改动
      // 消费):内部即 store.markStaleDownstream 纯函数重算 + 脉动,与服务端真相
      // 幂等收敛(divergence impossible by construction)。
      triggerStaleCascade([stale.triggerAssetId])
    },
  })

  // 61-01 (DEBT-01): 资产卡片拖入 drop 处理器——placeNewAsset(anchor='source') 的
  // 唯一活调用方(D-01 sole-caller纪律)。落点 = screenToFlowPosition(拖放点) 源锚定
  // (A2 裁定注记:PLACE_GRID.source=4px 既有语义胜出,CONTEXT「8px」措辞不落地为
  // 代码改动,placeNewAsset 本体零改动)。写回走服务端广播 node:created →
  // onNewAsset → addNodeFromSocket(WRITE-03 canonical),本 handler 零 setNodes;
  // 服务端 position 即本方 position,真相优先,勿二次偏移(Anti-Pattern 3)。
  const handleAssetDrop = useCallback(async (event: React.DragEvent) => {
    // 非 asset 拖拽(如文件拖入)静默忽略——只处理本应用卡片写入的 MIME
    if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return
    event.preventDefault()
    // T-61-01/T-61-03:dataTransfer 载荷 defensively 解析(字段类型强校验)
    let payload: AssetDragPayload | null = null
    try {
      payload = JSON.parse(event.dataTransfer.getData(ASSET_DRAG_MIME)) as AssetDragPayload
    } catch {
      payload = null
    }
    if (
      payload == null || typeof payload !== 'object' ||
      typeof payload.id !== 'number' || !Number.isFinite(payload.id) ||
      typeof payload.uuid !== 'string' || typeof payload.name !== 'string'
    ) {
      showToast('拖入载荷无效', 'warning')
      return
    }
    if (!projectId || episodesId == null) {
      showToast('请先在顶栏选择项目和剧集,再拖入资产', 'warning')
      return
    }
    const flowPoint = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const position = placeNewAsset({
      sourcePosition: flowPoint,
      viewportCenter: reactFlow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }),
      anchor: 'source',
    })
    // id 约定与 handleLocateOnCanvas 的 asset-${a.id} 同源(Pitfall 8);
    // label/assetType 给非空字符串即满足 canvasAssetSchema min(1).nullish()。
    const node = {
      id: `asset-${payload.id}`,
      type: 'asset',
      branchId: 'main',
      phaseIndex: 0,
      phaseName: 'asset',
      position,
      size: { width: 240, height: 160 },
      state: 'idle',
      data: {
        label: payload.name || payload.uuid,
        assetType: payload.assetType,
        filePath: payload.filePath ?? null,
        // WR-02(review-61): 注册表主键入 data 袋——StoryboardTimeline.assetIdOf
        // (raw.assetId ?? raw.asset_id)的画布↔注册表联动与 canvasApi「filePath
        // 缺失时按 assetId 异步补全」链路对拖入节点复活;assetUuid 供跨 id 方案
        // (pipeline 形如 a-scene_refs-S01)的同资产查重。data 袋服务端为
        // z.record(z.string(), z.any()) 非 strict 透传,零契约风险。
        assetId: payload.id,
        assetUuid: payload.uuid,
      },
    }
    const result = await placeAssetNode(projectId, episodesId, node)
    if (result.ok) {
      // 成功路径零本地写:服务端广播 node:created → onNewAsset → addNodeFromSocket
      // (服务端 position 即本方 position,真相优先,勿二次偏移——Anti-Pattern 3)。
      // WR-01(review-61): socket 断线降级补写——eventReplay 未启用且 health 不吐
      // eventCount,广播不可达时节点已落库却不可见,重拖只得误导性 409。2s 有界窗口
      // 后 canonical 图仍无该节点 → 走与广播同源的 addNodeFromSocket 幂等补写
      // (先查 graph 防 double-add;同 id 重播 store 内部亦去重),不发明新写路径。
      // fix-r2(review-61): scope 守卫(与 59-fix CR-02 同法)——2s 窗口内切换
      // episodes 后 st.graph 已是他集,无守卫会把本集节点补进他集本地视图并随
      // 下次全图 save 落库(跨集数据污染);确定性 id 跨集复用,无碰撞盾。闭包
      // 捕获 drop 时 scope,触发时与 store 当前 scope 逐字段比对,不匹配静默弃。
      window.setTimeout(() => {
        const st = useCanvasStore.getState()
        if (st.projectId !== projectId || st.episodesId !== episodesId) return
        if (st.graph != null && !st.graph.nodes.some((n) => n.id === node.id)) {
          st.addNodeFromSocket(node, position)
        }
      }, 2000)
      return
    }
    if (result.status === 409) {
      showToast('该资产已在画布上', 'info')
    } else {
      showToast('放置失败: ' + result.message, 'error')
    }
  }, [projectId, episodesId, reactFlow, showToast])

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

    // Phase 54 (54-06): gate 快照并行拉取——不 await、不阻塞画布首帧;
    // 失败静默(socket gate:state 增量与 stale 触发的即时拉取会补上)。
    void fetchGateState(pid, eid)
      .then((p) => { if (p) useGateStore.getState().apply(p) })
      .catch(() => {})

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

    // 57-03 (D-05): 深链消费——loadCanvas resolve 后一次性(useRef 守卫)。
    // focus/zone → resolveDeepLinkTarget → 切画布视图 + 目标挂 pending(由下方
    // deepLinkPending effect 投放 setFocusAssetNodeId);fitView/选中/高亮/1.5s
    // 清空/未放置 toast 全走既有 focusAssetNodeId effect,不写第二套 viewport 机制。
    // zone 无节点/注册表外 → none 静默(只加载不跳,UI-SPEC State Matrix)。
    if (!deepLinkConsumedRef.current) {
      deepLinkConsumedRef.current = true
      const target = resolveDeepLinkTarget({
        focus: deepLinkRef.current.focus,
        zone: deepLinkRef.current.zone,
        nodes: useCanvasStore.getState().nodes as DeepLinkNodeLike[],
      })
      if (target.kind !== 'none') {
        setViewMode('canvas')
        setDeepLinkPending(target.nodeId)
      }
    }

    const url = new URL(window.location.href)
    url.searchParams.set('projectId', String(pid))
    url.searchParams.set('episodesId', String(eid))
    window.history.replaceState({}, '', url.toString())
  }, [setNodes, setEdges, setLoadError, setProject, loadInitialGraph, setFocusAssetNodeId, setViewMode])

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

  // 55-04:testMode 门控下把 getViewport 挂给模块级 liveViewport(getLiveViewport 桥数据源)。
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('testMode')) return
    liveViewport = getViewport
    return () => { liveViewport = null }
  }, [getViewport])

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

  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    // 事件芯片自带点击行为（P19 参数 popover 出口），不进节点详情面板
    if (node?.type === 'eventChip') return
    // REGEN-04(52-05) 修饰键守卫(地雷 #9):ctrl/⌘/shift 多选点击只选不切面板,
    // 多选语义优先——不 push 导航历史、不动 detailNode
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setSelectedNode(node)
      return
    }
    // 单击 = 选中 + 溯源高亮;面板开着 → 跟随切换到新节点(保持打开,审片不反复开合);
    // 面板关着 → 不打开(双击才打开)。detailNode 用 getState 读当前值,免闭包过期。
    if (!navSkipRef.current) navHistory.push()
    setSelectedNode(node)
    if (useCanvasStore.getState().detailNode != null) setDetailNode(node)
    // 拖拽误触:RF 内部位移抑制(onNodeClick 拖后不触发),理论安全;若实测误触,
    // 逃生口 = onNodeDragStop 里 suppress 一次 onNodeClick(此处不预设)。
  }, [navHistory, setSelectedNode, setDetailNode])

  // 双击 = 打开右详情面板（与单击解耦：单击只驱动溯源高亮 + 选中环）
  // 注意：ReactFlow 默认 zoomOnDoubleClick=true 会吞掉 dblclick 用于缩放，导致此回调不触发；
  // 已在 <ReactFlow> 上设 zoomOnDoubleClick={false} 放行。
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: any) => {
    if (node?.type === 'eventChip') return
    // 56-04 (VIZ-02):组资产双击改道开剧场(前置分支;未命中原路径零改动)
    const st = useCanvasStore.getState()
    const t = theaterTargetOf({ id: node.id, data: node.data ?? {} }, st.graph, st.rawDataByNodeId)
    if (t != null) {
      useTheaterStore.getState().open(t)
      return
    }
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
    const { graph: canonicalGraph, rawDataByNodeId } = useCanvasStore.getState()
    if (!canonicalGraph) {
      // 加载完成前瞬态 / fixture 模式无 canonical graph（地雷 #6）——toast 提示并早退
      showToast?.('画布尚未加载完成,无法保存', 'warning')
      return
    }
    setSaving(true)
    try {
      const viewport = reactFlow.getViewport()
      // WRITE-01：canonical V3 → FlowGraphV2 正向序列化器 → save-v2 统一保存通道
      const graph = serializeGraphToV2(canonicalGraph, rawDataByNodeId, viewport)
      await saveCanvasGraph(projectId, episodesId, graph)
    } catch (err: any) {
      showToast?.(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [projectId, episodesId, reactFlow, setSaving, showToast])

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
    const { graph: canonicalGraph, rawDataByNodeId } = useCanvasStore.getState()
    if (!canonicalGraph) {
      showToast('画布尚未加载完成,无法编排', 'warning')
      return
    }
    try {
      // 先保存当前画布,确保编排器读到最新数据（WRITE-01：同一 serializeGraphToV2 入口）
      const viewport = reactFlow.getViewport()
      const graph = serializeGraphToV2(canonicalGraph, rawDataByNodeId, viewport)
      await saveCanvasGraph(projectId, episodesId, graph)
      // 触发编排 (mode='full',不传 nodeIds)
      await orchestrateCanvas(projectId, episodesId)
      // 状态由 WebSocket orchestrate:start 推送后正式进入 running
    } catch (err: any) {
      showToast(err.message || '一键成片触发失败', 'error')
    }
  }, [projectId, episodesId, orchestration.status, reactFlow, showToast])

  // Phase 55-04 (NAV-03):`/` 全局快捷键打开搜索导航器。
  // 守卫(Pitfall 7):输入框/文本域/可编辑元素聚焦时不劫持;modal 开启早退。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 导航器开着时 Esc 全局可关(焦点可能在导航器外的输入框,组件内
      // onKeyDown 收不到——window 层兜底;导航器内部 Esc 会先 stopPropagation)。
      if (e.key === 'Escape' && searchNavOpen) {
        setSearchNavOpen(false)
        return
      }
      if (e.key !== '/' || searchNavOpen) return
      const t = e.target as HTMLElement | null
      if (t != null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (useVariantPickerStore.getState().open || useGateStore.getState().open) return
      e.preventDefault()
      setSearchNavOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchNavOpen])

  // Iteration Engine — 切换 panel 显隐 (诊断由 panel 内的「开始诊断」按钮触发)
  const handleIterate = useCallback(() => {
    if (iteration.status === 'idle') {
      setIterationPanelOpen(true)
    } else {
      updateIterationProgress({ panelOpen: !iteration.panelOpen })
    }
  }, [iteration.status, iteration.panelOpen, setIterationPanelOpen, updateIterationProgress])

  // 盲选会话(迭代平台 A 轨):快照当前待决组开 overlay;队列/随机序在会话
  // 打开时生成并固定。图空/无组时 overlay 自呈空态(含翻案重开入口)。
  const handleOpenBlindSelection = useCallback(() => {
    const g = useCanvasStore.getState().graph
    const groups = g
      ? buildBlindQueue(g.variantGroups).map((grp) => ({ id: grp.id, variantNodeIds: grp.variantNodeIds }))
      : []
    useBlindSelectionStore.getState().openSession(groups)
  }, [])

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

  // Phase 55-04 (NAV-03):Phase 45 隐藏式搜索过滤已整段删除(Do-Not-Regress 3
  // ——搜索期间画布节点零隐藏;搜索入口迁移至 `/` SearchNavigator 浮层,
  // 工具栏输入框保留为打开入口)。

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
      // 52-08 gap#3：未命中分流——落选变体（P12 折叠进 winner 牌堆，无 RF 实体但存在于
      // canonical graph）经任一 focus 通路（侧栏 focusShot / 深链 focus / 资产库定位）一律
      // 打开只读详情面板，而非「尚未放置」死路。Phase 53 变体墙域（VariantWall）不在此触碰。
      const loser = useCanvasStore
        .getState()
        .graph?.nodes.find(
          (n) => n.kind === 'asset' && n.id === focusAssetNodeId && n.curation === 'deprecated',
        ) as AssetNodeV3 | undefined
      if (loser) {
        // 合成节点（data.v3 直载 canonical）——不 setSelectedNode/不 fitView（无画布实体）；
        // 面板在下次 setGraph 派生重解析时自动关闭（rfNodes 无此 id，只读查阅可接受）
        setDetailNode(syntheticDetailNode(loser))
        const t = setTimeout(() => setFocusAssetNodeId(null), 0)
        return () => clearTimeout(t)
      }
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

  // 57-03 (D-05): 深链目标投放——只决定「何时」把 nodeId 交给上方既有 effect,自身
  // 不动视口。两重竞态防线(776 节点真机实测定位丢失的根因修复):
  //  ① prop 级 initial fitView(下方 fitView={!deepLinkPending && ...})在深链
  //     pending 期间禁用——它会晚于定位 fitView 发车(节点全量 measure 完才跑,
  //     大图 >3s),把定位视口覆写成全图适配;
  //  ② 投放门 = 目标节点已 measure(getInternalNode.measured.width>0)——定位
  //     fitView 对未测量节点拿到 0×0 bounds 会静默 no-op。
  // 投放后一切效果走既有 focusAssetNodeId effect 原语义(只复用不改)。
  useEffect(() => {
    if (!deepLinkPending || !rfReady) return
    let cancelled = false
    let poll: number | undefined
    let fallback: number | undefined
    const arm = () => {
      if (cancelled) return
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(fallback)
      setFocusAssetNodeId(deepLinkPending)
      setDeepLinkPending(null)
    }
    poll = window.setInterval(() => {
      if (cancelled) return
      const internal = reactFlow.getInternalNode(deepLinkPending)
      if (internal && (internal.measured?.width ?? 0) > 0) arm()
    }, 100)
    // 兜底:3s 内未测量(异常/节点被折叠)也投放——交给既有 effect 的
    // 「该资产尚未放置在画布上」toast 语义兜底。
    fallback = window.setTimeout(arm, 3000)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(fallback)
    }
  }, [deepLinkPending, rfReady, reactFlow, setFocusAssetNodeId])

  // Esc 退出溯源高亮 / 关芯片 popover（VariantPicker / EventParamsPopover 各自处理自身 Esc，
  // 有模态覆盖层时不在此连带关闭详情面板）。
  // 两段式：钉选详情面板开着 → 先关面板（保留溯源）；否则清选中退溯源。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useVariantPickerStore.getState().open || useVariantPickerStore.getState().wall || activeChip) return
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
          {/* 57-03 (D-06): 共享导航 compact 档替换 logo+「无限画布」标题块(画布身份
              由「画布」当前项承载)。Do-Not-Regress 1:48px 顶栏高度与余高布局、
              视图切换簇/导航箭头/ProjectSelector/GateTodoChip 零改动——navbar
              compact 26px 内联垂直居中,不加第二层横条。 */}
          <kap-navbar compact="" data-active="canvas" style={{ alignSelf: 'center' }} />
          <span style={{ width: 1, height: 14, background: theme.border.default }} />

          {/* 视图模式切换 */}
          <div style={{ display: 'flex', gap: 2, background: theme.bg.input, borderRadius: 7, padding: 2, border: `1px solid ${theme.border.default}` }}>
            <ViewModeButton
              active={viewMode === 'canvas'}
              onClick={() => handleSetViewMode('canvas')}
              onDragOver={(e) => {
                // 61-01 (DEBT-01 / P3 裁定):视图互斥下(资产中心与 ReactFlow 不同时
                // 挂载)拖入必经页签 dragover 切视图——卡片 dragstart 置 MIME 载荷 →
                // 拖到「画布」页签上 dragover 即切画布;Chromium 拖拽会话跨源元素卸载
                // 存活(dragend 仍发),合成事件面由 e2e 驱动,真实手感有 :10588
                // manual UAT 行兜底。直用 store setViewMode(幂等,dragover 连发无害;
                // handleSetViewMode 的 nav 快照适合点击,不适合拖拽 hover 高频路径)。
                if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
                  e.preventDefault()
                  useCanvasStore.getState().setViewMode('canvas')
                }
              }}
            >
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
            <ViewModeButton active={viewMode === 'reverse'} onClick={() => handleSetViewMode('reverse')}>
              <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><UiIcon kind="pipeline" size={13} /></span>逆向工程
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'storyboard_board'} onClick={() => handleSetViewMode('storyboard_board')}>
              <UiIcon kind="layout" size={13} />分镜板
            </ViewModeButton>
            <ViewModeButton active={viewMode === 'scene_shots'} onClick={() => handleSetViewMode('scene_shots')}>
              <UiIcon kind="film" size={13} />分镜浏览
            </ViewModeButton>
            <ToolbarButton
              onClick={() => setBranchPanelOpen((v) => !v)}
              title="分支与结局 — 多结局探索与主线切换"
            >
              <UiIcon kind="branch" size={13} />分支
            </ToolbarButton>
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
          {!fixtureMode && <GateTodoChip />}
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
        ) : viewMode === 'reverse' ? (
          <ReversePipelineView
            onRefresh={projectId && episodesId != null ? () => loadCanvas(projectId, episodesId) : undefined}
          />
        ) : viewMode === 'storyboard_board' ? (
          <StoryboardBoard />
        ) : viewMode === 'scene_shots' ? (
          <SceneShotBrowser />
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
          onInit={() => setRfReady(true)}
          onDragOver={(e) => {
            // 61-01 (DEBT-01): 资产拖入——允许 drop 并显式 copy 光标语义
            if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={handleAssetDrop}
          fitView={!deepLinkPending && hasData && !persistedViewport}
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
          {geometry && geometry.phaseColumns && (
            <PhaseColumns
              geometry={geometry}
              blockingPhaseIndex={(() => {
                if (!gateBlocking || !graph) return null
                const nodes = graph.nodes.map((n) => ({
                  id: n.id,
                  phaseName: n.phaseName,
                  phaseIndex: n.phaseIndex,
                }))
                const rep = resolveRepresentativeNodeId(gateBlocking, nodes)
                return rep != null ? (nodes.find((n) => n.id === rep)?.phaseIndex ?? null) : null
              })()}
            />
          )}
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
              onClick={() => useG15TriageStore.getState().setOpen(true)}
              title="G15 失败镜头分诊工作台"
            >
              🩹失败镜头{g15Pending > 0 ? ` ${g15Pending}` : ''}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => useGateStore.getState().setOpen(!gateOpen)}
              title="Gate 中心 — 16 道审核门状态与决策"
            >
              ⚖️Gate 中心{gatePendingCount > 0 ? ` ${gatePendingCount}` : ''}
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
            <ToolbarButton
              onClick={handleOpenBlindSelection}
              disabled={!projectId || nodes.length === 0}
              title="盲选迭代 — 蒙眼投票对照揭晓(迭代平台 A 轨)"
              style={{ minHeight: 40, minWidth: 40 }}
            >
              🔮 盲选
            </ToolbarButton>
            {/* 迭代平台 M3 金标轨(B 轨):metrics.py 确定性 gap 对金标择优 */}
            <ToolbarButton
              onClick={() => setGoldPanelOpen(true)}
              disabled={!projectId || nodes.length === 0}
              title="金标轨 — 金标准距离打分择优(迭代平台 B 轨)"
              style={{ minHeight: 40, minWidth: 40 }}
            >
              🥇 金标
            </ToolbarButton>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 9, display: 'flex', color: theme.text.tertiary, pointerEvents: 'none' }}>
                <UiIcon kind="search" size={13} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索描述 / 标签…（按 / 快速打开）"
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
                onFocus={(e) => { e.currentTarget.style.borderColor = theme.border.strong; setSearchNavOpen(true) }}
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
        <VariantWall />
        <BlindSelectionOverlay />
        {iteration.panelOpen && <IterationPanel />}
        <G15TriagePanel />
        {goldPanelOpen && <GoldPanel onClose={() => setGoldPanelOpen(false)} />}
        {gateOpen && <GateCenterPanel />}
        {branchPanelOpen && <BranchPanel onClose={() => setBranchPanelOpen(false)} />}
        <GroupViewTheater />
        <G16VoiceWorkbench />
        <SearchNavigator open={searchNavOpen} onClose={() => setSearchNavOpen(false)} initialQuery={searchQuery} />
        </>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

function ToolbarButton({ onClick, children, disabled, accent, title, style }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; accent?: boolean; title?: string; style?: React.CSSProperties }) {
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
        ...style,
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

// 61-01 (DEBT-01): onDragOver 仅「画布」页签使用(拖入切视图入口),其余按钮不传。
function ViewModeButton({ active, onClick, onDragOver, children }: {
  active: boolean
  onClick: () => void
  onDragOver?: (e: React.DragEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
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

// 55-04 (W2 方案 b):testMode 门控的 live 视口 getter——main.tsx 桥
// getViewCenter 数据源。存 getter(调用时经 reactFlow.getViewport() 取实时值);
// 生产 bundle 该门不通过,零行为、零 store 写(不触发重布)。
let liveViewport: (() => { x: number; y: number; zoom: number }) | null = null
export function getLiveViewport(): { x: number; y: number; zoom: number } | null {
  return liveViewport?.() ?? null
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
