/**
 * GoldPanel.tsx — 金标轨打分面板(迭代平台 M3 / B 轨,prompt GOLD-4)。
 *
 * 参考 G15TriagePanel 面板壳(开关由调用方条件渲染/Esc 收起/同主题),
 * 内部工具面板:能用 > 好看,muted 配色零动效。三区:
 *   ① 标准集选择(M3 仅展示服务端解析的当前默认,下拉占位 M4 多集);
 *   ② 候选 shot-list 打分(手动贴路径,一行一条「标签|路径」或裸路径;
 *      表格 overall 升序,winner 🥇 高亮,数字 3 位);
 *   ③ gold_auto APPLY 门(填 groupId/winnerNodeId 后对当前 winner 落地;
 *      applied / deferred_to_client / rejected 三态如实展示)。
 *
 * 打分确定性来源:后端 KMC lab metrics.py(goldGap per_metric 逐项
 * producer:"kmc-lab-metrics")——本面板不做任何本地打分。
 */
import { useEffect, useMemo, useState } from 'react'
import { theme, v3theme } from '../../theme/catppuccin'
import { useCanvasStore } from '../../store/canvasStore'
import {
  scoreP09GoldGap,
  fetchDefaultGoldStandard,
  type GoldCandidateResult,
  type GoldGapScoreResult,
  type GoldApplyState,
} from '../../services/canvasApi'

/** per_metric 已知五键的表格列序(缺项显示 —)。 */
const METRIC_COLS: Array<{ key: string; head: string }> = [
  { key: 'duration_median', head: '时长中位' },
  { key: 'short_punches_total', head: '短切/n' },
  { key: 'scene_punch_coverage', head: 'punch覆盖' },
  { key: 'max_near_equal_run', head: '等长run/n' },
  { key: 'flat_trio_pct', head: '平三件' },
]

/** 解析 textarea:一行一候选,「标签|路径」或裸路径(label=文件名)。 */
export function parseCandidateLines(text: string): Array<{ label: string; filePath: string }> {
  const out: Array<{ label: string; filePath: string }> = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const sep = line.indexOf('|')
    if (sep > 0) {
      const label = line.slice(0, sep).trim()
      const filePath = line.slice(sep + 1).trim()
      if (label !== '' && filePath !== '') out.push({ label, filePath })
      continue
    }
    const base = line.split('/').pop() || line
    out.push({ label: base.replace(/\.json$/i, ''), filePath: line })
  }
  return out
}

