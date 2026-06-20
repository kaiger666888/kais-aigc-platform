import { useState, useCallback, useRef, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { ScriptNodeData, AssetNodeData, StoryboardNodeData, VideoNodeData, NodeState, ReviewStatus, CameraMovement, Framing, Composition, Pacing } from '../types/canvas'
import { stateColors } from '../utils/styles'
import { theme, getScoreColor } from '../theme/catppuccin'
import { METADATA_LABELS, METADATA_FIELD_ORDER } from '../constants'
import { useCanvasStore } from '../store/canvasStore'
import FileViewer from './FileViewer'
import ReviewCard from './ReviewCard'

type NodeData = ScriptNodeData | AssetNodeData | StoryboardNodeData | VideoNodeData

interface Props {
  node: Node | null
  onClose: () => void
}

/** 节点详情侧边栏面板 */
export default function NodeDetailPanel({ node, onClose }: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    // 75% of window width
    const w = typeof window !== 'undefined' ? window.innerWidth * 0.75 : 960
    return Math.max(400, w)
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setLightboxSrc(null)
  }, [])

  // Drag to resize
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - e.clientX
      const newW = Math.max(400, dragRef.current.startW + delta)
      setPanelWidth(newW)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  if (!node) return null

  const data = node.data as NodeData
  const type = (data.type as string) || (node.type as string)

  return (
    <>
      {/* Drag handle */}
      <div
        onMouseDown={(e) => {
          dragRef.current = { startX: e.clientX, startW: panelWidth }
          setDragging(true)
        }}
        style={{
          position: 'absolute',
          top: 0,
          right: panelWidth,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          background: dragging ? theme.border.subtle : 'transparent',
          zIndex: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{
          width: 3,
          height: 40,
          borderRadius: 2,
          background: dragging ? theme.node.script : theme.border.dim,
          opacity: dragging ? 1 : 0.5,
        }} />
      </div>
      <div
        data-testid="detail-panel"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: panelWidth,
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
          {type === 'script' && (data as any).category === 'variant_group' && (
              <VariantGroupDetail node={node} />
            )}
            {type === 'script' && (data as any).category !== 'variant_group' && <ScriptDetail data={data as ScriptNodeData} />}
          {type === 'asset' && (
            <AssetDetail
              data={data as AssetNodeData}
              onImageClick={(src) => setLightboxSrc(src)}
            />
          )}
          {type === 'storyboard' && (
            <StoryboardDetail
              nodeId={node.id}
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

          {/* Review card for awaiting_audit nodes */}
          {(data.reviewStatus as string) === 'awaiting_audit' && (
            <div style={{ marginBottom: 16 }}>
              <ReviewCard
                filePath={(data.filePath as string) || undefined}
                nodeId={node.id}
              />
            </div>
          )}

          {/* File viewer/editor */}
          <FileViewer filePath={(data.filePath as string) || (data.content as string)?.match(/output\//)?.[0] ? (data.filePath as string) : undefined} />
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
  const description = (data.description as string) || (data.content as string) || ''
  const tags = (data.tags as string[]) || []
  const score = data.score as number | undefined
  const filePath = data.filePath as string | undefined
  const phase = data.phase as string | undefined

  const phaseLabels: Record<string, string> = {
    research: '🔍 研究阶段',
    story: '📖 故事阶段',
    production: '🎬 制作阶段',
    post: '🎚️ 后期阶段',
  }

  return (
    <>
      {/* Phase badge */}
      {phase && (
        <>
          <SectionLabel>所属阶段</SectionLabel>
          <span style={{
            padding: '4px 12px',
            borderRadius: 6,
            background: phase === 'research' ? 'rgba(148,226,213,0.15)' :
                       phase === 'story' ? 'rgba(203,166,247,0.15)' :
                       phase === 'production' ? 'rgba(250,179,135,0.15)' :
                       theme.bg.surface,
            color: phase === 'research' ? theme.node.asset :
                   phase === 'story' ? theme.node.script :
                   phase === 'production' ? '#fab387' :
                   theme.text.primary,
            fontSize: 12,
            fontWeight: 600,
            display: 'inline-block',
            marginBottom: 8,
          }}>
            {phaseLabels[phase] || phase}
          </span>
        </>
      )}

      {/* Score */}
      {score != null && (
        <>
          <SectionLabel>评分</SectionLabel>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 28,
              fontWeight: 800,
              color: score >= 9 ? theme.state.success : score >= 7 ? theme.state.pending : theme.state.error,
            }}>
              {score}
            </span>
            <span style={{ fontSize: 12, color: theme.text.secondary }}>/ 10</span>
          </div>
        </>
      )}

      {/* Description */}
      {description && (
        <>
          <SectionLabel>详细描述</SectionLabel>
          <div style={{
            background: theme.bg.input,
            borderRadius: 8,
            padding: 16,
            color: theme.text.primary,
            fontSize: 13,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '40vh',
            overflowY: 'auto',
          }}>
            {description}
          </div>
        </>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <>
          <SectionLabel>标签</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag, i) => (
              <span key={i} style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: theme.bg.surface,
                color: theme.node.script,
                fontSize: 12,
                fontWeight: 500,
              }}>
                {tag}
              </span>
            ))}
          </div>
        </>
      )}

      {/* File path */}
      {filePath && (
        <>
          <SectionLabel>产出文件</SectionLabel>
          <div style={{
            background: theme.bg.input,
            borderRadius: 6,
            padding: '8px 12px',
            color: theme.text.secondary,
            fontSize: 12,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            📎 {filePath}
          </div>
        </>
      )}
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

function StoryboardDetail({ nodeId, data, onImageClick }: { nodeId: string; data: StoryboardNodeData; onImageClick: (src: string) => void }) {
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

      {/* Phase 35 — 镜头意图元数据编辑器 */}
      <SectionLabel>镜头意图</SectionLabel>
      <MetadataEditor nodeId={nodeId} data={data} />

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

const METADATA_FIELD_LABELS: Record<typeof METADATA_FIELD_ORDER[number], string> = {
  cameraMovement: '运镜',
  framing: '景别',
  composition: '构图',
  pacing: '节奏',
}

function MetadataEditor({ nodeId, data }: { nodeId: string; data: StoryboardNodeData }) {
  const setNodes = useCanvasStore((s) => s.setNodes)

  const setField = (field: typeof METADATA_FIELD_ORDER[number], value: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, [field]: value || undefined } }
        : n,
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {METADATA_FIELD_ORDER.map((field) => {
        const labels = METADATA_LABELS[field]
        const currentValue = data[field] as string | undefined
        return (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 36 }}>
              {METADATA_FIELD_LABELS[field]}
            </span>
            <select
              value={currentValue ?? ''}
              onChange={(e) => setField(field, e.target.value)}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 6,
                background: theme.bg.input,
                border: `1px solid ${theme.border.subtle}`,
                color: theme.text.primary,
                fontSize: 12,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="">— 未设置 —</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
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

// ─── Variant Group Detail (候选列表审核) ────────────────────

function VariantGroupDetail({ node }: { node: Node }) {
  const data = node.data as any
  const candidates = (data.candidates as any[]) || []
  const groupLabel = (data.label as string) || '候选列表'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const allNodes = useCanvasStore((s) => s.nodes)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  // variantGroups 暂不使用，candidates 已从节点 data 中直接获取

  // 从 store 中查找属于该 variantGroup 的节点
  let resolvedCandidates = candidates
  if (resolvedCandidates.length === 0) {
    // 从节点 data 中找 variantNodeIds
    const vgIds = data.variantNodeIds as string[] | undefined
    if (vgIds && vgIds.length > 0) {
      resolvedCandidates = allNodes
        .filter((n: any) => vgIds.includes(n.id))
        .map((n: any) => ({ id: n.id, ...n.data }))
    }
  }

  const selectedCandidate = selectedId
    ? resolvedCandidates.find((c: any) => c.id === selectedId || (c as any).nodeId === selectedId)
    : null

  return (
    <>
      <SectionLabel>{groupLabel}</SectionLabel>
      <div style={{
        fontSize: 12,
        color: theme.text.secondary,
        marginBottom: 12,
      }}>
        共 {resolvedCandidates.length} 个候选，点击选择最佳方案
      </div>

      {/* 候选列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {resolvedCandidates.map((c: any, i: number) => {
          const isSelected = selectedId === c.id
          const score = c.score as number | undefined
          return (
            <div
              key={c.id || i}
              onClick={() => setSelectedId(isSelected ? null : (c.id as string))}
              style={{
                background: isSelected ? theme.bg.card : theme.bg.surface,
                border: `2px solid ${isSelected ? theme.node.script : 'transparent'}`,
                borderRadius: 8,
                padding: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {/* 候选标题行 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: theme.text.disabled,
                  minWidth: 24,
                }}>#{i + 1}</span>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: theme.text.primary,
                  flex: 1,
                }}>{(c.label as string) || `候选 ${i + 1}`}</span>
                {score != null && (
                  <span style={{
                    padding: '1px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    background: score >= 9 ? theme.state.success : score >= 7 ? theme.state.pending : theme.state.error,
                    color: theme.text.onAccent,
                  }}>⭐ {score}</span>
                )}
              </div>

              {/* 简要描述 */}
              {c.description && (
                <div style={{
                  fontSize: 11,
                  color: theme.text.secondary,
                  lineHeight: 1.5,
                  marginLeft: 32,
                  maxHeight: isSelected ? 'none' : 40,
                  overflow: 'hidden',
                }}>
                  {(c.description as string).length > (isSelected ? 999 : 80)
                    ? (c.description as string).slice(0, 80) + '…'
                    : c.description}
                </div>
              )}

              {/* 标签 */}
              {c.tags && Array.isArray(c.tags) && c.tags.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginLeft: 32,
                  marginTop: 6,
                }}>
                  {(c.tags as string[]).map((tag, ti) => (
                    <span key={ti} style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      fontSize: 10,
                      background: theme.bg.panel,
                      color: theme.node.script,
                      fontWeight: 500,
                    }}>{tag}</span>
                  ))}
                </div>
              )}

              {/* 展开后详情 */}
              {isSelected && (
                <div style={{
                  marginLeft: 32,
                  marginTop: 8,
                  padding: 10,
                  background: theme.bg.panel,
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: theme.text.secondary,
                }}>
                  {c.topic_kernel && <div><strong style={{color: theme.text.primary}}>核心命题：</strong>{c.topic_kernel}</div>}
                  {c.highlight && <div style={{marginTop: 4}}><strong style={{color: theme.text.primary}}>亮点：</strong>{c.highlight}</div>}
                  {c.emotional_resonance && <div style={{marginTop: 4}}><strong style={{color: theme.text.primary}}>情绪维度：</strong>{c.emotional_resonance}</div>}
                  {c.safety_score != null && <div style={{marginTop: 4}}><strong style={{color: theme.text.primary}}>安全分：</strong>{c.safety_score}/10</div>}
                  {c.genre_tag && <div style={{marginTop: 4}}><strong style={{color: theme.text.primary}}>类型：</strong>{c.genre_tag}</div>}
                  {/* 剧集详情展示 */}
                  {Array.isArray(c.episodes) && c.episodes.length > 0 && (
                    <div style={{marginTop: 10, borderTop: `1px solid ${theme.border.dim}`, paddingTop: 8}}>
                      <strong style={{color: theme.text.primary}}>📖 剧集预览 ({c.episodes.length}集)</strong>
                      {c.episodes.map((ep: any, ei: number) => (
                        <div key={ei} style={{
                          marginTop: 8,
                          padding: 8,
                          background: theme.bg.surface,
                          borderRadius: 6,
                          border: `1px solid ${theme.border.dim}`,
                        }}>
                          <div style={{fontWeight: 600, color: theme.text.primary, fontSize: 12}}>
                            {ep.ep || `EP${ei+1}`}: {ep.title}
                          </div>
                          {ep.logline && <div style={{marginTop: 2, color: theme.text.secondary}}>{ep.logline}</div>}
                          {ep.fantasy && (
                            <div style={{marginTop: 4, color: theme.text.secondary}}>
                              <strong style={{color: theme.text.primary}}>✨ 奇幻:</strong> {ep.fantasy.length > 120 ? ep.fantasy.slice(0, 120) + '…' : ep.fantasy}
                            </div>
                          )}
                          {ep.signature_shot && (
                            <div style={{marginTop: 2, color: theme.text.secondary}}>
                              <strong style={{color: theme.text.primary}}>🎬 定格:</strong> {ep.signature_shot.length > 120 ? ep.signature_shot.slice(0, 120) + '…' : ep.signature_shot}
                            </div>
                          )}
                          {ep.hook_ending && (
                            <div style={{marginTop: 2, color: theme.text.secondary}}>
                              <strong style={{color: theme.text.primary}}>🪝 钩子:</strong> {ep.hook_ending.length > 100 ? ep.hook_ending.slice(0, 100) + '…' : ep.hook_ending}
                            </div>
                          )}
                          {ep.plot_twist && (
                            <div style={{marginTop: 2, color: theme.text.secondary}}>
                              <strong style={{color: theme.text.primary}}>🔄 反转:</strong> {ep.plot_twist.length > 100 ? ep.plot_twist.slice(0, 100) + '…' : ep.plot_twist}
                            </div>
                          )}
                          {Array.isArray(ep.scenes) && ep.scenes.length > 0 && (
                            <div style={{marginTop: 4}}>
                              <strong style={{color: theme.text.primary}}>🎬 场景 ({ep.scenes.length}):</strong>
                              {ep.scenes.slice(0, 3).map((sc: any, si: number) => (
                                <div key={si} style={{
                                  marginTop: 2,
                                  paddingLeft: 8,
                                  borderLeft: `2px solid ${theme.border.dim}`,
                                  color: theme.text.secondary,
                                  fontSize: 10,
                                  lineHeight: 1.5,
                                }}>
                                  {typeof sc === 'string' ? sc.slice(0, 100) + '…' : (sc.content || '').slice(0, 100) + '…'}
                                </div>
                              ))}
                              {ep.scenes.length > 3 && <div style={{color: theme.text.disabled, fontSize: 10, marginTop: 2}}>...还有 {ep.scenes.length - 3} 场</div>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 操作按钮 */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginTop: 16,
      }}>
        <button
          disabled={!selectedId || confirming || confirmed}
          onClick={async () => {
            if (!selectedId || !projectId || !episodesId) return
            setConfirming(true)
            try {
              const { approveNode } = await import('../services/canvasApi')
              await approveNode(projectId, episodesId, node.id, selectedId)
              setConfirmed(true)
              showToast(`已确认选择: ${selectedId}`, 'success')
            } catch (err: any) {
              showToast(err.message || '确认失败', 'error')
            } finally {
              setConfirming(false)
            }
          }}
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: selectedId && !confirming && !confirmed ? 'pointer' : 'not-allowed',
            background: confirmed ? theme.state.success : (selectedId ? theme.state.success : theme.bg.surface),
            color: selectedId ? theme.text.onAccent : theme.text.disabled,
            opacity: selectedId ? 1 : 0.5,
          }}
        >
          {confirming ? '⏳ 确认中...' : confirmed ? '✅ 已确认' : '✅ 确认选择'}
        </button>
        <button
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            background: theme.bg.surface,
            color: theme.text.secondary,
          }}
        >
          🔄 重做
        </button>
      </div>
    </>
  )
}
