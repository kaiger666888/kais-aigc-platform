/**
 * src/hooks/useLod.ts — LOD 三级（P16；tokens --cv-lod-* 逐值）。
 *
 * 阈值：L0 全景 <0.22 / L1 中景 0.22–0.6 / L2 近景 ≥0.6，±0.03 迟滞防抖动
 * （跨越阈值需越过对侧 0.03 才切换，在阈值附近往复缩放不闪切）。
 * 每个消费组件各自持有迟滞状态（同一 zoom 输入下推导结果一致，无级联错乱）。
 */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { useViewport } from '@xyflow/react'

export type LodLevel = 0 | 1 | 2

export const LOD_L0_MAX = 0.22
export const LOD_L1_MAX = 0.6
export const LOD_HYSTERESIS = 0.03

/**
 * fitView 的缩放下限。真实项目图常达数万 px 宽（如 34160px），天然 fit-zoom 会到亚像素
 * （~0.05）→ 全员落 LOD 0 色块 → 画布加载后看不到任何缩略图。设此下限让初始视图与
 * 「适配」按钮都保持可读缩放：FITVIEW_MIN_ZOOM > LOD_L0_MAX ⇒ 落 L1（封面/缩略图可见），
 * 超大图只显示局部（可拖拽/MiniMap 导航），而非缩成看不见的色块海。
 */
export const FITVIEW_MIN_ZOOM = 0.4

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

/**
 * LOD 上下文（P16 性能修正）。
 *
 * 旧版每个消费组件各自 useViewport()：缩放/平移每帧 zoom/x/y 变 → useStore(shallow)
 * 判变 → 全体消费组件（数百 AssetCardNode + 全部 CanvasEdge）每帧重跑组件体，即便 LOD
 * 桶没变。大图（如 369 节点项目）即掉帧。
 *
 * 现在 LodProvider 是唯一 viewport 订阅者：它持有迟滞状态，仅当 LOD 桶(0/1/2) 跨越
 * 阈值时 setLevel；context value 是原始 number，不变则消费组件不重渲染。连续缩放从
 * 「每帧 × N 组件」降到「跨阈值 2~3 次 × N 组件」。
 *
 * 消费侧无感：useLodLevel() 仍是 () => LodLevel，仅改为读 context。用 createElement
 * 而非 JSX 以保持本文件为 .ts（hook 模块，无其余 JSX）。必须在 <LodProvider> 下使用
 *（包住 <ReactFlow>，置于 <ReactFlowProvider> 内）。
 */
const LodContext = createContext<LodLevel>(2) // 兜底 L2（满细节）：漏包 Provider 时不致退化为看不见的色块

export function LodProvider({ children }: { children: ReactNode }) {
  const { zoom } = useViewport()
  const [level, setLevel] = useState<LodLevel>(() => lodLevelForZoom(zoom))
  useEffect(() => {
    setLevel((prev) => resolveLodLevel(zoom, prev))
  }, [zoom])
  return createElement(LodContext.Provider, { value: level }, children)
}

/** 当前 LOD 级（读 context；仅跨阈值时重渲染）。 */
export function useLodLevel(): LodLevel {
  return useContext(LodContext)
}
