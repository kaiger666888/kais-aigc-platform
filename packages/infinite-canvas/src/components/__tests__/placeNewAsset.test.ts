/**
 * placeNewAsset 单测(55-04 / NAV-04)——有界落点纯函数。
 * 成功标准 4 的纯函数口径:坐标与源/视口中心距离有界 + 网格对齐。
 */
import { describe, it, expect } from 'vitest'
import { placeNewAsset, PLACE_OFFSET, PLACE_GRID } from '../../utils/placeNewAsset'

describe('placeNewAsset(55-04 NAV-04)', () => {
  it('source 分支:右上偏移 +24/−16,两轴 4px 网格对齐', () => {
    const src = { x: 101, y: 207 }
    const p = placeNewAsset({ sourcePosition: src, viewportCenter: { x: 0, y: 0 }, anchor: 'source' })
    expect(Math.abs(p.x - (src.x + PLACE_OFFSET.x))).toBeLessThanOrEqual(PLACE_GRID.source / 2)
    expect(Math.abs(p.y - (src.y + PLACE_OFFSET.y))).toBeLessThanOrEqual(PLACE_GRID.source / 2)
    expect(p.x % PLACE_GRID.source).toBe(0)
    expect(p.y % PLACE_GRID.source).toBe(0)
  })

  it('center 分支:与视口中心各轴 ≤4(8px 网格半步)且为 8 的倍数', () => {
    const c = { x: 123, y: 456 }
    const p = placeNewAsset({ viewportCenter: c, anchor: 'center' })
    expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(PLACE_GRID.center / 2)
    expect(Math.abs(p.y - c.y)).toBeLessThanOrEqual(PLACE_GRID.center / 2)
    expect(p.x % PLACE_GRID.center).toBe(0)
    expect(p.y % PLACE_GRID.center).toBe(0)
  })

  it.each([
    ['sourcePosition 为 NaN', { x: NaN, y: 10 } as { x: number; y: number }],
    ['sourcePosition 为 Infinity', { x: Infinity, y: 10 } as { x: number; y: number }],
  ])('%s → 防御性走 center 分支', (_label, bad) => {
    const p = placeNewAsset({ sourcePosition: bad, viewportCenter: { x: 400, y: 300 }, anchor: 'source' })
    expect(Math.abs(p.x - 400)).toBeLessThanOrEqual(4)
    expect(Math.abs(p.y - 300)).toBeLessThanOrEqual(4)
  })

  it('sourcePosition null/缺失 → center 分支', () => {
    const p = placeNewAsset({ sourcePosition: null, viewportCenter: { x: 80, y: 80 }, anchor: 'source' })
    expect(p).toEqual({ x: 80, y: 80 })
  })

  it('anchor 缺省(默认)→ center 分支', () => {
    const p = placeNewAsset({ sourcePosition: { x: 1000, y: 1000 }, viewportCenter: { x: 16, y: 24 } })
    expect(p).toEqual({ x: 16, y: 24 })
  })

  it('viewportCenter 本身非有限 → 钳到原点(不产 NaN)', () => {
    const p = placeNewAsset({ viewportCenter: { x: NaN, y: Infinity } })
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })

  it('有界常量:偏移量固定(+24,−16),网格 4/8(成功标准 4 契约)', () => {
    expect(PLACE_OFFSET).toEqual({ x: 24, y: -16 })
    expect(PLACE_GRID).toEqual({ source: 4, center: 8 })
  })
})
