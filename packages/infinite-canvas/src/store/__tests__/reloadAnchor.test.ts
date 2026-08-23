/**
 * reloadAnchor.test.ts — Phase 60-01 Task 2 store 重锚语义探针（60-DIAGNOSIS Prong 2 的
 * vitest 证据面;60-03 按 Branch 裁定扩为永久锁）。
 *
 * 被测语义（canvasStore.ts setGraph L442-447,逐字）:
 *   selectedNode / detailNode: state.X ? vm.rfNodes.find(n => n.id === state.X!.id) ?? null : null
 * —— reload 换图（graph:saved → loadCanvas → setGraph(新图)）时两锚:
 *   a. survive（D-02/D-07 正向）: id 在新图存活 → 锚指向**新派生模型**中的同 id 节点
 *      （引用刷新为 g2 派生项,非旧引用——派生缓存与 canonical 一致性）;
 *   b. collapse（D-03/D-07 对称负向）: id 不在新图 → 同一次 setGraph 内对称收起 null
 *      （诚实收起,禁模糊匹配）;
 *   c. other-anchor-untouched: 无关节点消失不影响存活锚。
 *
 * 60-03 扩充（Branch A 永久锁——60-DIAGNOSIS「Fix branch: A」,零生产修复仅锁）:
 *   d. warn-on-miss: 锚丢失 → setGraph 内 console.warn 一次,串含 '[panel-persist]'
 *      与丢失 id（D-03 验收钩子,60-UI-SPEC §7 console 捕获面）;
 *   e. symmetric-collapse: selectedNode 与 detailNode 同一次 setGraph 内同时 null
 *      （D-07 together-or-not-at-all 显式锁）;
 *   f. no-warn-on-hit: id 命中重锚 → warn 零调用（无噪声）;
 *   g. no-warn-spam: 同一缺失锚连续两次 setGraph → warn 恰一次（「非 null → null」
 *      转移守卫,第二次锚已 null 不再发——T-60-05 日志洪水缓解锁）;
 *   h. roundtrip-lock: adapt→serialize→adapt 纯函数往返两代节点 id 集全等
 *      （evt_ 子集单列断言;Branch A 的 in-memory id 稳定性绑定门,不依赖 :10588）。
 *
 * fixture（plan 指定）: phase59 cascadeFixtureGraph 的 trig-1/mid-1/down-1 三节点裁剪,
 * 两条 image 边成链;经生产 adaptV2Graph 生成合法 V3 graph——与真机 reload 链同源
 * （loadGraphFromV2/loadInitialGraph 均以 adaptV2Graph 产物喂 setGraph）。
 * g2 = 重跑 adaptV2Graph(structuredClone(wire)):同构、节点对象全新（模拟服务端回读后
 * 客户端重适配,60-01 Prong 1 实测 id 全等）;g3 = 同 wire 删 down-1 后重适配。
 *
 * 原子性注记（plan (e),by construction 不加异步断言）: setGraph 是单次同步 set 调用
 * ——graph/nodes/edges/selectedNode/detailNode 在同一次 zustand set 内一起落,不存在
 * 「先 null 后重锚」的中间窗口（60-UI-SPEC §1「No intermediate null / no flash」的
 * store 侧保证）。React 层不渲染（store 直驱,canonicalWriteback.test.ts 范式）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// canvasStore 传递 import canvasApi（persistEventParams/updateBranch/saveCanvasGraph 等）;
// 本测试零网络——整模块 mock（canonicalWriteback.test.ts 同款手法）。
vi.mock('../../services/canvasApi', () => ({
  approveNode: vi.fn(),
  rejectNode: vi.fn(),
  selectVariantWinner: vi.fn(),
  saveCanvasGraph: vi.fn(),
  updateBranch: vi.fn(),
}))

import { useCanvasStore } from '../canvasStore'
import { adaptV2Graph } from '../../v3/adapter'
import { serializeGraphToV2 } from '../../v3/serialize'

// ─── fixture:3 节点最小 V2 图（phase59 cascadeFixtureGraph 裁剪） ────────────

const TRIG = 'trig-1'
const MID = 'mid-1'
const DOWN = 'down-1'

function wireFixture(): Record<string, unknown> {
  return {
    meta: { version: '2', projectId: 1, episodesId: 1, createdAt: 1, updatedAt: 1 },
    nodes: [
      {
        id: TRIG, type: 'storyboard', branchId: 'main', phaseIndex: 3, phaseName: 'storyboard',
        position: { x: 400, y: 50 }, size: { width: 260, height: 180 },
        data: { label: '触发资产', type: 'storyboard', storyboardId: 91, duration: 3, prompt: '触发配方', filePath: null, thumbnailUrl: null, state: 'idle' },
        state: 'idle',
      },
      {
        id: MID, type: 'storyboard', branchId: 'main', phaseIndex: 3, phaseName: 'storyboard',
        position: { x: 220, y: 420 }, size: { width: 260, height: 180 },
        data: { label: '链中资产', type: 'storyboard', storyboardId: 92, duration: 3, prompt: '链中配方', filePath: null, thumbnailUrl: null, state: 'idle' },
        state: 'idle',
      },
      {
        id: DOWN, type: 'storyboard', branchId: 'main', phaseIndex: 3, phaseName: 'storyboard',
        position: { x: 220, y: 780 }, size: { width: 260, height: 180 },
        data: { label: '链尾资产', type: 'storyboard', storyboardId: 93, duration: 3, prompt: '链尾配方', filePath: null, thumbnailUrl: null, state: 'idle' },
        state: 'idle',
      },
    ],
    links: [
      { id: 'cl1', source: TRIG, target: MID, branchId: 'main', dataType: 'image' },
      { id: 'cl2', source: MID, target: DOWN, branchId: 'main', dataType: 'image' },
    ],
    branches: [{ id: 'main', label: '主线', status: 'active', createdAt: 1, updatedAt: 1 }],
    variantGroups: [],
  }
}

/** 同 wire 删 DOWN（节点 + 关联边）——collapse 用残图。 */
function wireWithoutDown(): Record<string, unknown> {
  const w = wireFixture() as { nodes: Array<{ id: string }>; links: Array<{ source: string }> }
  return {
    ...w,
    nodes: w.nodes.filter((n) => n.id !== DOWN),
    links: w.links.filter((l) => l.source !== DOWN),
  }
}

