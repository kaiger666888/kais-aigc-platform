/**
 * qcVerdict 单测(56-01 / D-13 单一真值链)。
 * 六组:voice-audit join / video-qc eye + 大小写映射 / 眼耳共存 /
 * 无可识别列表 warn 不 throw / shortcut 直读 / 空输入。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { deriveQcVerdicts, registerAuditToken } from '../qcVerdict'

function assetNode(id: string): AssetNodeV3 {
  return {
    id, branchId: 'main', phaseIndex: 9, phaseName: 'p09',
    position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    state: 'success', kind: 'asset', stage: 'storyboard', modality: 'image', scope: 'episode',
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

describe('deriveQcVerdicts(56-01 眼/耳 verdict 派生)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warnSpy.mockRestore() })

  it('voice-audit clips 按 shot_id join 资产 → ear/fail', () => {
    const g = graphOf([assetNode('aud_voice-audit-1'), assetNode('a-shot-012')])
    const raw = new Map([
      ['aud_voice-audit-1', { clips: [{ shot_id: 'shot_012', verdict: 'FAIL' }] }],
      ['a-shot-012', { shot_id: 'shot_012' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-shot-012')).toEqual([{ judge: 'ear', verdict: 'fail' }])
  })

  it('video-qc per_shot / preview-qc variants → eye;大小写映射', () => {
    const g = graphOf([assetNode('a-video-qc-1'), assetNode('a-preview-qc-1'), assetNode('a-shot-3')])
    const raw = new Map([
      ['a-video-qc-1', { per_shot: [{ shot_id: 'S3', verdict: 'PASS' }] }],
      ['a-preview-qc-1', { variants: [{ shot_id: 'S3', verdict: 'warn' }] }],
      ['a-shot-3', { shot_id: 'S3' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    const v = m.get('a-shot-3')!
    expect(v).toContainEqual({ judge: 'eye', verdict: 'pass' })
    expect(v).toContainEqual({ judge: 'eye', verdict: 'warn' })
  })

  it('同一资产眼+耳共存 → QcVerdict[] 聚合', () => {
    const g = graphOf([assetNode('a-voice-audit'), assetNode('a-video-qc'), assetNode('a-both')])
    const raw = new Map([
      ['a-voice-audit', { clips: [{ shot_id: 'X', verdict: 'FAIL' }] }],
      ['a-video-qc', { shots: [{ shot_id: 'X', verdict: 'PASS' }] }],
      ['a-both', { shot_id: 'X' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-both')).toHaveLength(2)
  })

  it('审计节点无可识别列表 → 空 Map + warn 一次,不 throw', () => {
    const g = graphOf([assetNode('a-voice-audit-2')])
    const raw = new Map([['a-voice-audit-2', { phase: 'p10c_voice_audit', nonsense: true }]])
    expect(() => deriveQcVerdicts(g, raw)).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(m0(g, raw).size).toBe(0)
    function m0(gg: FlowGraphV3, rr: Map<string, Record<string, unknown>>) { return deriveQcVerdicts(gg, rr) }
  })

  it('资产 raw 袋 qc_verdict 直读优先(shortcut)', () => {
    const g = graphOf([assetNode('a-direct')])
    const raw = new Map([['a-direct', { qc_verdict: 'fail' }]])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-direct')).toEqual([{ judge: 'eye', verdict: 'fail' }])
  })

  it('graph null / raw null → 空 Map 不 throw', () => {
    expect(deriveQcVerdicts(null, null).size).toBe(0)
    expect(deriveQcVerdicts(graphOf([assetNode('a')]), null).size).toBe(0)
  })

  // ── 72-01/72-05 (v3.2 F26/F32):khs 真实形状修真 ─────────────────────────

  it('F26: p11c per_shot 为 dict {sid:rec} 形(非 array)→ 眼审 join 命中', () => {
    const g = graphOf([assetNode('a-video-qc-real'), assetNode('a-S01')])
    const raw = new Map([
      // khs p11c_video_qc.py 真实 slot 形状:per_shot 是 dict
      ['a-video-qc-real', { phase: 'p11c', per_shot: { S01: { shot_id: 'S01', verdict: 'pass' }, S02: { shot_id: 'S02', verdict: 'fail' } } }],
      ['a-S01', { shot_id: 'S01' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-S01')).toEqual([{ judge: 'eye', verdict: 'pass' }])
  })

  it('F26: p10c clips 嵌在 fidelity_check 下(非顶层)→ 耳审 join 命中', () => {
    const g = graphOf([assetNode('a-voice-audit-real'), assetNode('a-S02')])
    const raw = new Map([
      // khs p10c_voice_audit.py 真实 slot 形状:fidelity_check.clips 嵌套层
      ['a-voice-audit-real', { phase: 'p10c', fidelity_check: { check: 'transcription_fidelity', clips: [{ id: 'wav1', shot_id: 'S02', verdict: 'WARN' }] } }],
      ['a-S02', { shot_id: 'S02' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-S02')).toEqual([{ judge: 'ear', verdict: 'warn' }])
  })

  it('F32: 五值 verdict(ERROR/SKIPPED/MUST_FIX)不再被静默丢弃', () => {
    const g = graphOf([assetNode('a-va-5'), assetNode('a-vq-5'), assetNode('a-x5')])
    const raw = new Map([
      ['a-va-5', { phase: 'p10c_voice_audit', clips: [{ shot_id: 'X5', verdict: 'ERROR' }, { shot_id: 'X5', verdict: 'SKIPPED' }] }],
      ['a-vq-5', { phase: 'p11c_video_qc', shots: [{ shot_id: 'X5', verdict: 'MUST_FIX' }] }],
      ['a-x5', { shot_id: 'X5' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    const v = m.get('a-x5')!
    expect(v).toContainEqual({ judge: 'ear', verdict: 'error' })
    expect(v).toContainEqual({ judge: 'ear', verdict: 'skipped' })
    expect(v).toContainEqual({ judge: 'eye', verdict: 'must_fix' })
  })

  it('QVR-06: registerAuditToken 扩展词表(khs 新审计 phase 无需改源码)', () => {
    registerAuditToken('storyboard-qc', 'eye')
    const g = graphOf([assetNode('a-storyboard-qc-9'), assetNode('a-y9')])
    const raw = new Map([
      ['a-storyboard-qc-9', { clips: [{ shot_id: 'Y9', verdict: 'PASS' }] }],
      ['a-y9', { shot_id: 'Y9' }],
    ])
    const m = deriveQcVerdicts(g, raw)
    expect(m.get('a-y9')).toEqual([{ judge: 'eye', verdict: 'pass' }])
  })
})
