/**
 * gateStore.ts — gate 中心独立 zustand store(Phase 54-04 / GATE-02 数据层)。
 *
 * P5 正交轴铁律:gate 是管线轴(p01→p13 审核门),不是资产轴——本文件
 * 对画布主 store 零依赖、零节点级评审字段引用。chip/泳道/面板
 * (54-06/07)只消费这里的 snapshot,不碰画布主 store 的节点字段。
 *
 * P6 广播风暴防线:apply 做载荷级浅比较(gates 数组元素逐项浅比较 +
 * fetchedAt/degrade/blocking 比较),无变化不 set——服务端 30s 轮询 ×
 * N 客户端推送下,zustand subscriber 只在真变化时重渲。
 *
 * payload 契约与 54-05 服务端发射(broadcastToProject 'gate:state')
 * 逐字段钉死(D-03/D-04:平台原始态 POLICY_EVAL/disposition 已在服务端
 * foldDisplayState 折叠,不进 payload)。
 */
import { create } from 'zustand'

/** 单个 gate 的展示态(四态折叠后的产物 + auto 诊断态)。 */
export interface GateStateGate {
  gateId: string
  phaseId: string
  label: string
  /** foldDisplayState 产物:pending/approve/reject/waive;auto = 服务端
   * 诊断为自动通过(AUTO 放行)但无 review 记录的合成态。 */
  display: 'pending' | 'approve' | 'reject' | 'waive' | 'auto'
  reviewId?: number
  updatedAt?: string
  note?: string
}

/** 当前挡住管线的门(唯一人工焦点;null = 管线未被门阻塞)。 */
export interface GateBlocking {
  gateId: string
  reviewId: number
  phaseId: string
  label: string
}

/** gate:state socket 事件体 = 此形状精确(HTTP GET 另有 episodeRefs 诊断键)。 */
export interface GateStatePayload {
  projectId: number
  episodesId: number
  fetchedAt: number
  /** true = 平台不可达,快照来自降级合成(绝不折叠为全放行)。 */
  degrade: boolean
  blocking: GateBlocking | null
  gates: GateStateGate[]
}

interface GateStoreState {
  snapshot: GateStatePayload | null
  degrade: boolean
  /** gate 面板开合(54-06 消费)。 */
  open: boolean
  setOpen: (open: boolean) => void
  /** 应用一次推送/拉取的快照;载荷级浅比较无变化时不触发 subscriber。 */
  apply: (payload: GateStatePayload) => void
}

function gatesEqual(a: GateStateGate[], b: GateStateGate[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.gateId !== y.gateId ||
      x.phaseId !== y.phaseId ||
      x.label !== y.label ||
      x.display !== y.display ||
      x.reviewId !== y.reviewId ||
      x.updatedAt !== y.updatedAt ||
      x.note !== y.note
    ) {
      return false
    }
  }
  return true
}

function blockingEqual(a: GateBlocking | null, b: GateBlocking | null): boolean {
  if (a == null || b == null) return a === b
  return (
    a.gateId === b.gateId &&
    a.reviewId === b.reviewId &&
    a.phaseId === b.phaseId &&
    a.label === b.label
  )
}

/** 载荷级浅比较:fetchedAt/degrade/blocking/gates 四要素全等才视为无变化。 */
function payloadEqual(prev: GateStatePayload, next: GateStatePayload): boolean {
  return (
    prev.fetchedAt === next.fetchedAt &&
    prev.degrade === next.degrade &&
    blockingEqual(prev.blocking, next.blocking) &&
    gatesEqual(prev.gates, next.gates)
  )
}

export const useGateStore = create<GateStoreState>((set, get) => ({
  snapshot: null,
  degrade: false,
  open: false,
  setOpen: (open) => set({ open }),
  apply: (payload) => {
    const prev = get().snapshot
    // degrade=true 的快照照常应用(绝不折叠为全放行)——去重只看内容相等。
    if (prev != null && payloadEqual(prev, payload)) return
    set({ snapshot: payload, degrade: payload.degrade })
  },
}))

// ─── Chip 跳焦三级解析(54-06,SC2) ─────────────────────────────────────────

/** 完整 sub-phase token:与 gateCatalog deriveGateId 同源粒度
 *  ("p13-gate"→"p13"、"p11a0_iframe_qc"→"p11a0");**等值**比较,
 *  p1 与 p11a0 互斥(WR-01 同族纪律,禁前缀式匹配)。 */
function leadingSubToken(value: string): string | null {
  const m = /^p\d+[a-z0-9]*/.exec(value.trim().toLowerCase())
  return m === null ? null : m[0]
}

/**
 * 阻塞门 → 画布代表节点三级解析(等值,非前缀):
 *  1. 节点 id === `g-${gateId}`(门组节点);
 *  2. 节点 id === `n-${phaseId}`(phase 容器节点);
 *  3. 首个 leadingSubToken(node.phaseName) === leadingSubToken(phaseId) 的节点
 *     (该 phase 的首资产)。
 * 三级皆无 → null(调用方只开面板不跳焦,不报错)。
 */
export function resolveRepresentativeNodeId(
  blocking: GateBlocking | null,
  nodes: Array<{ id: string; phaseName?: string }>,
): string | null {
  if (blocking == null) return null
  const byGate = nodes.find((n) => n.id === `g-${blocking.gateId}`)
  if (byGate != null) return byGate.id
  const byPhase = nodes.find((n) => n.id === `n-${blocking.phaseId}`)
  if (byPhase != null) return byPhase.id
  const token = leadingSubToken(blocking.phaseId)
  if (token == null) return null
  const byPhaseName = nodes.find((n) => leadingSubToken(n.phaseName ?? "") === token)
  return byPhaseName?.id ?? null
}
