/**
 * ReasonDialog.tsx — 终审驳回理由对话框（Phase 57-06；54 C-4 逐字复刻）。
 *
 * 组件内 state 二次确认层（绝不用原生 confirm/alert）；文案逐字 54-UI-SPEC
 * Copywriting Contract（驳回确认标题 / 驳回理由 placeholder）。理由必填
 * 1-500：确认键 disabled 与发送侧共用 gateOpsFlow.validateReason（双侧
 * 同一契约真值）。Esc 关闭；焦点圈走 tokens.css 既有 :focus-visible。
 */
import { useState, type CSSProperties } from 'react'
import { theme } from '@ic/theme/catppuccin'
import { REASON_LIMITS, validateReason } from '../lib/gateOpsFlow'

/** 取消键 ghost（54 同款：透明底 + 默认边）。 */
const cancelStyle: CSSProperties = {
  height: 30,
  padding: '0 14px',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'none',
  border: `1px solid ${theme.border.default}`,
  color: 'var(--cv-text-secondary)',
  fontSize: 'var(--cv-fs-t2)',
}

/** 确认驳回 = 玫填充（destructive；54 同款 theme.button.danger + onAccent）。 */
const confirmStyle: CSSProperties = {
  height: 30,
  padding: '0 14px',
  borderRadius: 6,
  cursor: 'pointer',
  background: theme.button.danger,
  border: 'none',
  color: theme.text.onAccent,
  fontSize: 'var(--cv-fs-t2)',
  fontWeight: 600,
}

/** 遮罩底 = --cv-bg-canvas 的 alpha 衍生（*Weak 同式先例，54 同值）。 */
export default function ReasonDialog({
  phaseName,
  onConfirm,
  onCancel,
}: {
  /** 回滚阶段名（p13 注册表 name「交付」——标题 {阶段名} 插值源）。 */
  phaseName: string
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div
      data-testid="deliver-reason-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="确认驳回"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,14,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--cv-bg-panel)',
          borderRadius: 10,
          padding: 20,
          width: '100%',
          maxWidth: 360,
          boxShadow: theme.shadow.pop,
          border: '1px solid var(--cv-line-panel)',
        }}
      >
        <div style={{ fontSize: 'var(--cv-fs-t1)', fontWeight: 600, marginBottom: 8, color: 'var(--cv-text-primary)' }}>
          驳回后管线将回滚到 {phaseName} 重跑（重试预算 3 次）。确认驳回？
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="驳回理由（必填）：告诉管线哪里不过——将随决策存档。"
          maxLength={REASON_LIMITS.max}
          autoFocus
          style={{
            width: '100%',
            minHeight: 80,
            borderRadius: 6,
            background: 'var(--cv-bg-card)',
            border: '1px solid var(--cv-line-panel)',
            color: 'var(--cv-text-primary)',
            fontSize: 'var(--cv-fs-t2)',
            padding: 10,
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={cancelStyle}>
            取消
          </button>
          <button
            onClick={() => {
              const trimmed = reason.trim()
              if (!validateReason(trimmed)) return
              onConfirm(trimmed)
            }}
            disabled={!validateReason(reason)}
            style={{ ...confirmStyle, ...(reason.trim().length === 0 ? { cursor: 'not-allowed', opacity: 0.5 } : {}) }}
          >
            确认驳回
          </button>
        </div>
      </div>
    </div>
  )
}
