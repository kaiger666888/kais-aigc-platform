/**
 * groupCanvasLinkage 单测（62-01 + 62-04 追加）—— 分组轴 / 双前缀反查 / 三态判定式 /
 * 阶段徽标推导 / 层级模型派生（域指派·单件桶·计数聚合）纯函数契约。
 *
 * 零网络零 DOM：fixture 手造 AssetDetail（字段面 = canvasApi.ts AssetDetail）。
 * 双前缀反查为 RESEARCH D 实测增量的回归锁——现实现只查 asset- 前缀会漏服务端
 * sync-assets 建的 a-oasset-{id} 节点。
 */
import { describe, it, expect } from 'vitest'
import type { AssetDetail } from '../../../services/canvasApi'
import type { FlowGraphV3, VariantGroupV3 } from '@kais/flowgraph-v3'
import {
  parseMetaFields,
  getGroupKey,
  getGroupDisplayInfo,
  groupOrder,
  isAssetSelected,
  isAssetPending,
  isAssetEliminated,
  isSceneGroup,
  isVoiceGroup,
  ASSET_NODE_ID_PREFIX,
  OASSET_NODE_ID_PREFIX,
  canvasNodeIdsForAsset,
  resolveAssetNodeId,
  findVariantGroupForAsset,
  assetPhaseOf,
  buildHierarchyModel,
} from '../groupCanvasLinkage'
import { inferSubtype } from '../assetManagerData'

// ─── fixture ──────────────────────────────────────────────

/** 手造 AssetDetail（o_assets 行形状，全字段显式默认）。 */
const detail = (over: Partial<AssetDetail> = {}): AssetDetail => ({
  id: 1,
  uuid: 'uuid-1',
  name: '资产A',
  type: 'character',
  prompt: null,
  describe: null,
  projectId: 1,
  characterId: null,
  viewAngle: null,
  isPrimaryView: false,
  model: null,
  tags: null,
  state: 'active',
  meta: null,
  filePath: null,
  imageState: null,
  imageModel: null,
  resolution: null,
  ...over,
})

const meta = (m: Record<string, unknown>): string => JSON.stringify(m)

/** 最小 FlowGraphV3：nodes 只需 id 可比（util 仅读 n.id），variantGroups 全形。 */
const graph = (opts: {
  variantGroups?: VariantGroupV3[]
  nodeIds?: string[]
}): FlowGraphV3 =>
  ({
    meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes: (opts.nodeIds ?? []).map((id) => ({ id })) as FlowGraphV3['nodes'],
    links: [],
    branches: [],
    variantGroups: opts.variantGroups ?? [],
  }) as FlowGraphV3

const vg = (over: Partial<VariantGroupV3>): VariantGroupV3 => ({
  id: 'vg-1',
  branchId: 'main',
  phaseIndex: 0,
  sourceEventId: 'ev-1',
  variantNodeIds: [],
  selectMode: 'single',
  ...over,
})

// ─── getGroupKey 全分支 ───────────────────────────────────

