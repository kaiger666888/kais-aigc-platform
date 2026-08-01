/**
 * src/hooks/useViewportHistory.ts — 画布视口历史导航（后退/前进）。
 *
 * 浏览器历史同构的双栈模型：past[] + future[]，当前视口（current）不在栈中。
 *  - push(vp)：用户移动到新视口 → past.push(current); current = vp; future = []
 *  - back()：future.unshift(current); return past.pop()（即新 current）
 *  - forward()：past.push(current); return future.shift()（即新 current）
 *  - canBack / canForward：past / future 是否非空
 *
 * 去抖：与上一视口平移距离 < 50px 且 zoom 差 < 0.1 → 视为同一位置微调，不 push。
 * 初始：首次 push 只设 current（历史起点），不入 past（初始视口不可后退越过）。
 * 上限：past 最多 50 条，超出丢弃最早的。
 *
 * 内部状态全存 useRef、方法全 useCallback（依赖稳定）→ 方法引用恒定；
 * 仅 canBack/canForward 变化时返回对象引用才变（用 useMemo + flags state），
 * 既驱动按钮 disabled 重渲染，又不致 FlowCanvas 的 useCallback 每次渲染失效。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'

export interface ViewportHistory {
  /** 用户移动到新视口时调用（微调会被内部去抖）。 */
  push: (vp: Viewport) => void
  /** 后退：返回应跳转到的视口，无历史则返回 null。 */
  back: () => Viewport | null
  /** 前进：返回应跳转到的视口，无前进目标则返回 null。 */
  forward: () => Viewport | null
  /** 是否可后退（past 非空）。 */
  canBack: boolean
  /** 是否可前进（future 非空）。 */
  canForward: boolean
}

/** past 栈上限（超出丢弃最早条目）。 */
const MAX_HISTORY = 50
/** 微调判定：平移距离阈值（px）。 */
const DIST_THRESHOLD = 50
/** 微调判定：缩放差阈值。 */
const ZOOM_THRESHOLD = 0.1

export function useViewportHistory(): ViewportHistory {
  const pastRef = useRef<Viewport[]>([])
  const futureRef = useRef<Viewport[]>([])
  const currentRef = useRef<Viewport | null>(null)
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

  const push = useCallback(
    (vp: Viewport) => {
      // 首次 push：仅设为历史起点（current），不入 past。
      if (!initializedRef.current) {
        currentRef.current = vp
        initializedRef.current = true
        return
      }
      const cur = currentRef.current
      // 微调去抖：与上一视口距离/缩放均在阈值内 → 视为同一位置，不记。
      if (cur) {
        const dist = Math.hypot(vp.x - cur.x, vp.y - cur.y)
        const dz = Math.abs(vp.zoom - cur.zoom)
        if (dist < DIST_THRESHOLD && dz < ZOOM_THRESHOLD) return
      }
      pastRef.current.push(cur as Viewport)
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
      currentRef.current = vp
      futureRef.current = []
      syncFlags()
    },
    [syncFlags],
  )

  const back = useCallback((): Viewport | null => {
    if (pastRef.current.length === 0) return null
    const cur = currentRef.current
    if (cur) futureRef.current.unshift(cur)
    const prev = pastRef.current.pop() ?? null
    currentRef.current = prev
    syncFlags()
    return prev
  }, [syncFlags])

  const forward = useCallback((): Viewport | null => {
    if (futureRef.current.length === 0) return null
    const cur = currentRef.current
    if (cur) pastRef.current.push(cur)
    const next = futureRef.current.shift() ?? null
    currentRef.current = next
    syncFlags()
    return next
  }, [syncFlags])

  return useMemo<ViewportHistory>(
    () => ({ push, back, forward, canBack: flags.canBack, canForward: flags.canForward }),
    [push, back, forward, flags],
  )
}
