/**
 * wallTransport 行为测试(Phase 53-02 Task 1 / DR-5)。
 *
 * 七组不变量:
 *  1. play 后逐帧 tick → masterTime 按 delta 累加,每个 video currentTime
 *     被驱动到 masterTime % span;
 *  2. 漂移 >120ms 硬 seek;≤120ms 不赋值(不抖动);
 *  3. solo:仅 soloIdx video muted=false,其余 muted=true;setSolo 即时生效;
 *  4. span = min(duration);masterTime 超过 span 回绕(取模);
 *  5. seek(t) → masterTime=t 且全部 video currentTime=t;
 *  6. stall:任一 video 'waiting' → 全场 pause 且 masterTime 对齐该 video;
 *  7. pause 后 tick 不再推进 masterTime。
 *
 * vitest environment: node(无 rAF)— transport 在无 requestAnimationFrame
 * 环境下不启动画循环,测试用 tickForTest(now) 手动驱动同一内部逻辑。
 */
import { describe, expect, it } from 'vitest'
import { createMasterTransport, type HTMLVideoElementLike } from '../wallTransport'

interface FakeVideo extends HTMLVideoElementLike {
  /** 记录 seek 赋值次数(断言"≤阈值不赋值"用) */
  seekCount: number
}

function fakeVideo(duration: number, startAt = 0): FakeVideo {
  const listeners: Record<string, Array<() => void>> = {}
  const v = {
    _currentTime: startAt,
    duration,
    muted: true,
    paused: true,
    seekCount: 0,
    play() { this.paused = false },
    pause() { this.paused = true },
    addEventListener(ev: string, cb: () => void) {
      ;(listeners[ev] ??= []).push(cb)
    },
    fire(ev: string) {
      for (const cb of listeners[ev] ?? []) cb()
    },
    get currentTime() { return this._currentTime },
    set currentTime(t: number) {
      this._currentTime = t
      this.seekCount++
    },
  }
  return v as unknown as FakeVideo
}

describe('wallTransport — DR-5 同播主时钟', () => {
  it('1. play 后 tick 按 delta 累加并驱动全部 video 到 masterTime % span', () => {
    const a = fakeVideo(10, 5) // 起点远离 target,确保触发硬 seek 被驱动
    const b = fakeVideo(8, 5)
    const t = createMasterTransport([a, b])
    t.play()
    t.tickForTest(100) // 首帧锚定
    t.tickForTest(200) // delta 100ms → masterTime = 0.1
    expect(t.masterTime).toBeCloseTo(0.1, 5)
    // span = min(10, 8) = 8 → target = 0.1;|5-0.1| > 120ms → 硬 seek 到 0.1
    expect(a.currentTime).toBeCloseTo(0.1, 5)
    expect(b.currentTime).toBeCloseTo(0.1, 5)
    t.dispose()
  })

  it('2. 漂移 >120ms 硬 seek;≤120ms 不赋值', () => {
    const a = fakeVideo(10, 0.05) // 偏差 50ms(<120)
    const b = fakeVideo(10, 0.5) // 偏差 450ms(>120)
    const t = createMasterTransport([a, b])
    t.play()
    const aBefore = a.seekCount
    const bBefore = b.seekCount
    t.tickForTest(100) // 首帧锚定
    t.tickForTest(200) // masterTime = 0.1 → target = 0.1
    expect(a.seekCount).toBe(aBefore) // 阈值内不赋值
    expect(b.seekCount).toBe(bBefore + 1) // 硬 seek 一次
    expect(b.currentTime).toBeCloseTo(0.1, 5)
    t.dispose()
  })

  it('3. solo:仅 soloIdx muted=false;setSolo 即时生效', () => {
    const a = fakeVideo(10)
    const b = fakeVideo(10)
    const c = fakeVideo(10)
    const t = createMasterTransport([a, b, c])
    t.play()
    t.setSolo(1)
    t.tickForTest(100)
    expect(a.muted).toBe(true)
    expect(b.muted).toBe(false)
    expect(c.muted).toBe(true)
    t.setSolo(2)
    t.tickForTest(200)
    expect(b.muted).toBe(true)
    expect(c.muted).toBe(false)
    t.dispose()
  })

  it('4. span = min(duration);masterTime 超过 span 回绕', () => {
    const a = fakeVideo(10)
    const b = fakeVideo(4)
    const t = createMasterTransport([a, b])
    t.play()
    t.tickForTest(100)
    t.tickForTest(5100) // masterTime = 5.0s,span=4 → target = 1.0
    expect(t.masterTime).toBeCloseTo(5.0, 5)
    expect(a.currentTime).toBeCloseTo(1.0, 5)
    expect(b.currentTime).toBeCloseTo(1.0, 5)
    t.dispose()
  })

  it('5. seek(t) 设 masterTime=t 且全部 video currentTime=t', () => {
    const a = fakeVideo(10)
    const b = fakeVideo(6)
    const t = createMasterTransport([a, b])
    t.seek(2.5)
    expect(t.masterTime).toBe(2.5)
    expect(a.currentTime).toBe(2.5)
    expect(b.currentTime).toBe(2.5)
    t.dispose()
  })

  it('6. stall:任一 video waiting → 全场 pause + masterTime 对齐该 video', () => {
    const a = fakeVideo(10)
    const b = fakeVideo(10)
    const t = createMasterTransport([a, b])
    t.play()
    expect(a.paused).toBe(false)
    ;(b as unknown as { _currentTime: number })._currentTime = 3.3
    ;(b as unknown as { fire(ev: string): void }).fire('waiting')
    expect(a.paused).toBe(true)
    expect(b.paused).toBe(true)
    expect(t.masterTime).toBeCloseTo(3.3, 5)
    t.dispose()
  })

  it('7. pause 后 tick 不再推进 masterTime', () => {
    const a = fakeVideo(10)
    const t = createMasterTransport([a])
    t.play()
    t.tickForTest(100)
    t.tickForTest(200)
    expect(t.masterTime).toBeCloseTo(0.1, 5)
    t.pause()
    t.tickForTest(1000)
    expect(t.masterTime).toBeCloseTo(0.1, 5)
    t.dispose()
  })
})
