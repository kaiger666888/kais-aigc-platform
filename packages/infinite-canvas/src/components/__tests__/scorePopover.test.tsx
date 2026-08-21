// @vitest-environment jsdom
/**
 * 56-03 (VIZ-01)渲染级测试:NodeBadges verdict 带 + ScorePopover。
 *
 * 五组 verdict 带(渲染/眼先耳后/stale 共存/空态与 L0/三态环样式)
 * + 五组 popover(testid/雷达与维度行/截断/中文/pointerEvents none)。
 * jsdom + react-dom/client createRoot;真实 zustand(useStalePulse)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AssetNodeV3 } from '@kais/flowgraph-v3'
import NodeBadges from '../badges/NodeBadges'
import { ScorePopover } from '../badges/ScorePopover'
import { useCanvasUiStore } from '../canvas/canvasUiStore'

function makeAsset(over: Partial<AssetNodeV3> = {}): AssetNodeV3 {
  return {
    id: 'a1', branchId: 'main', phaseIndex: 9, phaseName: 'p09',
    position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    state: 'success', kind: 'asset', stage: 'storyboard', modality: 'image', scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    curation: 'candidate', stale: null,
    ...over,
  } as AssetNodeV3
}

let root: Root | null = null
let container: HTMLElement | null = null
function render(ui: React.ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(ui) })
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { root?.unmount(); container?.remove() })

describe('NodeBadges verdict 带(56-03)', () => {
  it('verdicts=[ear/fail] → 1 枚角标,title 含「耳审 不过」', () => {
    render(<NodeBadges nodeId="a1" asset={makeAsset()} variant="full" lod={1} verdicts={[{ judge: 'ear', verdict: 'fail' }]} />)
    const el = container!.querySelector('[aria-label="耳审 不过"]')
    expect(el).toBeTruthy()
  })

  it('眼+耳共存 → 眼在前(DOM 序)', () => {
    render(<NodeBadges nodeId="a1" asset={makeAsset()} variant="full" lod={1} verdicts={[{ judge: 'ear', verdict: 'fail' }, { judge: 'eye', verdict: 'pass' }]} />)
    const titles = [...container!.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
    const eyeIdx = titles.findIndex((t) => t?.includes('眼审'))
    const earIdx = titles.findIndex((t) => t?.includes('耳审'))
    expect(eyeIdx).toBeGreaterThanOrEqual(0)
    expect(earIdx).toBeGreaterThan(eyeIdx)
  })

  it('stale 与 verdict 共存 → 两者都在(stale svg + verdict 环)', () => {
    render(<NodeBadges nodeId="a1" asset={makeAsset({ stale: { reason: 'upstream', since: 1, triggerAssetId: 't', triggerEventId: 1 } as unknown as AssetNodeV3['stale'] })} variant="full" lod={1} verdicts={[{ judge: 'eye', verdict: 'warn' }]} />)
    expect(container!.querySelector('svg[aria-label="stale"]')).toBeTruthy()
    expect(container!.querySelector('[aria-label="眼审 留意"]')).toBeTruthy()
  })

  it('verdicts 空/undefined → 零 verdict 节点;lod===0 → 整体 null(既有行为)', () => {
    render(<NodeBadges nodeId="a1" asset={makeAsset()} variant="full" lod={1} verdicts={[]} />)
    expect(container!.querySelector('[aria-label^="眼审"], [aria-label^="耳审"]')).toBeNull()
    root!.unmount(); container!.remove()
    render(<NodeBadges nodeId="a1" asset={makeAsset()} variant="full" lod={0} verdicts={[{ judge: 'eye', verdict: 'pass' }]} />)
    expect(container!.innerHTML).toBe('')
  })

  it('三态环:FAIL 含 strokeOpacity 0.4 光环;WARN 含 strokeDasharray;PASS 单环', () => {
    render(<NodeBadges nodeId="a1" asset={makeAsset()} variant="full" lod={1} verdicts={[
      { judge: 'eye', verdict: 'fail' },
      { judge: 'eye', verdict: 'warn' },
      { judge: 'eye', verdict: 'pass' },
    ]} />)
    const html = container!.innerHTML
    expect(html).toContain('0.4')
    expect(html).toContain('2 1.5')
    // 主环恰 3(r=4),光环恰 1(r=5.4,仅 FAIL);EyeIcon 瞳孔圆不计
    expect(container!.querySelectorAll('circle[r="4"]').length).toBe(3)
    expect(container!.querySelectorAll('circle[r="5.4"]').length).toBe(1)
  })
})

describe('ScorePopover(56-03)', () => {
  it('含 testid/雷达容器/维度行/头「AI 评分 · 82」', () => {
    render(<ScorePopover aiScore={{ overall: 0.82, dimensions: { a: 0.9, b: 0.8, c: 0.7, d: 0.6 } }} />)
    expect(container!.querySelector('[data-testid="score-popover"]')).toBeTruthy()
    expect(container!.textContent).toContain('AI 评分 · 82')
    expect(container!.textContent).toContain('100')
    expect(container!.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1)
  })

  it('9 维 → 8 行 + 「… +1 维」截断行', () => {
    const dimensions = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`d${i}`, 0.5]))
    render(<ScorePopover aiScore={{ overall: 0.5, dimensions }} />)
    expect(container!.textContent).toContain('… +1 维')
  })

  it('维度行中文——key drama → 「戏剧性」', () => {
    render(<ScorePopover aiScore={{ overall: 0.8, dimensions: { drama: 0.9, rhythm: 0.8, character: 0.7 } }} />)
    expect(container!.textContent).toContain('戏剧性')
    expect(container!.textContent).toContain('节奏')
  })

  it('容器 pointerEvents none(不抢画布交互)', () => {
    render(<ScorePopover aiScore={{ overall: 0.5, dimensions: { a: 1, b: 1, c: 1 } }} />)
    const el = container!.querySelector('[data-testid="score-popover"]') as HTMLElement
    expect(el.style.pointerEvents).toBe('none')
  })
})
