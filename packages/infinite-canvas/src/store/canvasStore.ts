import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react'
import {
  selectVariant,
  markStaleDownstream,
  type FlowGraphV3,
  type FlowLinkV3,
  type VariantGroupV3,
  type ReviewStatus as ReviewStatusV3,
  type AssetNodeV3,
  type NodeState,
} from '@kais/flowgraph-v3'
import type { SkillNodeTypeDecl, IterationPlan, IterationResult } from '../services/canvasApi'
import type { FlowBranch, VariantGroup, VariantGroupId } from '../types/canvas'
import { asNodeId, asVariantGroupId } from '../types/canvas'
import { approveNode as apiApproveNode, rejectNode as apiRejectNode, selectVariantWinner, saveCanvasGraph } from '../services/canvasApi'
import { serializeGraphToV2 } from '../v3/serialize'
import {
  applyWinnerSelection,
  rollbackWinnerSelection,
  syncWinnerToGroups,
} from './variantOps'
import { adaptV2Graph, getViewModel, type PhaseCatalogEntry } from '../v3/adapter'
import {
  resolveInitialGraph,
  loadFixtureGraph,
  BACKEND_FALLBACK_MESSAGE,
  type FixtureMode,
} from '../v3/fixtureSource'

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
}

/** 视图模式（画布 / 时间轴 / 资产 / 管线状态机 / 分镜板）。 */
export type ViewMode = 'canvas' | 'timeline' | 'assets' | 'pipeline' | 'storyboard_board'

interface CanvasState {
  // ─── V3 canonical（SPEC-step5 A.4：canonical = FlowGraphV3） ───
  /** 唯一数据源。RF nodes/edges 是它的 memo 化派生（getViewModel），不是独立真相。 */
  graph: FlowGraphV3 | null
  /** 适配层产出的消费端宽松警告（P22：emit warning，不 crash）。 */
  warnings: string[]
  /**
   * 每节点原始 data 袋（穿透 migrate 白名单外字段）：key = 节点 id。
   * 卡片 KeyFields / 详情面板 RawDataSection 消费。fixture 直通 / graph 为空时为 null。
   */
  rawDataByNodeId: Map<string, Record<string, unknown>> | null
  /** 创作阶段目录（P01–P13，来自 zone 节点 + 资产 phaseIndex）；竖向阶段叠加层消费。 */
  phaseCatalog: PhaseCatalogEntry[] | null
  /** 设置 canonical graph 并重建派生 RF 模型（nodes/edges/variantGroups/branches 同步）。 */
  setGraph: (graph: FlowGraphV3 | null, warnings?: string[]) => void
  /** 纯函数变换接缝（B/C/D 专用）：fn 必须是 V3 纯函数（selectVariant/markStaleDownstream/自写映射）。 */
  applyGraphTransform: (fn: (graph: FlowGraphV3) => FlowGraphV3) => void
  /** P13 脏传播入口（C 接线：审核通过/human_edit/变体切换/socket node:updated 触发）。 */
  markStaleDownstream: (changedAssetIds: string[]) => void
  /** 后端 V2 payload → 适配 → 设为 canonical（socket graph:saved / 初次加载的接缝）。 */
  loadGraphFromV2: (raw: unknown) => void
  /** fixture 模式（?fixture=decompose|valid，绕过 socket/REST）。 */
  loadGraphFromFixture: (mode: FixtureMode) => void
  /**
   * 初始加载决策树（fixtureSource.resolveInitialGraph）：
   * ?fixture → fixture；否则 loadBackend() → 适配；失败 → 自动 fallback decompose + toast。
   */
  loadInitialGraph: (loadBackend?: () => Promise<unknown>) => Promise<void>

  // P17：viewport 是数据（canonical 存 graph.meta.viewport，此处为运行时镜像）
  viewport: { x: number; y: number; zoom: number } | null
  setViewport: (viewport: { x: number; y: number; zoom: number } | null) => void

  // 项目上下文
  projectId: number | null
  episodesId: number | null
  setProject: (pid: number, eid: number) => void

  // 当前激活技能 ID（Phase 32 — 由项目数据驱动；缺省 movie-v1）
  activeSkillId: string
  setActiveSkillId: (skillId: string) => void

  // 当前激活技能声明的节点类型（Phase 32 CANVAS-01 — 从注册表拉取）
  declaredNodeTypes: SkillNodeTypeDecl[]
  setDeclaredNodeTypes: (decls: SkillNodeTypeDecl[]) => void

  // 画布节点/边 —— graph 存在时是 graphToViewModel 的派生缓存；graph 为空时走旧的可变 RF 状态。
  // 注意：graph 存在时 setNodes/onNodesChange 只改派生缓存（视图层 ephemeral，如 socket
  // node:state 的 progress），不回写 canonical；业务变换一律走 applyGraphTransform。
  nodes: Node[]
  edges: Edge[]
  setNodes: (nodesOrUpdater: Node[] | ((prev: Node[]) => Node[])) => void
  setEdges: (edgesOrUpdater: Edge[] | ((prev: Edge[]) => Edge[])) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void

  // 分支
  branches: FlowBranch[]
  setBranches: (branches: FlowBranch[]) => void
  addBranch: (branch: FlowBranch) => void
  updateBranch: (branchId: string, updates: Partial<FlowBranch>) => void

