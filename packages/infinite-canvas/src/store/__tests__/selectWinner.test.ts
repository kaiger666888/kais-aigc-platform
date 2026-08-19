/**
 * SELECT-02 / D-04 行为测试：canvasStore.selectWinner 前端接线（Phase 49）。
 *
 * 覆盖三条不变量（SC-2 行为闭环）：
 *  1. 乐观更新 + 后端调用（graph 路径 / 旧 RF 路径各一）；
 *  2. 端点失败 → UI 回滚（graph 路径恢复 prevGraph；旧路径 rollbackWinnerSelection
 *     恢复 prevSnapshot 的 nodes+edges）——不出现“UI 已换选但库里没写”假象；
 *  3. 包内 selectVariant 校验 throw（selectMode:'multi' 组）发生在任何 await 之前
 *     → 不部分应用、不调 API；缺项目上下文 → 早退不调 API。
 *
 * canvasApi 整模块被 mock（apiCall/真实 fetch 从未执行）；@kais/flowgraph-v3 的
 * selectVariant 走真实实现（校验语义是被测对象）。
 * 注意 fixture 枚举：selectMode 为 'single' | 'multi'（'locked' 是成员级 curation 值）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import type { VariantGroup } from '../../types/canvas'
import { asNodeId, asVariantGroupId } from '../../types/canvas'

vi.mock('../../services/canvasApi', () => ({
  approveNode: vi.fn(),
  rejectNode: vi.fn(),
  selectVariantWinner: vi.fn(),
}))

import { useCanvasStore, type ToastItem } from '../canvasStore'
import { selectVariantWinner } from '../../services/canvasApi'

const apiSelectWinner = vi.mocked(selectVariantWinner)

// ─── fixture 工厂 ───────────────────────────────────────────

function assetNode(id: string, overrides: Partial<AssetNodeV3> = {}): AssetNodeV3 {
  return {
    id,
    kind: 'asset',
    branchId: 'br_main',
    phaseIndex: 4,
    phaseName: 'video',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success',
    stage: 'video',
    modality: 'video',
    scope: 'episode',
    media: {
      original: `/assets/${id}.mp4`,
      proxy: null,
      thumbnail: null,
      waveform: null,
      durationS: 4,
    },
    meta: { stage: 'video', shotId: 'shot-001' },
    curation: 'candidate',
    stale: null,
    ...overrides,
  }
}

/** 2 成员变体组（node-a 现任 winner / node-b 挑战者），selectMode 可选。 */
function fixtureGraph(selectMode: 'single' | 'multi' = 'single'): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 1, updatedAt: 1 },
    nodes: [
      assetNode('node-a', { curation: 'selected', variantGroupId: 'vg-1' }),
      assetNode('node-b', { curation: 'deprecated', variantGroupId: 'vg-1' }),
    ],
    links: [],
    branches: [{ id: 'br_main', name: '主线' }],
    variantGroups: [
      {
        id: 'vg-1',
        branchId: 'br_main',
        phaseIndex: 4,
        sourceEventId: 'ev-1',
        variantNodeIds: ['node-a', 'node-b'],
        winnerNodeId: 'node-a',
        selectMode,
      },
    ],
  }
}

/** 旧路径（graph 为空）可变 RF fixture：node-a 现任 winner，node-b 挑战者。 */function legacyNodes(): Node[] {
  return [
    {
      id: 'node-a',
      type: 'default',
      position: { x: 0, y: 0 },
      data: { variantGroupId: 'vg-old', isWinner: true, label: 'a' },
    },
    {
      id: 'node-b',
      type: 'default',
      position: { x: 320, y: 0 },
      data: { variantGroupId: 'vg-old', isWinner: false, label: 'b' },
    },
  ]
}

function legacyEdges(): Edge[] {
  return [
    { id: 'e-a', source: 'src', target: 'node-a', data: { isInactive: false } },
    { id: 'e-b', source: 'src', target: 'node-b', data: { isInactive: true } },
  ]
}

// ─── harness ────────────────────────────────────────────────

