/**
 * WRITE-02 行为测试：canvasStore.deleteNode（Phase 51-03）。
 *
 * 覆盖四组不变量：
 *  a. canonical 图变换：删除后 graph 无该节点、无 source/target 触及它的 link；
 *  b. variantGroups 清理：节点是组 winner → winnerNodeId 清空；组成员清空 → 整组删除
 *    （T-51-03-03：不残留悬空 winner 引用/空组）；
 *  c. 持久化：经统一 saveCanvasGraph（save-v2，51-01 通道，不新增 delete 端点），
 *     payload 为 FlowGraphV2 wire 形状（meta.version==='2'）且节点集无被删 id；
 *  d. 失败回滚：mock reject → 被删实体（节点/links/组）外科式插回当前图 + error toast
 *     （W1 修复：approveNode 同款 field-level restore 语义，不整图还原 prevGraph）；
 *  e. 并发写入回归（W1）：await 期间落入的 canonical 写入（applySocketNodeState）
 *     在回滚后存活，且被删节点同时被恢复。
 *
 * canvasApi 整模块被 mock（零真实网络）；serializeGraphToV2 走真实实现
 *（payload 形状是被测对象）。fixture 图 rawDataByNodeId === null（退化路径，
 * 序列化器不得 throw——地雷 #6）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import type { AssetNodeV3, FlowGraphV3, FlowLinkV3, VariantGroupV3 } from '@kais/flowgraph-v3'

vi.mock('../../services/canvasApi', () => ({
  approveNode: vi.fn(),
  rejectNode: vi.fn(),
  selectVariantWinner: vi.fn(),
  saveCanvasGraph: vi.fn(),
}))

import { useCanvasStore, type ToastItem } from '../canvasStore'
import { saveCanvasGraph } from '../../services/canvasApi'

const apiSaveCanvasGraph = vi.mocked(saveCanvasGraph)

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

function link(id: string, source: string, target: string): FlowLinkV3 {
  return { id, source, target, branchId: 'br_main', role: 'sequence' }
}

function variantGroup(id: string, members: string[], winner?: string): VariantGroupV3 {
  return {
    id,
    branchId: 'br_main',
    phaseIndex: 4,
    sourceEventId: `ev-${id}`,
    variantNodeIds: members,
    ...(winner ? { winnerNodeId: winner } : {}),
    selectMode: 'single',
  }
}

/**
 * 三节点图：node-a/node-b 在组 vg-1（node-a 是 winner），node-c 是组 vg-solo
 * 唯一成员。links：l-ac（a→c）、l-cb（c→b，两条触及 node-c）、l-ab（a→b，
 * 不触及 node-c）。
 */
function fixtureGraph(): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 1, updatedAt: 1 },
    nodes: [
      assetNode('node-a', { curation: 'selected', variantGroupId: 'vg-1' }),
      assetNode('node-b', { curation: 'deprecated', variantGroupId: 'vg-1' }),
      assetNode('node-c', { variantGroupId: 'vg-solo' }),
    ],
    links: [link('l-ac', 'node-a', 'node-c'), link('l-cb', 'node-c', 'node-b'), link('l-ab', 'node-a', 'node-b')],
    branches: [{ id: 'br_main', name: '主线' }],
    variantGroups: [variantGroup('vg-1', ['node-a', 'node-b'], 'node-a'), variantGroup('vg-solo', ['node-c'])],
  }
}

// ─── harness ────────────────────────────────────────────────

let toastSpy: Mock

/** 重置 store 到受控初值；showToast 用 spy 替换（免真实 timer + 可断言）。 */
function resetStore(partial: Record<string, unknown> = {}): void {
  toastSpy = vi.fn()
  useCanvasStore.setState(
    {
      graph: null,
      rawDataByNodeId: null,
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
  apiSaveCanvasGraph.mockResolvedValue(undefined)
  // 兜底证明零真实网络：全局 fetch 一旦被碰即 fail
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('真实 fetch 不应被调用（canvasApi 应已 mock）') }))
})

