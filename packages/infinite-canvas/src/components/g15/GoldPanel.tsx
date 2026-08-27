/**
 * GoldPanel.tsx — 金标轨打分面板(迭代平台 M3 / B 轨,prompt GOLD-4;M4 扩展)。
 *
 * 参考 G15TriagePanel 面板壳(开关由调用方条件渲染/Esc 收起/同主题),
 * 内部工具面板:能用 > 好看,muted 配色零动效。四区:
 *   ① 标准集选择(M4 起接 GET /standards 全集列表,缺 p09 的集如实标注;
 *      /standards 失败退回 M3 单默认解析);
 *   ② 候选 shot-list 打分(手动贴路径,一行一条「标签|路径」或裸路径;
 *      表格 overall 升序,winner 🥇 高亮,数字 3 位);
 *   ③ gold_auto APPLY 门(填 groupId/winnerNodeId 后对当前 winner 落地;
 *      applied / deferred_to_client / rejected 三态如实展示);
 *   ④ 成片保真度复测(M4 / kst 外环:master-timeline 或 kst 成片镜头表
 *      对金标 p09 量节奏漂移;纯测量,无账本写入)。
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
  listStandards,
  scoreKst,
  type GoldCandidateResult,
  type GoldGapScoreResult,
  type GoldApplyState,
  type GoldStandardEntry,
  type KstScoreResult,
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
  const [standards, setStandards] = useState<GoldStandardEntry[] | null>(null)
  const [candidatesText, setCandidatesText] = useState('')
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GoldGapScoreResult | null>(null)

  // gold_auto APPLY 门
  const [groupId, setGroupId] = useState('')
  const [winnerNodeId, setWinnerNodeId] = useState('')
  const [applying, setApplying] = useState(false)

  // M4 成片保真度复测(kst 外环)
  const [kstPath, setKstPath] = useState('')
  const [kstScoring, setKstScoring] = useState(false)
  const [kstError, setKstError] = useState<string | null>(null)
  const [kstResult, setKstResult] = useState<KstScoreResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void listStandards().then((rows) => {
      if (cancelled) return
      if (rows != null && rows.length > 0) {
        setStandards(rows)
        // 服务端主序(字典序最新在前)首位 = resolveStandardRef 缺省选集;
        // 缺 p09 的集不能打分,跳到首个可打分集。
        const firstScorable = rows.find((s) => s.hasP09) ?? rows[0]!
        setStandardRef(firstScorable.name)
        return
      }
      // /standards 失败(旧后端/根不可读)→ 退回 M3 单默认解析
      void fetchDefaultGoldStandard().then((d) => {
        if (!cancelled && d != null) setStandardRef(d.standardRef)
        else if (!cancelled) setStandardRef('未解析到金标集')
      })
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

  // M4 ④:成片保真度复测(纯测量;标准集仅在真实入列时随传)
  const runKst = async (): Promise<void> => {
    const p = kstPath.trim()
    if (p === '') {
      setKstError('请先填成片时间轴路径(master-timeline.json 或 kst 成片镜头表)')
      return
    }
    setKstScoring(true)
    setKstError(null)
    try {
      const withStd = standards?.some((s) => s.name === standardRef) ? { standardRef } : {}
      setKstResult(await scoreKst(p, withStd))
    } catch (err) {
      setKstError((err as Error).message || '成片复测失败')
    } finally {
      setKstScoring(false)
    }
  }

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
              {(standards ?? [{ name: standardRef, mtime: '', hasP09: true }]).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}{s.hasP09 ? '' : '(缺 p09,不可打分)'}
                </option>
              ))}
            </select>
          </div>
          <div style={{ ...hintStyle, marginTop: 4 }}>
            M4 全集列表,首位 = 服务端缺省;打分仅支持 P09 维度(缺 p09 的集如实列出但不可打分)。
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

        {/* ④ M4 成片保真度复测(kst 外环,纯测量无账本) */}
        <Section title="④ 成片保真度复测(master-timeline / kst 成片镜头表)">
          <input
            value={kstPath}
            onChange={(e) => setKstPath(e.target.value)}
            placeholder="/data/.../episodes/ep-x/.pipeline-assets/master-timeline.json 或 kst [{id,start_sec,…}].json"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, minHeight: 40 }}
            data-testid="gold-kst-input"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => void runKst()}
              disabled={kstScoring || kstPath.trim() === ''}
              style={{ ...primaryBtnStyle, minHeight: 40, opacity: kstScoring || kstPath.trim() === '' ? 0.45 : 1 }}
              data-testid="gold-kst-btn"
            >
              {kstScoring ? '复测中…(python 桥)' : '复测成片节奏'}
            </button>
            <span style={hintStyle}>相对路径按 episodes 根白名单解析;纯测量,不写决策账本</span>
          </div>
          {kstError != null && (
            <div style={{ marginTop: 8, fontSize: 12, color: v3theme.signal.rejected }} data-testid="gold-kst-error">
              {kstError}
            </div>
          )}
          {kstResult != null && (
            <div
              data-testid="gold-kst-result"
              style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 12,
                border: `1px solid ${theme.border.default}`, background: theme.bg.input,
              }}
            >
              <span style={{ color: theme.text.primary, fontWeight: 600 }}>
                overall_gap01 = {kstResult.gap.overall_gap01.toFixed(4)}
              </span>
              <span style={{ ...hintStyle, marginLeft: 8 }}>
                {kstResult.candidate_kind} · n={kstResult.n_shots} · 金标 {kstResult.standardRef}
              </span>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', color: theme.text.secondary, fontSize: 11 }}>
                  per_metric({kstResult.gap.per_metric.length})
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4, fontSize: 11 }}>
                  <thead>
                    <tr>
                      <Th>指标</Th><Th>金标(p09)</Th><Th>成片(kst)</Th><Th>gap01</Th><Th>权重</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {kstResult.gap.per_metric.map((m) => (
                      <tr key={m.key}>
                        <Td>{METRIC_COLS.find((c) => c.key === m.key)?.head ?? m.key}</Td>
                        <Td>{m.ref}</Td>
                        <Td>{m.cand}</Td>
                        <Td strong>{m.gap01.toFixed(4)}</Td>
                        <Td>{m.weight}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}
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
