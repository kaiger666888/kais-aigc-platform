import { describe, it, expect } from 'vitest'
import { layoutFlowGraph } from '@kais/flowgraph-v3'
import { bridgePosition, resolveProductModality } from '../useLayout'
import {
  computeCanvasGeometry,
  computeLaneTops,
  globalLaneHeight,
  LANE_H_PKG,
} from '../../components/canvas/laneGeometry'
import { loadFixtureGraph } from '../../v3/fixtureSource'
import { V3_LAYOUT, V3_NODE_SIZES } from '../../constants'

// ─── laneGeometry（B2：十泳道带高 tokens 逐值 + 48 凹槽） ───

describe('laneGeometry', () => {
  it('computeLaneTops：带顶 = 累计带高 + 每带 48px 凹槽', () => {
    const tops = computeLaneTops([200, 280, 240])
    expect(tops).toEqual([0, 200 + 48, 200 + 48 + 280 + 48])
  })

  it('globalLaneHeight：tokens min 200，内容（40 列头 + N×136）超出时自适应', () => {
    expect(globalLaneHeight(0)).toBe(200)
    expect(globalLaneHeight(1)).toBe(200) // 40+136+16=192 < 200
    // 3 张：40 + 3×136 - 16 + 16 = 448 > 200
    expect(globalLaneHeight(3)).toBe(40 + 3 * (V3_NODE_SIZES.globalCard.height + 16))
  })

  it('computeCanvasGeometry：locked 参考区 = locked 节点包围盒 + 24 padding', () => {
    const geo = computeCanvasGeometry({
      globalAssetCount: 0,
      boxes: [
        { x: 100, y: 300, width: 240, height: 160, locked: true },
        { x: 500, y: 700, width: 240, height: 160, locked: true },
        { x: 200, y: 320, width: 240, height: 160, locked: false },
      ],
    })
    expect(geo.lockedZone).toEqual({ x: 76, y: 276, width: 688, height: 608 })
    expect(geo.bands).toHaveLength(10)
    expect(geo.globalColumn.width).toBe(V3_LAYOUT.GLOBAL_COL_WIDTH)
  })

  it('computeCanvasGeometry：无 locked 节点 → 无参考区', () => {
    const geo = computeCanvasGeometry({
      globalAssetCount: 0,
      boxes: [{ x: 0, y: 0, width: 100, height: 100, locked: false }],
    })
    expect(geo.lockedZone).toBeNull()
  })
})

// ─── bridgePosition（B7：包内 laneH 语义 → tokens 泳道几何） ───

describe('bridgePosition', () => {
  const laneTops = computeLaneTops(V3_LAYOUT.LANE_HEIGHTS)

  it('global 资产钉第 0 列：x=16，y=40+i×136（P9/§3.4）', () => {
    expect(bridgePosition({ nodeId: 'g0', scope: 'global', box: undefined, laneTops, globalSlotIndex: 0 }))
      .toEqual({ x: V3_LAYOUT.GLOBAL_COL_PAD, y: 40 })
    expect(bridgePosition({ nodeId: 'g2', scope: 'global', box: undefined, laneTops, globalSlotIndex: 2 }))
      .toEqual({ x: 16, y: 40 + 2 * 136 })
  })

  it('episode 资产：x = 包内槽位 + 主区起点 214；y = tokens 带顶 + 16 留白 + 带内偏移', () => {
    const box = { x: 0, y: 2 * LANE_H_PKG, lane: 2, layer: 0 } // storyboard 泳道
    expect(bridgePosition({ nodeId: 'a', scope: 'episode', box, laneTops, globalSlotIndex: 0 }))
      .toEqual({ x: V3_LAYOUT.MAIN_X, y: laneTops[2]! + V3_LAYOUT.LANE_TOP_INSET })
  })

  it('入种口事件芯片（x<0）留在第 0 列左侧', () => {
    const box = { x: -160, y: 3 * LANE_H_PKG, lane: 3, layer: 0 }
    const pos = bridgePosition({ nodeId: 'e', scope: undefined, box, laneTops, globalSlotIndex: 0 })
    expect(pos!.x).toBe(-160)
    expect(pos!.y).toBe(laneTops[3]! + V3_LAYOUT.LANE_TOP_INSET)
  })

  it('无 box 且无 scope → 保留原位（null）', () => {
    expect(bridgePosition({ nodeId: 'x', scope: undefined, box: undefined, laneTops, globalSlotIndex: 0 })).toBeNull()
  })
})

// ─── resolveProductModality（B4 前置：因果边 = 产物模态色） ───

describe('resolveProductModality（valid fixture）', () => {
  const graph = loadFixtureGraph('valid').graph
  const boxes = layoutFlowGraph(graph)
  expect(boxes.size).toBeGreaterThan(0)

  const assetModality = new Map(graph.nodes.filter((n) => n.kind === 'asset').map((n) => [n.id, n.modality]))
  const eventProduct = new Map<string, import('../../theme/catppuccin').Modality>()
  for (const l of graph.links) {
    if (l.role === 'output' && !eventProduct.has(l.source)) {
      const m = assetModality.get(l.target)
      if (m) eventProduct.set(l.source, m)
    }
  }

  it('event→asset output 边：颜色 = 目标资产模态', () => {
    const output = graph.links.find((l) => l.role === 'output')!
    expect(resolveProductModality(output, graph, eventProduct)).toBe(assetModality.get(output.target))
  })

  it('asset→event 因果边：颜色 = 事件产物模态（不是源资产模态）', () => {
    const causal = graph.links.find((l) => l.role !== 'output' && l.role !== 'sequence' && l.role !== 'reference' && l.role !== 'lora_ref' && l.role !== 'prompt_ref')!
    const expected = eventProduct.get(causal.target)
    expect(expected).toBeDefined()
    expect(resolveProductModality(causal, graph, eventProduct)).toBe(expected)
  })

  it('decompose fixture：98 资产全部 locked，泳道几何可算', () => {
    const dec = loadFixtureGraph('decompose').graph
    const locked = dec.nodes.filter((n) => n.kind === 'asset' && n.curation === 'locked')
    expect(locked.length).toBe(98)
    const decBoxes = layoutFlowGraph(dec)
    const geo = computeCanvasGeometry({
      globalAssetCount: 0,
      boxes: [...decBoxes.values()].map((b) => ({ x: b.x, y: b.y, width: 240, height: 160, locked: true })),
    })
    expect(geo.lockedZone).not.toBeNull()
    expect(geo.bands[2]!.top).toBe(200 + 48 + 280 + 48) // storyboard 带顶 tokens 逐值
  })
})
