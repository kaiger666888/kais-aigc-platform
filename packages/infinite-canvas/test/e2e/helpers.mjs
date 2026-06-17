import { test as base, expect } from '@playwright/test'

/**
 * 测试专用 helper — 加载 canvas 页面 (mock-backend 注入了 ?projectId=1&episodesId=1)
 *
 * 每个 test 自动在执行前 reset mock state,确保串行测试隔离。
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  page: async ({ page, baseURL }, use) => {
    // 重置 mock state
    await page.request.post(`${baseURL}/__mock/reset`)
    await use(page)
  },
})

export async function resetMock(baseURL) {
  await fetch(`${baseURL}/__mock/reset`, { method: 'POST' })
}

export async function loadCanvas(page, opts = {}) {
  const params = new URLSearchParams({
    projectId: opts.projectId ?? '1',
    episodesId: opts.episodesId ?? '1',
    testMode: '1',
  })
  await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  await page.goto(`/?${params.toString()}`, { waitUntil: 'networkidle' })

  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForFunction(() => {
    return document.querySelectorAll('.react-flow__node').length > 0
  }, { timeout: 10_000 })
  // 等 testMode hook 挂载
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

/**
 * 设置 canvas store 的 selectedNodeIds (绕过 React Flow 复杂的 selection 模型)
 */
export async function setSelectedNodeIds(page, ids) {
  await page.evaluate((nodeIds) => {
    window.__kaisCanvas?.setSelectedNodeIds(nodeIds)
  }, ids)
}

/**
 * 查找指定 id 的 canvas 节点 wrapper
 */
export function nodeSelector(nodeId) {
  return `.react-flow__node[data-id="${nodeId}"]`
}

/**
 * 获取 mock backend 已记录的调用日志 (使用相对路径 + baseURL)
 */
export async function getCalls(page) {
  const res = await page.request.get('/__mock/calls')
  return res.json()
}

/**
 * 获取 mock backend 当前状态
 */
export async function getMockState(page) {
  const res = await page.request.get('/__mock/state')
  return res.json()
}

export { expect }

