/**
 * gateOpsFlow.test.ts — 终审操作流状态机单测（Phase 57-06 Task 1）。
 *
 * 覆盖 plan 六断言：放行 / 驳回前置校验 / 409 幂等 / 失败回滚 /
 * no-op（display 非 pending 或 reviewId 缺）/ 理由长度契约（1-500）。
 * gateOps 注入 mock——状态机纯函数层不发真实请求。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  planOp,
  runTerminalOp,
  isTerminal,
  terminalStates,
  validateReason,
  REASON_LIMITS,
  type TerminalGate,
  type TerminalOpEvent,
} from '../lib/gateOpsFlow'

/** gate-state p13-gate 条目 fixture（GateStateGate 结构兼容切片）。 */
function gate(o: Partial<TerminalGate> = {}): TerminalGate {
  return { gateId: 'p13-gate', label: '成片交付', display: 'pending', reviewId: 88, ...o }
}

/** 事件采集 + 可编程 gateOps mock（resolve 值或抛错）。 */
function harness(res: { applied: boolean; cause?: string } | Error) {
  const gateOps = vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  })
  const events: TerminalOpEvent[] = []
  return {
    gateOps,
    events,
    api: { gateOps },
    onEvent: (e: TerminalOpEvent) => events.push(e),
    types: () => events.map((e) => e.type),
  }
}

const ARGS = { projectId: 3, episodesId: 1 }

// ─── terminalStates / isTerminal（动作条不渲染的判定输入）────────────────

describe('terminalStates / isTerminal', () => {
  it('终态集 = approve/reject/waive/auto（54 四态折叠，非 pending 即已决）', () => {
    expect([...terminalStates]).toEqual(['approve', 'reject', 'waive', 'auto'])
    expect(isTerminal(gate({ display: 'pending' }))).toBe(false)
    expect(isTerminal(gate({ display: 'approve' }))).toBe(true)
    expect(isTerminal(gate({ display: 'reject' }))).toBe(true)
    expect(isTerminal(gate({ display: 'waive' }))).toBe(true)
    expect(isTerminal(gate({ display: 'auto' }))).toBe(true)
  })
})

// ─── validateReason（1-500 契约；ReasonDialog 消费同一函数）──────────────

describe('validateReason', () => {
  it('trim 后 1-500 为合规；空/全空白/超长不合规', () => {
    expect(validateReason('台词与口型对不上')).toBe(true)
    expect(validateReason('   ')).toBe(false)
    expect(validateReason('')).toBe(false)
    expect(validateReason('a'.repeat(REASON_LIMITS.max))).toBe(true)
    expect(validateReason('a'.repeat(REASON_LIMITS.max + 1))).toBe(false)
    expect(REASON_LIMITS).toEqual({ min: 1, max: 500 })
  })
})

// ─── planOp（前置判定：ready / no-op / invalid-reason）──────────────────

describe('planOp', () => {
  it('pending + reviewId → ready（携带 reviewId）', () => {
    expect(planOp(gate(), 'approve')).toEqual({ kind: 'ready', reviewId: 88 })
    expect(planOp(gate(), 'reject', '理由')).toEqual({ kind: 'ready', reviewId: 88 })
  })

  it('display 非 pending（已放行/驳回/豁免/auto）→ no-op terminal', () => {
    expect(planOp(gate({ display: 'approve' }), 'approve')).toEqual({ kind: 'no-op', why: 'terminal' })
    expect(planOp(gate({ display: 'waive' }), 'reject', '理由')).toEqual({ kind: 'no-op', why: 'terminal' })
  })

  it('reviewId 缺（legacy 无平台 review 项）→ no-op no-review-id', () => {
    expect(planOp(gate({ reviewId: undefined }), 'approve')).toEqual({
      kind: 'no-op',
      why: 'no-review-id',
    })
  })

  it('驳回 reason 不合规 → invalid-reason（前置校验，不发请求）', () => {
    expect(planOp(gate(), 'reject')).toEqual({ kind: 'invalid-reason' })
    expect(planOp(gate(), 'reject', '  ')).toEqual({ kind: 'invalid-reason' })
  })
})

// ─── runTerminalOp（三分支时序：乐观翻转 / 409 幂等 / 失败回滚）──────────

