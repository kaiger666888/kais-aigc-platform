/**
 * src/components/pipeline/SlotSummary.tsx — 单个阶段的 slot 完成度摘要。
 *
 * 每个阶段按 stage 子类分组（dynamic：[N files]），每行显示：
 *  stage 中文标签 · [N 文件] · 状态图标 + 完成度进度条。
 * 完成的 slot 绿色背景，未完成灰色。状态色复用 EXEC_STATE_META 词汇表。
 */
import type { AssetSlotGroup } from './model'
import { EXEC_STATE_META } from './model'
import { theme } from '../../theme/catppuccin'

export default function SlotSummary({ slots }: { slots: AssetSlotGroup[] }): React.ReactElement | null {
  if (slots.length === 0) {
    return (
      <div style={{ color: theme.text.tertiary, fontSize: 11, padding: '4px 0' }}>
        无产物槽位（该阶段未产出资产）
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {slots.map((slot) => {
        const meta = EXEC_STATE_META[slot.state]
        const done = slot.state === 'completed'
        const barColor = done ? meta.color : 'rgba(255,255,255,0.10)'
        return (
          <div
            key={slot.stage}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 5,
              background: done ? 'rgba(86,184,154,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${done ? 'rgba(86,184,154,0.20)' : theme.border.subtle}`,
            }}
          >
            <span style={{ flex: '0 0 auto', width: 70, color: theme.text.secondary, fontSize: 11 }}>
              {slot.label}
            </span>
            <span
              style={{
                flex: '0 0 auto',
                fontFamily: 'var(--cv-font-mono, monospace)',
                fontSize: 10.5,
                color: done ? theme.text.primary : theme.text.tertiary,
                minWidth: 56,
              }}
            >
              [{slot.count} 文件]
            </span>
            <span style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  flex: '1 1 auto',
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.06)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: done ? '100%' : '40%',
                    height: '100%',
                    background: barColor,
                    borderRadius: 2,
                    transition: 'width 200ms ease',
                  }}
                />
              </span>
            </span>
            <span
              style={{
                flex: '0 0 auto',
                color: meta.color,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--cv-font-mono, monospace)',
                minWidth: 16,
                textAlign: 'center',
                animation: meta.spin ? 'cv-pipe-spin 0.9s linear infinite' : undefined,
              }}
            >
              {meta.glyph}
            </span>
          </div>
        )
      })}
    </div>
  )
}
