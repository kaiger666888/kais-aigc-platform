import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { NodeState, FlowBranch } from '../types/canvas'

export interface OrchestrateStartPayload {
  runId: string
  total: number
  mode: 'full' | 'batch'
}
export interface OrchestrateProgressPayload {
  runId: string
  completed: number
  total: number
  failed: number
  currentNodeId: string
  mode: 'full' | 'batch'
}
export interface OrchestrateDonePayload {
  runId: string
  completed: number
  total: number
  failed: number
  failedNodes: string[]
  mode: 'full' | 'batch'
}

export interface CanvasEventPayload {
  eventId: number
  type: 'node_upsert' | 'node_delete' | 'link_upsert' | 'link_delete'
      | 'branch_upsert' | 'branch_delete' | 'variant_group_upsert'
      | 'review_status' | 'bootstrap'
  nodeId?: string
  payload: unknown
  projectId: number
  episodesId: number
  createdAt?: number
}

interface UseCanvasSocketOptions {
  projectId: number
  episodesId?: number
  onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => void
  onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => void
  onNewAsset: (nodeId: string, data: Record<string, unknown>) => void
  onOrchestrateStart?: (payload: OrchestrateStartPayload) => void
  onOrchestrateProgress?: (payload: OrchestrateProgressPayload) => void
  onOrchestrateDone?: (payload: OrchestrateDonePayload) => void
  onBranchCreated?: (branch: FlowBranch) => void
  onReviewApproved?: (nodeId: string) => void
  onReviewRejected?: (nodeId: string, reason?: string) => void
  onGraphSaved?: (payload: { projectId: number; episodesId: number; timestamp: number }) => void
  // Phase 41 SYNC-10: feature-flagged incremental event subscription
  onCanvasEvent?: (event: CanvasEventPayload) => void
  onCanvasReset?: (info: { lastEventId: number | null }) => void
}

export function useCanvasSocket(options: UseCanvasSocketOptions) {
  const {
    projectId,
    episodesId,
    onNodeStateChange,
    onNodePreviewUpdate,
    onNewAsset,
    onOrchestrateStart,
    onOrchestrateProgress,
    onOrchestrateDone,
    onBranchCreated,
    onReviewApproved,
    onReviewRejected,
    onGraphSaved,
    onCanvasEvent,
    onCanvasReset,
  } = options
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const lastEventIdRef = useRef<number | null>(null)

  const eventReplayEnabled =
    import.meta.env.VITE_CANVAS_EVENT_REPLAY === '1' && !!onCanvasEvent

  // 使用 ref 持有回调以避免重连
  const callbacksRef = useRef({
    onNodeStateChange, onNodePreviewUpdate, onNewAsset,
    onOrchestrateStart, onOrchestrateProgress, onOrchestrateDone,
    onBranchCreated, onReviewApproved, onReviewRejected,
    onGraphSaved, onCanvasEvent, onCanvasReset,
  })
  callbacksRef.current = {
    onNodeStateChange, onNodePreviewUpdate, onNewAsset,
    onOrchestrateStart, onOrchestrateProgress, onOrchestrateDone,
    onBranchCreated, onReviewApproved, onReviewRejected,
    onGraphSaved, onCanvasEvent, onCanvasReset,
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
      // Phase 41 SYNC-07: 重连/首次连接时补发增量
      if (eventReplayEnabled && episodesId !== undefined) {
        socket.emit('subscribe', {
          projectId,
          episodesId,
          since: lastEventIdRef.current ?? undefined,
        })
      }
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

    // Phase 36/37 — 编排事件
    socket.on('orchestrate:start', (payload: OrchestrateStartPayload) => {
      callbacksRef.current.onOrchestrateStart?.(payload)
    })
    socket.on('orchestrate:progress', (payload: OrchestrateProgressPayload) => {
      callbacksRef.current.onOrchestrateProgress?.(payload)
    })
    socket.on('orchestrate:done', (payload: OrchestrateDonePayload) => {
      callbacksRef.current.onOrchestrateDone?.(payload)
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

    // 全图保存(pipeline 通过 /api/canvas/v2/save-v2 写入)— 触发前端重新加载
    socket.on('graph:saved', (payload: { projectId: number; episodesId: number; timestamp: number }) => {
      callbacksRef.current.onGraphSaved?.(payload)
    })

    // Phase 41 SYNC-08: 增量事件 — 仅在 feature flag 开启时生效
    if (eventReplayEnabled) {
      socket.on('canvas:event', (event: CanvasEventPayload) => {
        if (typeof event?.eventId === 'number') {
          lastEventIdRef.current = event.eventId
        }
        callbacksRef.current.onCanvasEvent?.(event)
      })
      socket.on('canvas:reset', (info: { lastEventId: number | null }) => {
        if (typeof info?.lastEventId === 'number') {
          lastEventIdRef.current = info.lastEventId
        }
        callbacksRef.current.onCanvasReset?.(info)
      })
    }

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [projectId, eventReplayEnabled, episodesId])

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data)
  }, [])

  return { connected, emit }
}
