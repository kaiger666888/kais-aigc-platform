import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { StoryboardNodeData, NodeState } from '../../types/canvas'
import { stateColors } from '../../utils/styles'

type StoryboardNodeType = Node<StoryboardNodeData, 'storyboard'>

function StoryboardNodeComponent({ data }: NodeProps<StoryboardNodeType>) {
  return (
    <div style={{
      background: '#1e1e2e',
      borderRadius: 8,
      border: `2px solid ${stateColors[data.state]}`,
      padding: 12,
      width: 260,
      color: '#cdd6f4',
      fontSize: 12,
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#a6e3a1', width: 8, height: 8 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎬</span>
        <span style={{ fontWeight: 600 }}>{data.label as string}</span>
        <span style={{
          marginLeft: 'auto',
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 10,
          background: '#313244',
          color: '#a6adc8',
        }}>
          {data.duration as number}s
        </span>
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%',
        height: 120,
        borderRadius: 4,
        overflow: 'hidden',
        background: '#181825',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
        position: 'relative',
      }}>
        {data.thumbnailUrl ? (
          <img
            src={data.thumbnailUrl as string}
            alt={data.label as string}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#585b70', fontSize: 28 }}>🎬</span>
        )}
        <div style={{
          position: 'absolute',
          bottom: 4,
          right: 4,
          background: 'rgba(0,0,0,0.6)',
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: 10,
          color: '#cdd6f4',
        }}>
          {data.duration as number}s
        </div>
      </div>

      {Array.isArray(data.linkedAssetIds) && (data.linkedAssetIds as number[]).length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(data.linkedAssetIds as number[]).map((aid) => (
            <span key={aid} style={{
              padding: '1px 5px',
              borderRadius: 3,
              background: '#313244',
              fontSize: 10,
              color: '#89b4fa',
            }}>
              #{aid}
            </span>
          ))}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#a6e3a1', width: 8, height: 8 }}
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

export default memo(StoryboardNodeComponent)
