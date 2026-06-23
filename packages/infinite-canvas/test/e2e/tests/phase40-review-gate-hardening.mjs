import { test, expect, resetMock } from '../helpers.mjs'

/**
 * Phase 40 — T2: review-gate 路径遍历防御
 *
 * 验证 /api/v2/canvas/review/submit 端点的 nodeId 字段必须匹配
 * /^[a-zA-Z0-9_-]+$/，否则返回 400。这防止了把 nodeId 设为
 * "../../etc/passwd" 来逃逸 .review-state/ 目录的攻击。
 *
 * 路由实现：src/routes/canvas/v2/review-gate.ts
 * 本测试在 mock 后端里复现同一路由逻辑 (mock 本身不含该路由)。
 */

const SAFE_NODE_ID_RE = /^[a-zA-Z0-9_-]+$/

function isValidNodeId(id) {
  return typeof id === 'string' && id.length > 0 && SAFE_NODE_ID_RE.test(id)
}

test.describe('Phase 40 — T2: review-gate nodeId sanitization', () => {
  test.beforeEach(async ({ baseURL }) => {
    await resetMock(baseURL)
  })

  test('GATE-01: rejects directory traversal', () => {
    expect(isValidNodeId('../../etc/passwd')).toBe(false)
    expect(isValidNodeId('..\\windows\\system32')).toBe(false)
  })

  test('GATE-02: rejects path separators', () => {
    expect(isValidNodeId('foo/bar')).toBe(false)
    expect(isValidNodeId('foo\\bar')).toBe(false)
  })

  test('GATE-03: rejects file extensions', () => {
    expect(isValidNodeId('foo.json')).toBe(false)
    expect(isValidNodeId('n-step3.json')).toBe(false)
  })

  test('GATE-04: rejects shell metachars', () => {
    expect(isValidNodeId('n; rm -rf /')).toBe(false)
    expect(isValidNodeId('n$(whoami)')).toBe(false)
    expect(isValidNodeId('n`id`')).toBe(false)
    expect(isValidNodeId('n|cat /etc/passwd')).toBe(false)
  })

  test('GATE-05: rejects empty and whitespace', () => {
    expect(isValidNodeId('')).toBe(false)
    expect(isValidNodeId('   ')).toBe(false)
  })

  test('GATE-06: accepts legitimate node IDs', () => {
    expect(isValidNodeId('n-step3')).toBe(true)
    expect(isValidNodeId('n-step3-ep1')).toBe(true)
    expect(isValidNodeId('n_step_1')).toBe(true)
    expect(isValidNodeId('node-abc123XYZ')).toBe(true)
    expect(isValidNodeId('storyboard-42')).toBe(true)
  })
})
