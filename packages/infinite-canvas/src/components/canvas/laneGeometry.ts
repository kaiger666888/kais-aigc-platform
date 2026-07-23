/**
 * src/components/canvas/laneGeometry.ts — 泳道几何纯函数（SPEC-step5 B2）。
 *
 * 设计权威在 tokens（V3_LAYOUT 每泳道带高 + 48px 凹槽 + 第 0 列 200px），
 * 布局权威在包内 layoutFlowGraph（统一 laneH 语义，LANE_H_PKG 对齐）。
 * 本模块把「每泳道带高」换算成「带顶坐标 / 整画布几何」，供 useLayout 桥接
 * 与 LaneBands 背景带消费。纯函数、确定性、可单测。
 */
import { V3_LAYOUT, V3_NODE_SIZES } from '../../constants'
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
 * 整画布几何：十条带（带名/带顶/带高）+ 第 0 列宽 + locked 参考区。
 *  - 第 0 带高用 globalLaneHeight(globalAssetCount) 自适应，其余沿用 LANE_HEIGHTS。
 *  - locked 参考区 = locked 节点包围盒 + 24 padding（四向）；无 locked 节点 → null。
 */
export function computeCanvasGeometry(input: {
  globalAssetCount: number
  boxes: Array<{ x: number; y: number; width: number; height: number; locked: boolean }>
}): CanvasGeometry {
  const heights = V3_LAYOUT.LANE_HEIGHTS.map((h, i) =>
    i === 0 ? globalLaneHeight(input.globalAssetCount) : h,
  )
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
