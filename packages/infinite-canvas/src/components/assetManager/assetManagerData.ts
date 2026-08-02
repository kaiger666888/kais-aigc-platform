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
  | 'clip' | 'voice' | 'video' | 'storyboard' | 'script_phase' | 'outline' | 'topic' | 'delivery'

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
  script_phase: '剧本', outline: '大纲', topic: '选题', delivery: '交付',
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
  if (['script_phase', 'outline', 'topic', 'style', 'delivery'].includes(type)) return 'text'
  return 'image' // character/scene/prop/costume/accessory/storyboard/...
}

/** type → 展示用 emoji（真实资产无 emoji，按类型给默认图标）。 */
export function emojiOfType(type: string): string {
  const map: Record<string, string> = {
    character: '👤', scene: '🌆', scene_variant: '🌗', prop: '📦', prop_key: '🗝️',
    prop_consumable: '🥫', costume: '👘', accessory: '💍', style: '🎨', audio: '🎵',
    voice: '🎙️', video: '🎬', clip: '🎞️', storyboard: '🎬', script_phase: '📝',
    outline: '🗂️', topic: '💡', delivery: '📦',
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
    { t: 'outline', ic: '🗂️', n: '大纲' },
    { t: 'topic', ic: '💡', n: '选题' },
    { t: 'delivery', ic: '📦', n: '交付' },
  ]},
]

/** 真实 registry 的 AssetDetail → 统一 AssetItem（资产库/详情消费）。 */
export function assetDetailToItem(d: AssetDetail): AssetItem {
  const type = (d.type || 'prop') as AssetType
  const tags = d.tags ? d.tags.split(',').map((s) => s.trim()).filter(Boolean) : []
  return {
    uuid: d.uuid || `id-${d.id}`,
    name: d.name || '未命名资产',
    type,
    modality: modalityOfType(type),
    emoji: emojiOfType(type),
    scope: d.projectId == null ? 'library' : 'project',
    desc: d.describe ?? undefined,
    tags,
    model: d.model ?? undefined,
    prompt: d.prompt ?? undefined,
    views: type === 'scene' ? ['overview', 'wide', 'close'] : ['front', 'side', 'back'],
    id: d.id,
    filePath: d.filePath ?? undefined,
    characterId: d.characterId ?? undefined,
    viewAngle: d.viewAngle ?? undefined,
    source: 'real',
    isPrimaryView: d.isPrimaryView ?? false,
  }
}

/** 取全部真实资产的标签集合（资产库标签筛选用）。 */
export function realTags(items: AssetItem[]): string[] {
  return [...new Set(items.flatMap((a) => a.tags ?? []))].sort()
}

// ─── 层级推断（纯前端，不改后端） ─────────────────────────

/** 资产层级 */
export type AssetLevel = 'show' | 'scene' | 'shot'

/** 资产子类型（从现有数据推断） */
export type AssetSubtype =
  | 'character_concept'    // 角色设定图（全剧级）
  | 'turnaround_sheet'     // Turnaround 多视角（全剧级）
  | 'scene_base'           // 场景基础图（场景级）
  | 'scene_variant'        // 场景变体（场景级）
  | 'keyframe_first'       // 首帧（分镜级）
  | 'keyframe_last'        // 尾帧（分镜级）
  | 'unknown'

/** 从 AssetDetail 推断层级 */
export function inferLevel(d: AssetDetail): AssetLevel {
  if (d.type === 'keyframe') return 'shot'
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') return 'scene'
  return 'show'  // character 默认全剧级
}

/** 从 AssetDetail 推断子类型 */
export function inferSubtype(d: AssetDetail): AssetSubtype {
  if (d.type === 'character') {
    if (d.viewAngle && ['front', 'side', 'back', 'three_quarter'].includes(d.viewAngle)) {
      return 'turnaround_sheet'
    }
    return 'character_concept'
  }
  if (d.type === 'keyframe') {
    return (d.name || '').includes('_first_') || (d.name || '').includes('first') ? 'keyframe_first' : 'keyframe_last'
  }
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    return 'scene_variant'  // 当前数据都是多视角变体
  }
  return 'unknown'
}

/** 从 AssetDetail 提取 sceneId（从 name/filePath 正则） */
export function inferSceneId(d: AssetDetail): string | null {
  // keyframe: name 形如 "S01_first_v1"
  if (d.type === 'keyframe') {
    const m = (d.name || '').match(/^(S\d+)/i)
    if (m) return m[1]
  }
  // scene: filePath 形如 .../S01_angle_left.png 或 name 含场景名
  const fn = (d.filePath || d.name || '').split('/').pop() || ''
  const m = fn.match(/S(\d+)/i)
  if (m) return `S${m[1].padStart(2, '0')}`
  // scene name 形如 "沈家客厅 v1"，无 S 编号 → 用 name 去版本后缀
  if (d.type === 'scene') {
    return (d.name || '').replace(/\s*v\d+$/i, '').trim() || null
  }
  return null
}

/** 从 AssetDetail 提取 shotId */
export function inferShotId(d: AssetDetail): string | null {
  if (d.type !== 'keyframe') return null
  const m = (d.name || '').match(/^(S\d+)/i)
  return m ? m[1] : null
}

/** 子类型中文标签 */
export const SUBTYPE_LABEL: Record<AssetSubtype, string> = {
  character_concept: '设定图',
  turnaround_sheet: 'Turnaround',
  scene_base: '场景基底',
  scene_variant: '场景变体',
  keyframe_first: '首帧',
  keyframe_last: '尾帧',
  unknown: '其他',
}

/** 子类型 emoji */
export const SUBTYPE_EMOJI: Record<AssetSubtype, string> = {
  character_concept: '🎨',
  turnaround_sheet: '👤',
  scene_base: '🏠',
  scene_variant: '🌗',
  keyframe_first: '▶️',
  keyframe_last: '⏹️',
  unknown: '📦',
}

/** 层级中文标签 */
export const LEVEL_LABEL: Record<AssetLevel, string> = {
  show: '全剧级',
  scene: '场景级',
  shot: '分镜级',
}

