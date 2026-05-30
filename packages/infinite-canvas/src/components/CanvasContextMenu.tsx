import type { Node, Edge } from '@xyflow/react'
import type { AssetNodeData, StoryboardNodeData, VideoNodeData } from '../types/canvas'
import { executeNode } from '../services/canvasApi'

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
    </div>
  )
}
