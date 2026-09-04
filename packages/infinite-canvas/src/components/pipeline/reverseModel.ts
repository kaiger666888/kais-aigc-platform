/**
 * src/components/pipeline/reverseModel.ts — 逆向工程 DAG 视图（viewMode='reverse'）的纯数据层。
 *
 * 内容真值 = kais-gold-remount/docs/REVERSE_DAG_VIEW_SPEC.md §3
 *（溯源 GOLDEN_SET_BLUEPRINT.md §6 v1.2 编排：断言并行 × 依赖反转链 × 三门波次定稿）。
 *
 * 结构：
 *  - A. 镜像节点：复用 model.ts DAG_NODES 的 id/label/phaseCode/group（45 个全量，不裁剪），
 *    泳道按 group 映射三泳道（research|story → T 文本；production → V 视觉；post → V+A 复合）；
 *  - B. 门节点：Kai 审核门 G1/G2/G3（旗标样式，见 DagNode reverse 分支）；
 *  - C. 取证层：src-master 真值源 + 7 条 L0 取证通道（虚线边框）。
 *
 * 边：现有 DAG_EDGES 全量反转（下游定稿是上游的裁判）+ 取证边 + 门边，
 *     全部从右往左流动（配合 layoutDag rankdir:'RL' ⇒ 视觉骨架与原管线 LR 同构）。
 *
 * 本文件零依赖画布运行时数据：REVERSE_STATUS 为静态表
 *（真源 = kais-gold-remount/closure_ledger.jsonl，后续脚本化同步，本期静态）。
 */
import type { DagEdgeDef, DagNodeDef, PhaseGroup } from './model'
import { DAG_NODES, DAG_EDGES } from './model'
import { layoutDag, NODE_WIDTH, NODE_HEIGHT, type LayoutResult } from './dagLayout'

// ─── 词汇表 ──────────────────────────────────────────────────

/** 逆向节点状态（REVERSE_STATUS 静态表；未列出 = 'pending'）。 */
export type ReverseNodeStatus = 'sealed' | 'active' | 'pending' | 'blocked'

/** 三泳道：T 文本 / V 视觉 / V+A 复合（post 双色）。 */
export type ReverseLane = 'text' | 'visual' | 'visual_audio'

/** 节点三类 + 真值源。 */
export type ReverseNodeKind = 'mirror' | 'gate' | 'forensics' | 'source'

/** 逆向节点定义（镜像节点字段从 DAG_NODES 派生，零内联复制）。 */
export interface ReverseNodeDef {
  id: string
  label: string
  kind: ReverseNodeKind
  /** 展示用阶段码：镜像 = 原 phaseCode；门 = G1/G2/G3；取证 = L0；源 = SRC。 */
  phaseCode: string
  /** 沿用 PhaseGroup 词汇（门/取证仅用于详情面板色chip，卡片样式由 kind 决定）。 */
  group: PhaseGroup
  /** 泳道（仅镜像节点；门/取证不着泳道色 → null）。 */
  lane: ReverseLane | null
  /** 门节点旗标字样（G1/G2/G3）。 */
  gateTag?: 'G1' | 'G2' | 'G3'
}

// ─── A. 镜像节点（45 个 = DAG_NODES 全量） ───────────────────

/** group → 三泳道（规格 §3.3：research+story→T；production→V；post→V+A 复合）。 */
function laneOfGroup(group: PhaseGroup): ReverseLane {
  switch (group) {
    case 'research':
    case 'story':
      return 'text'
    case 'production':
      return 'visual'
    case 'post':
      return 'visual_audio'
  }
}

const MIRROR_NODES: readonly ReverseNodeDef[] = DAG_NODES.map((d: DagNodeDef): ReverseNodeDef => ({
  id: d.id,
  label: d.label,
  kind: 'mirror',
  phaseCode: d.phaseCode,
  group: d.group,
  lane: laneOfGroup(d.group),
}))

// ─── B. 门节点（Kai 审核门 ×3） ──────────────────────────────
// 插入位置（rank 语义）由门边在 dagre RL 布局中自然落位：
//   gate-g1  post 泳道前（P11 组之前）—— W1a 批量审页 → 冻结；
//   gate-g2  production 泳道后（资产层闭合后）—— TR/场景/条件帧/视频批次送审；
//   gate-g3  最左端（requirement 之后）—— 封存终审。

