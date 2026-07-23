/**
 * src/hooks/useLod.ts — LOD 三级（P16；tokens --cv-lod-* 逐值）。
 *
 * 阈值：L0 全景 <0.35 / L1 中景 0.35–0.8 / L2 近景 ≥0.8，±0.03 迟滞防抖动
 * （跨越阈值需越过对侧 0.03 才切换，在阈值附近往复缩放不闪切）。
 * 每个消费组件各自持有迟滞状态（同一 zoom 输入下推导结果一致，无级联错乱）。
 */
import { useEffect, useState } from 'react'
import { useViewport } from '@xyflow/react'

export type LodLevel = 0 | 1 | 2

export const LOD_L0_MAX = 0.35
export const LOD_L1_MAX = 0.8
export const LOD_HYSTERESIS = 0.03

/** 无迟滞直判（初始化用）。 */
export function lodLevelForZoom(zoom: number): LodLevel {
  if (zoom < LOD_L0_MAX) return 0
  if (zoom < LOD_L1_MAX) return 1
  return 2
}

/** 带 ±0.03 迟滞的级间迁移（纯函数，可测）。 */
export function resolveLodLevel(zoom: number, prev: LodLevel): LodLevel {
  const EPS = 1e-9 // 浮点边界（0.8+0.03=0.8300000000000001）
  const up0 = LOD_L0_MAX + LOD_HYSTERESIS // 0.38：L0→L1 需升过
  const down1 = LOD_L0_MAX - LOD_HYSTERESIS // 0.32：L1→L0 需跌破
  const up1 = LOD_L1_MAX + LOD_HYSTERESIS // 0.83：L1→L2 需升过
  const down2 = LOD_L1_MAX - LOD_HYSTERESIS // 0.77：L2→L1 需跌破
  switch (prev) {
    case 0:
      if (zoom >= up1 - EPS) return 2
      if (zoom >= up0 - EPS) return 1
      return 0
    case 2:
      if (zoom < down1 + EPS) return 0
      if (zoom < down2 + EPS) return 1
      return 2
    default:
      if (zoom < down1 + EPS) return 0
      if (zoom >= up1 - EPS) return 2
      return 1
  }
}

/** 当前 LOD 级（订阅 React Flow viewport zoom，带迟滞）。 */
export function useLodLevel(): LodLevel {
  const { zoom } = useViewport()
  const [level, setLevel] = useState<LodLevel>(() => lodLevelForZoom(zoom))
  useEffect(() => {
    setLevel((prev) => resolveLodLevel(zoom, prev))
  }, [zoom])
  return level
}
