import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ScriptNodeData, NodeState, ReviewStatus } from '../../types/canvas'
import { stateColors, getNodeBorderColor } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'

type ScriptNodeType = Node<ScriptNodeData, 'script'>

function ScriptNodeComponent({ data }: NodeProps<ScriptNodeType>) {
  const tags = (data.tags as string[]) || []
  const score = data.score as number | undefined
  const filePath = data.filePath as string | undefined
  const description = (data.description as string) || (data.content as string) || ''
  const isVariantGroup = (data as any).category === 'variant_group'
  const candidateCount = ((data as any).candidates as any[])?.length || ((data as any).variantNodeIds as string[])?.length || 0
  const variantReviewStatus = (data as any).reviewStatus as ReviewStatus | undefined

  if (isVariantGroup) {
    return (
      <div style={{
        background: theme.bg.card,
        borderRadius: 10,
        border: `2px solid ${theme.node.script}`,
        padding: 16,
        minWidth: NODE_SIZES.script.minWidth,
        maxWidth: 340,
        color: theme.text.primary,
        fontSize: 12,
        boxShadow: `0 4px 16px ${theme.chrome.shadow}`,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}>
          <span style={{ fontSize: 24 }}>🎯</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{data.label as string}</div>
            <div style={{ fontSize: 10, color: theme.text.secondary, marginTop: 2 }}>
              点击查看 {candidateCount} 个候选方案
            </div>
          </div>
          {variantReviewStatus && <ReviewStatusBadge status={variantReviewStatus} />}
          <StateBadge state={data.state} />
        </div>

        {description && (
          <div style={{
            background: theme.bg.panel,
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            lineHeight: 1.5,
            color: theme.text.secondary,
            whiteSpace: 'pre-wrap',
          }}>
            {description.length > 100 ? description.slice(0, 100) + '…' : description}
          </div>
        )}

        {candidateCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            padding: '6px 10px',
            background: theme.bg.surface,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: theme.node.script,
          }}>
            <span>📋 {candidateCount} 个候选</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: theme.text.disabled }}>→ 点击展开</span>
          </div>
        )}

        <Handle
          type="target"
          position={Position.Left}
          style={{ background: theme.handle.script, width: 8, height: 8 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: theme.handle.script, width: 8, height: 8 }}
        />
      </div>
    )
  }

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 10,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      minWidth: NODE_SIZES.script.minWidth,
      maxWidth: 320,
      color: theme.text.primary,
      fontSize: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      {/* Header: icon + label + state */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
        fontWeight: 600,
      }}>
        <span style={{ fontSize: 16 }}>📄</span>
        <span style={{ flex: 1, fontSize: 13 }}>{data.label as string}</span>
        <StateBadge state={data.state} />
      </div>

      {/* Score badge */}
      {score != null && (
        <div style={{ marginBottom: 6 }}>
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            background: score >= 9 ? theme.state.success : score >= 7 ? theme.state.pending : theme.state.error,
            color: theme.text.onAccent,
          }}>
              ⭐ {score}
            </span>
        </div>
      )}

      {/* Description / content */}
      {description && (
        <div style={{
          background: theme.bg.panel,
          borderRadius: 6,
          padding: 8,
          maxHeight: 100,
          overflow: 'hidden',
          lineHeight: 1.5,
          color: theme.text.secondary,
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginBottom: tags.length || filePath ? 6 : 0,
        }}>
          {description.length > 120 ? description.slice(0, 120) + '…' : description}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 3,
          marginBottom: filePath ? 4 : 0,
        }}>
          {tags.map((tag, i) => (
            <span key={i} style={{
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: 10,
              background: theme.bg.surface,
              color: theme.node.script,
              fontWeight: 500,
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* File path indicator */}
      {filePath && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 10,
          color: theme.text.disabled,
          marginTop: 4,
        }}>
          <span>📎</span>
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}>
            {filePath.split('/').pop()}
          </span>
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: theme.handle.script, width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: theme.handle.script, width: 8, height: 8 }}
      />
    </div>
  )
}

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = {
    idle: '待处理', pending: '等待中', running: '运行中',
    success: '完成', error: '失败', cached: '已缓存',
  }
  return (
    <span style={{
      marginLeft: 'auto',
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      background: stateColors[state],
      color: theme.text.onAccent,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {labels[state]}
    </span>
  )
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const config: Record<ReviewStatus, { label: string; bg: string }> = {
    pending: { label: '待审核', bg: theme.status.awaiting },
    approved: { label: '已通过', bg: theme.status.approved },
    rejected: { label: '已驳回', bg: theme.status.rejected },
  }
  const c = config[status]
  return (
    <span style={{
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      background: c.bg,
      color: theme.text.onAccent,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {c.label}
    </span>
  )
}

export default memo(ScriptNodeComponent)
