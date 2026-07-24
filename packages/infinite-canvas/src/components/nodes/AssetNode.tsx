import { memo, useState, useEffect } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { AssetNodeData, NodeState, RoutingDecision } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'
import ScoreBadge from '../ScoreBadge'
import ScoreMiniBar from '../ScoreMiniBar'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import FeedbackBadge from '../FeedbackBadge'
import { useCanvasStore } from '../../store/canvasStore'
import { fetchAssetDetail } from '../../services/canvasApi'

type AssetNodeType = Node<AssetNodeData, 'asset'>

const typeIcons: Record<string, string> = {
  role: '👤', tool: '🔧', scene: '🏞️', clip: '🎬',
  // Phase 9 (PRESENT-05): v1.1 ShotTimelineAsset character/prop assetType.
  // Additive — tool 与 prop 共用 🔧 是有意的 (tool 是 legacy P04 assetType,
  // prop 是 v1.1 新 assetType, 渲染等价). 缺省仍走 || '📦' fallback.
  character: '🧑', prop: '🔧',
}

const viewAngleLabels: Record<string, string> = {
  front: '正视图',
  side: '侧视图',
  back: '背视图',
  '3quarter': '3/4 视图',
  detail: '特写',
  full: '全身',
}

function viewAngleLabel(angle: unknown): string {
  if (typeof angle !== 'string') return '视图'
  return viewAngleLabels[angle] ?? angle
}

function AssetNodeComponent({ data, id }: NodeProps<AssetNodeType>) {
  const approveNode = useCanvasStore((s) => s.approveNode)
  const rejectNode = useCanvasStore((s) => s.rejectNode)

  // Asset Registry 异步加载：当节点缺少 thumbnailUrl/filePath 但有 assetId 时，
  // 从全局资产注册表查询补全。参照 tldraw TLAssetStore.resolve 模式。
  const [resolvedThumb, setResolvedThumb] = useState<string | null>(null)
  // 动态缩略图高度：根据图片实际宽高比自适应，避免裁切
  const [thumbHeight, setThumbHeight] = useState<number>(NODE_SIZES.asset.thumbnailHeight)
  const assetId = data.assetId as number | undefined
  const hasThumbnail = (data.thumbnailUrl as string | null) != null || resolvedThumb != null

  useEffect(() => {
    if (data.thumbnailUrl || !assetId) return
    let cancelled = false
    fetchAssetDetail(assetId).then((detail) => {
      if (cancelled) return
      if (detail?.filePath) {
        // filePath 可能是:
        // 1. OSS 相对路径 (e.g. "2/character_cat.png") → /oss/2/character_cat.png
        // 2. 绝对文件路径 (e.g. /home/kai/.../L1_xiaochen.png) → 需要 /local-file/ proxy
        // 3. 已经是 /oss/ 开头的 URL
        const fp = detail.filePath
        let url: string
        if (fp.startsWith('/oss/') || fp.startsWith('http')) {
          url = fp
        } else if (fp.startsWith('/home/') || fp.startsWith('/mnt/') || fp.startsWith('/data/')) {
          // 绝对路径 → 通过 Vite proxy 或后端 /local-file 端点
          url = `http://localhost:10588/local-file?path=${encodeURIComponent(fp)}`
        } else {
          url = `/oss/${fp}`
        }
        setResolvedThumb(url)
      }
    }).catch(() => { /* 静默失败，保持占位图标 */ })
    return () => { cancelled = true }
  }, [assetId, data.thumbnailUrl])

  const displayThumb = (data.thumbnailUrl as string | null) || resolvedThumb

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
        {data.characterId != null && (
          <span style={{
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 10,
            background: theme.bg.surface,
            color: theme.node.video,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {viewAngleLabel(data.viewAngle)}
          </span>
        )}
        <StateBadge state={data.state} />
      </div>

      <div style={{
        width: '100%',
        height: thumbHeight,
        borderRadius: 4,
        overflow: 'hidden',
        background: theme.bg.panel,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
      }}>
        {displayThumb ? (
          <img
            src={displayThumb}
            alt={data.label as string}
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget
              const ratio = img.naturalWidth / img.naturalHeight
              const nodeWidth = NODE_SIZES.asset.width - 24 /* padding */
              // 按图片宽高比计算等比缩放后的高度，限制在 60~220px 之间
              const computed = nodeWidth / ratio
              setThumbHeight(Math.round(Math.max(60, Math.min(220, computed))))
            }}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
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
      <FeedbackBadge nodeId={id} />

      {data.viewGroup != null && (
        <div style={{
          marginTop: 6,
          padding: '3px 6px',
          background: theme.bg.surface,
          borderRadius: 4,
          fontSize: 10,
          color: theme.text.secondary,
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}>
          <span>{data.viewGroup as string}</span>
          {data.isPrimaryView === true && (
            <span style={{ color: catppuccinGold }}>★</span>
          )}
        </div>
      )}

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
