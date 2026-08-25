import type { FlowGraph, FlowBranch, LegacyFlowData, FlowGraphNode } from '../types/canvas'
import type { FlowGraphV2WireShape } from '../v3/serialize'
// Phase 54-04: gate:state payload 契约真值源(gateStore)。
import type { GateStatePayload } from '../store/gateStore'
// 60-02 (D-01): save-v2 自回声判定身份——单点附加,六个调用方零改动全覆盖
// (handleSave/handleOrchestrate/ContextMenu/canvasStore 两处/useStaleRerun,
// 含 rerun 先存再跑的保存路径,Pitfall 5 根治)。
import { getClientTabId } from './clientTabId'

const API_BASE = '/api'
const TIMEOUT_MS = 15_000
const MAX_RETRIES = 2

// ─── CancelToken ──────────────────────────────────────────

export class CancelToken {
  private aborted = false
  private controller = new AbortController()

  get signal(): AbortSignal {
    return this.controller.signal
  }

  cancel(): void {
    this.aborted = true
    this.controller.abort()
  }

  get isCancelled(): boolean {
    return this.aborted
  }
}

export function createCancelToken(): CancelToken {
  return new CancelToken()
}

// ─── Error Types ──────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly type: 'network' | 'timeout' | 'business' | 'cancelled',
    public readonly code?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Core apiCall ─────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function apiCall<T>(
  path: string,
  body: unknown,
  options?: { cancelToken?: CancelToken; timeout?: number },
): Promise<T> {
  const { cancelToken, timeout = TIMEOUT_MS } = options ?? {}

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (cancelToken?.isCancelled) {
      throw new ApiError('请求已取消', 'cancelled')
    }

    // WR-07: arm a FRESH timeout per attempt. The old code armed one timeout
    // controller before the loop and cleared it after attempt 0 — retries
    // then ran on an abort signal nothing could fire anymore, so a hung
    // retry fetch never timed out (selectWinner could hang forever with no
    // rollback, violating SC-2). Total time stays bounded:
    // (MAX_RETRIES+1) × timeout + backoffs.
    const attemptTimeout = new AbortController()
    const tid = setTimeout(() => attemptTimeout.abort(), timeout)

    // Link cancel token signal and this attempt's timeout signal
    const signals: AbortSignal[] = [attemptTimeout.signal]
    if (cancelToken) signals.push(cancelToken.signal)

    const combinedController = new AbortController()
    const onAbort = () => combinedController.abort()
    signals.forEach((s) => {
      if (s.aborted) {
        combinedController.abort()
      } else {
        s.addEventListener('abort', onAbort, { once: true })
      }
    })

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: combinedController.signal,
      })

      if (!res.ok) {
        // WR-07: classify by HTTP status. 4xx is a deterministic business
        // failure (400 validation / 404 group-missing / 409 multi-mode or
        // locked) — retrying can never succeed and only delays the user-
        // facing rollback. 5xx is server-side and retriable like a network
        // error.
        if (res.status >= 400 && res.status < 500) {
          throw new ApiError(`HTTP ${res.status}`, 'business', res.status)
        }
        throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
      }

      const json = await res.json()

      if (json.code === 404) {
        return json as T
      }

      if (json.code !== 200 && json.code !== 0) {
        throw new ApiError(json.message || '请求失败', 'business', json.code)
      }

      return json as T
    } catch (err: any) {
      if (cancelToken?.isCancelled) {
        throw new ApiError('请求已取消', 'cancelled')
      }

      if (err instanceof ApiError) {
        if (err.type === 'business') throw err
        lastError = err
      } else if (err.name === 'AbortError') {
        throw new ApiError(`请求超时（${timeout / 1000}秒）`, 'timeout')
      } else {
        lastError = new ApiError(err.message || '网络错误', 'network')
      }

      // Retry with exponential backoff for network / 5xx errors
      if (attempt < MAX_RETRIES) {
        const backoff = 1000 * Math.pow(2, attempt)
        await sleep(backoff)
      }
    } finally {
      clearTimeout(tid)
      signals.forEach((s) => s.removeEventListener('abort', onAbort))
    }
  }

  throw lastError ?? new ApiError('未知错误', 'network')
}

// ─── 项目 & 剧本 ─────────────────────────────────────────

export interface ProjectEpisode {
  id: number
  nodeCount: number
}

export interface ProjectInfo {
  id: number
  name: string
  type?: string | null
  mode?: string | null
  intro?: string | null
  artStyle?: string | null
  imageModel?: string | null
  videoModel?: string | null
  createTime?: number | null
  /** 画布真实内容统计（从 canvas_nodes 实时聚合，替代旧的 o_script/o_assets 空表 count）。 */
  assetCount: number
  storyboardCount: number
  videoCount: number
  episodeCount: number
  episodes: ProjectEpisode[]
}

export interface ScriptInfo {
  id: number
  name: string | null
  content: string | null
  extractState: number | null
  createTime: number | null
  assetCount: number
  storyboardCount: number
}

/** 获取所有项目列表 */
export async function fetchProjects(cancelToken?: CancelToken): Promise<ProjectInfo[]> {
  const json = await apiCall<{ data?: ProjectInfo[] }>('/canvas/projects', {}, { cancelToken })
  return json.data ?? []
}

/** 获取项目下的剧本列表 */
export async function fetchProjectScripts(projectId: number, cancelToken?: CancelToken): Promise<ScriptInfo[]> {
  const json = await apiCall<{ data?: ScriptInfo[] }>('/canvas/projectData', { projectId }, { cancelToken })
  return json.data ?? []
}

// ─── Asset Registry (全局资产注册表) ──────────────────────

