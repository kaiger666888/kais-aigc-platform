/**
 * transcriptAlign 单测(56-02)——分句/等时加权/定位钳制。
 */
import { describe, it, expect } from 'vitest'
import { splitSentences, evenAlign, sentenceAt } from '../transcriptAlign'

describe('splitSentences(56-02)', () => {
  it('句末标点切分且标点保留', () => {
    expect(splitSentences('你好。今天天气如何?走吧!')).toEqual(['你好。', '今天天气如何?', '走吧!'])
  })
  it('换行切分;空串/null → 兜底', () => {
    expect(splitSentences('第一句\n第二句')).toEqual(['第一句', '第二句'])
    expect(splitSentences('')).toEqual(['(无转写)'])
    expect(splitSentences(undefined)).toEqual(['(无转写)'])
  })
})

describe('evenAlign(56-02 等时加权)', () => {
  it('三段互不重叠、首 0 末 duration、按字符数加权', () => {
    const a = evenAlign(['a。', 'bbbb。', 'cc。'], 9)
    expect(a[0]!.start).toBe(0)
    expect(a[2]!.end).toBeCloseTo(9, 6)
    for (let i = 1; i < a.length; i++) expect(a[i]!.start).toBeCloseTo(a[i - 1]!.end, 6)
    // bb 段(a[1])时长应大于 a 段(a[0])——按字符数加权
    const dLong = a[1]!.end - a[1]!.start
    const dShort = a[0]!.end - a[0]!.start
    expect(dLong).toBeGreaterThan(dShort)
  })
  it('单句全时长;duration<=0 → 全段 [0,0] 无 NaN', () => {
    expect(evenAlign(['x'], 4.5)).toEqual([{ start: 0, end: 4.5, text: 'x' }])
    const zero = evenAlign(['a', 'b'], 0)
    expect(zero.every((s) => s.start === 0 && s.end === 0)).toBe(true)
  })
})

describe('sentenceAt(56-02 定位)', () => {
  const align = evenAlign(['a。', 'b。', 'c。'], 9)
  it('命中正确段;越界钳制首末', () => {
    expect(sentenceAt(align, 0)).toBe(0)
    expect(sentenceAt(align, 3.5)).toBe(1)
    expect(sentenceAt(align, 8.9)).toBe(2)
    expect(sentenceAt(align, 100)).toBe(2)
    expect(sentenceAt(align, -1)).toBe(0)
    expect(sentenceAt([], 1)).toBe(-1)
  })
})
