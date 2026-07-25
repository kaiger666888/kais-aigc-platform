/**
 * src/components/canvas/laneGeometry.ts — 泳道几何纯函数（SPEC-step5 B2）。
 *
 * 设计权威在 tokens（V3_LAYOUT 每泳道带高 + 48px 凹槽 + 第 0 列 200px），
 * 布局权威在包内 layoutFlowGraph（统一 laneH 语义，LANE_H_PKG 对齐）。
 * 本模块把「每泳道带高」换算成「带顶坐标 / 整画布几何」，供 useLayout 桥接
 * 与 LaneBands 背景带消费。纯函数、确定性、可单测。
 */
import { V3_LAYOUT, V3_NODE_SIZES, PHASE_GROUPS, type PhaseGroup } from '../../constants'
import { STAGE_ORDER } from '@kais/flowgraph-v3'

/**
 * 包内 layoutFlowGraph 的统一带高（layout.ts 的 DEFAULT_LANE_H）。
 * useLayout 调 layoutFlowGraph(graph, { gap }) 不传 laneH → 用此默认值；
 * bridgePosition 的「带内偏移 = box.y - box.lane * LANE_H_PKG」依赖此值精确对齐，
 * 故必须与包内常量相等（改包内需同步改这里）。
 */
export const LANE_H_PKG = 200

export interface CanvasGeometry {
  /** 十条泳道带（序 = STAGE_ORDER：global→composite）。 */
  bands: Array<{ lane: string; top: number; height: number }>
  /** 第 0 列 global 锚定区。 */
  globalColumn: { width: number; x?: number }
  /** locked 参考区（locked 节点包围盒 + 24 padding）；无 locked 节点为 null。 */
  lockedZone: { x: number; y: number; width: number; height: number } | null
  /** 竖向创作阶段列（P01–P13 叠加层；按各阶段节点 median-x 投影，global 列除外）。 */
  phaseColumns?: PhaseColumn[]
}

/** 竖向创作阶段列（叠加层）：一阶段一条非重叠 x 带，跨全部泳道高度。 */
export interface PhaseColumn {
  index: number
  name: string
  group: PhaseGroup
  x0: number
  x1: number
  cx: number
}

/**
 * 竖向创作阶段列几何（叠加层，不动布局引擎）：
 *  - 仅取有 phaseIndex 且节点中心 x > mainX 的资产（排除 global 第 0 列——其固定最左、不随阶段横向铺开）。
 *  - 每阶段取节点中心 x 的 **median**（比 min 更抗散点），按 median 排序阶段。
 *  - 相邻阶段边界 = 两 median 中点；首尾带各向外延半个中位间距（首带左缘夹在 mainX）→ 非重叠有序竖带。
 *  - name 取自 phaseCatalog（adapter 从 zone 节点提取），group 取 PHASE_GROUPS（兜底 production）。
 *  纯函数、确定性、可单测。
 */
export function computePhaseColumns(input: {
  nodes: Array<{ x: number; width: number; phaseIndex?: number }>
  phaseCatalog?: Array<{ index: number; name: string }> | null
  /** 主区 x 起点（global 列右分隔线之后）；缺省 0（不过滤 global）。 */
  mainX?: number
}): PhaseColumn[] {
  const { nodes, phaseCatalog, mainX = 0 } = input

  const byPhase = new Map<number, number[]>()
  for (const n of nodes) {
    if (n.phaseIndex == null) continue
    const cx = n.x + (n.width ?? 0) / 2
    if (cx <= mainX) continue // global 第 0 列固定最左，不进阶段列
    const arr = byPhase.get(n.phaseIndex)
    if (arr) arr.push(cx)
    else byPhase.set(n.phaseIndex, [cx])
  }
  if (byPhase.size === 0) return []

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
  }
  const pad = (idx: number): string => `P${String(idx).padStart(2, '0')}`
  const cat = new Map((phaseCatalog ?? []).map((c) => [c.index, c.name]))
  const entries = [...byPhase.entries()]
    .map(([index, xs]) => ({
      index,
      medianX: median(xs),
      name: cat.get(index) ?? pad(index),
      group: (PHASE_GROUPS[index] ?? 'production') as PhaseGroup,
    }))
    .sort((a, b) => a.medianX - b.medianX)

  // 中位相邻间距的一半 = 首尾带外延量；无相邻间距兜底半个槽位步进（≈144）。
  const spacings = entries.slice(1).map((e, i) => e.medianX - entries[i]!.medianX).filter((d) => d > 0)
  const halfStep = spacings.length ? median(spacings) / 2 : 144

  return entries.map((e, i) => {
    const x0 = i === 0
      ? Math.max(mainX, e.medianX - halfStep)
      : (entries[i - 1]!.medianX + e.medianX) / 2
    const x1 = i === entries.length - 1
      ? e.medianX + halfStep
      : (e.medianX + entries[i + 1]!.medianX) / 2
    return { index: e.index, name: e.name, group: e.group, x0, x1, cx: (x0 + x1) / 2 }
  })
}

