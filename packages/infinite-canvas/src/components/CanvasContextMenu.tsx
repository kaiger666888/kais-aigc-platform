import { useState, type JSX } from 'react'
import type { AssetNodeData, StoryboardNodeData, VideoNodeData } from '../types/canvas'
import { executeNode, approveNode, rejectNode, requestNodeScore } from '../services/canvasApi'
import { useCanvasStore } from '../store/canvasStore'
import { theme } from '../theme/catppuccin'
import { LAYOUT } from '../constants'

interface CanvasContextMenuProps {
  x: number
  y: number
  nodeId?: string
  onClose: () => void
  projectId: number
  episodesId: number
}

type MenuItem = {
  label: string
  icon: string
  action: () => void
  danger?: boolean
}

export default function CanvasContextMenu({
  x, y, nodeId, onClose, projectId, episodesId,
}: CanvasContextMenuProps) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const setNodes = useCanvasStore((s) => s.setNodes)
  const setEdges = useCanvasStore((s) => s.setEdges)
  const showToast = useCanvasStore((s) => s.showToast)
  const selectWinner = useCanvasStore((s) => s.selectWinner)

  const handleDelete = () => {
    if (!nodeId) return
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    onClose()
  }

  const handleExecute = async () => {
    if (!nodeId) return
    try {
      const nodeType = nodeId.split('-')[0]
      await executeNode(projectId, episodesId, nodeId, nodeType)
      showToast('节点执行已触发', 'success')
    } catch (err: any) {
      showToast(err.message || '执行节点失败', 'error')
    }
    onClose()
  }

  const handleAddAsset = () => {
    const id = `asset-${Date.now()}`
    const data: AssetNodeData = {
      label: '新资产', type: 'asset', assetType: 'role', assetId: 0,
      prompt: '', filePath: null, thumbnailUrl: null, state: 'idle',
    }
    setNodes((nds) => [...nds, {
      id, type: 'asset', position: { x: x + LAYOUT.CONTEXT_MENU_ADD_OFFSET_X, y }, data,
    }])
    onClose()
  }

  const handleAddStoryboard = () => {
    const id = `storyboard-${Date.now()}`
    const data: StoryboardNodeData = {
      label: '新分镜', type: 'storyboard', storyboardId: 0, duration: 3,
      prompt: '', filePath: null, thumbnailUrl: null, state: 'idle', linkedAssetIds: [],
    }
    setNodes((nds) => [...nds, {
      id, type: 'storyboard', position: { x: x + LAYOUT.CONTEXT_MENU_ADD_OFFSET_X, y }, data,
    }])
    onClose()
  }

  const handleAddVideo = () => {
    const id = `video-${Date.now()}`
    const data: VideoNodeData = {
      label: '新视频', type: 'video', videoId: 0,
      filePath: null, thumbnailUrl: null, state: 'idle',
    }
    setNodes((nds) => [...nds, {
      id, type: 'video', position: { x: x + LAYOUT.CONTEXT_MENU_ADD_OFFSET_X, y }, data,
    }])
    onClose()
  }

  const handleApprove = async () => {
    if (!nodeId) return
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
    ))
    onClose()
    try {
      await approveNode(projectId, episodesId, nodeId)
      showToast('审核通过', 'success')
    } catch (err: any) {
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'awaiting_audit' } } : n
      ))
      showToast(err.message || '审核通过失败', 'error')
    }
  }

  const handleReject = async () => {
    if (!nodeId || !rejectReason.trim()) return
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
    ))
    onClose()
    try {
      await rejectNode(projectId, episodesId, nodeId, rejectReason.trim())
      showToast('已驳回', 'warning')
    } catch (err: any) {
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'awaiting_audit' } } : n
      ))
      showToast(err.message || '驳回失败', 'error')
    }
  }

  const items: MenuItem[] = []

  if (nodeId) {
    items.push(
      { label: '执行节点', icon: '▶', action: handleExecute },
      { label: '删除节点', icon: '🗑', action: handleDelete, danger: true },
    )
    items.push({ label: '---', icon: '', action: () => {} })

    // AI 评分
    items.push({
      label: '🤖 AI 评分',
      icon: '🤖',
      action: async () => {
        showToast('正在 AI 评分...', 'info')
        try {
          const score = await requestNodeScore(projectId, episodesId, nodeId!)
          setNodes((nds) => nds.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, aiScore: score } } : n
          ))
          showToast(`AI 评分完成: 总分 ${score.overall}`, 'success')
        } catch (err: any) {
          showToast(`评分失败: ${err.message}`, 'error')
        }
        onClose()
      },
    })
    items.push({ label: '---', icon: '', action: () => {} })

    // 变体优胜选择
    items.push({
      label: '🏆 选为优胜',
      icon: '🏆',
      action: () => {
        selectWinner(nodeId)
        onClose()
      },
    })
    items.push({ label: '---', icon: '', action: () => {} })
  }

  items.push(
    { label: '添加资产节点', icon: '👤', action: handleAddAsset },
    { label: '添加分镜节点', icon: '🎬', action: handleAddStoryboard },
    { label: '添加视频节点', icon: '🎥', action: handleAddVideo },
  )

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 100,
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 8,
        padding: 4,
        minWidth: 160,
        boxShadow: `0 4px 12px ${theme.chrome.shadow}`,
      }}
    >
      {items.map((item, i) => {
        if (item.label === '---') {
          return <div key={i} style={{ height: 1, background: theme.border.default, margin: '4px 0' }} />
        }
        return (
          <div
            key={i}
            onClick={item.action}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              color: item.danger ? theme.status.rejected : theme.text.primary,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = theme.bg.surface
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = 'transparent'
            }}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        )
      })}

      {/* 审核操作区域 */}
      {nodeId && (
        <>
          <div style={{ height: 1, background: theme.border.subtle, margin: '4px 0' }} />
          <div style={{ padding: '4px 12px 2px', fontSize: 11, color: theme.text.secondary, fontWeight: 600 }}>
            📋 审核操作
          </div>
          <div
            onClick={handleApprove}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              color: theme.status.approved,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = theme.bg.surface
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = 'transparent'
            }}
          >
            <span>✅</span>
            <span>审核通过</span>
          </div>
          {!showRejectInput ? (
            <div
              onClick={() => setShowRejectInput(true)}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                color: theme.status.rejected,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = theme.bg.surface
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = 'transparent'
              }}
            >
              <span>❌</span>
              <span>驳回</span>
            </div>
          ) : (
            <div style={{ padding: '4px 8px' }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="输入驳回原因..."
                autoFocus
                style={{
                  width: '100%',
                  height: 60,
                  background: theme.bg.input,
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 4,
                  color: theme.text.primary,
                  fontSize: 11,
                  padding: 6,
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: rejectReason.trim() ? theme.button.danger : theme.border.subtle,
                    color: theme.text.onAccent,
                    fontSize: 11,
                    cursor: rejectReason.trim() ? 'pointer' : 'not-allowed',
                    fontWeight: 600,
                  }}
                >
                  确认驳回
                </button>
                <button
                  onClick={() => { setShowRejectInput(false); setRejectReason('') }}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: theme.button.ghost,
                    color: theme.text.secondary,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