const GATE_NODES: readonly ReverseNodeDef[] = [
  { id: 'gate-g1', label: '分镜prompt定稿门', kind: 'gate', phaseCode: 'G1', group: 'post', lane: null, gateTag: 'G1' },
  { id: 'gate-g2', label: '资产盲测门', kind: 'gate', phaseCode: 'G2', group: 'production', lane: null, gateTag: 'G2' },
  { id: 'gate-g3', label: '黄金集封存审', kind: 'gate', phaseCode: 'G3', group: 'research', lane: null, gateTag: 'G3' },
]

// ─── C. 取证层（src-master 真值源 + L0 五通道 → 7 取证节点） ──
// 布局在主骨架下方独立一行（见 ReversePipelineView 的取证层行后处理）。

const FORENSICS_NODES: readonly ReverseNodeDef[] = [
  { id: 'src-master', label: '原片成品（真值源）', kind: 'source', phaseCode: 'SRC', group: 'post', lane: null },
  { id: 'forensics-cuts', label: '物理切镜表', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-frames', label: '首尾帧直抽', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-asr', label: 'ASR台词对齐', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-stems', label: '音轨stem分解', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-motion', label: '运镜抽帧序列', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-reid', label: '角色reid聚类', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
  { id: 'forensics-sceneframes', label: '场景干净帧候选', kind: 'forensics', phaseCode: 'L0', group: 'post', lane: null },
]

/** 逆向节点全集（45 镜像 + 3 门 + 8 取证层）。 */
export const REVERSE_NODES: readonly ReverseNodeDef[] = [
  ...MIRROR_NODES,
  ...GATE_NODES,
  ...FORENSICS_NODES,
]

/** 参与布局的节点 id 全集。 */
export const REVERSE_NODE_IDS: readonly string[] = REVERSE_NODES.map((n) => n.id)

/** 取证层行顺序（右→左）：src-master 最右（与主图右端对齐），取证通道依次向左。 */
export const FORENSICS_ROW_ORDER: readonly string[] = FORENSICS_NODES.map((n) => n.id)


// ─── 边（全部从右往左流动） ──────────────────────────────────

/**
 * 逆向边集：
 *  1. 反转边 = DAG_EDGES 每条 {from,to} 精确反转为 {from:to, to:from}，kind 保留
 *    （gate/back 虚实线规则沿用；语义：逆向断言链——下游定稿是上游的裁判）；
 *  2. 取证边 = src-master → 7 条 L0 通道；通道 → 对应镜像断言目标（规格 §3.2 全表）；
 *  3. 门边 = G1/G2/G3 的编排语义（GOLDEN_SET_BLUEPRINT §6）。
 */
export const REVERSE_EDGES: readonly DagEdgeDef[] = [
  // ── 1. 反转边（DAG_EDGES 全量精确反转） ──
  ...DAG_EDGES.map((e): DagEdgeDef => ({ from: e.to, to: e.from, kind: e.kind })),

  // ── 2. 取证边 ──
  // src-master → 各取证节点（L0 通道，机械提取、零断言）
  { from: 'src-master', to: 'forensics-cuts' },
  { from: 'src-master', to: 'forensics-frames' },
  { from: 'src-master', to: 'forensics-asr' },
  { from: 'src-master', to: 'forensics-stems' },
  { from: 'src-master', to: 'forensics-motion' },
  { from: 'src-master', to: 'forensics-reid' },
  { from: 'src-master', to: 'forensics-sceneframes' },
  // 取证通道 → 镜像断言目标（断言层并行全开的取证输入）
  { from: 'forensics-cuts', to: 'shot-list' },
  { from: 'forensics-frames', to: 'iframe-generation' },
  { from: 'forensics-asr', to: 'voice-clips' },
  { from: 'forensics-asr', to: 'script-draft' },
  { from: 'forensics-stems', to: 'voice-clips' },
  { from: 'forensics-motion', to: 'video-clips' },
  { from: 'forensics-reid', to: 'character-bible' },
  { from: 'forensics-sceneframes', to: 'scene-images' },

  // ── 3. 门边（三门波次定稿） ──
  // G1：93 镜 prompt 审页在视觉闭合前；冻结 prompt = L2 全部回放闭合的裁判输入
  { from: 'video-clips', to: 'gate-g1' },
  { from: 'gate-g1', to: 'iframe-generation', kind: 'gate' },
  { from: 'gate-g1', to: 'voice-clips', kind: 'gate' },
  // G2：资产层（TR/场景）盲测送审 → 文本定稿吃资产定稿
  { from: 'character-bible', to: 'gate-g2' },
  { from: 'scene-images', to: 'gate-g2' },
  { from: 'gate-g2', to: 'script-draft' },
  // G3：全链定稿 → 黄金集封存终审（最左端）
  { from: 'script-draft', to: 'gate-g3' },
]

// ─── 布局（LR + 输入边反转 + 整体水平镜像 + 取证行重排） ──────
//
// ⚠️ 与规格书 §4 字面的冲突适配（代码现实优先，等价改写）：
// 规格字面是 `layoutDag(REVERSE_NODE_IDS, REVERSE_EDGES, { rankdir: 'RL' })`。
// 但 dagre 的 RL 不是 LR 的水平镜像——它按 RL 语义独立重排（同 rank 节点从下往上排），
// 会产生两处与「贴近原管线」目标相悖的结果（实测：节点 52 / 边 99）：
//  ① src-master 坠入图中央（y≈269，主图 y 范围 24..1532）——真值源不在最右端；
//  ② 取证 8 节点散布 4 个 y 层——不成「主图下方独立一行」。
// 根因：dagre 为平衡边交叉把长程边（src-master→7 通道）的源拉向中间 rank，纯选项无解。
// 等价改写（视觉效果与规格意图一致）：
//  - 结构性反转：喂给 dagre 的边 = REVERSE_EDGES 的**端点交换**（from↔to）。
//    这样 dagre 按「生产流拓扑」排 rank（恰好是原管线的 rank 语义 → 骨架同构），
//    且 src-master/取证行是「纯 sinks」→ dagre 天然推到最右；
//  - rankdir 'LR' + 事后把全部 x 坐标做整体水平镜像 ⇒ 视觉上右→左（与 RL 等价），
//    且 y 逐行不变（LR 与 RL 的 y 排序差被消除）。
// REVERSE_EDGES 本身不变（仍是从右往左的裁判语义），仅布局输入边做端点交换。
// specLayoutResult 的边点同样镜像，保证渲染层 edgePathD 的源=左缘、目标=右缘几何成立。

/** 供 dagre 消费的结构性反转边（from↔to 端点交换；与 REVERSE_EDGES 语义方向相反）。 */
const REVERSE_LAYOUT_EDGES: ReadonlyArray<{ from: string; to: string }> = REVERSE_EDGES.map(
  (e) => ({ from: e.to, to: e.from }),
)

/** 把 LR 布局结果整体水平镜像（保持包围盒左缘不动；y 不变）。 */
function mirrorLR(result: ReturnType<typeof layoutDag>): ReturnType<typeof layoutDag> {
  const minX = Math.min(...result.nodes.map((n) => n.x))
  const mirrorX = (x: number): number => minX - (x - minX) - NODE_WIDTH
  return {
    ...result,
    nodes: result.nodes.map((n) => ({ ...n, x: mirrorX(n.x) })),
    edges: result.edges.map((e) => ({
      ...e,
      // 点序也随之镜像；渲染层会把首尾重新吸附到（已镜像的）节点边界
      points: [...e.points].reverse().map((p) => ({ x: mirrorX(p.x), y: p.y })),
    })),
  }
}

/**
 * 逆向视图布局（唯一布局入口，ReversePipelineView 与测试共用）。
 * 步骤：① dagre LR + 结构性反转边（生产流拓扑）→ ② 整体水平镜像（视觉右→左）→
 * ③ 取证 8 节点摘出，重排为「主图下方独立一行」：src-master 与主图最右端对齐、
 *    7 条 L0 通道横排、行内边仍右→左（见规格 §4 取证层行）。
 */
export function layoutReverseDag(): ReturnType<typeof layoutDag> {
  const laid = mirrorLR(layoutDag(REVERSE_NODE_IDS, REVERSE_LAYOUT_EDGES))
  const nodes = [...laid.nodes]
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // 主图（镜像节点）包围盒 → 取证行 y（主图底缘 + 固定间距）
  const mirrors = nodes.filter((n) => REVERSE_NODE_BY_ID.get(n.id)?.kind === 'mirror')
  if (mirrors.length > 0) {
    const mainMaxY = Math.max(...mirrors.map((n) => n.y + NODE_HEIGHT))
    // 主图右缘 = 镜像节点右缘最大值（含卡宽）
    const mainRight = Math.max(...mirrors.map((n) => n.x + NODE_WIDTH))
    const rowY = mainMaxY + 120
    const rowGap = 40 // 行内水平间距（横排）
    const positions = new Map<string, { x: number; y: number }>()
    // 从主图右缘向左排：src-master 最右且右缘与主图右缘精确对齐（规格 §3.1「源节点，最右端」）
    let cursorRight = mainRight
    for (const id of FORENSICS_ROW_ORDER) {
      const x = cursorRight - NODE_WIDTH
      positions.set(id, { x, y: rowY })
      cursorRight = x - rowGap
    }
    for (const [id, pos] of positions) {
      const n = byId.get(id)!
      n.x = pos.x
      n.y = pos.y
    }
  }

  // 边点同步：取证行节点的边端点吸附由渲染层 edgePathD 重算（节点边界中点），
  // 这里仅重镜像中段折点已由 mirrorLR 处理；行重排后的中段点直接清空
  //（edgePathD 对空 points 回退节点边界吸附，路径仍平滑）。
  const forensicIds = new Set(FORENSICS_ROW_ORDER)
  const edges = laid.edges.map((e) => {
    if (forensicIds.has(e.from) || forensicIds.has(e.to)) return { ...e, points: [] }
    return e
  })

  // 重算包围盒（行重排后）
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH))
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT))
  return { nodes, edges, width: maxX - minX, height: maxY - minY }
}

