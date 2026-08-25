/**
 * 资产管理中心 — 数据层（细粒度资产类型 + 组合关系）。
 *
 * 数据来源：
 *   - 资产库 / 详情 → 真实 `/api/v1/assets-registry`（assetDetailToItem 映射）。
 *   - 角色衣柜 / 场景管理 → mock 数据集（组合关系 o_asset_composition 未建表，
 *     待后端落地 design.md §3 后接真实 API）。
 *
 * 真实接入路径（TODO，待后端落地 design.md §3 的 o_asset_composition/o_loadout）：
 *   - 组合关系 → 需新增 GET /api/v1/assets/:uuid/composition（TODO）
 *   - 角色衣柜 → 需新增 GET /api/v1/characters/:uuid/wardrobe（TODO）
 * 见 /tmp/asset-manager-design.md §4 API 设计。
 */
import type { AssetDetail } from '../../services/canvasApi'

// ─── 资产类型（细粒度 mock + 粗粒度真实 registry） ─────────
// 细粒度（mock / 未来 o_asset_composition）+ 粗粒度（现网 assets-registry 实际 type）。
export type AssetType =
  // 细粒度
  | 'character' | 'costume' | 'accessory'
  | 'scene' | 'scene_variant'
  | 'prop' | 'prop_key' | 'prop_consumable'
  | 'style' | 'audio'
  // 粗粒度（现网 registry 真实数据）
  | 'clip' | 'voice' | 'video' | 'storyboard' | 'storyboard_board'
  | 'script_phase' | 'outline' | 'topic' | 'delivery'
  // Notion 文档型资产的真实 DB type（meta.subtype 短路前的裸 type 也能正确显示）
  | 'script' | 'story' | 'requirement' | 'document'

export type AssetModality = 'image' | 'text' | 'audio' | 'video'
export type AssetScope = 'library' | 'series' | 'project'
/** 装备槽（wears/holds 关系用） */
export type EquipSlot = 'head' | 'body' | 'accessory' | 'hand' | 'feet'

export interface AssetItem {
  uuid: string
  name: string
  type: AssetType
  modality: AssetModality
  emoji: string
  scope: AssetScope
  desc?: string
  /** 复用集数（驱动卡片复用徽标） */
  reuses?: number
  tags?: string[]
  /** 多视图角度（角色/场景） */
  views?: string[]
  model?: string
  seed?: string
  voice?: string
  prompt?: string
  /** 服装/配饰/道具：归属角色 */
  forChar?: string
  /** 装备槽位（可穿戴物品） */
  slot?: EquipSlot
  /** scene_variant 的基底场景 */
  variantOf?: string
  /** scene_variant 的差异参数 */
  diff?: Record<string, string>
  // ── 真实 registry 字段（assetDetailToItem 填充） ──
  /** 真实 o_assets.id（数字主键） */
  id?: number
  /** JOIN o_image 得到的文件路径（缩略图渲染用） */
  filePath?: string
  characterId?: string
  viewAngle?: string
  /** 来源标记：真实 API / mock（驱动详情视图的取数路径） */
  source?: 'real' | 'mock'
  /** 正式使用版本标记（管线下游 P05+ 使用 isPrimaryView=true 的资产） */
  isPrimaryView?: boolean
  /** 原始 meta JSON 字符串（透传给 parseCostumeMeta / parseTurnaroundSheetSize 解析富信息） */
  meta?: string | null
}

// ─── 组合关系 ─────────────────────────────────────────────
export type CompositionRelation = 'variant_of' | 'wears' | 'holds' | 'appears_in'

export interface Composition {
  /** 主体（角色/资产） */
  a: string
  /** 对象（服装/道具/场景） */
  b: string
  rel: CompositionRelation
  /** wears/holds 的槽位 */
  slot?: EquipSlot
  /** 归属的搭配预设名（角色衣柜） */
  loadout?: string
}

/** 跨集出场（关键道具/角色，复用 v1 o_asset_usage 的概念） */
export const EPISODES = [
  { code: 'EP01', t: '相遇' },
  { code: 'EP02', t: '客厅' },
  { code: 'EP03', t: '再会' },
] as const

export const APPEARS: Record<string, string[]> = {
  'prp-bell': ['EP01', 'EP02', 'EP03'],
  'chr-xiaoju': ['EP01', 'EP02', 'EP03'],
  'chr-xiaoyue': ['EP02', 'EP03'],
  'prp-photo': ['EP02'],
}

