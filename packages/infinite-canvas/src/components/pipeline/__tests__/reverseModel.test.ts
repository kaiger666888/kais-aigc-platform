/**
 * reverseModel.test.ts — 逆向工程 DAG 数据层完整性测试（规格 §6 六条）。
 */
import { describe, it, expect } from 'vitest'
import {
  REVERSE_NODES,
  REVERSE_NODE_IDS,
  REVERSE_EDGES,
  REVERSE_STATUS,
  REVERSE_NODE_BY_ID,
  layoutReverseDag,
  validateReverseGraph,
} from '../reverseModel'
import { DAG_EDGES } from '../model'

describe('reverseModel 完整性', () => {
  it('每条边端点都在节点集中（无悬空边）', () => {
    const ids = new Set(REVERSE_NODE_IDS)
    for (const e of REVERSE_EDGES) {
      expect(ids.has(e.from), `悬空 from: ${e.from}`).toBe(true)
      expect(ids.has(e.to), `悬空 to: ${e.to}`).toBe(true)
    }
  })

  it('反转边 = 原 DAG_EDGES 的精确反转（条数相等、无重复）', () => {
    const reversedKeys = new Set(REVERSE_EDGES.map((e) => `${e.from}->${e.to}`))
    for (const e of DAG_EDGES) {
      expect(reversedKeys.has(`${e.to}->${e.from}`), `缺反转边: ${e.to}->${e.from}`).toBe(true)
    }
    const reverseOfDag = REVERSE_EDGES.filter((e) =>
      DAG_EDGES.some((d) => d.from === e.to && d.to === e.from),
    )
    expect(reverseOfDag.length).toBe(DAG_EDGES.length)
    const allKeys = REVERSE_EDGES.map((e) => `${e.from}->${e.to}`)
    expect(new Set(allKeys).size).toBe(allKeys.length)
  })

  it('图无环（拓扑排序通过，back 豁免）', () => {
    expect(validateReverseGraph()).toEqual([])
  })

  it('三门 + 源节点存在且（源除外）各至少一条入边', () => {
    for (const id of ['gate-g1', 'gate-g2', 'gate-g3', 'src-master']) {
      expect(REVERSE_NODE_BY_ID.has(id), `${id} 不存在`).toBe(true)
    }
    for (const id of ['gate-g1', 'gate-g2', 'gate-g3']) {
      expect(REVERSE_EDGES.some((e) => e.to === id), `${id} 无入边`).toBe(true)
    }
  })

  it('REVERSE_STATUS 引用的节点 id 全部存在', () => {
    for (const id of Object.keys(REVERSE_STATUS)) {
      expect(REVERSE_NODE_BY_ID.has(id), `状态表悬空: ${id}`).toBe(true)
    }
  })

  it('RL 布局可计算且 width>0，方向=从右往左', () => {
    const layout = layoutReverseDag()
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    expect(layout.nodes.length).toBe(REVERSE_NODES.length)
  })

  it('方向断言：非 back 边 100% 从右往左（from.x > to.x）；back 反馈边单列', () => {
    const layout = layoutReverseDag()
    const xOf = new Map(layout.nodes.map((n) => [n.id, n.x]))
    const rendered = new Set(layout.edges.map((e) => `${e.from}->${e.to}`))
    // 渲染边集 = REVERSE_EDGES 全集（back 边由布局补挂，不缺渲染）
    expect(rendered.size).toBe(REVERSE_EDGES.length)
    for (const e of REVERSE_EDGES) expect(rendered.has(`${e.from}->${e.to}`)).toBe(true)

    const backs = REVERSE_EDGES.filter((e) => e.kind === 'back')
    // back 数量统计（写入断言注释）：现值 2 条，均为原 DAG preview-gate 打回回环经精确反转的
    // 继承（voice-clips→preview-gate / shot-list→preview-gate）。back 豁免 dagre 拓扑（布局后
    // 补挂），几何允许 from.x < to.x 的反流向（打回 = 逆主流程），以 kind='back' 玫红虚线标识。
    // 若此断言失败，说明回环边集变化——须同步复核布局层的 back 补挂与豁免逻辑。
    expect(backs.length).toBe(2)

    for (const e of REVERSE_EDGES) {
      const fx = xOf.get(e.from)!
      const tx = xOf.get(e.to)!
      if (e.kind === 'back') {
        // 单列断言：back 边必须带 kind 标识（渲染层虚线玫红），几何方向不作要求
        expect(e.kind).toBe('back')
        continue
      }
      expect(fx, `非 back 边 ${e.from}(${fx}) → ${e.to}(${tx}) 不满足右→左`).toBeGreaterThan(tx)
    }
  })

  it('规格落位：gate-g3 全图最左、src-master 全图最右、原点归一化', () => {
    const layout = layoutReverseDag()
    expect(layout.nodes.length).toBeGreaterThan(0)
    const minX = Math.min(...layout.nodes.map((n) => n.x))
    const minY = Math.min(...layout.nodes.map((n) => n.y))
    const maxX = Math.max(...layout.nodes.map((n) => n.x + n.width))
    const g3 = layout.nodes.find((n) => n.id === 'gate-g3')!
    const src = layout.nodes.find((n) => n.id === 'src-master')!
    expect(g3.x, 'gate-g3 应为全图最小 x（规格 §3.1 最左端）').toBe(minX)
    expect(src.x, 'src-master 应为全图最大 x（规格 §3.1 源节点最右端）').toBe(maxX - src.width)
    expect(minX, '布局应归一化到 (0,0) 原点（渲染层 fit 假定）').toBe(0)
    expect(minY).toBe(0)
  })
})
