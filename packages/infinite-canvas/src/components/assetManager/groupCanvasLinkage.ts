/**
 * 资产分组 ↔ 画布联动 —— 共享纯函数家（无 React、无 store 依赖）。
 *
 * 62-01：AssetLibrary 共享提取（parseMetaFields/metaStr/getGroupKey/
 * getGroupDisplayInfo/groupOrder 纯移动，三态判定式与场景/声纹豁免式同式换名导出，
 * 资产库路径行为逐字节一致——HIER-04 纯移动前提）+ 双前缀反查 util。
 * 本文件同时是 62-04 层级派生函数家（域指派 / 阶段徽标 / 单件桶 / 计数聚合纯函数，见文件尾）。
 *
 * 双节点 id 约定（RESEARCH D 实测，两前缀都必须查，只查其一漏一半节点）：
 *   - 客户端拖入建点：`asset-${payload.id}`（FlowCanvas drop 链，data 袋带 assetId/assetUuid）
 *   - 服务端 sync-assets 建点：`a-oasset-${asset.id}`（data 袋带 oAssetId）
 *
 * 红线（D-04）：三态判定式全仓单套 —— 层级计数与资产库 tab 共用本文件导出，
 * 禁止另造第二套。
 */
import type { AssetDetail } from '../../services/canvasApi'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'
// 62-04 层级派生：域指派表/阶段映射表（generationConfigKeys）+ 子类型推导
// （assetManagerData 纯函数族——同为无 React/无 store 的数据层，无环）。
import { inferSubtype } from './assetManagerData'
import { PHASE_BY_SUBTYPE, domainOfType, type AssetDomain } from './generationConfigKeys'

/**
 * 安全解析 meta JSON 字符串 → Record（一次 parse 拿全部字段，供 getGroupKey 热路径复用）。
 * assetManagerData.ts 内已有 parseMetaSubtype / parseCostumeMeta，但前者未导出且二者各
 * 只返回部分字段；这里用一个通用解析器避免重复 JSON.parse，并保持自洽。
 * （T-62-01：o_assets.meta 为外部写入的 JSON，try/catch + 对象校验防御沿用既有范式。）
 */
