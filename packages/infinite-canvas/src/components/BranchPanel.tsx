import { memo, useCallback, useMemo } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme } from '../theme/catppuccin'
import { branchColors, getBranchColorByStatus } from '../theme/branchColors'
import type { FlowBranch, BranchStatus } from '../types/canvas'

const statusLabels: Record<BranchStatus, string> = {
  draft: '草稿',
  active: '主线',
  paused: '暂停',
  completed: '已完成',
  archived: '已归档',
  rejected: '已驳回',
}

interface BranchPanelProps {
  className?: string
  style?: React.CSSProperties
}

function BranchPanel({ className, style }: BranchPanelProps) {
  const branches = useCanvasStore((s) => s.branches)
  const nodes = useCanvasStore((s) => s.nodes)
  const selectBranchAsMain = useCanvasStore((s) => s.selectBranchAsMain)
  const archiveBranch = useCanvasStore((s) => s.archiveBranch)
  const updateBranch = useCanvasStore((s) => s.updateBranch)
  const showToast = useCanvasStore((s) => s.showToast)

  const branchStats = useMemo(() => {
    const stats = new Map<string, number>()
    for (const n of nodes) {
      const branchId = (n.data?.branchId as string) ?? 'main'
      stats.set(branchId, (stats.get(branchId) ?? 0) + 1)
    }
    return stats
  }, [nodes])

  const mainBranches = useMemo(() => branches.filter((b) => b.status === 'active'), [branches])
  const exploreBranches = useMemo(() => branches.filter((b) => ['draft', 'paused'].includes(b.status)), [branches])
  const archivedBranches = useMemo(() => branches.filter((b) => ['archived', 'rejected', 'completed'].includes(b.status)), [branches])

  const handlePromote = useCallback((branch: FlowBranch) => {
    selectBranchAsMain(branch.id)
  }, [selectBranchAsMain])

  const handleArchive = useCallback((branch: FlowBranch) => {
    archiveBranch(branch.id)
  }, [archiveBranch])

  const handleRestore = useCallback((branch: FlowBranch) => {
    updateBranch(branch.id, { status: 'draft' })
    showToast(`已恢复: ${branch.label}`, 'info')
  }, [updateBranch, showToast])

  const handleDelete = useCallback((branch: FlowBranch) => {
    updateBranch(branch.id, { status: 'rejected' })
    showToast(`已删除: ${branch.label}`, 'warning')
  }, [updateBranch, showToast])

  const renderBranch = useCallback((branch: FlowBranch) => {
    const color = getBranchColorByStatus(branch.status)
    const nodeCount = branchStats.get(branch.id) ?? 0
    const isMain = branch.status === 'active'

    return (
      <div key={branch.id} style={branchItemStyle(color)}>
        <div style={branchHeaderStyle}>
          <span style={branchDotStyle(color)} />
          <span style={branchLabelStyle}>{branch.label}</span>
          <span style={statusBadgeStyle(color)}>{statusLabels[branch.status]}</span>
        </div>
        <div style={branchMetaStyle}>
          <span>{nodeCount} 个节点</span>
          {branch.forkReason && <span style={forkReasonStyle}>{branch.forkReason}</span>}
        </div>
        <div style={branchActionsStyle}>
          {!isMain && branch.status !== 'archived' && branch.status !== 'rejected' && (
            <button onClick={() => handlePromote(branch)} style={actionBtnStyle}>升为主线</button>
          )}
          {branch.status === 'archived' && (
            <button onClick={() => handleRestore(branch)} style={actionBtnStyle}>恢复</button>
          )}
          {!isMain && branch.status !== 'archived' && branch.status !== 'rejected' && (
            <button onClick={() => handleArchive(branch)} style={actionBtnStyle}>归档</button>
          )}
          {!isMain && branch.status !== 'active' && (
            <button onClick={() => handleDelete(branch)} style={{ ...actionBtnStyle, color: branchColors.rejected.text }}>删除</button>
          )}
        </div>
      </div>
    )
  }, [branchStats, handlePromote, handleArchive, handleRestore, handleDelete])

  return (
    <div className={className} style={{ ...panelStyle, ...style }}>
      <div style={panelHeaderStyle}>分支管理</div>

      {mainBranches.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>主线</div>
          {mainBranches.map(renderBranch)}
        </div>
      )}

      {exploreBranches.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>探索分支</div>
          {exploreBranches.map(renderBranch)}
        </div>
      )}

      {archivedBranches.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>归档</div>
          {archivedBranches.map(renderBranch)}
        </div>
      )}

      {branches.length === 0 && (
        <div style={emptyStyle}>暂无分支</div>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  width: 260,
  maxHeight: '100%',
  overflow: 'auto',
  background: theme.bg.panel,
  borderLeft: `1px solid ${theme.border.default}`,
  padding: 12,
}

const panelHeaderStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: theme.text.primary,
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: `1px solid ${theme.border.subtle}`,
}

const sectionStyle: React.CSSProperties = {
  marginBottom: 12,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: theme.text.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
}

const branchItemStyle = (color: { border: string; bg: string }): React.CSSProperties => ({
  borderRadius: 6,
  border: `1px solid ${color.border}40`,
  background: color.bg,
  padding: 8,
  marginBottom: 6,
})

const branchHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const branchDotStyle = (color: { border: string }): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color.border,
  flexShrink: 0,
})

const branchLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: theme.text.primary,
  flex: 1,
}

const statusBadgeStyle = (color: { text: string }): React.CSSProperties => ({
  fontSize: 10,
  color: color.text,
  background: `${color.text}20`,
  padding: '1px 6px',
  borderRadius: 4,
})

const branchMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  marginLeft: 14,
  fontSize: 11,
  color: theme.text.secondary,
}

const forkReasonStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}

const branchActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 6,
  marginLeft: 14,
}

const actionBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 11,
  borderRadius: 4,
  border: `1px solid ${theme.border.dim}`,
  background: 'transparent',
  color: theme.text.secondary,
  cursor: 'pointer',
}

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  color: theme.text.secondary,
  fontSize: 12,
  padding: 20,
}

export default memo(BranchPanel)
