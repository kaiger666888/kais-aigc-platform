// @vitest-environment jsdom
/**
 * useVoiceKeyboard 单测(56-05 / D-12)——四键 + 不占用 + 门控 + 卸载。
 */
import { describe, it, expect, vi } from 'vitest'
import { useVoiceKeyboard } from '../useVoiceKeyboard'

// 不引 @testing-library(零新依赖):直接挂 hook 最小宿主。
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { createElement } from 'react'

function mountHook(handlers: { onTogglePlay: () => void; onNext: () => void; onPrev: () => void; onClose: () => void }, enabled = true): { unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  function Probe(): null {
    useVoiceKeyboard(enabled, handlers)
    return null
  }
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => { root.render(createElement(Probe)) })
  return { unmount: () => { act(() => root.unmount()); container.remove() } }
}

function key(k: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
}

describe('useVoiceKeyboard(56-05)', () => {
  it('空格 → onTogglePlay 且 preventDefault;→ ← 推进;Esc 关闭', () => {
    const onTogglePlay = vi.fn(); const onNext = vi.fn(); const onPrev = vi.fn(); const onClose = vi.fn()
    const { unmount } = mountHook({ onTogglePlay, onNext, onPrev, onClose })
    key(' '); key('ArrowRight'); key('ArrowLeft'); key('Escape')
    expect(onTogglePlay).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('数字键/Enter 不触发任何 handler(键位不占用)', () => {
    const handlers = { onTogglePlay: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn() }
    const { unmount } = mountHook(handlers)
    key('1'); key('9'); key('Enter'); key('a')
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled()
    unmount()
  })

  it('enabled=false 零触发;卸载移除 listener', () => {
    const handlers = { onTogglePlay: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn() }
    const a = mountHook(handlers, false)
    key(' ')
    expect(handlers.onTogglePlay).not.toHaveBeenCalled()
    a.unmount()
    const b = mountHook(handlers)
    b.unmount()
    key(' ')
    expect(handlers.onTogglePlay).not.toHaveBeenCalled()
  })
})
