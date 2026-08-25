/**
 * src/components/badges/NodeBadges.tsx — C 层完整四角角标系统（设计 §4.4 四角产权制 / 宪法 P12-P13）。
 *
 * 经 registerNodeBadgesRenderer 覆盖 B 的 NodeBadgesDefault（registerCInteractions 顶层注册一次）。
 * 四角各就各位、无状态不渲染（lod===0 全景不渲染角标）：
 *  - 左上 策展（curation）：selected ✓ / locked 🔒 / deprecated ×（candidate 不渲染）。
 *  - 右上 执行（state）：running 旋转 / failed ! / pending ○；success（静默）时让位给 AI Score 胶囊。
 *  - 左下 stale：琥珀三角（§4.5 三重冗余之一）；级联脉动时 cv-stale-pulse 亮一圈。
 *  - 右下 审核（review）：pending 琥珀 / approved 绿 / rejected 红 点。
 */
import type { NodeBadgesProps } from '../canvas/slots'
import { V3_NODE_SIZES } from '../../constants'
import { v3theme, getScoreColor } from '../../theme/catppuccin'
import { useStalePulse } from '../../hooks/useStale'
import { useStaleRerun } from '../../hooks/useStaleRerun'
import { EyeIcon, EarIcon } from '../canvas/icons'
import { verdictLabel } from '../../utils/scoreVocabulary'

