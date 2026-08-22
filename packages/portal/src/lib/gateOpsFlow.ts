/**
 * gateOpsFlow.ts — 交付页 G8 终审操作流状态机（Phase 57-06 Task 1）。
 *
 * 54 GateCenterBlock.runOp 的纯函数化提取（D-10 通道零新建复用）：输入
 * {gate, projectId, episodesId, api:{gateOps}}，输出 = 状态转移 + 副作用
 * 指令（toast/refetch 由 UI 层执行——本文件不碰 UI、不发真实请求）。
 *
 * 三分支时序（54 语义全套保真）：
 *  - 乐观翻转：working → optimistic（终审键翻 action 对应态，UI 行级呈现）
 *  - 409 幂等：{applied:false, cause:'already-resolved'} = 幂等成功——
 *    不回滚，发 refetch 指令（上层重拉 gate-state + 幂等 toast，不当错误弹）
 *  - 失败回滚：非 ok（400/422/502 → apiCall 抛错）→ 乐观态回滚 + error
 *    指令（原因透传，上层 toast）
 *
 * 词汇 = 54 锁定词表（放行/驳回/等你决策）；驳回 reason 必填 1-500
 * （gate-ops schema 双侧同源，ReasonDialog 消费同一常量与校验函数）。
 * waive 不上交付页（U-05 延伸裁决：收片人无豁免语义）。
 */
import { gateOps as defaultGateOps, type GateOpsResult } from '@ic/services/canvasApi'

/** gate-state p13-gate 条目判定切片（GateStateGate 结构兼容）。 */
export interface TerminalGate {
  gateId: string
  label?: string
  display: 'pending' | 'approve' | 'reject' | 'waive' | 'auto'
  reviewId?: number
}

/** 终态集：display 非 pending 即已决——动作条不渲染的判定输入（54 语义）。 */
export const terminalStates = ['approve', 'reject', 'waive', 'auto'] as const

/** 交付页终审操作面（waive 不上交付页——收片人无豁免语义，U-05 延伸裁决）。 */
export type TerminalAction = 'approve' | 'reject'

/** 驳回理由契约：必填 1-500（gate-ops.ts schema reason 同源；双侧同常量）。 */
export const REASON_LIMITS = { min: 1, max: 500 } as const

/** 注入形态的 gateOps（@ic/services/canvasApi 既有封装签名切片，测试 mock 用）。 */
export type GateOpsLike = (
  projectId: number,
  episodesId: number,
  reviewId: number,
  action: TerminalAction,
  opts?: { reason?: string; selected?: number[] },
) => Promise<GateOpsResult>

/** 54 toast 文案逐字（Copywriting Contract）。 */
export const TOAST_IDEMPOTENT = '该门已在别处处理（如 telegram），状态已刷新。'
export const TOAST_ERROR = '操作失败,已恢复原状态,请重试。'

const ACTION_LABEL: Record<Exclude<TerminalGate['display'], 'pending' | 'auto'>, string> = {
  approve: '放行',
  reject: '驳回',
  waive: '豁免',
}

/** display 是否终态（非 pending）。 */
export function isTerminal(gate: TerminalGate): boolean {
  return gate.display !== 'pending'
}

/** 理由合规：trim 后长度 ∈ [1, 500]（ReasonDialog 确认键同一真值）。 */
export function validateReason(reason: string): boolean {
  const len = reason.trim().length
  return len >= REASON_LIMITS.min && len <= REASON_LIMITS.max
}

/** 前置判定：动作条渲染与发请求双入口的同一真值。 */
export type OpPlan =
  | { kind: 'ready'; reviewId: number }
  | { kind: 'no-op'; why: 'terminal' | 'no-review-id' }
  | { kind: 'invalid-reason' }

export function planOp(gate: TerminalGate, action: TerminalAction, reason?: string): OpPlan {
  if (isTerminal(gate)) return { kind: 'no-op', why: 'terminal' }
  if (gate.reviewId == null) return { kind: 'no-op', why: 'no-review-id' }
  if (action === 'reject' && (reason == null || !validateReason(reason))) {
    return { kind: 'invalid-reason' }
  }
  return { kind: 'ready', reviewId: gate.reviewId }
}

/** 副作用指令（UI 层执行 toast/翻态/refetch）。 */
export type TerminalOpEvent =
  | { type: 'working' }
  | { type: 'optimistic'; display: 'approve' | 'reject' }
  | { type: 'success'; display: 'approve' | 'reject'; toast: string }
  | { type: 'idempotent'; toast: string; refetch: true }
  | { type: 'rollback'; toast: string; cause?: string }

/** 终审操作结果（UI 不需要额外信息——细节都在事件流里）。 */
export type TerminalOpOutcome =
  | { kind: 'success'; display: 'approve' | 'reject' }
  | { kind: 'idempotent' }
  | { kind: 'rollback' }
  | { kind: 'no-op'; why: 'terminal' | 'no-review-id' }
  | { kind: 'invalid-reason' }

/**
 * 执行一次终审操作：planOp 前置 → working → 乐观翻转 → await gateOps →
 * 三分支（success / idempotent[409] / rollback[失败]）。no-op 与理由不合规
 * 零事件零请求。
 */
export async function runTerminalOp(input: {
  gate: TerminalGate
  projectId: number
  episodesId: number
  action: TerminalAction
  reason?: string
  api?: { gateOps: GateOpsLike }
  onEvent?: (event: TerminalOpEvent) => void
}): Promise<TerminalOpOutcome> {
  const { gate, projectId, episodesId, action, reason, onEvent } = input
  const plan = planOp(gate, action, reason)
  if (plan.kind === 'no-op') return { kind: 'no-op', why: plan.why }
  if (plan.kind === 'invalid-reason') return { kind: 'invalid-reason' }

  const gateOpsFn = input.api?.gateOps ?? defaultGateOps
  const optimisticDisplay = action === 'approve' ? ('approve' as const) : ('reject' as const)

  onEvent?.({ type: 'working' })
  onEvent?.({ type: 'optimistic', display: optimisticDisplay })
  try {
    const res = await gateOpsFn(
      projectId,
      episodesId,
      plan.reviewId,
      action,
      action === 'reject' && reason != null ? { reason: reason.trim() } : undefined,
    )
    if (res.applied) {
      onEvent?.({
        type: 'success',
        display: optimisticDisplay,
        toast: `「${gate.label ?? gate.gateId}」已${ACTION_LABEL[optimisticDisplay]}`,
      })
      return { kind: 'success', display: optimisticDisplay }
    }
    // P4 幂等成功：409 已被服务端映射为 applied:false——不回滚，重拉状态。
    onEvent?.({ type: 'idempotent', toast: TOAST_IDEMPOTENT, refetch: true })
    return { kind: 'idempotent' }
  } catch (err) {
    onEvent?.({
      type: 'rollback',
      toast: TOAST_ERROR,
      ...(err instanceof Error && err.message ? { cause: err.message } : {}),
    })
    return { kind: 'rollback' }
  }
}
