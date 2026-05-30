import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { NodeState } from '../types/canvas'

interface UseCanvasSocketOptions {
  projectId: number
  onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => void
  onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => void
  onNewAsset: (nodeId: string, data: Record<string, unknown>) => void
}

/**
 * Socket.IO 实时画布更新 hook
 * 连接到现有 /ws/projects 命名空间，接收项目级推送
 */
export function useCanvasSocket(options: UseCanvasSocketOptions) {
  const { projectId, onNodeStateChange, onNodePreviewUpdate, onNewAsset } = options
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // 使用 ref 持有回调以避免重连
  const callbacksRef = useRef({ onNodeStateChange, onNodePreviewUpdate, onNewAsset })
  callbacksRef.current = { onNodeStateChange, onNodePreviewUpdate, onNewAsset }

  useEffect(() => {
    if (!projectId) {
      setConnected(false)
      return
    }
    // 连接到现有 /ws/projects 命名空间
    const socket = io('/ws/projects', {
      query: { projectId: String(projectId) },
      transports: ['websocket', 'polling'],
      forceNew: false,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[Canvas Socket] 已连接')
      setConnected(true)
    })

    socket.on('disconnect', () => {
      console.log('[Canvas Socket] 断开连接')
      setConnected(false)
    })

    // 节点状态变更
    socket.on('node:state', (payload: { nodeId: string; state: NodeState; progress?: number }) => {
      callbacksRef.current.onNodeStateChange(payload.nodeId, payload.state, payload.progress)
    })

    // 节点预览图更新
    socket.on('node:preview', (payload: { nodeId: string; thumbnailUrl: string }) => {
      callbacksRef.current.onNodePreviewUpdate(payload.nodeId, payload.thumbnailUrl)
    })

    // 新资产生成完成
    socket.on('node:created', (payload: { nodeId: string; data: Record<string, unknown> }) => {
      callbacksRef.current.onNewAsset(payload.nodeId, payload.data)
    })

    // 执行进度
    socket.on('execution:progress', (payload: { nodeId: string; state: NodeState; progress: number }) => {
      callbacksRef.current.onNodeStateChange(payload.nodeId, payload.state, payload.progress)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [projectId])

  // 向服务端发送事件
  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data)
  }, [])

  return { connected, emit }
}
