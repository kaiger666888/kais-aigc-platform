import { describe, it, expect } from 'vitest'
import { layoutFlowGraph } from '@kais/flowgraph-v3'
import { bridgePosition, resolveProductModality } from '../useLayout'
import {
  computeCanvasGeometry,
  computeLaneTops,
  computePhaseColumns,
  computePhaseGridPlan,
  globalLaneHeight,
  laneHeightFromRows,
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

  it('laneHeightFromRows：max(基准带高, 行数 × 行高)', () => {
    expect(laneHeightFromRows(240, 1, 192)).toBe(240) // 1 行 192 < 基准 240 → 基准
    expect(laneHeightFromRows(240, 2, 192)).toBe(384) // 2 行 384 > 240
    expect(laneHeightFromRows(240, 5, 192)).toBe(960) // 5 行 → 960（真实 script 泳道量级）
  })

  it('computeCanvasGeometry：传入 heights 覆盖 LANE_HEIGHTS 派生（换行带高透传）', () => {
    const geo = computeCanvasGeometry({
      globalAssetCount: 0,
      heights: [200, 960, 240, 240, 240, 180, 180, 180, 180, 280],
      boxes: [{ x: 0, y: 0, width: 240, height: 160, locked: false }],
    })
    expect(geo.bands[1]!.height).toBe(960) // script 泳道换行后带高
    expect(geo.bands[2]!.top).toBe(200 + 48 + 960 + 48) // storyboard 带顶随 script 撑高下移
  })
})

// ─── computePhaseColumns（竖向创作阶段叠加层：median-x 投影，不动布局引擎） ───

describe('computePhaseColumns', () => {
  const cat = [
    { index: 1, name: 'P01 · 选题' },
    { index: 2, name: 'P02 · 大纲' },
    { index: 3, name: 'P03 · 剧本' },
  ]

  it('按各阶段 median-x 升序排成非重叠竖带，边界=相邻 median 中点', () => {
    const cols = computePhaseColumns({
      mainX: 214,
      phaseCatalog: cat,
      nodes: [
        { x: 300, width: 240, phaseIndex: 1 }, // 中心 420
        { x: 360, width: 240, phaseIndex: 1 }, // 中心 480 → P1 median 450
        { x: 900, width: 240, phaseIndex: 2 }, // 中心 1020
        { x: 1500, width: 240, phaseIndex: 3 }, // 中心 1620
      ],
    })
    expect(cols.map((c) => c.index)).toEqual([1, 2, 3])
    // P1 中心 = median(420, 480) = 450；P2 中心 = 1020；P3 中心 = 1620
    // 边界 P1|P2 = (450+1020)/2 = 735；P2|P3 = (1020+1620)/2 = 1320
    const [c1, c2, c3] = cols
    expect(c1!.x1).toBeCloseTo(735, 5)
    expect(c2!.x0).toBeCloseTo(735, 5)
    expect(c2!.x1).toBeCloseTo(1320, 5)
    expect(c3!.x0).toBeCloseTo(1320, 5)
    // 首带左缘夹在 mainX（median - halfStep < mainX → 取 mainX）
    expect(c1!.x0).toBe(214)
  })

  it('排除 global 第 0 列（中心 x ≤ mainX）节点', () => {
    const cols = computePhaseColumns({
      mainX: 214,
      phaseCatalog: cat,
      nodes: [
        { x: 16, width: 168, phaseIndex: 1 }, // global 列（中心 100 ≤ 214）→ 排除
        { x: 400, width: 240, phaseIndex: 2 },
      ],
    })
    expect(cols.map((c) => c.index)).toEqual([2])
  })

  it('无 phaseIndex 节点 / 无有效节点 → 空数组', () => {
    expect(computePhaseColumns({ mainX: 214, nodes: [{ x: 400, width: 240 }] })).toEqual([])
    expect(computePhaseColumns({ mainX: 214, nodes: [] })).toEqual([])
  })

  it('name 取自 phaseCatalog，group 取自 PHASE_GROUPS', () => {
    const cols = computePhaseColumns({
      mainX: 214,
      phaseCatalog: cat,
      nodes: [{ x: 400, width: 240, phaseIndex: 1 }],
    })
    expect(cols[0]!.name).toBe('P01 · 选题')
    expect(cols[0]!.group).toBe('research') // PHASE_GROUPS[1]
  })
})

// ─── computePhaseGridPlan（阶段网格：x 主排序键 = phaseIndex，global 资产随阶段） ───

