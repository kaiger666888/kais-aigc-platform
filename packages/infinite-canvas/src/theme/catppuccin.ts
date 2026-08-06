/**
 * 原 Catppuccin Mocha 调色板结构（键名保留，消费方多）。
 * v2 已把逐值重映射到「冷中性表面 + 4 暖模态通道」统一词汇表，使所有直接读
 * catppuccin.* 的次要组件（LoadingOverlay / FeedbackBadge / IterationPanel …）
 * 自动跟随主色温，杜绝冷蓝紫泄漏。键 → 角色：
 *  - 表面族（crust/mantle/base/surface0-2）：冷中性灰梯度；
 *  - 文字族（text/subtext/overlay）：冷白→冷灰；
 *  - 彩色族（green/red/yellow/blue/peach/mauve…）：归并到 4 模态色，避免彩虹。
 */
export const catppuccin = {
  // 彩色族 → 4 暖模态通道（全 UI 一套词汇表）
  rosewater: '#DD6A82', // video 玫
  flamingo: '#DD6A82',
  pink: '#DD6A82',
  mauve: '#DD6A82',
  red: '#DD6A82', // → video 玫（danger / rejected）
  maroon: '#C25E52',
  peach: '#E08547', // → audio 橙
  yellow: '#E0B665', // → text 金（warning / running）
  green: '#56B89A', // → image 青（success / approved）
  teal: '#56B89A',
  sky: '#56B89A',
  sapphire: '#56B89A',
  blue: '#56B89A', // → image 青（旧蓝系归并，冷壳下唯一「冷感」锚点留给 select 冷白）
  lavender: '#9A9FA8',
  // 文字族 → 冷白/冷灰
  text: '#EDEEF1',
  subtext1: '#9A9FA8',
  subtext0: '#6B7080',
  overlay2: '#6B7080',
  overlay1: '#4A4F5A',
  overlay0: '#3A3F4A',
  // 表面族 → 冷中性灰梯度（替换原冷蓝紫 #1e1e2e 系）
  surface2: '#272B33',
  surface1: '#1E2128',
  surface0: '#16181D',
  base: '#16181D', // 卡片表面
  mantle: '#111317', // 面板/顶栏
  crust: '#0A0B0E', // 画布底
} as const

/**
 * V3 视觉权威 v2「冷中性壳 + 暖模态通道」。
 * 表面/泳道/文字 = 冷中性灰（统一色温，杀掉暖底×冷蓝卡的廉价冲突）；
 * 颜色只留给 4 个产物模态通道 = 内容色；信号色复用模态色 → 一套 4 色词汇表。
 * CSS 镜像见 theme/tokens.css（逐值同步）。
 */
export const v3theme = {
  // 四模态通道（唯一彩色 = 内容色；提饱和提可见，暖调与冷壳形成焦点）
  modality: { text: '#E0B665', image: '#56B89A', audio: '#E08547', video: '#DD6A82' },
  modalityWeak: {
    text: 'rgba(224,182,101,0.12)',
    image: 'rgba(86,184,154,0.12)',
    audio: 'rgba(224,133,71,0.12)',
    video: 'rgba(221,106,130,0.12)',
  },
  modalityDim: { text: '#B89757' }, // L0 色块 text 用（明度降版，与 image 可辨）
  // 十泳道带（冷中性明度梯度，零彩色；结构感非装饰）
  lane: {
    global: '#0A0B0E', script: '#0E1014', storyboard: '#111419', keyframe: '#14171C',
    video: '#171A20', voice: '#1A1E24', foley: '#1D2128', bgm: '#20242B',
    mix: '#232830', composite: '#262B34',
  },
  laneLabel: 'rgba(154,159,168,0.55)',
  laneNum: 'rgba(154,159,168,0.35)',
  // 创作阶段分组色（P01–P13 管线维度；复用 4 模态色 → 一套词汇表，呼应设计 v2）
  phaseGroup: {
    research: '#E0B665',     // P01–02 选题/大纲 → text 金
    story: '#56B89A',        // P03–05 剧本/角色/痛点 → image 青
    production: '#DD6A82',   // P06–09 运镜/视觉/场景/分镜 → video 玫
    post: '#E08547',         // P10–13 语音/渲染/合成/交付 → audio 橙
  },
  phaseGroupLabel: 'rgba(154,159,168,0.45)',
  // 语义信号色（复用模态色 → 全 UI 一套 4 色词汇表；只许角标/描边/压暗）
  signal: {
    stale: '#F0A52E', staleWeak: 'rgba(240,165,46,0.5)',
    select: '#EDEEF1', locked: '#7A8290',
    lockedWeak: 'rgba(122,130,144,0.06)', lockedHatch: 'rgba(122,130,144,0.10)',
    approved: '#56B89A', rejected: '#DD6A82', running: '#E0B665', pending: '#9A9FA8',
  },
  // 边中性冷白灰族（在冷底上更亮；sequence / isInactive / reference 点线）
  edge: {
    neutral: 'rgba(255,255,255,0.16)',
    inactive: 'rgba(255,255,255,0.10)',
    ref: 'rgba(255,255,255,0.14)',
  },
  // 画布域表面（冷中性灰，替换 Catppuccin 冷蓝紫）
  surface: {
    canvas: '#0A0B0E', lineCanvas: 'rgba(255,255,255,0.04)', card: '#16181D',
    cardHover: '#1E2128', panel: '#111317', overlay: '#1E2128', elevated: '#272B33',
  },
} as const

