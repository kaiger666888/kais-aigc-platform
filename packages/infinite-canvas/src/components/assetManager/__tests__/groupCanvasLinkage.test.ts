/**
 * groupCanvasLinkage 单测（62-01）—— 分组轴 / 双前缀反查 / 三态判定式 纯函数契约。
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
} from '../groupCanvasLinkage'

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
