import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { AssetNodeData, NodeState } from '../../types/canvas'
import { stateColors } from '../../utils/styles'

type AssetNodeType = Node<AssetNodeData, 'asset'>

const typeIcons: Record<string, string> = {
  role: '👤', tool: '🔧', scene: '🏞️', clip: '🎬',
}

function AssetNodeComponent({ data }: NodeProps<AssetNodeType>) {
  return (
    <div style={{
      background: '#1e1e2e',
      borderRadius: 8,
      border: `2px solid ${stateColors[data.state]}`,
      padding: 12,
      width: 240,
      color: '#cdd6f4',
      fontSize: 12,
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#89b4fa', width: 8, height: 8 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{typeIcons[data.assetType as string] || '📦'}</span>
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.label as string}
        </span>
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%',
        height: 100,
        borderRadius: 4,
        overflow: 'hidden',
        background: '#181825',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
      }}>
        {data.thumbnailUrl ? (
          <img
            src={data.thumbnailUrl as string}
            alt={data.label as string}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#585b70', fontSize: 28 }}>
            {typeIcons[data.assetType as string] || '📦'}
          </span>
        )}
      </div>

      {data.state === 'running' && data.progress != null && (
        <div style={{
          width: '100%',
          height: 4,
          background: '#313244',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 6,
        }}>
          <div style={{
            width: `${Math.round((data.progress as number) * 100)}%`,
            height: '100%',
            background: stateColors.running,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {data.prompt && (
        <div style={{
          color: '#a6adc8',
          fontSize: 10,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.prompt as string}
        </div>
      )}

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

export default memo(AssetNodeComponent)
