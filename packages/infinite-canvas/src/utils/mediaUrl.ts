/**
 * src/utils/mediaUrl.ts — 媒体（图/视/音）URL 解析。
 *
 * 后端 media.original/thumbnail 有三种形态：
 *  - `/oss/...` 相对路径（理想态）——按需前缀 VITE_OSS_ORIGIN：
 *      · 部署在后端同源（:10588/infinite-canvas/）→ 同源即命中 /oss 静态；
 *      · vite dev（:3001）→ vite proxy 把 /oss 转发到 :10588；
 *      · 纯静态托管（跨源）→ 显式拼后端 origin（VITE_OSS_ORIGIN）。
 *  - 绝对文件系统路径（后端 data.filePath 实存形态，如
 *    `/data/workspace/kais-movie-agent/runs/scifi-epic/assets/...`）——按 oss 符号链接
 *    挂载点反推为 `/oss/<project>/...`（见 fsToOssPath）。
 *  - `http(s)://` / `data:` ——原样返回。
 *
 * turnaround_sheet / crops 等后端给的是 `assets/P04/L1/foo.png` 相对路径（非 /oss/），
 * 但其 basename 与 media.original 同目录：据 original 的 /oss 目录 + basename 复原可访问 URL。
 */

const OSS_ORIGIN =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_OSS_ORIGIN) ||
  ''

/**
 * 绝对文件系统路径 → /oss/ 相对路径（按后端 oss 符号链接挂载点反推）。
 *
 * 后端 /oss 静态服务根（data/oss/）下有符号链接：如 `scifi-epic → .../kais-movie-agent/runs/scifi-epic`。
 * 故 FS 路径 `.../kais-movie-agent/runs/<project>/<rest>` 可经 `/oss/<project>/<rest>` 访问。
 * 符号链接名 ≠ 路径段（如 pipeline-runs/ep-volvo-love ↔ oss/volvo）无法自动反推 ——
 * 靠 `VITE_OSS_FS_MAP`（JSON: `[{prefix, oss}]`，字面前缀替换）显式补位。
 *
 * 命中返回 `/oss/...`；不命中返回 null（调用方原样回退，浏览器可能 404 但不崩溃）。
 */
const DEFAULT_FS_TO_OSS_RULES: ReadonlyArray<{
  fsRegex: RegExp
  rewrite: (m: RegExpMatchArray) => string
}> = [
  // /.../kais-movie-agent/runs/<project>/<rest?> → /oss/<project>/<rest?>
  // 注意 /runs/ 字面段，避免误匹配 /pipeline-runs/（后者走 VITE_OSS_FS_MAP）
  {
    fsRegex: /^\/.*\/kais-movie-agent\/runs\/([^/]+)(\/.*)?$/,
    rewrite: (m) => `/oss/${m[1]!}${m[2] ?? ''}`,
  },
]

/** 解析 VITE_OSS_FS_MAP（JSON: `[{prefix:string, oss:string}]`）为字面前缀替换表。 */
const ENV_FS_TO_OSS_RULES: ReadonlyArray<{ prefix: string; oss: string }> = (() => {
  const raw =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_OSS_FS_MAP) ||
    ''
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is { prefix: string; oss: string } =>
          !!r &&
          typeof (r as { prefix?: unknown }).prefix === 'string' &&
          typeof (r as { oss?: unknown }).oss === 'string',
      )
      .map((r) => ({ prefix: r.prefix, oss: r.oss }))
  } catch {
    return []
  }
})()

/** 绝对 FS 路径 → /oss/ 路径；不命中已知挂载点返回 null。 */
function fsToOssPath(absPath: string): string | null {
  for (const r of DEFAULT_FS_TO_OSS_RULES) {
    const m = absPath.match(r.fsRegex)
    if (m) return r.rewrite(m)
  }
  for (const r of ENV_FS_TO_OSS_RULES) {
    if (absPath.startsWith(r.prefix)) return `${r.oss}${absPath.slice(r.prefix.length)}`
  }
  return null
}

/**
 * `/oss/...`、绝对文件系统路径或绝对 URL → 可访问 URL。
 * - http(s):// / data: 原样返回；
 * - /oss/ 按需前缀 origin；
 * - 其它绝对路径（/ 开头）尝试 fsToOssPath 转 /oss/，不命中则回退到
 *   /local-file?path=<encoded>（后端白名单已覆盖 kais-hermes-skills/runs
 *   及 legacy kais-movie-agent 路径）；
 * - 相对路径原样返回。
 */
export function resolveMediaUrl(path: string | null | undefined): string | null {
  if (path == null || path === '') return null
  if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) return path
  if (path.startsWith('/oss/')) return `${OSS_ORIGIN}${path}`
  // 后端 data.filePath 存的是绝对文件系统路径 → 尝试经 /oss 静态服务访问
  if (path.startsWith('/')) {
    const oss = fsToOssPath(path)
    if (oss) return `${OSS_ORIGIN}${oss}`
    // /oss 不命中 → 回退到 /local-file 端点（后端 app.ts 白名单安全代理）
    // 这覆盖 kais-hermes-skills/runs、kais-hermes-skills/skills/kais-movie-pipeline
    // 等新管线路径，以及任何 /oss 符号链接未覆盖的绝对路径。
    return `${OSS_ORIGIN}/local-file?path=${encodeURIComponent(path)}`
  }
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
