/**
 * GATE-02 / P6 行为测试:gateStore apply 去重 + degrade 保真 + open 切换
 * (Phase 54-04)。
 *
 * 四不变量:
 *  1. apply 同内容 payload(对象身份不同)→ subscriber 不再被调用(去重);
 *  2. 任一要素变化(gates 元素字段/fetchedAt/degrade/blocking)→ 更新;
 *  3. degrade=true 快照照常应用(绝不折叠为全放行/绝不丢弃);
 *  4. 初始态 + setOpen 切换。
 *
 * subscribe 计数法:zustand subscribe listener 每次 set 触发一次,
 * apply 内部 return(不 set)则零触发。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useGateStore, resolveRepresentativeNodeId, type GateStatePayload } from '../gateStore'

function makePayload(overrides: Partial<GateStatePayload> = {}): GateStatePayload {
  return {
    projectId: 7,
    episodesId: 3,
    fetchedAt: 1_000,
    degrade: false,
    blocking: null,
    gates: [
      { gateId: 'p01-gate', phaseId: 'p01_hook_topic', label: '选题定向', display: 'approve', reviewId: 11 },
      { gateId: 'p13-gate', phaseId: 'p13_delivery', label: '成片交付', display: 'pending' },
    ],
    ...overrides,
  }
}

describe('gateStore (54-04 GATE-02)', () => {
  beforeEach(() => {
    useGateStore.setState({ snapshot: null, degrade: false, open: false })
  })

  it('初始 state:snapshot=null / degrade=false / open=false', () => {
    const s = useGateStore.getState()
    expect(s.snapshot).toBeNull()
    expect(s.degrade).toBe(false)
    expect(s.open).toBe(false)
  })

  it('apply 后 state.snapshot === payload 且 degrade 跟随', () => {
    const p = makePayload()
    useGateStore.getState().apply(p)
    expect(useGateStore.getState().snapshot).toBe(p)
    expect(useGateStore.getState().degrade).toBe(false)
  })

  it('P6 去重:同内容(不同对象身份)的后续 apply 不触发 subscriber', () => {
    const { apply } = useGateStore.getState()
    apply(makePayload())
    let fires = 0
    const unsub = useGateStore.subscribe(() => { fires++ })
    apply(makePayload()) // 逐字段等值,新对象
    expect(fires).toBe(0)
    expect(useGateStore.getState().snapshot).not.toBeNull()
    unsub()
  })

  it('gates 元素字段变化 → 更新并触发 subscriber', () => {
    const { apply } = useGateStore.getState()
    apply(makePayload())
    let fires = 0
    const unsub = useGateStore.subscribe(() => { fires++ })
    apply(makePayload({
      fetchedAt: 2_000,
      gates: [
        { gateId: 'p01-gate', phaseId: 'p01_hook_topic', label: '选题定向', display: 'approve', reviewId: 11 },
        { gateId: 'p13-gate', phaseId: 'p13_delivery', label: '成片交付', display: 'reject', reviewId: 12, note: '情绪红线' },
      ],
    }))
    expect(fires).toBe(1)
    const snap = useGateStore.getState().snapshot
    expect(snap?.gates[1]?.display).toBe('reject')
    expect(snap?.gates[1]?.note).toBe('情绪红线')
    unsub()
  })

  it('degrade=true 快照照常应用(绝不折叠为全放行)', () => {
    useGateStore.getState().apply(makePayload({ fetchedAt: 3_000, degrade: true }))
    const s = useGateStore.getState()
    expect(s.degrade).toBe(true)
    expect(s.snapshot?.degrade).toBe(true)
    expect(s.snapshot?.gates.length).toBe(2)
  })

  it('blocking 从 null → 有值 → 更新;回 null → 更新', () => {
    const { apply } = useGateStore.getState()
    apply(makePayload())
    apply(makePayload({
      fetchedAt: 4_000,
      blocking: { gateId: 'p13-gate', reviewId: 12, phaseId: 'p13_delivery', label: '成片交付' },
    }))
    expect(useGateStore.getState().snapshot?.blocking?.reviewId).toBe(12)
    apply(makePayload({ fetchedAt: 5_000 }))
    expect(useGateStore.getState().snapshot?.blocking).toBeNull()
  })

  it('setOpen 切换 open', () => {
    useGateStore.getState().setOpen(true)
    expect(useGateStore.getState().open).toBe(true)
    useGateStore.getState().setOpen(false)
    expect(useGateStore.getState().open).toBe(false)
  })
})

describe('resolveRepresentativeNodeId(54-06 三级解析)', () => {
  const blocking = { gateId: 'p13-gate', reviewId: 3, phaseId: 'p13_delivery', label: '成片交付' }

  it('一级:g-{gateId} 节点命中', () => {
    const nodes = [
      { id: 'asset-1', phaseName: 'p13_delivery' },
      { id: 'g-p13-gate' },
    ]
    expect(resolveRepresentativeNodeId(blocking, nodes)).toBe('g-p13-gate')
  })

  it('二级:n-{phaseId} 节点命中(g 级缺席)', () => {
    const nodes = [
      { id: 'asset-1', phaseName: 'p13_delivery' },
      { id: 'n-p13_delivery' },
    ]
    expect(resolveRepresentativeNodeId(blocking, nodes)).toBe('n-p13_delivery')
  })

  it('三级:phaseName token 等值的首资产命中', () => {
    const nodes = [
      { id: 'asset-0', phaseName: 'p11c_video_qc' },
      { id: 'asset-1', phaseName: 'p13_delivery' },
    ]
    expect(resolveRepresentativeNodeId(blocking, nodes)).toBe('asset-1')
  })

  it('token 等值反例:p1 ≠ p11a0(禁前缀互撞)', () => {
    const nodes = [{ id: 'asset-x', phaseName: 'p1_tone' }]
    const p11a0 = { gateId: 'p11a0-gate', reviewId: 9, phaseId: 'p11a0_iframe_qc', label: '条件帧门' }
    expect(resolveRepresentativeNodeId(p11a0, nodes)).toBeNull()
  })

  it('三级皆无 → null;blocking 为 null → null', () => {
    expect(resolveRepresentativeNodeId(blocking, [{ id: 'a', phaseName: 'p07_scene_generation' }])).toBeNull()
    expect(resolveRepresentativeNodeId(null, [{ id: 'g-p13-gate' }])).toBeNull()
  })
})
