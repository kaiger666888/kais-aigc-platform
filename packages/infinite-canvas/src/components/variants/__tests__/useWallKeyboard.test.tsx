// @vitest-environment jsdom
/**
 * useWallKeyboard 行为测试(Phase 53-02 Task 2 / D-20)。
 *
 * 五组键映射不变量:
 *  1. '1'..'9' → onInspect(index),index = key-1(仅当 index < maxTakes);
 *  2. 'Enter' → onConfirmSelection;'Escape' → onClose;
 *  3. 'ArrowRight' → onNextGroup;'ArrowLeft' → onPrevGroup;
 *  4. ' ' → onTogglePlay 且 preventDefault(防页面滚动);
 *  5. enabled=false 任意键不触发;cleanup(卸载)移除 window listener。
 *
 * 测试策略:react-dom/client + React 19 act(AssetCardNode.playBadge 同款),
 * Probe 组件真调 hook;window.dispatchEvent(new KeyboardEvent(...)) 驱动。
 */
import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWallKeyboard } from '../useWallKeyboard'

// React 19:act 需显式声明测试环境
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Handlers = Parameters<typeof useWallKeyboard>[1]

function mkHandlers(): { h: Handlers; spies: Record<keyof Handlers, ReturnType<typeof vi.fn>> } {
  const spies = {
    onInspect: vi.fn(),
    onConfirmSelection: vi.fn(),
    onNextGroup: vi.fn(),
    onPrevGroup: vi.fn(),
    onTogglePlay: vi.fn(),
    onClose: vi.fn(),
  }
  return { h: spies as unknown as Handlers, spies }
}

function Probe({ enabled, handlers, maxTakes }: {
  enabled: boolean
  handlers: Handlers
  maxTakes: number
}) {
  useWallKeyboard(enabled, handlers, { maxTakes })
  return null
}

let root: Root | null = null
let container: HTMLElement | null = null

function render(props: { enabled: boolean; handlers: Handlers; maxTakes: number }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Probe {...props} />))
}

function rerender(props: { enabled: boolean; handlers: Handlers; maxTakes: number }) {
  act(() => root!.render(<Probe {...props} />))
}

function unmount() {
  act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
}

function press(k: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => {
    window.dispatchEvent(ev)
  })
  return ev
}

describe('useWallKeyboard — D-20 审片键盘流', () => {
  it('1. 数字键 1-9 → onInspect(key-1),越界不触发', () => {
    const { h, spies } = mkHandlers()
    render({ enabled: true, handlers: h, maxTakes: 3 })
    press('1')
    press('3')
    press('4') // ≥ maxTakes → 忽略
    expect(spies.onInspect).toHaveBeenCalledTimes(2)
    expect(spies.onInspect).toHaveBeenNthCalledWith(1, 0)
    expect(spies.onInspect).toHaveBeenNthCalledWith(2, 2)
    unmount()
  })

  it('2. Enter → onConfirmSelection;Escape → onClose', () => {
    const { h, spies } = mkHandlers()
    render({ enabled: true, handlers: h, maxTakes: 2 })
    press('Enter')
    press('Escape')
    expect(spies.onConfirmSelection).toHaveBeenCalledTimes(1)
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('3. ArrowRight → onNextGroup;ArrowLeft → onPrevGroup', () => {
    const { h, spies } = mkHandlers()
    render({ enabled: true, handlers: h, maxTakes: 2 })
    press('ArrowRight')
    press('ArrowLeft')
    expect(spies.onNextGroup).toHaveBeenCalledTimes(1)
    expect(spies.onPrevGroup).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('4. Space → onTogglePlay 且 preventDefault', () => {
    const { h, spies } = mkHandlers()
    render({ enabled: true, handlers: h, maxTakes: 2 })
    const ev = press(' ')
    expect(spies.onTogglePlay).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    unmount()
  })

  it('5. enabled=false 不触发;卸载后 listener 移除', () => {
    const { h, spies } = mkHandlers()
    render({ enabled: true, handlers: h, maxTakes: 2 })
    rerender({ enabled: false, handlers: h, maxTakes: 2 })
    press('Enter')
    press(' ')
    expect(spies.onConfirmSelection).not.toHaveBeenCalled()
    expect(spies.onTogglePlay).not.toHaveBeenCalled()
    unmount()
    press('Enter')
    expect(spies.onConfirmSelection).not.toHaveBeenCalled() // cleanup 生效
  })
})
