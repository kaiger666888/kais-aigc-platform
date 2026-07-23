/**
 * src/components/canvas/NodeBadgesDefault.tsx — 默认四角角标（设计宪法 §4.4 四角产权制）。
 *
 * B 默认实现（AssetCardNode 顶层 registerNodeBadgesRenderer 注册一次；C 可经
 * registerNodeBadgesRenderer 覆盖为完整四角系统）。绝对定位贴卡片四角（offset -6）：
 *  - 左上：无（C 层占位：溯源/所有权角标）。
 *  - 右上：AI Score 圆角标（有 aiScore 时，色相走 score 阈值）。
 *  - 左下：stale 三角角标（stale != null 时，§4.5 三重冗余之一）。
 *  - 右下：审核状态点（pending=琥珀 / approved=绿 / rejected=红）。
 *  - lod===0：返回 null（全景色块自带模态色，角标无信息量）。
 */
import type { NodeBadgesProps } from './slots'
import { V3_NODE_SIZES } from '../../constants'
import { v3theme, getScoreColor } from '../../theme/catppuccin'

export default function NodeBadgesDefault({ asset, lod }: NodeBadgesProps): React.ReactElement | null {
  if (lod === 0) return null

  const { badge } = V3_NODE_SIZES
  const aiOverall = asset.aiScore?.overall
  const stale = asset.stale != null
  const review = asset.reviewStatus

  const reviewColor =
    review === 'approved'
      ? v3theme.signal.approved
      : review === 'rejected'
        ? v3theme.signal.rejected
        : review === 'pending'
          ? v3theme.signal.running // 琥珀（待审）
          : null

  const corners: React.ReactNode[] = []

  // 右上：AI Score 圆角标
  if (typeof aiOverall === 'number') {
    const col = getScoreColor(aiOverall)
    corners.push(
      <div
        key="score"
        style={{
          position: 'absolute',
          top: badge.offset,
          right: badge.offset,
          minWidth: badge.size,
          height: badge.size,
          padding: '0 4px',
          borderRadius: badge.size / 2,
          background: 'var(--cv-bg-overlay, #313244)',
          border: `1px solid ${col}`,
          color: col,
          fontSize: 9,
          lineHeight: `${badge.size}px`,
          fontFamily: 'var(--cv-font-mono, monospace)',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center',
        }}
      >
        {Math.round(aiOverall * 100)}
      </div>,
    )
  }

  // 左下：stale 三角角标
  if (stale) {
    corners.push(
      <svg
        key="stale"
        width={badge.tri}
        height={badge.tri}
        viewBox="0 0 14 14"
        aria-hidden="true"
        style={{ position: 'absolute', left: badge.offset, bottom: badge.offset, display: 'block' }}
      >
        <polygon points="0,14 14,14 0,0" fill={v3theme.signal.stale} />
      </svg>,
    )
  }

  // 右下：审核状态点
  if (reviewColor) {
    corners.push(
      <div
        key="review"
        style={{
          position: 'absolute',
          right: badge.offset,
          bottom: badge.offset,
          width: badge.dot,
          height: badge.dot,
          borderRadius: '50%',
          background: reviewColor,
          border: '1px solid var(--cv-bg-card, rgba(30,30,46,0.92))',
        }}
      />,
    )
  }

  if (corners.length === 0) return null
  return <>{corners}</>
}
