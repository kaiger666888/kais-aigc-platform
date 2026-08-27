/**
 * blindSelectionStore.ts — 盲选会话开关态与推进状态(盲选批 M2)。
 *
 * C 自有状态(仿 variantPickerStore):不侵入 B 的 canvasUiStore,不订阅
 * socket——选定 echo 由 graph store 既有 variant:selected 守卫吸收,渲染随
 * graph 数据流自然更新(与 VariantWall P10 同一纪律)。
 *
 * 会话语义:
 *   - openSession 时快照队列 + 生成 sessionId/seed,此后固定(随机序在会话
 *     打开时生成并固定——spec §4);
 *   - orders: groupId → 展示序(seeded,重渲重算同序);
 *   - phase: voting(蒙眼,overlay 不渲染任何来源/分数/winner 信号)→
 *     revealed(揭晓对照)→ 提交后 advance;
 *   - decided: 每组终态 kept(盲选维持)/switched(揭晓后改选)/
 *     skipped(未投跳过)——仅本地会话小结用,真值在 select-winner 事务。
 */
import { create } from 'zustand'
import { makeSessionId, randomSeed, shuffleCandidates } from './blindOrder'

export type BlindPhase = 'voting' | 'revealed'
export type BlindOutcome = 'kept' | 'switched' | 'skipped'

interface BlindSelectionState {
  open: boolean
  sessionId: string
  seed: number
  /** 会话队列(开屏快照,不随 graph 实时变——重开取新快照)。 */
  queue: string[]
  cursor: number
  phase: BlindPhase
  /** 揭晓前盲选中的候选(voting 阶段点击时记录)。 */
  pickedNodeId: string | null
  /** groupId → 会话内固定展示序。 */
  orders: Record<string, string[]>
  /** groupId → 本会话终态。 */
  decided: Record<string, BlindOutcome>
  includeDecided: boolean

  openSession: (groups: Array<{ id: string; variantNodeIds: string[] }>, opts?: { includeDecided?: boolean }) => void
  close: () => void
  /** voting 阶段点选某候选(POST 成功后调用)→ 进入揭晓。 */
  reveal: (pickedNodeId: string) => void
  /** 组终态落账并推进游标(回到下一组 voting 态)。 */
  markDecided: (groupId: string, outcome: BlindOutcome) => void
  /** 提交失败重试前回到 voting 态(允许重新点选)。 */
  resetToVoting: () => void
}

export const useBlindSelectionStore = create<BlindSelectionState>((set, get) => ({
  open: false,
  sessionId: '',
  seed: 0,
  queue: [],
  cursor: 0,
  phase: 'voting',
  pickedNodeId: null,
  orders: {},
  decided: {},
  includeDecided: false,

  openSession: (groups, opts) => {
    const sessionId = makeSessionId()
    const seed = randomSeed()
    const queue = groups.map((g) => g.id)
    const orders: Record<string, string[]> = {}
    for (const g of groups) orders[g.id] = shuffleCandidates(g.variantNodeIds, seed)
    set({
      open: true,
      sessionId,
      seed,
      queue,
      cursor: 0,
      phase: 'voting',
      pickedNodeId: null,
      orders,
      decided: {},
      includeDecided: opts?.includeDecided ?? false,
    })
  },
  close: () => set({ open: false }),
  reveal: (pickedNodeId) => set({ phase: 'revealed', pickedNodeId }),
  markDecided: (groupId, outcome) => {
    const { decided, cursor, queue } = get()
    set({
      decided: { ...decided, [groupId]: outcome },
      cursor: Math.min(cursor + 1, queue.length),
      phase: 'voting',
      pickedNodeId: null,
    })
  },
  resetToVoting: () => set({ phase: 'voting', pickedNodeId: null }),
}))
