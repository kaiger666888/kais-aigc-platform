/**
 * src/hooks/useStale.ts — P13 脏传播触发 + 级联脉冲动效（设计 §4.5 / 宪法 P13）。
 *
 * - triggerStaleCascade(changedAssetIds)：调 store.markStaleDownstream 重算下游 stale，
 *   并把「刚变脏的节点」加入脉动集合（供 NodeBadges 的一次性高亮脉冲）。
 *   触发时机（C/D 接线）：变体切换、审核通过、human_edit、socket node:updated。
 * - useStalePulse：角标/涟漪订阅的脉动 id 集合（同屏上限 8，整链 1200ms 后清空）。
 *
 * 「24px 亮段沿因果边旅行 250ms/跳」的理想形态需 CanvasEdge（B 文件）配合逐边动画，
 * 本期落在节点侧（角标脉冲 + 卡片涟漪），边旅行动效标 TODO 待 B 层支持。
 */
import { create } from 'zustand'
import { useCanvasStore } from '../store/canvasStore'

/** 同屏脉动上限（设计 §4.5）。 */
const MAX_PULSE = 8
/** 整条级联链的脉动持续窗口（ms）。 */
const PULSE_WINDOW_MS = 1200

interface StalePulseState {
  /** 当前正在脉动的节点 id（按加入序，超限截断）。 */
  pulseIds: string[]
  addPulse: (ids: string[]) => void
}

/** 脉动状态（模块单例，角标跨节点共享订阅）。 */
export const useStalePulse = create<StalePulseState>((set, get) => ({
  pulseIds: [],
  addPulse: (ids) => {
    if (ids.length === 0) return
    const merged = [...new Set([...get().pulseIds, ...ids])]
    const next = merged.slice(Math.max(0, merged.length - MAX_PULSE))
    set({ pulseIds: next })
    // 窗口结束后逐个摘除
    ids.forEach((id) => {
      setTimeout(() => {
        set((s) => ({ pulseIds: s.pulseIds.filter((x) => x !== id) }))
      }, PULSE_WINDOW_MS)
    })
  },
}))

/**
 * 触发脏传播：重算下游 stale + 脉动刚变脏的节点。
 * 在 store.markStaleDownstream 之后读新图，取因本次变更而 stale 的节点（triggerAssetId 命中）
 * 作为脉动集合——这些是用户能感知到「变脏」的节点。
 */
export function triggerStaleCascade(changedAssetIds: string[]): void {
  if (changedAssetIds.length === 0) return
  const store = useCanvasStore.getState()
  store.markStaleDownstream(changedAssetIds)

  const g = useCanvasStore.getState().graph
  if (!g) return
  const changed = new Set(changedAssetIds)
  const newlyStale = g.nodes
    .filter((n) => n.kind === 'asset' && n.stale != null && changed.has(n.stale.triggerAssetId))
    .map((n) => n.id)
  useStalePulse.getState().addPulse([...changedAssetIds, ...newlyStale])
}
