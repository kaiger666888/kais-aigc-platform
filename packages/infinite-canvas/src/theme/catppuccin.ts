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

/**
 * Step 5 — V3 视觉权威（step5-design-tokens.md §2.1 映射，逐值实现）。
 * 暗色暖调石墨底：保留 Catppuccin 表面/边框结构，替换全部语义角色色（蓝紫系出局）。
 */
export const v3theme = {
  // 四模态色（P8：色相通道独占）+ 弱色（底色/光晕）+ L0 降明度版
  modality: { text: '#C6B794', image: '#9DB48E', audio: '#CE8266', video: '#B96A72' },
  modalityWeak: {
    text: 'rgba(198,183,148,0.10)',
    image: 'rgba(157,180,142,0.10)',
    audio: 'rgba(206,130,102,0.10)',
    video: 'rgba(185,106,114,0.10)',
  },
  modalityDim: { text: '#9E9378' }, // L0 色块 text 用 70% 明度版（与 image 可辨）
  // 十泳道带（明度递进，零彩色）
  lane: {
    global: '#0E0C08', script: '#161410', storyboard: '#1A1813', keyframe: '#1E1C17',
    video: '#221F1A', voice: '#26231E', foley: '#2A2722', bgm: '#2E2B25',
    mix: '#322F29', composite: '#37332C',
  },
  laneLabel: 'rgba(166,159,143,0.7)',
  // 语义信号色（只许角标/描边/压暗，不抢颜色通道）
  signal: {
    stale: '#F0A52E', staleWeak: 'rgba(240,165,46,0.5)',
    select: '#F2E9D8', locked: '#8A8578',
    lockedWeak: 'rgba(138,133,120,0.05)', lockedHatch: 'rgba(138,133,120,0.08)',
    approved: '#9DB48E', rejected: '#C25E52', running: '#E0B84F', pending: '#A69F8F',
  },
  // 边中性灰族（sequence / isInactive / reference 点线）
  edge: {
    neutral: 'rgba(110,106,94,0.5)',
    inactive: 'rgba(110,106,94,0.25)',
    ref: 'rgba(110,106,94,0.4)',
  },
  // 画布域表面
  surface: {
    canvas: '#100E0A', lineCanvas: '#2A2721', card: 'rgba(30,30,46,0.92)',
  },
} as const

export type Modality = keyof typeof v3theme.modality

/** Semantic tokens derived from Catppuccin Mocha（§2.1：改值不改结构） */
export const theme = {
  // Backgrounds
  bg: {
    canvas: v3theme.surface.canvas, // 替换 crust 冷蓝底 → 暖黑
    panel: catppuccin.mantle,
    card: catppuccin.base,
    surface: catppuccin.surface0,
    overlay: catppuccin.surface1,
    dim: catppuccin.surface2,
    image: v3theme.surface.canvas,
    input: v3theme.surface.canvas,
  },

  // Borders
  border: {
    default: catppuccin.surface0,
    subtle: catppuccin.surface1,
    dim: catppuccin.surface2,
    canvas: v3theme.surface.lineCanvas, // 画布泳道分隔线（暖灰，新增）
  },

  // Text（全套冷白换暖白）
  text: {
    primary: '#E8E2D5',
    secondary: '#A69F8F',
    disabled: '#6E6A5E',
    onAccent: catppuccin.base,
  },

  // Node type accent colors —— 废止「类型着色」，归并四模态色（§1.2 冲突裁决）
  node: {
    script: v3theme.modality.text,     // 冷蓝 → 暖沙
    asset: v3theme.modality.image,     // → 苔绿（降饱和）
    storyboard: v3theme.modality.image, // yellow 废止，storyboard 模态=image
    video: v3theme.modality.video,     // 紫 → 枯玫瑰
    audio: v3theme.modality.audio,     // 粉紫 → 陶橙
  },

  // Node state colors（§1.3 / §2.5：cached 归一 success；蓝 → 暖琥珀脉冲）
  state: {
    idle: '#6E6A5E',
    pending: v3theme.signal.pending,
    running: v3theme.signal.running,
    success: v3theme.signal.approved,
    error: v3theme.signal.rejected,
    cached: v3theme.signal.approved,
  } as Record<string, string>,

  // Edge data-type colors —— 产物模态色（CanvasEdge 以 40% 透明度使用；中性灰族见 v3theme.edge）
  edge: {
    text: v3theme.modality.text,
    image: v3theme.modality.image,
    video: v3theme.modality.video,
    audio: v3theme.modality.audio,
    data: '#6E6A5E',
  },

  // Status / semantic（绿/红/琥珀行业惯例保留，色温换暖）
  status: {
    connected: v3theme.signal.approved,
    disconnected: v3theme.signal.rejected,
    approved: v3theme.signal.approved,
    rejected: v3theme.signal.rejected,
    awaiting: v3theme.signal.running,
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

  // Handle colors (per node type → 模态色)
  handle: {
    script: v3theme.modality.text,
    asset: v3theme.modality.image,
    storyboard: v3theme.modality.image,
    video: v3theme.modality.video,
    audio: v3theme.modality.audio,
  },

  // UI chrome
  chrome: {
    topBar: catppuccin.mantle,
    errorBar: '#302030',
    errorBorder: '#f38ba844',
    lightboxOverlay: 'rgba(0,0,0,0.85)',
    videoOverlay: 'rgba(0,0,0,0.3)',
    thumbnailOverlay: 'rgba(0,0,0,0.6)',
    miniMapMask: 'rgba(16,14,10,0.8)',
    shadow: 'rgba(0,0,0,0.5)',
  },

  // Buttons（蓝/粉出局，暖沙 accent + 砖红 danger）
  button: {
    primary: v3theme.modality.text,
    danger: v3theme.signal.rejected,
    ghost: catppuccin.surface0,
  },
} as const

/**
 * MiniMap node color lookup（§2.1：改读四模态色 + locked 石灰）。
 * key = RF node.type：V3 资产用 stage 字符串（adapter 契约）；保留旧五类型 key 过渡兼容。
 * locked 石灰按节点 data.curation 在 FlowCanvas 的 miniMapNodeColor 回调里判定。
 */
export const miniMapNodeColors: Record<string, string> = {
  // V3 stage keys（P8：模态走颜色通道）
  global: v3theme.modality.image,
  script: v3theme.modality.text,
  storyboard: v3theme.modality.image,
  keyframe: v3theme.modality.image,
  video: v3theme.modality.video,
  voice: v3theme.modality.audio,
  foley: v3theme.modality.audio,
  bgm: v3theme.modality.audio,
  mix: v3theme.modality.audio,
  composite: v3theme.modality.video,
  eventChip: v3theme.signal.pending,
  // 旧类型 key（非 graph 路径过渡兼容）
  asset: v3theme.modality.image,
  audio: v3theme.modality.audio,
}

/** Get score color by threshold */
export function getScoreColor(score: number): string {
  if (score >= 0.8) return theme.score.high
  if (score >= 0.5) return theme.score.medium
  return theme.score.low
}
