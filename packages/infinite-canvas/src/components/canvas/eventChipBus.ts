/**
 * src/components/canvas/eventChipBus.ts — 事件芯片点击出口（P19）。
 *
 * FlowCanvas 提供 Provider（点击 → 挂参数 popover 插槽锚点），EventChipNode 消费。
 * Context 解耦：芯片不必 prop-drilling 拿到 handler；popover 本体归 D，B 只留出口。
 */
import { createContext, useContext } from 'react'

export interface EventChipClickInfo {
  /** 被点击的事件节点 id。 */
  eventId: string
  /** 事件 op（决定 popover 内参数表单 schema，SSOT yaml 门控）。 */
  op: string
  /** 芯片中心屏坐标（popover 锚点；D 据此定位 320 宽参数面板）。 */
  clientX: number
  clientY: number
  /** 项目上下文（52-04：FlowCanvas handleEventChipClick 注入，popover 重跑提交用；
   *  可选——EventChipNode 发射端零改动，Provider 未注入时 popover 守卫早退）。 */
  projectId?: number | null
  episodesId?: number | null
}

/** 默认 no-op（Provider 未挂载时芯片点击静默，绝不崩）。 */
const noop = (_info: EventChipClickInfo): void => {}

export const EventChipClickContext = createContext<(info: EventChipClickInfo) => void>(noop)

/** 取当前芯片点击出口（FlowCanvas 已 Provider 包裹 ReactFlow）。 */
export function useEventChipClick(): (info: EventChipClickInfo) => void {
  return useContext(EventChipClickContext)
}
