/**
 * src/hooks/useNavHistory.ts — 应用级状态历史导航（全局前进/后退）。
 *
 * 升级自 useViewportHistory：不再只记画布视口，而是对完整应用状态拍快照——
 * 视图模式 / 资产子视图 / 选中节点 / 详情节点 / 选中资产 / 视口，统进历史栈。
 * 用户每次产生有意义的导航交互（切视图、点节点、开面板…）→ push 当前快照；
 * ← / → 精确恢复到之前的完整状态。
 *
 * 浏览器历史同构的双栈模型：past[] + future[]，当前状态（current）不在栈中。
 *  - push()：读 canvasStore 当前状态构造快照 → 与 current 去重 → past.push(current);
 *            current = snap; future = []
 *  - back()：future.unshift(current); return past.pop()（即新 current）
 *  - forward()：past.push(current); return future.shift()（即新 current）
 *  - canBack / canForward：past / future 是否非空
 *
 * 去重（不 push）：
 *  - 关键字段（viewMode/assetView/selectedNodeId/detailNodeId/selectedAssetUuid）全同
 *    且视口微变（位移 <50px、zoom 差 <0.1）→ 视为同一状态微调。
 *  - 视口单独大幅变化（关键字段同但位移/缩放超阈值）→ 仍 push（视口导航有意义）。
 *
 * 初始：首次 push 只设 current（历史起点），不入 past（初始状态不可后退越过）。
 * 上限：past 最多 30 条，超出丢弃最早的。
 *
 * 视口来源：store.viewport 不会在每次平移时实时更新（store.setViewport 会改写
 * graph 引用触发 useLayout 全量重布，性能不可接受），故快照视口由调用方注入的
 * getViewport（指向 reactFlow.getViewport()，始终精确、零 store 副作用）提供；
 * 非画布视图下视口无意义，记为 null。未注入时回退 store.viewport。
 *
 * 内部状态全 useRef、方法全 useCallback（依赖稳定）→ 方法引用恒定；
 * 仅 canBack/canForward 变化时返回对象引用才变（useMemo + flags state），
 * 既驱动按钮 disabled 重渲染，又不致 FlowCanvas 的 useCallback 每次渲染失效。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'

export interface NavViewport {
  x: number
  y: number
  zoom: number
}

export interface NavSnapshot {
  viewMode: 'canvas' | 'timeline' | 'assets'
  assetView: 'library' | 'detail' | 'wardrobe' | 'scenes' | 'pipeline'
  selectedNodeId: string | null
  detailNodeId: string | null
  selectedAssetUuid: string | null
  viewport: NavViewport | null
}

export interface NavHistory {
  /** 用户产生导航交互时调用：拍当前状态快照 push 到历史（微调/重复会被内部去重）。 */
  push: () => void
  /** 后退：返回应恢复到的快照，无历史则返回 null（调用方负责 apply）。 */
  back: () => NavSnapshot | null
  /** 前进：返回应恢复到的快照，无前进目标则返回 null（调用方负责 apply）。 */
  forward: () => NavSnapshot | null
  /** 是否可后退（past 非空）。 */
  canBack: boolean
  /** 是否可前进（future 非空）。 */
  canForward: boolean
}

/** past 栈上限（超出丢弃最早条目）。 */
const MAX_HISTORY = 30
/** 微调判定：平移距离阈值（px）。 */
const DIST_THRESHOLD = 50
/** 微调判定：缩放差阈值。 */
const ZOOM_THRESHOLD = 0.1

/** 视口获取器：由 FlowCanvas 注入 reactFlow.getViewport()（始终精确、零 store 副作用）。 */
type ViewportGetter = () => NavViewport | null

