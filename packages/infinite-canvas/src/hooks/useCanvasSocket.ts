import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { NodeState, FlowBranch } from '../types/canvas'

interface UseCanvasSocketOptions {
  projectId: number
  onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => void
  onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => void
  onNewAsset: (nodeId: string, data: Record<string, unknown>) => void
  onBranchCreated?: (branch: FlowBranch) => void
  onReviewApproved?: (nodeId: string) => void
  onReviewRejected?: (nodeId: string, reason?: string) => void
}

export function useCanvasSocket(options: UseCanvasSocketOptions) {
  const { projectId, onNodeStateChange, onNodePreviewUpdate, onNewAsset, onBranchCreated, onReviewApproved, onReviewRejected } = options
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  const callbacksRef = useRef({
    onNodeStateChange,
    onNodePreviewUpdate,
    onNewAsset,
    onBranchCreated,
    onReviewApproved,
    onReviewRejected,
  })
  callbacksRef.current = {
    onNodeStateChange,
    onNodePreviewUpdate,
    onNewAsset,
    onBranchCreated,
    onReviewApproved,
    onReviewRejected,
  }

  useEffect(() => {
    if (!projectId) {
      setConnected(false)
      return
    }
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

    // 分支创建
    socket.on('branch:created', (payload: FlowBranch) => {
      callbacksRef.current.onBranchCreated?.(payload)
    })

    // 分支更新
    socket.on('branch:updated', (payload: FlowBranch) => {
      // branch updates are handled through onBranchCreated callback with updated data
      callbacksRef.current.onBranchCreated?.(payload)
    })

    // 审核通过
    socket.on('review:approved', (payload: { nodeId: string }) => {
      callbacksRef.current.onReviewApproved?.(payload.nodeId)
    })

    // 审核驳回
    socket.on('review:rejected', (payload: { nodeId: string; reason?: string }) => {
      callbacksRef.current.onReviewRejected?.(payload.nodeId, payload.reason)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [projectId])

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data)
  }, [])

  return { connected, emit }
}
