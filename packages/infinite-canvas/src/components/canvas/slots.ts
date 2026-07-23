/**
 * src/components/canvas/slots.ts — 角标 / 牌堆处理器注册表（B/C 接缝，P12 / P18）。
 *
 * B 提供默认实现（NodeBadgesDefault 四角角标 + 扇形铺开牌堆），C 通过 register*
 * 覆盖为完整系统（候选列表 / 溯源高亮）。模块级单例：注册即全局生效
 * （整个画布一套角标系统、一套牌堆交互）。AssetCardNode 顶层注册默认角标实现。
 */
import type { ComponentType } from 'react'
import type { AssetNodeV3 } from '@kais/flowgraph-v3'
import type { LodLevel } from '../../hooks/useLod'
import type { VariantStackData } from '../../v3/adapter'

/** 四角角标 props（§4.4 四角产权制）。 */
export interface NodeBadgesProps {
  /** RF 节点 id（注册实现可据此查溯源态等上下文）。 */
  nodeId: string
  /** V3 资产权威载荷（aiScore / stale / reviewStatus / curation 在此）。 */
  asset: AssetNodeV3
  /** 当前 LOD 级（L0 角标不渲染）。 */
  lod: LodLevel
  /** 'global' 第 0 列小卡 / 'full' 常规卡（尺寸差异下角标取舍）。 */
  variant: 'global' | 'full'
}
export type NodeBadgesRenderer = ComponentType<NodeBadgesProps>

let nodeBadgesRenderer: NodeBadgesRenderer | null = null

/** 注册角标渲染器（C 覆盖；默认实现由 AssetCardNode 顶层注册一次）。 */
export function registerNodeBadgesRenderer(renderer: NodeBadgesRenderer): void {
  nodeBadgesRenderer = renderer
}

/** 取当前角标渲染器（未注册返回 null，AssetCardNode 兜底用 NodeBadgesDefault）。 */
export function getNodeBadgesRenderer(): NodeBadgesRenderer | null {
  return nodeBadgesRenderer
}

/** 变体牌堆交互出口（C 接管候选列表；缺省则 B 扇形铺开）。 */
export interface VariantStackHandlers {
  /** 点击 ×N 章的回调（C 在此弹候选列表 / 比选面板，取代 B 默认扇形）。 */
  onStackToggle?: (nodeId: string, stack: VariantStackData) => void
}

let variantStackHandlers: VariantStackHandlers = {}

/** 注册牌堆交互处理器（C 注入候选列表交互；B 默认 = 扇形铺开）。 */
export function registerVariantStackHandlers(handlers: VariantStackHandlers): void {
  variantStackHandlers = handlers
}

/** 取当前牌堆处理器（永远返回对象，消费方安全解构 onStackToggle）。 */
export function getVariantStackHandlers(): VariantStackHandlers {
  return variantStackHandlers
}
