import { useState, type JSX } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { AssetNodeData, StoryboardNodeData, VideoNodeData } from '../types/canvas'
import { executeNode, approveNode, rejectNode } from '../services/canvasApi'

interface CanvasContextMenuProps {
  x: number
  y: number
  nodeId?: string
  onClose: () => void
  projectId: number
  episodesId: number
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
}

type MenuItem = {
  label: string
  icon: string
  action: () => void
  danger?: boolean
}

export default function CanvasContextMenu({
  x, y, nodeId, onClose, projectId, episodesId, setNodes, setEdges,
}: CanvasContextMenuProps) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

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
    } catch (err) {
      console.error('执行节点失败:', err)
    }
    onClose()
  }

  const handleAddAsset = () => {
    const id = `asset-${Date.now()}`
    const data: AssetNodeData = {
      label: '新资产', type: 'asset', assetType: 'role', assetId: 0,
      prompt: '', thumbnailUrl: null, state: 'idle',
    }
    setNodes((nds) => [...nds, {
      id, type: 'asset', position: { x: x + 400, y }, data,
    }])
    onClose()
  }

  const handleAddStoryboard = () => {
    const id = `storyboard-${Date.now()}`
    const data: StoryboardNodeData = {
      label: '新分镜', type: 'storyboard', storyboardId: 0, duration: 3,
      prompt: '', thumbnailUrl: null, state: 'idle', linkedAssetIds: [],
    }
    setNodes((nds) => [...nds, {
      id, type: 'storyboard', position: { x: x + 400, y }, data,
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
      id, type: 'video', position: { x: x + 400, y }, data,
    }])
    onClose()
  }

  const handleApprove = async () => {
    if (!nodeId) return
    try {
      await approveNode(projectId, episodesId, nodeId)
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'approved' } } : n
      ))
    } catch (err) {
      console.error('审核通过失败:', err)
    }
    onClose()
  }

  const handleReject = async () => {
    if (!nodeId || !rejectReason.trim()) return
    try {
      await rejectNode(projectId, episodesId, nodeId, rejectReason.trim())
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'rejected' } } : n
      ))
    } catch (err) {
      console.error('驳回失败:', err)
    }
    onClose()
  }

  const items: MenuItem[] = []

  if (nodeId) {
    items.push(
      { label: '执行节点', icon: '▶', action: handleExecute },
      { label: '删除节点', icon: '🗑', action: handleDelete, danger: true },
    )
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
        background: '#1e1e2e',
        border: '1px solid #313244',
        borderRadius: 8,
        padding: 4,
        minWidth: 160,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}
    >
      {items.map((item, i) => {
        if (item.label === '---') {
          return <div key={i} style={{ height: 1, background: '#313244', margin: '4px 0' }} />
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
              color: item.danger ? '#f38ba8' : '#cdd6f4',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = '#313244'
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
          <div style={{ height: 1, background: '#45475a', margin: '4px 0' }} />
          <div style={{ padding: '4px 12px 2px', fontSize: 11, color: '#a6adc8', fontWeight: 600 }}>
            📋 审核操作
          </div>
          <div
            onClick={handleApprove}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              color: '#a6e3a1',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = '#313244'
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
                color: '#f38ba8',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = '#313244'
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
                  background: '#11111b',
                  border: '1px solid #45475a',
                  borderRadius: 4,
                  color: '#cdd6f4',
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
                    background: rejectReason.trim() ? '#f38ba8' : '#45475a',
                    color: '#1e1e2e',
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
                    background: '#313244',
                    color: '#a6adc8',
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
