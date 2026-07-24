/**
 * src/utils/waveform.ts — 确定性占位波形 / 能量合成（P15：管线未产真实波形时的视觉占位）。
 *
 * 规则：以 seed 字符串做 FNV-1a 哈希 → xorshift 伪随机序列，保证同一资产/镜头每次渲染
 * 柱高一致（不闪烁）。真实波形数据走 `media.waveform`（asset 三件套）——接入后替换 heights 来源，
 * 本模块仅作缺省占位（设计稿允许，接口已留）。
 *
 * AssetCardNode 的 WaveformCover 与 timeline/TimelineStructure 共用本实现。
 */

/** seed 字符串 → bars 根柱高（0.15–1.0）。 */
export function pseudoWaveform(seed: string, bars: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out.push(0.15 + (((h >>> 0) % 1000) / 1000) * 0.85)
  }
  return out
}

/** seed → 单个 [0,1] 能量值（timeline 每镜头波形行的整体响度）。 */
export function shotEnergy(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h << 13
  h ^= h >>> 17
  h ^= h << 5
  return 0.25 + (((h >>> 0) % 1000) / 1000) * 0.75
}