/** 拍当前应用状态快照。视口仅在画布视图下取（其它视图无画布可恢复）。 */
function captureSnapshot(getViewport?: ViewportGetter): NavSnapshot {
  const s = useCanvasStore.getState()
  const viewport =
    s.viewMode === 'canvas' ? (getViewport ? getViewport() : s.viewport ? { ...s.viewport } : null) : null
  return {
    viewMode: s.viewMode,
    assetView: s.assetView,
    selectedNodeId: s.selectedNode?.id ?? null,
    detailNodeId: s.detailNode?.id ?? null,
    selectedAssetUuid: s.selectedAssetUuid,
    viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null,
  }
}

/** 关键导航字段是否完全一致（视口差异单独判定）。 */
function sameKeyFields(a: NavSnapshot, b: NavSnapshot): boolean {
  return (
    a.viewMode === b.viewMode &&
    a.assetView === b.assetView &&
    a.selectedNodeId === b.selectedNodeId &&
    a.detailNodeId === b.detailNodeId &&
    a.selectedAssetUuid === b.selectedAssetUuid
  )
}

/** 视口是否属「微调」（位移 <50px 且 zoom 差 <0.1）。任一为空 → 无法比较，保守视为接近。 */
function viewportClose(a: NavSnapshot, b: NavSnapshot): boolean {
  if (!a.viewport || !b.viewport) return true
  const dist = Math.hypot(a.viewport.x - b.viewport.x, a.viewport.y - b.viewport.y)
  const dz = Math.abs(a.viewport.zoom - b.viewport.zoom)
  return dist < DIST_THRESHOLD && dz < ZOOM_THRESHOLD
}

export function useNavHistory(getViewport?: ViewportGetter): NavHistory {
  // getViewport 可能随渲染换引用，但只读其返回值 → 用 ref 固定，避免 push 依赖抖动。
  const getViewportRef = useRef<ViewportGetter | undefined>(getViewport)
  getViewportRef.current = getViewport

  const pastRef = useRef<NavSnapshot[]>([])
  const futureRef = useRef<NavSnapshot[]>([])
  const currentRef = useRef<NavSnapshot | null>(null)
  const initializedRef = useRef(false)

  // canBack/canForward 需驱动按钮 disabled 重渲染 → 用 state 镜像栈长度。
  const [flags, setFlags] = useState({ canBack: false, canForward: false })

  const syncFlags = useCallback(() => {
    const canBack = pastRef.current.length > 0
    const canForward = futureRef.current.length > 0
    // 值未变则返回旧对象，避免无谓重渲染。
    setFlags((prev) =>
      prev.canBack === canBack && prev.canForward === canForward ? prev : { canBack, canForward },
    )
  }, [])

  const push = useCallback(() => {
    const snap = captureSnapshot(getViewportRef.current)
    // 首次 push：仅设为历史起点（current），不入 past。
    if (!initializedRef.current) {
      currentRef.current = snap
      initializedRef.current = true
      return
    }
    const cur = currentRef.current
    // 去重：关键字段全同且视口微变 → 视为同一状态，不记。
    if (cur && sameKeyFields(cur, snap) && viewportClose(cur, snap)) return
    pastRef.current.push(cur as NavSnapshot)
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
    currentRef.current = snap
    futureRef.current = []
    syncFlags()
  }, [syncFlags])

  const back = useCallback((): NavSnapshot | null => {
    if (pastRef.current.length === 0) return null
    const cur = currentRef.current
    if (cur) futureRef.current.unshift(cur)
    const prev = pastRef.current.pop() ?? null
    currentRef.current = prev
    syncFlags()
    return prev
  }, [syncFlags])

  const forward = useCallback((): NavSnapshot | null => {
    if (futureRef.current.length === 0) return null
    const cur = currentRef.current
    if (cur) pastRef.current.push(cur)
    const next = futureRef.current.shift() ?? null
    currentRef.current = next
    syncFlags()
    return next
  }, [syncFlags])

  return useMemo<NavHistory>(
    () => ({ push, back, forward, canBack: flags.canBack, canForward: flags.canForward }),
    [push, back, forward, flags],
  )
}
