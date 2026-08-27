// @vitest-environment jsdom
/**
 * Fix-3 (FIX-2):盲选候选位号标注回归锁。
 *
 * 旧实现 `候选 ${i===0?'A':i===1?'B':i+1}` 第三候选起输出数字("候选 3"),
 * 与 A/B 序号断裂;现统一 `String.fromCharCode(65 + i)` = A/B/C/D…。
 *
 * 渲染级断言(TextCandidateCard.test 同款 createRoot+act 形态):
 *  1. voting 阶段三候选位号 = 候选 A / 候选 B / 候选 C(展示位序,非节点 id 序);
 *  2. 会话随机序(orders)打乱成员展示序后,位号仍按展示位 A/B/C 连续标注。
 *
 * 防剧透纪律不受影响:仅断言位号文本,不触揭晓页来源/分数渲染。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import BlindSelectionOverlay from '../BlindSelectionOverlay'
import { useBlindSelectionStore } from '../blindSelectionStore'
import { useCanvasStore } from '../../../../store/canvasStore'
import { adaptV2Graph } from '../../../../v3/adapter'

const GROUP_ID = 'cand:label:x'
const MEMBERS = ['m1', 'm2', 'm3']

/** 经真实 adapter 产 V3 图:三候选组(无 winner),位号标注只关心成员数与展示序。 */
function seedGraph(): void {
  const cand = (id: string, seed: number) => ({
    id, type: 'video', branchId: 'br_main', phaseIndex: 4, phaseName: 'video',
    position: { x: 0, y: 0 }, size: { width: 240, height: 160 }, state: 'success',
    data: { filePath: `/assets/v/${id}.mp4`, shotId: 'shot-001', prompt: 'p', seed, engine: 'wan2.2-i2v' },
  })
  const { graph } = adaptV2Graph({
    meta: {
      version: '2', projectId: 7, episodesId: 101,
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T01:00:00.000Z',
    },
    nodes: MEMBERS.map((id, i) => cand(id, 1001 + i)),
    links: [],
    branches: [],
    variantGroups: [{ id: GROUP_ID, phaseIndex: 4, branchId: 'br_main', variantNodeIds: MEMBERS }],
  })
  useCanvasStore.setState({ graph, nodes: [], edges: [] })
}

function openSession(orders?: Record<string, string[]>): void {
  useBlindSelectionStore.setState({
    open: true,
    sessionId: 'bsess_fix3_label',
    seed: 1,
    queue: [GROUP_ID],
    cursor: 0,
    phase: 'voting',
    pickedNodeId: null,
    orders: orders ?? {},
    decided: {},
    includeDecided: false,
  })
}

let root: Root | null = null
let container: HTMLElement | null = null
function renderOverlay(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<BlindSelectionOverlay />) })
}

function labeltexts(): string[] {
  return [...container!.querySelectorAll('[data-testid="blind-candidate-label"]')].map(
    (el) => el.textContent ?? '',
  )
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  useBlindSelectionStore.setState({ open: false })
  useCanvasStore.setState({ graph: null, nodes: [], edges: [] })
})

describe('BlindSelectionOverlay 候选位号(Fix-3 FIX-2)', () => {
  it('三候选 voting 位号 = 候选 A/B/C(不再第三位起输出数字)', () => {
    seedGraph()
    openSession()
    renderOverlay()
    const labels = labeltexts()
    expect(labels).toEqual(['候选 A', '候选 B', '候选 C'])
  })

  it('会话随机序打乱展示序后,位号仍按展示位连续 A/B/C', () => {
    seedGraph()
    openSession({ [GROUP_ID]: ['m3', 'm1', 'm2'] })
    renderOverlay()
    // 展示序确为 orders 指定的乱序(位号与节点 id 解耦,按展示位标注)
    const domOrder = [...container!.querySelectorAll('[data-testid="blind-candidate"]')].map(
      (el) => el.getAttribute('data-blind-position'),
    )
    expect(domOrder).toEqual(['1', '2', '3'])
    expect(labeltexts()).toEqual(['候选 A', '候选 B', '候选 C'])
  })
})