describe('computePhaseGridPlan', () => {
  const slotStride = 240 + V3_LAYOUT.NODE_GAP_X // 288
  const mainX = V3_LAYOUT.MAIN_X

  it('阶段按 index 升序铺成邻接非重叠竖带，x 随 index 单调', () => {
    const plan = computePhaseGridPlan({
      mainX,
      slotStride,
      gap: V3_LAYOUT.NODE_GAP_X,
      maxRowsPerBand: 4,
      maxBandCols: 8,
      nodes: [
        { id: 'a3', phaseIndex: 3, lane: 1, orderKey: 0, width: 240 },
        { id: 'a1', phaseIndex: 1, lane: 1, orderKey: 0, width: 240 },
        { id: 'a2', phaseIndex: 2, lane: 1, orderKey: 0, width: 240 },
      ],
    })
    expect(plan.phaseColumns.map((c) => c.index)).toEqual([1, 2, 3])
    // 带邻接：前带 x1 = 后带 x0
    expect(plan.phaseColumns[0]!.x1).toBeCloseTo(plan.phaseColumns[1]!.x0, 5)
    expect(plan.phaseColumns[1]!.x1).toBeCloseTo(plan.phaseColumns[2]!.x0, 5)
    // x 随 index 单调递增
    expect(plan.phaseColumns[0]!.cx).toBeLessThan(plan.phaseColumns[1]!.cx)
    expect(plan.phaseColumns[1]!.cx).toBeLessThan(plan.phaseColumns[2]!.cx)
    // 首带左缘起自主区
    expect(plan.phaseColumns[0]!.x0).toBe(mainX)
  })

  it('global 资产（lane 0）落其阶段 band 的 x，脱离第 0 列', () => {
    const plan = computePhaseGridPlan({
      mainX,
      slotStride,
      gap: V3_LAYOUT.NODE_GAP_X,
      maxRowsPerBand: 4,
      maxBandCols: 8,
      nodes: [
        { id: 'g', phaseIndex: 4, lane: 0, orderKey: 0, width: 168 }, // global 角色（P04）
        { id: 's', phaseIndex: 4, lane: 1, orderKey: 0, width: 240 }, // 同阶段 script
      ],
    })
    const gx = plan.positions.get('g')!.x
    // 不再钉在 col0（x≈16），而在主区 P04 band 内（x ≥ mainX）
    expect(gx).toBeGreaterThanOrEqual(mainX)
    // 与同阶段 script 共享 band 起始区间
    const band = plan.phaseColumns.find((c) => c.index === 4)!
    expect(gx).toBeGreaterThanOrEqual(band.x0)
    expect(gx).toBeLessThanOrEqual(band.x1)
  })

  it('自适应带宽：节点多的阶段带更宽（bandCols = ceil(最密泳道/maxRows)）', () => {
    const plan = computePhaseGridPlan({
      mainX,
      slotStride,
      gap: V3_LAYOUT.NODE_GAP_X,
      maxRowsPerBand: 4,
      maxBandCols: 8,
      nodes: [
        // P9：22 个 storyboard（最密）→ ceil(22/4)=6 槽
        ...Array.from({ length: 22 }, (_, i) => ({ id: `sb${i}`, phaseIndex: 9, lane: 2, orderKey: i, width: 240 })),
        // P2：1 个 → 1 槽
        { id: 's2', phaseIndex: 2, lane: 1, orderKey: 0, width: 240 },
      ],
    })
    const p9 = plan.phaseColumns.find((c) => c.index === 9)!
    const p2 = plan.phaseColumns.find((c) => c.index === 2)!
    expect(Math.round((p9.x1 - p9.x0) / slotStride)).toBe(6)
    expect(Math.round((p2.x1 - p2.x0) / slotStride)).toBe(1)
    // P9 storyboard 同泳道 ≤ maxRows 行（22 / floor(6*288/288)=6 列 → 4 行，row 最大 3）
    expect(plan.laneRows.get(2)).toBeLessThanOrEqual(3)
  })

  it('orderKey 决定组内顺序（保因果序），同一 (lane,phase) 横向铺开', () => {
    const plan = computePhaseGridPlan({
      mainX,
      slotStride,
      gap: V3_LAYOUT.NODE_GAP_X,
      maxRowsPerBand: 1, // 3 节点 → 3 列横向铺开（保因果序映射到 x）
      maxBandCols: 8,
      nodes: [
        { id: 'x0', phaseIndex: 1, lane: 1, orderKey: 5, width: 240 },
        { id: 'x1', phaseIndex: 1, lane: 1, orderKey: 1, width: 240 },
        { id: 'x2', phaseIndex: 1, lane: 1, orderKey: 3, width: 240 },
      ],
    })
    // orderKey 升序 → x1(1) < x2(3) < x0(5) 横向铺开
    expect(plan.positions.get('x1')!.x).toBeLessThan(plan.positions.get('x2')!.x)
    expect(plan.positions.get('x2')!.x).toBeLessThan(plan.positions.get('x0')!.x)
  })

  it('空输入 → 空结果', () => {
    const plan = computePhaseGridPlan({
      mainX, slotStride, gap: V3_LAYOUT.NODE_GAP_X, maxRowsPerBand: 4, maxBandCols: 8, nodes: [],
    })
    expect(plan.positions.size).toBe(0)
    expect(plan.phaseColumns).toEqual([])
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
    const box = { x: 0, y: 2 * LANE_H_PKG, lane: 2, layer: 0, row: 0 } // storyboard 泳道
    expect(bridgePosition({ nodeId: 'a', scope: 'episode', box, laneTops, globalSlotIndex: 0 }))
      .toEqual({ x: V3_LAYOUT.MAIN_X, y: laneTops[2]! + V3_LAYOUT.LANE_TOP_INSET })
  })

  it('入种口事件芯片（x<0）留在第 0 列左侧', () => {
    const box = { x: -160, y: 3 * LANE_H_PKG, lane: 3, layer: 0, row: 0 }
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
