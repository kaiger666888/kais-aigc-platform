/**
 * delivery.ts — 交付页数据判定层纯函数（Phase 57-05 Task 1）。
 *
 * 输入 = load-v2 图的 p13 节点透传（D-11 契约面：canvas_sync → save-v2），
 * 不扫文件系统、不新建后端（U-10）。判定规则同源 assetManagerData 的
 * master/package 启发式（A4），三型徽章词汇对齐 p13 OUTPUT_SLOTS
 * master-mp4 / delivery-package / master-qc（U-12）。
 *
 * 纯函数纪律：无 fs / 无网络（护栏 grep 见 PLAN acceptance）；phaseIndex
 * 一律经 PHASE_REGISTRY 条目取得（P13 = khsPrefix 'p13' 条目的 phaseIndex，
 * 禁止字面量内联）；gate 词汇经 src/lib/gateCatalog（54-D02 快照）。
 */
import { PHASE_REGISTRY } from '@ic/constants/phaseRegistry'
import { resolveMediaUrl } from '@ic/utils/mediaUrl'
import { v3theme } from '@ic/theme/catppuccin'
import { GATE_CATALOG, GATE_DISPLAY_NAMES } from '../../../../src/lib/gateCatalog'

/** load-v2 图节点最小形状（FlowGraphNode 的判定切片；fixture 工厂同构）。 */
export interface DeliveryNode {
  id: string
  /** canvasType（graph node.type；master 判定的 video 信号） */
  type?: string
  data?: Record<string, unknown>
}

/** 交付清单三型（U-12；徽章词汇在 KIND_LABEL）。 */
export type DeliveryItemKind = 'master' | 'package' | 'qc'

export interface DeliveryItem {
  id: string
  label: string
  filePath: string | null
  kind: DeliveryItemKind
  size?: number
}

// ─── P13 / p13-gate 词汇（注册表 + gateCatalog 单源，零字面量 phaseIndex）──

const P13 = PHASE_REGISTRY.find((p) => p.khsPrefix === 'p13')

if (!P13) throw new Error('phaseRegistry: p13 条目缺失（契约测试守护对象）')

/** p13 的图数据 phaseIndex（来自注册表条目，非内联数字）。 */
export const P13_PHASE_INDEX: number = P13.phaseIndex

/** p13 人工门（红线 platformInvisible 条目排除——54 U-06）。 */
const P13_GATE_ENTRY = GATE_CATALOG.find(
  (g) => !g.platformInvisible && !g.isRedline && g.phaseId.startsWith(`${P13.khsPrefix}_`),
)

/** 派生 gate id（'p13-gate' 形态，mono 标注用）。 */
export const P13_GATE_ID: string | null = P13_GATE_ENTRY?.derivedGateId ?? null

/** 显示名（「成片交付」，出自 54 GATE_DISPLAY_NAMES——禁止内联）。 */
export const P13_GATE_NAME: string | null = P13_GATE_ENTRY
  ? (GATE_DISPLAY_NAMES[P13_GATE_ENTRY.derivedGateId] ?? null)
  : null

/** 交付清单三型徽章文案（U-12：对齐 p13 OUTPUT_SLOTS 词汇）。 */
export const KIND_LABEL: Record<DeliveryItemKind, string> = {
  master: '成片',
  package: '交付包',
  qc: '质检报告',
}

// ─── 54 四态视图词汇（GateCenterBlock 同源；词表 54 锁定原样）────────────

export type GateDisplay = 'pending' | 'approve' | 'reject' | 'waive' | 'auto'

export const GATE_STATE_LABEL: Record<GateDisplay, string> = {
  pending: '等你决策',
  approve: '放行',
  reject: '驳回',
  waive: '豁免',
  auto: '自动扫描',
}

/** 四态色（54 映射：pending 金只在阻塞态，非阻塞 pending 灰；waive 冷灰）。 */
export function gateDisplayColor(display: GateDisplay, isBlocking = false): string {
  if (display === 'pending') return isBlocking ? v3theme.signal.running : v3theme.signal.pending
  if (display === 'approve') return v3theme.signal.approved
  if (display === 'reject') return v3theme.signal.rejected
  if (display === 'waive') return v3theme.signal.locked
  return v3theme.laneLabel
}