describe('getGroupKey（D-02 唯一分组轴）', () => {
  it('keyframe: characterId + name 剥 _v\\d+$ 后缀（S01_first_v1 ≠ S01_last_v1 不同组）', () => {
    expect(getGroupKey(detail({ type: 'keyframe', characterId: 'sz', name: 'S01_first_v1' })))
      .toBe('keyframe:sz:S01_first')
    expect(getGroupKey(detail({ type: 'keyframe', characterId: 'sz', name: 'S01_last_v2' })))
      .toBe('keyframe:sz:S01_last')
    // 无版本后缀的原样保留
    expect(getGroupKey(detail({ type: 'keyframe', characterId: 'sz', name: 'S02_first' })))
      .toBe('keyframe:sz:S02_first')
  })

  it('costume_design（分集服化道）：按 episode + scene 细分（每集每场景独立互斥）', () => {
    const d = detail({
      characterId: 'sz',
      meta: meta({ subtype: 'costume_design', episode: 'EP01', scene: 'S02' }),
    })
    expect(getGroupKey(d)).toBe('char:sz:costume_design:EP01:S02')
    // 缺 episode/scene → 空串占位（同键互斥语义不破）
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'costume_design' }) })))
      .toBe('char:sz:costume_design::')
  })

  it('costume_turnaround（换装 TR）：按 costume_type 细分', () => {
    expect(getGroupKey(detail({
      characterId: 'sz',
      meta: meta({ subtype: 'costume_turnaround', costume_type: 'banquet' }),
    }))).toBe('char:sz:costume_tr:banquet')
  })

  it('基线 TR：turnaround_sheet / base_turnaround / 带 costume_set 三路同归 baseline_tr', () => {
    const expected = 'char:sz:baseline_tr'
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'turnaround_sheet' }) })))
      .toBe(expected)
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'base_turnaround' }) })))
      .toBe(expected)
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ costume_set: 'daily_baseline' }) })))
      .toBe(expected)
  })

  it('character_bible → bible；voice_print → voice', () => {
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'character_bible' }) })))
      .toBe('char:sz:bible')
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'voice_print' }) })))
      .toBe('char:sz:voice')
  })

  it('角色概念图兜底：subtype 空 / character_design / character_concept 同归 concept', () => {
    expect(getGroupKey(detail({ characterId: 'sz', meta: null }))).toBe('char:sz:concept')
    expect(getGroupKey(detail({ characterId: 'sz', meta: meta({ subtype: 'character_concept' }) })))
      .toBe('char:sz:concept')
  })

  it('场景三 type（无 characterId）按 name 归 scene:<name>', () => {
    for (const t of ['scene', 'scene_variant', 'scene_image']) {
      expect(getGroupKey(detail({ type: t, name: '宴会厅 v1' }))).toBe('scene:宴会厅 v1')
    }
  })

  it('其余兜底 `${type}:${name}`；meta 非 JSON 时角色资产仍安全落 concept', () => {
    expect(getGroupKey(detail({ type: 'video', name: '成片v1' }))).toBe('video:成片v1')
    expect(getGroupKey(detail({ characterId: 'sz', meta: '{not-json' }))).toBe('char:sz:concept')
  })
})

describe('parseMetaFields / getGroupDisplayInfo / groupOrder（搬迁保真抽查）', () => {
  it('parseMetaFields：非 JSON → null；JSON 数组沿用既有宽松语义原样透传；正常 → Record', () => {
    expect(parseMetaFields(null)).toBeNull()
    expect(parseMetaFields('{bad')).toBeNull()
    // 逐字搬迁保真：原实现对「typeof === 'object』放行数组，此处锁该既有行为（非新收紧）
    expect(parseMetaFields('[1,2]')).toEqual([1, 2])
    expect(parseMetaFields(meta({ subtype: 'x' }))).toEqual({ subtype: 'x' })
  })

  it('getGroupDisplayInfo：char 概念/服化道 与 keyframe/scene 前缀的可读标题', () => {
    expect(getGroupDisplayInfo(detail({ characterId: 'sz', name: '沈知意 v1' })))
      .toEqual({ title: '沈知意 · 概念设定', emoji: '👤' })
    expect(getGroupDisplayInfo(detail({
      characterId: 'sz',
      meta: meta({ subtype: 'costume_design', character: '沈知意', episode: 'EP01', scene: 'S02' }),
    }))).toEqual({ title: '沈知意 · 服化道·EP01·S02', emoji: '🧥' })
    expect(getGroupDisplayInfo(detail({ type: 'scene', name: '宴会厅 v1' })))
      .toEqual({ title: '宴会厅 v1', emoji: '🏠' })
    expect(getGroupDisplayInfo(detail({ type: 'keyframe', characterId: 'sz', name: 'S01_first_v1' })))
      .toEqual({ title: 'S01_first', emoji: '🎬' })
  })

  it('groupOrder：char < scene < keyframe < other', () => {
    expect(groupOrder('char:sz:concept')).toBeLessThan(groupOrder('scene:X'))
    expect(groupOrder('scene:X')).toBeLessThan(groupOrder('keyframe:sz:S01'))
    expect(groupOrder('keyframe:sz:S01')).toBeLessThan(groupOrder('video:X'))
  })
})

// ─── 双前缀反查（RESEARCH D 回归锁） ──────────────────────

describe('canvasNodeIdsForAsset / 前缀常量', () => {
  it('两候选 id 都产出：asset- 在前、a-oasset- 在后；非有限 number → 空数组（T-62-02）', () => {
    expect(ASSET_NODE_ID_PREFIX).toBe('asset-')
    expect(OASSET_NODE_ID_PREFIX).toBe('a-oasset-')
    expect(canvasNodeIdsForAsset(42)).toEqual(['asset-42', 'a-oasset-42'])
    expect(canvasNodeIdsForAsset(Number.NaN)).toEqual([])
  })
})

