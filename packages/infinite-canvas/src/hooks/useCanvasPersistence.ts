/**
 * src/hooks/useCanvasPersistence.ts — P17：画布状态是数据，不是运气。
 *
 * 持久化 viewport / 折叠（牌堆·text 卡展开态）/ 选定项 到 localStorage，
 * key 含 projectId+episodesId（一集一画布，P10）；刷新后原样恢复：
 *  - 有持久化 viewport → setViewport 恢复（跳过 fitView）；
 *  - 折叠态 → 水合 canvasUiStore；选定项 → 恢复 node.selected + selectedNode。
 *
 * 纯函数部分（key 构造 / 序列化读写）可注入 storage 便于 vitest；
 * React 副作用集中在 useCanvasPersistence，由 FlowCanvas 挂一次。
 */
import { useEffect, useRef } from 'react'
import { useReactFlow, type Viewport } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { useCanvasUiStore } from '../components/canvas/canvasUiStore'

export interface PersistedCanvasState {
  viewport?: Viewport
  selectedNodeId?: string | null
  expandedStacks?: string[]
  expandedTexts?: string[]
}

/** localStorage key（P17：含 projectId+episodesId，集间隔离）。 */
export function canvasStateKey(projectId: number | string, episodesId: number | string): string {
  return `kais:canvas:v1:p${projectId}:e${episodesId}`
}

export interface StorageLike {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null // 隐私模式等访问异常：静默降级为不持久化
  }
}

/** 读持久化记录（损坏 JSON → 空记录，绝不 throw）。 */
export function loadCanvasState(key: string, storage: StorageLike | null = defaultStorage()): PersistedCanvasState {
  if (!storage) return {}
  try {
    const raw = storage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedCanvasState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 合并写（patch 语义；读-改-写保住其它字段）。 */
export function saveCanvasState(
  key: string,
  patch: Partial<PersistedCanvasState>,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    const next = { ...loadCanvasState(key, storage), ...patch }
    storage.setItem(key, JSON.stringify(next))
  } catch {
    // 写失败（配额/隐私模式）：降级为不持久化，不打断交互
  }
}

/**
 * FlowCanvas 挂载点：负责「恢复一次 + 持续回写」。
 * @param stateKey 持久化 key（projectId/episodesId 就绪前为 null，此时不动作）
 * @param nodesReady 派生节点已渲染（恢复视口/选定需要节点存在）
 */
export function useCanvasPersistence(stateKey: string | null, nodesReady: boolean): {
  /** ReactFlow onMoveEnd 回调：视口落定即持久化（P17）。 */
  onMoveEnd: (viewport: Viewport) => void
  /** 是否存在已恢复的 viewport（FlowCanvas 据此跳过 fitView） */
  hasRestoredViewport: () => boolean
} {
  const reactFlow = useReactFlow()
  const restoredKeyRef = useRef<string | null>(null)
  const restoredViewportRef = useRef<Viewport | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 恢复（每个 key 一次；等节点就绪保证 selected 恢复落得上） ──
  useEffect(() => {
    if (!stateKey || !nodesReady || restoredKeyRef.current === stateKey) return
    restoredKeyRef.current = stateKey
    const saved = loadCanvasState(stateKey)

    // 折叠态水合
    useCanvasUiStore.getState().hydrate({
      expandedStacks: saved.expandedStacks ?? [],
      expandedTexts: saved.expandedTexts ?? [],
    })

    // 视口恢复（优先于 fitView；rAF 等 React Flow 完成首帧测量）
    if (saved.viewport && Number.isFinite(saved.viewport.x) && Number.isFinite(saved.viewport.zoom)) {
      restoredViewportRef.current = saved.viewport
      requestAnimationFrame(() => {
        reactFlow.setViewport(saved.viewport!, { duration: 0 })
      })
    }

    // 选定项恢复（同步打开右侧面板 = 「原样」；节点高亮走 node.selected）
    if (saved.selectedNodeId) {
      const { nodes, setNodes, setSelectedNode } = useCanvasStore.getState()
      const target = nodes.find((n) => n.id === saved.selectedNodeId)
      if (target) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === saved.selectedNodeId })))
        setSelectedNode(target)
      }
    }
  }, [stateKey, nodesReady, reactFlow])

  // ── 视口回写（onMoveEnd：交互落定才写，平移/缩放过程中不刷 localStorage） ──
  const onMoveEnd = (viewport: Viewport) => {
    if (!stateKey) return
    saveCanvasState(stateKey, { viewport })
  }

  // ── 选定项回写 ──
  const selectedNodeId = useCanvasStore((s) => s.selectedNode?.id ?? null)
  useEffect(() => {
    if (!stateKey || restoredKeyRef.current !== stateKey) return
    saveCanvasState(stateKey, { selectedNodeId })
  }, [stateKey, selectedNodeId])

  // ── 折叠态回写（300ms 防抖，展开/收起连点不刷写） ──
  const expandedStacks = useCanvasUiStore((s) => s.expandedStacks)
  const expandedTexts = useCanvasUiStore((s) => s.expandedTexts)
  useEffect(() => {
    if (!stateKey || restoredKeyRef.current !== stateKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveCanvasState(stateKey, { expandedStacks, expandedTexts })
    }, 300)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [stateKey, expandedStacks, expandedTexts])

  return {
    onMoveEnd,
    hasRestoredViewport: () => restoredViewportRef.current != null,
  }
}
