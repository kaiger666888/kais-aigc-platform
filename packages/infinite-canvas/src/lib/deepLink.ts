/**
 * deepLink.ts — PORTAL-02 D-05 深链参数纯函数(Phase 57-03)。
 *
 * 上游:门户/交付页 `/canvas?project&ep&focus&zone` → 57-02 的 302 参数翻译 →
 * 本页 `?projectId&episodesId&focus&zone`;本模块只做解析与落点解析,零导航
 * 副作用——消费端(FlowCanvas.loadCanvas)只设 setFocusAssetNodeId,viewport
 * 语义(fitView/选中/高亮 1.5s 清空/未放置 toast)全部复用既有 focusAssetNodeId
 * effect(55 锁「只复用不改」,不写第二套 viewport 机制)。
 *
 * zone 词汇 = PHASE_REGISTRY.khsPrefix(55-D04 单一注册表);注册表外(已注销的
 * p05/p10b/p11/p12 或乱码)→ none + console.warn(fail-loud 不崩,55 同哲学)。
 */
import { PHASE_REGISTRY } from '../constants/phaseRegistry'

export interface DeepLinkParams {
  projectId?: string
  episodesId?: string
  focus?: string
  zone?: string
}

export type DeepLinkTarget =
  | { kind: 'focus'; nodeId: string }
  | { kind: 'zone'; nodeId: string }
  | { kind: 'none' }

/**
 * RF 节点宽松形态(data 为 unknown 域,内部收窄)——消费端可直接传 store 派生的
 * RF nodes,phaseIndex 权威位置 = data.v3.phaseIndex(adapter graphToViewModel),
 * legacy 直挂 data.phaseIndex 兜底。
 */
export interface DeepLinkNodeLike {
  id: string
  data?: {
    phaseIndex?: unknown
    v3?: { phaseIndex?: unknown; kind?: unknown }
  }
}

/** URL search → 深链四键(空串归一为 undefined;未知键忽略)。 */
export function parseDeepLink(search: string): DeepLinkParams {
  const params = new URLSearchParams(search)
  const read = (key: string): string | undefined => {
    const v = params.get(key)
    return v != null && v !== '' ? v : undefined
  }
  return {
    projectId: read('projectId'),
    episodesId: read('episodesId'),
    focus: read('focus'),
    zone: read('zone'),
  }
}

function phaseIndexOf(n: DeepLinkNodeLike): number | null {
  const v3 = n.data?.v3?.phaseIndex
  if (typeof v3 === 'number' && Number.isFinite(v3)) return v3
  const raw = n.data?.phaseIndex
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** 资产节点判定:V3 kind='asset';legacy 直挂节点(无 v3)按资产处理。 */
function isAssetLike(n: DeepLinkNodeLike): boolean {
  const kind = n.data?.v3?.kind
  return kind == null || kind === 'asset'
}

/**
 * 深链落点解析(纯函数):
 *  - focus 给定 → 恒回 focus 目标(落点是否存在不在此判——未命中由既有 effect
 *    走「该资产尚未放置在画布上」toast,深链三态之一);
 *  - focus 缺、zone 给定 → PHASE_REGISTRY 查 phaseIndex → 该 phase 首个资产
 *    节点;无资产节点 → none 静默(只加载不跳);注册表外 → none + warn;
 *  - 全缺 → none。
 */
export function resolveDeepLinkTarget(p: {
  focus?: string
  zone?: string
  nodes: readonly DeepLinkNodeLike[]
}): DeepLinkTarget {
  if (p.focus !== undefined) return { kind: 'focus', nodeId: p.focus }

  if (p.zone !== undefined) {
    const def = PHASE_REGISTRY.find((entry) => entry.khsPrefix === p.zone)
    if (!def) {
      console.warn(`[deepLink] zone "${p.zone}" 不在 PHASE_REGISTRY,深链忽略`)
      return { kind: 'none' }
    }
    const hit = p.nodes.find((n) => isAssetLike(n) && phaseIndexOf(n) === def.phaseIndex)
    return hit ? { kind: 'zone', nodeId: hit.id } : { kind: 'none' }
  }

  return { kind: 'none' }
}
