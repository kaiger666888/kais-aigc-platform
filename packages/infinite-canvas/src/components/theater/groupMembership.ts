/**
 * groupMembership.ts — 组视图三问纯推导(Phase 56-04 / VIZ-02,D-05 前置)。
 *
 * 谁能开剧场(theaterTargetOf)/开哪个布局(kind)/组员是谁
 * (deriveGroupMembers)。数据驱动:变体组 > assetType character/scene >
 * metaSub voice_profile 三链;识别不了返回 null(双击原语义)或空数组
 * (空态卡)。metaSub/assetType 词汇手写镜像 assetManagerData(P8 纪律,
 * 不 import assetManager 模块)。
 *
 * 纯模块零 React;守卫 str() 防御式提取。
 */
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

type RawBag = Record<string, unknown>

export type TheaterKind = 'turnaround' | 'scene' | 'voice'

export interface TheaterTarget {
  kind: TheaterKind;
  anchorId: string;
}

export interface MemberAsset {
  nodeId: string;
  label: string;
  filePath?: string;
  thumbnailUrl?: string;
  /** p04 crops 四命名视图 / p07 views dict urls。 */
  views?: Record<string, string>;
  viewAngle?: string;
  characterId?: string;
  metaSub?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function rawOf(raw: Map<string, RawBag> | null, id: string): RawBag {
  return raw?.get(id) ?? {}
}

function v3Of(graph: FlowGraphV3 | null, id: string) {
  return graph?.nodes.find((n) => n.id === id) ?? null
}

/**
 * 双击目标判定(序:变体组归属 > assetType character/scene > metaSub
 * voice_profile)。非组资产返回 null → 双击原语义(详情面板)零回归。
 */
export function theaterTargetOf(
  node: { id: string; data?: RawBag },
  graph: FlowGraphV3 | null,
  raw: Map<string, RawBag> | null,
): TheaterTarget | null {
  const id = node.id
  // ① 变体组归属(winner/成员/父)→ turnaround(组节点对比语义)
  if (graph != null) {
    for (const g of graph.variantGroups) {
      if (g.winnerNodeId === id || g.variantNodeIds.includes(id)) {
        return { kind: 'turnaround', anchorId: id }
      }
    }
  }
  // ② assetType 域(khs canvas_sync asset_type 词汇)
  const d = node.data ?? {}
  const rd = rawOf(raw, id)
  const assetType = str(d.assetType) ?? str(rd.assetType)
  if (assetType === 'character') return { kind: 'turnaround', anchorId: id }
  if (assetType === 'scene') return { kind: 'scene', anchorId: id }
  // ③ metaSub 声纹域(assetManagerData 词汇镜像)
  const metaSub = str(d.metaSub) ?? str(rd.metaSub)
  if (metaSub === 'voice_profile' || metaSub === 'voice_print') {
    return { kind: 'voice', anchorId: id }
  }
  return null
}

/** 从 V3 资产 + raw 袋提取 MemberAsset(守卫式)。 */
function memberOf(nodeId: string, graph: FlowGraphV3, raw: Map<string, RawBag> | null): MemberAsset | null {
  const n = v3Of(graph, nodeId)
  if (n == null || n.kind !== 'asset') return null
  const d = rawOf(raw, nodeId)
  const viewsIn = d.views
  let views: Record<string, string> | undefined
  if (viewsIn != null && typeof viewsIn === 'object' && !Array.isArray(viewsIn)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(viewsIn as Record<string, unknown>)) {
      const s = str(v)
      if (s != null) out[k] = s
    }
    if (Object.keys(out).length > 0) views = out
  }
  return {
    nodeId,
    label: str(d.label) ?? str(d.characterCanonical) ?? str(d.name) ?? str(d.scene_id) ?? nodeId,
    filePath: str(d.filePath) ?? (n.kind === 'asset' ? (n.media.original ?? undefined) : undefined),
    thumbnailUrl: str(d.thumbnailUrl) ?? (n.kind === 'asset' ? (n.media.thumbnail ?? undefined) : undefined),
    views,
    viewAngle: str(d.viewAngle),
    characterId: str(d.characterId) ?? str(d.characterCanonical),
    metaSub: str(d.metaSub),
  }
}

/** 组员推导:kind 决定 join 键(变体组/characterId global 域/scene_id/声纹双形态)。 */
export function deriveGroupMembers(
  kind: TheaterKind,
  anchorId: string,
  graph: FlowGraphV3 | null,
  raw: Map<string, RawBag> | null,
): MemberAsset[] {
  if (graph == null) return []
  const anchorRaw = rawOf(raw, anchorId)
  const anchor = memberOf(anchorId, graph, raw)
  if (anchor == null) return []

  // 变体组:锚所属组的成员(胜者优先)
  for (const g of graph.variantGroups) {
    if (g.winnerNodeId === anchorId || g.variantNodeIds.includes(anchorId)) {
      const ids = [...(g.winnerNodeId != null ? [g.winnerNodeId] : []), ...g.variantNodeIds.filter((x) => x !== g.winnerNodeId)]
      return ids.map((id) => memberOf(id, graph, raw)).filter((m): m is MemberAsset => m != null)
    }
  }

  if (kind === 'turnaround') {
    // 同 characterId 的 global 域资产集(无 characterId 时仅锚自己)
    const key = anchor.characterId
    if (key == null) return [anchor]
    return graph.nodes
      .filter((n) => n.kind === 'asset' && n.scope === 'global')
      .map((n) => memberOf(n.id, graph, raw))
      .filter((m): m is MemberAsset => m != null && m.characterId === key)
  }

  if (kind === 'scene') {
    // 同 scene_id 资产集
    const key = str(anchorRaw.scene_id) ?? str(anchorRaw.sceneId) ?? anchor.label
    return graph.nodes
      .filter((n) => n.kind === 'asset')
      .map((n) => memberOf(n.id, graph, raw))
      .filter((m): m is MemberAsset => {
        if (m == null) return false
        const rd = rawOf(raw, m.nodeId)
        return (str(rd.scene_id) ?? str(rd.sceneId) ?? m.label) === key
      })
  }

  // voice:voice_profile 锚 + 同 characterId voice_print 集
  const key = anchor.characterId
  const out: MemberAsset[] = [anchor]
  for (const n of graph.nodes) {
    if (n.kind !== 'asset' || n.id === anchorId) continue
    const rd = rawOf(raw, n.id)
    const sub = str(rd.metaSub)
    if (sub === 'voice_print' || sub === 'voice_profile') {
      const m = memberOf(n.id, graph, raw)
      if (m != null && (key == null || m.characterId === key)) out.push(m)
    }
  }
  return out
}

/** 四宫格槽位序(buildTurnaroundGrid 语义平移:face_cu 优先正面槽)。 */
export function turnaroundSlots(members: MemberAsset[]): Array<MemberAsset | null> {
  const slots: Array<MemberAsset | null> = [null, null, null, null]
  const order = ['face_cu', 'front', 'side', 'back']
  const used = new Set<string>()
  for (const want of order) {
    const hit = members.find((m) => !used.has(m.nodeId) && (m.viewAngle === want || m.views?.[want] != null))
    if (hit != null) {
      used.add(hit.nodeId)
      slots[order.indexOf(want)] = hit
    }
  }
  // 未入槽成员按序填空槽
  for (const m of members) {
    if (used.has(m.nodeId)) continue
    const empty = slots.indexOf(null)
    if (empty < 0) break
    slots[empty] = m
    used.add(m.nodeId)
  }
  return slots
}
