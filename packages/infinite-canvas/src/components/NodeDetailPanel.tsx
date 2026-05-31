import { useState, useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { ScriptNodeData, AssetNodeData, StoryboardNodeData, VideoNodeData, NodeState, ReviewStatus } from '../types/canvas'
import { stateColors } from '../utils/styles'
import { theme, getScoreColor } from '../theme/catppuccin'

type NodeData = ScriptNodeData | AssetNodeData | StoryboardNodeData | VideoNodeData

interface Props {
  node: Node | null
  onClose: () => void
}

/** 节点详情侧边栏面板 */
export default function NodeDetailPanel({ node, onClose }: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setLightboxSrc(null)
  }, [])

  if (!node) return null

  const data = node.data as NodeData
  const type = data.type as string

  return (
    <>
      <div
        data-testid="detail-panel"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 400,
          height: '100%',
          background: theme.bg.panel,
          borderLeft: `1px solid ${theme.border.default}`,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideInRight 0.25s ease-out',
        }}
      >
        {/* 顶部标题栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.border.default}`,
          background: theme.bg.card,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TypeIcon type={type} />
            <span style={{ color: theme.text.primary, fontWeight: 600, fontSize: 14 }}>
              {data.label as string}
            </span>
            <StateBadge state={data.state as NodeState} />
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: theme.text.secondary,
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = theme.bg.surface }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
          >
            ✕
          </button>
        </div>

        {/* 滚动内容区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {type === 'script' && <ScriptDetail data={data as ScriptNodeData} />}
          {type === 'asset' && (
            <AssetDetail
              data={data as AssetNodeData}
              onImageClick={(src) => setLightboxSrc(src)}
            />
          )}
          {type === 'storyboard' && (
            <StoryboardDetail
              data={data as StoryboardNodeData}
              onImageClick={(src) => setLightboxSrc(src)}
            />
          )}
          {type === 'video' && (
            <VideoDetail data={data as VideoNodeData} />
          )}

          {/* 审核信息 */}
          {(!!data.reviewStatus || !!data.aiScore) && (
            <>
              <SectionLabel>审核信息</SectionLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <ReviewStatusBadge status={data.reviewStatus as ReviewStatus | undefined} />
              </div>
              {data.aiScore && (data.aiScore as any).overall != null && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <ScoreDim label="美学" value={(data.aiScore as any).aesthetics} />
                  <ScoreDim label="一致性" value={(data.aiScore as any).consistency} />
                  <ScoreDim label="合规" value={(data.aiScore as any).compliance} />
                  <ScoreDim label="技术" value={(data.aiScore as any).technicalQuality} />
                  <ScoreDim label="音频" value={(data.aiScore as any).audioMatch} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Lightbox 放大预览 */}
      {lightboxSrc && (
        <div
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            inset: 0,
            background: theme.chrome.lightboxOverlay,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <img
            src={lightboxSrc}
            alt="预览"
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: `0 0 40px ${theme.chrome.shadow}`,
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}

// ─── 子组件 ────────────────────────────────────────────────

function TypeIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    script: '📄', asset: '📦', storyboard: '🎬', video: '🎥',
  }
  return <span style={{ fontSize: 18 }}>{icons[type] ?? '📦'}</span>
}

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = {
    idle: '待处理', pending: '等待中', running: '生成中',
    success: '完成', error: '失败', cached: '已缓存',
  }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      background: stateColors[state],
      color: theme.text.onAccent,
      fontWeight: 600,
    }}>
      {labels[state]}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: theme.text.secondary,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: 8,
      marginTop: 16,
    }}>
      {children}
    </div>
  )
}

function ScriptDetail({ data }: { data: ScriptNodeData }) {
  return (
    <>
      <SectionLabel>剧本内容</SectionLabel>
      <div style={{
        background: theme.bg.input,
        borderRadius: 8,
        padding: 16,
        color: theme.text.primary,
        fontSize: 13,
        lineHeight: 1.8,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: '60vh',
        overflowY: 'auto',
      }}>
        {(data.content as string) || '暂无剧本内容'}
      </div>
    </>
  )
}

