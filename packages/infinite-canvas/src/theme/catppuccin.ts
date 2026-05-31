/**
 * Catppuccin Mocha theme tokens
 * https://catppuccin.com/palette
 */

export const catppuccin = {
  // Base palette
  rosewater: '#f5e0dc',
  flamingo: '#f2cdcd',
  pink: '#f5c2e7',
  mauve: '#cba6f7',
  red: '#f38ba8',
  maroon: '#eba0ac',
  peach: '#fab387',
  yellow: '#f9e2af',
  green: '#a6e3a1',
  teal: '#94e2d5',
  sky: '#89dceb',
  sapphire: '#74c7ec',
  blue: '#89b4fa',
  lavender: '#b4befe',
  text: '#cdd6f4',
  subtext1: '#bac2de',
  subtext0: '#a6adc8',
  overlay2: '#9399b2',
  overlay1: '#7f849c',
  overlay0: '#6c7086',
  surface2: '#585b70',
  surface1: '#45475a',
  surface0: '#313244',
  base: '#1e1e2e',
  mantle: '#181825',
  crust: '#11111b',
} as const

/** Semantic tokens derived from Catppuccin Mocha */
export const theme = {
  // Backgrounds
  bg: {
    canvas: catppuccin.crust,
    panel: catppuccin.mantle,
    card: catppuccin.base,
    surface: catppuccin.surface0,
    overlay: catppuccin.surface1,
    dim: catppuccin.surface2,
    image: catppuccin.crust,
    input: catppuccin.crust,
  },

  // Borders
  border: {
    default: catppuccin.surface0,
    subtle: catppuccin.surface1,
    dim: catppuccin.surface2,
  },

  // Text
  text: {
    primary: catppuccin.text,
    secondary: catppuccin.subtext0,
    disabled: catppuccin.surface2,
    onAccent: catppuccin.base,
  },

  // Node type accent colors
  node: {
    script: catppuccin.blue,
    asset: catppuccin.green,
    storyboard: catppuccin.yellow,
    video: catppuccin.mauve,
    audio: catppuccin.pink,
  },

  // Node state colors
  state: {
    idle: catppuccin.surface2,
    pending: catppuccin.yellow,
    running: catppuccin.blue,
    success: catppuccin.green,
    error: catppuccin.red,
    cached: catppuccin.teal,
  } as Record<string, string>,

  // Edge data-type colors
  edge: {
    text: catppuccin.blue,
    image: catppuccin.green,
    video: catppuccin.mauve,
    audio: catppuccin.pink,
    data: catppuccin.surface2,
  },

  // Status / semantic
  status: {
    connected: catppuccin.green,
    disconnected: catppuccin.red,
    approved: catppuccin.green,
    rejected: catppuccin.red,
    awaiting: catppuccin.yellow,
  },

  // Score thresholds
  score: {
    high: catppuccin.green,
    medium: catppuccin.yellow,
    low: catppuccin.red,
  },

  // Routing decision
  routing: {
    AUTO: catppuccin.blue,
    HUMAN: catppuccin.yellow,
    AI_AUDIT: catppuccin.mauve,
    BLOCK: catppuccin.surface2,
  },

  // Handle colors (per node type)
  handle: {
    script: catppuccin.blue,
    asset: catppuccin.blue,
    storyboard: catppuccin.green,
    video: catppuccin.mauve,
    audio: catppuccin.pink,
  },

  // UI chrome
  chrome: {
    topBar: catppuccin.mantle,
    errorBar: '#302030',
    errorBorder: '#f38ba844',
    lightboxOverlay: 'rgba(0,0,0,0.85)',
    videoOverlay: 'rgba(0,0,0,0.3)',
    thumbnailOverlay: 'rgba(0,0,0,0.6)',
    miniMapMask: 'rgba(17,17,27,0.8)',
    shadow: 'rgba(0,0,0,0.5)',
  },

  // Buttons
  button: {
    primary: catppuccin.blue,
    danger: catppuccin.red,
    ghost: catppuccin.surface0,
  },
} as const

/** MiniMap node color lookup */
export const miniMapNodeColors: Record<string, string> = {
  script: catppuccin.blue,
  asset: catppuccin.green,
  storyboard: catppuccin.yellow,
  video: catppuccin.mauve,
  audio: catppuccin.pink,
}

/** Get score color by threshold */
export function getScoreColor(score: number): string {
  if (score >= 0.8) return theme.score.high
  if (score >= 0.5) return theme.score.medium
  return theme.score.low
}