// ─── 模拟数据集（流浪猫小橘） ─────────────────────────────
export const ASSETS: AssetItem[] = [
  // 角色
  { uuid: 'chr-xiaoju', name: '小橘', type: 'character', modality: 'image', emoji: '🐱', scope: 'series',
    desc: '流浪橘猫 · 主角', reuses: 3, tags: ['主角', '动物'], views: ['front', 'side', 'back'],
    model: 'jimeng-5.0', seed: 'ju-7782', voice: 'voice-xiaoju', prompt: '一只橘色短毛流浪猫,碧绿眼睛,瘦但精神' },
  { uuid: 'chr-xiaoyue', name: '小月', type: 'character', modality: 'image', emoji: '👧', scope: 'series',
    desc: '女孩 · 主角', reuses: 3, tags: ['主角', '人类'], views: ['front', 'side', '3quarter'],
    model: 'jimeng-5.0', seed: 'yue-4419', voice: 'voice-xiaoyue', prompt: '十岁女孩,短发,温柔倔强' },
  // 服装
  { uuid: 'cst-school', name: '校服', type: 'costume', modality: 'image', emoji: '👘', scope: 'series',
    desc: '小月的日常装', reuses: 2, tags: ['小月', '日常'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-raincoat', name: '黄色雨衣', type: 'costume', modality: 'image', emoji: '🧥', scope: 'series',
    desc: '雨夜造型', reuses: 1, tags: ['小月', '雨'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-pajama', name: '棉布睡衣', type: 'costume', modality: 'image', emoji: '🩱', scope: 'series',
    desc: '客厅场景', reuses: 1, tags: ['小月', '居家'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-collar', name: '红项圈 + 铃铛', type: 'costume', modality: 'image', emoji: '🎀', scope: 'series',
    desc: '小橘的标志', reuses: 3, tags: ['小橘', '信物'], forChar: 'chr-xiaoju', slot: 'body' },
  { uuid: 'cst-cape', name: '小斗篷', type: 'costume', modality: 'image', emoji: '🧣', scope: 'series',
    desc: '冬季造型', reuses: 0, tags: ['小橘', '冬季'], forChar: 'chr-xiaoju', slot: 'body' },
  // 配饰
  { uuid: 'acc-glasses', name: '圆框眼镜', type: 'accessory', modality: 'image', emoji: '👓', scope: 'series',
    desc: '小月标志性配饰', reuses: 3, tags: ['小月'], forChar: 'chr-xiaoyue', slot: 'accessory' },
  { uuid: 'acc-necklace', name: '海螺项链', type: 'accessory', modality: 'image', emoji: '📿', scope: 'series',
    desc: '妈妈留下的', reuses: 1, tags: ['小月', '信物'], forChar: 'chr-xiaoyue', slot: 'accessory' },
  // 道具
  { uuid: 'prp-umbrella', name: '透明雨伞', type: 'prop', modality: 'image', emoji: '☂️', scope: 'series',
    desc: '雨夜道具', reuses: 2, tags: ['小月', '雨'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-can', name: '猫粮罐头', type: 'prop_consumable', modality: 'image', emoji: '🥫', scope: 'series',
    desc: '消耗品 · 喂小橘', reuses: 2, tags: ['消耗', '小橘'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-bell', name: '小铃铛', type: 'prop_key', modality: 'image', emoji: '🔔', scope: 'series',
    desc: '关键道具 · 信物,贯穿全剧', reuses: 3, tags: ['关键', '信物'], forChar: 'chr-xiaoju', slot: 'hand' },
  { uuid: 'prp-photo', name: '全家福照片', type: 'prop_key', modality: 'image', emoji: '🖼️', scope: 'series',
    desc: '关键道具 · 催泪', reuses: 1, tags: ['关键', '回忆'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-milk', name: '牛奶盒', type: 'prop_consumable', modality: 'image', emoji: '🥛', scope: 'series',
    desc: '消耗品', reuses: 1, tags: ['消耗'], forChar: 'chr-xiaoyue', slot: 'hand' },
  // 场景 + 变体
  { uuid: 'scn-street', name: '城市街道', type: 'scene', modality: 'image', emoji: '🌆', scope: 'series',
    desc: '主场景 · 相遇之地', reuses: 3, tags: ['室外', '主场景'] },
  { uuid: 'scn-living', name: '小月家客厅', type: 'scene', modality: 'image', emoji: '🛋️', scope: 'series',
    desc: '室内 · 温馨', reuses: 2, tags: ['室内'] },
  { uuid: 'sv-street-day', name: '街道·日', type: 'scene_variant', modality: 'image', emoji: '☀️', scope: 'series',
    variantOf: 'scn-street', desc: '晴朗午后', tags: ['日', '室外'],
    diff: { 光照: '自然光 高', 色温: '5600K 中性', 氛围: '明朗' } },
  { uuid: 'sv-street-night', name: '街道·夜', type: 'scene_variant', modality: 'image', emoji: '🌙', scope: 'series',
    variantOf: 'scn-street', desc: '雨夜霓虹', tags: ['夜', '室外'],
    diff: { 光照: '霓虹+路灯 低', 色温: '3200K 暖', 氛围: '孤寂' } },
  { uuid: 'sv-street-rain', name: '街道·雨', type: 'scene_variant', modality: 'image', emoji: '🌧️', scope: 'series',
    variantOf: 'scn-street', desc: '大雨滂沱', tags: ['雨', '夜'],
    diff: { 光照: '冷蓝 低', 色温: '7500K 冷', 氛围: '压抑→希望' } },
  { uuid: 'sv-living-day', name: '客厅·日', type: 'scene_variant', modality: 'image', emoji: '🔆', scope: 'series',
    variantOf: 'scn-living', desc: '白天', tags: ['日', '室内'],
    diff: { 光照: '窗光 高', 色温: '5500K', 氛围: '温馨' } },
  { uuid: 'sv-living-night', name: '客厅·夜', type: 'scene_variant', modality: 'image', emoji: '🛌', scope: 'series',
    variantOf: 'scn-living', desc: '台灯夜', tags: ['夜', '室内'],
    diff: { 光照: '台灯 中', 色温: '2700K 暖橙', 氛围: '亲密' } },
  // 风格 / 音频
  { uuid: 'sty-warm', name: '暖调电影感', type: 'style', modality: 'text', emoji: '🎨', scope: 'series',
    desc: '全剧美术宪法', reuses: 3, tags: ['风格', '锁定'] },
  { uuid: 'aud-xjvoice', name: '小橘声纹', type: 'audio', modality: 'audio', emoji: '🎙️', scope: 'series',
    desc: '喵叫 + 拟人配音', reuses: 3, tags: ['声纹', '小橘'] },
]

/** 默认装备关系（含两套搭配预设） */
export const COMPOSITIONS: Composition[] = [
  // 默认造型
  { a: 'chr-xiaoyue', b: 'cst-school', rel: 'wears', slot: 'body', loadout: '默认造型' },
  { a: 'chr-xiaoyue', b: 'acc-glasses', rel: 'wears', slot: 'accessory', loadout: '默认造型' },
  { a: 'chr-xiaoyue', b: 'prp-umbrella', rel: 'holds', slot: 'hand', loadout: '默认造型' },
  { a: 'chr-xiaoju', b: 'cst-collar', rel: 'wears', slot: 'body', loadout: '默认造型' },
  // 雨夜造型
  { a: 'chr-xiaoyue', b: 'cst-raincoat', rel: 'wears', slot: 'body', loadout: '雨夜造型' },
  { a: 'chr-xiaoyue', b: 'acc-glasses', rel: 'wears', slot: 'accessory', loadout: '雨夜造型' },
  { a: 'chr-xiaoyue', b: 'prp-umbrella', rel: 'holds', slot: 'hand', loadout: '雨夜造型' },
  // 出场关系
  { a: 'prp-bell', b: 'scn-street', rel: 'appears_in' },
  { a: 'prp-bell', b: 'scn-living', rel: 'appears_in' },
  { a: 'chr-xiaoju', b: 'scn-street', rel: 'appears_in' },
  { a: 'chr-xiaoju', b: 'scn-living', rel: 'appears_in' },
  { a: 'prp-photo', b: 'scn-living', rel: 'appears_in' },
]

export const DEFAULT_LOADOUTS = ['默认造型', '雨夜造型']

// ─── 类型目录（左栏树） ───────────────────────────────────
export interface TypeGroupItem { t: AssetType; ic: string; n: string }
export interface TypeGroup { group: string; items: TypeGroupItem[] }

export const TYPE_GROUPS: TypeGroup[] = [
  { group: '角色相关', items: [
    { t: 'character', ic: '👤', n: '角色' },
    { t: 'costume', ic: '👘', n: '服装' },
    { t: 'accessory', ic: '💍', n: '配饰' },
  ]},
  { group: '场景相关', items: [
    { t: 'scene', ic: '🌆', n: '场景' },
    { t: 'scene_variant', ic: '🌗', n: '场景变体' },
  ]},
  { group: '道具相关', items: [
    { t: 'prop', ic: '📦', n: '道具' },
    { t: 'prop_key', ic: '🗝️', n: '关键道具' },
    { t: 'prop_consumable', ic: '🥫', n: '消耗品' },
  ]},
  { group: '其他', items: [
    { t: 'style', ic: '🎨', n: '风格' },
    { t: 'audio', ic: '🎵', n: '音频' },
  ]},
]

export const TYPE_LABEL: Record<AssetType, string> = {
  character: '角色', costume: '服装', accessory: '配饰',
  scene: '场景', scene_variant: '场景变体',
  prop: '道具', prop_key: '关键道具', prop_consumable: '消耗品',
  style: '风格', audio: '音频',
  // 粗粒度（现网 registry 真实数据）
  clip: '片段', voice: '声纹', video: '视频', storyboard: '分镜',
  storyboard_board: '分镜板',
  script_phase: '剧本', outline: '大纲', topic: '选题', delivery: '交付',
  // Notion 文档型 DB type（08-24 缺口②：此前不在映射 → 卡片/详情 typetag 空白）
  script: '剧本', story: '故事框架', requirement: '创作需求', document: '文档',
}

export const SLOT_LABEL: Record<EquipSlot, string> = {
  head: '头饰', body: '服装', accessory: '配饰', hand: '手持道具', feet: '足部',
}

/** 作用域 → 中文（资产库 scope 分段用）。 */
export const SCOPE_LOOKUP: Record<AssetScope, string> = {
  library: '全局库', series: '系列', project: '项目',
}

// ─── 纯函数 helper ────────────────────────────────────────
export const assetByUuid = (uuid: string): AssetItem | undefined =>
  ASSETS.find((a) => a.uuid === uuid)

export const allTags = (): string[] =>
  [...new Set(ASSETS.flatMap((a) => a.tags ?? []))].sort()

/** 模态色 CSS 变量名 */
export const modalityVar = (m: AssetModality): string =>
  ({ image: '--cv-mod-image', text: '--cv-mod-text', audio: '--cv-mod-audio', video: '--cv-mod-video' })[m]
export const modalityWeakVar = (m: AssetModality): string => modalityVar(m) + '-weak'

// ─── 真实 API 数据映射（assets-registry → AssetItem） ──────
//
// 现网 /api/v1/assets-registry 返回粗粒度 type + filePath（JOIN o_image）。
// 这里把 AssetDetail 映射成统一的 AssetItem，使资产库/详情视图既能吃真实数据，
// 又复用既有渲染。emoji/modality 由 type 派生（真实资产无 emoji 字段）。

/** 粗/细 type → 模态色。视觉类=青、文本类=金、音频=橙、视频=玫。 */
export function modalityOfType(type: string): AssetModality {
  if (['voice', 'audio'].includes(type)) return 'audio'
  if (['video', 'clip'].includes(type)) return 'video'
  if ([
    'script_phase', 'outline', 'topic', 'style', 'delivery', 'storyboard_board',
    // Notion 文档型 DB type（08-24 缺口②：此前落 image → 文字资产误染青色）
    'script', 'story', 'requirement', 'document',
  ].includes(type)) return 'text'
  return 'image' // character/scene/prop/costume/accessory/storyboard/...
}

/** type → 展示用 emoji（真实资产无 emoji，按类型给默认图标）。 */
export function emojiOfType(type: string): string {
  const map: Record<string, string> = {
    character: '👤', scene: '🌆', scene_variant: '🌗', prop: '📦', prop_key: '🗝️',
    prop_consumable: '🥫', costume: '👘', accessory: '💍', style: '🎨', audio: '🎵',
    voice: '🎙️', video: '🎬', clip: '🎞️', storyboard: '🎬', script_phase: '📝',
    outline: '🗂️', topic: '💡', delivery: '📦', storyboard_board: '📜',
    script: '📝', story: '📐', requirement: '📋', document: '📄',
  }
  return map[type] ?? '📦'
}

/** 真实资产资产库左栏用的粗粒度类型树（按现网实际 type 分组）。 */
export const REAL_TYPE_GROUPS: TypeGroup[] = [
  { group: '角色 / 场景 / 道具', items: [
    { t: 'character', ic: '👤', n: '角色' },
    { t: 'scene', ic: '🌆', n: '场景' },
    { t: 'prop', ic: '📦', n: '道具' },
  ]},
  { group: '媒体产物', items: [
    { t: 'video', ic: '🎬', n: '视频' },
    { t: 'audio', ic: '🎵', n: '音频' },
    { t: 'voice', ic: '🎙️', n: '声纹' },
    { t: 'storyboard', ic: '🎬', n: '分镜' },
    { t: 'clip', ic: '🎞️', n: '片段' },
  ]},
  { group: '文本产物', items: [
    { t: 'script_phase', ic: '📝', n: '剧本' },
    { t: 'storyboard_board', ic: '📜', n: '分镜板' },
    { t: 'outline', ic: '🗂️', n: '大纲' },
    { t: 'topic', ic: '💡', n: '选题' },
    { t: 'delivery', ic: '📦', n: '交付' },
  ]},
]

/** 真实 registry 的 AssetDetail → 统一 AssetItem（资产库/详情消费）。 */
export function assetDetailToItem(d: AssetDetail): AssetItem {
  const type = (d.type || 'prop') as AssetType
  const tags = d.tags ? d.tags.split(',').map((s) => s.trim()).filter(Boolean) : []
  // model 回退链：顶层 model 列 → meta.model_version（灰底/换装 turnaround 走 meta）
  let model = d.model ?? undefined
  if (!model && d.meta) {
    try {
      const metaObj = typeof d.meta === 'string' ? JSON.parse(d.meta) : d.meta
      const mv = metaObj?.model_version ?? metaObj?.model
      if (mv) model = String(mv)
    } catch { /* meta 非 JSON，忽略 */ }
  }
  return {
    uuid: d.uuid || `id-${d.id}`,
    name: d.name || '未命名资产',
    type,
    modality: modalityOfType(type),
    emoji: emojiOfType(type),
    scope: d.projectId == null ? 'library' : 'project',
    desc: d.describe ?? undefined,
    tags,
    model,
    prompt: d.prompt ?? undefined,
    views: type === 'scene' ? ['overview', 'wide', 'close'] : ['front', 'side', 'back'],
    id: d.id,
    filePath: d.filePath ?? undefined,
    characterId: d.characterId ?? undefined,
    viewAngle: d.viewAngle ?? undefined,
    source: 'real',
    isPrimaryView: d.isPrimaryView ?? false,
    meta: d.meta,
  }
}

/** 取全部真实资产的标签集合（资产库标签筛选用）。 */
export function realTags(items: AssetItem[]): string[] {
  return [...new Set(items.flatMap((a) => a.tags ?? []))].sort()
}

// ─── 层级推断（纯前端，不改后端） ─────────────────────────

/** 资产层级 */
export type AssetLevel = 'show' | 'scene' | 'shot' | 'pipeline'

/**
 * 资产子类型（从现有数据推断）—— 对应 Kai 管线链条的各阶段产物。
 * 链条：①设定图 → ②灰底Turnaround → ③场景设定 → ④场景三视角 → ⑤分镜
 *       → ⑥场景角度图 → ⑦人物定妆Turnaround → ⑧首帧 → ⑨尾帧
 */
export type AssetSubtype =
  | 'character_concept'    // ① 角色设定图（全剧级，非 turnaround 的 character 资产）
  | 'character_bible'      // 角色文字设定（Notion 导入的纯文本 character 资产，无 filePath/图）
  // ── Notion 文档型资产（8 类，复用既有 DB type，靠 meta.subtype 区分）──
  // requirement/story/script/scene/character(服化道)/voice/audio(BGM) 各承载一类创意文档。
  | 'pipeline_requirement' // 创作需求（DB type='requirement'，前端避开 type 名混淆用 pipeline_ 前缀）
  | 'story_framework'      // 故事框架（DB type='story'）
  | 'episode_script'       // 分集剧本（DB type='script'）
  | 'scene_design'         // 场景设定文档（DB type='scene'，文字描述，区别于 scene_base 图）
  | 'costume_design'       // 服化道设定（DB type='character'，按 characterId 归属角色）
  | 'voice_profile'        // 音色总谱（DB type='voice'，区别于单条声纹 voice_print）
  | 'bgm_design'           // BGM 总谱（DB type='audio'，区别于 BGM 音轨 bgm_track）
  | 'turnaround_sheet'     // ② 灰底紧身衣 Turnaround 整图（全剧级身份锚点，viewAngle=null）
  | 'turnaround_view'      // Turnaround 拆分视角（全剧级，viewAngle=front/side/back/three_quarter）
  | 'scene_base'           // ③ 场景设定图（场景级，如「宴会厅 v1」）
  // @deprecated 三视角（多视角方案）已废弃，每个场景只保留一张场景设定图。
  // 仅保留联合成员以避免其它引用处报类型错误，前端不再产生此子类型。
  | 'scene_three_view'
  | 'scene_angle_shot'     // ⑥ 场景角度图（分镜级，scene_refs 目录，S0X_front/angle_left/angle_right）
  | 'scene_variant'        // 场景变体（场景级，旧兜底）
  | 'costume_turnaround'   // ⑦ 人物定妆 Turnaround（分镜级，参考②+⑤ —— 管线尚未产出，前端预留识别）
  | 'keyframe_first'       // ⑧ 首帧（分镜级）
  | 'keyframe_last'        // ⑨ 尾帧（分镜级）
  // ── Notion「首尾帧设计」新资产类型占位（§1.1c / §1.2 / §2d / §5）──
  // 复用现有 DB type，用 meta.subtype 区分（不新建表）。管线尚未实装生成，
  // 前端先建立识别 + 分类体系，待后端产出后自动归位。
  | 'scene_blueprint'          // 场景蓝图（空间结构+灭点+地标坐标）—— Notion §1.2a
  | 'scene_temporal_variant'   // 场景时空变体（时段/天气）—— Notion §1.2b
  | 'scene_view_angle'         // 场景视角矩阵（扩展角度 EST/MAST/REV/OTS/LOW/HIGH/POV/DET）—— Notion §1.2c
  | 'costume_temporal_variant' // 服化道时段变体（日/夜/黄昏）—— Notion §1.1c
  | 'midframe'                 // 关键中间帧（长镜头 >8s 的中间精确卡位）—— Notion §2d
  | 'foley_stem'               // Foley 独立音轨 —— Notion §5c
  | 'bgm_track'                // BGM 音轨 —— Notion §5d
  | 'voice_print'              // 声纹（角色声纹参考，type='voice'）
  // ── 管线产出（P06 时空剧本及后续阶段） ──
  | 'spatio_temporal_script'  // P06 时空剧本（逐镜头导演意图表）
  | 'shot_list'               // P09 分镜列表（技术分镜参数）
  | 'e_konte'                 // P09 E-Konte（分镜表）
  | 'voice_clips'             // P10 语音片段（TTS 对白音频）
  | 'rapid_preview'           // P10b 快速预览（粗剪视频）
  | 'video_clips'             // P11 视频片段（单镜渲染视频）
  | 'master_timeline'         // P12 合成母版（音视频合成）
  | 'audio_stems'             // P12 音频混音轨
  | 'master_mp4'              // P13 交付成品
  | 'delivery_package'        // P13 交付包
  | 'unknown'

// ─── 扩展视角矩阵（Notion 场景视角 §1.2c） ──────────────────
// 现有场景仅 3-view（front/angle_left/angle_right）。Notion 要求建立分类体系，
// 让未来的扩展角度（室内 8 角度 / 室外 7 角度）可以归位 —— 不强制生成全部。
/** 扩展视角类型（Notion 场景视角矩阵）—— 现有 3-view + 室内/室外扩展角度。 */
export const EXTENDED_VIEW_ANGLES = {
  // 现有 3-view（保留以便统一查标签）
  front: '前视', angle_left: '左侧', angle_right: '右侧',
  // 室内扩展
  est: '全景', mast: '主视角', rev: '反打', ots: '过肩',
  low: '低角度', high: '高角度', pov: '主观视角', det: '特写背景',
} as const

/** 扩展视角枚举键（用于 scene_view_angle 推断，不含现有 3-view）。 */
export const EXTENDED_VIEW_ANGLE_KEYS = [
  'est', 'mast', 'rev', 'ots', 'low', 'high', 'pov', 'det',
] as const

/** 室内可用角度矩阵（Notion §1.2c：室内 8 角度）。 */
export const INDOOR_ANGLES = ['est', 'mast', 'rev', 'ots', 'low', 'high', 'pov', 'det'] as const
/** 室外可用角度矩阵（Notion §1.2c：室外 7 角度，无 low 低角度）。 */
export const OUTDOOR_ANGLES = ['est', 'mast', 'rev', 'ots', 'high', 'pov', 'det'] as const

/**
 * 从 AssetDetail.meta（JSON 字符串）解析 ``meta.subtype``。
 *
 * Notion 新资产类型（scene_blueprint / midframe / foley_stem ...）复用现有 DB
 * type，靠 meta.subtype 区分。返回 subtype 字符串，缺失/无法解析时返回 null。
 * 函数声明（function declaration）会被提升，inferLevel/inferSubtype/
 * inferSubtypeFromItem 均可安全调用。
 */
function parseMetaSubtype(meta?: string | null): string | null {
  if (!meta) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return null
  }
  if (parsed && typeof parsed === 'object') {
    const sub = (parsed as Record<string, unknown>).subtype
    if (typeof sub === 'string' && sub.trim()) return sub.trim()
  }
  return null
}

/** 从 AssetDetail 推断层级 */
export function inferLevel(d: AssetDetail): AssetLevel {
  if (d.type === 'keyframe') return 'shot'
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') return 'scene'
  // ── Notion 新资产类型层级推断（按 meta.subtype / type 归位）──
  const sub = parseMetaSubtype(d.meta)
  if (sub === 'midframe' || sub === 'costume_temporal_variant' || sub === 'costume_turnaround') return 'shot'
  if (sub === 'foley_stem' || sub === 'bgm_track') return 'scene' // 音轨按场景级归类
  // ── Notion 文档型资产层级（全剧级创意文档）──
  // requirement/story_framework/episode_script/costume_design/voice_profile 默认即 'show'，
  // 但 bgm_design 的 DB type='audio' 会被下方 audio→scene 误归场景级，故在此显式归全剧。
  // episode_script 虽是分集级，但 AssetLevel 无独立 episode 层 → 归全剧。
  // scene_design（type='scene'）已由上方 type 检查归入 'scene'。
  if (sub === 'requirement' || sub === 'story_framework' || sub === 'episode_script' ||
      sub === 'costume_design' || sub === 'voice_profile' || sub === 'bgm_design') {
    return 'show'
  }
  if (d.type === 'audio') return 'scene'
  // ── 管线产出层级（P06+ 的文本/视频/音频产物）──
  if (d.type === 'script_phase' || d.type === 'outline' || d.type === 'topic' ||
      d.type === 'video' || d.type === 'clip' || d.type === 'delivery') {
    return 'pipeline'
  }
  return 'show'  // character 默认全剧级
}

/** 从 AssetDetail 推断子类型 */
export function inferSubtype(d: AssetDetail): AssetSubtype {
  const metaSub = parseMetaSubtype(d.meta)

  // ── Notion 文档型资产（8 类创意文档，复用既有 DB type，靠 meta.subtype 区分）──
  // 必须在按 type 分支判定之前短路：这些资产跨多个 DB type，否则会被各自 type 分支
  // 误判——voice_profile→voice_print、scene_design→scene_base、costume_design→
  // character_concept/bible、bgm_design→unknown、episode_script/story/requirement→unknown。
  // requirement 在前端用 pipeline_requirement（避开与 DB type 名 'requirement' 混淆）。
  if (metaSub === 'requirement') return 'pipeline_requirement'
  if (metaSub === 'story_framework') return 'story_framework'
  if (metaSub === 'episode_script') return 'episode_script'
  if (metaSub === 'scene_design') return 'scene_design'
  if (metaSub === 'costume_design') return 'costume_design'
  if (metaSub === 'voice_profile') return 'voice_profile'
  if (metaSub === 'bgm_design') return 'bgm_design'
  // 报告/审计类交付包（62-07 收尾修复）：真实报告类资产 DB type='document'（无图），
  // meta.subtype='delivery_package' 标注——此前两路都不命中落 'unknown'，
  // PHASE_BY_SUBTYPE 查表（P13 + reportAudit:true）永不可达，D-03 单件桶排除面失效。
  // 短路表补键 + 下方 type==='document' 兜底分支双路命中。
  if (metaSub === 'delivery_package') return 'delivery_package'
  // character_bible（type=character，无图）由下方 character 分支按 !filePath 判定。

  // ── 音频：Foley / BGM 独立音轨（Notion §5c/§5d，复用 audio DB type）──
  if (d.type === 'audio') {
    if (metaSub === 'foley_stem') return 'foley_stem'
    if (metaSub === 'bgm_track') return 'bgm_track'
    // P12b 混音产物：meta.subtype 标记（audio_stems/mix/ambient）或名称/标签
    // 线索 —— 此前一律落 unknown，树「混音音轨」永远 count=0。
    if (metaSub === 'audio_stems' || metaSub === 'mix') return 'audio_stems'
    if (metaSub === 'ambient') return 'foley_stem' // 环境底床归 Foley 类（与 sfx→foley 同语义）
    const tags = (d.tags || '').toLowerCase()
    const nm = (d.name || '').toLowerCase()
    if (tags.includes('foley') || tags.includes('ambient') || tags.includes('环境')) return 'foley_stem'
    if (tags.includes('bgm')) return 'bgm_track'
    if (tags.includes('mix') || nm.includes('master') || nm.includes('混音')) return 'audio_stems'
    return 'unknown'
  }

  // ── 声纹（角色声纹参考）：type='voice' 或 meta.subtype='voice_print'
  if (d.type === 'voice' || metaSub === 'voice_print') {
    return 'voice_print'
  }

  if (d.type === 'character') {
    const fp = (d.filePath || '').toLowerCase()
    const nm = (d.name || '').toLowerCase()
    const tags = (d.tags || '').toLowerCase()
    // ⑦服化道时段变体（Notion §1.1c）：优先于定妆 turnaround 判定
    if (metaSub === 'costume_temporal_variant' || tags.includes('costume_temporal')) {
      return 'costume_temporal_variant'
    }
    // ⑦ 人物定妆/换装 Turnaround：路径/名称/标签/meta 含 costume 标识
    // 放在最前：定妆 turnaround 是分镜级产物，优先于全剧级 turnaround 整图判定。
    const cm = parseCostumeMeta(d.meta)
    if (
      fp.includes('costume_turnaround') || fp.includes('costume-tr') ||
      nm.includes('costume_turnaround') || nm.includes('定妆turnaround') ||
      nm.includes('换装') || tags.includes('costume_turnaround') ||
      (cm.costumeSet && cm.costumeSet !== 'daily_baseline' && cm.costumeSet !== 'work_baseline')
    ) {
      return 'costume_turnaround'
    }
    // viewAngle=front/side/back/three_quarter = 从 turnaround 整图裁出的拆分视角图
    if (d.viewAngle && ['front', 'side', 'back', 'three_quarter'].includes(d.viewAngle as string)) {
      return 'turnaround_view'
    }
    // ② 灰底Turnaround（独立产出）：name 含 "灰底Turnaround" 或 filePath 匹配 turnaround_*.png（非 base_ 前缀）
    if (
      nm.includes('灰底turnaround') ||
      (fp.includes('turnaround_sheets/turnaround_') && !fp.includes('base_turnaround'))
    ) {
      return 'turnaround_sheet'
    }
    // 纯文本角色设定（Notion 导入，无 filePath/图）：不归为角色设定图（①），
    // 避免无图资产混入「角色设定图」分类、显示灰色 emoji 占位符。
    if (!d.filePath) {
      return 'character_bible'
    }
    // 其余 character + 有图 = 角色设定图（①）
    return 'character_concept'
  }
  if (d.type === 'keyframe') {
    // 关键中间帧（Notion §2d）：长镜头 >8s 的中间精确卡位帧
    if (metaSub === 'midframe') return 'midframe'
    const nm = (d.name || '').toLowerCase()
    if (nm.includes('midframe') || nm.includes('中间帧')) return 'midframe'
    return (d.name || '').includes('_first_') || (d.name || '').includes('first') ? 'keyframe_first' : 'keyframe_last'
  }
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    const fp = (d.filePath || '').toLowerCase()
    const nm = (d.name || '').toLowerCase()
    // 场景蓝图（Notion §1.2a）：空间结构 + 灭点 + 地标坐标（JSON 结构化资产）
    if (metaSub === 'scene_blueprint' || nm.includes('场景蓝图') || fp.includes('scene_blueprint')) {
      return 'scene_blueprint'
    }
    // 场景时空变体（Notion §1.2b）：同一场景的时段/天气变体
    if (metaSub === 'scene_temporal_variant' || fp.includes('temporal_variant') || nm.includes('时空变体')) {
      return 'scene_temporal_variant'
    }
    // 场景视角矩阵扩展角度（Notion §1.2c）：EST/MAST/REV/OTS/LOW/HIGH/POV/DET
    if (
      metaSub === 'scene_view_angle' ||
      (d.viewAngle && (EXTENDED_VIEW_ANGLE_KEYS as readonly string[]).includes(d.viewAngle as string))
    ) {
      return 'scene_view_angle'
    }
    // ⑥ 场景角度图（分镜级）：名称含「场景角度图」/ 文件名 S0X_front|angle_*（不含 scene_refs 的）
    if (
      nm.includes('场景角度图') ||
      fp.includes('scene_angle') ||
      /\bs\d+_(front|angle_left|angle_right)\b/.test(fp)
    ) {
      return 'scene_angle_shot'
    }
    // ③ 场景设定图（场景级，如「宴会厅 v1」）
    return 'scene_base'
  }
  // ── 管线产出子类型推断（P06+）──
  if (d.type === 'script_phase' || d.type === 'outline' || d.type === 'topic') {
    // P06 时空剧本：name/describe/tags 含 spatio/temporal/时空
    const nm = (d.name || '').toLowerCase()
    const tags = (d.tags || '').toLowerCase()
    if (nm.includes('spatio') || nm.includes('时空') || tags.includes('spatio-temporal')) return 'spatio_temporal_script'
    return 'unknown'
  }
  if (d.type === 'storyboard') {
    const nm = (d.name || '').toLowerCase()
    if (nm.includes('e-konte') || nm.includes('ekonte') || nm.includes('econte')) return 'e_konte'
    return 'shot_list'
  }
  if (d.type === 'video') {
    return 'video_clips'
  }
  if (d.type === 'clip') {
    const nm = (d.name || '').toLowerCase()
    const tags = (d.tags || '').toLowerCase()
    if (nm.includes('master') || tags.includes('master') || nm.includes('合成') || tags.includes('composition')) return 'master_timeline'
    if (nm.includes('preview') || tags.includes('preview') || nm.includes('预览')) return 'rapid_preview'
    return 'video_clips'
  }
  if (d.type === 'delivery') {
    const nm = (d.name || '').toLowerCase()
    if (nm.includes('package') || nm.includes('包')) return 'delivery_package'
    return 'master_mp4'
  }
  if (d.type === 'document') {
    // 文档型报告资产兜底（62-07）：type='document' 未带 subtype 时仍按报告/审计类
    // 交付包归类（PHASE_BY_SUBTYPE P13 + reportAudit=true → 不进单件桶显式节点，
    // 计入域 total——D-03）。
    return 'delivery_package'
  }
  // ── Notion 文档型资产裸 type 兜底 ──
  // meta.subtype 短路表在上面；此处兜住「DB type 对但 meta.subtype 缺失」的行
  //（否则落 'unknown'，树计数/阅读器门控全失效）。
  if (d.type === 'script') return 'episode_script'
  if (d.type === 'story') return 'story_framework'
  if (d.type === 'requirement') return 'pipeline_requirement'
  return 'unknown'
}

// ─── Turnaround 整图方向检测 ───────────────────────────────
//
// Turnaround（灰底紧身衣4视角合一参考图）有两种布局：
//   - portrait  (竖屏 9:16): 4-panel vertical stack, 典型 1440×2560 ← 竖屏短剧达标
//   - landscape (横屏 16:9): 4-panel horizontal-row, 典型 2560×1440 ← 不达标
// 当前项目是竖屏短剧（9:16），所以 turnaround 应为 portrait。
// 尺寸来源：canvas_nodes / o_assets.meta JSON 中的 sheetWidth / sheetHeight 字段。

/** Turnaround 整图方向（由 sheetWidth/sheetHeight 推断）。 */
export type TurnaroundOrientation = 'portrait' | 'landscape' | 'unknown'

/** 竖屏达标比例（9:16）的容差：aspect 在 [MIN_PORTRAIT_AR, MAX_PORTRAIT_AR] 内视为 portrait 达标。 */
const PORTRAIT_AR = 9 / 16        // 0.5625
const PORTRAIT_AR_TOLERANCE = 0.12 // ±12% 容差（允许 0.495 ~ 0.630）
const MIN_PORTRAIT_AR = PORTRAIT_AR * (1 - PORTRAIT_AR_TOLERANCE)
const MAX_PORTRAIT_AR = PORTRAIT_AR * (1 + PORTRAIT_AR_TOLERANCE)

export interface TurnaroundSheetValidation {
  orientation: TurnaroundOrientation
  /** 当前项目（竖屏短剧）是否达标：portrait=达标, landscape/unknown=不达标。 */
  compliant: boolean
  /** 实际宽高比（width/height），unknown 时为 null。 */
  aspectRatio: number | null
  /** 检测到的尺寸（可能 undefined）。 */
  width?: number
  height?: number
}

/**
 * 校验 Turnaround 整图方向是否达标（竖屏短剧需 portrait）。
 *
 * 判定逻辑：
 *   - width/height 缺失或非正数 → unknown（无法判定）
 *   - width < height → portrait（竖屏，达标）
 *   - width > height → landscape（横屏，不达标）
 *   - width === height → 按 aspectRatio 进一步判定，方图归 unknown
 *
 * @example
 *   validateTurnaroundSheet(1440, 2560) // → portrait, compliant=true
 *   validateTurnaroundSheet(2560, 1440) // → landscape, compliant=false
 *   validateTurnaroundSheet(undefined, undefined) // → unknown, compliant=false
 */
export function validateTurnaroundSheet(
  width?: number,
  height?: number,
): TurnaroundSheetValidation {
  // 尺寸缺失或非法 → 无法判定
  if (
    typeof width !== 'number' || typeof height !== 'number' ||
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0
  ) {
    return { orientation: 'unknown', compliant: false, aspectRatio: null }
  }

  const ar = width / height

  // 宽 < 高 → 竖屏（portrait），达标
  if (width < height) {
    return { orientation: 'portrait', compliant: true, aspectRatio: ar, width, height }
  }
  // 宽 > 高 → 横屏（landscape），不达标
  if (width > height) {
    return { orientation: 'landscape', compliant: false, aspectRatio: ar, width, height }
  }
  // 宽 === 高（方图）：若 aspectRatio 落在 portrait 容差内算达标，否则 unknown
  // 实际上方图 ar=1 不可能落在 [0.495, 0.630]，所以归 unknown
  if (ar >= MIN_PORTRAIT_AR && ar <= MAX_PORTRAIT_AR) {
    return { orientation: 'portrait', compliant: true, aspectRatio: ar, width, height }
  }
  return { orientation: 'unknown', compliant: false, aspectRatio: ar, width, height }
}

/**
 * 从 AssetDetail.meta（JSON 字符串）解析 turnaround 整图的 sheetWidth/sheetHeight。
 *
 * canvas_nodes / o_assets.meta JSON 中 turnaround sheet 节点形如：
 *   { "sheetWidth": 1440, "sheetHeight": 2560, "isTurnaroundSheet": true, ... }
 *
 * 兼容多种字段命名（sheetWidth/sheet_width/sheetW）以应对后端命名差异。
 * 返回 [width, height]，无法解析时返回 [undefined, undefined]。
 */
export function parseTurnaroundSheetSize(meta?: string | null): [number | undefined, number | undefined] {
  if (!meta) return [undefined, undefined]
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return [undefined, undefined]
  }
  if (!parsed || typeof parsed !== 'object') return [undefined, undefined]
  const obj = parsed as Record<string, unknown>
  // 宽：sheetWidth / sheet_width / sheetW / width
  const w = obj.sheetWidth ?? obj.sheet_width ?? obj.sheetW ?? obj.width
  // 高：sheetHeight / sheet_height / sheetH / height
  const h = obj.sheetHeight ?? obj.sheet_height ?? obj.sheetH ?? obj.height
  const width = typeof w === 'number' ? w : (typeof w === 'string' ? Number(w) : undefined)
  const height = typeof h === 'number' ? h : (typeof h === 'string' ? Number(h) : undefined)
  return [
    Number.isFinite(width) ? width : undefined,
    Number.isFinite(height) ? height : undefined,
  ]
}

// ─── 服装变体（Costume Variants） ───────────────────────────
//
// 同一角色在不同分场/场景穿不同服装（如沈知意：宴会基线 / 日常基线 / 闪回）。
// 不新建表 —— 服装信息存在 o_assets.meta JSON：
//   {
//     "costume_set":   "daily_baseline",          // 套系 ID（同一角色内唯一）
//     "costume_label": "日常基线",                  // 显示名
//     "costume_desc":  "白丝质衬衫+黑高腰西裤",      // 服装描述
//     "scene_refs":    ["S02", "S03", "S07"]       // 适用场景 ID 列表
//   }
// meta.costume_set 区分同一角色的不同套系；scene_refs 建立服装→场景映射，
// 驱动「角色 → 服装套系 → 适用场景 → 分镜镜头」的关系链。
//
// 后端无需改动：POST /api/v1/assets/update-meta 端点会合并 meta（非整体替换），
// 适合增量写入服装字段。meta 字段也已在 PATCH /:id 的允许列表中。

/** 默认套系 ID：无 meta.costume_set 的 turnaround 资产归入此套系（label='基线'）。 */
export const DEFAULT_COSTUME_SET_ID = '__default__'

/**
 * 判定一个 character 资产是否为「灰底 Turnaround」（保持人物一致性的基础中间态）。
 *
 * 识别条件（满足其一即判定为灰底基础参考，不参与生产场景）：
 *   - inferSubtype === 'turnaround_sheet'（② 灰底紧身衣 Turnaround 整图）
 *   - meta.is_grey_base === true
 *   - meta.costume_set === 'grey_base'
 *   - name/filePath 含 '灰底'/'grey'（兜底）
 *
 * 灰底 turnaround 是人物一致性的基础中间态：
 *   1. 不应出现在服装套系分组中（它是基础参考，不是服装变体）；
 *   2. 不会出现在生产场景中；
 *   3. 是唯一的「基线」（其他服装资产按 costume_set 区分为宴会/日常/职场…变体）。
 */
export function isGreyBaseTurnaround(a: AssetDetail): boolean {
  const subtype = inferSubtype(a)
  if (subtype === 'turnaround_sheet') return true
  const cm = parseCostumeMeta(a.meta)
  if (cm.costumeSet === 'grey_base') return true
  const nm = (a.name || '').toLowerCase()
  const fp = (a.filePath || '').toLowerCase()
  if (nm.includes('灰底') || nm.includes('grey') || fp.includes('grey_base')) return true
  // meta.is_grey_base（驼峰）/ is_grey_base（下划线）
  if (a.meta) {
    try {
      const o = JSON.parse(a.meta)
      if (o && typeof o === 'object' && (o.is_grey_base === true || o.isGreyBase === true)) return true
    } catch { /* ignore */ }
  }
  return false
}

/** 从 AssetDetail.meta 解析出的服装变体信息。 */
export interface CostumeMeta {
  /** 套系 ID（缺失 → null，归入默认套系）。 */
  costumeSet: string | null
  /** 显示名（如「日常基线」）。 */
  costumeLabel: string | null
  /** 服装描述（如「白丝质衬衫+黑高腰西裤」）。 */
  costumeDesc: string | null
  /** 适用场景 ID 列表（如 ["S02","S03"]）。 */
  sceneRefs: string[]
}

/**
 * 从 o_assets.meta（JSON 字符串）解析服装变体信息。
 *
 * 兼容驼峰 / 下划线两种字段命名（costume_set / costumeSet 等）。
 * 无法解析或字段缺失时返回空值（costumeSet=null, sceneRefs=[]）。
 */
export function parseCostumeMeta(meta?: string | null): CostumeMeta {
  const empty: CostumeMeta = { costumeSet: null, costumeLabel: null, costumeDesc: null, sceneRefs: [] }
  if (!meta) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object') return empty
  const o = parsed as Record<string, unknown>
  const cs = o.costume_set ?? o.costumeSet
  const cl = o.costume_label ?? o.costumeLabel
  const cd = o.costume_desc ?? o.costumeDesc
  const sr = o.scene_refs ?? o.sceneRefs
  return {
    costumeSet: typeof cs === 'string' && cs.trim() ? cs.trim() : null,
    costumeLabel: typeof cl === 'string' && cl.trim() ? cl.trim() : null,
    costumeDesc: typeof cd === 'string' && cd.trim() ? cd.trim() : null,
    sceneRefs: Array.isArray(sr) ? sr.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [],
  }
}

/**
 * 从 o_assets.meta（JSON 字符串）解析生成信息。
 *
 * 提取 generation_method / generation_prompt / model_version / source 字段，
 * 用于生成链路展示。无法解析时所有字段为 null。
 */
export interface GenMeta {
  generationMethod: string | null
  generationPrompt: string | null
  modelVersion: string | null
  source: string | null
}

export function parseGenMeta(meta?: string | null): GenMeta {
  const empty: GenMeta = { generationMethod: null, generationPrompt: null, modelVersion: null, source: null }
  if (!meta) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object') return empty
  const o = parsed as Record<string, unknown>
  return {
    generationMethod: typeof o.generation_method === 'string' ? o.generation_method : null,
    generationPrompt: typeof o.generation_prompt === 'string' ? o.generation_prompt : null,
    modelVersion: typeof o.model_version === 'string' ? o.model_version : null,
    source: typeof o.source === 'string' ? o.source : null,
  }
}

/** 一套服装造型（同一角色的一个 costume_set）。 */
export interface CostumeSet {
  /** 套系 ID（meta.costume_set，或 DEFAULT_COSTUME_SET_ID）。 */
  setId: string
  /** 显示名（meta.costume_label，或默认套系='基线'，否则=setId）。 */
  label: string
  /** 服装描述（meta.costume_desc）。 */
  desc: string | null
  /** 是否为默认套系（无 costume_set 的资产）。 */
  isDefault: boolean
  /** 适用场景 ID 列表（合并该套系所有资产的 meta.scene_refs）。 */
  sceneRefs: string[]
  /** 该套系的 Turnaround 整图（灰底 turnaround_sheet 或 costume_turnaround）。 */
  sheet: AssetItem | null
  /** 该套系的拆分视角（turnaround_view：front/side/back/three_quarter）。 */
  views: AssetItem[]
}

/**
 * 按角色 ID 把 turnaround 相关资产分组成若干「服装套系」。
 *
 * 参与分组的资产子类型：
 *   - turnaround_sheet  ② 灰底整图（套系的代表图 / hero image）
 *   - turnaround_view   拆分视角（front/side/back/three_quarter → 四宫格）
 *   - costume_turnaround ⑦ 人物定妆（未来管线产物，按套系归入 sheet）
 *
 * 无 meta.costume_set 的资产归入默认套系（label='基线'）。返回数组默认套系在最前，
 * 其余按 label 排序；空套系（无 sheet 且无拆分视角）会被过滤掉。
 *
 * @param assets      项目级全部资产（useRealAssets 已按 projectId 拉取）
 * @param characterId 角色 ID
 */
export function groupCharacterCostumes(assets: AssetDetail[], characterId: string): CostumeSet[] {
  const bySet = new Map<string, CostumeSet>()
  const ensure = (setId: string, isDefault: boolean): CostumeSet => {
    let s = bySet.get(setId)
    if (!s) {
      s = {
        setId,
        label: isDefault ? '基线' : setId,
        desc: null,
        isDefault,
        sceneRefs: [],
        sheet: null,
        views: [],
      }
      bySet.set(setId, s)
    }
    return s
  }

  for (const a of assets) {
    if (a.type !== 'character') continue
    if ((a.characterId ?? null) !== characterId) continue
    if ((a.state ?? 'active') === 'eliminated') continue
    const subtype = inferSubtype(a)
    // 仅 turnaround 相关资产参与服装分组（概念图①是角色身份锚点，不属服装）
    if (subtype !== 'turnaround_sheet' && subtype !== 'turnaround_view' && subtype !== 'costume_turnaround') continue

    // 灰底 turnaround 是人物一致性的基础中间态，不是服装变体 → 不参与服装套系分组，
    // 由 getCharacterGreyBase 单独提取为「基础/灰底」参考区域。
    if (isGreyBaseTurnaround(a)) continue

    const cm = parseCostumeMeta(a.meta)
    const isDefault = cm.costumeSet == null
    const set = ensure(cm.costumeSet ?? DEFAULT_COSTUME_SET_ID, isDefault)
    if (cm.costumeLabel) set.label = cm.costumeLabel
    if (cm.costumeDesc && !set.desc) set.desc = cm.costumeDesc
    for (const r of cm.sceneRefs) if (!set.sceneRefs.includes(r)) set.sceneRefs.push(r)

    if ((subtype === 'turnaround_sheet' || subtype === 'costume_turnaround') && !set.sheet) {
      set.sheet = assetDetailToItem(a)
    }
    if (subtype === 'turnaround_view') {
      set.views.push(assetDetailToItem(a))
    }
  }

  const sets = [...bySet.values()].filter((s) => s.sheet || s.views.length > 0)
  sets.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.label.localeCompare(b.label, 'zh')
  })
  return sets
}

/**
 * 提取某角色的「灰底 Turnaround」基础参考（人物一致性的基础中间态，独立于服装套系）。
 *
 * 灰底 turnaround 是全剧级身份锚点，保持人物长相/体型一致，不参与生产场景：
 *   - 不应混入服装套系（宴会/日常/职场…）分组；
 *   - 是唯一的「基线」，其他服装资产按 costume_set 区分为变体；
 *   - 在角色管理视图单独展示为「基础 / 灰底」参考区域。
 *
 * 同一角色原则上只有一张灰底 turnaround；若数据异常存在多张，返回第一张（isPrimaryView 优先）。
 *
 * @param assets      项目级全部资产
 * @param characterId 角色 ID
 */
export function getCharacterGreyBase(assets: AssetDetail[], characterId: string): AssetItem | null {
  const matched = assets.filter(
    (a) => a.type === 'character' &&
      (a.characterId ?? null) === characterId &&
      (a.state ?? 'active') !== 'eliminated' &&
      isGreyBaseTurnaround(a),
  )
  if (matched.length === 0) return null
  // isPrimaryView 优先（正式使用版本），再按 name 排序保持稳定
  matched.sort((a, b) => (b.isPrimaryView ? 1 : 0) - (a.isPrimaryView ? 1 : 0) || (a.name || '').localeCompare(b.name || ''))
  return assetDetailToItem(matched[0])
}

/** 角色身份（左栏角色列表用，每角色一条代表图）。 */
export interface CharacterIdentity {
  characterId: string
  item: AssetItem
}

/**
 * 按角色 ID 聚合身份代表图（左栏角色列表用）。
 *
 * 每个角色取一张代表图，优先级：
 *   1. character_concept（isPrimaryView 优先）—— 角色设定图，定义长相/气质
 *   2. turnaround_sheet —— 灰底整图（无概念图时兜底）
 *   3. 该角色的任意一张资产
 *
 * 这样左栏每角色只显示一条（修复旧逻辑把概念图 + 灰底整图都当作独立角色的问题）。
 */
export function groupCharacterIdentities(assets: AssetDetail[]): CharacterIdentity[] {
  const byChar = new Map<string, AssetDetail[]>()
  for (const a of assets) {
    if (a.type !== 'character') continue
    if ((a.state ?? 'active') === 'eliminated') continue
    if (!a.characterId) continue
    if (!byChar.has(a.characterId)) byChar.set(a.characterId, [])
    byChar.get(a.characterId)!.push(a)
  }

  const out: CharacterIdentity[] = []
  for (const [characterId, list] of byChar) {
    const byPv = (a: AssetDetail) => (a.isPrimaryView ? 1 : 0)
    const concept = list
      .filter((a) => inferSubtype(a) === 'character_concept')
      .sort((a, b) => byPv(b) - byPv(a))[0]
    const sheet = list.find((a) => inferSubtype(a) === 'turnaround_sheet')
    const rep = concept ?? sheet ?? list[0]
    out.push({ characterId, item: assetDetailToItem(rep) })
  }
  out.sort((a, b) => a.item.name.localeCompare(b.item.name, 'zh'))
  return out
}

/** 从 AssetDetail 提取 sceneId（场景设定图按场景名分组，分镜按 S 编号） */
export function inferSceneId(d: AssetDetail): string | null {
  // keyframe: name 形如 "S01_first_v1" → 按分镜 S 编号分组
  if (d.type === 'keyframe') {
    const m = (d.name || '').match(/^(S\d+)/i)
    if (m) return m[1]
  }
  // scene: 优先用场景名分组（「宴会厅 v1」→「宴会厅」），便于层级树显示可读场景名；
  //        name 缺失时回退到 filePath 里的 S 编号。
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    const nm = (d.name || '').replace(/\s*v\d+$/i, '').trim()
    if (nm) return nm
    const fn = (d.filePath || '').split('/').pop() || ''
    const m = fn.match(/S(\d+)/i)
    if (m) return `S${m[1].padStart(2, '0')}`
    return null
  }
  return null
}