  // 变体组 —— @deprecated 旧前端 {groupId,parentNodeId} 模型（orchestrator 裁定废弃）；
  // graph 存在时由 V3 VariantGroupV3 派生 shim 填充，仅供旧组件过渡消费。
  variantGroups: VariantGroup[]
  setVariantGroups: (groups: VariantGroup[]) => void
  upsertVariantGroup: (group: VariantGroup) => void

  // 加载状态
  loading: boolean
  setLoading: (l: boolean) => void
  loadError: string | null
  setLoadError: (err: string | null) => void
  hasData: boolean
  setHasData: (v: boolean) => void
  saving: boolean
  setSaving: (v: boolean) => void

  // UI
  selectedNode: Node | null
  setSelectedNode: (node: Node | null) => void
  /** 详情面板「钉选」节点：仅双击设置（左树/卡片），与 selectedNode 解耦——
   *  单击只 setSelectedNode（驱动溯源高亮 + RF 选中环），不开右面板；
   *  双击才 setDetailNode 让 NodeDetailPanel 出现。 */
  detailNode: Node | null
  setDetailNode: (node: Node | null) => void
  menuPos: { x: number; y: number; nodeId?: string } | null
  setMenuPos: (pos: { x: number; y: number; nodeId?: string } | null) => void
  // Phase 37 — 多选节点 ID (用于批量执行)
  selectedNodeIds: string[]
  setSelectedNodeIds: (ids: string[]) => void

  // ─── WRITE-03 canonical 回写 action（Phase 51-02）───
  // MetaEditor / socket node:state / node:preview 的写入方全部经 applyGraphTransform
  // 写 store.graph，派生 RF 缓存只由 graphToViewModel 重建、永不反向覆盖。
  /** MetaRenderer 专用：对目标资产节点 asset.meta 做字段级 patch（空值 undefined/null/'' = 删字段）。 */
  updateAssetMeta: (nodeId: string, patch: Record<string, unknown>) => void
  /** socket node:state：归一后落 canonical 节点 state；progress 保持派生缓存 ephemeral。 */
  applySocketNodeState: (nodeId: string, state: string, progress?: number) => void
  /** socket node:preview：thumbnailUrl 写 asset.media.thumbnail。 */
  applySocketNodePreview: (nodeId: string, thumbnailUrl: string) => void

  // 审核操作
  approveNode: (nodeId: string) => Promise<void>
  rejectNode: (nodeId: string, feedback?: string) => Promise<void>
  /** WRITE-02：删除节点 —— canonical 图变换（节点 + 触及 links + variantGroups 清理）
   *  → save-v2 统一持久化（不新增 delete 端点），失败外科式回滚（被删实体插回当前图）+ error toast。 */
  deleteNode: (nodeId: string) => Promise<void>
  /** 选定变体组优胜（Phase 49 SELECT-02：乐观更新 → POST select-winner → 失败回滚）。 */
  selectWinner: (nodeId: string) => Promise<void>

  // 分支操作
  selectBranchAsMain: (branchId: string) => void
  archiveBranch: (branchId: string) => void

  // Toast
  toasts: ToastItem[]
  showToast: (message: string, type?: ToastItem['type']) => void
  dismissToast: (id: number) => void

  // Phase 36 — 一键成片 / Phase 37 批量执行
  orchestration: OrchestrationState
  startOrchestration: (runId: string, total: number, mode: 'full' | 'batch') => void
  updateOrchestrationProgress: (p: Partial<OrchestrationState>) => void
  finishOrchestration: (result: { completed: number; total: number; failed: number; failedNodes: string[]; mode: 'full' | 'batch' }) => void
  resetOrchestration: () => void

  // 视图模式 — 'canvas' = ReactFlow 画布, 'timeline' = 分镜时间轴,
  // 'assets' = 全局资产管理中心, 'pipeline' = 管线状态机 (BlueOcean 风格)
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // 【资产↔画布交叉联动】需在画布中定位 + 高亮的节点 ID（由资产库卡片「定位」按钮设置）。
  // FlowCanvas useEffect 监听：非 null 时 fitView + setSelectedNode + traceState 高亮闪烁，
  // 1.5s 后清空。画布未命中（资产未放置）时由画布侧 toast 提示。
  focusAssetNodeId: string | null
  setFocusAssetNodeId: (id: string | null) => void

  // 资产管理子视图 + 选中资产（assets 视图内部状态；详情由 Library 卡片点击驱动）
  // 5 Tab：library 资产库 · character 角色 · scene_shot 场景与分镜 · dialogue 对白 · documents 创作文档(Notion)
  assetView: 'library' | 'detail' | 'character' | 'scene_shot' | 'dialogue' | 'documents'
  setAssetView: (view: 'library' | 'detail' | 'character' | 'scene_shot' | 'dialogue' | 'documents') => void
  selectedAssetUuid: string | null
  setSelectedAssetUuid: (uuid: string | null) => void
  /** 打开某资产的详情（同时设选中 + 切到 detail 子视图） */
  openAssetDetail: (uuid: string) => void
  closeAssetDetail: () => void

  // 应用级导航历史注入点：FlowCanvas 挂载时把 navHistory.push 注入，
  // 子组件（AssetManager/AssetLibrary）经 store 调用，让它们的导航交互也进历史栈。
  navPushCallback: (() => void) | null
  setNavPushCallback: (fn: (() => void) | null) => void

