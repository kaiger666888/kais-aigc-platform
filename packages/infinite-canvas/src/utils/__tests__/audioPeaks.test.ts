/**
 * audioPeaks 单测(56-02)——真峰/双声道/伪波形确定性/resolve 三态/缓存/边界。
 * 全部注入式(node 环境零 AudioContext)。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computePeaksFromSamples, pseudoPeaks, resolvePeaks, clearPeaksCacheForTest } from '../audioPeaks'

describe('computePeaksFromSamples(56-02 真峰)', () => {
  it('正弦采样 → 长度 buckets、值域 0-1、峰值桶≈1(容差 0.05)', () => {
    const samples = new Float32Array(2400)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((i / samples.length) * Math.PI * 8)
    const peaks = computePeaksFromSamples([samples], 24)
    expect(peaks).toHaveLength(24)
    for (const p of peaks) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(1)
    expect(Math.max(...peaks)).toBeGreaterThan(0.95)
  })

  it('双声道合并取两声道 max', () => {
    const L = new Float32Array([0.1, 0.1, 0.1, 0.1])
    const R = new Float32Array([0.5, 0.5, 0.5, 0.5])
    const peaks = computePeaksFromSamples([L, R], 2)
    expect(peaks).toEqual([1, 1]) // R 主导,归一后 1
  })

  it('全零采样 → 全 0(不除零);buckets<=0 → []', () => {
    expect(computePeaksFromSamples([new Float32Array(100)], 8)).toEqual(new Array(8).fill(0))
    expect(computePeaksFromSamples([new Float32Array(10)], 0)).toEqual([])
  })

  it('短音频(samples < buckets)不抛异常,桶有值', () => {
    const peaks = computePeaksFromSamples([new Float32Array([0.3, -0.7])], 8)
    expect(peaks).toHaveLength(8)
  })
})

describe('pseudoPeaks(56-02 伪波形)', () => {
  it('同 seed 确定性;值域 [0.15,1.0]', () => {
    const a = pseudoPeaks('seed-x', 24)
    const b = pseudoPeaks('seed-x', 24)
    expect(a).toEqual(b)
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0.15)
      expect(v).toBeLessThanOrEqual(1.0)
    }
  })
})

describe('resolvePeaks(56-02 三态 + 缓存)', () => {
  beforeEach(() => clearPeaksCacheForTest())

  const fakeBuffer = (chans: number, len: number): { numberOfChannels: number; length: number; getChannelData: (c: number) => Float32Array } => ({
    numberOfChannels: chans,
    length: len,
    getChannelData: (c: number) => new Float32Array(len).fill(c === 0 ? 0.4 : 0.8),
  })

  it('fetch+decode 成功 → kind real', async () => {
    const r = await resolvePeaks('http://x/a.wav', {
      fetchImpl: (async () => new Response(new ArrayBuffer(8))) as unknown as typeof fetch,
      decode: async () => fakeBuffer(1, 100),
    })
    expect(r.kind).toBe('real')
    expect(r.peaks.length).toBe(96)
  })

  it('fetch reject → pseudo;decode throw → pseudo(never-throws)', async () => {
    const r1 = await resolvePeaks('http://x/bad.wav', {
      fetchImpl: (async () => { throw new Error('net') }) as unknown as typeof fetch,
      decode: async () => fakeBuffer(1, 10),
    })
    expect(r1.kind).toBe('pseudo')
    expect(r1.peaks).toEqual(pseudoPeaks('http://x/bad.wav', 96))
    const r2 = await resolvePeaks('http://x/bad2.wav', {
      fetchImpl: (async () => new Response(new ArrayBuffer(8))) as unknown as typeof fetch,
      decode: async () => { throw new Error('decode') },
    })
    expect(r2.kind).toBe('pseudo')
  })

  it('缓存:同 url 第二次不再 fetch(计数不增)', async () => {
    let fetchCount = 0
    const fetchImpl = (async () => { fetchCount++; return new Response(new ArrayBuffer(8)) }) as unknown as typeof fetch
    await resolvePeaks('http://x/c.wav', { fetchImpl, decode: async () => fakeBuffer(1, 10) })
    await resolvePeaks('http://x/c.wav', { fetchImpl, decode: async () => fakeBuffer(1, 10) })
    expect(fetchCount).toBe(1)
  })
})
