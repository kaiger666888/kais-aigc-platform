import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { VideoNodeData, NodeState, RoutingDecision } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'
import ScoreBadge from '../ScoreBadge'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import { useCanvasActions } from '../CanvasActionsContext'

type VideoNodeType = Node<VideoNodeData, 'video'>

function VideoNodeComponent({ data, id }: NodeProps<VideoNodeType>) {
  const { approveNode, rejectNode } = useCanvasActions()

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      width: NODE_SIZES.video.width,
      color: theme.text.primary,
      fontSize: 12,
      position: 'relative',
      ...getNodeContainerStyle(data),
    }}>
      {/* 变体标签 */}
      <VariantBadge
        variantIndex={data.variantIndex as number | undefined}
        isWinner={data.isWinner === true}
        isLoser={data.isWinner === false}
      />

      {data.isWinner === true && (
        <div style={{
          position: 'absolute', inset: -3, borderRadius: 10,
          border: `2px solid ${catppuccinGold}`, pointerEvents: 'none',
          boxShadow: `0 0 12px ${catppuccinGold}40`,
        }} />
      )}

      <Handle type="target" position={Position.Left} style={{ background: theme.handle.video, width: 8, height: 8 }} />

      {/* 内联审核按钮 */}
      <ReviewActionButtons
        reviewStatus={data.reviewStatus}
        onApprove={() => approveNode(id)}
        onReject={() => rejectNode(id)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎥</span>
        <span style={{ fontWeight: 600 }}>视频</span>
        {data.duration != null && (
          <span style={{ fontSize: 10, color: theme.text.secondary }}>{data.duration as number}s</span>
        )}
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%', height: NODE_SIZES.video.thumbnailHeight,
        borderRadius: 4, overflow: 'hidden', background: theme.bg.panel,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {data.thumbnailUrl ? (
          <img src={data.thumbnailUrl as string} alt="video" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ color: theme.text.disabled, fontSize: 40 }}>▶</span>
        )}
        {data.state === 'running' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.chrome.videoOverlay }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${theme.node.storyboard}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
        )}
      </div>

      <ScoreBadge score={data.aiScore?.overall as number | null | undefined} routingDecision={data.routingDecision as RoutingDecision | undefined} />

      <Handle type="source" position={Position.Right} style={{ background: theme.handle.video, width: 8, height: 8 }} />

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const catppuccinGold = '#f9e2af'

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = { idle: '待处理', pending: '等待中', running: '生成中', success: '完成', error: '失败', cached: '已缓存' }
  return (
    <span style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, fontSize: 10, background: stateColors[state], color: theme.text.onAccent, fontWeight: 600 }}>
      {labels[state]}
    </span>
  )
}

export default memo(VideoNodeComponent)
