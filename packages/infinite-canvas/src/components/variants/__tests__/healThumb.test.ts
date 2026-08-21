/**
 * healThumb 行为测试(Phase 53-02 Task 3 / DR-3 + T-53-02-01/02)。
 *
 * 四组锁死断言:
 *  ① 单次触发保护:同一卡第二次 heal 不再发 fetch(计数不增)且直接 placeholder;
 *  ② 仅 /oss/:非 /oss/ 前缀零 fetch、直接 placeholder(路径穿越缓解);
 *  ③ _thumbs URL 切换:响应 data.thumbnailUrl 含 /_thumbs/ → healed + 新 URL;
 *  ④ 占位回退:fetch reject / thumbnailUrl 不含 /_thumbs/ / res.not ok → placeholder。
 */
import { describe, expect, it, vi } from 'vitest'
import { createThumbHealer } from '../healThumb'

function okFetch(url: string, thumbnailUrl: string) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ data: { thumbnailUrl } }), { status: 200 }),
  )
  return fn as unknown as typeof fetch & { mock: { calls: unknown[][] } }
}

describe('healThumb — 三段自愈四断言', () => {
  it('① 单次触发保护:第二次 heal 零 fetch 且直接 placeholder', async () => {
    const fetchMock = okFetch('/api/canvas/v2/thumbnail', '/oss/kmc/_thumbs/a.png')
    const healer = createThumbHealer(fetchMock)
    const cand = { nodeId: 'a-flf-shot_012-first-v1', filePath: '/oss/kmc/a.png' }
    const r1 = await healer.heal(cand)
    expect(r1).toEqual({ kind: 'healed', url: '/oss/kmc/_thumbs/a.png' })
    expect(fetchMock.mock.calls.length).toBe(1)
    const r2 = await healer.heal(cand)
    expect(r2).toEqual({ kind: 'placeholder' })
    expect(fetchMock.mock.calls.length).toBe(1) // 计数不增
  })

  it('② 仅 /oss/:非 /oss/ 前缀零 fetch、直接 placeholder', async () => {
    const fetchMock = okFetch('/api/canvas/v2/thumbnail', '/oss/kmc/_thumbs/a.png')
    const healer = createThumbHealer(fetchMock)
    expect(await healer.heal({ nodeId: 'n1', filePath: 'http://cdn.example.com/a.png' }))
      .toEqual({ kind: 'placeholder' })
    expect(await healer.heal({ nodeId: 'n2', filePath: 'relative/path.png' }))
      .toEqual({ kind: 'placeholder' })
    expect(await healer.heal({ nodeId: 'n3', filePath: '/data/workspace/x.png' }))
      .toEqual({ kind: 'placeholder' })
    expect(await healer.heal({ nodeId: 'n4' })).toEqual({ kind: 'placeholder' })
    expect(fetchMock.mock.calls.length).toBe(0) // 零请求
  })

  it('③ _thumbs URL 切换:healed 且返回新 URL', async () => {
    const fetchMock = okFetch('/api/canvas/v2/thumbnail', '/oss/kmc/ep01/_thumbs/shot_012_first_v1.png')
    const healer = createThumbHealer(fetchMock)
    const r = await healer.heal({ nodeId: 'n9', filePath: '/oss/kmc/ep01/shot_012_first_v1.png' })
    expect(r).toEqual({ kind: 'healed', url: '/oss/kmc/ep01/_thumbs/shot_012_first_v1.png' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/canvas/v2/thumbnail')
    expect(JSON.parse(String(init.body))).toEqual({ sourcePath: '/oss/kmc/ep01/shot_012_first_v1.png' })
  })

  it('④ 占位回退:reject / 无 _thumbs / 非 2xx → placeholder(never-throws)', async () => {
    const rejectFetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    const h1 = createThumbHealer(rejectFetch)
    expect(await h1.heal({ nodeId: 'a', filePath: '/oss/a.png' })).toEqual({ kind: 'placeholder' })

    const badUrlFetch = okFetch('/api/canvas/v2/thumbnail', '/oss/kmc/original.png') // 不含 /_thumbs/
    const h2 = createThumbHealer(badUrlFetch)
    expect(await h2.heal({ nodeId: 'b', filePath: '/oss/b.png' })).toEqual({ kind: 'placeholder' })

    const notOkFetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const h3 = createThumbHealer(notOkFetch)
    expect(await h3.heal({ nodeId: 'c', filePath: '/oss/c.png' })).toEqual({ kind: 'placeholder' })
  })
})