/** 取 graph 中某资产节点的 curation（FlowNodeV3 联合类型窄化到 asset）。 */
function curationOf(graph: FlowGraphV3 | null, id: string): string | undefined {
  const n = graph?.nodes.find((x) => x.id === id)
  return n && n.kind === 'asset' ? n.curation : undefined
}

let toastSpy: Mock

/** 重置 store 到受控初值；showToast 用 spy 替换（免真实 timer + 可断言）。 */
function resetStore(partial: Record<string, unknown> = {}): void {
  toastSpy = vi.fn()
  useCanvasStore.setState(
    {
      graph: null,
      nodes: [],
      edges: [],
      variantGroups: [],
      branches: [],
      warnings: [],
      projectId: 7,
      episodesId: 101,
      toasts: [],
      showToast: toastSpy as unknown as (message: string, type?: ToastItem['type']) => void,
      ...partial,
    },
    false,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  apiSelectWinner.mockResolvedValue(undefined)
  // 兜底证明零真实网络：全局 fetch 一旦被碰即 fail
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('真实 fetch 不应被调用（canvasApi 应已 mock）') }))
})

describe('selectWinner — graph 路径（canonical FlowGraphV3）', () => {
  it('成功：乐观换选 + 恰调一次 API（参数 projectId/episodesId/groupId/nodeId）', async () => {
    resetStore({ graph: fixtureGraph('single') })
    await useCanvasStore.getState().selectWinner('node-b')

    const graph = useCanvasStore.getState().graph
    expect(graph?.variantGroups[0]?.winnerNodeId).toBe('node-b')
    expect(curationOf(graph, 'node-b')).toBe('selected')
    expect(curationOf(graph, 'node-a')).toBe('deprecated')
    expect(apiSelectWinner).toHaveBeenCalledTimes(1)
    expect(apiSelectWinner).toHaveBeenCalledWith(7, 101, 'vg-1', 'node-b')
    expect(toastSpy).toHaveBeenCalledWith('已选为优胜: node-b', 'success')
  })

  it('API 失败：回滚 prevGraph，winner 保持 node-a', async () => {
    resetStore({ graph: fixtureGraph('single') })
    apiSelectWinner.mockRejectedValueOnce(new Error('HTTP 409'))

    await useCanvasStore.getState().selectWinner('node-b')

    const graph = useCanvasStore.getState().graph
    expect(graph?.variantGroups[0]?.winnerNodeId).toBe('node-a')
    expect(curationOf(graph, 'node-a')).toBe('selected')
    expect(apiSelectWinner).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('选定失败已回滚'), 'error')
  })

  it("校验拒绝（selectMode:'multi' 组）：不发 API、winner 不变", async () => {
    resetStore({ graph: fixtureGraph('multi') })

    await useCanvasStore.getState().selectWinner('node-b')

    const graph = useCanvasStore.getState().graph
    expect(graph?.variantGroups[0]?.winnerNodeId).toBe('node-a')
    expect(curationOf(graph, 'node-b')).toBe('deprecated')
    expect(apiSelectWinner).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('选定失败'), 'error')
  })
})

