/**
 * 60-02 (D-01): 页面级客户端 tab 身份——save-v2 自回声判定依据。
 *
 * 语义: 首次调用生成 `tab_` + 8 位随机后缀,之后恒返回同值(模块级 lazy 单例)。
 * saveCanvasGraph 单点把该值放进 POST body.savedBy,服务端原样回显进
 * graph:saved 广播;onGraphSaved 比对 payload.savedBy === getClientTabId(),
 * 命中即自回声 → 跳过 reload 与 toast(本地 store 已是 canonical 真相 + 200 确认)。
 *
 * 为什么不用时间窗方案: RESEARCH F-1 实证服务端 broadcast 先于 HTTP 响应发出
 * (save-v2.ts broadcast → res.send 顺序)——「save promise 挂起期标记」窗口
 * 天生竞态(回声可能在 resolve 前后任意侧到达),显式身份是唯一可靠判定。
 * sessionStorage 无必要: 回声比对发生在同一页面实例内(F-3)。
 */

let cached: string | null = null

function generateTabId(): string {
  const g =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null
  if (g != null) return `tab_${g.slice(0, 8)}`
  // 回退(旧 jsdom / 非安全上下文无 crypto.randomUUID): Math.random 十六进制 8 位
  let hex = ''
  for (let i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16)
  return `tab_${hex}`
}

export function getClientTabId(): string {
  if (cached == null) cached = generateTabId()
  return cached
}