describe('runTerminalOp', () => {
  it('放行路径：approve 无 reason → 乐观翻 approve → applied:true 终态 + 54 toast', async () => {
    const h = harness({ applied: true })
    const out = await runTerminalOp({ ...ARGS, gate: gate(), action: 'approve', api: h.api, onEvent: h.onEvent })
    expect(out).toEqual({ kind: 'success', display: 'approve' })
    expect(h.gateOps).toHaveBeenCalledTimes(1)
    expect(h.gateOps).toHaveBeenCalledWith(3, 1, 88, 'approve', undefined)
    expect(h.types()).toEqual(['working', 'optimistic', 'success'])
    expect(h.events[1]).toEqual({ type: 'optimistic', display: 'approve' })
    expect(h.events[2]).toEqual({ type: 'success', display: 'approve', toast: '「成片交付」已放行' })
    expect(h.types()).not.toContain('rollback')
  })

  it('驳回路径：reason 合规 → reject 携 {reason}（trim 后）→ 乐观翻 reject', async () => {
    const h = harness({ applied: true })
    const out = await runOp(h, 'reject', '  台词对不上口型  ')
    expect(out).toEqual({ kind: 'success', display: 'reject' })
    expect(h.gateOps).toHaveBeenCalledWith(3, 1, 88, 'reject', { reason: '台词对不上口型' })
    expect(h.types()).toEqual(['working', 'optimistic', 'success'])
    expect(h.events[2]).toEqual({ type: 'success', display: 'reject', toast: '「成片交付」已驳回' })
  })

  it('驳回前置校验：reason 空 → 不发请求、零事件、invalid-reason', async () => {
    const h = harness({ applied: true })
    const out = await runOp(h, 'reject', '   ')
    expect(out).toEqual({ kind: 'invalid-reason' })
    expect(h.gateOps).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it('409 幂等：applied:false already-resolved → 不回滚、refetch 指令 + 54 词表 toast 逐字', async () => {
    const h = harness({ applied: false, cause: 'already-resolved' })
    const out = await runOp(h, 'approve')
    expect(out).toEqual({ kind: 'idempotent' })
    expect(h.types()).toEqual(['working', 'optimistic', 'idempotent'])
    expect(h.events[2]).toEqual({
      type: 'idempotent',
      toast: '该门已在别处处理（如 telegram），状态已刷新。',
      refetch: true,
    })
    expect(h.types()).not.toContain('rollback')
  })

  it('失败回滚：502 形态（apiCall 抛错）→ 乐观态回滚指令 + error toast + 原因透传', async () => {
    const h = harness(new Error('Request failed with status code 502'))
    const out = await runOp(h, 'approve')
    expect(out).toEqual({ kind: 'rollback' })
    expect(h.types()).toEqual(['working', 'optimistic', 'rollback'])
    expect(h.events[2]).toEqual({
      type: 'rollback',
      toast: '操作失败,已恢复原状态,请重试。',
      cause: 'Request failed with status code 502',
    })
  })

  it('422 形态（越集 reviewId 服务端拒绝）同样归失败分支', async () => {
    const h = harness(new Error('Request failed with status code 422'))
    const out = await runOp(h, 'reject', '理由')
    expect(out).toEqual({ kind: 'rollback' })
    expect(h.events[2]?.type).toBe('rollback')
    expect(h.events[2]?.type === 'rollback' && h.events[2].cause).toContain('422')
  })

  it('no-op：display 非 pending / reviewId 缺 → 不发请求、零事件', async () => {
    const h = harness({ applied: true })
    const out1 = await runTerminalOp({ ...ARGS, gate: gate({ display: 'approve' }), action: 'approve', api: h.api, onEvent: h.onEvent })
    const out2 = await runTerminalOp({ ...ARGS, gate: gate({ reviewId: undefined }), action: 'approve', api: h.api, onEvent: h.onEvent })
    expect(out1).toEqual({ kind: 'no-op', why: 'terminal' })
    expect(out2).toEqual({ kind: 'no-op', why: 'no-review-id' })
    expect(h.gateOps).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })
})

/** 快捷：runTerminalOp(action, reason?)。 */
async function runOp(
  h: ReturnType<typeof harness>,
  action: 'approve' | 'reject',
  reason?: string,
) {
  return runTerminalOp({
    ...ARGS,
    gate: gate(),
    action,
    ...(reason != null ? { reason } : {}),
    api: h.api,
    onEvent: h.onEvent,
  })
}
