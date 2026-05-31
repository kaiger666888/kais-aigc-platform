import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ScriptNodeData, NodeState } from '../../types/canvas'
import { stateColors } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'

type ScriptNodeType = Node<ScriptNodeData, 'script'>

function ScriptNodeComponent({ data }: NodeProps<ScriptNodeType>) {
  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${stateColors[data.state]}`,
      padding: 12,
      minWidth: NODE_SIZES.script.minWidth,
      maxWidth: NODE_SIZES.script.maxWidth,
      color: theme.text.primary,
      fontSize: 12,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
        fontWeight: 600,
      }}>
        <span style={{ fontSize: 16 }}>📄</span>
        <span>{data.label as string}</span>
        <StateBadge state={data.state} />
      </div>

      <div style={{
        background: theme.bg.panel,
        borderRadius: 4,
        padding: 8,
        maxHeight: 120,
        overflow: 'hidden',
        lineHeight: 1.5,
        color: theme.text.secondary,
        fontSize: 11,
      }}>
        {(data.content as string) || '暂无剧本内容'}
      </div>

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
    }}>
      {labels[state]}
    </span>
  )
}

export default memo(ScriptNodeComponent)
