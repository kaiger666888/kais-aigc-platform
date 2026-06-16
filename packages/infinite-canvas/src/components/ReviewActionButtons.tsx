import { memo, useCallback, useState } from 'react'
import type { ReviewStatus } from '../types/canvas'
import { useCanvasStore } from '../store/canvasStore'
import { theme } from '../theme/catppuccin'

interface ReviewActionButtonsProps {
  reviewStatus?: ReviewStatus
  nodeId?: string
  onApprove?: () => void
  onReject?: () => void
}

function ReviewActionButtons({ reviewStatus, nodeId, onApprove, onReject }: ReviewActionButtonsProps) {
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [feedback, setFeedback] = useState('')
  const storeRejectNode = useCanvasStore((s) => s.rejectNode)

  const handleApprove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onApprove?.()
  }, [onApprove])

  const handleRejectClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (nodeId) {
      setShowRejectDialog(true)
    } else {
      onReject?.()
    }
  }, [nodeId, onReject])

  const handleRejectConfirm = useCallback(() => {
    if (nodeId) {
      storeRejectNode(nodeId, feedback).then(() => {
        setShowRejectDialog(false)
        setFeedback('')
      })
    }
  }, [nodeId, feedback, storeRejectNode])

  const handleRejectCancel = useCallback(() => {
    setShowRejectDialog(false)
    setFeedback('')
  }, [])

  // 驳回意见输入对话框
  if (showRejectDialog) {
    return (
      <div style={dialogOverlayStyle} onClick={(e) => e.stopPropagation()}>
        <div style={dialogStyle}>
          <div style={dialogTitleStyle}>驳回意见</div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="请输入驳回原因..."
            style={textareaStyle}
            autoFocus
          />
          <div style={dialogActionsStyle}>
            <button onClick={handleRejectCancel} style={cancelBtnStyle}>取消</button>
            <button onClick={handleRejectConfirm} style={confirmBtnStyle}>确认驳回</button>
          </div>
        </div>
      </div>
    )
  }

  // 已审核：显示状态图标
  if (reviewStatus === 'approved') {
    return (
      <div style={containerStyle}>
        <span style={approvedIconStyle}>&#10003;</span>
      </div>
    )
  }
  if (reviewStatus === 'rejected') {
    return (
      <div style={containerStyle}>
        <span style={rejectedIconStyle}>&#10007;</span>
      </div>
    )
  }

  // 待审核：显示操作按钮
  return (
    <div style={containerStyle}>
      <button onClick={handleApprove} style={approveBtnStyle} title="审核通过">
        &#10003;
      </button>
      <button onClick={handleRejectClick} style={rejectBtnStyle} title="驳回">
        &#10007;
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

const dialogOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const dialogStyle: React.CSSProperties = {
  background: theme.bg.surface,
  borderRadius: 8,
  padding: 16,
  width: 320,
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
}

const dialogTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: theme.text.primary,
  marginBottom: 12,
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 80,
  borderRadius: 6,
  border: `1px solid ${theme.border.dim}`,
  background: theme.bg.card,
  color: theme.text.primary,
  padding: 8,
  fontSize: 13,
  resize: 'vertical',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const dialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 12,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${theme.border.dim}`,
  background: 'transparent',
  color: theme.text.secondary,
  fontSize: 13,
  cursor: 'pointer',
}

const confirmBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: theme.status.rejected,
  color: theme.text.onAccent,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

export default memo(ReviewActionButtons)
