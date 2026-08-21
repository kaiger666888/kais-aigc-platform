/**
 * pipelineModel 单测(Phase 55-03 / NAV-01:D-04 单源消费 + D-03 未映射兜底)。
 *
 * 行为契约:
 *  - PIPELINE_PHASES 即 phaseRegistry(22 条,P09c/P12a/P12b/P11a0 在列);
 *  - PHASE_GROUPS 由注册表派生(逐条 e.phaseIndex→e.group;注销 lane 5/13 无映射);
 *  - derivePipelineModels 对未注册 phaseIndex(99/13)产出唯一「未映射」条目,
 *    不 throw,warn 按索引聚合一条(模块级 Set 去重,不重复 warn);
 *  - 全注册 phaseIndex 时零「未映射」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node } from '@xyflow/react'
import { PHASE_REGISTRY } from '../../../constants/phaseRegistry'
import { PHASE_GROUPS } from '../../../constants'
import { PIPELINE_PHASES, derivePipelineModels, type PhaseModel } from '../model'

function nodeWith(phaseIndex: number, id?: string): Node {
  return {
    id: id ?? `n-${phaseIndex}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'asset',
    position: { x: 0, y: 0 },
    data: { v3: { phaseIndex, state: 'success', curation: 'selected' } },
  } as unknown as Node
}

describe('phase 词汇单源(55-03 D-04)', () => {
  it('PIPELINE_PHASES === 22 条注册表,P09c/P12a/P12b/P11a0 在列', () => {
    expect(PIPELINE_PHASES).toHaveLength(22)
    const codes = PIPELINE_PHASES.map((p) => p.code)
    for (const code of ['P09c', 'P12a', 'P12b', 'P11a0']) {
      expect(codes, code).toContain(code)
    }
  })

  it('PHASE_GROUPS 由注册表派生:逐条一致;注销 lane 5/13 无映射', () => {
    for (const e of PHASE_REGISTRY) {
      expect(PHASE_GROUPS[e.phaseIndex], `phaseIndex ${e.phaseIndex}`).toBe(e.group)
    }
    expect(PHASE_GROUPS[5]).toBeUndefined()
    expect(PHASE_GROUPS[13]).toBeUndefined()
  })
})

describe('derivePipelineModels 未映射兜底(55-03 D-03)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('未注册 phaseIndex(99 与 13)→ 唯一「未映射」条目/索引,不 throw', () => {
    const nodes = [
      nodeWith(99, 'n-99-a'),
      nodeWith(99, 'n-99-b'),
      nodeWith(13, 'n-13'),
      nodeWith(1, 'n-01'),
    ]
    let models: PhaseModel[] | undefined
    expect(() => { models = derivePipelineModels(nodes) }).not.toThrow()
    const unmapped = models!.filter((m) => m.def.name.includes('未映射') || m.def.code.includes('未映射'))
    expect(unmapped).toHaveLength(2) // 99 与 13 各一条
    const byIdx = new Map(unmapped.map((m) => [m.def.phaseIndex, m]))
    expect(byIdx.get(99)).toBeTruthy()
    expect(byIdx.get(13)).toBeTruthy()
    // 同索引多节点仍只一条
    expect(unmapped.filter((m) => m.def.phaseIndex === 99)).toHaveLength(1)
  })

  it('warn 按索引聚合:未知索引只 warn 一条(98 用例独占——Set 进程级去重,重复调用不刷屏)', () => {
    derivePipelineModels([nodeWith(98, 'n-98-a'), nodeWith(98, 'n-98-b')])
    derivePipelineModels([nodeWith(98, 'n-98-c')])
    const calls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('98'))
    expect(calls.length).toBe(1)
    expect(String(calls[0]?.[0])).toContain('未映射')
  })

  it('全部 phaseIndex ∈ 注册表 → 零「未映射」条目', () => {
    const nodes = PHASE_REGISTRY.map((e, i) => nodeWith(e.phaseIndex, `n-reg-${i}`))
    const models = derivePipelineModels(nodes)
    expect(models.filter((m) => m.def.name.includes('未映射') || m.def.code.includes('未映射'))).toHaveLength(0)
  })
})
