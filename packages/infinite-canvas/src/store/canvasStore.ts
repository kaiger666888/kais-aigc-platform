import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react'
import type { SkillNodeTypeDecl } from '../services/canvasApi'
import type { FlowBranch, BranchStatus } from '../types/canvas'
import { approveNode as apiApproveNode, rejectNode as apiRejectNode } from '../services/canvasApi'

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
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'awaiting_audit' } } : n
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
          n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: nodes.find(nn => nn.id === nodeId)?.data?.reviewStatus ?? 'awaiting_audit' } } : n
        ),
      }))
      showToast(`驳回失败: ${(err as Error).message}`, 'error')
    }
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
}))