/** 从 AssetDetail 提取 shotId（shot 前缀，如 "S01"）。
 *  截断到 S 编号，用于 shot 级筛选与分组的粗粒度匹配。
 *  需要保留 beat 级（S01_B01）时请用 inferFullShotId。 */
export function inferShotId(d: AssetDetail): string | null {
  if (d.type !== 'keyframe') return null
  const m = (d.name || '').match(/^(S\d+)/i)
  return m ? m[1] : null
}

/** 从 AssetDetail 提取完整 shotId（含 beat 后缀，如 "S01_B01"）。
 *  name 形如 "S01_B01_first_v1" → "S01_B01"；"S01_first_v1" → "S01"。
 *  无 beat 后缀时与 inferShotId 一致，仅返回 S 前缀。 */
export function inferFullShotId(d: AssetDetail): string | null {
  if (d.type !== 'keyframe') return null
  const m = (d.name || '').match(/^(S\d+(?:_B\d+)?)/i)
  return m ? m[1] : null
}

/** shotId/shotLabel 是否为 beat 级（含 _B 后缀，如 "S01_B01"）。 */
export function isBeatShotId(id: string): boolean {
  return /_B\d+$/i.test(id)
}

/** 从 shotId（可能含 beat）提取 shot 级前缀（如 "S01_B01" → "S01"、"S01" → "S01"）。
 *  用于把 beat 归入所属 shot 分组。 */
