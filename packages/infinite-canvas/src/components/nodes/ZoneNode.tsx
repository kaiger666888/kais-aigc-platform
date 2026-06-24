import { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import { theme } from '../../theme/catppuccin'

interface ZoneData {
  label: string
  phase: string
  [key: string]: unknown
}

type ZoneNodeType = Node<ZoneData, 'zone'>

const phaseStyles: Record<string, { bg: string; border: string; accent: string; titleBg: string }> = {
  research: {
    bg: 'rgba(148,226,213,0.07)',
    border: 'rgba(148,226,213,0.30)',
    accent: '#94e2d5',
    titleBg: 'rgba(148,226,213,0.15)',
  },
  story: {
    bg: 'rgba(203,166,247,0.07)',
    border: 'rgba(203,166,247,0.30)',
    accent: '#cba6f7',
    titleBg: 'rgba(203,166,247,0.15)',
  },
  production: {
    bg: 'rgba(250,179,135,0.07)',
    border: 'rgba(250,179,135,0.30)',
    accent: '#fab387',
    titleBg: 'rgba(250,179,135,0.15)',
  },
  post: {
    bg: 'rgba(137,180,250,0.07)',
    border: 'rgba(137,180,250,0.30)',
    accent: '#89b4fa',
    titleBg: 'rgba(137,180,250,0.15)',
  },
}

function ZoneNodeComponent({ data }: NodeProps<ZoneNodeType>) {
  const phase = (data.phase as string) || 'research'
  const styles = phaseStyles[phase] || phaseStyles.research

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: styles.bg,
      borderRadius: 16,
      border: `2px dashed ${styles.border}`,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      {/* Phase label bar */}
      <div style={{
        padding: '6px 16px',
        fontSize: 14,
        fontWeight: 700,
        color: styles.accent,
        background: styles.titleBg,
        borderBottom: `1px solid ${styles.border}`,
        letterSpacing: 0.5,
      }}>
        {data.label as string}
      </div>
    </div>
  )
}

export default memo(ZoneNodeComponent)
