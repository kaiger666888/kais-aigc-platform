import { memo, type JSX } from 'react'
import { theme } from '../theme/catppuccin'
import type { VariantMemberStatus } from '../types/canvas'

export interface VariantBadgeProps {
  /** 0-based 变体序号;为空则不渲染 */
  variantIndex?: number
  /** 当前节点是否为优胜 */
  isWinner?: boolean
  /** 是否为落选 (同组已有 winner 但本节点不是) */
  isLoser?: boolean
  /** 显式成员状态;若提供,优先于 isWinner/isLoser 推导 */
  status?: VariantMemberStatus
}

/** BEST 标签色 = text 模态金；文字 = 冷近黑 onAccent（与主题字面量解耦） */
const BEST_BADGE_COLOR = '#E0B665'
const BEST_BADGE_TEXT = '#0A0B0E'

/**
 * VariantBadge — V1/V2/V3 标签 + 可选 ✦ BEST 优胜标记。
 *
 * 之前实现:
 *  - 颜色字面量散落在文件底部 (catppuccinGold)
 *  - 无 ARIA / 无 role
 *  - 鼠标用户不知道 V1 代表什么
 *
 * 重构后:
 *  - 顶层 status 字段接受显式枚举,优先于 boolean pair
 *  - 加 role="img" + aria-label,屏幕阅读器读出 "变体 2,优胜"
 *  - title 给鼠标用户提供 hover tooltip
 */
function VariantBadge(props: VariantBadgeProps): JSX.Element | null {
  const { variantIndex, isWinner, isLoser, status } = props
  if (variantIndex == null) return null

  // 显式 status 优先
  const resolved: VariantMemberStatus =
    status ?? (isWinner ? 'winner' : isLoser ? 'loser' : 'pending')

  const isWinnerResolved = resolved === 'winner'
  const isLoserResolved = resolved === 'loser'

  const badgeColor = isWinnerResolved
    ? theme.routing.AUTO
    : isLoserResolved
      ? theme.border.dim
      : theme.edge.image

  const badgeText = isWinnerResolved || isLoserResolved
    ? theme.text.onAccent
    : theme.text.primary

  const ariaLabel = `变体 ${variantIndex + 1}${
    isWinnerResolved ? ',优胜' : isLoserResolved ? ',已落选' : ''
  }`

  return (
    <div
      style={{
        position: 'absolute',
        top: -8,
        left: -8,
        display: 'flex',
        gap: 2,
        zIndex: 10,
      }}
    >
      <span
        role="img"
        aria-label={ariaLabel}
        title={ariaLabel}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 22,
          height: 18,
          padding: '0 4px',
          borderRadius: '0 0 6px 6px',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.3,
          background: badgeColor,
          color: badgeText,
          boxShadow: `0 1px 3px ${theme.chrome.shadow}`,
        }}
      >
        V{variantIndex + 1}
      </span>
      {isWinnerResolved && (
        <span
          role="img"
          aria-label="优胜标记"
          title="已选为优胜"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 18,
            padding: '0 4px',
            borderRadius: '0 0 6px 6px',
            fontSize: 9,
            fontWeight: 700,
            background: BEST_BADGE_COLOR,
            color: BEST_BADGE_TEXT,
            boxShadow: `0 1px 3px ${theme.chrome.shadow}`,
          }}
        >
          ✦ BEST
        </span>
      )}
    </div>
  )
}

export default memo(VariantBadge)