/** 逆向节点查表（id → def；视图渲染与详情面板共用）。 */
export const REVERSE_NODE_BY_ID: ReadonlyMap<string, ReverseNodeDef> = new Map(REVERSE_NODES.map((n) => [n.id, n]))

// ─── 状态静态表（本视图唯一数据源） ──────────────────────────
// 真源 = /data/workspace/kais-gold-remount/closure_ledger.jsonl（后续脚本化同步，本期静态）。
export const REVERSE_STATUS: Record<string, ReverseNodeStatus> = {
  'src-master': 'sealed',            // 原片在手
  'forensics-cuts': 'sealed', 'forensics-frames': 'sealed', 'forensics-asr': 'sealed',
  'forensics-reid': 'sealed', 'forensics-sceneframes': 'sealed',
  'forensics-stems': 'pending', 'forensics-motion': 'pending',
  'scene-images': 'sealed',          // W1c 7/7 闭环
  'shot-list': 'active', 'video-clips': 'active', // W1a s064 样板闭环、93镜批量进行中
  'character-bible': 'active',       // W1b 首轮已出、盲测修复中
  // 其余全部 'pending'（缺省值，未列出的节点按 pending 处理）
}

/** 未列出节点 → pending（规格 §3.3 缺省规则）。 */
export function reverseStatusOf(id: string): ReverseNodeStatus {
  return REVERSE_STATUS[id] ?? 'pending'
}