export function shotPrefix(id: string): string {
  const i = id.toUpperCase().indexOf('_B')
  return i > 0 ? id.slice(0, i) : id
}

/** beat 级展示短标签："S01_B01" → "B01"；非 beat 原样返回。 */
export function beatShortLabel(id: string): string {
  const m = id.match(/_B(\d+)$/i)
  return m ? `B${m[1]}` : id
}

// ─── 生成链路推断（纯前端，不改后端） ─────────────────────
//
// 复现 Kai 的管线因果链：①设定图 → ②灰底Turnaround → ③场景设定 → ④场景三视角
//   → ⑤分镜 → ⑥场景角度图 → ⑦人物定妆Turnaround → ⑧首帧 → ⑨尾帧。
// 仅依据资产现有字段（name/characterId/filePath/shotId）做「软」关联——
// 能用共享键（shotId / characterId）精确匹配的给可点击跳转节点；
// 无法精确匹配的（如 shot→character 无映射）以非可点击的「管线说明」条目呈现，
// 避免给出虚假精确链接。

/** 链路节点方向：up=参考来源（本资产被它生成），down=被引用（下游消费了本资产） */
export type ChainDirection = 'up' | 'down'

export interface ChainLink {
  direction: ChainDirection
  /** 节点子类型（决定 emoji / 标签）；'prompt' 为文本说明节点 */
  kind: AssetSubtype | 'prompt' | 'pipeline_note'
  emoji: string
  /** 显示名（资产名 / 说明） */
  label: string
  /** 副标题（子类型标签 / 关系说明） */
  detail?: string
  /** 真实资产 → 可点击跳转详情；无则不可点击 */
  uuid?: string
}

