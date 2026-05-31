import { memo } from 'react'
import { theme } from '../theme/catppuccin'

interface VariantBadgeProps {
  variantIndex?: number
  isWinner?: boolean
  isLoser?: boolean
}

/** 变体标签 — V1/V2/V3 + 优胜标记 */
function VariantBadge({ variantIndex, isWinner, isLoser }: VariantBadgeProps) {
  if (variantIndex == null) return null

  return (
    <div style={{
      position: 'absolute',
      top: -8,
      left: -8,
      display: 'flex',
      gap: 2,
      zIndex: 10,
    }}>
      <span style={{
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
        background: isWinner
          ? theme.routing.AUTO
          : isLoser
            ? theme.border.dim
            : theme.edge.image,
        color: isWinner || isLoser ? theme.text.onAccent : theme.text.primary,
        boxShadow: `0 1px 3px ${theme.chrome.shadow}`,
      }}>
        V{variantIndex + 1}
      </span>
      {isWinner && (
        <span style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 18,
          padding: '0 4px',
          borderRadius: '0 0 6px 6px',
          fontSize: 9,
          fontWeight: 700,
          background: catppuccinGold,
          color: '#1e1e2e',
          boxShadow: `0 1px 3px ${theme.chrome.shadow}`,
        }}>
          ✦ BEST
        </span>
      )}
    </div>
  )
}

const catppuccinGold = '#f9e2af' // yellow

export default memo(VariantBadge)
