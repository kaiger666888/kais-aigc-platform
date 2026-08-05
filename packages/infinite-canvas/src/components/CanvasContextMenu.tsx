import { useState, type JSX } from 'react'
import type { AssetNodeData, StoryboardNodeData, VideoNodeData } from '../types/canvas'
import { executeNode, approveNode, rejectNode, requestNodeScore, orchestrateCanvas, saveCanvasGraph } from '../services/canvasApi'
import { submitScail2Replace, submitScail2Transfer, pollScail2UntilDone, fetchBlobFromUrl } from '../services/scail2Api'
import { useCanvasStore } from '../store/canvasStore'
import { fetchProjectAssets } from './assetManager/useRealAssets'
import { canvasToFlowGraph } from '../utils/flowDataMapper'
import { theme } from '../theme/catppuccin'
import { LAYOUT } from '../constants'

interface CanvasContextMenuProps {
  x: number
  y: number
  nodeId?: string
  selectedNodeIds?: string[]
  onClose: () => void
  projectId: number
  episodesId: number
}

type MenuItem = {
  label: string
  icon: string
  action: () => void
  danger?: boolean
  accent?: boolean
}

export default function CanvasContextMenu({
  x, y, nodeId, selectedNodeIds, onClose, projectId, episodesId,
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

  // 【资产↔画布交叉联动】画布节点 → 资产库详情：
  // 节点 id 形如 `asset-{numericId}`，从 useRealAssets 模块级缓存查 uuid 后 openAssetDetail + 切 assets 视图。
  const handleViewInLibrary = async () => {
    if (!nodeId) return
    const m = nodeId.match(/^asset-(\d+)$/)
    if (!m) {
      showToast('该节点无对应资产记录（非资产节点）', 'info')
      onClose()
      return
    }
    const numericId = Number(m[1])
    onClose()
    try {
      const pid = useCanvasStore.getState().projectId ?? null
      const assets = await fetchProjectAssets(pid)
      const found = assets.find((a) => a.id === numericId)
      if (!found?.uuid) {
        showToast('未在资产库中找到该资产', 'warning')
        return
      }
      const store = useCanvasStore.getState()
      store.navPushCallback?.()
      store.openAssetDetail(found.uuid)
      store.setViewMode('assets')
    } catch (err: any) {
      showToast('查询资产失败: ' + (err?.message ?? ''), 'error')
    }
  }

  // Phase 37 — 批量执行多选节点
  const handleBatchExecute = async () => {
    const ids = selectedNodeIds ?? []
    if (ids.length === 0) return
    const { orchestration, showToast, nodes, edges } = useCanvasStore.getState()
    if (orchestration.status === 'running') {
      showToast('已有运行中的任务,请等待完成', 'warning')
      onClose()
      return
    }
    try {
      // 保存当前画布
      await saveCanvasGraph(projectId, episodesId, canvasToFlowGraph(nodes as any, edges as any))
      // 触发批量执行 (mode='batch')
      await orchestrateCanvas(projectId, episodesId, ids)
      showToast(`批量执行已触发 (${ids.length} 个节点)`, 'success')
    } catch (err: any) {
      showToast(err.message || '批量执行触发失败', 'error')
    }
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
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'pending' } } : n
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
        n.id === nodeId ? { ...n, data: { ...n.data, reviewStatus: 'pending' } } : n
      ))
      showToast(err.message || '驳回失败', 'error')
    }
  }

  const items: MenuItem[] = []

  // Phase 37 — 多选时显示批量执行入口 (放在最顶部)
  const multiSelectCount = (selectedNodeIds ?? []).length
  if (multiSelectCount > 1) {
    items.push({
      label: `批量执行 (${multiSelectCount} 个节点)`,
      icon: '⚡',
      action: handleBatchExecute,
      accent: true,
    })
    items.push({ label: '---', icon: '', action: () => {} })
  }

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
    // 【资产↔画布交叉联动】画布节点 → 资产库详情（仅 asset-* 节点）
    if (/^asset-\d+$/.test(nodeId)) {
      items.push({
        label: '🗂 在资产库中查看',
        icon: '🗂',
        action: () => { void handleViewInLibrary() },
      })
    }
    items.push({ label: '---', icon: '', action: () => {} })
  }

  // SCAIL2 — 视频节点右键触发角色替换 / 动作迁移
  const nodes = useCanvasStore.getState().nodes
  const clickedNode = nodeId ? nodes.find((n) => n.id === nodeId) : null
  const clickedNodeHasFile =
    clickedNode &&
    typeof (clickedNode.data as any).filePath === 'string' &&
    (clickedNode.data as any).filePath
  if (clickedNodeHasFile) {
    items.push({ label: '---', icon: '', action: () => {} })

    const runScail2 = async (mode: 'replace' | 'transfer') => {
      const poseUrl = (clickedNode!.data as any).filePath as string
      // 弹出文件选择器让用户挑参考图
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/*'
      fileInput.onchange = async (ev) => {
        const target = ev.target as HTMLInputElement
        const refFile = target.files?.[0]
        if (!refFile) return
        showToast(`${mode === 'replace' ? '替换' : '迁移'}：拉取 pose 视频 + 提交...`, 'info')
        try {
          const poseBlob = await fetchBlobFromUrl(poseUrl)
          const submitFn = mode === 'replace' ? submitScail2Replace : submitScail2Transfer
          const submit = await submitFn(poseBlob, refFile, {
            projectId,
            prompt: `canvas ${mode} from ${nodeId}`,
          })
          showToast(`已提交，轮询中 (promptId=${submit.promptId.slice(0, 8)})`, 'info')
          const final = await pollScail2UntilDone(submit.promptId, {
            intervalMs: 10_000, timeoutMs: 600_000,
            onStatus: (s) => {
              if (s.status === 'running') showToast('生成中...', 'info')
            },
          })
          if (final.status === 'done' && final.videos[0]?.tailscaleUrl) {
            const url = final.videos[0].tailscaleUrl
            showToast(`✅ SCAIL2 ${mode} done: ${url}`, 'success')
            // 把输出作为新视频节点加到 canvas，紧挨原节点右侧
            const newId = `video-scail2-${mode}-${Date.now()}`
            const label = mode === 'replace' ? 'SCAIL2 替换' : 'SCAIL2 迁移'
            const newData: VideoNodeData = {
              label, type: 'video', videoId: 0,
              filePath: url, thumbnailUrl: null, state: 'idle',
            }
            useCanvasStore.getState().setNodes((nds) => [...nds, {
              id: newId, type: 'video',
              position: { x: (clickedNode!.position?.x ?? 0) + 320, y: (clickedNode!.position?.y ?? 0) + 40 },
              data: newData,
            }])
          } else {
            showToast(`SCAIL2 ${mode} 失败：${final.status}`, 'error')
          }
        } catch (err: any) {
          showToast(`SCAIL2 ${mode} 失败：${err.message}`, 'error')
        }
      }
      fileInput.click()
      onClose()
    }

    items.push(
      { label: '🎭 SCAIL2 角色替换...', icon: '🎭', action: () => runScail2('replace') },
      { label: '💃 SCAIL2 动作迁移...', icon: '💃', action: () => runScail2('transfer') },
    )
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
              color: item.danger ? theme.status.rejected : (item.accent ? theme.text.onAccent : theme.text.primary),
              background: item.accent ? theme.button.primary : 'transparent',
              fontWeight: item.accent ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              if (!item.accent) (e.target as HTMLElement).style.background = theme.bg.surface
            }}
            onMouseLeave={(e) => {
              if (!item.accent) (e.target as HTMLElement).style.background = 'transparent'
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
