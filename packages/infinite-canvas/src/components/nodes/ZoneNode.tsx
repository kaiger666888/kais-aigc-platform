/**
 * src/components/nodes/ZoneNode.tsx — zone 容器（legacy 路径兜底渲染）。
 *
 * tokens §3.3 冲突裁决：**废弃 140×70 椭圆四色相位徽章**（research/story/production/post
 * 四色边框违反 P8——phase 走彩色了；V3 十泳道带已取代其分区职能，见 canvas/LaneBands）。
 * zone 容器语义保留（分组背景涂层），渲染重写为中性矩形：零彩色暖灰涂层 + 标签，
 * 与泳道带同族（明度通道，不占色相）。V3 graph 路径下 zone/phase 节点已被 adapter
 * 丢弃（stage 派生泳道），本组件仅供非 graph legacy 路径不崩。
 */
import { memo } from 'react'
import { type NodeProps, type Node, Handle, Position } from '@xyflow/react'
import { v3theme } from '../../theme/catppuccin'

interface ZoneData {
  label: string
  phase?: string
  [key: string]: unknown
}

type ZoneNodeType = Node<ZoneData, 'zone'>

function ZoneNodeComponent({ data, selected }: NodeProps<ZoneNodeType>) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        minWidth: 200,
        minHeight: 80,
        padding: 8,
        background: v3theme.signal.lockedWeak,
        borderRadius: 0, // 带是涂层不是容器（§2.2）
        border: `1px dashed ${v3theme.signal.locked}`,
        boxShadow: selected ? `0 0 0 1.5px ${v3theme.signal.select}` : 'none',
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: v3theme.laneLabel,
        userSelect: 'none',
      }}
    >
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6, border: 'none' }} />
      {data.label as string}
    </div>
  )
}

export default memo(ZoneNodeComponent)
