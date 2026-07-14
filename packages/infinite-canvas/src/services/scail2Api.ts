/**
 * SCAIL2 API client — video character replace / motion transfer
 *
 * POST /api/production/wan21/scail2Replace    multipart: poseVideo + referenceImage + form fields
 * POST /api/production/wan21/scail2Transfer   same
 * GET  /api/production/wan21/scail2/status/:promptId   poll until status=done
 */

const API_BASE = '/api'

export interface Scail2SubmitParams {
  projectId: number
  prompt: string
  width?: number
  height?: number
  numFrames?: number
  steps?: number
  seed?: number
  shift?: number
  poseStrength?: number
  filenamePrefix?: string
}

export interface Scail2SubmitResult {
  promptId: string
  status: string
  workflowType: string
  message: string
  poseVideoFilename: string
  referenceImageFilename: string
}

export interface Scail2StatusResult {
  promptId: string
  status: 'pending' | 'running' | 'done' | 'error' | 'unknown'
  videos: Array<{
    filename: string
    subfolder?: string
    status: 'ok' | 'remux_failed' | 'container_file_missing'
    sizeBytes?: number
    hostPath?: string
    tailscaleUrl?: string
  }>
  previewImages: Array<{ filename: string; comfyuiUrl: string }>
}

async function postMultipart(
  endpoint: string,
  poseVideo: Blob,
  referenceImage: Blob,
  params: Scail2SubmitParams,
): Promise<Scail2SubmitResult> {
  const form = new FormData()
  form.append('projectId', String(params.projectId))
  form.append('prompt', params.prompt)
  if (params.width) form.append('width', String(params.width))
  if (params.height) form.append('height', String(params.height))
  if (params.numFrames) form.append('numFrames', String(params.numFrames))
  if (params.steps) form.append('steps', String(params.steps))
  if (params.seed) form.append('seed', String(params.seed))
  if (params.shift) form.append('shift', String(params.shift))
  if (params.poseStrength) form.append('poseStrength', String(params.poseStrength))
  if (params.filenamePrefix) form.append('filenamePrefix', params.filenamePrefix)
  form.append('poseVideo', poseVideo, 'pose.mp4')
  form.append('referenceImage', referenceImage, 'ref.png')

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: form,
  })
  const json = await res.json()
  if (!res.ok || json.code !== 200) {
    throw new Error(json.message || `HTTP ${res.status}`)
  }
  return json.data as Scail2SubmitResult
}

export async function submitScail2Replace(
  poseVideo: Blob, referenceImage: Blob, params: Scail2SubmitParams,
): Promise<Scail2SubmitResult> {
  return postMultipart('/production/wan21/scail2Replace', poseVideo, referenceImage, params)
}

export async function submitScail2Transfer(
  poseVideo: Blob, referenceImage: Blob, params: Scail2SubmitParams,
): Promise<Scail2SubmitResult> {
  return postMultipart('/production/wan21/scail2Transfer', poseVideo, referenceImage, params)
}

export async function getScail2Status(promptId: string): Promise<Scail2StatusResult> {
  const res = await fetch(`${API_BASE}/production/wan21/scail2/status/${encodeURIComponent(promptId)}`)
  const json = await res.json()
  if (!res.ok || json.code !== 200) {
    throw new Error(json.message || `HTTP ${res.status}`)
  }
  return json.data as Scail2StatusResult
}

export async function pollScail2UntilDone(
  promptId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onStatus?: (s: Scail2StatusResult) => void } = {},
): Promise<Scail2StatusResult> {
  const interval = opts.intervalMs ?? 5_000
  const timeout = opts.timeoutMs ?? 600_000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const s = await getScail2Status(promptId)
    opts.onStatus?.(s)
    if (s.status === 'done' || s.status === 'error') return s
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`SCAIL2 prompt ${promptId} timed out after ${timeout}ms`)
}

export async function fetchBlobFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
  return res.blob()
}
