import { useState, useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { ScriptNodeData, AssetNodeData, StoryboardNodeData, VideoNodeData, NodeState } from '../types/canvas'
import { stateColors } from '../utils/styles'

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
          background: '#181825',
          borderLeft: '1px solid #313244',
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
          borderBottom: '1px solid #313244',
          background: '#1e1e2e',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TypeIcon type={type} />
            <span style={{ color: '#cdd6f4', fontWeight: 600, fontSize: 14 }}>
              {data.label as string}
            </span>
            <StateBadge state={data.state as NodeState} />
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#a6adc8',
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#313244' }}
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
        </div>
      </div>

      {/* Lightbox 放大预览 */}
      {lightboxSrc && (
        <div
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
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
              boxShadow: '0 0 40px rgba(0,0,0,0.5)',
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
      color: '#1e1e2e',
      fontWeight: 600,
    }}>
      {labels[state]}
    </span>
  )
}

/** 分隔标签 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: '#a6adc8',
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

// ─── 剧本详情 ──────────────────────────────────────────────

function ScriptDetail({ data }: { data: ScriptNodeData }) {
  return (
    <>
      <SectionLabel>剧本内容</SectionLabel>
      <div style={{
        background: '#11111b',
        borderRadius: 8,
        padding: 16,
        color: '#cdd6f4',
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

// ─── 资产详情 ──────────────────────────────────────────────

function AssetDetail({ data, onImageClick }: { data: AssetNodeData; onImageClick: (src: string) => void }) {
  const typeLabels: Record<string, string> = {
    role: '角色', tool: '道具', scene: '场景', clip: '片段',
  }
  // 优先使用 filePath（原始高清图），回退到 thumbnailUrl
  const fullImageUrl = (data.filePath as string) || (data.thumbnailUrl as string) || null

  return (
    <>
      {/* 高清大图 */}
      {fullImageUrl && (
        <>
          <SectionLabel>资产图片</SectionLabel>
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              cursor: 'pointer',
              border: '1px solid #313244',
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
                background: '#11111b',
              }}
            />
          </div>
        </>
      )}

      {/* 资产类型 */}
      <SectionLabel>资产类型</SectionLabel>
      <span style={{
        padding: '4px 12px',
        borderRadius: 6,
        background: '#313244',
        color: '#89b4fa',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-block',
      }}>
        {typeLabels[data.assetType as string] ?? data.assetType as string}
      </span>

      {/* Prompt 描述 */}
      {(data.prompt as string) && (
        <>
          <SectionLabel>Prompt 描述</SectionLabel>
          <div style={{
            background: '#11111b',
            borderRadius: 8,
            padding: 12,
            color: '#cdd6f4',
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

// ─── 分镜详情 ──────────────────────────────────────────────

function StoryboardDetail({ data, onImageClick }: { data: StoryboardNodeData; onImageClick: (src: string) => void }) {
  // 优先使用 filePath（原始高清图），回退到 thumbnailUrl
  const fullImageUrl = (data.filePath as string) || (data.thumbnailUrl as string) || null

  return (
    <>
      {/* 高清分镜图 */}
      {fullImageUrl && (
        <>
          <SectionLabel>分镜图</SectionLabel>
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              cursor: 'pointer',
              border: '1px solid #313244',
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
                background: '#11111b',
              }}
            />
          </div>
        </>
      )}

      {/* 时长 */}
      <SectionLabel>时长</SectionLabel>
      <div style={{ color: '#cdd6f4', fontSize: 13 }}>
        {data.duration as number}秒
      </div>

      {/* Prompt 描述 */}
      {(data.prompt as string) && (
        <>
          <SectionLabel>Prompt 描述</SectionLabel>
          <div style={{
            background: '#11111b',
            borderRadius: 8,
            padding: 12,
            color: '#cdd6f4',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {data.prompt as string}
          </div>
        </>
      )}

      {/* 关联资产 */}
      {Array.isArray(data.linkedAssetIds) && (data.linkedAssetIds as number[]).length > 0 && (
        <>
          <SectionLabel>关联资产</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(data.linkedAssetIds as number[]).map((aid) => (
              <span key={aid} style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: '#313244',
                color: '#89b4fa',
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

// ─── 视频详情 ──────────────────────────────────────────────

function VideoDetail({ data }: { data: VideoNodeData }) {
  const videoSrc = data.filePath ? `/oss/${data.filePath}` : null

  return (
    <>
      {/* 视频播放器 */}
      {videoSrc && (
        <>
          <SectionLabel>视频播放</SectionLabel>
          <video
            controls
            autoPlay
            style={{
              width: '100%',
              borderRadius: 8,
              background: '#11111b',
              border: '1px solid #313244',
            }}
            poster={data.thumbnailUrl as string | undefined}
          >
            <source src={videoSrc} type="video/mp4" />
            浏览器不支持视频播放
          </video>
        </>
      )}

      {/* 时长 */}
      {data.duration != null && (
        <>
          <SectionLabel>时长</SectionLabel>
          <div style={{ color: '#cdd6f4', fontSize: 13 }}>
            {data.duration as number}秒
          </div>
        </>
      )}

      {/* 生成状态 */}
      <SectionLabel>生成状态</SectionLabel>
      <StateBadge state={data.state as NodeState} />
    </>
  )
}
