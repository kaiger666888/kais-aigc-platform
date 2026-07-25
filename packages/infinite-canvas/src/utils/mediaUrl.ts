/**
 * src/utils/mediaUrl.ts — 媒体（图/视/音）URL 解析。
 *
 * 后端 media.original/thumbnail 是 `/oss/...` 相对路径：
 *  - 部署在后端同源（:10588/infinite-canvas/）→ 浏览器同源解析即命中 /oss 静态；
 *  - vite dev（:3001）→ vite proxy 把 /oss 转发到 :10588；
 *  - 纯静态托管（无 proxy / 跨源）→ 需显式拼后端 origin（VITE_OSS_ORIGIN）。
 * 故对 /oss/ 路径按需前缀 VITE_OSS_ORIGIN（缺省 '' = 同源/proxy）。
 *
 * turnaround_sheet / crops 等后端给的是 `assets/P04/L1/foo.png` 相对路径（非 /oss/），
 * 但其 basename 与 media.original 同目录：据 original 的 /oss 目录 + basename 复原可访问 URL。
 */

const OSS_ORIGIN =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_OSS_ORIGIN) ||
  ''

/** `/oss/...` 或绝对 URL → 可访问 URL（/oss/ 按需前缀 origin）。其余原样返回。 */
export function resolveMediaUrl(path: string | null | undefined): string | null {
  if (path == null || path === '') return null
  if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) return path
  if (path.startsWith('/oss/')) return `${OSS_ORIGIN}${path}`
  return path
}

/** 从已知 /oss 路径取其目录（如 `/oss/pipeline/74b2a328/foo.png` → `/oss/pipeline/74b2a328`）。 */
export function ossDirOf(path: string | null | undefined): string | null {
  const url = resolveMediaUrl(path)
  if (!url || !url.includes('/oss/')) return null
  const idx = url.lastIndexOf('/')
  return idx > 4 ? url.slice(0, idx) : null
}

/**
 * 解析后端相对资产路径（`assets/P04/L1/foo.png` / `foo.png`）→ /oss 目录 + basename。
 * 已是 /oss/ 或 http(s) 的原样解析；无 ossDir 兜底时返回 null（调用方应 onError 隐藏）。
 */
export function resolveRelativeAssetPath(
  path: string | null | undefined,
  ossDir: string | null,
): string | null {
  if (path == null || path === '') return null
  if (path.startsWith('/oss/') || /^https?:\/\//i.test(path)) return resolveMediaUrl(path)
  if (!ossDir) return null
  const base = path.split('/').pop()
  return base ? resolveMediaUrl(`${ossDir}/${base}`) : null
}
