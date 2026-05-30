import type { FlowGraph, LegacyFlowData } from '../types/canvas'

const API_BASE = '/api'

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
export async function fetchProjects(): Promise<ProjectInfo[]> {
  const res = await fetch(`${API_BASE}/canvas/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '获取项目列表失败')
  return json.data ?? []
}

/** 获取项目下的剧本列表 */
export async function fetchProjectScripts(projectId: number): Promise<ScriptInfo[]> {
  const res = await fetch(`${API_BASE}/canvas/projectData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '获取剧本列表失败')
  return json.data ?? []
}

// ─── FlowData 兼容 ────────────────────────────────────────

/** 获取现有 FlowData（兼容旧格式） */
export async function fetchFlowData(projectId: number, episodesId: number): Promise<LegacyFlowData> {
  const res = await fetch(`${API_BASE}/production/getFlowData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '获取 FlowData 失败')
  return json.data
}

/** 保存 FlowData */
export async function saveFlowData(
  projectId: number,
  episodesId: number,
  data: LegacyFlowData,
): Promise<void> {
  const res = await fetch(`${API_BASE}/production/saveFlowData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, data }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '保存 FlowData 失败')
}

// ─── 画布图（FlowGraph） ──────────────────────────────────

/** 保存画布图（FlowGraph 格式） */
export async function saveCanvasGraph(
  projectId: number,
  episodesId: number,
  graph: FlowGraph,
): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, graph }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '保存画布失败')
}

/** 加载画布图 */
export async function loadCanvasGraph(
  projectId: number,
  episodesId: number,
): Promise<FlowGraph | null> {
  const res = await fetch(`${API_BASE}/canvas/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId }),
  })
  const json = await res.json()
  if (json.code === 404 || !json.data) return null
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '加载画布失败')
  return json.data
}

/** 将现有项目数据转换为画布节点 */
export async function convertProjectData(
  projectId: number,
  episodesId: number,
): Promise<FlowGraph> {
  const res = await fetch(`${API_BASE}/canvas/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '转换数据失败')
  return json.data
}

// ─── 节点执行 ─────────────────────────────────────────────

/** 触发节点执行 */
export async function executeNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  nodeType: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, nodeId, nodeType }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '执行节点失败')
}

// ─── 审核 ─────────────────────────────────────────────

/** 审核通过 */
export async function approveNode(projectId: number, episodesId: number, nodeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/review/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, nodeId }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '审核操作失败')
}

/** 驳回 */
export async function rejectNode(projectId: number, episodesId: number, nodeId: string, reason: string): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/review/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, episodesId, nodeId, reason }),
  })
  const json = await res.json()
  if (json.code !== 200 && json.code !== 0) throw new Error(json.message || '审核操作失败')
}