/**
 * 阶段网格布局（叠加层 + 节点重排，修复「阶段未从左到右有序 / global 资产钉死第 0 列」）。
 *
 * 动机：包内布局引擎按因果层 + 槽位排 x，但同一阶段节点因果深度散乱，实测每阶段 x 跨越
 * 几乎整个主区（median 完全乱序）；加上 migrate 把所有 type:'asset' 钉成 scope:'global'
 * 第 0 列（不随阶段横向移动）。二者叠加 → 阶段列竖带顺序乱、global 资产脱离所属阶段。
 *
 * 方案（不动包内布局引擎，在桥接层做一次阶段网格重排）：
 *  - x 轴主排序键 = phaseIndex：阶段按数值序（P01→P14）占横向相邻 band。
 *  - 自适应带宽：每个阶段带的列数 = clamp(ceil(该阶段最密泳道节点数 / maxRowsPerBand), 1, maxBandCols)。
 *    节点多的阶段自动加宽（同一泳道不超过 ~maxRowsPerBand 行），节点少则收窄 → 平衡宽高比。
 *  - 每阶段内按 lane（资产类型泳道）分子组，组内按 orderKey（槽位/堆叠序）保因果序，
 *    再按各 lane 卡宽自适应列数 pack 进 band（global 168 更密、标准 240 更疏）。
 *  - 带边界跨泳道对齐 → 竖向阶段叠加层（PhaseColumns）得到整齐、按 index 有序的列。
 *  - y 仍由 lane（stage）决定；row = floor(组内序 / 该 lane 列数)，lane 高据 max row 自适应。
 *  - global 资产进 lane 0（global 泳道），落在其阶段 band 的 x——脱离第 0 列、跟随阶段横向移动。
 *
 * 纯函数、确定性、可单测。返回 x（绝对，含 mainX）+ lane + row（相对）；y 由调用方据 laneTops 解析。
 */
export interface PhaseGridNode {
  id: string
  phaseIndex: number
  /** 泳道号（STAGE_ORDER 序；global 资产 = 0）。 */
  lane: number
  /** 组内排序键：episode 取 engine 槽位（box.x/slotStride），global 取第 0 列堆叠序。 */
  orderKey: number
  /** 该 lane 卡宽（global 168 / composite 280 / 标准 240）。 */
  width: number
}

export interface PhaseGridPlan {
  /** nodeId → { x 绝对, lane, row 相对 }；y 由调用方据 laneTops + row 解析。 */
  positions: Map<string, { x: number; lane: number; row: number }>
  /** 每 lane 最大 row（0 起）；调用方据 (row+1)×ROW_HEIGHT 算带高。 */
  laneRows: Map<number, number>
  /** 阶段竖带（按 index 有序、带边界跨泳道对齐）；PhaseColumns 直接消费。 */
  phaseColumns: PhaseColumn[]
}