export function parseMetaFields(meta?: string | null): Record<string, unknown> | null {
  if (!meta) return null
  try {
    const p = JSON.parse(meta)
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 安全读取 meta 解析结果中的字符串字段（非字符串 / 空串 → undefined）。 */
export function metaStr(meta: Record<string, unknown> | null, key: string): string | undefined {
  const v = meta?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * 分组键 —— 决定"哪几个资产互斥（选定其一则同组其余淘汰）"。
 * 角色：characterId = "shenzhiyi" / "luyanzhou"；场景：characterId 存场景 ID 如 "S01"。
 *
 * 角色类资产按 `characterId + meta.subtype` **分层细分**互斥组，而非统一归一组——
 * 否则选定某换装 Turnaround 时，会把同角色的概念图、灰底 Turnaround、全部分集服化道
 * 一并错误淘汰。各层互斥范围：
 *   - costume_design（分集服化道）→ 按 episode + scene 细分（每集每场景独立互斥）
 *   - costume_turnaround（换装 TR）→ 按 costume_type 细分
 *   - turnaround_sheet / base_turnaround / 有 costume_set → 基线 TR（同角色灰底变体互斥）
 *   - character_bible → 同角色 Bible 互斥
 *   - voice_print → 同角色声纹互斥
 *   - 其余（概念图 character_design / character_concept / subtype 空）→ 同角色概念图互斥
 */
export function getGroupKey(d: AssetDetail): string {
  // keyframe（首尾帧）按 characterId + name 前缀分组
  // 例如 S01_first_v1 和 S01_last_v1 是不同的帧，不应混在一组
  if (d.type === 'keyframe' && d.characterId) {
    // name 形如 "S01_first_v1"，取 _v 前的部分作为子组键
    const base = d.name?.replace(/_v\d+$/, '') || ''
    return `keyframe:${d.characterId}:${base}`
  }
  // 角色类资产按 characterId + subtype 层级细分互斥组
  if (d.characterId) {
    const meta = parseMetaFields(d.meta)
    const subtype = metaStr(meta, 'subtype')
    const costumeType = metaStr(meta, 'costume_type')
    const costumeSet = metaStr(meta, 'costume_set')
    const episode = metaStr(meta, 'episode')
    const scene = metaStr(meta, 'scene')

    // 分集服化道：按 episode + scene 细分（每集每场景独立互斥）
    if (subtype === 'costume_design') {
      return `char:${d.characterId}:costume_design:${episode || ''}:${scene || ''}`
    }
    // 换装 Turnaround：按 costume_type 细分
    if (subtype === 'costume_turnaround') {
      return `char:${d.characterId}:costume_tr:${costumeType || ''}`
    }
    // 灰底 / 基线 Turnaround（subtype=turnaround_sheet/base_turnaround 或带 costume_set）
    if (subtype === 'turnaround_sheet' || subtype === 'base_turnaround' || costumeSet) {
      return `char:${d.characterId}:baseline_tr`
    }
    // 角色 Bible
    if (subtype === 'character_bible') {
      return `char:${d.characterId}:bible`
    }
    // 声纹（voice_print）
    if (subtype === 'voice_print') {
      return `char:${d.characterId}:voice`
    }
    // 角色概念图（subtype 空 或 character_design/character_concept）
    return `char:${d.characterId}:concept`
  }
  // 场景类资产按 name 分组
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    return `scene:${d.name}`
  }
  return `${d.type}:${d.name}`
}

/**
 * 分组可读标题 + 图标 —— 仅用于待选资产分组的展示，不参与三态流转逻辑。
 * 根据 getGroupKey 的前缀推断分组类型，给出人眼可读的标题与表情图标。
 */
export function getGroupDisplayInfo(d: AssetDetail): { title: string; emoji: string } {
  const key = getGroupKey(d)
  if (key.startsWith('char:')) {
    // char:<charId>:<category>[:<sub>...] —— 提取角色名 + 层级可读标签
    const parts = key.split(':')
    const category = parts[2] ?? ''
    const meta = parseMetaFields(d.meta)
    // 角色中文名：优先 costume_design 的 meta.character；否则取 name 首个空格/·前的 token（去 v1 后缀）
    const charName = metaStr(meta, 'character')
      || (d.name || '').split(/[\s·]/)[0]?.replace(/v\d+$/i, '').trim()
      || d.characterId || parts[1] || key

    let catLabel = ''
    let emoji = '🎭'
    switch (category) {
      case 'concept':    catLabel = '概念设定'; emoji = '👤'; break
      case 'bible':      catLabel = '角色Bible'; emoji = '📖'; break
      case 'baseline_tr': catLabel = '基线Turnaround'; emoji = '🔄'; break
      case 'voice':      catLabel = '声纹'; emoji = '🎙️'; break
      case 'costume_tr': {
        const ct = metaStr(meta, 'costume_type') || parts[3] || ''
        catLabel = ct ? `换装TR·${ct}` : '换装TR'; emoji = '👗'; break
      }
      case 'costume_design': {
        const ep = metaStr(meta, 'episode') || parts[3] || ''
        const sc = metaStr(meta, 'scene') || parts[4] || ''
        const scope = [ep, sc].filter(Boolean).join('·')
        catLabel = scope ? `服化道·${scope}` : '服化道'; emoji = '🧥'; break
      }
      default: catLabel = category || '角色'
    }
    return { title: `${charName} · ${catLabel}`, emoji }
  }
  if (key.startsWith('scene:')) {
    return { title: d.name || key, emoji: '🏠' }
  }
  if (key.startsWith('keyframe:')) {
    // keyframe:CHARID:BASE → 提取 BASE（shot_id 前缀）
    const parts = key.split(':')
    const base = parts[2] || d.name || key
    return { title: base, emoji: '🎬' }
  }
  return { title: d.name || key, emoji: '📦' }
}

/** 分组排序优先级：角色(char:) > 场景(scene:) > 分镜(keyframe:) > 其他。 */
export const groupOrder = (key: string): number => {
  if (key.startsWith('char:')) return 0
  if (key.startsWith('scene:')) return 1
  if (key.startsWith('keyframe:')) return 2
  return 3
}

// ─── 三态判定式（D-04 判定式单套） ────────────────────────
//
// 原文出自 AssetLibrary tabFiltered：isPrimaryView 从 SQLite 返回的是整数 0/1，
// 需用 !! 转换；state 为 'eliminated' 即淘汰。层级视图计数聚合与资产库 tab
// 必须共用以下三式，禁止另造第二套判定逻辑。

/** 选定：置了主视图标记且未被淘汰。 */
export function isAssetSelected(d: AssetDetail): boolean {
  return !!d.isPrimaryView && d.state !== 'eliminated'
}

/** 淘汰：state === 'eliminated'。 */
export function isAssetEliminated(d: AssetDetail): boolean {
  return d.state === 'eliminated'
}

/** 待选：未置主视图且未被淘汰。 */
export function isAssetPending(d: AssetDetail): boolean {
  return !d.isPrimaryView && d.state !== 'eliminated'
}

// ─── 场景/声纹豁免判定（自动初始化 / D-06 批量选定共用） ──

/** 场景组：任一成员 type==='scene' 即场景组（不参与自动选定/批量选定，由用户手动选择）。 */
export function isSceneGroup(items: AssetDetail[]): boolean {
  return items.some((d) => d.type === 'scene')
}

/** 声纹组：任一成员 type==='voice' 或 type==='audio' 即声纹组（同上豁免）。 */
export function isVoiceGroup(items: AssetDetail[]): boolean {
  return items.some((d) => d.type === 'voice' || d.type === 'audio')
}

// ─── 资产 → 画布节点/变体组反查（D-02 提取 + RESEARCH D 双前缀增量） ──

/** 客户端拖入建点的节点 id 前缀。 */
export const ASSET_NODE_ID_PREFIX = 'asset-'
/** 服务端 sync-assets 建点的节点 id 前缀。 */
export const OASSET_NODE_ID_PREFIX = 'a-oasset-'

/**
 * 资产 id → 画布上可能存在的节点 id 候选（两种建点约定都查）。
 * T-62-02：id 必须 number 才拼接——前缀常量白名单拼接，不做字符串自由拼装。
 */
export function canvasNodeIdsForAsset(assetId: number): string[] {
  if (typeof assetId !== 'number' || !Number.isFinite(assetId)) return []
  return [
    `${ASSET_NODE_ID_PREFIX}${assetId}`,
    `${OASSET_NODE_ID_PREFIX}${assetId}`,
  ]
}

/**
 * 图中实存的第一个候选节点 id（候选序：asset- 优先）；无 graph / 无命中 → null。
 */
export function resolveAssetNodeId(graph: FlowGraphV3 | null, assetId: number): string | null {
  if (!graph) return null
  for (const cand of canvasNodeIdsForAsset(assetId)) {
    if (graph.nodes.some((n) => n.id === cand)) return cand
  }
  return null
}

/** 反查命中结果：groupId + 组规模 + （可选）当前 winner 节点。 */
export interface AssetVariantGroupRef {
  groupId: string
  /** 组规模 = variantNodeIds.length（VariantGroupV3 上没有 variantGroupSize 字段）。 */
  size: number
  winnerNodeId?: string
}

/**
 * 组主资产 → 画布变体组精确反查（handleGoCanvasSelect 逻辑提取 + a-oasset- 扩展）。
 *
 * 命中条件：variantNodeIds 含任一候选 id，或 winnerNodeId 等于任一候选 id。
 * size 取 variantNodeIds.length（RESEARCH D：组上无 variantGroupSize 字段）。
 * 无 graph / 无命中 → null。
 */
export function findVariantGroupForAsset(
  graph: FlowGraphV3 | null,
  assetId: number,
): AssetVariantGroupRef | null {
  if (!graph) return null
  const candidates = canvasNodeIdsForAsset(assetId)
  // 非法 id → 零候选：直接无命中（防 undefined 与无 winner 组误等）。
  if (candidates.length === 0) return null
  const vg = graph.variantGroups.find(
    (v) =>
      v.variantNodeIds.includes(candidates[0]) ||
      v.variantNodeIds.includes(candidates[1]) ||
      v.winnerNodeId === candidates[0] ||
      v.winnerNodeId === candidates[1],
  )
  if (!vg) return null
  const ref: AssetVariantGroupRef = { groupId: vg.id, size: vg.variantNodeIds.length }
  if (vg.winnerNodeId != null) ref.winnerNodeId = vg.winnerNodeId
  return ref
}

// ─── 62-04 层级派生（域指派 / 阶段徽标 / 单件桶 / 计数聚合） ──
//
// 纯函数家红线沿用：零 React / 零 store。计数聚合全部经 isAssetSelected/
// isAssetPending/isAssetEliminated 三式（D-04 判定式单套，禁止第二套）；
// 域指派经 domainOfType（TYPE_DOMAIN 表）；阶段映射经 PHASE_BY_SUBTYPE。

/** 资产阶段徽标信息（C6-1）。source 区分「资产 meta 直读」/「按子类型推导」（D-01 防启发式漂移）。 */
export interface AssetPhaseInfo {
  /** 阶段码（如 'P09'）；空串 = 不渲染徽标。 */
  phaseCode: string
  source: 'meta' | 'derived'
  /** 报告/审计类：不进单件桶显式节点（D-03），计入域级计数。
   *  恒由 PHASE_BY_SUBTYPE 查表唯一决定（与阶段码来源解耦——62-07 收尾修复：
   *  meta 直读早退仅决定徽标文案/来源，不再硬编码 false 压制查表结果）。 */
  reportAudit: boolean
}

/**
 * 阶段徽标推导：meta.phaseCode 直读优先（T-62-12：仅接受 ^P\d{2}$ 形态，
 * 异常值回落查表）；缺省 inferSubtype → PHASE_BY_SUBTYPE 查表（source 'derived'）；
 * 未命中表 → 空 phaseCode（UI 不渲染徽标）。
 * reportAudit 两路同源查表（D-03）：直读路径只接管徽标文案，报告/审计标志
 * 仍由子类型表决定——否则带 meta.phaseCode 的真实报告类资产（type='document'
 * + subtype='delivery_package'）永远到不了 reportAudit:true。
 */
export function assetPhaseOf(d: AssetDetail): AssetPhaseInfo {
  const entry = PHASE_BY_SUBTYPE[inferSubtype(d)]
  const reportAudit = entry?.reportAudit === true
  // 直读：T-62-12 防注入——任意字符串不透传，仅 ^P\d{2}$ 形态（P01..P99 量级）。
  const direct = metaStr(parseMetaFields(d.meta), 'phaseCode')
  if (direct && /^P\d{2}$/.test(direct)) {
    return { phaseCode: direct, source: 'meta', reportAudit }
  }
  if (entry) {
    return { phaseCode: entry.phaseCode, source: 'derived', reportAudit }
  }
  return { phaseCode: '', source: 'derived', reportAudit: false }
}

/** 三态计数聚合（C7 计数芯片与 data-count-* 属性同源；total = 成员总数）。 */
export interface HierarchyCounts {
  selected: number
  pending: number
  eliminated: number
  total: number
}

/** 计数聚合——判定式单套红线：三态全部经 isAsset* 共享导出，零内联判定。 */
function countsOf(items: AssetDetail[]): HierarchyCounts {
  let selected = 0
  let pending = 0
  let eliminated = 0
  for (const d of items) {
    if (isAssetSelected(d)) selected++
    else if (isAssetEliminated(d)) eliminated++
    else if (isAssetPending(d)) pending++
  }
  return { selected, pending, eliminated, total: items.length }
}

/** L2 候选组卡模型（getGroupKey 唯一分组轴，D-02）。 */
export interface HierarchyGroup {
  key: string
  title: string
  emoji: string
  counts: HierarchyCounts
  items: AssetDetail[]
  /** 场景组（✋ 手动选择豁免批量选定，D-07；62-05 消费）。 */
  isManualScene: boolean
  /** 声纹组（同上豁免）。 */
  isManualVoice: boolean
  /** 组含选定者（title ★ 前缀信号）。 */
  hasPrimary: boolean
}

/** 单件桶模型（域内 size===1 且非 reportAudit 成员；桶空则 items 为空数组）。 */
export interface HierarchySingletons {
  counts: HierarchyCounts
  items: AssetDetail[]
}

/** L1 域节点模型。三域固定纲：恒在场（空域 counts 全 0、groups/singletons 空，树灰态可点）。 */
export interface HierarchyDomainNode {
  domain: AssetDomain
  /** 域级计数（含 reportAudit 排除项与全部组成员，D-03）。 */
  counts: HierarchyCounts
  groups: HierarchyGroup[]
  /** 恒排本域末尾（UI-SPEC Layout）。 */
  singletons: HierarchySingletons
}

/** buildHierarchyModel 输出：固定序三域（setting/media/text）+ 全量计数。 */
export interface HierarchyModel {
  domains: HierarchyDomainNode[]
  all: HierarchyCounts
}

/** L1 固定纲域序（UI-SPEC 层间指派规则：设定资产 → 媒体产物 → 文本产物）。 */
const DOMAIN_ORDER: readonly AssetDomain[] = ['setting', 'media', 'text']

/**
 * 层级模型派生（62-04 Task 3 只做渲染与接线，本函数承载全部数据派生）：
 *   - 分组轴 = getGroupKey；域 = domainOfType(d.type)（type-first，未列类型兜底 media）。
 *   - 组排序 = groupOrder(key) + title 自然序（既有 candidateGroups 排序式）。
 *   - 单件桶 = 域内 size===1 且 !assetPhaseOf(d).reportAudit 的成员；
 *     reportAudit 资产不进桶渲染集但计入域 total（D-03）。
 *   - 组/域/桶/全量计数全部经 isAsset* 三式（D-04 单套）。
 */
export function buildHierarchyModel(assets: AssetDetail[]): HierarchyModel {
  const byDomain = new Map<AssetDomain, Map<string, AssetDetail[]>>()
  for (const dom of DOMAIN_ORDER) byDomain.set(dom, new Map())
  for (const d of assets) {
    const dom = domainOfType(d.type ?? '')
    let groups = byDomain.get(dom)
    if (!groups) {
      groups = new Map()
      byDomain.set(dom, groups)
    }
    const key = getGroupKey(d)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(d)
  }

  const domains: HierarchyDomainNode[] = DOMAIN_ORDER.map((domain) => {
    const groupMap = byDomain.get(domain)!
    const groupNodes: HierarchyGroup[] = []
    const singletonItems: AssetDetail[] = []
    for (const [key, items] of groupMap) {
      if (items.length === 1) {
        // 单件桶候选（size===1 组）；reportAudit 资产不进桶渲染集（D-03），
        // 其计数经 domainItems 聚合仍计入域 total。
        if (!assetPhaseOf(items[0]).reportAudit) singletonItems.push(items[0])
        continue
      }
      const info = getGroupDisplayInfo(items[0])
      const counts = countsOf(items)
      groupNodes.push({
        key,
        title: info.title,
        emoji: info.emoji,
        counts,
        items,
        isManualScene: isSceneGroup(items),
        isManualVoice: isVoiceGroup(items),
        hasPrimary: counts.selected > 0,
      })
    }
    groupNodes.sort((a, b) => {
      const ord = groupOrder(a.key) - groupOrder(b.key)
      if (ord !== 0) return ord
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
    const domainItems = [...groupMap.values()].flat()
    return {
      domain,
      counts: countsOf(domainItems),
      groups: groupNodes,
      singletons: { counts: countsOf(singletonItems), items: singletonItems },
    }
  })

  return { domains, all: countsOf(assets) }
}
