/**
 * transcriptAlign.ts — 转写分句等时对齐(Phase 56-02 / VIZ-03 G16 下轨)。
 *
 * **近似对齐契约**:p10c transcript 无时间戳(56-RESEARCH §G16),等时分布
 * (按句字符数加权)是展示近似——消费者必须展示「分句按等时近似对齐」注记;
 * 未来 khs 若透传时间戳,在本模块加 timed 分支,消费者无感。
 *
 * 纯模块零 React;三纯函数。
 */

export interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

/** 按句末标点/换行切分(标点保留句尾);空/全空白 → ['(无转写)'] 兜底。 */
export function splitSentences(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || text.trim() === '') return ['(无转写)']
  const parts = text
    .split(/(?<=[。!?!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return parts.length > 0 ? parts : ['(无转写)']
}

/** 等时加权对齐:权重 = max(1, 句字符数);duration<=0 → 全段 [0,0](无 NaN)。 */
export function evenAlign(sentences: string[], durationSec: number): SentenceSpan[] {
  const d = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const weights = sentences.map((s) => Math.max(1, [...s].length))
  const total = weights.reduce((a, b) => a + b, 0)
  let cursor = 0
  return sentences.map((text, i) => {
    if (d <= 0) return { start: 0, end: 0, text }
    const dur = (weights[i]! / total) * d
    const span = { start: cursor, end: cursor + dur, text }
    cursor += dur
    return span
  })
}

/** t 秒所在句 index(空 -1;越界钳制首末段)。 */
export function sentenceAt(align: SentenceSpan[], t: number): number {
  if (align.length === 0) return -1
  if (!(typeof t === 'number' && Number.isFinite(t))) return 0
  if (t <= 0) return 0
  for (let i = 0; i < align.length; i++) {
    if (t >= align[i]!.start && t < align[i]!.end) return i
  }
  return align.length - 1
}
