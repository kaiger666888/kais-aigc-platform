/** 圆形评分徽章 — 显示在节点右上角 */

function getScoreColor(score: number): string {
  if (score >= 0.8) return '#a6e3a1'
  if (score >= 0.5) return '#f9e2af'
  return '#f38ba8'
}

export default function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null

  const bgColor = getScoreColor(score)
  const display = Math.round(score * 100)

  return (
    <div
      data-testid="score-badge"
      style={{
        position: 'absolute',
        top: -8,
        right: -8,
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: bgColor,
        color: '#1e1e2e',
        fontSize: 11,
        fontWeight: 700,
        border: '2px solid #1e1e2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
      }}
    >
      {display}
    </div>
  )
}
