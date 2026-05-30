import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { VideoNodeData, NodeState } from '../../types/canvas'
import { stateColors } from '../../utils/styles'

type VideoNodeType = Node<VideoNodeData, 'video'>

function VideoNodeComponent({ data }: NodeProps<VideoNodeType>) {
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
        style={{ background: '#cba6f7', width: 8, height: 8 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎥</span>
        <span style={{ fontWeight: 600 }}>视频</span>
        {data.duration != null && (
          <span style={{ fontSize: 10, color: '#a6adc8' }}>{data.duration as number}s</span>
        )}
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%',
        height: 130,
        borderRadius: 4,
        overflow: 'hidden',
        background: '#181825',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        {data.thumbnailUrl ? (
          <img
            src={data.thumbnailUrl as string}
            alt="video"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#585b70', fontSize: 40 }}>▶</span>
        )}
        {data.state === 'running' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
          }}>
            <div style={{
              width: 36,
              height: 36,
              border: '3px solid #f9e2af',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#cba6f7', width: 8, height: 8 }}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = {
    idle: '待处理', pending: '等待中', running: '生成中',
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

export default memo(VideoNodeComponent)
