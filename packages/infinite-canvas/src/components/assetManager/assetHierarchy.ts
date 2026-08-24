/**
 * 62-04: UI-SPEC 共享 util 提取契约之 handler 家（含 store 副作用）；
 * 纯函数家在 groupCanvasLinkage.ts（零 React / 零 store）。
 *
 * 本模块收拢资产三态流转的三个 handler（selectGroupWinner / deselectAsset /
 * restoreAsset），资产库（AssetLibrary）与资产层级（AssetHierarchy）两视图同调用点
 * （HIER-04：单组行为两路径一致）。handler 经 ctx 注入 assets/patchLocal/reload/
 * showToast 等组件闭包依赖——模块本身不 import store / 不 import React，
 * 但会发起网络副作用（updateAsset / selectVariantWinner），故属 handler 家而非纯函数家。
 *
 * 62-05 追加批量决策层（D-06/D-07）：assetFreshnessKey/pickLatestActive「最新非淘汰」
 * winner 规则 + planBatch{Selection,Elimination} 纯规则 + runBatch{Select,Eliminate}
 * 编排薄层（逐组循环走共享通道，不发明组级事务）。
 *
 * D-05 语义（62-CONTEXT 裁定）：
 *   - 主通道 = updateAsset 循环（winner 置 isPrimaryView+active、同组其余淘汰），
 *     o_assets 为资产中心真值源；失败回滚 reload（既有行为逐字）。
 *   - 增量通道 = 组映射画布且 winner 有节点时，fire-and-forget 调既有
 *     POST /api/canvas/v2/variant-groups/:groupId/select-winner（复用其事务 +
 *     D-07 反向同步 + review bridge + manifest writeback 闭环）。失败仅 toast
 *     「画布侧同步失败」+ console.warn，不回滚不阻断——与 select-winner 自身
 *     「canvas 为真值源不回滚」镜像对称：o_assets 为本域真值源。
 */
import {
  updateAsset,
  selectVariantWinner,
  type AssetDetail,
} from '../../services/canvasApi'
import {
  findVariantGroupForAsset,
  getGroupDisplayInfo,
  getGroupKey,
  isAssetEliminated,
  isAssetPending,
  resolveAssetNodeId,
} from './groupCanvasLinkage'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

