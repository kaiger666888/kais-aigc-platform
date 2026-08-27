/**
 * blindOrder.ts — 盲选会话纯逻辑 util(盲选批 M2,零 React/IO)。
 *
 * 两个职责:
 *   1. 会话 id:bsess_<日期时间>(spec §2.1 session_id;调用方不传时由会话
 *      生成一次,整个会话复用);
 *   2. 候选展示序:seeded Fisher-Yates(mulberry32)——同一 (ids, seed) 恒同序
 *      (会话内固定,防刷新/重渲漂移),取值域 = 入参 ids 的不重不漏置换
 *      (位置效应聚合(position==1 当选率)依赖这一点)。
 *
 * 随机性只来自 seed 本身:会话打开时生成一个 seed 存进 store,此后每次
 * 重渲重算都得到同一展示序——「随机左右序在会话打开时生成并固定」。
 */

/** bsess_YYYYMMDD_HHMMSS(+08:00 墙钟,与账本 recorded_at 同一口径)。 */
export function makeSessionId(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 3_600_000) // UTC → +08:00 墙钟
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return (
    `bsess_${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}` +
    `_${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}${p2(t.getUTCSeconds())}`
  )
}

/** mulberry32:32 位种子 → [0,1) 确定性伪随机序列(体积小,够洗牌用)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 会话种子(真随机一次,存 store 后不再变)。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000)
}

/**
 * seeded 展示序:Fisher-Yates 从尾往前换位。同一 seed 恒同序;返回值是
 * 入参的置换(不重不漏,长度相等)。入参为引用——内部先拷贝,绝不改入参。
 */
export function shuffleCandidates(ids: readonly string[], seed: number): string[] {
  const out = [...ids]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/** 盲选会话队列构建:待决组(winner 未定,≥2 成员)按 reviewRank 排序。 */
export interface BlindQueueGroupLike {
  id: string
  winnerNodeId?: string | null
  variantNodeIds: string[]
}

export function buildBlindQueue<T extends BlindQueueGroupLike>(
  groups: T[],
  opts?: { includeDecided?: boolean },
): T[] {
  return groups
    .filter((g) => (opts?.includeDecided ? true : g.winnerNodeId == null))
    .filter((g) => g.variantNodeIds.length >= 2)
    .sort((a, b) => blindRank(a.id) - blindRank(b.id) || a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/** shot 域组排前(sid 自然序, first<last),name/其余组排后(variantOps 同款)。 */
function blindRank(id: string): number {
  return /^cand:shot:/.test(id) || /^shot:/.test(id) ? 0 : 1
}
