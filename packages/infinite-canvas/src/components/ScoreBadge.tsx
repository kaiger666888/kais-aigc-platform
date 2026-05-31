import type { RoutingDecision } from '../types/canvas'
import { theme, getScoreColor } from '../theme/catppuccin'

const routingConfig: Record<RoutingDecision, { label: string; bg: string }> = {
  AUTO: { label: '自动', bg: theme.routing.AUTO },
  HUMAN: { label: '人工', bg: theme.routing.HUMAN },
  AI_AUDIT: { label: 'AI辅助', bg: theme.routing.AI_AUDIT },
  BLOCK: { label: '免审', bg: theme.routing.BLOCK },
}

export default function ScoreBadge({
  score,
  routingDecision,
}: {
  score: number | null | undefined
  routingDecision?: RoutingDecision
}) {
  const hasScore = score != null
  const routing = routingDecision ? routingConfig[routingDecision] : null

  if (!hasScore && !routing) return null

  return (
    <div
      data-testid="score-badge"
      style={{
        position: 'absolute',
        top: -8,
        right: -8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
        zIndex: 2,
      }}
    >
      {hasScore && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: getScoreColor(score!),
            color: theme.text.onAccent,
            fontSize: 11,
            fontWeight: 700,
            border: `2px solid ${theme.bg.card}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {Math.round(score! * 100)}
        </div>
      )}
      {routing && (
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 600,
            background: routing.bg,
            color: theme.text.onAccent,
            border: `1px solid ${theme.bg.card}`,
            whiteSpace: 'nowrap',
          }}
        >
          {routing.label}
        </span>
      )}
    </div>
  )
}
