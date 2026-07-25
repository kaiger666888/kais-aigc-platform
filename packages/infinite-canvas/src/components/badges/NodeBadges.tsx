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

export default function NodeBadges({ nodeId, asset, lod }: NodeBadgesProps): React.ReactElement | null {
  // 脉动订阅必须在顶层（Rules of Hooks）；lod===0 早返前先取值。
  const pulsing = useStalePulse((s) => s.pulseIds.includes(nodeId))
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
  let staleBadge: React.ReactNode = null
  if (asset.stale != null) {
    staleBadge = (
      <svg key="stale" width={badge.tri} height={badge.tri} viewBox="0 0 14 14" aria-label="stale"
        style={{ position: 'absolute', left: off, bottom: off, display: 'block', animation: pulsing ? 'cv-stale-pulse 600ms ease-out 1' : undefined }}>
        <polygon points="0,14 14,14 0,0" fill={v3theme.signal.stale} />
      </svg>
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

  if (!curationBadge && !execBadge && !staleBadge && !reviewBadge) return null
  return (
    <>
      {curationBadge}
      {execBadge}
      {staleBadge}
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
