/**
 * wallTransport.ts — 变体墙同播主时钟(Phase 53-02 Task 1 / DR-5)。
 *
 * 一条主控 transport(播放/暂停/拖动)驱动所有 take:
 *   - masterTime 是唯一真值:rAF delta 累加,**不**回读任何 video.currentTime
 *     (避免反馈环);
 *   - 每 tick 每 video:muted = i !== soloIdx(音频 solo,D-06);
 *     |v.currentTime - target| > 120ms → v.currentTime = target(硬校正,
 *     不用 playbackRate 微调——93 镜审片场景简单可靠优先);
 *   - 墙时长 span = 所有 take 的 min(duration)(短 take 循环窗口),
 *     target = masterTime % span;
 *   - seek(t):统一 forEach 赋值 + masterTime = t;
 *   - stall 治理:任一 video 'waiting' → 全场 pause() + masterTime 对齐该
 *     video.currentTime(网络/解码慢不让全场跑空)。
 *
 * 无 requestAnimationFrame 环境(vitest node)不启动画循环——tickForTest(now)
 * 驱动同一内部逻辑,生产行为与测试行为同源。
 *
 * Pure module: no React, no DOM construction — video elements are injected
 * via the HTMLVideoElementLike interface.
 */

/** transport 消费的最小 video 表面(真实 HTMLVideoElement 天然满足)。 */
export interface HTMLVideoElementLike {
  currentTime: number
  muted: boolean
  paused: boolean
  readonly duration: number
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

/** 漂移硬校正阈值(DR-5 锁定:120ms)。 */
const DRIFT_HARD_SEEK_SEC = 0.12

export interface MasterTransport {
  play(): void
  pause(): void
  seek(t: number): void
  setSolo(index: number | null): void
  readonly masterTime: number
  /** React 层动态注册/注销 video 元素(墙重渲后重新挂)。 */
  attach(el: HTMLVideoElementLike): void
  detach(el: HTMLVideoElementLike): void
  /** 手动驱动一帧(测试用;与 rAF 回调同一内部逻辑)。 */
  tickForTest(nowMs: number): void
  dispose(): void
}

export function createMasterTransport(
  initial: HTMLVideoElementLike[] = [],
  opts?: { driftHard?: number },
): MasterTransport {
  const drift = opts?.driftHard ?? DRIFT_HARD_SEEK_SEC
  const videos: HTMLVideoElementLike[] = [...initial]
  const stallListeners = new WeakMap<HTMLVideoElementLike, () => void>()

  let running = false
  let masterTime = 0
  let soloIdx: number | null = null // null = 全员静音(检视前)
  let lastNow: number | null = null
  let rafId: number | null = null

  /** span = min(正 duration);无可用时长时返回 null(tick 不驱动)。 */
  function span(): number | null {
    let min: number | null = null
    for (const v of videos) {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        if (min == null || v.duration < min) min = v.duration
      }
    }
    return min
  }

  function onStall(v: HTMLVideoElementLike): void {
    // DR-5:任一 take 卡住 → 全场暂停 + masterTime 对齐该 take。
    running = false
    lastNow = null
    masterTime = v.currentTime
    for (const other of videos) other.pause()
    stopRaf()
  }

  function tick(nowMs: number): void {
    if (lastNow == null) {
      lastNow = nowMs
      return // 首帧只定锚,不推进
    }
    const delta = Math.max(0, (nowMs - lastNow) / 1000)
    lastNow = nowMs
    if (!running || videos.length === 0) return
    masterTime += delta
    applyTarget()
  }

  function applyTarget(): void {
    const s = span()
    if (s == null || s <= 0) return
    const target = masterTime % s
    videos.forEach((v, i) => {
      v.muted = i !== soloIdx // D-06 solo:非 solo 全静音
      if (Math.abs(v.currentTime - target) > drift) {
        v.currentTime = target // 硬 seek
      }
    })
  }

  function rafLoop(nowMs: number): void {
    tick(nowMs)
    rafId = requestAnimationFrame(rafLoop)
  }
  function startRaf(): void {
    if (rafId != null) return
    if (typeof requestAnimationFrame === 'undefined') return // node/test env
    rafId = requestAnimationFrame(rafLoop)
  }
  function stopRaf(): void {
    if (rafId != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId)
    }
    rafId = null
  }

  function wireStall(v: HTMLVideoElementLike): void {
    const cb = () => onStall(v)
    stallListeners.set(v, cb)
    v.addEventListener('waiting', cb)
  }

  // 初始成员即刻接 stall 监听
  for (const v of videos) wireStall(v)

  return {
    play() {
      running = true
      lastNow = null // 重锚:下一 tick 只定锚不推进
      for (const v of videos) void v.play()
      startRaf()
    },
    pause() {
      running = false
      lastNow = null
      for (const v of videos) v.pause()
      stopRaf()
    },
    seek(t: number) {
      masterTime = t
      videos.forEach((v) => {
        v.currentTime = t
      })
    },
    setSolo(index: number | null) {
      soloIdx = index
      if (running) applyTarget() // 即时生效(测试 3)
      else {
        // 暂停态也同步 mute 状态,避免恢复播放时声音错位
        videos.forEach((v, i) => {
          v.muted = i !== soloIdx
        })
      }
    },
    get masterTime() {
      return masterTime
    },
    attach(el: HTMLVideoElementLike) {
      if (!videos.includes(el)) {
        videos.push(el)
        wireStall(el)
        el.muted = videos.length - 1 !== soloIdx
      }
    },
    detach(el: HTMLVideoElementLike) {
      const idx = videos.indexOf(el)
      if (idx >= 0) videos.splice(idx, 1)
      const cb = stallListeners.get(el)
      if (cb && el.removeEventListener) el.removeEventListener('waiting', cb)
      if (soloIdx != null && soloIdx >= videos.length) soloIdx = videos.length - 1
    },
    tickForTest(nowMs: number) {
      tick(nowMs)
    },
    dispose() {
      running = false
      stopRaf()
      for (const v of videos) {
        const cb = stallListeners.get(v)
        if (cb && v.removeEventListener) v.removeEventListener('waiting', cb)
      }
      videos.length = 0
    },
  }
}
