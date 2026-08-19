// @vitest-environment jsdom
/**
 * WR-08 回归测试：useCanvasSocket 消费 `variant:selected` 广播。
 *
 * 49-01 端点一直在 broadcastToProject('variant:selected')，但 socket 客户端
 * 从未注册该事件的 handler（死信）——其他 tab/用户看不到他端的 winner 选定，
 * 直到整页刷新。本测试固定三件事：
 *  1. hook 挂载后 socket 上注册了 'variant:selected' handler；
 *  2. 事件到达时转发给 onVariantSelected 回调（payload 原样）；
 *  3. 卸载时断开连接（既有行为不回归）。
 *
 * socket.io-client 整模块 mock（零真实网络）；react-dom/client 渲染探针组件。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

type Handler = (...args: unknown[]) => void

const { handlers, disconnectMock, emitMock } = vi.hoisted(() => {
  return {
    handlers: new Map<string, Handler>(),
    disconnectMock: vi.fn(),
    emitMock: vi.fn(),
  }
})

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (ev: string, fn: Handler) => {
      handlers.set(ev, fn)
    },
    emit: emitMock,
    disconnect: disconnectMock,
  }),
}))

import { useCanvasSocket } from '../useCanvasSocket'

function Probe(props: { onVariantSelected?: (p: unknown) => void }) {
  useCanvasSocket({
    projectId: 7,
    episodesId: 101,
    onNodeStateChange: vi.fn(),
    onNodePreviewUpdate: vi.fn(),
    onNewAsset: vi.fn(),
    onVariantSelected: props.onVariantSelected,
  })
  return null
}

describe('useCanvasSocket — variant:selected 消费（WR-08）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    handlers.clear()
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    root?.unmount()
    container.remove()
  })

  it('挂载即注册 variant:selected handler（此前是死信广播）', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(Probe, {}))
    })

    expect(handlers.has('variant:selected')).toBe(true)
    // 既有事件注册不受影响
    expect(handlers.has('graph:saved')).toBe(true)
    expect(handlers.has('review:approved')).toBe(true)
  })

  it('事件到达 → 原样转发给 onVariantSelected', async () => {
    const onVariantSelected = vi.fn()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(Probe, { onVariantSelected }))
    })

    const payload = {
      projectId: 7,
      episodesId: 101,
      groupId: 'vg-1',
      winnerNodeId: 'node-b',
      timestamp: 1700000000000,
    }
    expect(onVariantSelected).not.toHaveBeenCalled()
    await act(async () => {
      handlers.get('variant:selected')!(payload)
    })
    expect(onVariantSelected).toHaveBeenCalledTimes(1)
    expect(onVariantSelected).toHaveBeenCalledWith(payload)
  })

  it('未提供回调时不炸（可选项）', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(Probe, {}))
    })
    await act(async () => {
      handlers.get('variant:selected')!({
        projectId: 7, episodesId: 101, groupId: 'g', winnerNodeId: 'n', timestamp: 1,
      })
    })
    // 到这里没抛异常即通过
  })

  it('卸载时断开 socket（既有行为不回归）', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(Probe, {}))
    })
    await act(async () => {
      root.unmount()
    })
    expect(disconnectMock).toHaveBeenCalled()
  })
})
