/**
 * useRealAssets — 拉取并缓存真实资产（POST /api/v1/assets-registry/search）。
 *
 * 模块级缓存：AssetLibrary 与 AssetDetail 共享同一次请求（资产库点卡片进详情，
 * 详情直接从缓存展开，无需二次请求）。reload() 失效缓存并重新拉取。
 *
 * 后端不可达时返回 error（UI 显示重试），不抛出 —— 资产库退化到空态而非崩页。
 */
import { useCallback, useEffect, useState } from 'react'
import { searchAssets, type AssetDetail } from '../../services/canvasApi'

let cache: AssetDetail[] | null = null
let inflight: Promise<AssetDetail[]> | null = null

/** 拉取全部资产（带去重 inflight）。模块级缓存命中时直接 resolve。 */
export function fetchAllAssets(): Promise<AssetDetail[]> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = searchAssets({ limit: 200 })
    .then((res) => {
      cache = res
      return res
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export interface UseRealAssets {
  assets: AssetDetail[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useRealAssets(): UseRealAssets {
  const [assets, setAssets] = useState<AssetDetail[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchAllAssets()
      .then((res) => {
        cache = res
        setAssets(res)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载资产失败')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (cache) {
      setAssets(cache)
      setLoading(false)
      return
    }
    load()
  }, [load])

  const reload = useCallback(() => {
    cache = null
    inflight = null
    load()
  }, [load])

  return { assets, loading, error, reload }
}
