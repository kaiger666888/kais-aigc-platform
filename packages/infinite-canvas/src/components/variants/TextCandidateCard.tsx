/**
 * TextCandidateCard.tsx — 文字类候选字段级行对齐双栏卡(盲选批 M2,spec §4)。
 *
 * 移植 forge「左旧右新」HTML 规范:table 左右 td 同字段并排 + 差异段
 * `<mark>` 高亮 + 页顶 KPI delta 徽章。数据来源 = 信封 extras.field_rows
 * (candidateEnvelope §2.2:`{field, a, b, delta?}[]`),本组件只做纯展示——
 * 不拉数、不猜字段、不造分(delta 缺省不渲染徽章)。
 *
 * 安全纪律(candidateEnvelope 头注):extras 只渲染字符串——React 文本节点
 * 天然转义,本文件零 innerHTML/dangerouslySetInnerHTML,含 `<script>` 的
 * 字段值按字面文本渲染。
 *
 * 差异算法:字符级 LCS(中文无分词,词级 diff 不适用);>400 字符长字段
 * 退化为公共前后缀截断(中段整体 mark),避免 O(n·m) DP 打爆 UI 线程。
 */
import { theme } from '@/theme/catppuccin'

// ─── Props ────────────────────────────────────────────────────────────────

export interface FieldRow {
  field: string
  a: string
  b: string
  delta?: string
}

export interface TextCandidateCardProps {
  fieldRows: FieldRow[]
}

// ─── 字符级 diff(纯函数,导出供测试)───────────────────────────────────────

export interface DiffSeg {
  text: string
  /** same = 两侧共有;a = 仅左;b = 仅右。 */
  kind: 'same' | 'a' | 'b'
}

/** LCS DP 尺寸护栏:超过此长度的字段走前后缀粗 diff(视觉等价,代价 O(n))。 */
const FINE_DIFF_MAX_CHARS = 400

function appendSeg(segs: DiffSeg[], text: string, kind: DiffSeg['kind']): void {
  const last = segs[segs.length - 1]
  if (last != null && last.kind === kind) last.text += text
  else segs.push({ text, kind })
}

/** 字符级 LCS diff:返回左右两列各自的分段(相邻同 kind 自动合并)。 */
export function diffSegments(a: string, b: string): { left: DiffSeg[]; right: DiffSeg[] } {
  if (a === b) {
    const left: DiffSeg[] = []
    if (a.length > 0) left.push({ text: a, kind: 'same' })
    return { left, right: left.map((s) => ({ ...s })) }
  }
  if (Math.max(a.length, b.length) > FINE_DIFF_MAX_CHARS) {
    // 粗 diff:剥公共前后缀,中段整体各归各侧
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (
      s < a.length - p && s < b.length - p &&
      a[a.length - 1 - s] === b[b.length - 1 - s]
    ) s++
    const left: DiffSeg[] = []
    const right: DiffSeg[] = []
    if (p > 0) { left.push({ text: a.slice(0, p), kind: 'same' }); right.push({ text: b.slice(0, p), kind: 'same' }) }
    if (a.length - p - s > 0) left.push({ text: a.slice(p, a.length - s), kind: 'a' })
    if (b.length - p - s > 0) right.push({ text: b.slice(p, b.length - s), kind: 'b' })
    if (s > 0) { left.push({ text: a.slice(a.length - s), kind: 'same' }); right.push({ text: b.slice(b.length - s), kind: 'same' }) }
    return { left, right }
  }
  // 精细 diff:后向前 DP,前向后回溯
  const n = a.length
  const m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!
    const next = dp[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!)
    }
  }
  const left: DiffSeg[] = []
  const right: DiffSeg[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      appendSeg(left, a[i]!, 'same')
      appendSeg(right, b[j]!, 'same')
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      appendSeg(left, a[i]!, 'a')
      i++
    } else {
      appendSeg(right, b[j]!, 'b')
      j++
    }
  }
  while (i < n) appendSeg(left, a[i++]!, 'a')
  while (j < m) appendSeg(right, b[j++]!, 'b')
  return { left, right }
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

/** mark 高亮底色 = v3theme.signal.running(#E0B665) 低透明度(暗色主题可读)。 */
const MARK_BG = 'rgba(224, 182, 101, 0.28)'
const MONO = 'var(--cv-font-mono, monospace)'

function Segmented({ segs, side }: { segs: DiffSeg[]; side: 'a' | 'b' }): React.ReactElement {
  return (
    <>
      {segs.map((s, idx) =>
        s.kind === 'same' ? (
          <span key={idx}>{s.text}</span>
        ) : (
          <mark
            key={idx}
            data-diff-side={side}
            style={{ background: MARK_BG, color: theme.text.primary, borderRadius: 2, padding: 0 }}
          >
            {s.text}
          </mark>
        ),
      )}
    </>
  )
}

export default function TextCandidateCard({ fieldRows }: TextCandidateCardProps): React.ReactElement | null {
  if (fieldRows.length === 0) return null
  const deltas = fieldRows.filter((r) => r.delta != null && r.delta.length > 0)
  return (
    <div
      data-testid="text-candidate-card"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
        background: theme.bg.card, border: `1px solid ${theme.border.default}`,
        borderRadius: 8, padding: 10,
      }}
    >
      {/* 页顶 KPI delta 徽章排(有 delta 才渲染——没分不造假) */}
      {deltas.length > 0 && (
        <div data-testid="text-candidate-deltas" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {deltas.map((r) => (
            <span
              key={r.field}
              data-testid="text-candidate-delta"
              style={{
                fontSize: 10, padding: '1px 7px', borderRadius: 4,
                background: theme.bg.surface, color: theme.text.primary,
                fontFamily: MONO, border: `1px solid ${theme.border.dim}`,
              }}
            >
              {r.field} {r.delta}
            </span>
          ))}
        </div>
      )}
      {/* 左旧右新双栏:左右 td 同字段并排(行级 table 对齐,forge 规范) */}
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {['字段', '左', '右'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left', fontSize: 10, color: theme.text.secondary,
                  fontWeight: 600, padding: '2px 6px', borderBottom: `1px solid ${theme.border.default}`,
                  ...(h === '字段' ? { width: 72 } : {}),
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fieldRows.map((r) => {
            const { left, right } = diffSegments(r.a, r.b)
            return (
              <tr key={r.field} data-testid="text-candidate-row" data-field={r.field}>
                <td
                  style={{
                    fontSize: 10, color: theme.text.secondary, padding: '4px 6px',
                    verticalAlign: 'top', fontFamily: MONO, wordBreak: 'break-all',
                    borderBottom: `1px solid ${theme.border.dim}`,
                  }}
                >
                  {r.field}
                </td>
                <td
                  style={{
                    fontSize: 11, color: theme.text.primary, padding: '4px 6px',
                    verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    borderBottom: `1px solid ${theme.border.dim}`,
                  }}
                >
                  <Segmented segs={left} side="a" />
                </td>
                <td
                  style={{
                    fontSize: 11, color: theme.text.primary, padding: '4px 6px',
                    verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    borderBottom: `1px solid ${theme.border.dim}`,
                  }}
                >
                  <Segmented segs={right} side="b" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
