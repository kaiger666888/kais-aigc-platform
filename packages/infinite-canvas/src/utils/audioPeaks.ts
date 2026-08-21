/**
 * audioPeaks.ts — 波形数据引擎(Phase 56-02 / VIZ-02/03,G16 双轨与音色
 * 完整播放器同源消费)。
 *
 * 真实峰:fetch + decodeAudioData 分桶取 |sample| 峰,末尾全局归一(max=1
 * 上界契约);伪波形兜底:FNV-1a + xorshift(AssetCardNode pseudoWaveform
 * 同算法平移,seed 参数化)——任何异常(网络/解码/类型)降级 pseudo,
 * never-throws。模块级缓存 FIFO(容量 128)。
 *
 * 零 React import;依赖注入(fetchImpl/decode)可 node 环境单测
 * (wallTransport HTMLVideoElementLike 同款纪律)。否决 wavesurfer 依据
 * UI-SPEC Registry Safety(零新依赖);decodeAudioData browser 兼容注记:
 * 仅在 browser 且未注入时 lazy new AudioContext()。
 */

export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  getChannelData(ch: number): Float32Array;
}

/** 分桶取峰(|sample| max),末尾全局归一(max=1;全零→全 0 不除零)。 */
export function computePeaksFromSamples(channels: Float32Array[], buckets: number): number[] {
  if (buckets <= 0) return []
  const peaks = new Array<number>(buckets).fill(0)
  const per = channels.map((c) => c.length)
  for (const data of channels) {
    const bucketSize = Math.max(1, Math.floor(data.length / buckets))
    for (let b = 0; b < buckets; b++) {
      const start = b * bucketSize
      const end = start + bucketSize > data.length ? data.length : start + bucketSize
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i] ?? 0)
        if (v > peaks[b]!) peaks[b] = v
      }
    }
  }
  const max = Math.max(...peaks, 0)
  if (max <= 0) return peaks
  return peaks.map((p) => p / max)
}

/** 伪波形(seed 确定性;值域 [0.15, 1.0])。 */
export function pseudoPeaks(seed: string, buckets: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < buckets; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out.push(0.15 + ((h >>> 0) % 1000) / 1000 * 0.85)
  }
  return out
}

export interface PeaksResult {
  kind: 'real' | 'pseudo';
  peaks: number[];
}

const peaksCache = new Map<string, PeaksResult>()
const CACHE_MAX = 128

function cachePut(key: string, v: PeaksResult): void {
  if (peaksCache.size >= CACHE_MAX) {
    const oldest = peaksCache.keys().next().value
    if (oldest != null) peaksCache.delete(oldest)
  }
  peaksCache.set(key, v)
}

export async function resolvePeaks(
  url: string,
  opts: { buckets?: number; fetchImpl?: typeof fetch; decode?: (buf: ArrayBuffer) => Promise<AudioBufferLike> } = {},
): Promise<PeaksResult> {
  const buckets = opts.buckets ?? 96
  const cached = peaksCache.get(url)
  if (cached != null) return cached
  let result: PeaksResult
  try {
    const fetchImpl = opts.fetchImpl ?? fetch
    const decode =
      opts.decode ??
      (async (buf: ArrayBuffer): Promise<AudioBufferLike> => {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
        if (Ctor == null) throw new Error('AudioContext unavailable')
        const ctx = new Ctor()
        try {
          return await ctx.decodeAudioData(buf)
        } finally {
          void ctx.close()
        }
      })
    const resp = await fetchImpl(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = await resp.arrayBuffer()
    const audio = await decode(buf)
    const channels: Float32Array[] = []
    for (let ch = 0; ch < audio.numberOfChannels; ch++) channels.push(audio.getChannelData(ch))
    result = { kind: 'real', peaks: computePeaksFromSamples(channels, buckets) }
  } catch {
    result = { kind: 'pseudo', peaks: pseudoPeaks(url, buckets) }
  }
  cachePut(url, result)
  return result
}

/** 测试辅助:清缓存。 */
export function clearPeaksCacheForTest(): void {
  peaksCache.clear()
}