/** 从 AssetItem.name/filePath 提取 shotId（S0X），用于 keyframe ↔ 场景角度图关联。 */
function shotIdOfItem(a: AssetItem): string | null {
  const m = (a.name || '').match(/(S\d+)/i) || (a.filePath || '').match(/(S\d+)/i)
  return m ? m[1] : null
}

/**
 * 计算某资产的生成链路（参考来源 + 被引用）。
 *
 * @param item 当前资产（AssetItem）
 * @param all  同项目全部资产（用于跨资产关联）
 * @returns ChainLink[] —— up 在前、down 在后；空数组表示无链路
 */
export function computeGenerationChain(item: AssetItem, all: AssetItem[]): ChainLink[] {
  const subtype = inferSubtypeFromItem(item)
  const up: ChainLink[] = []
  const down: ChainLink[] = []

  // —— 首帧 / 尾帧（⑧⑨）：按 shotId 关联场景角度图 + Turnaround + 配对帧 ——
  if (subtype === 'keyframe_first' || subtype === 'keyframe_last') {
    const shotId = shotIdOfItem(item)

    // 参考来源 ↑：⑥ 场景角度图（同 shotId）
    if (shotId) {
      const angles = all.filter((x) => inferSubtypeFromItem(x) === 'scene_angle_shot' && shotIdOfItem(x) === shotId)
      angles.slice(0, 3).forEach((x) => up.push({
        direction: 'up', kind: 'scene_angle_shot', emoji: SUBTYPE_EMOJI.scene_angle_shot,
        label: x.name, detail: '场景角度图', uuid: x.uuid,
      }))
      // 参考来源 ↑：① 角色设定图（角色身份锚点 —— 全剧级，无 shot→character 映射，列全部角色设定）
      const turns = all.filter((x) => inferSubtypeFromItem(x) === 'character_concept')
      turns.slice(0, 4).forEach((x) => up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: x.name, detail: '角色设定图参考', uuid: x.uuid,
      }))
    }

    // 参考来源 ↑：⑦ 人物定妆 Turnaround（同 shotId —— 若管线已产出则精确匹配）
    if (shotId) {
      const costumes = all.filter((x) => inferSubtypeFromItem(x) === 'costume_turnaround' && shotIdOfItem(x) === shotId)
      costumes.forEach((x) => up.push({
        direction: 'up', kind: 'costume_turnaround', emoji: SUBTYPE_EMOJI.costume_turnaround,
        label: x.name, detail: '人物定妆参考', uuid: x.uuid,
      }))
    }

    // 参考来源 ↑：Prompt（文本说明节点，不可点击）
    if (item.prompt) {
      up.push({
        direction: 'up', kind: 'prompt', emoji: '📝',
        label: subtype === 'keyframe_first' ? '首帧生成 Prompt' : '尾帧生成 Prompt',
        detail: item.prompt.length > 60 ? item.prompt.slice(0, 60) + '…' : item.prompt,
      })
    }

    // 被引用 ↓：⑧首帧 → 配对的⑨尾帧（同 shotId）；尾帧无下游
    if (subtype === 'keyframe_first' && shotId) {
      const last = all.find((x) => inferSubtypeFromItem(x) === 'keyframe_last' && shotIdOfItem(x) === shotId && x.uuid !== item.uuid)
      if (last) down.push({
        direction: 'down', kind: 'keyframe_last', emoji: SUBTYPE_EMOJI.keyframe_last,
        label: last.name, detail: '尾帧 · 参考本首帧', uuid: last.uuid,
      })
    }
  }

  // —— 场景角度图/三视角（⑥）：上游=场景设定图（同场景名），下游=使用它的首尾帧 ——
  if (subtype === 'scene_angle_shot') {
    const shotId = shotIdOfItem(item)
    // 参考来源 ↑：③ 场景设定图（从资产名提取场景名，去掉"三视角_xxx"后缀）
    const sceneName = (item.name || '').replace(/\s*三视角.*$/, '').trim()
    if (sceneName) {
      const base = all.find((x) => inferSubtypeFromItem(x) === 'scene_base' && (x.name || '').includes(sceneName))
      if (base) up.push({
        direction: 'up', kind: 'scene_base', emoji: SUBTYPE_EMOJI.scene_base,
        label: base.name, detail: '场景设定图 · image2image 参考图', uuid: base.uuid,
      })
    }
    // 参考来源 ↑：⑤ 分镜设计（管线说明，无精确资产）
    if (up.length === 0) {
      up.push({
        direction: 'up', kind: 'pipeline_note', emoji: '🏠',
        label: '③ 场景设定图 + ⑤ 分镜设计', detail: '管线参考来源（无可点击资产）',
      })
    }
    // 被引用 ↓：使用本场景角度的首/尾帧（同 shotId）
    if (shotId) {
      const kfs = all.filter((x) =>
        (inferSubtypeFromItem(x) === 'keyframe_first' || inferSubtypeFromItem(x) === 'keyframe_last') &&
        shotIdOfItem(x) === shotId)
      kfs.slice(0, 6).forEach((x) => down.push({
        direction: 'down', kind: inferSubtypeFromItem(x), emoji: SUBTYPE_EMOJI[inferSubtypeFromItem(x) as AssetSubtype],
        label: x.name, detail: '引用了本场景角度', uuid: x.uuid,
      }))
    }
  }

  // —— 灰底 Turnaround（②）：上游=角色设定，下游=人物定妆(⑦) ——
  if (subtype === 'turnaround_sheet') {
    // 参考来源 ↑：① 角色设定图（同 characterId）
    if (item.characterId) {
      const concept = all.find((x) => inferSubtypeFromItem(x) === 'character_concept' && x.characterId === item.characterId)
      if (concept) up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: concept.name, detail: '角色设定图', uuid: concept.uuid,
      })
    }
    // 参考来源 ↑：生成 Prompt（若 meta 中有 generation_prompt）
    const genPrompt = parseGenMeta(item.meta)?.generationPrompt
    if (genPrompt) {
      up.push({ direction: 'up', kind: 'prompt', emoji: '📝',
        label: '生成 Prompt', detail: genPrompt.length > 60 ? genPrompt.slice(0, 60) + '…' : genPrompt,
      })
    }
    // 参考来源 ↑：生成方法（dreamina t2i / i2i 等，从 meta.generation_method 推断）
    const genMeta = parseGenMeta(item.meta)
    if (genMeta.generationMethod) {
      up.push({ direction: 'up', kind: 'pipeline_note', emoji: '🔧',
        label: genMeta.generationMethod, detail: `模型 ${genMeta.modelVersion ?? '未知'}`,
      })
    }
    // 被引用 ↓：⑦ 人物定妆 Turnaround（同 characterId —— 管线产出后精确匹配）
    if (item.characterId) {
      const costumes = all.filter((x) => inferSubtypeFromItem(x) === 'costume_turnaround' && x.characterId === item.characterId)
      costumes.forEach((x) => down.push({
        direction: 'down', kind: 'costume_turnaround', emoji: SUBTYPE_EMOJI.costume_turnaround,
        label: x.name, detail: '人物定妆 · 参考本灰底', uuid: x.uuid,
      }))
    }
  }

  // —— 人物定妆 Turnaround（⑦）：上游=灰底Turnaround(同角色) + 角色设定图 + 场景角度(同shot) ——
  if (subtype === 'costume_turnaround') {
    // 参考来源 ↑：② 灰底 Turnaround（同 characterId —— image2image 的直接参考图）
    if (item.characterId) {
      const greyBase = all.find((x) => inferSubtypeFromItem(x) === 'turnaround_sheet' && x.characterId === item.characterId)
      if (greyBase) up.push({
        direction: 'up', kind: 'turnaround_sheet', emoji: SUBTYPE_EMOJI.turnaround_sheet,
        label: greyBase.name, detail: '灰底 Turnaround · image2image 参考图', uuid: greyBase.uuid,
      })
    }
    // 参考来源 ↑：① 角色设定图（同 characterId —— 身份锚点）
    if (item.characterId) {
      const base = all.find((x) => inferSubtypeFromItem(x) === 'character_concept' && x.characterId === item.characterId)
      if (base) up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: base.name, detail: '角色设定图参考', uuid: base.uuid,
      })
    }
    // 参考来源 ↑：生成方法 + Prompt（从 meta 提取）
    const genMeta = parseGenMeta(item.meta)
    if (genMeta.generationMethod) {
      up.push({ direction: 'up', kind: 'pipeline_note', emoji: '🔧',
        label: genMeta.generationMethod, detail: `模型 ${genMeta.modelVersion ?? '未知'}`,
      })
    }
    if (genMeta.generationPrompt) {
      const p = genMeta.generationPrompt
      up.push({ direction: 'up', kind: 'prompt', emoji: '📝',
        label: '换装 Prompt', detail: p.length > 60 ? p.slice(0, 60) + '…' : p,
      })
    }
    // 被引用 ↓：首/尾帧（同 shotId）
    const shotId = shotIdOfItem(item)
    if (shotId) {
      const kfs = all.filter((x) => inferSubtypeFromItem(x) === 'keyframe_first' && shotIdOfItem(x) === shotId)
      kfs.slice(0, 3).forEach((x) => down.push({
        direction: 'down', kind: 'keyframe_first', emoji: SUBTYPE_EMOJI.keyframe_first,
        label: x.name, detail: '引用了本定妆', uuid: x.uuid,
      }))
    }
  }

  // —— 角色设定图（①）：下游=首尾帧/场景角度图（管线说明，无精确键） ——
  if (subtype === 'character_concept' && item.characterId) {
    down.push({
      direction: 'down', kind: 'pipeline_note', emoji: '🎬',
      label: '⑧⑨ 首尾帧 / ⑥ 场景角度图', detail: '作为角色身份锚点被下游引用',
    })
  }

  // —— 场景设定图（③）：下游=三视角场景图（同场景名，image2image 参考本图） ——
  if (subtype === 'scene_base') {
    // 从资产名提取场景名（去掉版本后缀 v1/v2/v3）
    const sceneName = (item.name || '').replace(/\s+v\d+$/i, '').trim()
    if (sceneName) {
      // 被引用 ↓：三视角场景图（正面/左侧/俯视）—— 名称包含场景名 + "三视角"
      const views = all.filter((x) => {
        const xSub = inferSubtypeFromItem(x)
        return xSub === 'scene_angle_shot' && (x.name || '').includes(sceneName) && (x.name || '').includes('三视角')
      })
      views.slice(0, 4).forEach((x) => down.push({
        direction: 'down', kind: 'scene_angle_shot', emoji: SUBTYPE_EMOJI.scene_angle_shot,
        label: x.name, detail: '三视角 · 参考本场景图', uuid: x.uuid,
      }))
    }
    // 如果没有精确匹配到三视角，回退到管线说明
    if (down.length === 0) {
      down.push({
        direction: 'down', kind: 'pipeline_note', emoji: '🎥',
        label: '⑥ 场景角度图', detail: '选定后生成多视角（分镜级）',
      })
    }
  }

  return [...up, ...down]
}