/** toast 通道（形状对齐 canvasStore.showToast；本模块不 import store，经 ctx 注入）。 */
export type HierarchyToast = (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void

/** D-05 画布 best-effort 同步参数（组映射画布且 winner 有节点时触发 select-winner）。 */
export interface CanvasSyncCtx {
  projectId: number
  episodesId: number
  graph: FlowGraphV3 | null
}

/** 三态流转共享 handler 的上下文（组件闭包显式化注入；两视图各自构造）。 */
export interface SelectionCtx {
  assets: AssetDetail[]
  patchLocal: (assetId: number, patch: Partial<AssetDetail>) => void
  reload: () => void
  showToast: HierarchyToast
  /** 缺省（store 尚未选定项目/分集）时不触发画布侧同步。 */
  syncCanvas?: CanvasSyncCtx
}

/**
 * 待选→选定：新选资产置 selected，同组其余所有变体自动淘汰（三态流转）。
 * 全程乐观更新——绝不 reload（避免列表闪烁/跳顶），仅在后端失败时回滚。
 * （handleSelect :849-872 全语义逐字搬运；D-05 增量 = 成功 toast 后的
 * fire-and-forget select-winner，见函数尾注释。）
 */
export async function selectGroupWinner(
  assetId: number,
  groupKey: string,
  ctx: SelectionCtx,
): Promise<void> {
  const { assets, patchLocal, reload, showToast } = ctx
  const sameGroup = assets.filter((d) => getGroupKey(d) === groupKey)
  // 同组中除新选资产外的所有其他变体（旧选定 + 待选）全部淘汰
  const others = sameGroup.filter((d) => d.id !== assetId)

  // 1. 乐观更新 UI：其余变体 → 淘汰；新选 → 选定。
  for (const d of others) {
    patchLocal(d.id, { isPrimaryView: false, state: 'eliminated' })
  }
  patchLocal(assetId, { isPrimaryView: true, state: 'active' })

  // 2. 后端同步（不 reload；失败时整体回滚到真实状态）。
  try {
    for (const d of others) {
      try { await updateAsset(d.id, { isPrimaryView: false, state: 'eliminated' }) } catch { /* 忽略单项失败 */ }
    }
    await updateAsset(assetId, { isPrimaryView: true, state: 'active' })
    const groupInfo = getGroupDisplayInfo(assets.find((d) => d.id === assetId)!)
    showToast(`已设为选定资产 · ${groupInfo.title}（${others.length} 个变体已自动淘汰）`, 'success')
  } catch (err) {
    showToast('设置失败: ' + (err as Error).message, 'error')
    await reload()
    return
  }

  // 3. D-05 增量（成功 toast 后）：组映射画布且 winner 有节点 → fire-and-forget
  //    select-winner。不 await 不回滚不阻断。
  //
  // 幂等断言纪律 pin（RESEARCH C 双通道事实，62-07 e2e 必须按此写断言）：
  //   PATCH isPrimaryView=true 服务端已自动触发 applyRegistrySelectionToCanvas
  //   （selectWinnerInGroup 不经 HTTP）——常见路径下本客户端 POST 是幂等 no-op，
  //   属预期行为；UI 不因响应 applied:false 报错，toast「画布侧同步失败」仅挂
  //   客户端 POST 的非 2xx（ApiError），服务端 linkage 失败静默是既有行为。
  const sync = ctx.syncCanvas
  if (!sync) return
  const vg = findVariantGroupForAsset(sync.graph, assetId)
  if (!vg) return
  const nodeId = resolveAssetNodeId(sync.graph, assetId)
  if (!nodeId) return
  void selectVariantWinner(sync.projectId, sync.episodesId, vg.groupId, nodeId)
    .catch(() => {
      ctx.showToast('画布侧同步失败', 'warning')
      console.warn('[assetHierarchy] select-winner 画布侧同步失败（资产态已持久化，不回滚）', {
        groupId: vg.groupId,
        winnerNodeId: nodeId,
        assetId,
      })
    })
}

/**
 * 选定→待选：该资产退回待选，同组被淘汰的兄弟变体（不含自身）一并恢复待选。
 * （renderCard 内联取消选定 handler 体提取具名化；乐观更新 + 后端同步 + toast
 * 文案逐字保留。）
 */
export async function deselectAsset(d: AssetDetail, ctx: SelectionCtx): Promise<void> {
  const { assets, patchLocal, reload, showToast } = ctx
  const groupKey = getGroupKey(d)
  // 同组被淘汰的兄弟变体（不含自身）将随取消选定一并恢复为待选。
  const eliminated = assets.filter(
    (dd) => getGroupKey(dd) === groupKey && dd.id !== d.id && dd.state === 'eliminated',
  )
  // 乐观更新 UI：该资产 → 待选；同组淘汰 → 恢复待选。
  patchLocal(d.id, { isPrimaryView: false, state: 'active' })
  for (const dd of eliminated) patchLocal(dd.id, { state: 'active' })
  // 后端同步（不 reload；失败时回滚）。
  try {
    await updateAsset(d.id, { isPrimaryView: false, state: 'active' })
    for (const dd of eliminated) {
      try { await updateAsset(dd.id, { state: 'active' }) } catch { /* 忽略单项失败 */ }
    }
    showToast(`已退回待选 · ${getGroupDisplayInfo(d).title}（${eliminated.length} 个淘汰变体已恢复）`, 'success')
  } catch (err) {
    showToast('操作失败: ' + (err as Error).message, 'error')
    await reload()
  }
}

/**
 * 淘汰→待选：手动恢复。（renderCard 内联恢复 handler 体提取具名化；文案逐字保留。）
 */
export async function restoreAsset(d: AssetDetail, ctx: SelectionCtx): Promise<void> {
  const { patchLocal, reload, showToast } = ctx
  // 乐观更新 UI：淘汰 → 待选。
  patchLocal(d.id, { state: 'active', isPrimaryView: false })
  try {
    await updateAsset(d.id, { state: 'active' })
    showToast('已恢复到待选', 'success')
  } catch (err) {
    showToast('恢复失败: ' + (err as Error).message, 'error')
    await reload()
  }
}

// ─── 62-05 · 批量决策层（D-06/D-07：组层多选两动作） ──────────
//
// 分层：planBatchSelection / planBatchElimination 为纯规则（可单测）；
// runBatchSelect / runBatchEliminate 为编排薄层——逐组循环走上方共享通道
// （selectGroupWinner / patchLocal+updateAsset），不发明组级事务（D-06）。

/**
 * 「最新」排序键（D-06 winner 规则）：updatedAt ?? createdAt ?? id 三段键。
 * o_assets 现无 updated_at 列——AssetDetail 类型上无该字段，经局部扩展类型声明，
 * 服务端未来透传 updated_at 列后自动前移生效；当前恒落 createdAt（整数 ms，
 * search select('a.*') 已透传——62-05 UI-GREY-1 裁定）；同值并列时 id 单调
 * 自增作键末位决胜（「max(id) 键末位」裁定）。
 * T-62-16：createdAt 畸形值（字符串/NaN）防御——Number() 收窄，非有限值回退 id。
 */
export function assetFreshnessKey(d: AssetDetail): number {
  const withUpdated = d as AssetDetail & { updatedAt?: number | string | null }
  const raw = withUpdated.updatedAt ?? d.createdAt ?? d.id
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : d.id
}

/**
 * 组内「最新非淘汰」候选（D-06 批量选定 winner 规则；自动初始化单组路径同规则
 * 同步升级——D-06 裁定，见 AssetLibrary needsInit）。空组/全淘汰 → null。
 */
export function pickLatestActive(items: AssetDetail[]): AssetDetail | null {
  let best: AssetDetail | null = null
  for (const d of items) {
    if (isAssetEliminated(d)) continue
    if (!best || assetFreshnessKey(d) > assetFreshnessKey(best)) best = d
  }
  return best
}

/** 批量规划输入的组形状（HierarchyGroup 结构兼容子集；isManualScene/isManualVoice
 *  由 buildHierarchyModel 经 isSceneGroup/isVoiceGroup 派生——62-04）。 */
export interface BatchGroup {
  key: string
  items: AssetDetail[]
  isManualScene: boolean
  isManualVoice: boolean
  hasPrimary: boolean
}

/** 批量选定规划结果（D-06/D-07 纯规则产物）。 */
export interface BatchSelectionPlan {
  toSelect: Array<{ assetId: number; groupKey: string }>
  /** 跳过的手动组数（场景/声纹——toast 明示，非静默）。 */
  skippedManual: number
}

/**
 * 批量选定规划（D-06/D-07 纯规则）：
 *   - 场景组/声纹组跳过并计数（D-07 只绑批量选定——批量淘汰不豁免）；
 *   - 已有 winner 组跳过提交（重申选定同 winner 幂等无意义）——D-06「每个选中组
 *     各选一个 winner」按需初始化理解，与自动初始化升级行为同构；
 *   - 其余组取 pickLatestActive（最新非淘汰）恰一条；全淘汰组无物可选不入。
 */
export function planBatchSelection(groups: BatchGroup[]): BatchSelectionPlan {
  const toSelect: BatchSelectionPlan['toSelect'] = []
  let skippedManual = 0
  for (const g of groups) {
    if (g.isManualScene || g.isManualVoice) {
      skippedManual += 1
      continue
    }
    if (g.hasPrimary) continue
    const winner = pickLatestActive(g.items)
    if (!winner) continue
    toSelect.push({ assetId: winner.id, groupKey: g.key })
  }
  return { toSelect, skippedManual }
}

/** 批量淘汰规划结果（D-06 纯规则产物）。 */
export interface BatchEliminationPlan {
  /** 待淘汰资产 id 集（仅待选成员；winner/eliminated 不动）。 */
  assetIds: number[]
  /** 有待选被淘汰的组数（toast 的 N）。 */
  groupCount: number
}

/**
 * 批量淘汰规划（D-06 纯规则）：每组 isAssetPending 成员（winner/已淘汰不动）；
 * 手动组不豁免（D-07 只绑批量选定）。无待选的组不计入 groupCount。
 */
export function planBatchElimination(groups: BatchGroup[]): BatchEliminationPlan {
  const assetIds: number[] = []
  let groupCount = 0
  for (const g of groups) {
    const pending = g.items.filter(isAssetPending)
    if (pending.length === 0) continue
    groupCount += 1
    for (const d of pending) assetIds.push(d.id)
  }
  return { assetIds, groupCount }
}

/**
 * 批量选定编排（D-06 薄层）：plan → 逐组走 selectGroupWinner 共享通道（含 D-05
 * 画布 best-effort 同步——共享通道内语义，不在此重写）。逐项 try/catch 单项忽略
 * （沿自动初始化「忽略单项失败」既有范式；T-62-17：console.warn 单项留痕），
 * 不做部分失败回滚，汇总 toast 报实际提交组数 N=toSelect.length。
 * 文案逐字 UI-SPEC §Copywriting：「批量选定完成 · {N} 组」，跳过数 >0 时追加
 * 「（跳过 {M} 个手动选择组）」。
 */
export async function runBatchSelect(groups: BatchGroup[], ctx: SelectionCtx): Promise<void> {
  const plan = planBatchSelection(groups)
  for (const { assetId, groupKey } of plan.toSelect) {
    try {
      await selectGroupWinner(assetId, groupKey, ctx)
    } catch (err) {
      console.warn('[assetHierarchy] 批量选定单项失败（忽略，不回滚）', { assetId, groupKey, err })
    }
  }
  const skipped = plan.skippedManual > 0 ? `（跳过 ${plan.skippedManual} 个手动选择组）` : ''
  ctx.showToast(`批量选定完成 · ${plan.toSelect.length} 组${skipped}`, 'success')
}

/**
 * 批量淘汰编排（D-06 薄层）：plan → 逐条 patchLocal 乐观淘汰 + updateAsset
 * （state:'eliminated'；winner 不动——plan 已只含待选成员）。单项失败忽略不回滚
 * （T-62-17 同上）；淘汰可经「↻ 恢复」找回，不做 reload。
 * 汇总 toast 文案逐字：「批量淘汰完成 · {N} 组共 {K} 个待选已淘汰」。
 */
export async function runBatchEliminate(groups: BatchGroup[], ctx: SelectionCtx): Promise<void> {
  const plan = planBatchElimination(groups)
  for (const assetId of plan.assetIds) {
    ctx.patchLocal(assetId, { state: 'eliminated' })
    try {
      await updateAsset(assetId, { state: 'eliminated' })
    } catch (err) {
      console.warn('[assetHierarchy] 批量淘汰单项失败（忽略，不回滚）', { assetId, err })
    }
  }
  ctx.showToast(`批量淘汰完成 · ${plan.groupCount} 组共 ${plan.assetIds.length} 个待选已淘汰`, 'success')
}
