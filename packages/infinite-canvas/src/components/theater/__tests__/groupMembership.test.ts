/**
 * groupMembership 单测(56-04 / D-05 前置)——三问纯推导行为表。
 * 判定三链 + null 路径 / 变体组成员 / characterId 同族 / scene_id /
 * voice 双形态 / 孤节点 / graph null。
 */
import { describe, it, expect } from 'vitest'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { theaterTargetOf, deriveGroupMembers, turnaroundSlots } from '../groupMembership'

function asset(id: string, scope: 'global' | 'episode' = 'episode'): AssetNodeV3 {
  return {
    id, branchId: 'main', phaseIndex: 0, phaseName: 'p04',
    position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    state: 'success', kind: 'asset', stage: 'global', modality: 'image', scope,
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    curation: 'candidate', stale: null,
  } as AssetNodeV3
}

function graphOf(nodes: AssetNodeV3[], variantGroups: FlowGraphV3['variantGroups'] = []): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 0, updatedAt: 0 },
    nodes, links: [], branches: [], variantGroups,
  } as unknown as FlowGraphV3
}

describe('theaterTargetOf(56-04 判定三链)', () => {
  const mk = (id: string, data: Record<string, unknown>) => ({ id, data })

  it('assetType character → turnaround;scene → scene;metaSub voice_profile → voice', () => {
    const g = graphOf([asset('c1'), asset('s1'), asset('v1')])
    const raw = new Map([
      ['c1', { assetType: 'character' }],
      ['s1', { assetType: 'scene' }],
      ['v1', { metaSub: 'voice_profile' }],
    ])
    expect(theaterTargetOf(mk('c1', {}), g, raw)).toEqual({ kind: 'turnaround', anchorId: 'c1' })
    expect(theaterTargetOf(mk('s1', {}), g, raw)).toEqual({ kind: 'scene', anchorId: 's1' })
    expect(theaterTargetOf(mk('v1', {}), g, raw)).toEqual({ kind: 'voice', anchorId: 'v1' })
  })

  it('变体组成员 → turnaround', () => {
    const g = graphOf([asset('v-a'), asset('v-b')], [
      { id: 'vg1', branchId: 'main', phaseIndex: 9, sourceEventId: 'e1', variantNodeIds: ['v-a', 'v-b'], selectMode: 'single' },
    ])
    expect(theaterTargetOf(mk('v-b', {}), g, null)).toEqual({ kind: 'turnaround', anchorId: 'v-b' })
  })

  it('video/storyboard/普通 shot 资产 → null(双击原语义)', () => {
    const g = graphOf([asset('vid1')])
    expect(theaterTargetOf(mk('vid1', { assetType: 'video' }), g, null)).toBeNull()
    expect(theaterTargetOf(mk('sb1', { shot_id: 'S01_001' }), g, null)).toBeNull()
    expect(theaterTargetOf(mk('plain', {}), g, null)).toBeNull()
  })
})

describe('deriveGroupMembers(56-04 组员推导)', () => {
  it('turnaround:同 characterId 的 global 域资产集', () => {
    const g = graphOf([asset('c1', 'global'), asset('c2', 'global'), asset('x', 'global')])
    const raw = new Map([
      ['c1', { characterId: 'lin', assetType: 'character' }],
      ['c2', { characterId: 'lin', assetType: 'character' }],
      ['x', { characterId: 'other', assetType: 'character' }],
    ])
    const m = deriveGroupMembers('turnaround', 'c1', g, raw)
    expect(m.map((x) => x.nodeId)).toEqual(['c1', 'c2'])
  })

  it('变体组 → variantNodeIds 成员(winner 优先)', () => {
    const g = graphOf([asset('v-a'), asset('v-b')], [
      { id: 'vg1', branchId: 'main', phaseIndex: 9, sourceEventId: 'e1', variantNodeIds: ['v-a', 'v-b'], winnerNodeId: 'v-b', selectMode: 'single' },
    ])
    const m = deriveGroupMembers('turnaround', 'v-a', g, null)
    expect(m.map((x) => x.nodeId)).toEqual(['v-b', 'v-a'])
  })

  it('scene:同 scene_id 资产集', () => {
    const g = graphOf([asset('s1'), asset('s2'), asset('s3')])
    const raw = new Map([
      ['s1', { scene_id: 'alley', assetType: 'scene' }],
      ['s2', { scene_id: 'alley', assetType: 'scene', views: { front: '/oss/f.png', angle_left: '/oss/l.png' } }],
      ['s3', { scene_id: 'rooftop', assetType: 'scene' }],
    ])
    const m = deriveGroupMembers('scene', 's1', g, raw)
    expect(m.map((x) => x.nodeId)).toEqual(['s1', 's2'])
    expect(m[1]?.views).toEqual({ front: '/oss/f.png', angle_left: '/oss/l.png' })
  })

  it('voice:profile 锚 + 同 characterId voice_print 集', () => {
    const g = graphOf([asset('vp'), asset('vp2'), asset('print1')])
    const raw = new Map([
      ['vp', { metaSub: 'voice_profile', characterId: 'lin' }],
      ['vp2', { metaSub: 'voice_profile', characterId: 'other' }],
      ['print1', { metaSub: 'voice_print', characterId: 'lin' }],
    ])
    const m = deriveGroupMembers('voice', 'vp', g, raw)
    expect(m.map((x) => x.nodeId)).toEqual(['vp', 'print1'])
  })

  it('孤节点(无同族) → 空或仅锚;graph null → 空不抛异常', () => {
    const g = graphOf([asset('solo', 'global')])
    const raw = new Map([['solo', { characterId: 'nobody', assetType: 'character' }]])
    const m = deriveGroupMembers('turnaround', 'solo', g, raw)
    expect(m.map((x) => x.nodeId)).toEqual(['solo'])
    expect(deriveGroupMembers('turnaround', 'solo', null, null)).toEqual([])
  })
})

describe('turnaroundSlots(56-04 四宫格槽位)', () => {
  it('face_cu 优先正面槽;空槽占位 null', () => {
    const members = [
      { nodeId: 'side1', label: 's', viewAngle: 'side' },
      { nodeId: 'face1', label: 'f', viewAngle: 'face_cu' },
    ]
    const slots = turnaroundSlots(members)
    expect(slots[0]?.nodeId).toBe('face1')
    expect(slots[2]?.nodeId).toBe('side1')
    expect(slots[1]).toBeNull()
    expect(slots[3]).toBeNull()
  })
})