function AssetDetail({ data, onImageClick }: { data: AssetNodeData; onImageClick: (src: string) => void }) {
  const typeLabels: Record<string, string> = {
    role: '角色', tool: '道具', scene: '场景', clip: '片段',
  }
  const fullImageUrl = (data.filePath as string) || (data.thumbnailUrl as string) || null

  return (
    <>
      {fullImageUrl && (
        <>
          <SectionLabel>资产图片</SectionLabel>
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              cursor: 'pointer',
              border: `1px solid ${theme.border.default}`,
              marginBottom: 12,
            }}
            onClick={() => onImageClick(fullImageUrl)}
          >
            <img
              src={fullImageUrl}
              alt={data.label as string}
              style={{
                width: '100%',
                display: 'block',
                maxHeight: 400,
                objectFit: 'contain',
                background: theme.bg.image,
              }}
            />
          </div>
        </>
      )}

      <SectionLabel>资产类型</SectionLabel>
      <span style={{
        padding: '4px 12px',
        borderRadius: 6,
        background: theme.bg.surface,
        color: theme.node.script,
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-block',
      }}>
        {typeLabels[data.assetType as string] ?? data.assetType as string}
      </span>

      {(data.prompt as string) && (
        <>
          <SectionLabel>Prompt 描述</SectionLabel>
          <div style={{
            background: theme.bg.input,
            borderRadius: 8,
            padding: 12,
            color: theme.text.primary,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {data.prompt as string}
          </div>
        </>
      )}
    </>
  )
}

function StoryboardDetail({ data, onImageClick }: { data: StoryboardNodeData; onImageClick: (src: string) => void }) {
  const fullImageUrl = (data.filePath as string) || (data.thumbnailUrl as string) || null

  return (
    <>
      {fullImageUrl && (
        <>
          <SectionLabel>分镜图</SectionLabel>
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              cursor: 'pointer',
              border: `1px solid ${theme.border.default}`,
              marginBottom: 12,
            }}
            onClick={() => onImageClick(fullImageUrl)}
          >
            <img
              src={fullImageUrl}
              alt={data.label as string}
              style={{
                width: '100%',
                display: 'block',
                maxHeight: 400,
                objectFit: 'contain',
                background: theme.bg.image,
              }}
            />
          </div>
        </>
      )}

      <SectionLabel>时长</SectionLabel>
      <div style={{ color: theme.text.primary, fontSize: 13 }}>
        {data.duration as number}秒
      </div>

      {(data.prompt as string) && (
        <>
          <SectionLabel>Prompt 描述</SectionLabel>
          <div style={{
            background: theme.bg.input,
            borderRadius: 8,
            padding: 12,
            color: theme.text.primary,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {data.prompt as string}
          </div>
        </>
      )}

      {Array.isArray(data.linkedAssetIds) && (data.linkedAssetIds as number[]).length > 0 && (
        <>
          <SectionLabel>关联资产</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(data.linkedAssetIds as number[]).map((aid) => (
              <span key={aid} style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: theme.bg.surface,
                color: theme.node.script,
                fontSize: 12,
                fontWeight: 600,
              }}>
                资产 #{aid}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function VideoDetail({ data }: { data: VideoNodeData }) {
  const videoSrc = data.filePath ? `/oss/${data.filePath}` : null

  return (
    <>
      {videoSrc && (
        <>
          <SectionLabel>视频播放</SectionLabel>
          <video
            controls
            autoPlay
            style={{
              width: '100%',
              borderRadius: 8,
              background: theme.bg.image,
              border: `1px solid ${theme.border.default}`,
            }}
            poster={data.thumbnailUrl as string | undefined}
          >
            <source src={videoSrc} type="video/mp4" />
            浏览器不支持视频播放
          </video>
        </>
      )}

      {data.duration != null && (
        <>
          <SectionLabel>时长</SectionLabel>
          <div style={{ color: theme.text.primary, fontSize: 13 }}>
            {data.duration as number}秒
          </div>
        </>
      )}

      <SectionLabel>生成状态</SectionLabel>
      <StateBadge state={data.state as NodeState} />
    </>
  )
}

function ReviewStatusBadge({ status }: { status: ReviewStatus | undefined }) {
  if (!status) return null
  const config: Record<string, { label: string; bg: string }> = {
    awaiting_audit: { label: '待审核', bg: theme.status.awaiting },
    approved: { label: '已通过', bg: theme.status.approved },
    rejected: { label: '已驳回', bg: theme.status.rejected },
  }
  const c = config[status]
  if (!c) return null
  return (
    <span style={{
      padding: '2px 10px',
      borderRadius: 4,
      fontSize: 11,
      background: c.bg,
      color: theme.text.onAccent,
      fontWeight: 600,
    }}>
      {c.label}
    </span>
  )
}

function ScoreDim({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null
  const pct = Math.round(value * 100)
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
      minWidth: 50,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: getScoreColor(value) }}>{pct}</span>
      <span style={{ fontSize: 10, color: theme.text.secondary }}>{label}</span>
    </div>
  )
}
