import type { RoutingDecision } from '../types/canvas'

function getScoreColor(score: number): string {
  if (score >= 0.8) return '#a6e3a1'
  if (score >= 0.5) return '#f9e2af'
  return '#f38ba8'
}

const routingConfig: Record<RoutingDecision, { label: string; bg: string }> = {
  AUTO: { label: '自动', bg: '#89b4fa' },
  HUMAN: { label: '人工', bg: '#f9e2af' },
  AI_AUDIT: { label: 'AI辅助', bg: '#cba6f7' },
  BLOCK: { label: '免审', bg: '#585b70' },
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
            color: '#1e1e2e',
            fontSize: 11,
            fontWeight: 700,
            border: '2px solid #1e1e2e',
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
            color: '#1e1e2e',
            border: '1px solid #1e1e2e',
            whiteSpace: 'nowrap',
          }}
        >
          {routing.label}
        </span>
      )}
    </div>
  )
}