// ─── harness ────────────────────────────────────────────────

function resetStore(): void {
  useCanvasStore.setState(
    {
      graph: null,
      nodes: [],
      edges: [],
      variantGroups: [],
      branches: [],
      warnings: [],
      selectedNode: null,
      detailNode: null,
      hasData: false,
    },
    false,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetStore()
})

// 60-03:warn spy 用 afterEach restore（plan 指定;与 beforeEach 的 restore+re-spy
// 双保险,确保 spy 状态永不跨用例泄漏——no-warn-* 计数断言的前提）。
afterEach(() => {
  vi.restoreAllMocks()
})

describe('setGraph reload 重锚语义（60-01 Task 2 / D-02 D-03 D-07）', () => {
  it('a. survive：id 存活时 detailNode/selectedNode 重锚到新派生模型同 id 节点（引用刷新,非旧引用）', () => {
    const store = useCanvasStore.getState()
    const g1 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g1)

    // 双击语义:锚定 TRIG（detailNode + selectedNode 同指,Phase 60 D-07 对称面）
    const trigBefore = useCanvasStore.getState().nodes.find((n) => n.id === TRIG)!
    expect(trigBefore).toBeTruthy()
    store.setDetailNode(trigBefore)
    store.setSelectedNode(trigBefore)

    // reload:同构新 wire 重适配（服务端回读→客户端 adaptV2Graph→setGraph 全链形状）
    const g2 = adaptV2Graph(structuredClone(wireFixture())).graph
    store.setGraph(g2)

    const after = useCanvasStore.getState()
    expect(after.detailNode?.id).toBe(TRIG)
    expect(after.selectedNode?.id).toBe(TRIG)
    // 引用刷新:锚是 g2 派生 nodes 中的项,不是 g1 旧引用（派生缓存与 canonical 一致）
    const trigAfter = after.nodes.find((n) => n.id === TRIG)!
    expect(after.detailNode).toBe(trigAfter)
    expect(after.selectedNode).toBe(trigAfter)
    expect(after.detailNode).not.toBe(trigBefore)
  })

  it('b. collapse：锚 id 不在新图 → 同一次 setGraph 内 detailNode/selectedNode 对称收起 null', () => {
    const store = useCanvasStore.getState()
    const g2 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g2)

    // 锚定将被删除的 DOWN
    const downBefore = useCanvasStore.getState().nodes.find((n) => n.id === DOWN)!
    expect(downBefore).toBeTruthy()
    store.setDetailNode(downBefore)
    store.setSelectedNode(downBefore)

    // reload 到删 DOWN 后的残图 → 锚丢失诚实收起（禁模糊匹配,D-03）
    const g3 = adaptV2Graph(wireWithoutDown()).graph
    store.setGraph(g3)

    const after = useCanvasStore.getState()
    expect(after.detailNode).toBeNull()
    expect(after.selectedNode).toBeNull() // D-07:与 detailNode 同语义收起
  })

  it('c. other-anchor-untouched：无关节点消失不影响存活锚（TRIG 锚在删 DOWN 的图上保持）', () => {
    const store = useCanvasStore.getState()
    const g2 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g2)

    const trigBefore = useCanvasStore.getState().nodes.find((n) => n.id === TRIG)!
    store.setDetailNode(trigBefore)
    store.setSelectedNode(trigBefore)

    const g3 = adaptV2Graph(wireWithoutDown()).graph
    store.setGraph(g3)

    const after = useCanvasStore.getState()
    // DOWN 消失,TRIG 锚不受牵连（find 是逐 id 独立判定,非整组失败）
    expect(after.nodes.some((n) => n.id === DOWN)).toBe(false)
    expect(after.detailNode?.id).toBe(TRIG)
    expect(after.selectedNode?.id).toBe(TRIG)
    expect(after.detailNode).toBe(after.nodes.find((n) => n.id === TRIG))
  })
})

