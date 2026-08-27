/**
 * 盲选批 M1:select-winner 请求体形状测试(FIX-7.3)。
 *
 * blind 元数据在场 → body.blind 逐字段附加(sessionId/track/wasBlind);
 * 缺省不带 → body 无 blind 键(既有调用逐字节不变,向后兼容)。
 * fetch 全 stub(canvasApi.test.ts 同款),断言 URL + JSON.parse 后的 body。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectVariantWinner } from '../canvasApi'

const fetchMock = vi.fn()

function res(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ code: 200 }) } as unknown as Response
}

function lastBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('selectVariantWinner blind 元数据(盲选批 M1)', () => {
  it('带 blind → body.blind 逐字段附加,URL 仍是 select-winner 端点', async () => {
    fetchMock.mockResolvedValueOnce(res(200))
    await selectVariantWinner(7, 101, 'cand:shot:S1:first', 'node-b', undefined, 'first', {
      sessionId: 'bsess_20260827_223001',
      track: 'human_blind',
      wasBlind: false,
      operatorNote: '揭晓后改选',
      reasonTags: ['光感'],
    })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/canvas/v2/variant-groups/cand%3Ashot%3AS1%3Afirst/select-winner')
    const body = lastBody()
    expect(body.projectId).toBe(7)
    expect(body.episodesId).toBe(101)
    expect(body.winnerNodeId).toBe('node-b')
    expect(body.frameSlot).toBe('first')
    expect(body.blind).toEqual({
      sessionId: 'bsess_20260827_223001',
      track: 'human_blind',
      wasBlind: false,
      operatorNote: '揭晓后改选',
      reasonTags: ['光感'],
    })
  })

  it('不带 blind → body 无 blind 键(既有调用形状逐字节不变)', async () => {
    fetchMock.mockResolvedValueOnce(res(200))
    await selectVariantWinner(7, 101, 'vg-1', 'node-a')
    const body = lastBody()
    expect(Object.keys(body).sort()).toEqual(['episodesId', 'projectId', 'winnerNodeId'])
    expect('blind' in body).toBe(false)
  })
})
