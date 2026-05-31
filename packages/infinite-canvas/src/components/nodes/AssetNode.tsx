import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { AssetNodeData, NodeState, RoutingDecision } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'
import ScoreBadge from '../ScoreBadge'
import ScoreMiniBar from '../ScoreMiniBar'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import { useCanvasActions } from '../CanvasActionsContext'

type AssetNodeType = Node<AssetNodeData, 'asset'>

const typeIcons: Record<string, string> = {
  role: '👤', tool: '🔧', scene: '🏞️', clip: '🎬',
}

function AssetNodeComponent({ data, id }: NodeProps<AssetNodeType>) {
  const { approveNode, rejectNode } = useCanvasActions()

  const isLoser = data.isWinner === false
  const hasVariant = data.variantGroupId != null

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      width: NODE_SIZES.asset.width,
      color: theme.text.primary,
      fontSize: 12,
      position: 'relative',
      ...getNodeContainerStyle(data),
    }}>
      {/* 变体标签 */}
      <VariantBadge
        variantIndex={data.variantIndex as number | undefined}
        isWinner={data.isWinner === true}
        isLoser={isLoser}
      />

      {/* 优胜者金色边框 */}
      {data.isWinner === true && (
        <div style={{
          position: 'absolute',
          inset: -3,
          borderRadius: 10,
          border: `2px solid ${catppuccinGold}`,
          pointerEvents: 'none',
          boxShadow: `0 0 12px ${catppuccinGold}40`,
        }} />
      )}

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: theme.handle.asset, width: 8, height: 8 }}
      />

      {/* 内联审核按钮 */}
      <ReviewActionButtons
        reviewStatus={data.reviewStatus}
        onApprove={() => approveNode(id)}
        onReject={() => rejectNode(id)}
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
        height: NODE_SIZES.asset.thumbnailHeight,
        borderRadius: 4,
        overflow: 'hidden',
        background: theme.bg.panel,
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
          <span style={{ color: theme.text.disabled, fontSize: 28 }}>
            {typeIcons[data.assetType as string] || '📦'}
          </span>
        )}
      </div>

      {data.state === 'running' && data.progress != null && (
        <div style={{
          width: '100%',
          height: 4,
          background: theme.bg.surface,
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
          color: theme.text.secondary,
          fontSize: 10,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.prompt as string}
        </div>
      )}

      <ScoreBadge score={data.aiScore?.overall as number | null | undefined} routingDecision={data.routingDecision as RoutingDecision | undefined} />
      <ScoreMiniBar score={data.aiScore as any} />

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: theme.handle.asset, width: 8, height: 8 }}
      />
    </div>
  )
}

const catppuccinGold = '#f9e2af'

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
      color: theme.text.onAccent,
      fontWeight: 600,
    }}>
      {labels[state]}
    </span>
  )
}

export default memo(AssetNodeComponent)
