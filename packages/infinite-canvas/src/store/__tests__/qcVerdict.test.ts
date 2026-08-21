/**
 * qcVerdict 单测(56-01 / D-13 单一真值链)。
 * 六组:voice-audit join / video-qc eye + 大小写映射 / 眼耳共存 /
 * 无可识别列表 warn 不 throw / shortcut 直读 / 空输入。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { deriveQcVerdicts } from '../qcVerdict'

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
})