  // Iteration Engine — diagnose / plan / execute / confirm
  iteration: IterationState
  setIterationPlan: (plan: IterationPlan) => void
  updateIterationProgress: (p: Partial<IterationState>) => void
  setIterationError: (err: string | null) => void
  setAdjustmentApproved: (approved: boolean) => void
  setIterationPanelOpen: (open: boolean) => void
  pushIterationHistory: (plan: IterationPlan) => void
  setIterationHistory: (plans: IterationPlan[]) => void
  resetIteration: () => void

}

export interface OrchestrationState {
  status: 'idle' | 'running' | 'done' | 'error'
  runId: string | null
  mode: 'full' | 'batch'
  completed: number
  total: number
  failed: number
  currentNodeId: string | null
  failedNodes: string[]
}

const INITIAL_ORCHESTRATION: OrchestrationState = {
  status: 'idle',
  runId: null,
  mode: 'full',
  completed: 0,
  total: 0,
  failed: 0,
  currentNodeId: null,
  failedNodes: [],
}

// ─── Iteration State ───────────────────────────────────────
//
// Mirrors the orchestration shape: idle → planning → plan_ready → executing
// → done/error. `history` accumulates plans for the NodeDetailPanel iteration
// tab (filtered by nodeId there). `adjustmentApproved` gates the execute
// button when diagnosis.type === 'pipeline_adjust'.

export interface IterationState {
  status: 'idle' | 'planning' | 'plan_ready' | 'executing' | 'done' | 'error'
  plan: IterationPlan | null
  result: IterationResult | null
  error: string | null
  adjustmentApproved: boolean
  panelOpen: boolean
  history: IterationPlan[]
}

const INITIAL_ITERATION: IterationState = {
  status: 'idle',
  plan: null,
  result: null,
  error: null,
  adjustmentApproved: false,
  panelOpen: false,
  history: [],
}

let nextToastId = 0
const AUTO_DISMISS_MS = 3000
const timers = new Map<number, ReturnType<typeof setTimeout>>()

// ─── V3 → 旧组件 shim（@deprecated，过渡期保留签名；新代码一律消费 graph） ───

function toLegacyVariantGroups(groups: VariantGroupV3[]): VariantGroup[] {
  return groups.map((g) => ({
    groupId: asVariantGroupId(g.id),
    // V3 无 parentNodeId（组 = 事件的多输出）；用 winner/首成员占位仅供旧 UI 展示
    parentNodeId: asNodeId(g.winnerNodeId ?? g.variantNodeIds[0] ?? g.sourceEventId),
    variantNodeIds: g.variantNodeIds.map(asNodeId),
    ...(g.winnerNodeId ? { winnerNodeId: asNodeId(g.winnerNodeId) } : {}),
    createdAt: new Date(0).toISOString(),
  }))
}

function toLegacyBranches(branches: FlowGraphV3['branches']): FlowBranch[] {
  return branches.map((b) => ({
    id: b.id,
    label: b.name,
    parentId: b.parentBranchId ?? null,
    parentNodeId: null,
    status: 'active',
    forkReason: '',
    createdAt: b.createdAt != null ? new Date(b.createdAt).toISOString() : '',
    updatedAt: b.createdAt != null ? new Date(b.createdAt).toISOString() : '',
  }))
}

/** 审核状态纯函数变换（graph 路径；找不到该资产返回原图）。 */
function withReviewStatus(graph: FlowGraphV3, nodeId: string, rs: ReviewStatusV3): FlowGraphV3 {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId && n.kind === 'asset' ? { ...n, reviewStatus: rs } : n,
    ),
  }
}

function graphReviewStatusOf(graph: FlowGraphV3, nodeId: string): ReviewStatusV3 | undefined {
  const n = graph.nodes.find((x) => x.id === nodeId)
  return n && n.kind === 'asset' ? n.reviewStatus : undefined
}

/** deleteNode 外科式回滚快照：只拍被删除的实体 + 原位索引，不拍整图。 */
interface DeleteSnapshot {
  node: FlowGraphV3['nodes'][number]
  nodeIdx: number
  touchedLinks: Array<{ link: FlowLinkV3; idx: number }>
  touchedGroups: Array<{ group: VariantGroupV3; idx: number }>
}

/**
 * 外科式回滚（W1）：把 deleteNode 移除的节点/links/组成员资格插回**当前** graph，
 * 保留 await 期间落入的并发 canonical 写入（socket state/preview、updateAssetMeta、
 * variant:selected）——approveNode/rejectNode 的 field-level restore 同款语义。
 * 守卫：期间同名 id 重现 / link 端点已消失 / 组被并发改写时，以当前图为准不覆盖。
 */
