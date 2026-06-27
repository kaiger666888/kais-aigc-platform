import type { FlowGraph, FlowBranch, LegacyFlowData, FlowGraphNode } from '../types/canvas'

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

  // Create a timeout AbortController
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout)

  // Link cancel token signal and timeout signal
  const signals: AbortSignal[] = [timeoutController.signal]
  if (cancelToken) signals.push(cancelToken.signal)

  // Combine signals using AbortController
  const combinedController = new AbortController()
  const onAbort = () => combinedController.abort()
  signals.forEach((s) => {
    if (s.aborted) {
      combinedController.abort()
    } else {
      s.addEventListener('abort', onAbort, { once: true })
    }
  })

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (combinedController.signal.aborted) {
      clearTimeout(timeoutId)
      if (cancelToken?.isCancelled) {
        throw new ApiError('请求已取消', 'cancelled')
      }
      throw new ApiError(`请求超时（${timeout / 1000}秒）`, 'timeout')
    }

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: combinedController.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
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
      clearTimeout(timeoutId)

      if (cancelToken?.isCancelled) {
        throw new ApiError('请求已取消', 'cancelled')
      }

      if (err instanceof ApiError) {
        if (err.type === 'business') throw err
        lastError = err
      } else if (err.name === 'AbortError') {
        if (cancelToken?.isCancelled) {
          throw new ApiError('请求已取消', 'cancelled')
        }
        throw new ApiError(`请求超时（${timeout / 1000}秒）`, 'timeout')
      } else {
        lastError = new ApiError(err.message || '网络错误', 'network')
      }

      // Retry with exponential backoff for network errors
      if (attempt < MAX_RETRIES) {
        const backoff = 1000 * Math.pow(2, attempt)
        await sleep(backoff)
      }
    }
  }

  throw lastError ?? new ApiError('未知错误', 'network')
}

// ─── 项目 & 剧本 ─────────────────────────────────────────

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
  scriptCount: number
  assetCount: number
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
 */
export async function searchAssets(
  params: { query?: string; type?: string; characterId?: string; tags?: string },
  cancelToken?: CancelToken,
): Promise<AssetDetail[]> {
  const json = await apiCall<{ data: { assets: AssetDetail[] } }>('/v1/assets-registry/search', params, { cancelToken })
  return json.data.assets
}

// ─── 画布图（FlowGraph） ──────────────────────────────────

/** 保存画布图（FlowGraph 格式） */
export async function saveCanvasGraph(
  projectId: number,
  episodesId: number,
  graph: FlowGraph,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/save', { projectId, episodesId, graph }, { cancelToken })
}

/** 加载画布图 */
export async function loadCanvasGraph(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<FlowGraph | null> {
  const json = await apiCall<{ code?: number; data?: FlowGraph }>('/canvas/load', { projectId, episodesId }, { cancelToken })
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
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/execute', { projectId, episodesId, nodeId, nodeType }, { cancelToken })
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

export async function requestNodeScore(
  projectId: number,
  episodesId: number,
  nodeId: string,
  cancelToken?: CancelToken,
): Promise<{ overall: number; quality: number; aesthetic: number; storyConsistency: number; promptAdherence: number; emotionImpact: number; reasoning?: string }> {
  return await apiCall<any>('/canvas/review/score', { projectId, episodesId, nodeId }, { cancelToken, timeout: 60000 })
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
      console.warn(`[canvasApi] fetchSkillNodeTypes: HTTP ${res.status} for skill '${skillId}'`)
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