export function computePhaseGridPlan(input: {
  nodes: PhaseGridNode[]
  phaseCatalog?: Array<{ index: number; name: string }> | null
  /** 每 lane 在一个阶段 band 内的目标最大行数（阶段带据此自适应加宽）。 */
  maxRowsPerBand: number
  /** 阶段带宽上限（槽位）；防单阶段节点极多时带过宽。 */
  maxBandCols: number
  slotStride: number
  gap: number
  mainX: number
}): PhaseGridPlan {
  const { nodes, phaseCatalog, maxRowsPerBand, maxBandCols, slotStride, gap, mainX } = input
  if (nodes.length === 0 || maxRowsPerBand <= 0) {
    return { positions: new Map(), laneRows: new Map(), phaseColumns: [] }
  }

  // 阶段分组
  const byPhase = new Map<number, PhaseGridNode[]>()
  for (const n of nodes) {
    const arr = byPhase.get(n.phaseIndex)
    if (arr) arr.push(n)
    else byPhase.set(n.phaseIndex, [n])
  }
  const sortedPhases = [...byPhase.keys()].sort((a, b) => a - b)

  // 每阶段内按 lane 子分组（先建好，带宽计算需各组规模）
  const lanesByPhase = new Map<number, Map<number, PhaseGridNode[]>>()
  for (const pi of sortedPhases) {
    const byLane = new Map<number, PhaseGridNode[]>()
    for (const n of byPhase.get(pi)!) {
      const arr = byLane.get(n.lane)
      if (arr) arr.push(n)
      else byLane.set(n.lane, [n])
    }
    lanesByPhase.set(pi, byLane)
  }

  // 自适应带宽：阶段列数 = clamp(ceil(最密泳道节点数 / maxRowsPerBand), 1, maxBandCols)
  const bandColsOf = new Map<number, number>()
  for (const pi of sortedPhases) {
    let maxGroup = 1
    for (const arr of lanesByPhase.get(pi)!.values()) {
      maxGroup = Math.max(maxGroup, arr.length)
    }
    bandColsOf.set(pi, Math.max(1, Math.min(maxBandCols, Math.ceil(maxGroup / maxRowsPerBand))))
  }

  // 每阶段起始列（slotStride 单位；带邻接拼铺，带宽可变）
  const bandStartCol = new Map<number, number>()
  let colCursor = 0
  for (const pi of sortedPhases) {
    bandStartCol.set(pi, colCursor)
    colCursor += bandColsOf.get(pi)!
  }

  const positions = new Map<string, { x: number; lane: number; row: number }>()
  const laneRows = new Map<number, number>()

  for (const pi of sortedPhases) {
    const bandWidth = bandColsOf.get(pi)! * slotStride
    const bandX0 = mainX + bandStartCol.get(pi)! * slotStride
    for (const [lane, arr] of lanesByPhase.get(pi)!) {
      arr.sort((a, b) => a.orderKey - b.orderKey)
      const cardStride = (arr[0]?.width ?? 240) + gap
      const colsInBand = Math.max(1, Math.floor(bandWidth / cardStride))
      arr.forEach((n, i) => {
        const col = i % colsInBand
        const row = Math.floor(i / colsInBand)
        positions.set(n.id, { x: bandX0 + col * cardStride, lane, row })
        laneRows.set(lane, Math.max(laneRows.get(lane) ?? 0, row))
      })
    }
  }

  // 阶段竖带（按 index 有序；带边界 = 该阶段 bandX0..bandX0+bandWidth，跨泳道对齐）
  const pad = (idx: number): string => `P${String(idx).padStart(2, '0')}`
  const cat = new Map((phaseCatalog ?? []).map((c) => [c.index, c.name]))
  const phaseColumns: PhaseColumn[] = sortedPhases.map((pi) => {
    const x0 = mainX + bandStartCol.get(pi)! * slotStride
    const x1 = x0 + bandColsOf.get(pi)! * slotStride
    return {
      index: pi,
      name: cat.get(pi) ?? pad(pi),
      group: (PHASE_GROUPS[pi] ?? 'production') as PhaseGroup,
      x0,
      x1,
      cx: (x0 + x1) / 2,
    }
  })

  return { positions, laneRows, phaseColumns }
}