export type Modality = keyof typeof v3theme.modality

/** Semantic tokens v2（冷中性壳 + 暖模态通道；改值不改结构） */
export const theme = {
  // Backgrounds — 冷中性灰梯度（替换 Catppuccin 冷蓝紫）
  bg: {
    canvas: v3theme.surface.canvas,   // #0A0B0E 冷近黑
    panel: v3theme.surface.panel,     // #111317 顶栏/面板
    card: v3theme.surface.card,       // #16181D 卡片（替换冷蓝 base）
    cardHover: v3theme.surface.cardHover, // #1E2128
    surface: v3theme.surface.overlay, // #1E2128
    overlay: v3theme.surface.overlay,
    elevated: v3theme.surface.elevated,
    dim: '#272B33',
    image: v3theme.surface.canvas,
    input: '#0E1014',
  },

  // Borders — 冷白发丝线（Linear 手法：半透明白而非实色灰）
  border: {
    default: 'rgba(255,255,255,0.08)',
    subtle: 'rgba(255,255,255,0.06)',
    dim: 'rgba(255,255,255,0.04)',
    strong: 'rgba(255,255,255,0.14)',
    canvas: v3theme.surface.lineCanvas,
  },

  // Text — 冷白系（匹配冷中性壳）
  text: {
    primary: '#EDEEF1',
    secondary: '#9A9FA8',
    tertiary: '#6B7080',
    disabled: '#4A4F5A',
    onAccent: '#0A0B0E',
  },

  // Node type accent colors —— 归并四模态色（内容色）
  node: {
    script: v3theme.modality.text,
    asset: v3theme.modality.image,
    storyboard: v3theme.modality.image,
    video: v3theme.modality.video,
    audio: v3theme.modality.audio,
  },

  // Node state colors（信号色复用模态色）
  state: {
    idle: '#6B7080',
    pending: v3theme.signal.pending,
    running: v3theme.signal.running,
    success: v3theme.signal.approved,
    error: v3theme.signal.rejected,
    skipped: v3theme.signal.approved,
  } as Record<string, string>,

  // Edge data-type colors —— 产物模态色（CanvasEdge 以 55% 透明度使用；中性灰族见 v3theme.edge）
  edge: {
    text: v3theme.modality.text,
    image: v3theme.modality.image,
    video: v3theme.modality.video,
    audio: v3theme.modality.audio,
    data: '#6B7080',
  },

  // Status / semantic（复用模态色 → 一套 4 色词汇表）
  status: {
    connected: v3theme.signal.approved,
    disconnected: v3theme.signal.rejected,
    approved: v3theme.signal.approved,
    rejected: v3theme.signal.rejected,
    awaiting: v3theme.signal.running,
  },

  // Score thresholds（高=青 / 中=金 / 低=玫，复用模态色）
  score: {
    high: v3theme.modality.image,
    medium: v3theme.modality.text,
    low: v3theme.modality.video,
  },

  // Routing decision（复用模态色）
  routing: {
    AUTO: v3theme.modality.image,
    HUMAN: v3theme.modality.text,
    AI_AUDIT: v3theme.modality.video,
    BLOCK: '#6B7080',
  },

  // Handle colors (per node type → 模态色)
  handle: {
    script: v3theme.modality.text,
    asset: v3theme.modality.image,
    storyboard: v3theme.modality.image,
    video: v3theme.modality.video,
    audio: v3theme.modality.audio,
  },

  // UI chrome — 冷中性
  chrome: {
    topBar: v3theme.surface.panel,
    errorBar: '#2A1620',
    errorBorder: 'rgba(221,106,130,0.4)',
    lightboxOverlay: 'rgba(0,0,0,0.85)',
    videoOverlay: 'rgba(0,0,0,0.3)',
    thumbnailOverlay: 'rgba(0,0,0,0.6)',
    miniMapMask: 'rgba(10,11,14,0.8)',
    shadow: 'rgba(0,0,0,0.5)',
  },

  // Buttons（冷中性 + 冷白 accent；danger 复用 video 玫）
  button: {
    primary: v3theme.signal.select, // 冷白
    danger: v3theme.signal.rejected,
    ghost: v3theme.surface.overlay,
  },

  // Shadows（真实纵深：inset 顶高光 + 柔投影，Linear/Vercel 手法）
  shadow: {
    card: '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset',
    cardHi: '0 6px 16px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08) inset',
    pop: '0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
    drag: '0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.10) inset',
    selectGlow: '0 0 0 1px rgba(237,238,241,0.55), 0 0 14px rgba(237,238,241,0.16)',
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
