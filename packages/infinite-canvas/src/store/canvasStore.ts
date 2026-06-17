import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react'
import type { SkillNodeTypeDecl } from '../services/canvasApi'

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

  // 审核操作
  approveNode: (nodeId: string) => void
  rejectNode: (nodeId: string) => void
  selectWinner: (nodeId: string) => void

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

  // 审核
  approveNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
      ),
    }))
    get().showToast(`审核通过: ${nodeId}`, 'success')
  },
  rejectNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
      ),
    }))
    get().showToast(`已驳回: ${nodeId}`, 'warning')
  },
  selectWinner: (nodeId) => {
    const { nodes, edges, setEdges, showToast } = get()
    const node = nodes.find((n) => n.id === nodeId)
    const variantGroupId = node?.data?.variantGroupId as string | undefined
    if (!variantGroupId) {
      showToast('该节点不属于变体组', 'warning')
      return
    }
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const vg = n.data?.variantGroupId as string | undefined
        if (vg !== variantGroupId) return n
        if (n.id === nodeId) {
          return { ...n, data: { ...n.data, isWinner: true, reviewStatus: 'approved' } }
        }
        return { ...n, data: { ...n.data, isWinner: false } }
      }),
    }))
    setEdges(edges.map((e) => {
      const targetNode = nodes.find((n) => n.id === e.target)
      if (targetNode && (targetNode.data?.variantGroupId as string) === variantGroupId && e.target !== nodeId) {
        return { ...e, data: { ...e.data, isInactive: true } }
      }
      return e
    }))
    showToast(`已选为优胜: ${nodeId}`, 'success')
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
}))