describe('findVariantGroupForAsset（双前缀反查）', () => {
  it('回归锁：仅 a-oasset-{id} 在 variantNodeIds 中也命中（现 asset- 单前缀实现会漏）', () => {
    const g = graph({
      variantGroups: [vg({ id: 'vg-a', variantNodeIds: ['a-oasset-42'] })],
      nodeIds: ['a-oasset-42'],
    })
    expect(findVariantGroupForAsset(g, 42)).toEqual({ groupId: 'vg-a', size: 1 })
  })

  it('winnerNodeId 匹配任一前缀候选即命中，并透传 winnerNodeId', () => {
    const g = graph({
      variantGroups: [
        vg({ id: 'vg-w1', variantNodeIds: ['unrelated'], winnerNodeId: 'asset-7' }),
        vg({ id: 'vg-w2', variantNodeIds: ['unrelated'], winnerNodeId: 'a-oasset-9' }),
      ],
    })
    expect(findVariantGroupForAsset(g, 7)?.groupId).toBe('vg-w1')
    expect(findVariantGroupForAsset(g, 7)?.winnerNodeId).toBe('asset-7')
    expect(findVariantGroupForAsset(g, 9)?.groupId).toBe('vg-w2')
    expect(findVariantGroupForAsset(g, 9)?.winnerNodeId).toBe('a-oasset-9')
  })

  it('两前缀都无命中 → null；graph null → null；非法 id（NaN）→ null', () => {
    const g = graph({ variantGroups: [vg({ id: 'vg-x', variantNodeIds: ['asset-100'] })] })
    expect(findVariantGroupForAsset(g, 42)).toBeNull()
    expect(findVariantGroupForAsset(null, 42)).toBeNull()
    expect(findVariantGroupForAsset(g, Number.NaN)).toBeNull()
  })

  it('size = variantNodeIds.length（VariantGroupV3 上无 variantGroupSize 字段）', () => {
    const g = graph({
      variantGroups: [vg({ id: 'vg-s', variantNodeIds: ['asset-5', 'asset-6', 'a-oasset-5'] })],
    })
    expect(findVariantGroupForAsset(g, 5)?.size).toBe(3)
  })
})

describe('resolveAssetNodeId（实存节点解析）', () => {
  it('仅 a-oasset 实存 → 返回之（补漏语义）', () => {
    const g = graph({ nodeIds: ['a-oasset-42'] })
    expect(resolveAssetNodeId(g, 42)).toBe('a-oasset-42')
  })

  it('两前缀都实存 → asset- 候选优先（与节点数组序无关）', () => {
    expect(resolveAssetNodeId(graph({ nodeIds: ['a-oasset-42', 'asset-42'] }), 42))
      .toBe('asset-42')
    expect(resolveAssetNodeId(graph({ nodeIds: ['asset-42', 'a-oasset-42'] }), 42))
      .toBe('asset-42')
  })

  it('无命中 → null；graph null → null', () => {
    expect(resolveAssetNodeId(graph({ nodeIds: ['asset-99'] }), 42)).toBeNull()
    expect(resolveAssetNodeId(null, 42)).toBeNull()
  })
})

// ─── 三态判定式（D-04 判定式单套） ────────────────────────

