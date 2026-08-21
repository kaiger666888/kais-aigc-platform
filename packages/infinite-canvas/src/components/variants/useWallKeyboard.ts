/**
 * useWallKeyboard.ts — 变体墙审片键盘流(Phase 53-02 Task 2 / D-20)。
 *
 * 键映射(planner 终裁,与 D-08 显式选定语义一致——数字键=检视,不是选定):
 *   '1'..'9'   → onInspect(index)  仅当 index < maxTakes
 *   'Enter'    → onConfirmSelection(选定当前检视卡)
 *   'ArrowRight' / 'ArrowLeft' → onNextGroup / onPrevGroup
 *   ' '        → onTogglePlay(同播 播/停;preventDefault 防页面滚动)
 *   'Escape'   → onClose
 *
 * 范式:VariantPicker.tsx L25-30 — useEffect 内 window keydown,enabled 门控,
 * cleanup 移除(P9)。纯 hook,无业务状态;handlers 引用每次渲染都可变
 * (经 ref 转发最新值,监听器只挂一次)。
 */
import { useEffect, useRef } from 'react'

export interface WallKeyboardHandlers {
  onInspect: (index: number) => void
  onConfirmSelection: () => void
  onNextGroup: () => void
  onPrevGroup: () => void
  onTogglePlay: () => void
  onClose: () => void
}

export interface WallKeyboardOptions {
  /** 检视键 1-9 的上界(组内 take 数);越界忽略。 */
  maxTakes: number
}

export function useWallKeyboard(
  enabled: boolean,
  handlers: WallKeyboardHandlers,
  opts: WallKeyboardOptions,
): void {
  // handlers 每渲染都可能换新引用(内联闭包)— ref 转发,避免 listener 重挂。
  const ref = useRef(handlers)
  ref.current = handlers
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      const h = ref.current
      const { maxTakes } = optsRef.current
      if (e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1
        if (index < maxTakes) h.onInspect(index)
        return
      }
      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          h.onConfirmSelection()
          break
        case ' ':
          e.preventDefault() // 防页面滚动
          h.onTogglePlay()
          break
        case 'ArrowRight':
          h.onNextGroup()
          break
        case 'ArrowLeft':
          h.onPrevGroup()
          break
        case 'Escape':
          h.onClose()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
