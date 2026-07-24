/**
 * src/components/badges/ScoreMiniBar.tsx — 资产卡片底部的迷你评分条（任务 2A）。
 *
 * 消费 V3 aiScore（{ overall: number; dimensions?: Record<string, number> }），
 * 不是旧的 5 固定维度：
 *  - overall → 大字（按 getScoreColor 染色，0–1 量纲 → 显示为 0–100 整数）；
 *  - dimensions → 一排迷你水平条（每维一条，宽 ∝ 分值、色 = 该维 getScoreColor）；
 *    dimensions 缺省（undefined / 空）则只渲染大字；
 *    维度数量任意（3–7 自适应，flex 等分），具体名称/数值走 title tooltip
 *    （卡片是 L2 近景，逐维明细留给右面板 ScoreRadar，避免在窄卡里挤标签）。
 *
 * 设计遵循 dataviz：单系列无需图例（标题「AI评分」即命名）；文本走 text token，
 * 颜色只落在标记（大字 + 填充条）上承载质量语义（高/中/低 = 状态色）。
 */
import { memo } from 'react'
import type { AIScore } from '@kais/flowgraph-v3'
import { theme, getScoreColor } from '../../theme/catppuccin'

interface ScoreMiniBarProps {
  score: AIScore | null | undefined
}

/** 0–1 → 0–100 整数（越界钳制，防脏数据）。 */
function toPct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100)
}

function ScoreMiniBar({ score }: ScoreMiniBarProps) {
  if (!score || typeof score.overall !== 'number') return null
  const overallPct = toPct(score.overall)
  const entries = score.dimensions
    ? Object.entries(score.dimensions).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    : []

  return (
    <div
      data-testid="score-mini-bar"
      style={{
        marginTop: 4,
        paddingTop: 4,
        borderTop: `1px solid ${theme.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        flex: '0 0 auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            lineHeight: 1,
            color: getScoreColor(score.overall),
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {overallPct}
        </span>
        <span style={{ fontSize: 8, color: theme.text.secondary, letterSpacing: 0.2 }}>AI评分</span>
      </div>
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 3 }}>
          {entries.map(([name, v]) => {
            const pct = toPct(v)
            return (
              <div
                key={name}
                title={`${name}: ${pct}`}
                style={{ flex: 1, minWidth: 0 }}
              >
                <div
                  style={{
                    width: '100%',
                    height: 3,
                    borderRadius: 1.5,
                    background: theme.bg.surface,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: getScoreColor(v),
                      borderRadius: 1.5,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default memo(ScoreMiniBar)