export default function NodeBadges({ nodeId, asset, lod, verdicts }: NodeBadgesProps): React.ReactElement | null {
  // 脉动订阅必须在顶层（Rules of Hooks）；lod===0 早返前先取值。
  const pulsing = useStalePulse((s) => s.pulseIds.includes(nodeId))
  // REGEN-03(52-05):stale 三角点击出口——同样必须在早返前订阅(Rules of Hooks)。
  const { rerunStaleChain } = useStaleRerun()
  if (lod === 0) return null

  const { badge } = V3_NODE_SIZES
  const off = badge.offset

  // ── 左上：策展 curation ──
  let curationBadge: React.ReactNode = null
  if (asset.curation === 'selected') {
    curationBadge = (
      <span key="cur" title="策展选定" style={dotStyle(off, badge.dot, 'tl', v3theme.signal.select, '#0A0B0E')}>✓</span>
    )
  } else if (asset.curation === 'locked') {
    curationBadge = (
      <span key="cur" title="锁定参考（不可改选）" style={{ ...dotStyle(off, badge.dot, 'tl', 'var(--cv-bg-overlay, #1E2128)', v3theme.signal.locked), border: `1px solid ${v3theme.signal.locked}`, fontSize: 8 }}>🔒</span>
    )
  } else if (asset.curation === 'deprecated') {
    curationBadge = (
      <span key="cur" title="落选变体" style={{ ...dotStyle(off, badge.dot, 'tl', 'var(--cv-bg-overlay, #1E2128)', v3theme.edge.inactive), border: `1px solid ${v3theme.edge.inactive}` }}>×</span>
    )
  }

  // ── 右上：执行 state（活跃态优先），静默时让位 AI Score ──
  let execBadge: React.ReactNode = null
  const aiOverall = asset.aiScore?.overall
  if (asset.state === 'running') {
    execBadge = (
      <span key="exec" title="执行中" style={{
        position: 'absolute', top: off, right: off, width: badge.dot, height: badge.dot,
        borderRadius: '50%', border: `1.5px solid ${v3theme.signal.running}`, borderTopColor: 'transparent',
        animation: 'spin 0.8s linear infinite',
      }} />
    )
  } else if (asset.state === 'failed') {
    execBadge = <span key="exec" title="执行失败" style={dotStyle(off, badge.dot, 'tr', v3theme.signal.rejected, '#0A0B0E')}>!</span>
  } else if (asset.state === 'pending') {
    execBadge = (
      <span key="exec" title="待执行" style={{
        position: 'absolute', top: off, right: off, width: badge.dot, height: badge.dot,
        borderRadius: '50%', background: 'transparent', border: `1.5px solid ${v3theme.signal.pending}`, opacity: 0.7,
      }} />
    )
  } else if (typeof aiOverall === 'number') {
    const col = getScoreColor(aiOverall)
    execBadge = (
      <div key="score" title={`AI Score ${Math.round(aiOverall * 100)}`} style={{
        position: 'absolute', top: off, right: off, minWidth: badge.size, height: badge.size, padding: '0 4px',
        borderRadius: badge.size / 2, background: 'var(--cv-bg-overlay, #1E2128)', border: `1px solid ${col}`, color: col,
        fontSize: 9, lineHeight: `${badge.size}px`, fontFamily: 'var(--cv-font-mono, monospace)', fontVariantNumeric: 'tabular-nums', textAlign: 'center',
      }}>{Math.round(aiOverall * 100)}</div>
    )
  }

  // ── 左下：stale 三角 + 级联脉动 ──
  // REGEN-03(52-05):stale 三角可点击 = 重跑下游出口之一(与 StaleSection 按钮共用
  // 顶部订阅的 useStaleRerun)。stopPropagation 必须(地雷 #8):否则冒泡到 RF
  // onNodeClick,REGEN-04 落地后(面板开着单击跟随)会连带切详情面板。
  let staleBadge: React.ReactNode = null
  if (asset.stale != null) {
    staleBadge = (
      <svg key="stale" width={badge.tri} height={badge.tri} viewBox="0 0 14 14" aria-label="stale"
        onClick={(e) => { e.stopPropagation(); void rerunStaleChain(nodeId) }}
        style={{ position: 'absolute', left: off, bottom: off, display: 'block', cursor: 'pointer', animation: pulsing ? 'cv-stale-pulse 600ms ease-out 1' : undefined }}>
        <title>重跑下游</title>
        <polygon points="0,14 14,14 0,0" fill={v3theme.signal.stale} />
      </svg>
    )
  }

  // ── 左下 verdict 带(56-03 / VIZ-01):stale 三角贴角不动,verdict 环排其右
  // (off + tri + 2,planner 终裁消除微重叠;无 stale 时同位稳定不跳)。
  // 眼在前耳在后;三态形色双编码(D-02),judge 身份不走颜色。
  let verdictBand: React.ReactNode = null
  if (verdicts != null && verdicts.length > 0) {
    const ordered = [...verdicts].sort((a, b) => (a.judge === b.judge ? 0 : a.judge === 'eye' ? -1 : 1))
    verdictBand = (
      <span
        key="verdicts"
        style={{ position: 'absolute', bottom: off, left: off + badge.tri + 2, display: 'flex', gap: 4 }}
      >
        {ordered.map((v, i) => {
          // 72-05 F32 五值形色双编码:pass 绿实线 / warn 黄虚线 / fail 红实线+
          // 光环 / must_fix 红实线+光环(必修语义同 fail) / error 紫虚线(审计
          // 异常≠内容不过) / skipped 灰虚线(未评)。judge 身份仍不走颜色。
          const ring =
            v.verdict === 'pass' ? v3theme.signal.approved
              : v.verdict === 'fail' || v.verdict === 'must_fix' ? v3theme.signal.rejected
                : v.verdict === 'error' ? v3theme.signal.locked
                  : v.verdict === 'warn' ? v3theme.signal.running
                    : v3theme.signal.pending
          const label = `${v.judge === 'eye' ? '眼审' : '耳审'} ${verdictLabel(v.verdict)}`
          return (
            <span key={`${v.judge}-${i}`} title={label} style={{ position: 'relative', width: badge.dot, height: badge.dot, display: 'inline-block' }}>
              <svg width={badge.dot} height={badge.dot} viewBox="0 0 10 10" aria-label={label} style={{ position: 'absolute', inset: 0, display: 'block' }}>
                <circle cx="5" cy="5" r="4.6" fill="var(--cv-bg-overlay, #1E2128)" />
                {(v.verdict === 'fail' || v.verdict === 'must_fix') && (
                  <circle cx="5" cy="5" r="5.4" fill="none" stroke={ring} strokeOpacity={0.4} strokeWidth={1} />
                )}
                <circle
                  cx="5" cy="5" r="4" fill="none" stroke={ring} strokeWidth={1.5}
                  strokeDasharray={v.verdict === 'warn' || v.verdict === 'error' || v.verdict === 'skipped' ? '2 1.5' : undefined}
                />
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cv-text-primary, #EDEEF1)' }}>
                {v.judge === 'eye' ? <EyeIcon size={8} /> : <EarIcon size={8} />}
              </span>
            </span>
          )
        })}
      </span>
    )
  }

  // ── 右下：审核 review ──
  let reviewBadge: React.ReactNode = null
  const reviewColor =
    asset.reviewStatus === 'approved' ? v3theme.signal.approved
      : asset.reviewStatus === 'rejected' ? v3theme.signal.rejected
        : asset.reviewStatus === 'pending' ? v3theme.signal.running
          : null
  if (reviewColor) {
    reviewBadge = (
      <div key="review" title={`审核：${asset.reviewStatus}`} style={{
        position: 'absolute', right: off, bottom: off, width: badge.dot, height: badge.dot, borderRadius: '50%',
        background: reviewColor, border: '1px solid var(--cv-bg-card, #16181D)',
      }} />
    )
  }

  if (!curationBadge && !execBadge && !staleBadge && !reviewBadge && !(verdicts != null && verdicts.length > 0)) return null
  return (
    <>
      {curationBadge}
      {execBadge}
      {staleBadge}
      {verdictBand}
      {reviewBadge}
    </>
  )
}

/** 圆点角标基础样式（corner: tl/tr/bl/br 控制四角；fg 为文字色）。 */
function dotStyle(off: number, dot: number, corner: 'tl' | 'tr' | 'bl' | 'br', bg: string, fg: string): React.CSSProperties {
  const pos: React.CSSProperties = corner === 'tl'
    ? { top: off, left: off }
    : corner === 'tr'
      ? { top: off, right: off }
      : corner === 'bl'
        ? { bottom: off, left: off }
        : { bottom: off, right: off }
  return {
    position: 'absolute', width: dot, height: dot, borderRadius: '50%',
    background: bg, color: fg, fontSize: 9, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, ...pos,
  }
}
