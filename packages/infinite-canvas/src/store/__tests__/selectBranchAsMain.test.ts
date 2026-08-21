/**
 * selectBranchAsMain 重写行为测试(Phase 55-06 / NAV-06)。
 *
 * selectWinner 范式:乐观上屏 → 逐变化分支 REST PATCH(canvasApi.updateBranch)
 * → 任一失败整体回滚 + 错误 toast;上下文缺失/分支不存在早退。
 * applyBranchUpsert:V2 事件流 status 真相合并(toLegacyBranches 有损 shim
 * 的运行时修正点,Pitfall 4 方案 b);未知 id warn 不动状态。
 *
 * canvasApi.updateBranch 整模块 mock;store 直种 branches/projectId 上下文。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FlowBranch } from '../../types/canvas'

vi.mock('../../services/canvasApi', () => ({
  updateBranch: vi.fn(async () => {}),
  selectVariantWinner: vi.fn(),
}))

import { useCanvasStore } from '../canvasStore'
import { updateBranch } from '../../services/canvasApi'

const updateBranchMock = vi.mocked(updateBranch)

function branch(id: string, label: string, status: FlowBranch['status']): FlowBranch {
  return { id, label, parentId: null, parentNodeNode: null, parentNodeId: null, status, forkReason: '', createdAt: '', updatedAt: '' } as unknown as FlowBranch
}

function seedBranches(): void {
  useCanvasStore.setState({
    projectId: 7,
    episodesId: 101,
    branches: [
      branch('b-main', '主线A', 'active'),
      branch('b-x', '结局X', 'paused'),
      branch('b-y', '结局Y', 'draft'),
    ],
    toasts: [],
    graph: null,
  })
}

describe('selectBranchAsMain(55-06 乐观+REST+回滚)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateBranchMock.mockResolvedValue(undefined)
    seedBranches()
  })

  it('升主线成功:目标 active、原主线 archived;仅对变化分支发 PATCH', async () => {
    await useCanvasStore.getState().selectBranchAsMain('b-x')
    const st = useCanvasStore.getState()
    expect(st.branches.find((b) => b.id === 'b-x')?.status).toBe('active')
    expect(st.branches.find((b) => b.id === 'b-main')?.status).toBe('archived')
    // b-y(draft)未变化 → 不发 PATCH;共 2 次:b-x active + b-main archived
    expect(updateBranchMock).toHaveBeenCalledTimes(2)
    const statuses = updateBranchMock.mock.calls.map((c) => (c[3] as { status: string }).status).sort()
    expect(statuses).toEqual(['active', 'archived'])
    expect(st.toasts.some((t) => t.message.includes('已升为主线'))).toBe(true)
  })

  it('REST 失败 → 状态整体回滚 + 错误 toast 原文', async () => {
    updateBranchMock.mockRejectedValueOnce(new Error('boom'))
    await useCanvasStore.getState().selectBranchAsMain('b-x')
    const st = useCanvasStore.getState()
    expect(st.branches.find((b) => b.id === 'b-x')?.status).toBe('paused')
    expect(st.branches.find((b) => b.id === 'b-main')?.status).toBe('active')
    expect(st.toasts.some((t) => t.message === '主线切换失败，已恢复原状，请重试')).toBe(true)
  })

  it('上下文缺失 → 零 REST + error toast,状态不变', async () => {
    useCanvasStore.setState({ projectId: null, episodesId: 101 })
    await useCanvasStore.getState().selectBranchAsMain('b-x')
    expect(updateBranchMock).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().branches.find((b) => b.id === 'b-x')?.status).toBe('paused')
  })

  it('分支不存在 → toast「分支不存在」+ 零调用', async () => {
    await useCanvasStore.getState().selectBranchAsMain('nope')
    expect(updateBranchMock).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().toasts.some((t) => t.message === '分支不存在')).toBe(true)
  })
})

describe('applyBranchUpsert(55-06 status 真相合并)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    seedBranches()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { warnSpy.mockRestore() })

  it('按 id merge status', () => {
    useCanvasStore.getState().applyBranchUpsert('b-main', { status: 'archived' })
    expect(useCanvasStore.getState().branches.find((b) => b.id === 'b-main')?.status).toBe('archived')
  })

  it('未知 id → warn 且不动状态', () => {
    useCanvasStore.getState().applyBranchUpsert('ghost', { status: 'active' })
    const st = useCanvasStore.getState()
    expect(st.branches).toHaveLength(3)
    expect(st.branches.find((b) => b.id === 'b-main')?.status).toBe('active')
  })
})
