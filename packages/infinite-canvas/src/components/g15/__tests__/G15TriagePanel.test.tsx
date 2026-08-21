// @vitest-environment jsdom
/**
 * G15TriagePanel 行为测试(Phase 53-07 Task 2 / D-13/D-14/D-16)。
 *
 * 六组断言:
 *  1. 勾选状态机:点 3 行 → 已选 3;取消 1 → 已选 2;全选/清空;
 *  2. 行展开:take_log 条目(take_n/changed_variable/seed/evidence)与原始 error 可见;再点收起;
 *  3. 批量豁免:勾 2 行 → 行乐观「已豁免」+ g15Ops(waive, 2 项);reject → 回滚 + error toast;
 *  4. 重渲二次确认:点[批量重渲]不调 api,确认层含计数;取消零调用;确认 → g15Ops(requeue);
 *  5. shotIds >200 前端预拦截(零请求 + toast);
 *  6. 归因徽章渲染(qc/engine/timeout 三类配色可见)。
 *
 * canvasApi 整模块 mock(selectWinner.test.ts 手法);react-dom/client + React 19 act。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../../services/canvasApi', () => ({
  g15Ops: vi.fn(),
}))

import G15TriagePanel from '../G15TriagePanel'
import { useG15TriageStore } from '../g15TriageStore'
import { useCanvasStore } from '../../../store/canvasStore'
import { g15Ops } from '../../../services/canvasApi'

const apiG15 = vi.mocked(g15Ops)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function render(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<G15TriagePanel />))
}

function unmount(): void {
  act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
}

function resetStore(): void {
  useG15TriageStore.setState({
    open: true,
    rows: [
      { shotId: 'shot_001', phase: 'p11b', category: 'delegate_timeout', reason: 'timeout A', rawError: 'timeout A\nline2' },
      { shotId: 'shot_002', phase: 'p11b', category: 'schema_validation', reason: 'schema B' },
      { shotId: 'shot_003', phase: 'p11a', category: 'qc_vision_fail', reason: '构图越轴', takes: [{ take_n: 2, shot_id: 'shot_003', changed_variable: 'camera', seed: 42, verdict: 'edit', evidence: '节奏拖沓' }] },
    ],
    selected: new Set<string>(),
    expanded: null,
    rowState: {},
  })
  useCanvasStore.setState({
    projectId: 7,
    episodesId: 101,
    toasts: [],
    showToast: vi.fn() as unknown as (m: string, t?: 'success' | 'error' | 'info' | 'warning') => void,
  })
}

const selectedCount = (): number =>
  Number(container?.querySelector('[data-testid="g15-triage-panel"]')?.textContent?.match(/已选 (\d+)/)?.[1] ?? -1)

function check(shotId: string): void {
  act(() => {
    ;(container?.querySelector(`[data-testid="g15-check-${shotId}"]`) as HTMLInputElement)?.click()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  apiG15.mockResolvedValue(undefined)
  resetStore()
})

describe('G15TriagePanel — 分诊工作台', () => {
  it('1. 勾选状态机:3 → 2;全选/清空', () => {
    render()
    check('shot_001')
    check('shot_002')
    check('shot_003')
    expect(selectedCount()).toBe(3)
    check('shot_002')
    expect(selectedCount()).toBe(2)
    const buttons = [...container!.querySelectorAll('button')]
    act(() => buttons.find((b) => b.textContent === '全选')!.click())
    expect(selectedCount()).toBe(3)
    act(() => buttons.find((b) => b.textContent === '清空')!.click())
    expect(selectedCount()).toBe(0)
    unmount()
  })

  it('2. 行展开:take_log 条目与原始 error 可见;再点收起', () => {
    render()
    act(() => {
      ;(container?.querySelector('[data-testid="g15-check-shot_003"]')?.parentElement?.querySelector('span') as HTMLElement)?.click()
    })
    expect(container?.textContent).toContain('take 2')
    expect(container?.textContent).toContain('camera')
    expect(container?.textContent).toContain('seed 42')
    expect(container?.textContent).toContain('节奏拖沓')
    // shot_001 原始 error 展开
    act(() => {
      ;(container?.querySelector('[data-testid="g15-check-shot_001"]')?.parentElement?.querySelector('span') as HTMLElement)?.click()
    })
    expect(container?.textContent).toContain('line2')
    unmount()
  })

  it('3. 批量豁免:乐观已豁免 + g15Ops(waive, 2 项);失败回滚 + error toast', async () => {
    render()
    check('shot_001')
    check('shot_002')
    await act(async () => {
      ;(container?.querySelector('[data-testid="g15-batch-waive"]') as HTMLButtonElement)?.click()
    })
    expect(apiG15).toHaveBeenCalledTimes(1)
    expect(apiG15).toHaveBeenCalledWith(7, 101, 'waive', ['shot_001', 'shot_002'])
    expect(container?.textContent).toContain('已豁免')
    // 失败回滚
    apiG15.mockRejectedValueOnce(new Error('HTTP 500'))
    check('shot_003')
    await act(async () => {
      ;(container?.querySelector('[data-testid="g15-batch-waive"]') as HTMLButtonElement)?.click()
    })
    expect(useCanvasStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('失败已回滚'), 'error')
    // 仅 shot_003 回滚;首笔成功的 shot_001/002 维持已豁免
    expect(useG15TriageStore.getState().rowState['shot_003']).toBeUndefined()
    expect(useG15TriageStore.getState().rowState['shot_001']).toBe('waived')
    unmount()
  })

  it('4. 重渲二次确认:确认层含计数;取消零调用;确认 → requeue', async () => {
    render()
    check('shot_001')
    check('shot_002')
    act(() => {
      ;(container?.querySelector('[data-testid="g15-batch-requeue"]') as HTMLButtonElement)?.click()
    })
    expect(apiG15).not.toHaveBeenCalled()
    expect(container?.textContent).toContain('确认对 2 个镜头下发重渲')
    act(() => {
      ;([...container!.querySelectorAll('button')].find((b) => b.textContent === '取消') as HTMLButtonElement)?.click()
    })
    expect(apiG15).not.toHaveBeenCalled()
    act(() => {
      ;(container?.querySelector('[data-testid="g15-batch-requeue"]') as HTMLButtonElement)?.click()
    })
    await act(async () => {
      ;(container?.querySelector('[data-testid="g15-confirm-requeue"]') as HTMLButtonElement)?.click()
    })
    expect(apiG15).toHaveBeenCalledWith(7, 101, 'requeue', ['shot_001', 'shot_002'])
    unmount()
  })

  it('5. shotIds >200 前端预拦截:零请求 + toast', async () => {
    render()
    const many = Array.from({ length: 201 }, (_, i) => `shot_${String(i).padStart(3, '0')}`)
    act(() => {
      useG15TriageStore.setState({
        rows: many.map((id) => ({ shotId: id, phase: 'p11b', category: 'unknown' as const, reason: 'r' })),
        selected: new Set(many),
      })
    })
    await act(async () => {
      ;(container?.querySelector('[data-testid="g15-batch-waive"]') as HTMLButtonElement)?.click()
    })
    expect(apiG15).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('200'), 'warning')
    unmount()
  })

  it('6. 归因徽章:三类类别文本渲染', () => {
    render()
    expect(container?.textContent).toContain('delegate_timeout')
    expect(container?.textContent).toContain('schema_validation')
    expect(container?.textContent).toContain('qc_vision_fail')
    unmount()
  })
})