/** 状态图例（视图左下角固定图例卡）：sealed=金绿 / active=琥珀 / pending=灰 / blocked=红。 */
export const REVERSE_STATUS_META: Record<ReverseNodeStatus, { glyph: string; color: string; label: string }> = {
  sealed: { glyph: '✓', color: '#56B89A', label: '已封存' },
  active: { glyph: '⟳', color: '#E0B665', label: '进行中' },
  pending: { glyph: '○', color: '#9A9FA8', label: '待启动' },
  blocked: { glyph: '✕', color: '#DD6A82', label: '受阻' },
}

/**
 * 泳道色（KAP v3theme 四模态词汇表内取色）。
 * 注：规格书原文 T 泳道为「蓝」，但 KAP 全 UI 色彩词汇表（v3theme v2）已无蓝色通道
 *（text=#E0B665 金 / image=#56B89A 青 / audio=#E08547 橙 / video=#DD6A82 玫）——
 * 按代码现实最小适配：T 文本 → text 金，V 视觉 → image 青，post 双色 → V 青 + A 橙双点。
 */
export const REVERSE_LANE_META: Record<ReverseLane, { label: string; colors: readonly string[] }> = {
  text: { label: 'T 文本', colors: ['#E0B665'] },
  visual: { label: 'V 视觉', colors: ['#56B89A'] },
  visual_audio: { label: 'V+A 复合', colors: ['#56B89A', '#E08547'] },
}

