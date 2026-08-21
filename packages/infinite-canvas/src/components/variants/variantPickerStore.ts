/**
 * src/components/variants/variantPickerStore.ts — 变体墙/候选列表的开关态。
 *
 * AssetCardNode 点 ×N 章 → registerCInteractions 注入的 onStackToggle 写入本 store →
 * FlowCanvas 挂载的 <VariantWall/> 据此自显隐。C 自有状态，不侵入 B 的 canvasUiStore。
 *
 * Phase 53-02:新增 wall 态(按 groupId 直开全屏审片剧场)——既有 open/openPicker
 * 协议不动(牌堆入口保留,墙取代 Picker 主体渲染);close 同时清两态。
 */
import { create } from 'zustand'
import type { VariantStackData } from '../../v3/adapter'

interface VariantPickerState {
  open: { nodeId: string; stack: VariantStackData } | null
  /** 全屏审片剧场按组直开(53-05 串行下一镜 / 资产中心跳转的入口)。 */
  wall: { groupId: string } | null
  openPicker: (nodeId: string, stack: VariantStackData) => void
  openWallByGroup: (groupId: string) => void
  close: () => void
}

export const useVariantPickerStore = create<VariantPickerState>((set) => ({
  open: null,
  wall: null,
  openPicker: (nodeId, stack) => set({ open: { nodeId, stack }, wall: null }),
  openWallByGroup: (groupId) => set({ wall: { groupId }, open: null }),
  close: () => set({ open: null, wall: null }),
}))
