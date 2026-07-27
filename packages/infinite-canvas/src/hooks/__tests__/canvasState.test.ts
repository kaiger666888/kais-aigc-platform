import { describe, it, expect } from 'vitest'
import { lodLevelForZoom, resolveLodLevel } from '../useLod'
import { canvasStateKey, loadCanvasState, saveCanvasState, type StorageLike } from '../useCanvasPersistence'

// ─── LOD 三级 + ±0.03 迟滞（tokens --cv-lod-*；B5） ───

describe('useLod 纯函数', () => {
  it('lodLevelForZoom：L0<0.22 / L1 0.22–0.6 / L2≥0.6', () => {
    expect(lodLevelForZoom(0.1)).toBe(0)
    expect(lodLevelForZoom(0.219)).toBe(0)
    expect(lodLevelForZoom(0.22)).toBe(1)
    expect(lodLevelForZoom(0.59)).toBe(1)
    expect(lodLevelForZoom(0.6)).toBe(2)
    expect(lodLevelForZoom(2)).toBe(2)
  })

  it('迟滞：L1 在阈值带内（0.19–0.25 / 0.57–0.63）保持不闪切', () => {
    expect(resolveLodLevel(0.20, 1)).toBe(1) // 跌破 L0_MAX 0.22 但未破下迟滞 0.19 → 仍 L1
    expect(resolveLodLevel(0.62, 1)).toBe(1) // 越过 L1_MAX 0.6 但未过上迟滞 0.63 → 仍 L1
    expect(resolveLodLevel(0.58, 2)).toBe(2) // L2 跌破 0.6 但未破下迟滞 0.57 → 仍 L2
  })

  it('迟滞：越过对侧 0.03 才切换', () => {
    expect(resolveLodLevel(0.25, 0)).toBe(1) // L0→L1（越过 up0=0.25）
    expect(resolveLodLevel(0.18, 1)).toBe(0) // L1→L0（跌破 down1=0.19）
    expect(resolveLodLevel(0.63, 1)).toBe(2) // L1→L2（越过 up1=0.63）
    expect(resolveLodLevel(0.56, 2)).toBe(1) // L2→L1（跌破 down2=0.57）
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