/** 快照年龄（54 原文格式「N 分 N 秒前」）。 */
export function relativeTime(fetchedAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - fetchedAt) / 1000))
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒前`
}

// ─── 节点字段读取（data 为 Record<string, unknown>，等值匹配）────────────

function strOf(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function labelOf(node: DeliveryNode): string | null {
  return strOf(node.data?.label) ?? strOf(node.data?.name)
}

function filePathOf(node: DeliveryNode): string | null {
  return strOf(node.data?.filePath) ?? strOf(node.data?.path)
}

/** 名/路径匹配面（master / package 启发式的输入）。 */
function namePathOf(node: DeliveryNode): string {
  return [labelOf(node), filePathOf(node)].filter(Boolean).join(' ')
}

function numOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function sizeOf(node: DeliveryNode): number | undefined {
  return numOf(node.data?.size) ?? numOf(node.data?.fileSize) ?? numOf(node.data?.file_size)
}

/** 确定性排序键：名称字典序，id 兜底（同名节点稳定输出）。 */
function byLabel(a: DeliveryNode, b: DeliveryNode): number {
  return (labelOf(a) ?? a.id).localeCompare(labelOf(b) ?? b.id) || a.id.localeCompare(b.id)
}

/** video 形判定：canvasType=video，或 assetType=delivery 且 filePath 以 .mp4 结尾（A4）。 */
function isVideoLike(node: DeliveryNode): boolean {
  if (node.type === 'video') return true
  return strOf(node.data?.assetType) === 'delivery' && /\.mp4$/i.test(filePathOf(node) ?? '')
}

/**
 * master 判定（A4，assetManagerData 启发式同源）：
 *  1. video 形节点中 名/路径 /master/i 命中 → 名称字典序第一个；
 *  2. 无命中且唯一 video → 兜底；
 *  3. 多个无标记 → filePath 含 mp4 的第一个（仍无则全体池），名称字典序。
 */
export function pickMaster(nodes: readonly DeliveryNode[]): DeliveryNode | undefined {
  const videos = nodes.filter(isVideoLike)
  if (videos.length === 0) return undefined
  const marked = videos.filter((v) => /master/i.test(namePathOf(v)))
  if (marked.length > 0) return [...marked].sort(byLabel)[0]
  if (videos.length === 1) return videos[0]
  const mp4s = videos.filter((v) => /\.mp4/i.test(filePathOf(v) ?? ''))
  const pool = mp4s.length > 0 ? mp4s : videos
  return [...pool].sort(byLabel)[0]
}

const KIND_RANK: Record<DeliveryItemKind, number> = { master: 0, package: 1, qc: 2 }

/**
 * p13 节点 → 交付清单三型分类（U-12）。master 节点标「成片」；
 * 名/路径 /package|包/ 命中标「交付包」（匹配面含 id——canvas_sync 的
 * p13 工件节点 id 即 OUTPUT_SLOTS 词汇，如 a-delivery_package）；其余
 * 「质检报告」（master-qc 词汇）。输出确定性排序：型序（成片→交付包→
 * 质检报告）→ 名称字典序 → id。
 */
export function classifyDeliveryNodes(
  nodes: readonly DeliveryNode[],
): { master?: DeliveryNode; items: DeliveryItem[] } {
  const master = pickMaster(nodes)
  const items: DeliveryItem[] = nodes.map((node) => {
    const kindFace = `${namePathOf(node)} ${node.id}`
    const kind: DeliveryItemKind =
      master && node.id === master.id
        ? 'master'
        : /package|包/i.test(kindFace)
          ? 'package'
          : 'qc'
    const size = sizeOf(node)
    return {
      id: node.id,
      label: labelOf(node) ?? node.id,
      filePath: filePathOf(node),
      kind,
      ...(size !== undefined ? { size } : {}),
    }
  })
  items.sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  )
  return master ? { master, items } : { master: undefined, items }
}

/** hero 播放地址 = resolveMediaUrl(master.filePath)（D-12，与 53 变体墙同链）。 */
export function masterSrc(master: DeliveryNode | null | undefined): string | null {
  if (!master) return null
  return resolveMediaUrl(filePathOf(master))
}

// ─── projectId 反查（Q5：一集属一项目，episodes[].id 反查）───────────────

export function resolveProjectId(projects: readonly ProjectInfoLike[], ep: number): number | null {
  for (const p of projects) {
    if ((p.episodes ?? []).some((e) => e.id === ep)) return p.id
  }
  return null
}

/** ProjectInfo 判定切片（避免循环依赖；结构兼容 @ic/services/canvasApi ProjectInfo）。 */
export interface ProjectInfoLike {
  id: number
  episodes?: ReadonlyArray<{ id: number }> | null
}

/** 字节数人类可读（KB/MB；UI-Spec 数字格式）。 */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
