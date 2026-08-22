import { describe, expect, it } from 'vitest'
import { PHASE_REGISTRY } from '@ic/constants/phaseRegistry'
import { ribbonSegments, ribbonHref } from '../lib/ribbon'

describe('ribbonSegments（22 段恒等）', () => {
  it('注册表 22 条 → 22 段，逐字段映射', () => {
    const segs = ribbonSegments(PHASE_REGISTRY, {})
    expect(segs).toHaveLength(22)
    expect(PHASE_REGISTRY).toHaveLength(22)
    expect(segs[0]).toMatchObject({
      code: 'P01',
      name: '选题/钩子',
      group: 'research',
      sub: false,
      khsPrefix: 'p01',
      phaseIndex: 1,
      filled: false,
      count: 0,
    })
  })

  it('按 sortKey 升序输出（含 .5 子相位插入）', () => {
    const segs = ribbonSegments(PHASE_REGISTRY, {})
    const keys = segs.map((s) => s.sortKey)
    const sorted = [...keys].sort((a, b) => a - b)
    expect(keys).toEqual(sorted)
    // 相邻段 code 抽查：P03 → P03.5 → P04
    const codes = segs.map((s) => s.code)
    expect(codes.indexOf('P03.5')).toBe(codes.indexOf('P03') + 1)
    expect(codes.indexOf('P04')).toBe(codes.indexOf('P03.5') + 1)
  })

  it('sub 段集合 = 注册表 sub:true 全集（Plan 偏差注：UI-SPEC 列了 6 段漏了 P08；PHASE_REGISTRY 是 55 契约测试守护的 SSOT，实际 7 段，ribbon 只跟随注册表不内联增删）', () => {
    const segs = ribbonSegments(PHASE_REGISTRY, {})
    const subCodes = segs.filter((s) => s.sub).map((s) => s.code)
    expect(subCodes).toEqual(['P03.5', 'P08', 'P09b', 'P09c', 'P10c', 'P11a0', 'P11c'])
    expect(subCodes).toHaveLength(
      PHASE_REGISTRY.filter((p) => p.sub === true).length,
    )
  })
})

describe('ribbonSegments（filled 判定）', () => {
  it('counts[phaseIndex] > 0 → filled；缺键/0/负数 → 空段', () => {
    const segs = ribbonSegments(PHASE_REGISTRY, { 1: 5, 9: 0, 16: 3 })
    const byCode = Object.fromEntries(segs.map((s) => [s.code, s]))
    expect(byCode['P01'].filled).toBe(true)
    expect(byCode['P01'].count).toBe(5)
    // phaseIndex 9 = P09（counts 显式 0 → 空段）
    expect(byCode['P09'].filled).toBe(false)
    // phaseIndex 16 = P13（filled）
    expect(byCode['P13'].filled).toBe(true)
    // 缺键 → 0
    expect(byCode['P07'].filled).toBe(false)
    expect(byCode['P07'].count).toBe(0)
  })

  it('共享 phaseIndex 的段同 filled（P11a/P11a0/P11b/P11c 共 14）', () => {
    const segs = ribbonSegments(PHASE_REGISTRY, { 14: 2 })
    const lane14 = segs.filter((s) => s.phaseIndex === 14).map((s) => s.code)
    // sortKey 升序：P11a(12) < P11a0(12.5) < P11b(13) < P11c(13.5)
    expect(lane14).toEqual(['P11a', 'P11a0', 'P11b', 'P11c'])
    for (const s of segs.filter((x) => x.phaseIndex === 14)) {
      expect(s.filled).toBe(true)
      expect(s.count).toBe(2)
    }
  })
})

describe('ribbonHref（D-05 深链发码格式）', () => {
  it('无 zone：/canvas?project={id}&ep={ep}', () => {
    expect(ribbonHref(3, 1)).toBe('/canvas?project=3&ep=1')
  })

  it('有 zone：追加 &zone={khsPrefix}', () => {
    expect(ribbonHref(3, 1, 'p11b')).toBe('/canvas?project=3&ep=1&zone=p11b')
    expect(ribbonHref(12, 7, 'p13')).toBe('/canvas?project=12&ep=7&zone=p13')
  })

  it('空串 zone 视为缺省（不发空参）', () => {
    expect(ribbonHref(3, 1, '')).toBe('/canvas?project=3&ep=1')
  })
})