function reinsertDeleted(graph: FlowGraphV3, snap: DeleteSnapshot): FlowGraphV3 {
  // 节点：期间若同 id 节点已重现（并发创建），以当前为准
  let nodes = graph.nodes
  if (!nodes.some((n) => n.id === snap.node.id)) {
    nodes = nodes.slice()
    nodes.splice(Math.min(snap.nodeIdx, nodes.length), 0, snap.node)
  }
  const nodeIds = new Set(nodes.map((n) => n.id))

  // links：id 未重现且两端点在当前图中存活才插回（期间可能有其他删除）
  let links = graph.links
  for (const { link, idx } of snap.touchedLinks) {
    if (links.some((l) => l.id === link.id)) continue
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) continue
    links = links.slice()
    links.splice(Math.min(idx, links.length), 0, link)
  }

  // variantGroups：组仍在 → 补回成员/winner；组因清空被删 → 按存活成员重建插回
  let variantGroups = graph.variantGroups
  for (const { group, idx } of snap.touchedGroups) {
    const curIdx = variantGroups.findIndex((g) => g.id === group.id)
    if (curIdx !== -1) {
      const cur = variantGroups[curIdx]
      const needMember = !cur.variantNodeIds.includes(snap.node.id)
      // winner 还原：原 winner 是被删节点且当前无 winner 才补回；
      // 期间若有新的 winner 选定（并发 variant:selected），以当前为准
      const restoreWinner = group.winnerNodeId === snap.node.id && cur.winnerNodeId === undefined
      if (needMember || restoreWinner) {
        const next: VariantGroupV3 = {
          ...cur,
          variantNodeIds: needMember ? [...cur.variantNodeIds, snap.node.id] : cur.variantNodeIds,
        }
        if (restoreWinner) next.winnerNodeId = snap.node.id
        variantGroups = variantGroups.slice()
        variantGroups[curIdx] = next
      }
    } else {
      const alive = group.variantNodeIds.filter((id) => nodeIds.has(id))
      if (alive.length === 0) continue
      const next: VariantGroupV3 = { ...group, variantNodeIds: alive }
      if (next.winnerNodeId && !alive.includes(next.winnerNodeId)) delete next.winnerNodeId
      variantGroups = variantGroups.slice()
      variantGroups.splice(Math.min(idx, variantGroups.length), 0, next)
    }
  }
  return { ...graph, nodes, links, variantGroups }
}

// ─── WRITE-03 canonical 回写（Phase 51-02） ───

/**
 * 各 stage 的 meta 可 patch 字段白名单——对齐 flowgraph-v3 zod strict 判别联合
 *（assetStageMetaSchema 各分支 shape，去掉 stage 判别字段本身）。
 * 非法 key 忽略 + console.warn（不 throw），保证写出的 meta 仍是合法联合成员。
 */
const META_PATCHABLE_KEYS: Record<string, ReadonlySet<string>> = {
  script: new Set(['hookType', 'hookIntensity', 'premise', 'emotion']),
  storyboard: new Set(['shotId', 'shotType', 'cameraMovement', 'framing', 'composition', 'pacing', 'durationS', 'promptMeta']),
  keyframe: new Set(['shotId']),
  video: new Set(['shotId', 'observedEndState', 'murchGrade']),
  voice: new Set(['shotId', 'emotion', 'speaker']),
  foley: new Set(['shotId', 'emotion', 'speaker']),
  bgm: new Set(['shotId', 'emotion', 'speaker']),
  global: new Set(['assetType', 'archetype', 'viewAngle']),
  mix: new Set(),
  composite: new Set(['edlRef']),
}

