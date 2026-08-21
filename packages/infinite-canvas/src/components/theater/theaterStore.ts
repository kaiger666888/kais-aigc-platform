/**
 * theaterStore.ts — 组视图剧场开关态(Phase 56-04 / VIZ-02,D-05)。
 *
 * variantPickerStore 协议同款:单目标 {kind, anchorId} 或 null;
 * GroupViewTheater 唯一消费面,FlowCanvas 双击/NodeDetailPanel 按钮写入。
 */
import { create } from 'zustand'

export type TheaterKind = 'turnaround' | 'scene' | 'voice'

interface TheaterState {
  group: { kind: TheaterKind; anchorId: string } | null
  open: (g: { kind: TheaterKind; anchorId: string }) => void
  close: () => void
}

export const useTheaterStore = create<TheaterState>((set) => ({
  group: null,
  open: (g) => set({ group: g }),
  close: () => set({ group: null }),
}))