export default function GoldPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  // 画布 scope(G15TriagePanel 同款);未加载时 0——打分本身不依赖 scope,
  // apply 落地端点会按 0 找不到组而拒绝,面板如实回显 rejected。
  const projectId = useCanvasStore((s) => s.projectId) ?? 0
  const episodesId = useCanvasStore((s) => s.episodesId) ?? 0
  const [standardRef, setStandardRef] = useState<string>('加载中…')
  const [candidatesText, setCandidatesText] = useState('')
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GoldGapScoreResult | null>(null)

  // gold_auto APPLY 门
  const [groupId, setGroupId] = useState('')
  const [winnerNodeId, setWinnerNodeId] = useState('')
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchDefaultGoldStandard().then((d) => {
      if (!cancelled && d != null) setStandardRef(d.standardRef)
      else if (!cancelled) setStandardRef('未解析到金标集')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const candidates = useMemo(() => parseCandidateLines(candidatesText), [candidatesText])

  const run = async (apply?: { groupId: string; winnerNodeId: string }): Promise<void> => {
    if (candidates.length === 0) {
      setError('请先贴至少一行候选 shot-list 路径')
      return
    }
    setScoring(true)
    setApplying(apply != null)
    setError(null)
    try {
      const r = await scoreP09GoldGap(projectId, episodesId, candidates, apply != null ? { apply } : {})
      setResult(r)
      setStandardRef(r.standardRef)
    } catch (err) {
      setError((err as Error).message || '打分失败')
    } finally {
      setScoring(false)
      setApplying(false)
    }
  }

  const sorted: GoldCandidateResult[] = result != null
    ? [...result.results].sort((a, b) => a.gap.overall_gap01 - b.gap.overall_gap01)
    : []

  return (
    <div
      data-testid="gold-panel"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '94vw',
        background: theme.bg.panel, borderLeft: `1px solid ${theme.border.default}`,
        display: 'flex', flexDirection: 'column', zIndex: 35,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🥇</span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13 }}>金标轨打分</span>
          <span style={{ color: theme.text.secondary, fontSize: 11 }}>迭代平台 B 轨 · P09</span>
        </div>
        <button onClick={onClose} style={closeBtnStyle} aria-label="关闭">✕</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* ① 标准集 */}
        <Section title="① 标准集(learning_sets)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={standardRef}
              onChange={(e) => setStandardRef(e.target.value)}
              style={{ ...inputStyle, flex: 1, minHeight: 40 }}
              data-testid="gold-standard-select"
            >
              <option value={standardRef}>{standardRef}</option>
            </select>
          </div>
          <div style={{ ...hintStyle, marginTop: 4 }}>
            M3 仅支持 P09 维度;M4 多集入库后此处展开全集列表。
          </div>
        </Section>

        {/* ② 候选打分 */}
        <Section title="② 候选 shot-list(一行一条:标签|路径,或裸路径)">
          <textarea
            value={candidatesText}
            onChange={(e) => setCandidatesText(e.target.value)}
            placeholder={'baseline|/data/.../episodes/ep-x/run1/.pipeline-assets/shot-list.json\n/runs/.../shot-list.json'}
            spellCheck={false}
            style={{ ...inputStyle, minHeight: 84, fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, lineHeight: 1.6, resize: 'vertical' }}
            data-testid="gold-candidates-input"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => void run()}
              disabled={scoring || candidates.length === 0}
              style={{ ...primaryBtnStyle, minHeight: 40, opacity: scoring || candidates.length === 0 ? 0.45 : 1 }}
              data-testid="gold-score-btn"
            >
              {scoring ? '打分中…(python 桥)' : `打分(${candidates.length})`}
            </button>
            <span style={hintStyle}>相对路径按 episodes 根白名单解析</span>
          </div>
          {error != null && (
            <div style={{ marginTop: 8, fontSize: 12, color: v3theme.signal.rejected }} data-testid="gold-error">
              {error}
            </div>
          )}
          {sorted.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 11 }}>
              <thead>
                <tr>
                  <Th>候选</Th>
                  <Th>overall↓</Th>
                  {METRIC_COLS.map((c) => <Th key={c.key}>{c.head}</Th>)}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const winner = r.label === result?.winnerLabel
                  return (
                    <tr
                      key={r.label}
                      data-testid={`gold-row-${r.label}`}
                      style={{
                        background: winner ? 'rgba(240,165,46,0.10)' : 'transparent',
                        outline: winner ? `1px solid ${v3theme.signal.stale}` : 'none',
                      }}
                    >
                      <Td>
                        <span style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}>
                          {winner ? '🥇 ' : ''}{r.label}
                        </span>
                      </Td>
                      <Td strong>{r.gap.overall_gap01.toFixed(3)}</Td>
                      {METRIC_COLS.map((c) => {
                        const m = r.gap.per_metric.find((x) => x.key === c.key)
                        return <Td key={c.key}>{m != null ? m.gap01.toFixed(3) : '—'}</Td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Section>

        {/* ③ gold_auto APPLY 门 */}
        <Section title="③ gold_auto 落地(对当前 winner)">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="groupId(cand:shot:S01:first)"
              spellCheck={false}
              style={{ ...inputStyle, flex: 1, minWidth: 180, fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, minHeight: 40 }}
            />
            <input
              value={winnerNodeId}
              onChange={(e) => setWinnerNodeId(e.target.value)}
              placeholder="winnerNodeId(画布节点 id)"
              spellCheck={false}
              style={{ ...inputStyle, flex: 1, minWidth: 160, fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, minHeight: 40 }}
            />
          </div>
          <button
            onClick={() => void run({ groupId: groupId.trim(), winnerNodeId: winnerNodeId.trim() })}
            disabled={applying || scoring || groupId.trim() === '' || winnerNodeId.trim() === '' || candidates.length === 0}
            style={{ ...primaryBtnStyle, marginTop: 8, minHeight: 40, opacity: applying || scoring || groupId.trim() === '' || winnerNodeId.trim() === '' || candidates.length === 0 ? 0.45 : 1 }}
            data-testid="gold-apply-btn"
          >
            {applying ? '落地中…' : '打分并自动落地(gold_auto)'}
          </button>
          {result != null && <ApplyBanner state={result.applied} reason={result.reason} />}
          <div style={{ ...hintStyle, marginTop: 6 }}>
            落地走 select-winner 同一收口(含 locked 保护,账本 track=gold_auto);
            通道未开通时提示走正常选卡通道补落。
          </div>
        </Section>
      </div>
    </div>
  )
}

/** applied 三态横幅(如实:金=补落,玫=拒绝原因,绿=已落地)。 */
function ApplyBanner({ state, reason }: { state: GoldApplyState; reason?: string }): React.ReactElement | null {
  if (state === 'not_requested') return null
  const map: Record<string, { color: string; text: string }> = {
    applied: { color: v3theme.signal.approved, text: '✅ 已落地:canvas winner + manifest 回写 + 账本(gold_auto)' },
    deferred_to_client: { color: v3theme.signal.stale, text: '⏸ 通道未开通:canvas 已选定,请走正常选卡通道补落地(deferred_to_client)' },
    rejected: { color: v3theme.signal.rejected, text: `⛔ 落地被拒:${reason ?? '未知原因'}` },
  }
  const s = map[state]
  if (s == null) return null
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: s.color }} data-testid={`gold-apply-${state}`}>
      {s.text}
    </div>
  )
}

// ─── 壳件样式(G15TriagePanel 同源 muted)────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{
      border: `1px solid ${theme.border.default}`, borderRadius: 8,
      background: theme.bg.card, padding: '10px 12px',
    }}>
      <div style={{ color: theme.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

const Th = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <th style={{ textAlign: 'left', padding: '4px 6px', color: theme.text.secondary, fontWeight: 500, borderBottom: `1px solid ${theme.border.default}` }}>
    {children}
  </th>
)

const Td = ({ children, strong }: { children: React.ReactNode; strong?: boolean }): React.ReactElement => (
  <td style={{ padding: '4px 6px', borderBottom: `1px solid ${theme.border.default}`, color: strong ? theme.text.primary : theme.text.secondary, fontWeight: strong ? 600 : 400 }}>
    {children}
  </td>
)

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 6,
  color: theme.text.primary, fontSize: 12, padding: '7px 9px', outline: 'none',
}

const primaryBtnStyle: React.CSSProperties = {
  background: theme.bg.card, color: theme.text.primary,
  border: `1px solid ${theme.border.strong}`, borderRadius: 6,
  fontSize: 12, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
}

const hintStyle: React.CSSProperties = {
  fontSize: 11, color: theme.text.tertiary, lineHeight: 1.5,
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16,
  cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}
