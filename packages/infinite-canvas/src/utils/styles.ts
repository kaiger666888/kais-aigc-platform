import type { NodeState } from '../types/canvas'

/** 节点状态 → 边框颜色映射 */
export const stateColors: Record<NodeState, string> = {
  idle: '#585b70',
  pending: '#f9e2af',
  running: '#89b4fa',
  success: '#a6e3a1',
  error: '#f38ba8',
  cached: '#94e2d5',
}

/** 连线数据类型 → 颜色映射 */
export const edgeTypeColors: Record<string, string> = {
  text: '#89b4fa',
  image: '#a6e3a1',
  video: '#cba6f7',
  data: '#585b70',
}
