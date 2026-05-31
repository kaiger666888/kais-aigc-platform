import { memo } from 'react'
import type { AIScore } from '../types/canvas'
import { theme } from '../theme/catppuccin'

interface ScoreMiniBarProps {
  score: AIScore | null | undefined
}

const DIMS = [
  { key: 'overall' as const, label: '总分' },
  { key: 'technicalQuality' as const, label: '画质' },
  { key: 'aesthetics' as const, label: '美学' },
  { key: 'consistency' as const, label: '叙事' },
  { key: 'compliance' as const, label: '完成度' },
  { key: 'audioMatch' as const, label: '匹配' },
]

function getScoreColor(val: number): string {
  if (val >= 80) return theme.score.high
  if (val >= 60) return theme.score.medium
  return theme.score.low
}

function ScoreMiniBar({ score }: ScoreMiniBarProps) {
  if (!score) return null
  const values = DIMS.map(d => ({ ...d, value: score[d.key] ?? 0 }))

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      marginTop: 6,
      padding: '4px 0 2px',
      borderTop: `1px solid ${theme.border.subtle}`,
    }}>
      {values.map(d => (
        <div key={d.key} style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            marginBottom: 2,
            color: theme.text.secondary,
          }}>
            <span>{d.label}</span>
            <span style={{ color: getScoreColor(d.value), fontWeight: 600 }}>{d.value}</span>
          </div>
          <div style={{
            width: '100%',
            height: 3,
            borderRadius: 1.5,
            background: theme.bg.surface,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${d.value}%`,
              height: '100%',
              background: getScoreColor(d.value),
              borderRadius: 1.5,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default memo(ScoreMiniBar)
