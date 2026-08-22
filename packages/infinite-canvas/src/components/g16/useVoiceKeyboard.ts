/**
 * useVoiceKeyboard.ts — G16 听审键盘流(Phase 56-05 / VIZ-03,D-12)。
 *
 * useWallKeyboard 范式:handlers ref 转发(零重挂)+ enabled 门控 +
 * cleanup。键位:空格(播停,preventDefault 防页面滚动)/ArrowRight 下一条/
 * ArrowLeft 上一条/Escape 关闭。**数字键与 Enter 不注册**(G16 无变体选择/
 * 无确认态数字语义)。
 */
import { useEffect, useRef } from 'react'

export interface VoiceKeyboardHandlers {
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export function useVoiceKeyboard(enabled: boolean, handlers: VoiceKeyboardHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      const h = ref.current
      switch (e.key) {
        case ' ':
          e.preventDefault()
          h.onTogglePlay()
          return
        case 'ArrowRight':
          h.onNext()
          return
        case 'ArrowLeft':
          h.onPrev()
          return
        case 'Escape':
          h.onClose()
          return
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
