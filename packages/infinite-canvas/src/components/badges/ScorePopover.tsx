/**
 * ScorePopover.tsx — hover mini-雷达浮层(Phase 56-03 / VIZ-01,D-01)。
 *
 * 悬停资产卡 ≥250ms 且 aiScore.dimensions≥3 时由 AssetCardNode 挂载:
 * 上方居中 8px 锚距(**只上方**简化——卡贴顶时 popover 被视口裁的概率低
 * (可拖画布),翻转方向计算复杂度不值,56-03 终裁);pointer-events:none
 * 全层(不抢画布交互);pointerEvents none + LOD≥1 门控由调用方负责。
 *
 * ScoreRadar size=128 零修改直用;维度行中文 dimLabel + getScoreColor 色
 * 点 + mono 数值(≤8 行 + 溢出「…」);头『AI 评分 · {N} / 100』。
 */
import { memo } from 'react'
import type { AIScore } from '@kais/flowgraph-v3'
import ScoreRadar from '../panel/ScoreRadar'
import { getScoreColor, theme } from '../../theme/catppuccin'
import { dimLabel } from '../../utils/scoreVocabulary'

const MAX_DIM_ROWS = 8

function ScorePopoverBase({ aiScore }: { aiScore: AIScore }): React.ReactElement {
  const dims = Object.entries(aiScore.dimensions ?? {})
  const shown = dims.slice(0, MAX_DIM_ROWS)
  const overflow = dims.length - shown.length
  return (
    <div
      data-testid="score-popover"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(100% + 8px)',
        width: 232,
        background: 'var(--cv-bg-panel)',
        border: '1px solid var(--cv-border-subtle, rgba(255,255,255,0.08))',
        borderRadius: 8,
        boxShadow: 'var(--cv-shadow-pop, var(--cv-shadow-card))',
        backdropFilter: 'blur(4px)',
        padding: 10,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <div style={{ marginBottom: 6, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, color: theme.text.secondary }}>AI 评分 · </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
          {Math.round((aiScore.overall ?? 0) * 100)}
        </span>
        <span style={{ fontSize: 10, color: theme.text.tertiary }}> / 100</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <ScoreRadar aiScore={aiScore} size={128} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
          {shown.map(([name, v]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, lineHeight: 1.4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: getScoreColor(typeof v === 'number' ? v : 0), flexShrink: 0 }} />
              <span style={{ color: theme.text.secondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dimLabel(name)}</span>
              <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.tertiary, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round((typeof v === 'number' ? v : 0) * 100)}
              </span>
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 10, color: theme.text.tertiary }}>… +{overflow} 维</div>
          )}
        </div>
      </div>
    </div>
  )
}

export const ScorePopover = memo(ScorePopoverBase)
