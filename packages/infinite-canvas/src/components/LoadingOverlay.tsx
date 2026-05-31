import { catppuccin } from '../theme/catppuccin'

const styles = `
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
@keyframes skeleton-line-flow {
  0% { stroke-dashoffset: 200; }
  100% { stroke-dashoffset: 0; }
}
@keyframes skeleton-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes skeleton-text-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`

/** SVG skeleton nodes + connecting lines that pulse, simulating a canvas loading */
function SkeletonCanvas() {
  const nodeColor = catppuccin.surface0
  const lineColor = catppuccin.surface1
  const pulse = 'skeleton-pulse'

  return (
    <svg
      width="680"
      height="320"
      viewBox="0 0 680 320"
      style={{ display: 'block' }}
    >
      {/* Connection lines */}
      <path
        d="M 200 100 C 260 100, 260 180, 320 180"
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeDasharray="8 6"
        style={{ animation: `${pulse} 2s ease-in-out infinite` }}
      />
      <path
        d="M 200 100 C 260 100, 260 60, 320 60"
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeDasharray="8 6"
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.3s` }}
      />
      <path
        d="M 500 180 C 540 180, 540 240, 580 240"
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeDasharray="8 6"
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.6s` }}
      />

      {/* Node 1: Script (tall) */}
      <rect x="40" y="60" width="160" height="80" rx="8" fill={nodeColor}
        style={{ animation: `${pulse} 2s ease-in-out infinite` }} />
      <rect x="56" y="76" width="80" height="10" rx="4" fill={catppuccin.surface1} />
      <rect x="56" y="96" width="128" height="8" rx="3" fill={catppuccin.surface1}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.2s` }} />
      <rect x="56" y="112" width="96" height="8" rx="3" fill={catppuccin.surface1}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.4s` }} />

      {/* Node 2: Asset (square with thumbnail) */}
      <rect x="320" y="30" width="160" height="100" rx="8" fill={nodeColor}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.3s` }} />
      <rect x="336" y="46" width="60" height="10" rx="4" fill={catppuccin.surface1} />
      <rect x="336" y="66" width="128" height="44" rx="4" fill={catppuccin.mantle}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.5s` }} />

      {/* Node 3: Storyboard (with thumbnail) */}
      <rect x="320" y="150" width="160" height="110" rx="8" fill={nodeColor}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.6s` }} />
      <rect x="336" y="166" width="60" height="10" rx="4" fill={catppuccin.surface1} />
      <rect x="336" y="186" width="128" height="54" rx="4" fill={catppuccin.mantle}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.8s` }} />

      {/* Node 4: Video */}
      <rect x="560" y="200" width="100" height="90" rx="8" fill={nodeColor}
        style={{ animation: `${pulse} 2s ease-in-out infinite 0.9s` }} />
      <rect x="576" y="216" width="40" height="10" rx="4" fill={catppuccin.surface1} />
      <rect x="576" y="236" width="68" height="38" rx="4" fill={catppuccin.mantle}
        style={{ animation: `${pulse} 2s ease-in-out infinite 1.1s` }} />

      {/* Extra floating nodes */}
      <rect x="60" y="200" width="120" height="70" rx="8" fill={nodeColor}
        style={{ animation: `${pulse} 2s ease-in-out infinite 1.2s` }} />
      <rect x="76" y="216" width="60" height="10" rx="4" fill={catppuccin.surface1} />
      <rect x="76" y="236" width="88" height="16" rx="3" fill={catppuccin.mantle}
        style={{ animation: `${pulse} 2s ease-in-out infinite 1.4s` }} />
      <path
        d="M 180 235 C 220 235, 280 180, 320 180"
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeDasharray="8 6"
        style={{ animation: `${pulse} 2s ease-in-out infinite 1.0s` }}
      />
    </svg>
  )
}

export default function LoadingOverlay() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100vw',
      height: '100vh',
      background: catppuccin.crust,
      animation: 'skeleton-fade-in 0.4s ease-out',
    }}>
      <style>{styles}</style>

      {/* Skeleton canvas visualization */}
      <div style={{ opacity: 0.9, marginBottom: 32 }}>
        <SkeletonCanvas />
      </div>

      {/* Loading text with shimmer */}
      <div style={{
        color: catppuccin.text,
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: '0.02em',
        background: `linear-gradient(90deg, ${catppuccin.surface2} 0%, ${catppuccin.subtext0} 50%, ${catppuccin.surface2} 100%)`,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        animation: 'skeleton-text-shimmer 2.5s ease-in-out infinite',
      }}>
        正在解析项目数据...
      </div>

      {/* Subtle hint */}
      <div style={{
        color: catppuccin.surface2,
        fontSize: 12,
        marginTop: 8,
      }}>
        Loading canvas data
      </div>
    </div>
  )
}
