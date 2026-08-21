// @vitest-environment jsdom
/**
 * GateCenterBlock ▶ 三操作闭环渲染级测试(Phase 54-07 / GATE-03 前端终点)。
 *
 * 行为契约(GateCenterBlock.tsx):
 *  - [放行] 单点击 → await gateOps → applied:true → 行乐观翻转
 *    (gate-state-{gateId} 文案从「等你决策」→「放行」),「处理中…」瞬时消失;
 *  - applied:false cause:"already-resolved" → toast「该门已在别处处理」
 *    (P4 幂等成功语义,非报错)且行不残留乐观态;
 *  - gateOps reject → 行回滚到「等你决策」+ 错误 toast,零中间残留。
 *
 * 测试策略(AssetCardNode.playBadge 范式):真实 zustand store(setState 种
 * gateStore snapshot / canvasStore projectId);仅 mock canvasApi 的
 * gateOps / fetchGateState 两函数。jsdom + react-dom/client + React 19 act。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import GateCenterBlock from '../GateCenterBlock'
import { useGateStore } from '../../../store/gateStore'
import { useCanvasStore } from '../../../store/canvasStore'
import { gateOps } from '../../../services/canvasApi'

vi.mock('../../../services/canvasApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/canvasApi')>()
  return { ...actual, gateOps: vi.fn(), fetchGateState: vi.fn(async () => null) }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const gateOpsMock = vi.mocked(gateOps)

function seedSnapshot(blocking: boolean = true): void {
  useGateStore.setState({
    snapshot: {
      projectId: 7,
      episodesId: 3,
      fetchedAt: Date.now(),
      degrade: false,
      blocking: blocking
        ? { gateId: 'p13-gate', reviewId: 3, phaseId: 'p13_delivery', label: '成片交付' }
        : null,
      gates: [
        { gateId: 'p01-gate', phaseId: 'p01_hook_topic', label: '选题定向', display: 'approve', reviewId: 1 },
        { gateId: 'p11c-gate', phaseId: 'p11c_video_qc', label: '镜头质检', display: 'pending', reviewId: 2 },
        { gateId: 'p13-gate', phaseId: 'p13_delivery', label: '成片交付', display: 'pending', reviewId: 3 },
        { gateId: 'p13_delivery_redline_emotion', phaseId: 'p13_delivery_redline_emotion', label: '情绪红线', display: 'auto' },
      ],
    },
    degrade: false,
  })
}

let root: Root | null = null
let container: HTMLElement | null = null

function render(ui: React.ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(ui) })
}

function stateText(gateId: string): string {
  const el = container!.querySelector(`[data-testid="gate-state-${gateId}"]`)
  return el?.textContent ?? ''
}

function clickButton(label: string): void {
  const btn = Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  )
  if (btn == null) throw new Error(`button "${label}" not found`)
  // 仅派发;后续异步续体由调用方的 await act(...) 统一覆盖(避免嵌套 act)。
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('GateCenterBlock 三操作闭环(54-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateOpsMock.mockResolvedValue({ applied: true })
    seedSnapshot(true)
    useCanvasStore.setState({ projectId: 7, episodesId: 3, toasts: [] })
  })

  afterEach(() => {
    root?.unmount()
    container?.remove()
  })

  it('放行单点击 → applied:true → 行乐观翻转为「放行」,处理中瞬时消失', async () => {
    render(<GateCenterBlock />)
    expect(stateText('p13-gate')).toContain('等你决策')

    gateOpsMock.mockResolvedValue({ applied: true })
    await act(async () => { clickButton("放行"); await new Promise((r) => setTimeout(r, 0)) })

    expect(gateOpsMock).toHaveBeenCalledWith(7, 3, 3, 'approve', undefined)
    expect(stateText('p13-gate')).toContain('放行')
    expect(stateText('p13-gate')).not.toContain('处理中')
  })

  it('409 already-resolved → 幂等成功 toast「该门已在别处处理」,行回实际态', async () => {
    render(<GateCenterBlock />)
    gateOpsMock.mockResolvedValue({ applied: false, cause: 'already-resolved' })
    await act(async () => { clickButton("放行"); await new Promise((r) => setTimeout(r, 0)) })

    const toasts = useCanvasStore.getState().toasts
    expect(toasts.some((t) => t.message.includes('该门已在别处处理'))).toBe(true)
    // 行不残留乐观态(快照实际态仍是 pending → 等你决策)
    expect(stateText('p13-gate')).toContain('等你决策')
  })

  it('gateOps 异常 → 行回滚「等你决策」+ 错误 toast,零中间残留', async () => {
    render(<GateCenterBlock />)
    gateOpsMock.mockRejectedValue(new Error('boom'))
    await act(async () => { clickButton("放行"); await new Promise((r) => setTimeout(r, 0)) })

    expect(stateText('p13-gate')).toContain('等你决策')
    expect(stateText('p13-gate')).not.toContain('处理中')
    const toasts = useCanvasStore.getState().toasts
    expect(toasts.length).toBeGreaterThan(0)
  })
})
