/**
 * src/components/canvas/canvasUiStore.ts — UI 折叠态（P17 持久化的运行时容器）。
 *
 * 仅存「视图折叠态」（展开的变体牌堆节点 / 展开的 text 卡资产），不含数据语义。
 * useCanvasPersistence 负责 localStorage 读写 + 水合（hydrate）：
 *  - 恢复：useCanvasUiStore.getState().hydrate({ expandedStacks, expandedTexts })
 *  - 回写：订阅 expandedStacks/expandedTexts 变化（300ms 防抖）落盘。
 */
import { create } from 'zustand'

interface CanvasUiState {
  /** 展开的变体牌堆节点 id（P12：点击 ×N 章扇形铺开候选）。 */
  expandedStacks: string[]
  /** 展开的 text 卡资产 id（§4.6：正文 max 220 折叠 / 展开切换）。 */
  expandedTexts: string[]
  toggleStack: (nodeId: string) => void
  toggleText: (assetId: string) => void
  /** 从持久化快照水合（全量覆盖，P17 刷新原样恢复）。 */
  hydrate: (snap: { expandedStacks?: string[]; expandedTexts?: string[] }) => void
}

export const useCanvasUiStore = create<CanvasUiState>((set) => ({
  expandedStacks: [],
  expandedTexts: [],
  toggleStack: (nodeId) =>
    set((s) => ({
      expandedStacks: s.expandedStacks.includes(nodeId)
        ? s.expandedStacks.filter((id) => id !== nodeId)
        : [...s.expandedStacks, nodeId],
    })),
  toggleText: (assetId) =>
    set((s) => ({
      expandedTexts: s.expandedTexts.includes(assetId)
        ? s.expandedTexts.filter((id) => id !== assetId)
        : [...s.expandedTexts, assetId],
    })),
  hydrate: (snap) =>
    set({
      expandedStacks: snap.expandedStacks ?? [],
      expandedTexts: snap.expandedTexts ?? [],
    }),
}))