/**
 * kgr 证据路径静态映射（规格 §3.4；仅列规格点名的三个镜像节点，其余走缺省提示）。
 * 真源提示，不做存在性校验（S4_closures 为 kgr 侧规划目录）。
 */
export const REVERSE_EVIDENCE_PATHS: Record<string, string> = {
  'scene-images': 'S4_closures/p07_scenes/',
  'video-clips': 'S4_closures/p11b_batch/',
  'character-bible': 'S4_closures/p04_tr_batch/',
}

/** 缺省证据提示（无专用闭包目录映射的节点）。 */
export const REVERSE_EVIDENCE_FALLBACK = 'kgr closure_ledger.jsonl（真源账本）'

// ─── 逆向图邻接 / 闭包（hover 高亮「裁判链」用） ──────────────

/** 直接入边源 id 列表（REVERSE_EDGES 中 to === id 的 from；在 RL 布局里位于右侧 = 它的裁判）。 */
export function reverseParentsOf(nodeId: string): string[] {
  return REVERSE_EDGES.filter((e) => e.to === nodeId).map((e) => e.from)
}

/** 直接出边目标 id 列表（REVERSE_EDGES 中 from === id 的 to；左侧 = 被它裁决的断言）。 */
export function reverseChildrenOf(nodeId: string): string[] {
  return REVERSE_EDGES.filter((e) => e.from === nodeId).map((e) => e.to)
}

/** 祖先闭包（含自身）—— hover 时高亮右侧裁判链。 */
export function reverseAncestorsOf(nodeId: string): Set<string> {
  const out = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const p of reverseParentsOf(cur)) {
      if (!out.has(p)) {
        out.add(p)
        stack.push(p)
      }
    }
  }
  out.add(nodeId)
  return out
}

/** 后代闭包（含自身）—— hover 时高亮左侧被裁决链。 */
export function reverseDescendantsOf(nodeId: string): Set<string> {
  const out = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const c of reverseChildrenOf(cur)) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  out.add(nodeId)
  return out
}

// ─── 完整性校验（导出供测试；构建/CI 入口） ───────────────────

/**
 * validateReverseGraph —— 规格 §6 的 1/2/3/4/5 条静态校验（第 6 条布局测试在
 * reverseModel.test.ts 内直接跑 layoutDag）。返回 issue 列表（空 = 全部通过）：
 *  1. 每条 REVERSE_EDGES 端点都在 REVERSE_NODES 中（无悬空边）；
 *  2. 反转边集合 = DAG_EDGES 的精确反转（条数相等、无重复）；
 *  3. 图无环（Kahn 拓扑排序通过）；
 *  4. gate-g1/gate-g2/gate-g3 与 src-master 存在且各至少一条入边；
 *  5. REVERSE_STATUS 引用的节点 id 全部存在。
 */