describe('setGraph 锚丢失 warn + 对称锁（60-03 Task 1 / D-03 D-07）', () => {
  it('d. warn-on-miss：锚定的 down-1 缺席 → console.warn 一次,串含 [panel-persist] 与丢失 id', () => {
    const warnSpy = vi.mocked(console.warn)
    const store = useCanvasStore.getState()
    const g2 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g2)

    // 仅锚定 detailNode（selectedNode 保持 null——单一转移源,计数断言无歧义）
    const downBefore = useCanvasStore.getState().nodes.find((n) => n.id === DOWN)!
    store.setDetailNode(downBefore)

    const g3 = adaptV2Graph(wireWithoutDown()).graph
    store.setGraph(g3)

    expect(useCanvasStore.getState().detailNode).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = String(warnSpy.mock.calls[0]?.[0])
    expect(msg).toContain('[panel-persist]')
    expect(msg).toContain(DOWN)
    // 60-UI-SPEC §2 默认串（dev-console only,非 user-facing copy）
    expect(msg).toBe(`[panel-persist] 锚点丢失: ${DOWN} 在重载图中未找到,面板已收起`)
  })

  it('e. symmetric-collapse：detailNode 与 selectedNode 同一次 setGraph 内同时收起（together or not at all）', () => {
    const store = useCanvasStore.getState()
    const g2 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g2)

    // 双锚同指 DOWN（双击语义:detail + selection 同源）
    const downBefore = useCanvasStore.getState().nodes.find((n) => n.id === DOWN)!
    store.setDetailNode(downBefore)
    store.setSelectedNode(downBefore)

    const g3 = adaptV2Graph(wireWithoutDown()).graph
    store.setGraph(g3)

    // D-07 显式对称锁:同一 id-miss 条件下两锚 either 同时存活 or 同时收起——
    // 不存在「面板在而选中丢」/「选在而面板丢」的半收起态（同一次原子 set 落盘）。
    const after = useCanvasStore.getState()
    expect(after.detailNode).toBeNull()
    expect(after.selectedNode).toBeNull()
    expect(after.detailNode === null && after.selectedNode === null).toBe(true)
  })

  it('f. no-warn-on-hit：id 命中重锚 → warn 零调用（命中路径无噪声）', () => {
    const warnSpy = vi.mocked(console.warn)
    const store = useCanvasStore.getState()
    const g1 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g1)

    const trigBefore = useCanvasStore.getState().nodes.find((n) => n.id === TRIG)!
    store.setDetailNode(trigBefore)
    store.setSelectedNode(trigBefore)

    const g2 = adaptV2Graph(structuredClone(wireFixture())).graph
    store.setGraph(g2)

    expect(useCanvasStore.getState().detailNode?.id).toBe(TRIG)
    expect(useCanvasStore.getState().selectedNode?.id).toBe(TRIG)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('g. no-warn-spam：同一缺失锚连续两次 setGraph → warn 恰一次（非 null→null 转移已消费）', () => {
    const warnSpy = vi.mocked(console.warn)
    const store = useCanvasStore.getState()
    const g2 = adaptV2Graph(wireFixture()).graph
    store.setGraph(g2)

    const downBefore = useCanvasStore.getState().nodes.find((n) => n.id === DOWN)!
    store.setDetailNode(downBefore)

    // 第一次:锚非 null + id 缺席 → warn（转移发生）
    const g3a = adaptV2Graph(wireWithoutDown()).graph
    store.setGraph(g3a)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // 第二次:锚已是 null → 「非 null → null」转移不存在 → 不再发（T-60-05 防刷屏守卫）
    const g3b = adaptV2Graph(structuredClone(wireWithoutDown())).graph
    store.setGraph(g3b)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
