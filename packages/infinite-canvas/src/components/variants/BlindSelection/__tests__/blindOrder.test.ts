/**
 * 盲选批 M2:盲选会话纯逻辑 util 测试(FIX-7.2)。
 *
 *  1. 随机序生成器同 (ids, seed) 恒同序——会话内固定,重渲/重算不漂移;
 *  2. 两候选取值域正确——恰为入参集合的不重不漏置换(位置效应聚合依赖);
 *  3. sessionId 形状 bsess_YYYYMMDD_HHMMSS(+08:00 墙钟)。
 */
import { describe, it, expect } from 'vitest'
import { makeSessionId, shuffleCandidates, buildBlindQueue } from '../blindOrder'

describe('shuffleCandidates(会话随机序)', () => {
  it('同 seed 同序:同一会话内重复计算恒稳定', () => {
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5']
    const first = shuffleCandidates(ids, 20260827)
    const second = shuffleCandidates(ids, 20260827)
    expect(first).toEqual(second)
  })

  it('两候选取值域正确:恰为入参的置换(不重不漏)', () => {
    for (const seed of [0, 1, 42, 999, 123456789]) {
      const out = shuffleCandidates(['nodeA', 'nodeB'], seed)
      expect(out.length).toBe(2)
      expect([...out].sort()).toEqual(['nodeA', 'nodeB'])
    }
  })

  it('五候选同样是置换,且不改入参数组', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const snapshot = [...ids]
    const out = shuffleCandidates(ids, 777)
    expect([...out].sort()).toEqual(snapshot)
    expect(ids).toEqual(snapshot) // 入参引用不被篡改
  })

  it('单候选/空数组不炸:原样返回', () => {
    expect(shuffleCandidates(['only'], 3)).toEqual(['only'])
    expect(shuffleCandidates([], 3)).toEqual([])
  })
})

describe('makeSessionId', () => {
  it('形状 bsess_YYYYMMDD_HHMMSS(+08:00 墙钟)', () => {
    // UTC 2026-08-27 14:30:05 → +08:00 墙钟 22:30:05
    const id = makeSessionId(new Date('2026-08-27T14:30:05Z'))
    expect(id).toBe('bsess_20260827_223005')
    expect(makeSessionId()).toMatch(/^bsess_\d{8}_\d{6}$/)
  })
})

describe('buildBlindQueue(会话队列)', () => {
  const groups = [
    { id: 'cand:name:x/y', winnerNodeId: null, variantNodeIds: ['a', 'b'] },
    { id: 'cand:shot:S2:first', winnerNodeId: null, variantNodeIds: ['c', 'd'] },
    { id: 'cand:shot:S1:first', winnerNodeId: 'w1', variantNodeIds: ['e', 'f'] },
    { id: 'cand:solo', winnerNodeId: null, variantNodeIds: ['g'] }, // 单成员不成组
  ]

  it('缺省只取待决组(winner 未定且 ≥2 成员),shot 组排前', () => {
    const q = buildBlindQueue(groups)
    expect(q.map((g) => g.id)).toEqual(['cand:shot:S2:first', 'cand:name:x/y'])
  })

  it('includeDecided 翻案模式:已选定组也入队', () => {
    const q = buildBlindQueue(groups, { includeDecided: true })
    expect(q.map((g) => g.id)).toContain('cand:shot:S1:first')
    expect(q.map((g) => g.id)).not.toContain('cand:solo')
  })
})
