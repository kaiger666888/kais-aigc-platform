import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ScriptNodeData, NodeState } from '../../types/canvas'
import { stateColors } from '../../utils/styles'

type ScriptNodeType = Node<ScriptNodeData, 'script'>

function ScriptNodeComponent({ data }: NodeProps<ScriptNodeType>) {
  return (
    <div style={{
      background: '#1e1e2e',
      borderRadius: 8,
      border: `2px solid ${stateColors[data.state]}`,
      padding: 12,
      minWidth: 240,
      maxWidth: 280,
      color: '#cdd6f4',
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
        background: '#181825',
        borderRadius: 4,
        padding: 8,
        maxHeight: 120,
        overflow: 'hidden',
        lineHeight: 1.5,
        color: '#a6adc8',
        fontSize: 11,
      }}>
        {(data.content as string) || '暂无剧本内容'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#89b4fa', width: 8, height: 8 }}
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
      color: '#1e1e2e',
      fontWeight: 600,
    }}>
      {labels[state]}
    </span>
  )
}

export default memo(ScriptNodeComponent)
