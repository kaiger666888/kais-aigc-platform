/**
 * src/components/variants/variantPickerStore.ts — P12 变体候选列表的开关态。
 *
 * AssetCardNode 点 ×N 章 → registerCInteractions 注入的 onStackToggle 写入本 store →
 * FlowCanvas 挂载的 <VariantPicker/> 据此自显隐。C 自有状态，不侵入 B 的 canvasUiStore。
 */
import { create } from 'zustand'
import type { VariantStackData } from '../../v3/adapter'

interface VariantPickerState {
  open: { nodeId: string; stack: VariantStackData } | null
  openPicker: (nodeId: string, stack: VariantStackData) => void
  close: () => void
}

export const useVariantPickerStore = create<VariantPickerState>((set) => ({
  open: null,
  openPicker: (nodeId, stack) => set({ open: { nodeId, stack } }),
  close: () => set({ open: null }),
}))
