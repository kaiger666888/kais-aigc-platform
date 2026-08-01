/**
 * useRealAssets — 拉取并缓存真实资产（POST /api/v1/assets-registry/search）。
 *
 * 按 projectId 分桶缓存：切换项目时自动拉取该项目的资产。
 * projectId=null 时拉取全局资产（库级别）。
 * reload() 失效当前项目的缓存并重新拉取。
 *
 * 后端不可达时返回 error（UI 显示重试），不抛出 —— 资产库退化到空态而非崩页。
 */
import { useCallback, useEffect, useState } from 'react'
import { searchAssets, type AssetDetail } from '../../services/canvasApi'

/** 按 projectId 分桶的模块级缓存。key=null 表示全局。 */
const cacheMap = new Map<number | null, AssetDetail[]>()
const inflightMap = new Map<number | null, Promise<AssetDetail[]>>()

/** 拉取指定项目的资产（带去重 inflight）。 */
export function fetchProjectAssets(projectId: number | null): Promise<AssetDetail[]> {
  if (cacheMap.has(projectId)) return Promise.resolve(cacheMap.get(projectId)!)
  if (inflightMap.has(projectId)) return inflightMap.get(projectId)!

  // includeFile: true → 后端 JOIN o_image，返回 filePath（缩略图渲染必需）。
  // 不传则 filePath 全为 null，资产卡缩略图退回 emoji 占位。
  const params: Parameters<typeof searchAssets>[0] = { limit: 200, includeFile: true }
  if (projectId != null) params.projectId = projectId

  const p = searchAssets(params)
    .then((res) => {
      cacheMap.set(projectId, res)
      return res
    })
    .finally(() => {
      inflightMap.delete(projectId)
    })
  inflightMap.set(projectId, p)
  return p
}

export interface UseRealAssets {
  assets: AssetDetail[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useRealAssets(projectId?: number | null): UseRealAssets {
  const pid = projectId ?? null
  const [assets, setAssets] = useState<AssetDetail[]>(cacheMap.get(pid) ?? [])
  const [loading, setLoading] = useState(!cacheMap.has(pid))
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchProjectAssets(pid)
      .then((res) => {
        setAssets(res)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载资产失败')
      })
      .finally(() => setLoading(false))
  }, [pid])

  useEffect(() => {
    if (cacheMap.has(pid)) {
      setAssets(cacheMap.get(pid)!)
      setLoading(false)
      return
    }
    load()
  }, [pid, load])

  const reload = useCallback(() => {
    cacheMap.delete(pid)
    inflightMap.delete(pid)
    load()
  }, [pid, load])

  return { assets, loading, error, reload }
}
