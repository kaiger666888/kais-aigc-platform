/**
 * voiceAuditStore 单测(56-05 / VIZ-03)——seam/连播推进/乐观回滚。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useVoiceAuditStore, fixtureVoiceAuditSource, graphVoiceAuditSource, deriveClips, type VoiceClip } from '../voiceAuditStore'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'

function asset(id: string): AssetNodeV3 {
  return {
    id, branchId: 'main', phaseIndex: 11, phaseName: 'p10c_voice_audit',
    position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    state: 'success', kind: 'asset', stage: 'voice', modality: 'audio', scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    curation: 'candidate', stale: null,
  } as AssetNodeV3
}

function graphOf(nodes: AssetNodeV3[]): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 0, updatedAt: 0 },
    nodes, links: [], branches: [], variantGroups: [],
  } as unknown as FlowGraphV3
}

describe('deriveClips(56-05 防御式派生)', () => {
  it('clips 键三态齐字段;verdict 域外值过滤', () => {
    const out = deriveClips({
      clips: [
        { id: 'a', shot_id: 'S1', verdict: 'PASS', transcript: 'x', similarity: 0.9 },
        { id: 'b', shot_id: 'S2', verdict: 'ok' }, // 域外
        { shot_id: 'S3', verdict: 'fail' },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[0]!.verdict).toBe('pass')
    expect(out[1]!.verdict).toBe('fail')
  })

  it('findings 兜底键可识别', () => {
    const out = deriveClips({ findings: [{ shot_id: 'S9', verdict: 'WARN' }] })
    expect(out).toHaveLength(1)
    expect(out[0]!.verdict).toBe('warn')
  })

  it('无可识别列表 → 空数组不抛异常', () => {
    expect(deriveClips({ nonsense: true })).toEqual([])
  })
})

describe('graphVoiceAuditSource(真实源 seam)', () => {
  it('graph 含 voice-audit 节点 → clips 3 条', async () => {
    const g = graphOf([asset('aud-1')])
    const raw = new Map([['aud-1', { clips: [
      { shot_id: 'S1', verdict: 'PASS' },
      { shot_id: 'S2', verdict: 'FAIL' },
      { shot_id: 'S3', verdict: 'WARN' },
    ] }]])
    const clips = await graphVoiceAuditSource(g, raw).loadClips()
    expect(clips).toHaveLength(3)
  })

  it('graph null → 空;raw 无列表 → 空 + warn 一次', async () => {
    expect(await graphVoiceAuditSource(null, null).loadClips()).toEqual([])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const g = graphOf([asset('aud-2')])
    const raw = new Map([['aud-2', { phase: 'p10c_voice_audit' }]])
    expect(await graphVoiceAuditSource(g, raw).loadClips()).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})

describe('store(56-05 状态机)', () => {
  beforeEach(() => {
    useVoiceAuditStore.setState({
      open: false, rows: [], loaded: false, selected: new Set(), rowState: new Map(),
      currentIndex: 0, autoPlay: false, source: fixtureVoiceAuditSource(),
    })
  })

  it('load 经 fixture 源;rowState 全 pending', async () => {
    useVoiceAuditStore.getState().setOpen(true)
    await vi.waitFor(() => expect(useVoiceAuditStore.getState().loaded).toBe(true))
    const s = useVoiceAuditStore.getState()
    expect(s.rows.length).toBeGreaterThanOrEqual(5)
    expect([...s.rowState.values()].every((v) => v === 'pending')).toBe(true)
  })

  it('nextPending 跳过已豁免;末尾无可审 → null', async () => {
    await useVoiceAuditStore.getState().load()
    const s = useVoiceAuditStore.getState()
    s.markWaived([s.rows[1]!.id])
    expect(useVoiceAuditStore.getState().nextPending(0)).toBe(2)
    const last = s.rows.length - 1
    expect(useVoiceAuditStore.getState().nextPending(last)).toBeNull()
  })

  it('markWaived 乐观 + unmark 回滚', async () => {
    await useVoiceAuditStore.getState().load()
    const s = useVoiceAuditStore.getState()
    const ids = [s.rows[0]!.id, s.rows[2]!.id]
    s.markWaived(ids)
    expect(useVoiceAuditStore.getState().rowState.get(s.rows[0]!.id)).toBe('waived')
    s.unmark(ids)
    expect(useVoiceAuditStore.getState().rowState.get(s.rows[0]!.id)).toBe('pending')
  })

  it('toggle/selectAll/clear 选择集', async () => {
    await useVoiceAuditStore.getState().load()
    const s = useVoiceAuditStore.getState()
    s.toggle(s.rows[0]!.id)
    expect(useVoiceAuditStore.getState().selected.has(s.rows[0]!.id)).toBe(true)
    s.selectAll()
    expect(useVoiceAuditStore.getState().selected.size).toBe(s.rows.length)
    s.clear()
    expect(useVoiceAuditStore.getState().selected.size).toBe(0)
  })
})