describe('selectWinner — 旧路径（graph 为空的可变 RF 状态）', () => {
  it('成功：isWinner 置位 + 恰调一次 API', async () => {
    resetStore({ nodes: legacyNodes(), edges: legacyEdges() })
    await useCanvasStore.getState().selectWinner('node-b')

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'node-b')?.data?.isWinner).toBe(true)
    expect(nodes.find((n) => n.id === 'node-a')?.data?.isWinner).toBe(false)
    expect(apiSelectWinner).toHaveBeenCalledTimes(1)
    expect(apiSelectWinner).toHaveBeenCalledWith(7, 101, 'vg-old', 'node-b')
    expect(toastSpy).toHaveBeenCalledWith('已选为优胜: node-b', 'success')
  })

  it('API 失败：nodes+edges 恢复 prevSnapshot（旧 winner isWinner=true、旧边态还原）', async () => {
    const originalNodes = legacyNodes()
    const originalEdges = legacyEdges()
    resetStore({ nodes: originalNodes, edges: originalEdges })
    apiSelectWinner.mockRejectedValueOnce(new Error('HTTP 500'))

    await useCanvasStore.getState().selectWinner('node-b')

    const state = useCanvasStore.getState()
    expect(state.nodes.find((n) => n.id === 'node-a')?.data?.isWinner).toBe(true)
    expect(state.nodes.find((n) => n.id === 'node-b')?.data?.isWinner).toBe(false)
    // 边回滚：node-a 边恢复 active，node-b 边回到 inactive（prevSnapshot 引用整体还原）
    expect(state.edges.find((e) => e.id === 'e-a')?.data?.isInactive).toBe(false)
    expect(state.edges.find((e) => e.id === 'e-b')?.data?.isInactive).toBe(true)
    expect(apiSelectWinner).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('选定失败已回滚'), 'error')
  })

  // ── WR-05/WR-06 回归：旧路径 variantGroups 精确定位 + 回滚恢复 ──────────
  /** 两个旧式组，目标组 vg-old 故意放在**第二位**（暴露旧代码 [0] 取错组）。 */
  function legacyGroups(): VariantGroup[] {
    const g = (groupId: string, parentNodeId: string, members: string[], winner: string): VariantGroup => ({
      groupId: asVariantGroupId(groupId),
      parentNodeId: asNodeId(parentNodeId),
      variantNodeIds: members.map(asNodeId),
      winnerNodeId: asNodeId(winner),
      createdAt: '2026-01-01T00:00:00Z',
    })
    return [
      g('vg-other', 'p-other', ['node-z'], 'node-z'),
      g('vg-old', 'p', ['node-a', 'node-b'], 'node-a'),
    ]
  }

  it('WR-05 成功：目标组不在首位时 variantGroups[].winnerNodeId 仍被更新（旧代码 [0] 取错组）', async () => {
    resetStore({ nodes: legacyNodes(), edges: legacyEdges(), variantGroups: legacyGroups() })
    await useCanvasStore.getState().selectWinner('node-b')

    const groups = useCanvasStore.getState().variantGroups
    expect(groups.find((g) => g.groupId === 'vg-old')?.winnerNodeId).toBe('node-b')
    // 兄弟组不受牵连
    expect(groups.find((g) => g.groupId === 'vg-other')?.winnerNodeId).toBe('node-z')
    expect(apiSelectWinner).toHaveBeenCalledWith(7, 101, 'vg-old', 'node-b')
  })

  it('WR-06 API 失败：variantGroups 一并回滚（不残留新 winner 的 SC-2 不一致）', async () => {
    resetStore({ nodes: legacyNodes(), edges: legacyEdges(), variantGroups: legacyGroups() })
    apiSelectWinner.mockRejectedValueOnce(new Error('HTTP 500'))

    await useCanvasStore.getState().selectWinner('node-b')

    const state = useCanvasStore.getState()
    expect(state.variantGroups.find((g) => g.groupId === 'vg-old')?.winnerNodeId).toBe('node-a')
    expect(state.variantGroups.find((g) => g.groupId === 'vg-other')?.winnerNodeId).toBe('node-z')
    // nodes 回滚照旧成立
    expect(state.nodes.find((n) => n.id === 'node-a')?.data?.isWinner).toBe(true)
  })
})

describe('selectWinner — 上下文守卫', () => {
  it('缺 projectId：早退、不调 API', async () => {
    resetStore({ graph: fixtureGraph('single'), projectId: null })
    await useCanvasStore.getState().selectWinner('node-b')

    expect(apiSelectWinner).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().graph?.variantGroups[0]?.winnerNodeId).toBe('node-a')
    expect(toastSpy).toHaveBeenCalledWith('缺少项目上下文', 'warning')
  })

  it('缺 episodesId：早退、不调 API', async () => {
    resetStore({ graph: fixtureGraph('single'), episodesId: null })
    await useCanvasStore.getState().selectWinner('node-b')

    expect(apiSelectWinner).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith('缺少项目上下文', 'warning')
  })
})
