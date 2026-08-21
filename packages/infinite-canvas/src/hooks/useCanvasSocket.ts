import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { NodeState, FlowBranch } from '../types/canvas'
// Phase 54-04 (D-03): gate:state payload 契约单一真值源在 gateStore
// (与 54-05 服务端发射逐字段钉死);此处 re-export 供消费方引用。
import type { GateStatePayload } from '../store/gateStore'

export type { GateStatePayload }

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

/**
 * Phase 49 (WR-08): broadcast payload of POST /canvas/v2/variant-groups/
 * :groupId/select-winner (49-01 endpoint, broadcastToProject). Until this
 * handler existed the event was a dead letter — other tabs/viewers never
 * learned about a winner selection until a full reload.
 */
export interface VariantSelectedPayload {
  projectId: number
  episodesId: number
  groupId: string
  winnerNodeId: string
  timestamp: number
}

interface UseCanvasSocketOptions {
  projectId: number
  episodesId?: number
  onNodeStateChange: (nodeId: string, state: NodeState, progress?: number) => void
  /** 56-01 (D-03):node:state state==='scored' 的 aiScore 载荷转发(评分≠执行态)。 */
  onNodeScored?: (nodeId: string, aiScore: unknown) => void
  onNodePreviewUpdate: (nodeId: string, thumbnailUrl: string) => void
  /** 55-04:V2 节点袋(server { node } payload 适配);位置决策在 FlowCanvas。 */
  onNewAsset?: (node: Record<string, unknown>) => void
  onOrchestrateStart?: (payload: OrchestrateStartPayload) => void
  onOrchestrateProgress?: (payload: OrchestrateProgressPayload) => void
  onOrchestrateDone?: (payload: OrchestrateDonePayload) => void
  onBranchCreated?: (branch: FlowBranch) => void
  onReviewApproved?: (nodeId: string) => void
  onReviewRejected?: (nodeId: string, reason?: string) => void
  onGraphSaved?: (payload: { projectId: number; episodesId: number; timestamp: number }) => void
  /** Phase 49 (WR-08): 他端选定了变体组 winner — 消费方负责回显守卫。 */
  onVariantSelected?: (payload: VariantSelectedPayload) => void
  /** Phase 54 (D-03): gate 中心状态推送,scope 守卫由消费方负责。 */
  onGateState?: (payload: GateStatePayload) => void
  // Phase 41 SYNC-10: feature-flagged incremental event subscription
  onCanvasEvent?: (event: CanvasEventPayload) => void
  onCanvasReset?: (info: { lastEventId: number | null }) => void
}

export function useCanvasSocket(options: UseCanvasSocketOptions) {
  const {
    projectId,
    episodesId,
    onNodeStateChange,
    onNodeScored,
    onNodePreviewUpdate,
    onNewAsset,
    onOrchestrateStart,
    onOrchestrateProgress,
    onOrchestrateDone,
    onBranchCreated,
    onReviewApproved,
    onReviewRejected,
    onGraphSaved,
    onVariantSelected,
    onGateState,
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
    onNodeStateChange, onNodeScored, onNodePreviewUpdate, onNewAsset,
    onOrchestrateStart, onOrchestrateProgress, onOrchestrateDone,
    onBranchCreated, onReviewApproved, onReviewRejected,
    onGraphSaved, onVariantSelected, onGateState, onCanvasEvent, onCanvasReset,
  })
  callbacksRef.current = {
    onNodeStateChange, onNodeScored, onNodePreviewUpdate, onNewAsset,
    onOrchestrateStart, onOrchestrateProgress, onOrchestrateDone,
    onBranchCreated, onReviewApproved, onReviewRejected,
    onGraphSaved, onVariantSelected, onGateState, onCanvasEvent, onCanvasReset,
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
    socket.on('node:state', (payload: { nodeId: string; state: string; progress?: number; aiScore?: unknown }) => {
      // 56-01 (D-03):scored 是评分到达,不是执行态——先于状态归一拦截转发,
      // 绝不让它流入 normalizeSocketNodeState(会错映射执行态并污染 stale 规则)。
      if (payload.state === 'scored') {
        callbacksRef.current.onNodeScored?.(payload.nodeId, payload.aiScore)
        return
      }
      callbacksRef.current.onNodeStateChange(payload.nodeId, payload.state as NodeState, payload.progress)
    })

    // 节点预览图更新
    socket.on('node:preview', (payload: { nodeId: string; thumbnailUrl: string }) => {
      callbacksRef.current.onNodePreviewUpdate(payload.nodeId, payload.thumbnailUrl)
    })

    // 新资产生成完成
    socket.on('node:created', (payload: { node?: Record<string, unknown> }) => {
      // 55-04 (Q4):server broadcast 形状是 { node }(nodes.ts upsert 的 V2 节点);
      // 客户端适配,后端零改动。坏形状静默忽略(warn 归 store 层)。
      const node = payload?.node
      if (node != null && typeof node === 'object') {
        callbacksRef.current.onNewAsset?.(node)
      }
    })

    // 执行进度
    socket.on('execution:progress', (payload: { nodeId: string; state: NodeState; progress: number }) => {
      callbacksRef.current.onNodeStateChange(payload.nodeId, payload.state as NodeState, payload.progress)
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

    // Phase 49 (WR-08): 他端（其他 tab/用户）选定了变体组 winner。49-01 端点
    // 一直在广播 variant:selected，但此前无任何客户端消费（死信）——多视图
    // 同步正是该广播的目的。回显守卫在消费方（本端乐观更新已应用时
    // group.winnerNodeId 已等于 payload 值 → 跳过）。
    socket.on('variant:selected', (payload: VariantSelectedPayload) => {
      callbacksRef.current.onVariantSelected?.(payload)
    })

    // Phase 54 (D-03): gate 中心状态推送 — 54-05 服务端 broadcastToProject
    // ('gate:state') 发射;payload 已是 foldDisplayState 折叠后的展示态。
    socket.on('gate:state', (payload: GateStatePayload) => {
      callbacksRef.current.onGateState?.(payload)
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