/** AssetItem → AssetSubtype（computeGenerationChain 内部用，避免重复映射 AssetDetail）。 */
function inferSubtypeFromItem(a: AssetItem): AssetSubtype {
  // 与 inferSubtype(AssetDetail) 保持等价：AssetItem 已含 type/characterId/viewAngle/filePath/name/tags/meta。
  // 注意：AssetItem.type 是 AssetType 联合（不含 'keyframe'/'scene_image'），但 assetDetailToItem
  // 把 registry 的 string type 强制 as AssetType —— 运行时仍是 'keyframe' 等，故这里按 string 比较。
  const t = a.type as string
  const metaSub = parseMetaSubtype(a.meta)
  // ── Notion 文档型资产 —— 与 inferSubtype(AssetDetail) 保持等价（顶层 metaSub 短路）
  if (metaSub === 'requirement') return 'pipeline_requirement'
  if (metaSub === 'story_framework') return 'story_framework'
  if (metaSub === 'episode_script') return 'episode_script'
  if (metaSub === 'scene_design') return 'scene_design'
  if (metaSub === 'costume_design') return 'costume_design'
  if (metaSub === 'voice_profile') return 'voice_profile'
  if (metaSub === 'bgm_design') return 'bgm_design'
  // 报告/审计类交付包 —— 与 inferSubtype(AssetDetail) 保持等价（62-07 收尾修复）
  if (metaSub === 'delivery_package') return 'delivery_package'
  if (t === 'audio') {
    if (metaSub === 'foley_stem') return 'foley_stem'
    if (metaSub === 'bgm_track') return 'bgm_track'
    const tags = (a.tags ?? []).join(',').toLowerCase()
    if (tags.includes('foley')) return 'foley_stem'
    if (tags.includes('bgm')) return 'bgm_track'
    return 'unknown'
  }
  if (t === 'character') {
    const fp = (a.filePath || '').toLowerCase()
    const nm = (a.name || '').toLowerCase()
    const tags = (a.tags ?? []).join(',').toLowerCase()
    // ⑦服化道时段变体（Notion §1.1c）
    if (metaSub === 'costume_temporal_variant' || tags.includes('costume_temporal')) return 'costume_temporal_variant'
    const cm2 = parseCostumeMeta(a.meta)
    if (
      fp.includes('costume_turnaround') || fp.includes('costume-tr') ||
      nm.includes('costume_turnaround') || nm.includes('定妆turnaround') ||
      nm.includes('换装') || tags.includes('costume_turnaround') ||
      (cm2.costumeSet && cm2.costumeSet !== 'daily_baseline' && cm2.costumeSet !== 'work_baseline')
    ) return 'costume_turnaround'
    if (['front', 'side', 'back', 'three_quarter'].includes(a.viewAngle ?? '')) return 'turnaround_view'
    // ② 灰底Turnaround（独立产出）
    if (
      nm.includes('灰底turnaround') ||
      (fp.includes('turnaround_sheets/turnaround_') && !fp.includes('base_turnaround'))
    ) return 'turnaround_sheet'
    // 纯文本角色设定（无 filePath/图）—— 与 inferSubtype(AssetDetail) 保持等价
    if (!a.filePath) return 'character_bible'
    // 其余 = 角色设定图（①）
    return 'character_concept'
  }
  if (t === 'keyframe') {
    // 关键中间帧（Notion §2d）
    if (metaSub === 'midframe') return 'midframe'
    const nm = (a.name || '').toLowerCase()
    if (nm.includes('midframe') || nm.includes('中间帧')) return 'midframe'
    return (a.name || '').includes('_first_') || (a.name || '').includes('first') ? 'keyframe_first' : 'keyframe_last'
  }
  if (t === 'scene' || t === 'scene_variant' || t === 'scene_image') {
    const fp = (a.filePath || '').toLowerCase()
    const nm = (a.name || '').toLowerCase()
    if (metaSub === 'scene_blueprint' || nm.includes('场景蓝图') || fp.includes('scene_blueprint')) return 'scene_blueprint'
    if (metaSub === 'scene_temporal_variant' || fp.includes('temporal_variant') || nm.includes('时空变体')) return 'scene_temporal_variant'
    if (
      metaSub === 'scene_view_angle' ||
      (a.viewAngle && (EXTENDED_VIEW_ANGLE_KEYS as readonly string[]).includes(a.viewAngle))
    ) return 'scene_view_angle'
    // 场景角度图：含 scene_angle 或文件名含角度关键词的
    if (
      nm.includes('场景角度图') ||
      fp.includes('scene_angle') ||
      /\bs\d+_(front|angle_left|angle_right)\b/.test(fp)
    ) return 'scene_angle_shot'
    return 'scene_base'
  }
  // ── 管线产出子类型推断（P06+）—— 与 inferSubtype(AssetDetail) 保持等价
  if (t === 'script_phase' || t === 'outline' || t === 'topic') {
    const nm = (a.name || '').toLowerCase()
    const tags = (a.tags ?? []).join(',').toLowerCase()
    if (nm.includes('spatio') || nm.includes('时空') || tags.includes('spatio-temporal')) return 'spatio_temporal_script'
    return 'unknown'
  }
  if (t === 'storyboard') {
    const nm = (a.name || '').toLowerCase()
    if (nm.includes('e-konte') || nm.includes('ekonte') || nm.includes('econte')) return 'e_konte'
    return 'shot_list'
  }
  if (t === 'video') {
    return 'video_clips'
  }
  if (t === 'clip') {
    const nm = (a.name || '').toLowerCase()
    const tags = (a.tags ?? []).join(',').toLowerCase()
    if (nm.includes('master') || tags.includes('master') || nm.includes('合成') || tags.includes('composition')) return 'master_timeline'
    if (nm.includes('preview') || tags.includes('preview') || nm.includes('预览')) return 'rapid_preview'
    return 'video_clips'
  }
  if (t === 'delivery') {
    const nm = (a.name || '').toLowerCase()
    if (nm.includes('package') || nm.includes('包')) return 'delivery_package'
    return 'master_mp4'
  }
  // type='document' 兜底 —— 与 inferSubtype(AssetDetail) 保持等价（62-07 收尾修复）
  if (t === 'document') return 'delivery_package'
  // ── Notion 文档型裸 type 兜底 —— 与 inferSubtype(AssetDetail) 保持等价 ──
  if (t === 'script') return 'episode_script'
  if (t === 'story') return 'story_framework'
  if (t === 'requirement') return 'pipeline_requirement'
  return 'unknown'
}

