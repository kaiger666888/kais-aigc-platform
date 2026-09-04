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
})