/** socket node:state 归一表——与 v3/adapter.ts normalizeNodeState 同一张表。 */
function normalizeSocketNodeState(v: string): NodeState | null {
  switch (v) {
    case 'pending':
    case 'running':
    case 'success':
    case 'failed':
      return v
    case 'error':
    case 'skipped':
      return 'failed'
    case 'cached':
      return 'success'
    case 'idle':
      return 'pending'
    default:
      return null
  }
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // ─── V3 canonical ───
  graph: null,
  warnings: [],
  rawDataByNodeId: null,
  phaseCatalog: null,
  setGraph: (graph, warnings) => {
    if (!graph) {
      set({ graph: null, warnings: warnings ?? [], nodes: [], edges: [], viewport: null, rawDataByNodeId: null, phaseCatalog: null })
      return
    }
    // memo 化派生：同一 graph 引用 → 同一 RF 模型引用（组件 memo 有效）
    const vm = getViewModel(graph)
    set((state) => ({
      graph,
      warnings: warnings ?? state.warnings,
      nodes: vm.rfNodes,
      edges: vm.rfEdges,
      variantGroups: toLegacyVariantGroups(graph.variantGroups),
      // graph.branches 为空时保留 REST 路径已填充的分支（V3 分支是有损 shim）
      branches: graph.branches.length > 0 ? toLegacyBranches(graph.branches) : state.branches,
      viewport: graph.meta.viewport ?? state.viewport,
      hasData: true,
      // 选中节点 / 钉选详情节点随派生模型刷新（保持引用与 nodes 一致）
      selectedNode: state.selectedNode
        ? vm.rfNodes.find((n) => n.id === state.selectedNode!.id) ?? null
        : null,
      detailNode: state.detailNode
        ? vm.rfNodes.find((n) => n.id === state.detailNode!.id) ?? null
        : null,
    }))
  },
  applyGraphTransform: (fn) => {
    const { graph, warnings } = get()
    if (!graph) return
    get().setGraph(fn(graph), warnings)
  },
  markStaleDownstream: (changedAssetIds) => {
    const { graph } = get()
    if (!graph || changedAssetIds.length === 0) return
    get().applyGraphTransform((g) => markStaleDownstream(g, changedAssetIds, Date.now()))
  },
  loadGraphFromV2: (raw) => {
    const { graph, warnings, source, rawDataByNodeId, phaseCatalog } = adaptV2Graph(raw)
    set({ rawDataByNodeId, phaseCatalog })
    get().setGraph(graph, warnings)
    if (warnings.length > 0) {
      get().showToast(
        `图适配完成（${source === 'v3-passthrough' ? 'V3 直通' : 'V2→V3 迁移'}），${warnings.length} 条警告`,
        'info',
      )
    }
  },
  loadGraphFromFixture: (mode) => {
    const loaded = loadFixtureGraph(mode)
    set({ rawDataByNodeId: loaded.rawDataByNodeId, phaseCatalog: loaded.phaseCatalog })
    get().setGraph(loaded.graph, loaded.warnings)
    get().showToast(`已加载 fixture: ${mode}（${loaded.graph.nodes.length} 节点）`, 'info')
  },
  loadInitialGraph: async (loadBackend) => {
    const { setLoading, setLoadError, showToast } = get()
    setLoading(true)
    try {
      const loaded = await resolveInitialGraph({ loadBackend })
      set({ rawDataByNodeId: loaded.rawDataByNodeId, phaseCatalog: loaded.phaseCatalog })
      get().setGraph(loaded.graph, loaded.warnings)
      if (loaded.fallbackUsed) {
        showToast(BACKEND_FALLBACK_MESSAGE, 'warning')
      } else if (loaded.warnings.length > 0) {
        showToast(`图加载完成，${loaded.warnings.length} 条适配警告`, 'info')
      }
      setLoadError(null)
    } finally {
      setLoading(false)
    }
  },

  // P17
  viewport: null,
  setViewport: (viewport) => {
    set((state) => ({
      viewport,
      // viewport 是 canonical 的一部分（P17），随 graph 持久化
      graph: state.graph && viewport
        ? { ...state.graph, meta: { ...state.graph.meta, viewport } }
        : state.graph,
    }))
  },

  // 项目
  projectId: null,
  episodesId: null,
  setProject: (pid, eid) => set({ projectId: pid, episodesId: eid }),

  // 激活技能（Phase 32）
  activeSkillId: 'movie-v1',
  setActiveSkillId: (skillId) => set({ activeSkillId: skillId }),

  // 声明的节点类型（Phase 32 — 注册表元数据，仅用于 UI 显示，
  // 不参与渲染器选择；渲染器映射保持为平台原语）
  declaredNodeTypes: [],
  setDeclaredNodeTypes: (decls) => set({ declaredNodeTypes: decls }),

  // 节点/边
  nodes: [],
  edges: [],
  setNodes: (nodesOrUpdater) => {
    set((state) => ({
      nodes: typeof nodesOrUpdater === 'function'
        ? (nodesOrUpdater as (prev: Node[]) => Node[])(state.nodes)
        : nodesOrUpdater,
    }))
  },
  setEdges: (edgesOrUpdater) => {
    set((state) => ({
      edges: typeof edgesOrUpdater === 'function'
        ? (edgesOrUpdater as (prev: Edge[]) => Edge[])(state.edges)
        : edgesOrUpdater,
    }))
  },
  onNodesChange: (changes) => {
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }))
  },
  onEdgesChange: (changes) => {
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }))
  },

  // 分支
  branches: [],
  setBranches: (branches) => set({ branches }),
  addBranch: (branch) => set((state) => ({ branches: [...state.branches, branch] })),
  updateBranch: (branchId, updates) => set((state) => ({
    branches: state.branches.map((b) => b.id === branchId ? { ...b, ...updates } : b),
  })),

  // 变体组 (持久化层 — @deprecated shim，见字段注释)
  variantGroups: [],
  setVariantGroups: (groups) => set({ variantGroups: groups }),
  upsertVariantGroup: (group) => set((state) => {
    const idx = state.variantGroups.findIndex((g) => g.groupId === group.groupId)
    if (idx === -1) return { variantGroups: [...state.variantGroups, group] }
    const next = state.variantGroups.slice()
    next[idx] = group
    return { variantGroups: next }
  }),

  // 加载
  loading: false,
  setLoading: (l) => set({ loading: l }),
  loadError: null,
  setLoadError: (err) => set({ loadError: err }),
  hasData: false,
  setHasData: (v) => set({ hasData: v }),
  saving: false,
  setSaving: (v) => set({ saving: v }),

  // UI
  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),
  detailNode: null,
  setDetailNode: (node) => set({ detailNode: node }),
  menuPos: null,
  setMenuPos: (pos) => set({ menuPos: pos }),
  // Phase 37 — 多选
  selectedNodeIds: [],
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

  // ─── WRITE-03 canonical 回写 action（Phase 51-02）───
  // graph === null 或节点不存在时静默早退（console.warn，不 throw）——
  // socket 事件可能在图加载完成前到达。
  updateAssetMeta: (nodeId, patch) => {
    const { graph } = get()
    if (!graph) {
      console.warn(`[canvasStore] updateAssetMeta: graph 为空，忽略 ${nodeId}`)
      return
    }
    const target = graph.nodes.find((n) => n.id === nodeId)
    if (!target || target.kind !== 'asset') {
      console.warn(`[canvasStore] updateAssetMeta: 资产节点 ${nodeId} 不存在，忽略`)
      return
    }
    get().applyGraphTransform((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'asset') return n
        const allowed = META_PATCHABLE_KEYS[n.meta.stage] ?? new Set<string>()
        const meta: Record<string, unknown> = { ...n.meta }
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'stage' || !allowed.has(key)) {
            console.warn(`[canvasStore] updateAssetMeta: 非法 meta key "${key}"（stage=${n.meta.stage}），忽略`)
            continue
          }
          // 空值 = 删除字段（「未设置」清空语义）
          if (value === undefined || value === null || value === '') delete meta[key]
          else meta[key] = value
        }
        return { ...n, meta: meta as AssetNodeV3['meta'] }
      }),
    }))
  },
  applySocketNodeState: (nodeId, state, progress) => {
    // progress：V3 strict 判别联合无 progress 槽位，瞬态运行时量不持久化——
    // 保持派生缓存 ephemeral 通道（下一次 transform 重建时自然丢弃），不塞 meta。
    // 注意必须在 canonical transform 之后写：setGraph 会重建派生缓存，先写会被冲掉。
    const applyProgressEphemeral = () => {
      if (progress == null) return
      get().setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, progress } } : n)),
      )
    }
    const { graph } = get()
    if (!graph) {
      console.warn(`[canvasStore] applySocketNodeState: graph 为空，忽略 ${nodeId} state=${state}`)
      applyProgressEphemeral()
      return
    }
    if (!graph.nodes.some((n) => n.id === nodeId)) {
      console.warn(`[canvasStore] applySocketNodeState: 节点 ${nodeId} 不存在，忽略`)
      applyProgressEphemeral()
      return
    }
    const normalized = normalizeSocketNodeState(state)
    if (normalized == null) {
      console.warn(`[canvasStore] applySocketNodeState: 未知 state "${state}"（${nodeId}），忽略`)
      applyProgressEphemeral()
      return
    }
    get().applyGraphTransform((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, state: normalized } : n)),
    }))
    applyProgressEphemeral()
  },
  applySocketNodePreview: (nodeId, thumbnailUrl) => {
    const { graph } = get()
    if (!graph) {
      console.warn(`[canvasStore] applySocketNodePreview: graph 为空，忽略 ${nodeId}`)
      return
    }
    const target = graph.nodes.find((n) => n.id === nodeId)
    if (!target || target.kind !== 'asset') {
      console.warn(`[canvasStore] applySocketNodePreview: 资产节点 ${nodeId} 不存在，忽略`)
      return
    }
    get().applyGraphTransform((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === nodeId && n.kind === 'asset'
          ? { ...n, media: { ...n.media, thumbnail: thumbnailUrl } }
          : n,
      ),
    }))
  },

  // 审核 — 乐观更新 + API 调用 + 失败回滚。
  // canonical 路径：graph 上纯函数变换（reviewStatus 落 V3 资产节点）→ setGraph 重建派生；
  // 旧路径（graph 为空）：维持 nodes 数组直改。
  approveNode: async (nodeId) => {
    const { projectId, episodesId, graph, nodes, showToast } = get()
    if (!projectId || !episodesId) return

    if (graph) {
      const prev = graphReviewStatusOf(graph, nodeId)
      get().setGraph(withReviewStatus(graph, nodeId, 'approved'))
      try {
        await apiApproveNode(projectId, episodesId, nodeId)
        showToast(`审核通过: ${nodeId}`, 'success')
      } catch (err) {
        const cur = get().graph
        if (cur) get().setGraph(withReviewStatus(cur, nodeId, prev ?? 'pending'))
        showToast(`审核失败: ${(err as Error).message}`, 'error')
      }
      return
    }

    // 旧路径
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
      ),
    }))
    try {
      await apiApproveNode(projectId, episodesId, nodeId)
      showToast(`审核通过: ${nodeId}`, 'success')
    } catch (err) {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'pending' } } : n
        ),
      }))
      showToast(`审核失败: ${(err as Error).message}`, 'error')
    }
  },
  rejectNode: async (nodeId, feedback) => {
    const { projectId, episodesId, graph, nodes, showToast } = get()
    if (!projectId || !episodesId) return

    if (graph) {
      const prev = graphReviewStatusOf(graph, nodeId)
      get().setGraph(withReviewStatus(graph, nodeId, 'rejected'))
      try {
        await apiRejectNode(projectId, episodesId, nodeId, feedback ?? '')
        showToast(`已驳回: ${nodeId}`, 'warning')
      } catch (err) {
        const cur = get().graph
        if (cur) get().setGraph(withReviewStatus(cur, nodeId, prev ?? 'pending'))
        showToast(`驳回失败: ${(err as Error).message}`, 'error')
      }
      return
    }

    // 旧路径
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
      ),
    }))
    try {
      await apiRejectNode(projectId, episodesId, nodeId, feedback ?? '')
      showToast(`已驳回: ${nodeId}`, 'warning')
    } catch (err) {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'pending' } } : n
        ),
      }))
      showToast(`驳回失败: ${(err as Error).message}`, 'error')
    }
  },
  // 删除 —— approveNode 同款范式：快照被删实体 → canonical 变换乐观上屏 →
  // save-v2 统一持久化 → 失败外科式回滚（reinsertDeleted 插回当前图）+ error toast。
  // 图变换含三道清理（T-51-03-03）：触及该节点的 links；节点是组 winner 清
  // winnerNodeId；组成员清空则删整组（不残留悬空引用/空组）。
  // W1（51-REVIEW）：回滚必须针对当时的 CURRENT graph 做插回，不得整图还原
  // prevGraph——否则 await 期间落入的并发 canonical 写入（socket state/preview、
  // updateAssetMeta、variant:selected）会被静默抹掉。
  deleteNode: async (nodeId) => {
    const { projectId, episodesId, graph, rawDataByNodeId, showToast } = get()
    if (!graph || !graph.nodes.some((n) => n.id === nodeId)) return
    if (!projectId || !episodesId) {
      showToast('缺少项目上下文', 'warning')
      return
    }

    // 外科式回滚快照：只拍被删除的实体 + 原位索引（不拍整图）
    const nodeIdx = graph.nodes.findIndex((n) => n.id === nodeId)
    const snapshot: DeleteSnapshot = {
      node: graph.nodes[nodeIdx],
      nodeIdx,
      touchedLinks: graph.links
        .map((l, idx) => ({ link: l, idx }))
        .filter(({ link }) => link.source === nodeId || link.target === nodeId),
      touchedGroups: graph.variantGroups
        .map((g, idx) => ({ group: g, idx }))
        .filter(({ group }) => group.variantNodeIds.includes(nodeId) || group.winnerNodeId === nodeId),
    }

    get().applyGraphTransform((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => n.id !== nodeId),
      links: g.links.filter((l) => l.source !== nodeId && l.target !== nodeId),
      variantGroups: g.variantGroups
        .map((grp) => {
          const next = {
            ...grp,
            variantNodeIds: grp.variantNodeIds.filter((id) => id !== nodeId),
          }
          if (next.winnerNodeId === nodeId) delete next.winnerNodeId
          return next
        })
        .filter((grp) => grp.variantNodeIds.length > 0),
    }))

    try {
      const cur = get().graph
      if (!cur) throw new Error('canonical graph 已清空，无法保存')
      await saveCanvasGraph(projectId, episodesId, serializeGraphToV2(cur, rawDataByNodeId))
      showToast(`已删除节点: ${nodeId}`, 'success')
    } catch (err) {
      const cur = get().graph
      if (cur) {
        // 外科式回滚：把被删实体插回当前图，保留 await 期间的并发写入
        get().applyGraphTransform((g) => reinsertDeleted(g, snapshot))
      } else {
        // 兜底：graph 在 await 期间被整体清空，只能整图还原
        get().setGraph(graph, get().warnings)
      }
      showToast(`删除失败已回滚: ${(err as Error).message}`, 'error')
    }
  },
  selectWinner: async (nodeId) => {
    const { projectId, episodesId, graph, nodes, edges, variantGroups, setNodes, setEdges, upsertVariantGroup, showToast } = get()
    // Phase 49 (D-04)：选定即时持久化 —— 无项目上下文时无法落库，早退不给"假成功"
    if (!projectId || !episodesId) {
      showToast('缺少项目上下文', 'warning')
      return
    }

    // canonical 路径：包内 selectVariant 纯函数（P12：winner 选定 + 下游边置灰 + 组 winner 持久化）
    if (graph) {
      const node = graph.nodes.find((n) => n.id === nodeId)
      const groupId = node && node.kind === 'asset' ? node.variantGroupId : undefined
      const group = groupId ? graph.variantGroups.find((g) => g.id === groupId) : undefined
      if (group) {
        // 拍下 prev 引用：selectVariant 内部 clone，prev 不被改动，可零成本回滚
        const prevGraph = graph
        let next: FlowGraphV3
        try {
          // 包内校验（非 single 组 / 悬空 winner / curation:'locked' 成员）同步 throw
          // → 发生在任何 await 之前：不部分应用、不调 API
          next = selectVariant(graph, group.id, nodeId)
        } catch (err) {
          showToast(`选定失败: ${(err as Error).message}`, 'error')
          return
        }
        get().setGraph(next, get().warnings)
        // Phase 49 (D-04)：乐观更新已上屏，追加 49-01 端点持久化；失败回滚 prevGraph，
        // UI 不呈现"已换选但库里没写"的假象（SC-2）
        try {
          await selectVariantWinner(projectId, episodesId, group.id, nodeId)
          showToast(`已选为优胜: ${nodeId}`, 'success')
        } catch (err) {
          get().setGraph(prevGraph, get().warnings)
          showToast(`选定失败已回滚: ${(err as Error).message}`, 'error')
        }
        return
      }
      // graph 存在但该资产不在任何 V3 组里 → 落到旧路径会找不到组，直接提示
      showToast('该节点不属于变体组', 'warning')
      return
    }

    // 旧路径（graph 为空时的可变 RF 状态，保持 Phase 35 行为）
    const node = nodes.find((n) => n.id === nodeId)
    const rawGroupId = node?.data?.variantGroupId as string | undefined
    if (!rawGroupId) {
      showToast('该节点不属于变体组', 'warning')
      return
    }
    const variantGroupId = asVariantGroupId(rawGroupId)

    // 1) 纯函数计算下一状态 + 同时拍下 prev snapshot 用于失败回滚
    const outcome = applyWinnerSelection({
      nodes, edges, variantGroupId, winnerNodeId: nodeId,
    })

    // 2) 乐观更新 store
    set({ nodes: outcome.nextNodes })
    setEdges(outcome.nextEdges)

    // 3) 同步更新 (或新建) VariantGroup.winnerNodeId（WR-05：syncWinnerToGroups
    //    返回的是**整个组数组**，必须按 groupId 定位目标组——旧代码取 [0] 拿到的
    //    是 groups[0]，目标组不在首位时 winnerNodeId 被静默丢弃）
    const existingGroup = variantGroups.find((g) => g.groupId === variantGroupId)
    const prevGroups = variantGroups // WR-06：乐观写组前拍快照，失败回滚时连同恢复
    if (existingGroup) {
      const updated = syncWinnerToGroups(variantGroups, variantGroupId, nodeId)
        .find((g) => g.groupId === variantGroupId)
      if (updated) upsertVariantGroup(updated)
    }

    // 4) Phase 49 (D-04)：即时持久化到 select-winner 端点；失败回滚 prevSnapshot
    try {
      await selectVariantWinner(projectId, episodesId, variantGroupId, nodeId)
      showToast(`已选为优胜: ${nodeId}`, 'success')
    } catch (err) {
      const rb = rollbackWinnerSelection(outcome)
      // WR-06：nodes+edges 之外必须同时恢复 variantGroups——否则回滚后 store
      // 里仍挂着新 winner（“UI 已换选但库里没写”正是 SC-2 要防的不一致）
      set({ nodes: rb.nodes, variantGroups: prevGroups })
      setEdges(rb.edges)
      showToast(`选定失败已回滚: ${(err as Error).message}`, 'error')
    }
  },

  // 分支操作
  selectBranchAsMain: (branchId) => {
    const { branches, updateBranch, showToast } = get()
    const target = branches.find((b) => b.id === branchId)
    if (!target) {
      showToast('分支不存在', 'error')
      return
    }
    // 将其他 active 分支标记为 archived，目标分支设为 active
    branches.forEach((b) => {
      if (b.id === branchId) {
        updateBranch(b.id, { status: 'active' })
      } else if (b.status === 'active') {
        updateBranch(b.id, { status: 'archived' })
      }
    })
    showToast(`已升为主线: ${target.label}`, 'success')
  },
  archiveBranch: (branchId) => {
    const { branches, updateBranch, showToast } = get()
    const target = branches.find((b) => b.id === branchId)
    if (!target) {
      showToast('分支不存在', 'error')
      return
    }
    if (target.status === 'active') {
      showToast('不能归档当前主线分支', 'warning')
      return
    }
    updateBranch(branchId, { status: 'archived' })
    showToast(`已归档: ${target.label}`, 'info')
  },

  // Toast
  toasts: [],
  showToast: (message, type = 'info') => {
    const id = nextToastId++
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }))
    const timer = setTimeout(() => {
      timers.delete(id)
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, AUTO_DISMISS_MS)
    timers.set(id, timer)
  },
  dismissToast: (id) => {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  // Phase 36/37 — 编排状态
  orchestration: INITIAL_ORCHESTRATION,
  startOrchestration: (runId, total, mode) => set({
    orchestration: { ...INITIAL_ORCHESTRATION, status: 'running', runId, total, mode },
  }),
  updateOrchestrationProgress: (p) => set((state) => ({
    orchestration: { ...state.orchestration, ...p, status: 'running' },
  })),
  finishOrchestration: (result) => set((state) => ({
    orchestration: {
      ...state.orchestration,
      status: 'done',
      completed: result.completed,
      total: result.total,
      failed: result.failed,
      failedNodes: result.failedNodes,
      mode: result.mode,
      currentNodeId: null,
    },
  })),
  resetOrchestration: () => set({ orchestration: INITIAL_ORCHESTRATION }),

  // 视图模式
  viewMode: 'assets',
  setViewMode: (mode) => set({ viewMode: mode }),

  // 【资产↔画布交叉联动】焦点资产节点 ID（画布定位 + 高亮）
  focusAssetNodeId: null,
  setFocusAssetNodeId: (id) => set({ focusAssetNodeId: id }),

  // 资产管理子视图
  assetView: 'library',
  setAssetView: (view) => set({ assetView: view }),
  selectedAssetUuid: null,
  setSelectedAssetUuid: (uuid) => set({ selectedAssetUuid: uuid }),
  openAssetDetail: (uuid) => set({ selectedAssetUuid: uuid }),
  closeAssetDetail: () => set({ selectedAssetUuid: null }),

  // 应用级导航历史注入点（FlowCanvas 挂载时注入 navHistory.push）
  navPushCallback: null,
  setNavPushCallback: (fn) => set({ navPushCallback: fn }),

  // Iteration Engine
  iteration: INITIAL_ITERATION,
  setIterationPlan: (plan) => set((state) => ({
    iteration: {
      ...state.iteration,
      plan,
      status: 'plan_ready',
      error: null,
      adjustmentApproved: !plan.requiresApproval,
      panelOpen: true,
    },
  })),
  updateIterationProgress: (p) => set((state) => ({
    iteration: { ...state.iteration, ...p },
  })),
  setIterationError: (err) => set((state) => ({
    iteration: { ...state.iteration, status: err ? 'error' : state.iteration.status, error: err },
  })),
  setAdjustmentApproved: (approved) => set((state) => ({
    iteration: { ...state.iteration, adjustmentApproved: approved },
  })),
  setIterationPanelOpen: (open) => set((state) => ({
    iteration: { ...state.iteration, panelOpen: open },
  })),
  pushIterationHistory: (plan) => set((state) => ({
    iteration: {
      ...state.iteration,
      history: [plan, ...state.iteration.history.filter((p) => p.id !== plan.id)],
    },
  })),
  setIterationHistory: (plans) => set((state) => ({
    iteration: { ...state.iteration, history: plans },
  })),
  resetIteration: () => set({ iteration: INITIAL_ITERATION }),

}))
