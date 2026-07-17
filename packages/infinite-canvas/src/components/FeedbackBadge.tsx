import { useEffect, useState } from 'react'
import { theme, catppuccin } from '../theme/catppuccin'
import {
  getFeedbackStats,
  getPropagation,
  type FeedbackStats,
  type PropagationResult,
} from '../services/canvasApi'
import { useCanvasStore } from '../store/canvasStore'

const verdictColor: Record<string, string> = {
  approve: catppuccin.green,
  reject: catppuccin.red,
  contest: catppuccin.yellow,
  note: catppuccin.blue,
}

/**
 * Asset Feedback Layer — small circular badge showing feedback count and
 * latest verdict color. Sits on the node's top-left corner so it doesn't
 * collide with ScoreBadge (top-right).
 *
 * Enhancements:
 *  - On hover, shows a tooltip "X 条反馈 | 影响 Y 个下游节点".
 *  - When the latest verdict is "reject", the badge pulses to draw
 *    attention to flagged assets.
 */
export default function FeedbackBadge({ nodeId }: { nodeId: string }) {
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [propagation, setPropagation] = useState<PropagationResult | null>(null)
  const [hovered, setHovered] = useState(false)
  const projectId = useCanvasStore((s) => s.projectId) as number | null

  useEffect(() => {
    let cancelled = false
    getFeedbackStats(nodeId).then((s) => {
      if (!cancelled) setStats(s)
    })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  // Lazy-fetch propagation only when first hovered (saves requests).
  useEffect(() => {
    if (!hovered || propagation !== null) return
    let cancelled = false
    getPropagation(nodeId, projectId ?? undefined).then((p) => {
      if (!cancelled) setPropagation(p)
    })
    return () => {
      cancelled = true
    }
  }, [hovered, nodeId, projectId, propagation])

  if (!stats || stats.count === 0) return null

  const color = stats.latest?.verdict ? verdictColor[stats.latest.verdict] ?? catppuccin.surface2 : catppuccin.surface2
  const isReject = stats.latest?.verdict === 'reject'
  const downstreamCount = propagation?.downstream.length ?? 0

  const tooltipText = `${stats.count} 条反馈${stats.latest?.verdict ? ` · 最新：${stats.latest.verdict}` : ''}${downstreamCount > 0 ? ` | 影响 ${downstreamCount} 个下游节点` : ''}`

  return (
    <div
      data-testid="feedback-badge"
      style={{
        position: 'absolute',
        top: -8,
        left: -8,
        zIndex: 2,
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: color,
          color: theme.text.onAccent,
          fontSize: 11,
          fontWeight: 700,
          border: `2px solid ${theme.bg.card}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 0 6px ${catppuccin.crust}88`,
          ...(isReject
            ? {
                animation: 'feedback-pulse 1.4s ease-in-out infinite',
              }
            : {}),
        }}
        title={tooltipText}
      >
        {stats.count > 9 ? '9+' : stats.count}
      </div>

      {hovered && (
        <div
          data-testid="feedback-badge-tooltip"
          style={{
            position: 'absolute',
            top: 24,
            left: 0,
            background: theme.bg.surface,
            color: theme.text.primary,
            border: `1px solid ${theme.border.subtle}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            whiteSpace: 'nowrap',
            boxShadow: `0 2px 8px ${catppuccin.crust}cc`,
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {stats.count} 条反馈
            {stats.latest?.verdict && (
              <span style={{ color: verdictColor[stats.latest.verdict] ?? color, marginLeft: 6 }}>
                · {stats.latest.verdict}
              </span>
            )}
          </div>
          <div style={{ color: theme.text.secondary }}>
            {propagation == null
              ? '加载影响范围…'
              : downstreamCount > 0
                ? `影响 ${downstreamCount} 个下游节点`
                : '无下游影响'}
          </div>
        </div>
      )}

      <style>{`
        @keyframes feedback-pulse {
          0%, 100% {
            box-shadow: 0 0 6px ${catppuccin.red}88, 0 0 0 0 ${catppuccin.red}66;
          }
          50% {
            box-shadow: 0 0 12px ${catppuccin.red}cc, 0 0 0 6px ${catppuccin.red}00;
          }
        }
      `}</style>
    </div>
  )
}
