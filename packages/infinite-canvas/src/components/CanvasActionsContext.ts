import { createContext, useContext, useCallback, useRef } from 'react'
import type { ToastType } from '../hooks/useToast'

interface CanvasActionsContextType {
  /** 审核通过节点 */
  approveNode: (nodeId: string) => void
  /** 驳回节点 */
  rejectNode: (nodeId: string) => void
  /** 选为变体优胜 */
  selectWinner: (nodeId: string) => void
  /** 显示 toast */
  showToast: (message: string, type?: ToastType) => void
  /** 项目信息 */
  projectId: number
  episodesId: number
}

const CanvasActionsContext = createContext<CanvasActionsContextType | null>(null)

export { CanvasActionsContext }

export function useCanvasActions() {
  const ctx = useContext(CanvasActionsContext)
  if (!ctx) throw new Error('useCanvasActions must be used within CanvasActionsProvider')
  return ctx
}

export function useCanvasActionsSetup(
  projectId: number,
  episodesId: number,
  showToast: (msg: string, type?: ToastType) => void,
) {
  const approveFn = useCallback((nodeId: string) => {
    showToast(`审核通过: ${nodeId}`, 'success')
  }, [showToast])

  const rejectFn = useCallback((nodeId: string) => {
    showToast(`已驳回: ${nodeId}`, 'warning')
  }, [showToast])

  const selectWinnerFn = useCallback((nodeId: string) => {
    showToast(`已选为优胜: ${nodeId}`, 'success')
  }, [showToast])

  return {
    approveNode: approveFn,
    rejectNode: rejectFn,
    selectWinner: selectWinnerFn,
    projectId,
    episodesId,
    showToast,
  }
}
