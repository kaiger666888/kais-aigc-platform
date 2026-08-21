/**
 * phaseRegistry 单测(Phase 55-01 / NAV-01)。
 *
 * 注册表完整性不变量:22 条 / code·khsPrefix 唯一 / 成功标准 1 前缀清单
 * 全在 / 注销前缀不在 / p11a0 折叠(sub + 共 phaseIndex + prefix)/ p12a·p12b
 * 非 sub 共 lane / phaseIndex 逐条对 khs _PHASE_INDEX_MAP 嵌入值 / group
 * 覆盖 / sortKey 升序后 ZONE_PHASES lane 内顺序成立。
 * khs 三真相源的活体契约(读 khs 文件双向 diff)在 scripts/verify-phase-55.ts。
 */
import { describe, it, expect } from 'vitest'
import {
  PHASE_REGISTRY,
  DEREGISTERED_PHASE_PREFIXES,
  phaseByPrefix,
  type PipelinePhaseDef,
} from '../phaseRegistry'

const byKhs = (khsPrefix: string): PipelinePhaseDef => {
  const hit = PHASE_REGISTRY.find((p) => p.khsPrefix === khsPrefix)
  if (hit == null) throw new Error(`missing ${khsPrefix}`)
  return hit
}

describe('phaseRegistry(55-01 NAV-01)', () => {
  it('恰好 22 条;code 与 khsPrefix 各自唯一', () => {
    expect(PHASE_REGISTRY).toHaveLength(22)
    expect(new Set(PHASE_REGISTRY.map((p) => p.code)).size).toBe(22)
    expect(new Set(PHASE_REGISTRY.map((p) => p.khsPrefix)).size).toBe(22)
  })

  it('成功标准 1 前缀清单全存在', () => {
    for (const p of ['p035', 'p09b', 'p09c', 'p10c', 'p11a', 'p11a0', 'p12a', 'p12b', 'p14', 'p15']) {
      expect(PHASE_REGISTRY.some((e) => e.khsPrefix === p), p).toBe(true)
    }
  })

  it('注销前缀不在 khsPrefix 集合', () => {
    const live = new Set(PHASE_REGISTRY.map((p) => p.khsPrefix))
    for (const p of DEREGISTERED_PHASE_PREFIXES) {
      expect(live.has(p), p).toBe(false)
    }
  })

  it('p11a0 折叠:sub + 共 p11a 的 phaseIndex + prefix=p11a', () => {
    const a0 = byKhs('p11a0')
    const a = byKhs('p11a')
    expect(a0.sub).toBe(true)
    expect(a0.phaseIndex).toBe(a.phaseIndex)
    expect(a0.phaseIndex).toBe(14)
    expect(a0.prefix).toBe('p11a')
  })

  it('p12a/p12b:非 sub(各自承载资产)且 phaseIndex === 15', () => {
    const a = byKhs('p12a')
    const b = byKhs('p12b')
    expect(a.sub).toBeUndefined()
    expect(b.sub).toBeUndefined()
    expect(a.phaseIndex).toBe(15)
    expect(b.phaseIndex).toBe(15)
  })

  it('逐条 phaseIndex === khs _PHASE_INDEX_MAP 嵌入值', () => {
    const expected: Record<string, number> = {
      p01: 1, p02: 2, p03: 3, p035: 3, p04: 4, p06: 6, p07: 7, p08: 8, p09: 9,
      p09b: 10, p09c: 10, p10: 11, p10c: 12, p11a: 14, p11b: 14, p11c: 14,
      p12a: 15, p12b: 15, p13: 16, p14: 17, p15: 18,
    }
    for (const [khsPrefix, idx] of Object.entries(expected)) {
      expect(byKhs(khsPrefix).phaseIndex, khsPrefix).toBe(idx)
    }
  })

  it('group 覆盖:四组各 ≥2;p09c/p09b production,p12a/p12b/p14/p15 post', () => {
    const groups = new Set(PHASE_REGISTRY.map((p) => p.group))
    expect([...groups].sort()).toEqual(['post', 'production', 'research', 'story'])
    for (const g of ['research', 'story', 'production', 'post'] as const) {
      expect(PHASE_REGISTRY.filter((p) => p.group === g).length >= 2, g).toBe(true)
    }
    expect(byKhs('p09c').group).toBe('production')
    expect(byKhs('p09b').group).toBe('production')
    expect(byKhs('p12a').group).toBe('post')
    expect(byKhs('p12b').group).toBe('post')
    expect(byKhs('p14').group).toBe('post')
    expect(byKhs('p15').group).toBe('post')
  })

  it('sortKey 升序后 ZONE_PHASES 可见顺序成立(lane 内顺序权威)', () => {
    const sorted = [...PHASE_REGISTRY].sort((a, b) => a.sortKey - b.sortKey)
    const orderOf = (khsPrefix: string): number => {
      const i = sorted.findIndex((p) => p.khsPrefix === khsPrefix)
      if (i < 0) throw new Error(`missing ${khsPrefix}`)
      return i
    }
    expect(orderOf('p11a')).toBeLessThan(orderOf('p11b'))
    expect(orderOf('p11b')).toBeLessThan(orderOf('p11c'))
    expect(orderOf('p11c')).toBeLessThan(orderOf('p12a'))
    expect(orderOf('p12a')).toBeLessThan(orderOf('p12b'))
    expect(orderOf('p09')).toBeLessThan(orderOf('p09b'))
    expect(orderOf('p09b')).toBeLessThan(orderOf('p09c'))
    expect(orderOf('p09c')).toBeLessThan(orderOf('p10'))
    // p11a0 折叠进 p11a 与 p11b 之间
    expect(orderOf('p11a')).toBeLessThan(orderOf('p11a0'))
    expect(orderOf('p11a0')).toBeLessThan(orderOf('p11b'))
  })

  it('phaseByPrefix:lane 查取得 p11a 主条目(非 p11a0)', () => {
    expect(phaseByPrefix['p11a']?.khsPrefix).toBe('p11a')
    expect(phaseByPrefix['p13']?.code).toBe('P13')
  })
})