/** 资产详情（含 filePath） */
export interface AssetDetail {
  id: number
  uuid: string | null
  name: string | null
  type: string | null
  prompt: string | null
  describe: string | null
  projectId: number | null
  characterId: string | null
  viewAngle: string | null
  isPrimaryView: boolean | null
  model: string | null
  tags: string | null
  state: string | null
  meta: string | null
  filePath: string | null
  imageState: string | null
  imageModel: string | null
  resolution: string | null
  /**
   * 62-05 UI-GREY-1 裁定：服务端 search select('a.*') 已透传 o_assets.createdAt；
   * 批量选定 winner 规则的『最新』排序键首位，未来 updated_at 列落地后前移。
   */
  createdAt?: number | null
}

/**
 * 从全局资产注册表查询单个资产详情（含文件路径）。
 * 当画布节点的 data.filePath 缺失时，可通过 assetId 异步补全。
 */
export async function fetchAssetDetail(
  assetId: number,
  cancelToken?: CancelToken,
): Promise<AssetDetail> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (cancelToken) signals.push(cancelToken.signal)
  const combinedController = new AbortController()
  const onAbort = () => combinedController.abort()
  signals.forEach((s) => {
    if (s.aborted) combinedController.abort()
    else s.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const res = await fetch(`${API_BASE}/v1/assets-registry/${assetId}`, {
      method: 'GET',
      signal: combinedController.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
    const json = await res.json()
    return json.data as AssetDetail
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 批量查询项目资产（Primary 资产列表）。
 */
export async function fetchProjectAssets(
  projectId: number,
  cancelToken?: CancelToken,
): Promise<AssetDetail[]> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (cancelToken) signals.push(cancelToken.signal)
  const combinedController = new AbortController()
  const onAbort = () => combinedController.abort()
  signals.forEach((s) => {
    if (s.aborted) combinedController.abort()
    else s.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const res = await fetch(`${API_BASE}/v1/assets-registry/project/${projectId}`, {
      method: 'GET',
      signal: combinedController.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
    const json = await res.json()
    return json.data.assets as AssetDetail[]
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 搜索资产（跨项目）。
 * 参数对齐后端 POST /api/v1/assets-registry/search 的 schema：
 * query / type / projectId(null=全局) / characterId / tags / state / limit / offset / includeFile。
 */
export async function searchAssets(
  params: {
    query?: string
    type?: string
    projectId?: number | null
    characterId?: string
    tags?: string
    state?: string
    limit?: number
    offset?: number
    includeFile?: boolean
  },
  cancelToken?: CancelToken,
): Promise<AssetDetail[]> {
  const json = await apiCall<{ data: { assets: AssetDetail[] } }>('/v1/assets-registry/search', params, { cancelToken })
  return json.data.assets
}

/**
 * Update a single asset's metadata via PATCH /api/v1/assets/:id.
 * Used for isPrimaryView, tags, state, etc.
 */
export async function updateAsset(
  assetId: number,
  updates: { isPrimaryView?: boolean; tags?: string; state?: string; name?: string; describe?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/assets-registry/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
}

// ─── 画布图（FlowGraph） ──────────────────────────────────

/**
 * 保存画布图（V2 格式，走 save-v2 端点）。
 *
 * Phase 51 WRITE-01：一次性切换到既有 `/api/canvas/v2/save-v2`（zod 校验 +
 * 结构化参数强制 + graph:saved 广播），v1 `/canvas/save` 路由已删除。
 * graph 参数为 serializeGraphToV2 的输出形状（canonical V3 → FlowGraphV2 wire）。
 */
export async function saveCanvasGraph(
  projectId: number,
  episodesId: number,
  graph: FlowGraphV2WireShape,
  cancelToken?: CancelToken,
): Promise<void> {
  // 60-02 (D-01): body 自动附 savedBy(页面级 tabId 单例)——服务端原样回显进
  // graph:saved 广播,本端 onGraphSaved 据此跳过自回声 reload。签名不变,
  // 全部调用方零改动天然携带身份。
  await apiCall<void>('/canvas/v2/save-v2', { projectId, episodesId, graph, savedBy: getClientTabId() }, { cancelToken })
}

/**
 * 加载画布图（V2 端点）。
 *
 * 走 `/api/canvas/v2/load-v2` —— 后端返回**完整 FlowGraphV2**（含 meta/branches/
 * variantGroups + 节点顶层 branchId/phaseIndex/phaseName），正是 adaptV2Graph 消费
 * 的规范形状。旧的 v1 `/canvas/load` 会把图降级为无 meta 的 v1 形状，丢失项目身份
 * 与分支/变体组信息；这里改打 v2 端点避免该损耗。
 * 空项目（后端返回 data:null）→ 返回 null，由调用方回退到 convert。
 */
export async function loadCanvasGraph(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<FlowGraph | null> {
  const json = await apiCall<{ code?: number; data?: FlowGraph }>('/canvas/v2/load-v2', { projectId, episodesId }, { cancelToken })
  if (json.code === 404 || !json.data) return null
  return json.data
}

/** 将现有项目数据转换为画布节点 */
export async function convertProjectData(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<FlowGraph> {
  const json = await apiCall<{ data: FlowGraph }>('/canvas/convert', { projectId, episodesId }, { cancelToken })
  return json.data
}

// ─── 节点执行 ─────────────────────────────────────────────

/** 触发节点执行 */
export async function executeNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  nodeType: string,
  // 52-02: extra 提交通道(REGEN-01/02)——重生成/换 seed 经此携带新 prompt/seed/params;
  // 服务端 zod 契约层接受并忽略(模拟器语义不变),e2e 经 mock logCall 完整 body 断言到达。
  // 可选参数,既有调用方(CanvasContextMenu handleExecute)不传 extra,向后兼容零改动。
  // Phase 59 (59-02/59-03): extra 新增 regenSource 窄触发身份标识——服务端在任务成功
  // 且携带此标识时经 markStaleAndBroadcast 把下游标 stale(级联+落库+node:updated 广播);
  // 仅面板「重生成」('panel-regen')与事件芯片换 seed('reroll-seed')两条窄路径携带,
  // orchestrate/ContextMenu 客户端链永不携带(SC3 架构性保证)。展开逻辑零改动(...extra
  // 平铺透传,加字段即达)。
  extra?: {
    prompt?: string
    seed?: number
    params?: Record<string, unknown>
    regenSource?: 'panel-regen' | 'reroll-seed'
  },
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>(
    '/canvas/execute',
    { projectId, episodesId, nodeId, nodeType, ...extra },
    { cancelToken },
  )
}

// ─── 一键成片 / 批量执行 (Phase 36/37) ───────────────────

export interface OrchestrateResponse {
  runId: string
  total: number
  skipped?: number
  mode: 'full' | 'batch'
}

/**
 * Phase 36 — 触发一键成片或批量执行。
 *  - 不传 nodeIds → 全画布按拓扑序执行 (Phase 36)
 *  - 传 nodeIds   → 仅执行指定子集 (Phase 37 批量执行)
 */
export async function orchestrateCanvas(
  projectId: number,
  episodesId: number,
  nodeIds?: string[],
  cancelToken?: CancelToken,
): Promise<OrchestrateResponse> {
  const json = await apiCall<{ data: OrchestrateResponse }>(
    '/canvas/orchestrate',
    { projectId, episodesId, ...(nodeIds && nodeIds.length > 0 ? { nodeIds } : {}) },
    { cancelToken },
  )
  return json.data
}

// ─── 分镜构图预览 (Phase 38, Tier 2) ──────────────────────

/** Phase 38 — 触发分镜构图预览 (仅 storyboard-* 节点) */
export async function previewStoryboard(
  projectId: number,
  episodesId: number,
  nodeId: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/storyboard/preview', { projectId, episodesId, nodeId }, { cancelToken })
}

// ─── 审核 ─────────────────────────────────────────────

/** 审核通过 */
export async function approveNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  winnerId?: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/review/approve', { projectId, episodesId, nodeId, ...(winnerId ? { winnerId } : {}) }, { cancelToken })
}

/** 驳回 */
export async function rejectNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  reason: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/review/reject', { projectId, episodesId, nodeId, reason }, { cancelToken })
}

/**
 * 选定变体组优胜（Phase 49 SELECT-02 / D-04）。
 *
 * POST /api/canvas/v2/variant-groups/:groupId/select-winner —— 49-01 端点契约：
 * body { projectId, episodesId, winnerNodeId }，事务化写
 * canvas_variant_groups.winner_node_id + 组内 canvas_nodes.is_winner（D-01）；
 * 重复选定同一 winner → 200 no-op { applied:false }（D-03）。
 * 错误语义：404 组不存在 / 409 winner 不在组内或非 single 组 / 400 参数校验失败。
 * 非 2xx 一律抛 ApiError（business/network）——调用方（canvasStore.selectWinner）
 * 在 catch 里回滚乐观更新，UI 不呈现未持久化的 winner（SC-2）。
 */
export async function selectVariantWinner(
  projectId: number,
  episodesId: number,
  groupId: string,
  winnerNodeId: string,
  cancelToken?: CancelToken,
  frameSlot?: 'first' | 'last',
): Promise<void> {
  await apiCall<void>(
    `/canvas/v2/variant-groups/${encodeURIComponent(groupId)}/select-winner`,
    { projectId, episodesId, winnerNodeId, ...(frameSlot ? { frameSlot } : {}) },
    { cancelToken },
  )
}

/**
 * G15 失败镜头批量操作(Phase 53-05 预置通道,53-07 面板消费)。
 *
 * POST /api/canvas/v2/g15-ops —— 端点由 53-07 落地(waive = reviewBridge 扩展
 * 语义,requeue = 同桥新 action;D-15 G15 操作桥)。错误语义照
 * selectVariantWinner 模型:非 2xx 一律抛 ApiError,批量部分失败由端点
 * 事务语义定义(53-07 契约)。
 */
/** g15-ops 响应体(WBX-03:delivered 必读——false = 未送达仅入队,非成功)。 */
export interface G15OpsResult {
  action: 'waive' | 'requeue'
  shotIds: string[]
  applied: number
  queued: number
  /** 桥真实送达(review-platform 端点回执);false 时操作未生效 */
  delivered: boolean
}

export async function g15Ops(
  projectId: number,
  episodesId: number,
  action: 'waive' | 'requeue',
  shotIds: string[],
  cancelToken?: CancelToken,
  /** 56-05 (D-11):目标 gate(缺省 G15 p11c-gate;G16 听审传 'p10c-gate') */
  gate?: string,
): Promise<G15OpsResult> {
  const json = await apiCall<{ data: G15OpsResult }>(
    '/canvas/v2/g15-ops',
    { projectId, episodesId, action, shotIds, ...(gate != null ? { gate } : {}) },
    { cancelToken },
  )
  return json.data
}

// ─── Gate 中心(Phase 54-04 GATE-02;54-05 服务端对接) ───────────────────

/** GET /api/canvas/v2/gate-state 响应 = socket payload + episodeRefs 诊断键。 */
export type GateStateSnapshot = GateStatePayload & { episodeRefs?: string[] }

/**
 * GET /api/canvas/v2/gate-state — gate 全量快照(socket 断线兜底拉取)。
 *
 * 失败返回 null 不抛(fetchCanvasHealth/fetchAssetDetail 同款 GET 先例——
 * apiCall 仅支持 POST,GET 一律裸 fetch + 超时/cancelToken)。消费方保留
 * 上一份 snapshot 即可,degrade 态由服务端 payload.degrade 表达。
 */
export async function fetchGateState(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<GateStateSnapshot | null> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (cancelToken) signals.push(cancelToken.signal)
  const combinedController = new AbortController()
  const onAbort = () => combinedController.abort()
  signals.forEach((s) => {
    if (s.aborted) combinedController.abort()
    else s.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const query = `?projectId=${encodeURIComponent(projectId)}&episodesId=${encodeURIComponent(episodesId)}`
    const res = await fetch(`${API_BASE}/canvas/v2/gate-state${query}`, {
      method: 'GET',
      signal: combinedController.signal,
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json.data as GateStateSnapshot) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/** gate-ops 幂等结果(P4):applied=false 表示平台侧已处理(409 语义),非错误。 */
export interface GateOpsResult {
  applied: boolean
  cause?: string
}

/**
 * POST /api/canvas/v2/gate-ops — 人工门决策(审批/驳回/豁免)。
 *
 * 前端不直连审核平台(D-03 拓扑隐藏);kap 服务端桥接到平台
 * approve/reject/waive 端点(54-02 R1)。幂等语义(P4):平台返回 409
 * (review 已被处理)→ {applied:false, cause:'already-resolved'}。
 */
export async function gateOps(
  projectId: number,
  episodesId: number,
  reviewId: number,
  action: 'approve' | 'reject' | 'waive',
  opts?: { reason?: string; selected?: number[] },
  cancelToken?: CancelToken,
): Promise<GateOpsResult> {
  const json = await apiCall<{ data: GateOpsResult }>(
    '/canvas/v2/gate-ops',
    {
      projectId,
      episodesId,
      reviewId,
      action,
      ...(opts?.reason != null ? { reason: opts.reason } : {}),
      ...(opts?.selected != null ? { selected: opts.selected } : {}),
    },
    { cancelToken },
  )
  return json.data
}

/** AI 评分结果(score 路由 data.score 本体;VariantWall 等消费方读 aiScore.overall)。 */
export interface NodeScoreResult {
  overall: number
  quality: number
  aesthetic: number
  storyConsistency: number
  promptAdherence: number
  emotionImpact: number
  reasoning?: string
}

export async function requestNodeScore(
  projectId: number,
  episodesId: number,
  nodeId: string,
  cancelToken?: CancelToken,
): Promise<NodeScoreResult> {
  // CR-02(review-60): 返回信封内 data.score 本体,非 apiCall 整 envelope。旧版
  // `apiCall<any>` 把 {code,data,message} 整信封交回,调用方读 score.overall 恒
  // undefined(UI「总分 undefined」),且 envelope 污染 node.data.aiScore 下游
  // (VariantWall 读 aiScore.overall/dimensions)。移除 any 让形状错配在边界暴露。
  const json = await apiCall<{ code: number; data?: { score?: NodeScoreResult }; msg?: string }>(
    '/canvas/review/score',
    { projectId, episodesId, nodeId },
    { cancelToken, timeout: 60000 },
  )
  const score = json.data?.score
  if (score == null) {
    // apiCall 对 code 404(资产/分镜不存在)原样透传信封不抛错——统一转
    // business 错误交调用方 catch → toast「评分失败」。
    throw new ApiError(json.msg || '评分失败', 'business', json.code)
  }
  return score
}

// ─── Canvas Health (兜底轮询) ───────────────────────────────

export interface CanvasHealthScope {
  projectId: number
  episodesId: number
  eventCount: number
  lastEventId: number | null
  lastEventAt: number | null
}

export interface CanvasHealth {
  totalEvents: number
  scopes: CanvasHealthScope[]
}

/**
 * GET /api/canvas/v2/health — 用于无鉴权探活与外部同步兜底。
 * 返回当前所有 project/episode 的事件计数。
 *
 * 当 socket 事件丢失(graph:saved 未到达)时,前端可通过对比
 * eventCount 是否增长来决定是否触发 reload。
 */
export async function fetchCanvasHealth(
  cancelToken?: CancelToken,
): Promise<CanvasHealth | null> {
  const signal = cancelToken?.signal
  try {
    const res = await fetch(`${API_BASE}/canvas/v2/health`, { method: 'GET', signal })
    if (!res.ok) return null
    const json = await res.json()
    const canvas = json?.data?.canvas
    if (!canvas) return null
    return {
      totalEvents: Number(canvas.totalEvents ?? 0),
      scopes: (canvas.scopes ?? []) as CanvasHealthScope[],
    }
  } catch {
    return null
  }
}

// ─── V2 节点 / 分支 / 布局 ─────────────────────────────────

/** 创建节点 */
export async function createNode(
  projectId: number,
  episodesId: number,
  node: Omit<FlowGraphNode, 'id'>,
  cancelToken?: CancelToken,
): Promise<{ nodeId: string }> {
  const json = await apiCall<{ data: { nodeId: string } }>('/v2/canvas/nodes', { projectId, episodesId, node }, { cancelToken })
  return json.data
}

/**
 * PATCH /api/canvas/v2/nodes/:nodeId — 单节点 UPSERT（relational store 单行 UPDATE）。
 *
 * `updates` 在节点**顶层浅合并**（`{ ...node, ...updates }`）：传 `{ data }` 会整体替换
 * data 袋，调用方需发送完整 data 对象（见 StoryboardTimeline 帧选择器的 patchFrameNode）。
 *
 * 后端广播 `node:updated`——前端 socket 自 59-03 起消费该事件(仅 stale 载荷:
 * useCanvasSocket onNodeUpdated → FlowCanvas 形状校验后接 triggerStaleCascade;
 * 非 stale 载荷的 node:updated,如本端点的 PATCH 回声,被静默忽略)→ 不触发
 * 全图重载,乐观更新语义不变(点选不闪烁、不跳顶)。写入的 relational store
 * 正是 load-v2 的数据源。
 */
export async function updateCanvasNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/v2/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, updates }),
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
}

/** 创建分支 */
export async function createBranch(
  projectId: number,
  episodesId: number,
  branch: Omit<FlowBranch, 'id' | 'createdAt' | 'updatedAt'>,
  cancelToken?: CancelToken,
): Promise<{ branchId: string }> {
  const json = await apiCall<{ data: { branchId: string } }>('/v2/canvas/branches', { projectId, episodesId, branch }, { cancelToken })
  return json.data
}

/** 更新分支 */
export async function updateBranch(
  projectId: number,
  episodesId: number,
  branchId: string,
  updates: Partial<Pick<FlowBranch, 'label' | 'status'>>,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>(`/v2/canvas/branches/${encodeURIComponent(branchId)}`, { projectId, episodesId, ...updates }, { cancelToken })
}

/** 请求自动布局 */
export async function requestLayout(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/v2/canvas/layout', { projectId, episodesId }, { cancelToken })
}

// ─── Skill Registry (Phase 32 CANVAS-01) ─────────────────

/**
 * Node type declaration shape returned by GET /api/v1/skills/:skillId/node-types.
 * Mirrors `NodeTypeDecl` from src/skills/contract.ts. The canvas treats this
 * as descriptive metadata — it does NOT drive renderer selection (the 5
 * platform-primitive renderers stay keyed by `default_renderer`).
 */
export interface SkillNodeTypeDecl {
  type: string
  label: string
  icon: string
  color: string
  data_schema_uri: string
  default_renderer: string
}

/**
 * Fetch the node type declarations for a registered skill. Used by the canvas
 * to surface available node types in UI affordances (e.g. an "Add Node" menu
 * in a future phase). Falls back to an empty array on any error — the canvas
 * must continue to render even if the registry endpoint is unreachable.
 *
 * Phase 32 (CANVAS-01): the canvas loads node type metadata from the registry
 * instead of a hardcoded list.
 */
export async function fetchSkillNodeTypes(
  skillId: string,
  cancelToken?: CancelToken,
): Promise<SkillNodeTypeDecl[]> {
  const url = `${API_BASE}/v1/skills/${encodeURIComponent(skillId)}/node-types`
  const signal = cancelToken?.signal
  try {
    const res = await fetch(url, { method: 'GET', signal })
    if (!res.ok) {
      // 404 是预期的——skill registry 端点可能未部署。静默返回空列表。
      if (res.status !== 404) {
        console.warn(`[canvasApi] fetchSkillNodeTypes: HTTP ${res.status} for skill '${skillId}'`)
      }
      return []
    }
    const json = (await res.json()) as { ok?: boolean; node_types?: SkillNodeTypeDecl[] }
    if (!json.ok || !Array.isArray(json.node_types)) {
      console.warn(`[canvasApi] fetchSkillNodeTypes: malformed response for skill '${skillId}'`, json)
      return []
    }
    return json.node_types
  } catch (err) {
    if (cancelToken?.isCancelled) return []
    console.warn(`[canvasApi] fetchSkillNodeTypes: request failed for skill '${skillId}'`, err)
    return []
  }
}

// ─── Asset Feedback (资产反馈层) ──────────────────────────

export interface FeedbackEntry {
  id: string
  assetId: string
  projectId: number
  score?: number | null
  verdict?: string | null
  content?: string | null
  tags?: string[]
  source: string
  reviewer?: string | null
  status?: string | null
  createdAt: number
  resolvedAt?: number | null
}

export interface FeedbackStats {
  count: number
  avgScore: number | null
  verdictBreakdown: Record<string, number>
  latest: FeedbackEntry | null
}

export async function createFeedback(params: {
  assetId: string
  projectId: number
  score?: number
  verdict?: string
  content?: string
  tags?: string[]
  source?: string
  reviewer?: string
}): Promise<FeedbackEntry> {
  const json = await apiCall<{ data: FeedbackEntry }>('/v1/feedback', params)
  return json.data
}

export async function getFeedback(assetId: string): Promise<FeedbackEntry[]> {
  const resp = await fetch(`${API_BASE}/v1/feedback/${encodeURIComponent(assetId)}`)
  if (!resp.ok) throw new ApiError(`HTTP ${resp.status}`, 'network', resp.status)
  const json = await resp.json()
  return (json.data ?? []) as FeedbackEntry[]
}

export async function getFeedbackStats(assetId: string): Promise<FeedbackStats | null> {
  try {
    const resp = await fetch(`${API_BASE}/v1/feedback/stats/${encodeURIComponent(assetId)}`)
    if (!resp.ok) return null
    const json = await resp.json()
    return (json.data ?? null) as FeedbackStats | null
  } catch {
    return null
  }
}

export async function getProjectFeedbackAggregate(projectId: number): Promise<Record<string, FeedbackStats>> {
  try {
    const resp = await fetch(`${API_BASE}/v1/feedback/aggregate/${projectId}`)
    if (!resp.ok) return {}
    const json = await resp.json()
    return (json.data ?? {}) as Record<string, FeedbackStats>
  } catch {
    return {}
  }
}

export async function updateFeedbackStatus(id: string, status: string): Promise<void> {
  await fetch(`${API_BASE}/v1/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

// ─── Asset Feedback — Topology Propagation ───────────────

export interface PropagationNode {
  id: string
  type: string
  label: string
  depth: number
}

export interface PropagationLink {
  source: string
  target: string
  dataType: string
}

export interface PropagationResult {
  sourceAssetId: string
  downstream: string[]
  upstream: string[]
  affectedWithFeedback: Array<{
    assetId: string
    latestVerdict: string | null
    avgScore: number | null
    count: number
  }>
  propagationGraph: {
    nodes: PropagationNode[]
    links: PropagationLink[]
  }
}

/**
 * Fetch topology propagation for an asset — which downstream/upstream nodes
 * are reachable through the canvas graph, and which of those already carry
 * feedback. projectId is required by the backend to locate the graph; if
 * omitted the call 400s and we return null.
 */
export async function getPropagation(
  assetId: string,
  projectId?: number,
): Promise<PropagationResult | null> {
  try {
    const params = new URLSearchParams()
    if (projectId != null) params.set('projectId', String(projectId))
    const qs = params.toString() ? `?${params.toString()}` : ''
    const resp = await fetch(`${API_BASE}/v1/feedback/propagation/${encodeURIComponent(assetId)}${qs}`)
    if (!resp.ok) return null
    const json = await resp.json()
    return (json.data ?? null) as PropagationResult | null
  } catch {
    return null
  }
}

// ─── Asset Feedback — Batch Resolve Downstream ────────────

export interface BatchResolveResult {
  resolvedCount: number
  affectedAssetIds: string[]
  note?: string
}

/**
 * Cascade-resolve: when the source asset is fixed, mark all OPEN feedback on
 * its downstream nodes as resolved. The backend resolves projectId from the
 * source asset's existing feedback rows.
 */
export async function batchResolve(assetId: string): Promise<BatchResolveResult> {
  const resp = await fetch(
    `${API_BASE}/v1/feedback/${encodeURIComponent(assetId)}/resolve-downstream`,
    { method: 'POST' },
  )
  if (!resp.ok) {
    throw new ApiError(`HTTP ${resp.status}`, 'network', resp.status)
  }
  const json = await resp.json()
  return (json.data ?? { resolvedCount: 0, affectedAssetIds: [] }) as BatchResolveResult
}

// ─── Asset Feedback — Project Heatmap ─────────────────────

export interface FeedbackHeatmapAsset {
  assetId: string
  feedbackCount: number
  avgScore: number | null
  latestVerdict: string | null
  downstreamCount: number
  riskLevel: 'high' | 'medium' | 'low'
}

export interface FeedbackHeatmap {
  projectId: number
  totalAssets: number
  assets: FeedbackHeatmapAsset[]
  summary: {
    totalFeedback: number
    approveRate: number
    rejectRate: number
    contestRate: number
    highRiskAssets: string[]
  }
}

/**
 * Project-wide feedback heatmap — every asset with feedback, its score
 * aggregate, downstream impact, and risk level. Suitable for canvas overlay.
 */
export async function getFeedbackHeatmap(projectId: number): Promise<FeedbackHeatmap | null> {
  try {
    const resp = await fetch(`${API_BASE}/v1/feedback/heatmap/${projectId}`)
    if (!resp.ok) return null
    const json = await resp.json()
    return (json.data ?? null) as FeedbackHeatmap | null
  } catch {
    return null
  }
}

// ─── Iteration Engine ──────────────────────────────────────
//
// Bridges to the iteration engine (vendored in src/runtime/) via the v1/iteration routes
// (quick-260702-rg2). All endpoints require `workdir` (zod-validated to live
// under /data/workspace on the backend). Response envelope is the standard
// { code, data, message }; we unwrap to the inner data in each function.

export interface IterationDiagnosis {
  type: 'reroll' | 'pipeline_adjust' | 'upstream_fix'
  rootCause: string
  confidence: number
  evidence: string[]
}

export interface IterationPipelineAdjustment {
  type: 'prompt_modification' | 'threshold_adjustment' | 'parameter_change'
  target: string
  change: string
}

export interface IterationAction {
  nodeId: string
  action: 'regenerate' | 'regenerate_after_parent' | 'skip'
  promptDelta?: string
  pipelineAdjustment?: IterationPipelineAdjustment | null
  reason: string
  dependsOn?: string[]
}

export interface IterationPlan {
  id: string
  episodeId?: string
  branchLabel?: string
  diagnosis: IterationDiagnosis
  actions: IterationAction[]
  requiresApproval: boolean
  summary?: string
  createdAt?: string
}

export interface IterationRegeneratedNode {
  nodeId: string
  newNodeId: string | null
  status: 'success' | 'failed' | 'pending'
  outputUrl?: string
}

export interface IterationResult {
  planId: string
  branchId: string
  regeneratedNodes: IterationRegeneratedNode[]
}

export interface IterationStatus {
  status: string
  progress?: number
  results?: IterationRegeneratedNode[]
}

/** POST /v1/iteration/plan — diagnose feedback and build an iteration plan. */
export async function createIterationPlan(
  projectId: number,
  episodesId: number,
  workdir: string,
  cancelToken?: CancelToken,
): Promise<IterationPlan> {
  const json = await apiCall<{ data: { status: string; plan: IterationPlan } }>(
    '/v1/iteration/plan',
    { projectId, episodesId: String(episodesId), workdir },
    { cancelToken, timeout: 60_000 },
  )
  return json.data.plan
}

/** POST /v1/iteration/execute — execute the plan (topological regenerate). */
export async function executeIteration(
  projectId: number,
  episodesId: number,
  workdir: string,
  planId: string,
  cancelToken?: CancelToken,
): Promise<IterationResult> {
  const json = await apiCall<{ data: { status: string; result: IterationResult } }>(
    '/v1/iteration/execute',
    { projectId, episodesId: String(episodesId), workdir, planId },
    { cancelToken, timeout: 120_000 },
  )
  return json.data.result
}

/** POST /v1/iteration/confirm — promote the iteration branch to main. */
export async function confirmIteration(
  projectId: number,
  episodesId: number,
  workdir: string,
  branchId: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<{ data: { status: string } }>(
    '/v1/iteration/confirm',
    { projectId, episodesId: String(episodesId), workdir, branchId },
    { cancelToken },
  )
}

/** POST /v1/iteration/discard — drop the iteration branch. */
export async function discardIteration(
  projectId: number,
  episodesId: number,
  workdir: string,
  branchId: string,
  reason?: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<{ data: { status: string } }>(
    '/v1/iteration/discard',
    { projectId, episodesId: String(episodesId), workdir, branchId, ...(reason ? { reason } : {}) },
    { cancelToken },
  )
}

/** POST /v1/iteration/approve-adjustment — approve a pipeline_adjust plan. */
export async function approveAdjustment(
  workdir: string,
  planId: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<{ data: { status: string; planId: string } }>(
    '/v1/iteration/approve-adjustment',
    { workdir, planId },
    { cancelToken },
  )
}

/** GET /v1/iteration/status/:planId — poll execution status. */
export async function getIterationStatus(
  workdir: string,
  planId: string,
  cancelToken?: CancelToken,
): Promise<IterationStatus> {
  const signal = cancelToken?.signal
  const qs = new URLSearchParams({ workdir })
  try {
    const resp = await fetch(
      `${API_BASE}/v1/iteration/status/${encodeURIComponent(planId)}?${qs.toString()}`,
      { method: 'GET', signal },
    )
    if (!resp.ok) throw new ApiError(`HTTP ${resp.status}`, 'network', resp.status)
    const json = await resp.json()
    return (json.data ?? { status: 'unknown' }) as IterationStatus
  } catch (err) {
    if (cancelToken?.isCancelled) {
      throw new ApiError('请求已取消', 'cancelled')
    }
    throw err instanceof ApiError ? err : new ApiError((err as Error).message, 'network')
  }
}

/** GET /v1/iteration/plans — list historical plans (for the iteration tab). */
export async function listIterationPlans(
  workdir: string,
  projectId: number,
  episodesId?: number,
  cancelToken?: CancelToken,
): Promise<IterationPlan[]> {
  const signal = cancelToken?.signal
  const qs = new URLSearchParams({ workdir, projectId: String(projectId) })
  if (episodesId != null) qs.set('episodesId', String(episodesId))
  try {
    const resp = await fetch(
      `${API_BASE}/v1/iteration/plans?${qs.toString()}`,
      { method: 'GET', signal },
    )
    if (!resp.ok) return []
    const json = await resp.json()
    return (json.data ?? []) as IterationPlan[]
  } catch {
    return []
  }
}

// ─── 资产管理中心 (Asset Manager) ─────────────────────────
//
// 资产管理中心的 API 接缝。现网 `/api/v1/assets-registry` 已有基础 CRUD（见上方
// searchAssets / fetchAssetDetail / fetchProjectAssets），但缺少组合关系
// (o_asset_composition) 与搭配预设 (o_loadout) —— 见 /tmp/asset-manager-design.md §3/§4。
// fetchAssetComposition 为**前瞻接缝**：标注 TODO，待后端落地后实现真实调用。
// (61-01 DEBT-01:原「投放资产到画布」恒 true 占位已退役——该入口改走下方
// placeAssetNode 的 POST /canvas/v2/nodes/ 真封装,拖入为唯一活调用方。)

export interface AssetCompositionEntry {
  parentUuid: string
  childUuid: string
  relation: 'variant_of' | 'wears' | 'holds' | 'appears_in'
  slot?: string
  loadoutUuid?: string
}

/**
 * TODO(backend): 获取某资产的组合关系（穿戴/手持/变体/出场）。
 * 计划端点：GET /api/v1/assets/:uuid/composition → { parents, children }。
 * 后端需先落地 o_asset_composition 表（design.md §3.1）。
 */
export async function fetchAssetComposition(_uuid: string): Promise<AssetCompositionEntry[] | null> {
  // TODO: return (await fetch(`${API_BASE}/v1/assets-registry/${_uuid}/composition`)).json()...
  return null
}

// 61-01 (DEBT-01): 资产卡片 HTML5 拖拽的 dataTransfer MIME 类型。载荷为
// AssetDragPayload 的 JSON;异源页面伪造同 MIME drop 由 onDrop 字段强校验兜底
// (T-61-03:最坏效果=经服务端 zod 门的节点创建,与用户点击等权,无提权面)。
export const ASSET_DRAG_MIME = 'application/x-kais-asset'

/** 拖拽载荷(卡片 dragstart 写入 dataTransfer;onDrop defensively 解析)。 */
export interface AssetDragPayload {
  id: number
  uuid: string
  name: string
  assetType: string
  filePath: string | null
}

/**
 * 61-01 (DEBT-01): 把拖入资产作为画布节点落库——既有 POST /api/canvas/v2/nodes/
 * 的真封装,替代已退役的恒 true 投放占位函数。
 * 通道 = 服务端真值(zod nodeInputSchema 门 + validateNodeData + node:created 广播
 * → 客户端 addNodeFromSocket canonical 写回);客户端本地写会重演 I5 ephemeral
 * 陷阱(graph:saved 全量 reload 抹掉未落库节点),故必须走服务端。
 * 409(同 id 已在画布)→ {ok:false,status:409};其余失败同样结构化返回——拖入是
 * fire-action,错误全部 toast 化,绝不向调用方 throw(T-61-04 不静默不吞)。
 */
export async function placeAssetNode(
  projectId: number,
  episodesId: number,
  node: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    await apiCall('/canvas/v2/nodes/', { projectId, episodesId, node })
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError && err.code === 409) {
      return { ok: false, status: 409, message: '已在画布' }
    }
    return {
      ok: false,
      status: err instanceof ApiError ? (err.code ?? 0) : 0,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}


// ─── 冗余配置 (Phase 62 HIER-03 · C8 RedundancyConfigRail, 62-06) ──────────

/**
 * GET /api/canvas/v2/generation-config rows 元素（62-02 路由契约形状：
 * 服务端完成 D-09 三源合并，UI 只消费不推断）。
 */
export interface ConfigRow {
  /** khs phase_key（嵌套 'p09_shotlist.shot_list' / 扁平 'p02_outline'）。 */
  phaseKey: string
  tier: 'llm' | 'engine' | 'deterministic' | 'text'
  /** 中文显示名（UI-SPEC Copywriting phase_key 显示名表逐字）。 */
  label: string
  pre: number
  final: number
  /** 行级来源 = 两旋钮中较强源（D-09：override > requirement > legacy/snapshot）。 */
  source: 'override' | 'requirement' | 'snapshot' | 'legacy'
  /** 文件面为 v2.5 前旧形态（无 v2.5 键）标志——「无 v2.5 键」角标数据。 */
  sourceLegacy?: boolean
  /** 14 键全部可写（unwired 键亦 true——写覆盖层允许，标注运行时暂不消费）。 */
  editable: boolean
  /** 占位未接线（键面存在，运行时暂不消费覆盖层）。 */
  unwired?: boolean
  /** GPU 成本护栏标注（p11_video 特有）。 */
  gpuHint?: boolean
  /** 行内注记（如 shot_list「转场随分镜表候选整体」）。 */
  note?: string
}

/** PUT overrides 写结果（D-08 两段式：覆盖层恒落库，文件面 best-effort 三态如实）。 */
export type GenerationConfigWriteState = 'override' | 'synced' | 'file-fail'

/**
 * GET /api/canvas/v2/generation-config?projectId=&episodesId= — 冗余配置
 * 三源合并 rows + fileState（62-02 契约）。
 *
 * GET 沿 updateAsset/fetchGateState 原生 fetch 范式（apiCall 仅支持 POST body）；
 * 判错看 HTTP status（62-02 信封陷阱：error 信封 body.code 恒 400，不作依据）。
 */
export async function fetchGenerationConfig(
  projectId: number,
  episodesId: number,
): Promise<{ rows: ConfigRow[]; fileState: string }> {
  const query = `?projectId=${encodeURIComponent(projectId)}&episodesId=${encodeURIComponent(episodesId)}`
  // cache:'no-store'——配置读必须新鲜：三源合并结果随覆盖层写入/文件形态即时变，
  // 启发式 HTTP 缓存会在「收起再展开/重进层级」时回吐旧行（62-07 e2e 实测抓到）。
  const res = await fetch(`${API_BASE}/canvas/v2/generation-config${query}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
  const json = await res.json()
  return json.data as { rows: ConfigRow[]; fileState: string }
}

/**
 * PUT /api/canvas/v2/generation-config/overrides/:phaseKey — D-08 两段式写：
 * body { projectId, episodesId, nCandidates, finalCandidates } →
 * { phaseKey, writeState }。writeState 服务端判定，UI 只映射徽标不推断
 * （绝不假成功）。
 * 400（白名单外 / preCap1 越界）时抛 ApiError，message 优先承载服务端
 * body.message 文案（D-10 后端道：调用方 toast 同文案，与前端钳制同串）。
 */
export async function putGenerationConfigOverride(
  projectId: number,
  episodesId: number,
  phaseKey: string,
  values: { nCandidates: number; finalCandidates: number },
): Promise<{ phaseKey: string; writeState: GenerationConfigWriteState }> {
  const res = await fetch(
    `${API_BASE}/canvas/v2/generation-config/overrides/${encodeURIComponent(phaseKey)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        episodesId,
        nCandidates: values.nCandidates,
        finalCandidates: values.finalCandidates,
      }),
    },
  )
  if (!res.ok) {
    // 判错看 HTTP status；body.message（服务端 zod/钳制文案）优先作 message 供 toast 同文案。
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.message === 'string' && body.message) message = body.message
    } catch {
      // body 不可解析时保留 HTTP 状态文案
    }
    throw new ApiError(message, 'network', res.status)
  }
  const json = await res.json()
  return json.data as { phaseKey: string; writeState: GenerationConfigWriteState }
}

/**
 * 分镜故事板（storyboard board）—— p10b 组装的全景分镜板 JSON。
 * GET /api/v1/storyboard/:projectId/:episodesId 返回 { scenes[], stats }。
 * 路由 tier 链：o_assets.meta → canvas_nodes.data → 文件 → 空 board。
 */
export interface StoryboardShot {
  shot_id: string
  thumbnail: string
  shot_scale: string
  camera_motion: string
  framing: string
  duration_sec: number | null
  dialogue_summary: string
  characters: string[]
  transition_from: string
  transition_to: string
  emotion: string
  action_note: string
  preview_clip: string
}
export interface StoryboardScene {
  scene_id: string
  scene_title: string
  shots: StoryboardShot[]
}
export interface StoryboardBoard {
  type: string
  episode_id: string
  generated_at: string | null
  scenes: StoryboardScene[]
  stats: { total_shots: number; total_duration_sec: number; total_scenes: number }
  source?: string
}

export async function fetchStoryboardBoard(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<StoryboardBoard> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (cancelToken) signals.push(cancelToken.signal)
  const combinedController = new AbortController()
  const onAbort = () => combinedController.abort()
  signals.forEach((s) => {
    if (s.aborted) combinedController.abort()
    else s.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const res = await fetch(`${API_BASE}/v1/storyboard/${projectId}/${episodesId}`, {
      method: 'GET',
      signal: combinedController.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status)
    const json = await res.json()
    return json.data as StoryboardBoard
  } finally {
    clearTimeout(timeoutId)
  }
}
