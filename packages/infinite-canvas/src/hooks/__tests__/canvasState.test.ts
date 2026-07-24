import { describe, it, expect } from 'vitest'
import { lodLevelForZoom, resolveLodLevel } from '../useLod'
import { canvasStateKey, loadCanvasState, saveCanvasState, type StorageLike } from '../useCanvasPersistence'

// ─── LOD 三级 + ±0.03 迟滞（tokens --cv-lod-*；B5） ───

describe('useLod 纯函数', () => {
  it('lodLevelForZoom：L0<0.35 / L1 0.35–0.8 / L2≥0.8', () => {
    expect(lodLevelForZoom(0.1)).toBe(0)
    expect(lodLevelForZoom(0.349)).toBe(0)
    expect(lodLevelForZoom(0.35)).toBe(1)
    expect(lodLevelForZoom(0.79)).toBe(1)
    expect(lodLevelForZoom(0.8)).toBe(2)
    expect(lodLevelForZoom(2)).toBe(2)
  })

  it('迟滞：L1 在阈值带内（0.32–0.38 / 0.77–0.83）保持不闪切', () => {
    expect(resolveLodLevel(0.36, 1)).toBe(1) // 越过 0.35 但未过 0.38 上迟滞 → 仍 L1
    expect(resolveLodLevel(0.33, 1)).toBe(1) // 跌破 0.35 但未破 0.32 下迟滞 → 仍 L1
    expect(resolveLodLevel(0.81, 1)).toBe(1)
    expect(resolveLodLevel(0.78, 2)).toBe(2) // L2 跌破 0.8 但未破 0.77 → 仍 L2
  })

  it('迟滞：越过对侧 0.03 才切换', () => {
    expect(resolveLodLevel(0.38, 0)).toBe(1)
    expect(resolveLodLevel(0.31, 1)).toBe(0)
    expect(resolveLodLevel(0.83, 1)).toBe(2)
    expect(resolveLodLevel(0.76, 2)).toBe(1)
    expect(resolveLodLevel(0.9, 0)).toBe(2) // 跨级直跳
    expect(resolveLodLevel(0.1, 2)).toBe(0)
  })
})

// ─── P17 持久化（B6） ───

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('useCanvasPersistence 纯函数', () => {
  it('canvasStateKey：key 含 projectId+episodesId（P17 一集一画布）', () => {
    expect(canvasStateKey(7, 101)).toBe('kais:canvas:v1:p7:e101')
    expect(canvasStateKey('7', '101')).toBe('kais:canvas:v1:p7:e101')
  })

  it('save/load：viewport/折叠/选定 合并写 + 原样读回', () => {
    const s = fakeStorage()
    const key = canvasStateKey(7, 101)
    saveCanvasState(key, { viewport: { x: 10, y: -20, zoom: 0.6 } }, s)
    saveCanvasState(key, { selectedNodeId: 'sb-001', expandedStacks: ['sb-037'] }, s)
    const state = loadCanvasState(key, s)
    expect(state.viewport).toEqual({ x: 10, y: -20, zoom: 0.6 }) // 合并写不冲掉旧字段
    expect(state.selectedNodeId).toBe('sb-001')
    expect(state.expandedStacks).toEqual(['sb-037'])
  })

  it('损坏 JSON / 空记录 → 空对象，不 throw', () => {
    const s = fakeStorage()
    s.data.set(canvasStateKey(1, 2), '{broken')
    expect(loadCanvasState(canvasStateKey(1, 2), s)).toEqual({})
    expect(loadCanvasState(canvasStateKey(9, 9), s)).toEqual({})
  })

  it('不同集的 key 互相隔离', () => {
    const s = fakeStorage()
    saveCanvasState(canvasStateKey(7, 101), { selectedNodeId: 'a' }, s)
    saveCanvasState(canvasStateKey(7, 102), { selectedNodeId: 'b' }, s)
    expect(loadCanvasState(canvasStateKey(7, 101), s).selectedNodeId).toBe('a')
    expect(loadCanvasState(canvasStateKey(7, 102), s).selectedNodeId).toBe('b')
  })
})
