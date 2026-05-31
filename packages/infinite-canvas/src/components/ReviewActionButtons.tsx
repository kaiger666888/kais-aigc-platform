import { memo, useCallback } from 'react'
import type { ReviewStatus } from '../types/canvas'
import { theme } from '../theme/catppuccin'

interface ReviewActionButtonsProps {
  reviewStatus?: ReviewStatus
  onApprove?: () => void
  onReject?: () => void
}

/** 节点内联审核按钮 — 右上角悬浮 */
function ReviewActionButtons({ reviewStatus, onApprove, onReject }: ReviewActionButtonsProps) {
  const handleApprove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onApprove?.()
  }, [onApprove])

  const handleReject = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onReject?.()
  }, [onReject])

  // 已审核：显示状态图标
  if (reviewStatus === 'approved') {
    return (
      <div style={containerStyle}>
        <span style={approvedIconStyle}>✓</span>
      </div>
    )
  }
  if (reviewStatus === 'rejected') {
    return (
      <div style={containerStyle}>
        <span style={rejectedIconStyle}>✗</span>
      </div>
    )
  }

  // 待审核：显示操作按钮
  return (
    <div style={containerStyle}>
      <button onClick={handleApprove} style={approveBtnStyle} title="审核通过">
        ✓
      </button>
      <button onClick={handleReject} style={rejectBtnStyle} title="驳回">
        ✗
      </button>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  display: 'flex',
  gap: 2,
  zIndex: 5,
}

const approvedIconStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 4,
  background: theme.status.approved,
  color: theme.text.onAccent,
  fontSize: 12,
  fontWeight: 700,
}

const rejectedIconStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 4,
  background: theme.status.rejected,
  color: theme.text.onAccent,
  fontSize: 12,
  fontWeight: 700,
}

const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 4,
  border: 'none',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
  opacity: 0,
  transition: 'opacity 0.15s ease, transform 0.1s ease',
}

const approveBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: theme.status.approved,
  color: theme.text.onAccent,
}

const rejectBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: theme.status.rejected,
  color: theme.text.onAccent,
}

export default memo(ReviewActionButtons)