describe('deleteNode — canonical 图变换 + save-v2 持久化', () => {
  it('a. 删除后 graph 无该节点、无触及它的 link；不触及的 link 保留', async () => {
    resetStore({ graph: fixtureGraph() })
    await useCanvasStore.getState().deleteNode('node-c')

    const graph = useCanvasStore.getState().graph
    expect(graph?.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b'])
    expect(graph?.links.map((l) => l.id)).toEqual(['l-ab'])
    expect(apiSaveCanvasGraph).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith('已删除节点: node-c', 'success')
  })

  it('b. winner 清理 + 空组删除：删 winner 清 winnerNodeId；删唯一成员删整组', async () => {
    resetStore({ graph: fixtureGraph() })
    // 删 vg-1 的 winner node-a：组保留（node-b 仍在），winnerNodeId 清空
    await useCanvasStore.getState().deleteNode('node-a')
    let graph = useCanvasStore.getState().graph
    const vg1 = graph?.variantGroups.find((g) => g.id === 'vg-1')
    expect(vg1?.variantNodeIds).toEqual(['node-b'])
    expect(vg1?.winnerNodeId).toBeUndefined()

    // 删 vg-solo 唯一成员 node-c：整组删除
    resetStore({ graph: fixtureGraph() })
    apiSaveCanvasGraph.mockResolvedValue(undefined)
    await useCanvasStore.getState().deleteNode('node-c')
    graph = useCanvasStore.getState().graph
    expect(graph?.variantGroups.find((g) => g.id === 'vg-solo')).toBeUndefined()
    // 兄弟组不受牵连
    expect(graph?.variantGroups.find((g) => g.id === 'vg-1')?.winnerNodeId).toBe('node-a')
  })

  it('c. saveCanvasGraph payload 为 FlowGraphV2 wire 形状且节点集无被删 id', async () => {
    resetStore({ graph: fixtureGraph() })
    await useCanvasStore.getState().deleteNode('node-c')

    expect(apiSaveCanvasGraph).toHaveBeenCalledTimes(1)
    const [pid, eid, payload] = apiSaveCanvasGraph.mock.calls[0]
    expect(pid).toBe(7)
    expect(eid).toBe(101)
    const wire = payload as { meta: { version: string }; nodes: Array<{ id: string; branchId: string }>; links: Array<{ source: string; target: string }> }
    expect(wire.meta.version).toBe('2')
    expect(wire.nodes.map((n) => n.id)).not.toContain('node-c')
    expect(wire.nodes.every((n) => typeof n.branchId === 'string')).toBe(true)
    expect(wire.links.some((l) => l.source === 'node-c' || l.target === 'node-c')).toBe(false)
  })

  it('d. 持久化失败：被删节点/links/组外科式恢复 + error toast', async () => {
    const prev = fixtureGraph()
    resetStore({ graph: prev })
    apiSaveCanvasGraph.mockRejectedValueOnce(new Error('HTTP 500'))

    await useCanvasStore.getState().deleteNode('node-c')

    const graph = useCanvasStore.getState().graph
    // 节点 / 边 / 组全部按原位恢复
    expect(graph?.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b', 'node-c'])
    expect(graph?.links.map((l) => l.id)).toEqual(['l-ac', 'l-cb', 'l-ab'])
    expect(graph?.variantGroups.find((g) => g.id === 'vg-solo')).toBeDefined()
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('删除失败已回滚'), 'error')
  })

  it('e. W1 回归：await 期间的并发 canonical 写入在回滚后存活，被删节点同时恢复', async () => {
    resetStore({ graph: fixtureGraph() })
    // 手工控制 save 的 reject 时机：让删除乐观上屏后、持久化 resolve 前
    // 插入一笔并发 canonical 写入（socket node:state 落在另一节点上）
    let rejectSave!: (err: Error) => void
    apiSaveCanvasGraph.mockImplementationOnce(
      () => new Promise<void>((_, rej) => { rejectSave = rej }),
    )

    const pending = useCanvasStore.getState().deleteNode('node-c')
    // 删除已乐观上屏
    expect(useCanvasStore.getState().graph?.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b'])

    // 并发写入：node-b 状态推进 + node-a 缩略图（applySocketNodeState/Preview 通道）
    useCanvasStore.getState().applySocketNodeState('node-b', 'running', 42)
    useCanvasStore.getState().applySocketNodePreview('node-a', '/thumbs/node-a.png')

    rejectSave(new Error('HTTP 500'))
    await pending

    const graph = useCanvasStore.getState().graph
    // 被删节点 + 触及 links + 组恢复
    expect(graph?.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b', 'node-c'])
    expect(graph?.links.map((l) => l.id)).toEqual(['l-ac', 'l-cb', 'l-ab'])
    expect(graph?.variantGroups.find((g) => g.id === 'vg-solo')).toBeDefined()
    // 并发 canonical 写入未被回滚抹掉（W1：整图还原 prevGraph 时这两笔会丢失）
    expect(graph?.nodes.find((n) => n.id === 'node-b')?.state).toBe('running')
    const nodeA = graph?.nodes.find((n) => n.id === 'node-a')
    expect(nodeA?.kind === 'asset' ? nodeA.media.thumbnail : null).toBe('/thumbs/node-a.png')
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('删除失败已回滚'), 'error')
  })
})

describe('deleteNode — 早退守卫', () => {
  it('graph 为空：早退、不调 API', async () => {
    resetStore({ graph: null })
    await useCanvasStore.getState().deleteNode('node-c')
    expect(apiSaveCanvasGraph).not.toHaveBeenCalled()
  })

  it('节点不存在：早退、不调 API', async () => {
    resetStore({ graph: fixtureGraph() })
    await useCanvasStore.getState().deleteNode('node-ghost')
    expect(apiSaveCanvasGraph).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().graph?.nodes).toHaveLength(3)
  })

  it('缺项目上下文：早退、不调 API、warning toast（不做"假成功"乐观删）', async () => {
    resetStore({ graph: fixtureGraph(), projectId: null })
    await useCanvasStore.getState().deleteNode('node-c')
    expect(apiSaveCanvasGraph).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().graph?.nodes).toHaveLength(3)
    expect(toastSpy).toHaveBeenCalledWith('缺少项目上下文', 'warning')
  })
})
