import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react'
import type { SkillNodeTypeDecl, IterationPlan, IterationResult } from '../services/canvasApi'
import type { FlowBranch, VariantGroup, VariantGroupId } from '../types/canvas'
import { asVariantGroupId } from '../types/canvas'
import { approveNode as apiApproveNode, rejectNode as apiRejectNode } from '../services/canvasApi'
import {
  applyWinnerSelection,
  rollbackWinnerSelection,
  syncWinnerToGroups,
} from './variantOps'

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
}

interface CanvasState {
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

  // 画布节点/边
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

  // 变体组 (持久化层 — FlowGraphV2.variantGroups 同步)
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
  menuPos: { x: number; y: number; nodeId?: string } | null
  setMenuPos: (pos: { x: number; y: number; nodeId?: string } | null) => void
  // Phase 37 — 多选节点 ID (用于批量执行)
  selectedNodeIds: string[]
  setSelectedNodeIds: (ids: string[]) => void

  // 审核操作
  approveNode: (nodeId: string) => Promise<void>
  rejectNode: (nodeId: string, feedback?: string) => Promise<void>
  selectWinner: (nodeId: string) => void

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

export const useCanvasStore = create<CanvasState>((set, get) => ({
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

  // 变体组 (持久化层)
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
  menuPos: null,
  setMenuPos: (pos) => set({ menuPos: pos }),
  // Phase 37 — 多选
  selectedNodeIds: [],
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

  // 审核 — 乐观更新 + API 调用
  approveNode: async (nodeId) => {
    const { projectId, episodesId, nodes, showToast } = get()
    if (!projectId || !episodesId) return

    // 乐观更新
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
      ),
    }))

    try {
      await apiApproveNode(projectId, episodesId, nodeId)
      showToast(`审核通过: ${nodeId}`, 'success')
    } catch (err) {
      // 回滚
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'pending' } } : n
        ),
      }))
      showToast(`审核失败: ${(err as Error).message}`, 'error')
    }
  },
  rejectNode: async (nodeId, feedback) => {
    const { projectId, episodesId, nodes, showToast } = get()
    if (!projectId || !episodesId) return

    // 乐观更新
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
      ),
    }))

    try {
      await apiRejectNode(projectId, episodesId, nodeId, feedback ?? '')
      showToast(`已驳回: ${nodeId}`, 'warning')
    } catch (err) {
      // 回滚
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'pending' } } : n
        ),
      }))
      showToast(`驳回失败: ${(err as Error).message}`, 'error')
    }
  },
  selectWinner: (nodeId) => {
    const { nodes, edges, variantGroups, setNodes, setEdges, upsertVariantGroup, showToast } = get()
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

    // 3) 同步更新 (或新建) VariantGroup.winnerNodeId
    const existingGroup = variantGroups.find((g) => g.groupId === variantGroupId)
    if (existingGroup) {
      const updated = syncWinnerToGroups(variantGroups, variantGroupId, nodeId)[0]
      if (updated) upsertVariantGroup(updated)
    }
    // 注:此处不调后端 — selectWinner 在本地是即时 UI 优先,
    // 真正的持久化由用户点击 "💾 保存" 触发 (saveCanvasGraph)。
    // 因此没有 try/catch 回滚路径。如果将来接入实时 API,失败时调用
    // rollbackWinnerSelection(outcome) 把 nodes/edges 恢复。

    void outcome // 保留引用,便于将来接入 async API 时回滚
    showToast(`已选为优胜: ${nodeId}`, 'success')
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
      status: result.failed > 0 ? 'done' : 'done',
      completed: result.completed,
      total: result.total,
      failed: result.failed,
      failedNodes: result.failedNodes,
      mode: result.mode,
      currentNodeId: null,
    },
  })),
  resetOrchestration: () => set({ orchestration: INITIAL_ORCHESTRATION }),

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
