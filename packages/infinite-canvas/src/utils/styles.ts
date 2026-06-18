import type { NodeState, ReviewStatus, RoutingDecision } from '../types/canvas'
import { theme } from '../theme/catppuccin'
import { getBranchColor } from '../theme/branchColors'

/** 节点状态 → 边框颜色映射 */
export const stateColors: Record<NodeState, string> = {
  idle: theme.state.idle,
  pending: theme.state.pending,
  running: theme.state.running,
  success: theme.state.success,
  error: theme.state.error,
  cached: theme.state.cached,
}

/** 连线数据类型 → 颜色映射 */
export const edgeTypeColors: Record<string, string> = {
  text: theme.edge.text,
  image: theme.edge.image,
  video: theme.edge.video,
  audio: theme.edge.audio,
  data: theme.edge.data,
}

/** 审核状态 + 路由决策 → 边框颜色 */
export function getReviewBorderColor(
  reviewStatus?: string,
  routingDecision?: string,
  state?: NodeState,
): string {
  if (reviewStatus === 'rejected') return theme.status.rejected
  if (reviewStatus === 'awaiting_audit') return theme.status.awaiting
  if (reviewStatus === 'approved') return theme.status.approved
  if (routingDecision === 'BLOCK') return theme.node.script
  return stateColors[state ?? 'idle']
}

/** 审核状态 → 不透明度 (1 = fully visible) */
export function getReviewOpacity(reviewStatus?: string): number {
  if (reviewStatus === 'rejected') return 0.5
  return 1
}

/** 审核状态 → CSS filter 字符串 */
export function getReviewFilter(reviewStatus?: string): string {
  if (reviewStatus === 'rejected') return 'grayscale(60%)'
  return 'none'
}

/** 节点边框颜色（综合 isWinner、分支、审核状态、路由决策）
 *
 * 优先级（高 → 低）：
 *  1. 变体败者 → dim（弱化）
 *  2. 探索节点 / 非主线分支 → 分支颜色（绿/黄/红/灰）
 *  3. 审核/路由/状态 → 默认状态色
 *
 * 主线分支节点（branchId === 'main' 或未设置）继续走原逻辑，
 * 不被分支色覆盖，保证主线视觉一致性。
 */
export function getNodeBorderColor(opts: {
  isWinner?: boolean
  reviewStatus?: string
  routingDecision?: string
  state?: NodeState
  branchId?: string
  isExplore?: boolean
}): string {
  if (opts.isWinner === false) return theme.border.dim
  if (opts.isExplore) return getBranchColor(undefined, true).border
  if (opts.branchId && opts.branchId !== 'main') {
    return getBranchColor(opts.branchId, false).border
  }
  return getReviewBorderColor(opts.reviewStatus, opts.routingDecision, opts.state)
}

/** 节点容器样式（综合 isWinner、审核状态的 opacity + filter） */
export function getNodeContainerStyle(opts: {
  isWinner?: boolean
  reviewStatus?: string
}): React.CSSProperties {
  if (opts.isWinner === false) return { opacity: 0.55, filter: 'grayscale(80%)' }
  if (opts.reviewStatus === 'rejected') return { opacity: 0.5, filter: 'grayscale(60%)' }
  return {}
}
