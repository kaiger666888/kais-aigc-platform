/**
 * WR-07 回归测试：canvasApi.apiCall 的重试/超时语义。
 *
 *  1. 4xx（业务性失败：400 校验 / 404 组不存在 / 409 multi/locked）不重试——
 *     恰 1 次 fetch 即抛 ApiError{type:'business'}，不做 1s+2s 无谓退避；
 *  2. 5xx 视同网络错误可重试（MAX_RETRIES=2 → 共 3 次）；
 *  3. 悬挂请求按次超时（15s 默认值）→ ApiError{type:'timeout'}，超时不重试；
 *  4. 重试的第二次尝试**同样有超时兜底**（旧 bug：attempt 0 结束时
 *     clearTimeout 解除了唯一超时，retries 挂死永不返回 → selectWinner
 *     无回滚、违反 SC-2）。
 *
 * canvasApi 的 fetch 全部 stub（vi.stubGlobal），零真实网络。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectVariantWinner } from '../canvasApi'

const fetchMock = vi.fn()

function res(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as unknown as Response
}

/** 悬挂的 fetch：永不 resolve，仅在 signal abort 时以 AbortError reject。 */
function hangUntilAbort(_url: string, init?: RequestInit): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      reject(e)
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('apiCall 重试/超时（WR-07）', () => {
  it('HTTP 409（4xx 业务失败）不重试：恰 1 次 fetch 即抛 business ApiError', async () => {
    fetchMock.mockResolvedValueOnce(res(409))

    await expect(selectVariantWinner(7, 101, 'vg-1', 'node-b')).rejects.toMatchObject({
      type: 'business',
      code: 409,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 400 同样不重试（确定性校验失败）', async () => {
    fetchMock.mockResolvedValueOnce(res(400))

    await expect(selectVariantWinner(7, 101, 'vg-1', 'node-b')).rejects.toMatchObject({
      type: 'business',
      code: 400,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 503（5xx）视同网络错误重试：共 3 次后抛 network ApiError', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => res(503))

    const p = selectVariantWinner(7, 101, 'vg-1', 'node-b')
    const assertion = expect(p).rejects.toMatchObject({ type: 'network', code: 503 })
    await vi.advanceTimersByTimeAsync(3_000) // 退避 1s + 2s
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(3) // attempt 0..2
  })

  it('悬挂请求按次超时（默认 15s）→ timeout ApiError，超时不重试', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hangUntilAbort)

    const p = selectVariantWinner(7, 101, 'vg-1', 'node-b')
    const assertion = expect(p).rejects.toMatchObject({ type: 'timeout' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('重试的第二次尝试仍有超时兜底（旧 bug：attempt 0 后超时被解除 → 挂死）', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed') // attempt 0：网络错误 → 触发重试
    })
    fetchMock.mockImplementation(hangUntilAbort) // attempt 1：悬挂

    const p = selectVariantWinner(7, 101, 'vg-1', 'node-b')
    const assertion = expect(p).rejects.toMatchObject({ type: 'timeout' })
    await vi.advanceTimersByTimeAsync(1_000 + 15_000) // 退避 1s + attempt-1 超时 15s
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('成功响应正常解包（json.code 200 → resolve，无重试）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 200, data: null }),
    } as unknown as Response)

    await selectVariantWinner(7, 101, 'vg-1', 'node-b')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