describe('isAssetSelected / isAssetPending / isAssetEliminated（组合矩阵关键 5 格）', () => {
  it('①isPrimaryView=1 + active → 仅 selected', () => {
    const d = detail({ isPrimaryView: 1 as unknown as boolean, state: 'active' })
    expect(isAssetSelected(d)).toBe(true)
    expect(isAssetPending(d)).toBe(false)
    expect(isAssetEliminated(d)).toBe(false)
  })

  it('②isPrimaryView=0 + active → 仅 pending（SQLite 整数 0 经 ! 判定）', () => {
    const d = detail({ isPrimaryView: 0 as unknown as boolean, state: 'active' })
    expect(isAssetSelected(d)).toBe(false)
    expect(isAssetPending(d)).toBe(true)
    expect(isAssetEliminated(d)).toBe(false)
  })

  it('③isPrimaryView=0 + eliminated → 仅 eliminated（淘汰者不得计入待选）', () => {
    const d = detail({ isPrimaryView: 0 as unknown as boolean, state: 'eliminated' })
    expect(isAssetSelected(d)).toBe(false)
    expect(isAssetPending(d)).toBe(false)
    expect(isAssetEliminated(d)).toBe(true)
  })

  it('④isPrimaryView=1 + eliminated → 仅 eliminated（state 优先于主视图标记）', () => {
    const d = detail({ isPrimaryView: 1 as unknown as boolean, state: 'eliminated' })
    expect(isAssetSelected(d)).toBe(false)
    expect(isAssetPending(d)).toBe(false)
    expect(isAssetEliminated(d)).toBe(true)
  })

  it('⑤null/null（DB 空值）→ 仅 pending（!!null=false 且 state!=="eliminated"）', () => {
    const d = detail({ isPrimaryView: null, state: null })
    expect(isAssetSelected(d)).toBe(false)
    expect(isAssetPending(d)).toBe(true)
    expect(isAssetEliminated(d)).toBe(false)
  })
})

describe('isSceneGroup / isVoiceGroup（自动初始化豁免式提取）', () => {
  it('任一成员 scene → 场景组；voice/audio → 声纹组；否则否', () => {
    expect(isSceneGroup([detail(), detail({ type: 'scene' })])).toBe(true)
    expect(isSceneGroup([detail({ type: 'video' })])).toBe(false)
    expect(isVoiceGroup([detail({ type: 'voice' })])).toBe(true)
    expect(isVoiceGroup([detail({ type: 'audio' })])).toBe(true)
    expect(isVoiceGroup([detail({ type: 'character' })])).toBe(false)
    expect(isVoiceGroup([])).toBe(false)
  })
})

// ─── 62-04 层级派生（assetPhaseOf / buildHierarchyModel） ──

describe('assetPhaseOf（D-01 阶段徽标推导）', () => {
  it('meta.phaseCode 直读 ^P\\d{2}$ 命中 → source meta（reportAudit 恒由查表决定,与来源解耦）', () => {
    // 非 reportAudit 子类型（character_bible）直读/查表两路 reportAudit 均 false
    expect(assetPhaseOf(detail({ meta: meta({ phaseCode: 'P09' }) })))
      .toEqual({ phaseCode: 'P09', source: 'meta', reportAudit: false })
    expect(assetPhaseOf(detail({ meta: meta({ phaseCode: 'P13' }) })))
      .toEqual({ phaseCode: 'P13', source: 'meta', reportAudit: false })
    // 62-07 收尾修复回归锁：真实报告类资产（type='document' + subtype='delivery_package'
    // + phaseCode='P13'）——徽标仍 meta 直读（D-01），reportAudit 经查表可达 true（D-03
    // 单件桶排除面对该形状生效;修复前早退硬编码 false 使排除面永不可达）
    expect(assetPhaseOf(detail({
      type: 'document',
      meta: meta({ subtype: 'delivery_package', phaseCode: 'P13' }),
    }))).toEqual({ phaseCode: 'P13', source: 'meta', reportAudit: true })
  })

  it('inferSubtype document/delivery_package 双路命中（62-07 修复锚）', () => {
    expect(inferSubtype(detail({ type: 'document', meta: meta({ subtype: 'delivery_package' }) })))
      .toBe('delivery_package')
    // 无 subtype 兜底:type='document' 裸类型也归报告/审计类交付包
    expect(inferSubtype(detail({ type: 'document' }))).toBe('delivery_package')
    // 查表路径:P13 + reportAudit:true(derived)
    expect(assetPhaseOf(detail({ type: 'document' })))
      .toEqual({ phaseCode: 'P13', source: 'derived', reportAudit: true })
  })

  it('T-62-12：异常 phaseCode（P9 / p09 / P009 / 任意文案）不透传，回落查表 → derived', () => {
    // type=character + filePath → character_concept → P04（证明走了查表而非直读）
    expect(assetPhaseOf(detail({ filePath: '/x/a.png', meta: meta({ phaseCode: 'P9' }) })))
      .toEqual({ phaseCode: 'P04', source: 'derived', reportAudit: false })
    expect(assetPhaseOf(detail({ filePath: '/x/a.png', meta: meta({ phaseCode: '<script>' }) })))
      .toEqual({ phaseCode: 'P04', source: 'derived', reportAudit: false })
    expect(assetPhaseOf(detail({ filePath: '/x/a.png', meta: meta({ phaseCode: 'P009' }) })))
      .toEqual({ phaseCode: 'P04', source: 'derived', reportAudit: false })
  })

  it('缺省 meta → inferSubtype 查表 derived：keyframe_first→P09 / delivery_package→P13+reportAudit / 未命中→空徽标', () => {
    expect(assetPhaseOf(detail({ type: 'keyframe', characterId: 'sz', name: 'S01_first_v1' })))
      .toEqual({ phaseCode: 'P09', source: 'derived', reportAudit: false })
    expect(assetPhaseOf(detail({ type: 'delivery', name: '交付 package' })))
      .toEqual({ phaseCode: 'P13', source: 'derived', reportAudit: true })
    // type=audio 无标记 → subtype unknown → 不入表 → 空 phaseCode（UI 不渲染徽标）
    expect(assetPhaseOf(detail({ type: 'audio', name: 'foley_01' })))
      .toEqual({ phaseCode: '', source: 'derived', reportAudit: false })
  })
})

