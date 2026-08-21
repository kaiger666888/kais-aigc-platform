/**
 * socketScored 单测(56-01 / VIZ-01 数据地基)。
 *
 * 四组:canonical 写 + state/stale 零触碰 / 三守卫 warn 不 throw /
 * 归一表锁死('scored' 不入 normalizeSocketNodeState)/ 量纲钳制。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { useCanvasStore, normalizeSocketNodeState } from '../canvasStore'

function assetNode(id: string, over: Partial<AssetNodeV3> = {}): AssetNodeV3 {
  return {
    id, branchId: 'main', phaseIndex: 9, phaseName: 'p09_shot_breakdown',
    position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    state: 'success', kind: 'asset', stage: 'storyboard', modality: 'image',
    scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    curation: 'candidate', stale: null,
    ...over,
  } as AssetNodeV3
}

function seedGraph(): void {
  const graph = {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 0, updatedAt: 0 },
    nodes: [
      assetNode('n1', { stale: { reason: 'upstream', since: 123, triggerAssetId: 't', triggerEventId: 1 } as unknown as AssetNodeV3['stale'] }),
      // event 节点(kind !== 'asset')由 adapter 合成形态模拟
      { id: 'evt_x', branchId: 'main', kind: 'event', stage: 'storyboard', position: { x: 0, y: 0 }, size: { width: 26, height: 26 }, state: 'success' },
    ],
    links: [], branches: [], variantGroups: [],
  } as unknown as FlowGraphV3
  useCanvasStore.setState({ graph, toasts: [] })
}

describe('applySocketScored(56-01 scored 死信修复)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    seedGraph()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { warnSpy.mockRestore() })

  it('canonical 写 aiScore;state/stale 零触碰(52-01 红线)', () => {
    const before = useCanvasStore.getState().graph!.nodes.find((n) => n.id === "n1")! as AssetNodeV3
    useCanvasStore.getState().applySocketScored('n1', {
      overall: 0.82,
      dimensions: { drama: 0.9, rhythm: 0.7, character: 0.6 },
    })
    const after = useCanvasStore.getState().graph!.nodes.find((n) => n.id === 'n1')! as AssetNodeV3
    expect(after.aiScore?.overall).toBe(0.82)
    expect(after.aiScore?.dimensions).toEqual({ drama: 0.9, rhythm: 0.7, character: 0.6 })
    expect(after.state).toBe(before.state)
    expect(after.stale).toEqual(before.stale)
  })

  it('三守卫:graph 空/节点不存在/非 asset → warn 不 throw,graph 零变更', () => {
    useCanvasStore.setState({ graph: null })
    expect(() => useCanvasStore.getState().applySocketScored('n1', { overall: 0.5 })).not.toThrow()
    seedGraph()
    const before = useCanvasStore.getState().graph
    expect(() => useCanvasStore.getState().applySocketScored('ghost', { overall: 0.5 })).not.toThrow()
    expect(() => useCanvasStore.getState().applySocketScored('evt_x', { overall: 0.5 })).not.toThrow()
    expect(useCanvasStore.getState().graph).toBe(before)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('归一表锁死:normalizeSocketNodeState 不认 scored(防后人顺手入表)', () => {
    expect(normalizeSocketNodeState('scored')).toBeNull()
    expect(normalizeSocketNodeState('success')).toBe('success')
  })

  it('量纲:overall 78(>1 视为 percent)→ 0.78;120 → 钳制 1;dimensions 同规则', () => {
    useCanvasStore.getState().applySocketScored('n1', { overall: 78, dimensions: { drama: 120, rhythm: -3 } })
    const after = useCanvasStore.getState().graph!.nodes.find((n) => n.id === 'n1')! as AssetNodeV3
    expect(after.aiScore?.overall).toBe(0.78)
    expect(after.aiScore?.dimensions).toEqual({ drama: 1, rhythm: 0 })
  })
})
