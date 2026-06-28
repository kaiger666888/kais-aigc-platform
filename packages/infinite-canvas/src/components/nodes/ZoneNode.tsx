import { memo } from 'react'
import { type NodeProps, type Node, Handle, Position } from '@xyflow/react'
import { theme } from '../../theme/catppuccin'

interface ZoneData {
  label: string
  phase: string
  [key: string]: unknown
}

type ZoneNodeType = Node<ZoneData, 'zone'>

const phaseStyles: Record<string, { bg: string; border: string; accent: string }> = {
  research: {
    bg: 'rgba(148,226,213,0.12)',
    border: '#94e2d5',
    accent: '#94e2d5',
  },
  story: {
    bg: 'rgba(203,166,247,0.12)',
    border: '#cba6f7',
    accent: '#cba6f7',
  },
  production: {
    bg: 'rgba(250,179,135,0.12)',
    border: '#fab387',
    accent: '#fab387',
  },
  post: {
    bg: 'rgba(137,180,250,0.12)',
    border: '#89b4fa',
    accent: '#89b4fa',
  },
}

function ZoneNodeComponent({ data, selected }: NodeProps<ZoneNodeType>) {
  const phase = (data.phase as string) || 'research'
  const styles = phaseStyles[phase] || phaseStyles.research

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 140,
      height: 70,
      background: styles.bg,
      borderRadius: '50%',
      border: `2px solid ${styles.border}`,
      boxShadow: selected ? `0 0 0 2px ${styles.accent}40` : `0 2px 8px rgba(0,0,0,0.3)`,
      fontSize: 13,
      fontWeight: 700,
      color: styles.accent,
      letterSpacing: 0.5,
      textAlign: 'center' as const,
      userSelect: 'none',
    }}>
      <Handle type="source" position={Position.Right} style={{ background: styles.border, width: 8, height: 8, border: 'none' }} />
      {data.label as string}
    </div>
  )
}

export default memo(ZoneNodeComponent)
