/**
 * assetHierarchy 单测（62-05）—— 批量决策纯规则层：
 *   assetFreshnessKey（「最新」三段排序键 + T-62-16 畸形值防御）
 *   pickLatestActive（D-06 winner 规则：组内最新非淘汰）
 *   planBatchSelection（D-06/D-07 批量选定规划：手动组跳过/已有 winner 跳过/最新恰一条）
 *   planBatchElimination（D-06 批量淘汰规划：仅待选成员，手动组不豁免）
 *
 * 只测纯规则：selectGroupWinner / runBatch* 为含网络副作用的 IO handler（编排薄层），
 * 断言面留 62-07 e2e（幂等纪律：勿断 applied:true）。零网络零 DOM，fixture 手造
 * AssetDetail（字段面 = canvasApi.ts AssetDetail，62-05 起含 createdAt）。
 */
import { describe, it, expect } from 'vitest'
import type { AssetDetail } from '../../../services/canvasApi'
import {
  assetFreshnessKey,
  pickLatestActive,
  planBatchSelection,
  planBatchElimination,
  type BatchGroup,
} from '../assetHierarchy'

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
  createdAt: null,
  ...over,
})

/** 手造批量规划输入组（HierarchyGroup 结构兼容子集）。 */
const batchGroup = (over: Partial<BatchGroup> = {}): BatchGroup => ({
  key: 'char:shenzhiyi',
  items: [],
  isManualScene: false,
  isManualVoice: false,
  hasPrimary: false,
  ...over,
})

// ─── assetFreshnessKey ────────────────────────────────────

describe('assetFreshnessKey（三段键 updatedAt ?? createdAt ?? id）', () => {
  it('updatedAt 优先（局部扩展对象——服务端未来透传后自动生效）', () => {
    const d = { ...detail({ id: 10, createdAt: 900 }), updatedAt: 1700000001000 } as AssetDetail
    expect(assetFreshnessKey(d)).toBe(1700000001000)
  })

  it('createdAt 次之；缺失/null 时回退 id（键末位 max(id) 决胜）', () => {
    expect(assetFreshnessKey(detail({ id: 1, createdAt: 500 }))).toBe(500)
    expect(assetFreshnessKey(detail({ id: 900 }))).toBe(900)
    expect(assetFreshnessKey(detail({ id: 7, createdAt: null }))).toBe(7)
  })

  it('T-62-16：畸形 createdAt 数值化收窄，非有限值回退 id', () => {
    // 数字形态字符串 → Number() 收窄成功
    expect(assetFreshnessKey(detail({ id: 3, createdAt: '123' as unknown as number }))).toBe(123)
    // 非数字字符串 → NaN → 回退 id
    expect(assetFreshnessKey(detail({ id: 4, createdAt: 'abc' as unknown as number }))).toBe(4)
  })
})

// ─── pickLatestActive ─────────────────────────────────────

describe('pickLatestActive（D-06 winner 规则：最新非淘汰）', () => {
  it('淘汰者不中——即便其 createdAt 最新', () => {
    const items = [
      detail({ id: 1, createdAt: 99999, state: 'eliminated' }),
      detail({ id: 2, createdAt: 100 }),
    ]
    expect(pickLatestActive(items)?.id).toBe(2)
  })

  it('按 createdAt 降序取首（同组多待选）', () => {
    const items = [
      detail({ id: 1, createdAt: 100 }),
      detail({ id: 2, createdAt: 300 }),
      detail({ id: 3, createdAt: 200 }),
    ]
    expect(pickLatestActive(items)?.id).toBe(2)
  })

  it('全淘汰 → null；空组 → null', () => {
    expect(pickLatestActive([
      detail({ id: 1, state: 'eliminated' }),
      detail({ id: 2, state: 'eliminated' }),
    ])).toBeNull()
    expect(pickLatestActive([])).toBeNull()
  })

  it('createdAt 全缺省时按 id（键末位）决胜', () => {
    const items = [detail({ id: 5 }), detail({ id: 12 }), detail({ id: 8 })]
    expect(pickLatestActive(items)?.id).toBe(12)
  })
})

