/**
 * healThumb.ts — 变体墙缩略图三段自愈(Phase 53-02 Task 3 / DR-3)。
 *
 * 三段:onError 检测 → 一次性 POST /api/canvas/v2/thumbnail(sourcePath)→
 * 换 /_thumbs/ URL;失败/无 filePath / 非 /oss/ 前缀 → 模态 emoji 占位。
 *
 * 行为锁死(T-53-02-01/02 缓解,healThumb.test.ts 四断言):
 *  - 单次触发保护:每卡(nodeId)至多一次 POST,第二次直接 placeholder;
 *  - /oss/ 白名单:非 /oss/ 前缀零请求(路径穿越缓解——端点内
 *    needsThumbnailing 前置白名单是第二道闸);
 *  - 仅响应 data.thumbnailUrl 含 /_thumbs/ 才算 healed;
 *  - never-throws:fetch 任何异常按 placeholder 兜底。
 *
 * 不做批量预检(DR-3 裁定:检测在前端 onError,按需自愈)。
 *
 * Pure module: no React — fetch 注入可单测。
 */

export type HealOutcome =
  | { kind: 'healed'; url: string }
  | { kind: 'placeholder' }

export interface HealCandidate {
  nodeId: string
  filePath?: string
}

export function createThumbHealer(fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)) {
  const tried = new Set<string>()

  return {
    async heal(candidate: HealCandidate): Promise<HealOutcome> {
      // 单次触发保护:标记先于请求——请求失败也不重试(DR-3 裁定)
      if (tried.has(candidate.nodeId)) return { kind: 'placeholder' }
      tried.add(candidate.nodeId)

      const fp = candidate.filePath
      // /oss/ 白名单:其余形态(外链 http、相对路径、绝对盘符)零请求
      if (typeof fp !== 'string' || !fp.startsWith('/oss/')) {
        return { kind: 'placeholder' }
      }

      try {
        const res = await fetchImpl('/api/canvas/v2/thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: fp }),
        })
        if (!res.ok) return { kind: 'placeholder' }
        const json: unknown = await res.json()
        const url = (json as { data?: { thumbnailUrl?: unknown } })?.data?.thumbnailUrl
        if (typeof url === 'string' && url.includes('/_thumbs/')) {
          return { kind: 'healed', url }
        }
        return { kind: 'placeholder' }
      } catch {
        return { kind: 'placeholder' } // never-throws
      }
    },
  }
}
