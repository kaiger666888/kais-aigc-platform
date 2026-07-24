/**
 * src/components/variants/registerCInteractions.ts — C 层交互副作用注册（模块加载即生效）。
 *
 * FlowCanvas 顶部 `import './variants/registerCInteractions'` 触发本模块：
 *  - registerNodeBadgesRenderer(NodeBadges)：用 C 的完整四角系统覆盖 B 默认角标。
 *  - registerVariantStackHandlers({ onStackToggle })：牌堆 ×N 章点击 → 弹 VariantPicker
 *    （取代 B 默认扇形铺开）。注册晚于 AssetCardNode 顶层默认注册，故 C 覆盖生效。
 */
import NodeBadges from '../badges/NodeBadges'
import { registerNodeBadgesRenderer, registerVariantStackHandlers } from '../canvas/slots'
import { useVariantPickerStore } from './variantPickerStore'

registerNodeBadgesRenderer(NodeBadges)
registerVariantStackHandlers({
  onStackToggle: (nodeId, stack) => useVariantPickerStore.getState().openPicker(nodeId, stack),
})

// 副作用模块：确保被 tree-shake 保留。
export {}
