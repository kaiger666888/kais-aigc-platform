/**
 * deriveSearchResults 单测(55-04 / NAV-03)——纯派生行为表。
 * 场景分组/末组归置/raw 穿透/空 query/无 mutate/200 截断。
 */
import { describe, it, expect } from 'vitest'
import { deriveSearchResults } from '../canvas/SearchNavigator'

function node(id: string, data: Record<string, unknown>): { id: string; data: Record<string, unknown> } {
  return { id, data }
}

describe('deriveSearchResults(55-04 NAV-03)', () => {
  it('空/纯空白 query → 空结果', () => {
    expect(deriveSearchResults([node('a', { label: 'x' })], '').groups).toHaveLength(0)
    expect(deriveSearchResults([node('a', { label: 'x' })], '   ').groups).toHaveLength(0)
  })

  it('多场景命中按 sceneNum 升序分组', () => {
    const nodes = [
      node('s3', { shot_id: 'S03_001', label: 'S03_001' }),
      node('s1', { shot_id: 'S01_002', label: 'S01_002' }),
      node('s10', { shot_id: 'S10_001', label: 'S10_001' }),
    ]
    const r = deriveSearchResults(nodes, 'S')
    expect(r.groups.map((g) => g.sceneNum)).toEqual([1, 3, 10])
    expect(r.groups[0]?.hits[0]?.nodeId).toBe('s1')
  })

  it('非 shot 节点归「其他资产」末组(sceneNum=null)', () => {
    const nodes = [
      node('other', { label: '雨夜巷口' }),
      node('s1', { shot_id: 'S01_001', label: 'S01_001' }),
    ]
    const r = deriveSearchResults(nodes, '雨')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]?.sceneNum).toBeNull()
    expect(r.groups[0]?.title).toBe('其他资产')
    expect(r.groups[0]?.hits[0]?.kind).toBe('other')
  })

  it('raw 穿透:query 命中 video_prompt', () => {
    const nodes = [node('v1', { label: 'S02_003' })]
    const raw = { v1: { video_prompt: '她转身走进雨幕深处的巷口' } }
    const r = deriveSearchResults(nodes, '雨幕', raw)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]?.hits[0]?.nodeId).toBe('v1')
    expect(r.groups[0]?.hits[0]?.sub).toContain('雨幕')
  })

  it('大小写不敏感子串', () => {
    const nodes = [node('a', { label: 'Rain Alley' })]
    expect(deriveSearchResults(nodes, 'rain').groups).toHaveLength(1)
    expect(deriveSearchResults(nodes, 'ALLEY').groups).toHaveLength(1)
  })

  it('不 mutate 输入节点(深比较快照)', () => {
    const nodes = [node('a', { label: 'S01_001', prompt: 'x' })]
    const snapshot = JSON.parse(JSON.stringify(nodes))
    deriveSearchResults(nodes, 'S01', { a: { video_prompt: 'y' } })
    expect(nodes).toEqual(snapshot)
  })

  it('命中超过 200 条 → 截断 + truncated 标记', () => {
    const nodes = Array.from({ length: 230 }, (_, i) => node(`n${i}`, { shot_id: `S01_${String(i).padStart(3, '0')}` }))
    const r = deriveSearchResults(nodes, 'S01')
    expect(r.truncated).toBe(true)
    const total = r.groups.reduce((acc, g) => acc + g.hits.length, 0)
    expect(total).toBe(200)
  })
})