/**
 * 子类型中文标签。
 * 注意：scene_three_view 已废弃，但 AssetSubtype 联合保留该成员以避免其它引用报类型错误，
 * 故本 Record 仍保留占位条目（不再在 UI 中使用）。
 */
export const SUBTYPE_LABEL: Record<AssetSubtype, string> = {
  character_concept: '角色设定图',
  character_bible: '角色文字设定',
  // ── Notion 文档型资产 ──
  pipeline_requirement: '创作需求',
  story_framework: '故事框架',
  episode_script: '分集剧本',
  scene_design: '场景设定',
  costume_design: '服化道',
  voice_profile: '音色总谱',
  bgm_design: 'BGM总谱',
  turnaround_sheet: '灰底Turnaround',
  turnaround_view: '视角拆分',
  scene_base: '场景设定图',
  scene_three_view: '三视角场景（已废弃）',
  scene_angle_shot: '场景角度图',
  scene_variant: '场景变体',
  costume_turnaround: '分镜级Turnaround',
  keyframe_first: '首帧',
  keyframe_last: '尾帧',
  // ── Notion 新资产类型 ──
  scene_blueprint: '场景蓝图',
  scene_temporal_variant: '场景时空变体',
  scene_view_angle: '场景视角矩阵',
  costume_temporal_variant: '服化道时段变体',
  midframe: '关键中间帧',
  foley_stem: 'Foley音轨',
  bgm_track: 'BGM音轨',
  voice_print: '声纹',
  // ── 管线产出（P06+）──
  spatio_temporal_script: '时空剧本',
  shot_list: '分镜参数表',
  e_konte: 'E-Konte分镜表',
  voice_clips: '语音片段',
  rapid_preview: '快速预览',
  video_clips: '视频片段',
  master_timeline: '合成母版',
  audio_stems: '混音音轨',
  master_mp4: '交付成品',
  delivery_package: '交付包',
  unknown: '其他',
}