describe('buildHierarchyModel（域指派 / 单件桶 / 计数聚合）', () => {
  // fixture：三域 × 三态 × 场景组 / 声纹组 / keyframe 组 / reportAudit / meta 直读（15 条）
  const I = (v: 0 | 1) => v as unknown as boolean
  const fx = [
    // setting · char 概念组（3 条：1 选定 + 1 待选 + 1 淘汰且 isPrimaryView=1——不变量格）
    detail({ id: 1, name: '沈知意 v1', type: 'character', characterId: 'sz', filePath: '/x/sz1.png', isPrimaryView: I(1), state: 'active', meta: meta({ phaseCode: 'P09' }) }),
    detail({ id: 2, name: '沈知意 v2', type: 'character', characterId: 'sz', filePath: '/x/sz2.png', isPrimaryView: I(0), state: 'active' }),
    detail({ id: 3, name: '沈知意 v3', type: 'character', characterId: 'sz', filePath: '/x/sz3.png', isPrimaryView: I(1), state: 'eliminated' }),
    // setting · keyframe 组（S01_first_v1/v2 剥版本后缀同组）
    detail({ id: 4, type: 'keyframe', characterId: 'sz', name: 'S01_first_v1', isPrimaryView: I(0), state: 'active' }),
    detail({ id: 5, type: 'keyframe', characterId: 'sz', name: 'S01_first_v2', isPrimaryView: I(1), state: 'active' }),
    // setting · 场景组（同 name 才同组——分组轴按 name）
    detail({ id: 6, type: 'scene', name: '宴会厅', isPrimaryView: I(0), state: 'active' }),
    detail({ id: 7, type: 'scene', name: '宴会厅', isPrimaryView: I(0), state: 'active' }),
    // media · 视频组（3 条）
    detail({ id: 8, type: 'video', name: 'EP01', isPrimaryView: I(1), state: 'active' }),
    detail({ id: 9, type: 'video', name: 'EP01', isPrimaryView: I(0), state: 'active' }),
    detail({ id: 10, type: 'video', name: 'EP01', isPrimaryView: I(0), state: 'active' }),
    // media · 声纹组（voice + meta.subtype=voice_print → char:sz:voice）
    detail({ id: 11, type: 'voice', characterId: 'sz', name: '沈知意声纹 v1', isPrimaryView: I(0), state: 'active', meta: meta({ subtype: 'voice_print' }) }),
    detail({ id: 12, type: 'voice', characterId: 'sz', name: '沈知意声纹 v2', isPrimaryView: I(0), state: 'active', meta: meta({ subtype: 'voice_print' }) }),
    // media · 单件（audio unknown → 空 phaseCode 徽标）
    detail({ id: 13, type: 'audio', name: 'foley_01', isPrimaryView: I(0), state: 'active' }),
    // text · 单件（requirement → pipeline_requirement → P01）
    detail({ id: 14, type: 'requirement', name: '创作需求', isPrimaryView: I(0), state: 'active', meta: meta({ subtype: 'requirement' }) }),
    // text · reportAudit（delivery_package：不进单件桶，计入域 total——D-03）
    detail({ id: 15, type: 'delivery', name: '交付 package', isPrimaryView: I(0), state: 'active' }),
  ]
  const model = buildHierarchyModel(fx)
  const byDomain = (dom: 'setting' | 'media' | 'text') =>
    model.domains.find((n) => n.domain === dom)!

  it('三域固定纲（空域也在场）；域计数公式含整数 0/1 与「淘汰且 isPrimaryView=1 仅计淘汰」不变量', () => {
    expect(model.domains.map((n) => n.domain)).toEqual(['setting', 'media', 'text'])
    // setting = char{1,1,1} + keyframe{1,1,0} + scene{0,2,0}
    expect(byDomain('setting').counts).toEqual({ selected: 2, pending: 4, eliminated: 1, total: 7 })
    // media = video{1,2,0} + voice{0,2,0} + audio 单件{0,1,0}
    expect(byDomain('media').counts).toEqual({ selected: 1, pending: 5, eliminated: 0, total: 6 })
    // text = requirement 单件 + delivery(reportAudit)
    expect(byDomain('text').counts).toEqual({ selected: 0, pending: 2, eliminated: 0, total: 2 })
    // 全量（pending = setting 4 + media 5 + text 2 = 11）
    expect(model.all).toEqual({ selected: 3, pending: 11, eliminated: 1, total: 15 })
    // D-04 DAG 一致性：pending ≡ total - selected - eliminated（三域 + 全量）
    for (const n of [...model.domains]) {
      expect(n.counts.pending).toBe(n.counts.total - n.counts.selected - n.counts.eliminated)
    }
  })

  it('D-03：reportAudit 资产不在 singletons.items 但计入域 total', () => {
    const text = byDomain('text')
    expect(text.singletons.items.map((d) => d.id)).toEqual([14])
    expect(text.singletons.counts).toEqual({ selected: 0, pending: 1, eliminated: 0, total: 1 })
    expect(text.counts.total).toBe(2) // delivery(id 15) 计入域 total
    expect(text.groups).toHaveLength(0) // size===1 组不产组卡
  })

  it('keyframe 组键剥 _v 后同组；scene/voice 组 isManual 标志（D-07 豁免面）', () => {
    const setting = byDomain('setting')
    const kf = setting.groups.find((g) => g.key === 'keyframe:sz:S01_first')!
    expect(kf.items.map((d) => d.id)).toEqual([4, 5])
    expect(kf.counts).toEqual({ selected: 1, pending: 1, eliminated: 0, total: 2 })
    expect(kf.isManualScene).toBe(false)
    expect(kf.isManualVoice).toBe(false)

    const scene = setting.groups.find((g) => g.key === 'scene:宴会厅')!
    expect(scene.isManualScene).toBe(true)
    expect(scene.isManualVoice).toBe(false)

    const voice = byDomain('media').groups.find((g) => g.key === 'char:sz:voice')!
    expect(voice.isManualVoice).toBe(true)
    expect(voice.isManualScene).toBe(false)

    // 组含选定者 → hasPrimary（title ★ 前缀信号源）
    expect(setting.groups.find((g) => g.key === 'char:sz:concept')!.hasPrimary).toBe(true)
    expect(scene.hasPrimary).toBe(false)
  })

  it('组排序 char < scene < keyframe < other；size===1 组不产组卡（入单件桶或 D-03 吞并）', () => {
    expect(byDomain('setting').groups.map((g) => g.key))
      .toEqual(['char:sz:concept', 'scene:宴会厅', 'keyframe:sz:S01_first'])
    // media：char: 前缀声纹组（groupOrder=0）先于 video:（other=3）
    expect(byDomain('media').groups.map((g) => g.key))
      .toEqual(['char:sz:voice', 'video:EP01'])
    for (const n of model.domains) {
      for (const g of n.groups) expect(g.items.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('未列 DB type 兜底 media 域（domainOfType 表内行为经 buildHierarchyModel 透传）', () => {
    const m = buildHierarchyModel([detail({ id: 21, type: 'exotic_new_type', name: 'X', isPrimaryView: I(0), state: 'active' })])
    expect(m.domains.find((n) => n.domain === 'media')!.singletons.items.map((d) => d.id)).toEqual([21])
    expect(m.domains.find((n) => n.domain === 'setting')!.counts.total).toBe(0)
    expect(m.domains.find((n) => n.domain === 'text')!.counts.total).toBe(0)
  })
})