// ─── planBatchSelection ───────────────────────────────────

describe('planBatchSelection（D-06/D-07 批量选定规划）', () => {
  it('场景组/声纹组入 skippedManual，不入 toSelect', () => {
    const scene = batchGroup({
      key: 'scene:kv_home',
      isManualScene: true,
      items: [detail({ id: 1, createdAt: 100 }), detail({ id: 2, createdAt: 200 })],
    })
    const voice = batchGroup({
      key: 'voice:shenzhiyi',
      isManualVoice: true,
      items: [detail({ id: 3 }), detail({ id: 4 })],
    })
    const plan = planBatchSelection([scene, voice])
    expect(plan.toSelect).toHaveLength(0)
    expect(plan.skippedManual).toBe(2)
  })

  it('已有 winner 组不入 toSelect（重申幂等无意义），也不计跳过', () => {
    const hasWinner = batchGroup({
      hasPrimary: true,
      items: [
        detail({ id: 1, isPrimaryView: true }),
        detail({ id: 2, createdAt: 900 }), // 更新但组已有 winner——不重选
      ],
    })
    const plan = planBatchSelection([hasWinner])
    expect(plan.toSelect).toHaveLength(0)
    expect(plan.skippedManual).toBe(0)
  })

  it('无 winner 普通组恰一条，且 = 最新非淘汰', () => {
    const g = batchGroup({
      items: [
        detail({ id: 1, createdAt: 100 }),
        detail({ id: 2, createdAt: 500, state: 'eliminated' }),
        detail({ id: 3, createdAt: 300 }),
      ],
    })
    const plan = planBatchSelection([g])
    expect(plan.toSelect).toEqual([{ assetId: 3, groupKey: g.key }])
  })

  it('全淘汰组无物可选，不入 toSelect', () => {
    const g = batchGroup({
      items: [detail({ id: 1, state: 'eliminated' }), detail({ id: 2, state: 'eliminated' })],
    })
    expect(planBatchSelection([g]).toSelect).toHaveLength(0)
  })
})

// ─── planBatchElimination ─────────────────────────────────

describe('planBatchElimination（D-06 批量淘汰规划）', () => {
  it('仅待选成员——winner 与已淘汰不动', () => {
    const g = batchGroup({
      items: [
        detail({ id: 1, isPrimaryView: true }), // winner
        detail({ id: 2 }),                      // 待选
        detail({ id: 3 }),                      // 待选
        detail({ id: 4, state: 'eliminated' }), // 已淘汰
      ],
    })
    const plan = planBatchElimination([g])
    expect(plan.assetIds).toEqual([2, 3])
    expect(plan.groupCount).toBe(1)
  })

  it('手动组（场景/声纹）不豁免——待选成员照入（D-07 只绑批量选定）', () => {
    const scene = batchGroup({
      isManualScene: true,
      items: [detail({ id: 10, type: 'scene' }), detail({ id: 11, type: 'scene' })],
    })
    const voice = batchGroup({
      isManualVoice: true,
      items: [detail({ id: 20, type: 'voice', isPrimaryView: true }), detail({ id: 21, type: 'voice' })],
    })
    const plan = planBatchElimination([scene, voice])
    expect(plan.assetIds).toEqual([10, 11, 21])
    expect(plan.groupCount).toBe(2)
  })

  it('无待选的组不计入 groupCount', () => {
    const onlyWinnerAndEliminated = batchGroup({
      items: [detail({ id: 1, isPrimaryView: true }), detail({ id: 2, state: 'eliminated' })],
    })
    const plan = planBatchElimination([onlyWinnerAndEliminated])
    expect(plan.assetIds).toEqual([])
    expect(plan.groupCount).toBe(0)
  })
})