/**
 * 子类型 emoji。
 * 注意：scene_three_view 已废弃，占位条目保留以满足 Record<AssetSubtype> 类型约束。
 */
export const SUBTYPE_EMOJI: Record<AssetSubtype, string> = {
  character_concept: '🎨',
  character_bible: '📝',
  // ── Notion 文档型资产 ──
  pipeline_requirement: '📋',
  story_framework: '📐',
  episode_script: '📝',
  scene_design: '🎭',
  costume_design: '👔',
  voice_profile: '🎤',
  bgm_design: '🎵',
  turnaround_sheet: '👕',
  turnaround_view: '📐',
  scene_base: '🏠',
  scene_three_view: '📐',
  scene_angle_shot: '🎥',
  scene_variant: '🌗',
  costume_turnaround: '🎭',
  keyframe_first: '▶️',
  keyframe_last: '⏹️',
  // ── Notion 新资产类型 ──
  scene_blueprint: '🗺️',
  scene_temporal_variant: '🌗',
  scene_view_angle: '🧭',
  costume_temporal_variant: '👔',
  midframe: '🔀',
  foley_stem: '👣',
  bgm_track: '🎼',
  voice_print: '🎤',
  // ── 管线产出（P06+）──
  spatio_temporal_script: '🎬',
  shot_list: '📋',
  e_konte: '🎞️',
  voice_clips: '🗣️',
  rapid_preview: '⏩',
  video_clips: '🎥',
  master_timeline: '🎞️',
  audio_stems: '🎚️',
  master_mp4: '📦',
  delivery_package: '📦',
  unknown: '📦',
}

/** 层级中文标签 */
export const LEVEL_LABEL: Record<AssetLevel, string> = {
  show: '全剧级',
  scene: '场景级',
  shot: '分镜级',
  pipeline: '管线产出',
}

// ─── 文档型资产（文字资产阅读器门控） ──────────────────────
//
// 这些子类型的 meta 载有可读正文/字段（Notion 导入 8 类创意文档），
// 详情走 TextReader（稿纸列）而非通用媒体布局（08-24 缺口①：剧本正文零展示）。

/** 文档型子类型集合（TextReader 适用面）。 */
export const DOC_SUBTYPES: ReadonlySet<string> = new Set([
  'episode_script', 'story_framework', 'pipeline_requirement',
  'scene_design', 'costume_design', 'character_bible',
  'voice_profile', 'bgm_design',
])

/**
 * 资产是否走文字阅读器：文档型子类型命中（meta.subtype 或裸 type 兜底均
 * 经 inferSubtype 归一）。meta 是否真有可展示字段由 TextReader 内
 * parseDocumentMeta 再判（空则回退通用布局，双保险）。
 */
export function isDocumentAsset(d: AssetDetail): boolean {
  return DOC_SUBTYPES.has(inferSubtype(d))
}

