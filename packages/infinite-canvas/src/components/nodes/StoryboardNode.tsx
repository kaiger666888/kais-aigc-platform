import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { StoryboardNodeData, NodeState, RoutingDecision, CameraMovement, Framing, Composition, Pacing } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES, METADATA_LABELS, METADATA_FIELD_ORDER } from '../../constants'
import { previewStoryboard } from '../../services/canvasApi'
import ScoreBadge from '../ScoreBadge'
import ScoreMiniBar from '../ScoreMiniBar'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import { useCanvasStore } from '../../store/canvasStore'

type StoryboardNodeType = Node<StoryboardNodeData, 'storyboard'>

function StoryboardNodeComponent({ data, id }: NodeProps<StoryboardNodeType>) {
  const approveNode = useCanvasStore((s) => s.approveNode)
  const rejectNode = useCanvasStore((s) => s.rejectNode)
  const showToast = useCanvasStore((s) => s.showToast)

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      width: NODE_SIZES.storyboard.width,
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

      <Handle type="target" position={Position.Left} style={{ background: theme.handle.storyboard, width: 8, height: 8 }} />

      {/* 内联审核按钮 */}
      <ReviewActionButtons
        reviewStatus={data.reviewStatus}
        onApprove={() => approveNode(id)}
        onReject={() => rejectNode(id)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎬</span>
        <span style={{ fontWeight: 600 }}>{data.label as string}</span>
        <span style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, fontSize: 10, background: theme.bg.surface, color: theme.text.secondary }}>
          {data.duration as number}s
        </span>
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%', height: NODE_SIZES.storyboard.thumbnailHeight,
        borderRadius: 4, overflow: 'hidden', background: theme.bg.panel,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 6, position: 'relative',
      }}>
        {data.thumbnailUrl ? (
          <img src={data.thumbnailUrl as string} alt={data.label as string} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ color: theme.text.disabled, fontSize: 28 }}>🎬</span>
        )}
        <div style={{ position: 'absolute', bottom: 4, right: 4, background: theme.chrome.thumbnailOverlay, padding: '1px 5px', borderRadius: 3, fontSize: 10, color: theme.text.primary }}>
          {data.duration as number}s
        </div>
      </div>

      {Array.isArray(data.linkedAssetIds) && (data.linkedAssetIds as number[]).length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(data.linkedAssetIds as number[]).map((aid) => (
            <span key={aid} style={{ padding: '1px 5px', borderRadius: 3, background: theme.bg.surface, fontSize: 10, color: theme.node.script }}>#{aid}</span>
          ))}
        </div>
      )}

      {/* Phase 35 — 镜头意图元数据 chips */}
      <MetadataChips data={data} />

      {/* Phase 38 — 构图预览按钮 */}
      <PreviewButton data={data} nodeId={id} showToast={showToast} />

      <ScoreBadge score={data.aiScore?.overall as number | null | undefined} routingDecision={data.routingDecision as RoutingDecision | undefined} />
      <ScoreMiniBar score={data.aiScore as any} />

      <Handle type="source" position={Position.Right} style={{ background: theme.handle.storyboard, width: 8, height: 8 }} />
    </div>
  )
}

const catppuccinGold = '#f9e2af'

function PreviewButton({
  data,
  nodeId,
  showToast,
}: {
  data: StoryboardNodeData
  nodeId: string
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const linkedIds = Array.isArray(data.linkedAssetIds) ? (data.linkedAssetIds as number[]) : []
  const hasPrompt = !!(data.prompt as string)?.trim()
  const canPreview = linkedIds.length > 0 && hasPrompt

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const { projectId, episodesId } = useCanvasStore.getState()
    if (!projectId || !episodesId) {
      showToast('未选中项目', 'warning')
      return
    }
    try {
      await previewStoryboard(projectId, episodesId, nodeId)
      showToast('预览生成中...', 'info')
    } catch (err: any) {
      showToast(err.message || '预览触发失败', 'error')
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={!canPreview}
      title={canPreview ? '基于 prompt 和关联资产生成静态构图预览' : '需先关联资产并填写 prompt'}
      style={{
        width: '100%',
        padding: '4px 8px',
        borderRadius: 4,
        background: canPreview ? theme.bg.surface : theme.bg.panel,
        color: canPreview ? theme.text.primary : theme.text.disabled,
        border: `1px solid ${theme.border.subtle}`,
        fontSize: 10,
        cursor: canPreview ? 'pointer' : 'not-allowed',
        marginTop: 4,
        opacity: canPreview ? 1 : 0.6,
      }}
    >
      👁 预览构图
    </button>
  )
}

function MetadataChips({ data }: { data: StoryboardNodeData }) {
  const chips: string[] = []
  for (const field of METADATA_FIELD_ORDER) {
    const value = data[field] as CameraMovement | Framing | Composition | Pacing | undefined
    if (value) {
      const labels = METADATA_LABELS[field]
      const label = (labels as Record<string, string>)[value as string]
      if (label) chips.push(label)
    }
  }
  if (chips.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      {chips.map((label, i) => (
        <span
          key={i}
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            background: theme.bg.panel,
            border: `1px solid ${theme.border.subtle}`,
            fontSize: 10,
            color: theme.text.secondary,
            fontWeight: 500,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = { idle: '待处理', pending: '等待中', running: '运行中', success: '完成', error: '失败', cached: '已缓存' }
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: stateColors[state], color: theme.text.onAccent, fontWeight: 600 }}>
      {labels[state]}
    </span>
  )
}

export default memo(StoryboardNodeComponent)