/**
 * 累计带顶：第 i 带顶 = 前序带高之和（prefixSum）+ i × LANE_GAP(48px) 凹槽。
 * 第 0 带顶 = 0；凹槽数 = i（第 i 带之前有 i 个露底凹槽）。
 * 例：computeLaneTops([200,280,240]) === [0, 248, 576]。
 */
export function computeLaneTops(heights: readonly number[]): number[] {
  const tops: number[] = []
  let prefixSum = 0
  for (let i = 0; i < heights.length; i++) {
    tops.push(prefixSum + i * V3_LAYOUT.LANE_GAP)
    prefixSum += heights[i]!
  }
  return tops
}

/**
 * global 第 0 列带高：max(tokens 基准 200, 列头 40 + N×(卡高 120 + 16 间隙))。
 * 第 0 列内 global 资产按 id 序纵排（useLayout: y = 40 + i×136），N 张占满即
 * 40 + N×(120+16)；不足 200 时取 200（与 LANE_HEIGHTS[0] 基准对齐）。
 */
export function globalLaneHeight(globalAssetCount: number): number {
  const content = 40 + globalAssetCount * (V3_NODE_SIZES.globalCard.height + 16)
  return Math.max(V3_LAYOUT.LANE_HEIGHTS[0]!, content)
}

/**
 * 换行后泳道带高：max(tokens 基准带高, 行数 × 行高)。
 * 同泳道节点按 colsPerRow 折成 rowCount 行 → 带高须容纳 rowCount 行（每行 ROW_HEIGHT），
 * 否则行间溢入下一泳道带造成重叠。空泳道 rowCount=1（取基准带高）。
 */
export function laneHeightFromRows(baseHeight: number, rowCount: number, rowH: number): number {
  return Math.max(baseHeight, rowCount * rowH)
}

/**
 * 整画布几何：十条带（带名/带顶/带高）+ 第 0 列宽 + locked 参考区。
 *  - 第 0 带高用 globalLaneHeight(globalAssetCount) 自适应，其余沿用 LANE_HEIGHTS。
 *  - locked 参考区 = locked 节点包围盒 + 24 padding（四向）；无 locked 节点 → null。
 */
export function computeCanvasGeometry(input: {
  globalAssetCount: number
  boxes: Array<{ x: number; y: number; width: number; height: number; locked: boolean }>
  /**
   * 可选逐泳道带高（换行 opt-in）：提供则直接用作带高（调用方应已含 globalLaneHeight + 行折算），
   * 不提供则内部按 LANE_HEIGHTS 派生（lane 0 = globalLaneHeight，向后兼容）。
   */
  heights?: readonly number[]
}): CanvasGeometry {
  const heights =
    input.heights ??
    V3_LAYOUT.LANE_HEIGHTS.map((h, i) => (i === 0 ? globalLaneHeight(input.globalAssetCount) : h))
  const tops = computeLaneTops(heights)
  const bands = STAGE_ORDER.map((lane, i) => ({
    lane,
    top: tops[i] ?? 0,
    height: heights[i] ?? 0,
  }))

  // locked 参考区（§1.3 拉片参考）：locked 节点包围盒 + 24 padding
  const locked = input.boxes.filter((b) => b.locked)
  let lockedZone: CanvasGeometry['lockedZone'] = null
  if (locked.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxRight = -Infinity
    let maxBottom = -Infinity
    for (const b of locked) {
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      const right = b.x + b.width
      const bottom = b.y + b.height
      if (right > maxRight) maxRight = right
      if (bottom > maxBottom) maxBottom = bottom
    }
    const pad = 24
    lockedZone = {
      x: minX - pad,
      y: minY - pad,
      width: maxRight - minX + pad * 2,
      height: maxBottom - minY + pad * 2,
    }
  }

  return {
    bands,
    globalColumn: { width: V3_LAYOUT.GLOBAL_COL_WIDTH },
    lockedZone,
  }
}
