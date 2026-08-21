/**
 * TheaterShell.tsx — 剧场家族公共壳(Phase 56-02 / VIZ-02/03)。
 *
 * 全屏剧场的家族语法固化:壳(背板点击关)+ 头栏(icon/标题/副标 + headerExtra
 * 控件槽 + ✕)+ children 全权布局区。视觉决策 UI-SPEC 定死——本壳零新 token。
 *
 * - 53 VariantWall 不迁移(Do-Not-Regress;未来 ≥3 消费者稳定后收编)。
 * - Esc 关闭不由 Shell 挂——各消费者键盘 hook 统一处理(避免双 listener);
 *   Shell 只承接背板点击关与 ✕。
 * - 头栏上下 10px 是剧场家族 grandfathered 节奏(UI-SPEC Spacing 例外条款)。
 */
import { theme, v3theme } from '../../theme/catppuccin'

export function theaterBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? v3theme.signal.select : theme.bg.card,
    color: active ? v3theme.surface.canvas : theme.text.primary,
    border: `1px solid ${theme.border.default}`,
    borderRadius: 6, fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  }
}

export const theaterCloseBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16,
  cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}

export default function TheaterShell({ title, subtitle, icon, onClose, headerExtra, children }: {
  title: string;
  subtitle?: React.ReactNode;
  /** 家族词汇 emoji(🎞 组视图 / 🎤 听审…)。 */
  icon?: string;
  onClose: () => void;
  /** 头栏右侧控件槽(连播 toggle/导航等,消费者全权)。 */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid="theater-shell"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: theme.chrome.lightboxOverlay, backdropFilter: 'blur(2px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── 头栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: theme.bg.panel,
        borderBottom: `1px solid ${theme.border.default}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {icon != null && <span style={{ color: v3theme.signal.select, fontSize: 15 }}>{icon}</span>}
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {subtitle != null && (
            <span style={{ color: theme.text.secondary, fontSize: 11, fontFamily: 'var(--cv-font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {headerExtra}
          <button onClick={onClose} style={theaterCloseBtnStyle}>✕</button>
        </div>
      </div>
      {/* ── 内容区(消费者全权布局) ── */}
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  )
}
