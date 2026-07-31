/**
 * 资产管理中心 — 数据层（细粒度资产类型 + 组合关系）。
 *
 * ⚠️ 数据来源说明：
 * 现网 `/api/v1/assets-registry` 只有粗粒度 type（character|scene|prop|...），
 * 且无 costume/accessory/scene_variant 数据，更无组合关系（o_asset_composition 未建表）。
 * 因此本模块提供**演示用 mock 数据集**（短剧「流浪猫小橘」），保证 4 个子视图可完整跑通。
 *
 * 真实接入路径（TODO，待后端落地 design.md §3 的 o_asset_composition/o_loadout）：
 *   - 列表/搜索 → services/canvasApi.ts 的 searchAssets()（已存在，可直接接）
 *   - 组合关系 → 需新增 GET /api/v1/assets/:uuid/composition（TODO）
 *   - 角色衣柜 → 需新增 GET /api/v1/characters/:uuid/wardrobe（TODO）
 * 见 /tmp/asset-manager-design.md §4 API 设计。
 */

// ─── 细粒度资产类型 ───────────────────────────────────────
export type AssetType =
  | 'character' | 'costume' | 'accessory'
  | 'scene' | 'scene_variant'
  | 'prop' | 'prop_key' | 'prop_consumable'
  | 'style' | 'audio'

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
}

export const SLOT_LABEL: Record<EquipSlot, string> = {
  head: '头饰', body: '服装', accessory: '配饰', hand: '手持道具', feet: '足部',
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
