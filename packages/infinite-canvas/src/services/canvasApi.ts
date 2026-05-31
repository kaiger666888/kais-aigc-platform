import type { FlowGraph, LegacyFlowData } from '../types/canvas'

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

// ─── FlowData 兼容 ────────────────────────────────────────

/** 获取现有 FlowData（兼容旧格式） */
export async function fetchFlowData(
  projectId: number,
  episodesId: number,
  cancelToken?: CancelToken,
): Promise<LegacyFlowData> {
  const json = await apiCall<{ data: LegacyFlowData }>('/production/getFlowData', { projectId, episodesId }, { cancelToken })
  return json.data
}

/** 保存 FlowData */
export async function saveFlowData(
  projectId: number,
  episodesId: number,
  data: LegacyFlowData,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/production/saveFlowData', { projectId, episodesId, data }, { cancelToken })
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

// ─── 审核 ─────────────────────────────────────────────

/** 审核通过 */
export async function approveNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>('/canvas/review/approve', { projectId, episodesId, nodeId }, { cancelToken })
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