export function validateReverseGraph(): string[] {
  const issues: string[] = []
  const nodeById = new Map(REVERSE_NODES.map((n) => [n.id, n]))

  // 1. 无悬空边
  for (const e of REVERSE_EDGES) {
    if (!nodeById.has(e.from)) issues.push(`边 ${e.from}→${e.to} 的起点未定义：${e.from}`)
    if (!nodeById.has(e.to)) issues.push(`边 ${e.from}→${e.to} 的终点未定义：${e.to}`)
  }

  // 2. 反转边集合 = DAG_EDGES 精确反转
  const mirrorIds = new Set(MIRROR_NODES.map((n) => n.id))
  const reversedSubset = REVERSE_EDGES.filter((e) => mirrorIds.has(e.from) && mirrorIds.has(e.to))
  if (reversedSubset.length !== DAG_EDGES.length) {
    issues.push(`反转边条数 ${reversedSubset.length} ≠ 原 DAG_EDGES 条数 ${DAG_EDGES.length}`)
  }
  const expectedReversed = new Set(DAG_EDGES.map((e) => `${e.to}|${e.from}`))
  const seenReversed = new Set<string>()
  for (const e of reversedSubset) {
    const key = `${e.from}|${e.to}`
    if (seenReversed.has(key)) issues.push(`反转边重复：${key}`)
    seenReversed.add(key)
    if (!expectedReversed.has(key)) issues.push(`边 ${key} 不是 DAG_EDGES 的精确反转（多出）`)
  }
  for (const key of expectedReversed) {
    if (!seenReversed.has(key)) issues.push(`边 ${key} 缺失（DAG_EDGES 反转后未出现在 REVERSE_EDGES）`)
  }

  // 3. 无环（Kahn 拓扑排序）。
  //    ⚠️ 与规格书的冲突适配：原 DAG_EDGES 本身就带 3 条 kind='back' 打回回环边
  //    （preview-gate→voice-clips / preview-gate→shot-list 等），正向图即存在刻意的
  //    迭代回环（shot-list→preview-clips→rough-cut→preview-gate→shot-list）。精确反转
  //    必然继承回环——而规格 §6 第 2 条要求反转边集合 = DAG_EDGES 精确反转（条数相等），
  //    两条不可同时按字面成立。按代码现实最小适配：kind='back' 反馈边**豁免拓扑排序**
  //    （端点存在性仍在第 1 条检查、条数仍在第 2 条检查），拓扑排序只对非反馈子图断言无环。
  //    这与 model.ts validateDagEdges 的 BACK_EDGES 豁免先例一致。
  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const id of REVERSE_NODE_IDS) {
    indeg.set(id, 0)
    adj.set(id, [])
  }
  for (const e of REVERSE_EDGES) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue // 悬空边已在 1 记录
    if (e.kind === 'back') continue                      // 打回回环 = 反馈边，豁免拓扑
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    adj.get(e.from)!.push(e.to)
  }
  let queue = REVERSE_NODE_IDS.filter((id) => (indeg.get(id) ?? 0) === 0)
  let visited = 0
  while (queue.length > 0) {
    const next: string[] = []
    for (const id of queue) {
      visited++
      for (const t of adj.get(id) ?? []) {
        const d = (indeg.get(t) ?? 0) - 1
        indeg.set(t, d)
        if (d === 0) next.push(t)
      }
    }
    queue = next
  }
  if (visited !== REVERSE_NODE_IDS.length) {
    issues.push(`非反馈子图存在环：拓扑排序仅覆盖 ${visited}/${REVERSE_NODE_IDS.length} 节点`)
  }

  // 4. 门 + 真值源存在。
  //    ⚠️ 与规格书字面的适配：G1/G2/G3 各要求 ≥1 入边（审的是具体定稿产物）；
  //    src-master 是「原片成品（真值源）」——逆向链最右端源头，构造上即无入边，
  //    故只断言存在性（若按字面给它造入边，需发明规格 §3 节点清单之外的结构，违反内容真值）。
  for (const id of ['gate-g1', 'gate-g2', 'gate-g3']) {
    if (!nodeById.has(id)) {
      issues.push(`关键节点缺失：${id}`)
      continue
    }
    const inDeg = REVERSE_EDGES.filter((e) => e.to === id).length
    if (inDeg === 0) issues.push(`审核门 ${id} 无入边（未挂接任何被审产物）`)
  }
  if (!nodeById.has('src-master')) issues.push('关键节点缺失：src-master（真值源）')

  // 5. REVERSE_STATUS 键全部存在
  for (const id of Object.keys(REVERSE_STATUS)) {
    if (!nodeById.has(id)) issues.push(`REVERSE_STATUS 引用了未定义节点：${id}`)
  }

  return issues
}
