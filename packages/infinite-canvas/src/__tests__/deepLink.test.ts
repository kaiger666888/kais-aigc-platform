import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDeepLink, resolveDeepLinkTarget, type DeepLinkNodeLike } from '../lib/deepLink'
import { PHASE_REGISTRY } from '../constants/phaseRegistry'

/**
 * deepLink.test.ts — 57-03 (D-05) 深链参数纯函数行为表。
 *
 * 契约来源:57-03-PLAN Task 1 + UI-SPEC P-6/State Matrix:
 *  - focus 命中 → {kind:'focus'};focus 落点是否存在不在此判——未命中时由既有
 *    focusAssetNodeId effect 走「该资产尚未放置在画布上」toast(must_have 三态)。
 *  - zone(khsPrefix) → PHASE_REGISTRY 查 phaseIndex → 该 phase 首个资产节点;
 *    无节点 → none 静默(只加载不跳);注册表外 → none + warn(fail-loud 不崩)。
 *  - focus/zone 同给 → focus 优先。
 */

/** 构造 RF 形态节点(data.v3.phaseIndex 为 adapter 权威位置;legacy 直挂兜底)。 */
function node(id: string, phaseIndex: number, kind: 'asset' | 'structure' = 'asset'): DeepLinkNodeLike {
  return { id, data: { v3: { phaseIndex, kind } } }
}

const NODES: DeepLinkNodeLike[] = [
  node('n-p01-a', 1),
  node('n-p13-a', 16),
  node('n-p13-b', 16),
  node('n-struct', 16, 'structure'),
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseDeepLink', () => {
  it('解析四键', () => {
    const q = '?projectId=3&episodesId=1&focus=n-abc&zone=p11b'
    expect(parseDeepLink(q)).toEqual({
      projectId: '3',
      episodesId: '1',
      focus: 'n-abc',
      zone: 'p11b',
    })
  })

  it('未知键忽略;缺省键为 undefined', () => {
    const p = parseDeepLink('?projectId=3&evil=<script>')
    expect(p).toEqual({ projectId: '3', episodesId: undefined, focus: undefined, zone: undefined })
  })

  it('空串视为缺省(不产生空目标)', () => {
    const p = parseDeepLink('?focus=&zone=')
    expect(p.focus).toBeUndefined()
    expect(p.zone).toBeUndefined()
  })
})

describe('resolveDeepLinkTarget', () => {
  it('focus 命中 → focus 目标', () => {
    expect(resolveDeepLinkTarget({ focus: 'n-p13-a', nodes: NODES })).toEqual({
      kind: 'focus',
      nodeId: 'n-p13-a',
    })
  })

  it('focus 落点不存在仍回 focus 目标(未放置 toast 走既有 effect)', () => {
    expect(resolveDeepLinkTarget({ focus: 'missing-node', nodes: NODES })).toEqual({
      kind: 'focus',
      nodeId: 'missing-node',
    })
  })

  it('focus/zone 同给 → focus 优先(即使 focus 落点不存在)', () => {
    expect(resolveDeepLinkTarget({ focus: 'missing-node', zone: 'p13', nodes: NODES })).toEqual({
      kind: 'focus',
      nodeId: 'missing-node',
    })
  })

  it('zone 命中注册表且有资产节点 → zone 目标(首个资产节点)', () => {
    expect(resolveDeepLinkTarget({ zone: 'p13', nodes: NODES })).toEqual({
      kind: 'zone',
      nodeId: 'n-p13-a',
    })
  })

  it('zone 接受 legacy 直挂 data.phaseIndex 形态', () => {
    const legacy: DeepLinkNodeLike[] = [
      { id: 'n-p01-legacy', data: { phaseIndex: 1 } },
      { id: 'n-p09-legacy', data: { phaseIndex: 9 } },
    ]
    expect(resolveDeepLinkTarget({ zone: 'p09', nodes: legacy })).toEqual({
      kind: 'zone',
      nodeId: 'n-p09-legacy',
    })
  })

  it('zone 该 phase 只有结构节点 → none(资产节点才算落点)', () => {
    const onlyStruct: DeepLinkNodeLike[] = [node('n-struct', 3, 'structure')]
    expect(resolveDeepLinkTarget({ zone: 'p03', nodes: onlyStruct })).toEqual({ kind: 'none' })
  })

  it('zone 命中注册表但无节点 → none 静默(不 warn,只加载不跳)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveDeepLinkTarget({ zone: 'p13', nodes: [node('n-p01-a', 1)] })).toEqual({ kind: 'none' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['p05', 'p10b', 'p11', 'p12', 'garbage'])(
    'zone=%s 不在注册表 → none + warn(fail-loud 不崩)',
    (zone) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(resolveDeepLinkTarget({ zone, nodes: NODES })).toEqual({ kind: 'none' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain(zone)
    },
  )

  it('focus/zone 全缺 → none', () => {
    expect(resolveDeepLinkTarget({ nodes: NODES })).toEqual({ kind: 'none' })
  })

  it('zone 词汇对齐注册表真值(p13 → phaseIndex 16 由 PHASE_REGISTRY 保证)', () => {
    const p13 = PHASE_REGISTRY.find((p) => p.khsPrefix === 'p13')
    expect(p13?.phaseIndex).toBe(16)
    // 反向防漂移:注册表内每个 khsPrefix 都能作为 zone 键解析(不因拼写漂移静默失效)
    for (const def of PHASE_REGISTRY) {
      const target = resolveDeepLinkTarget({
        zone: def.khsPrefix,
        nodes: [node(`n-${def.khsPrefix}`, def.phaseIndex)],
      })
      expect(target).toEqual({ kind: 'zone', nodeId: `n-${def.khsPrefix}` })
    }
  })
})
