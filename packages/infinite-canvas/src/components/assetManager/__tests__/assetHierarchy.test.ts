/**
 * assetHierarchy 单测 —— 「最新非淘汰」winner 规则纯函数层：
 *   assetFreshnessKey（三段排序键 + T-62-16 畸形值防御）
 *   pickLatestActive（组内最新非淘汰；自动初始化 winner 规则消费）
 *
 * 62-05 批量决策规划测试（planBatch 两族）随选片决策视图 08-25 退役移除。
 * selectGroupWinner 为含网络副作用的 IO handler，断言面留 e2e（幂等纪律：
 * 勿断 applied:true）。零网络零 DOM，fixture 手造 AssetDetail（字段面 =
 * canvasApi.ts AssetDetail，62-05 起含 createdAt）。
 */
import { describe, it, expect } from 'vitest'
import type { AssetDetail } from '../../../services/canvasApi'
import {
  assetFreshnessKey,
  pickLatestActive,
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
