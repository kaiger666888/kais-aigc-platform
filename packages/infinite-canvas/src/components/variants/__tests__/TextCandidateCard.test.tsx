// @vitest-environment jsdom
/**
 * 盲选批 M2:TextCandidateCard 渲染级测试。
 *
 *  1. 字段行数正确(table 行 = fieldRows 数,delta 徽章只给带 delta 的行);
 *  2. 差异段 <mark> 高亮(a≠b 出 mark,a===b 无 mark);
 *  3. XSS 注入面:含 `<script>` 的字段值按字面文本渲染——DOM 无 script
 *     元素、无 innerHTML(extras 渲染纪律,candidateEnvelope 头注)。
 */
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import TextCandidateCard, { diffSegments } from '../TextCandidateCard'

let root: Root | null = null
let container: HTMLElement | null = null
function render(ui: React.ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(ui) })
}

describe('TextCandidateCard(盲选批 M2)', () => {
  it('字段行数正确 + delta 徽章只渲染带 delta 的行', () => {
    render(
      <TextCandidateCard
        fieldRows={[
          { field: 'hook', a: '旧钩子', b: '新钩子', delta: 'punch +0.82' },
          { field: '时长', a: '12s', b: '9s' },
          { field: '情绪', a: '平', b: '烈', delta: '−1' },
        ]}
      />,
    )
    const rows = container!.querySelectorAll('[data-testid="text-candidate-row"]')
    expect(rows.length).toBe(3)
    const deltas = container!.querySelectorAll('[data-testid="text-candidate-delta"]')
    expect(deltas.length).toBe(2) // 无 delta 的行不造徽章
    expect(deltas[0]!.textContent).toContain('punch +0.82')
    // 行内字段名对齐(同字段左右 td 并排)
    expect(rows[0]!.getAttribute('data-field')).toBe('hook')
  })

  it('差异段 <mark> 高亮:相异处出 mark,相同行不出', () => {
    render(
      <TextCandidateCard
        fieldRows={[
          { field: '句', a: '夜雨敲窗', b: '夜雨拍窗' },
          { field: '同', a: '完全一致', b: '完全一致' },
        ]}
      />,
    )
    const marks = container!.querySelectorAll('mark')
    expect(marks.length).toBe(2) // 左「敲」+ 右「拍」各一枚
    expect(marks[0]!.textContent).toBe('敲')
    expect(marks[1]!.textContent).toBe('拍')
  })

  it('XSS 注入面:含 <script> 的字段值按字面文本渲染,DOM 无 script 元素', () => {
    render(
      <TextCandidateCard
        fieldRows={[
          { field: 'xss', a: '<script>alert(1)</script>', b: '<img src=x onerror=alert(2)>' },
        ]}
      />,
    )
    expect(container!.querySelector('script')).toBeNull()
    expect(container!.querySelector('img')).toBeNull() // 文本非元素
    const row = container!.querySelector('[data-testid="text-candidate-row"]')!
    expect(row.textContent).toContain('<script>alert(1)</script>')
    expect(row.querySelector('script')).toBeNull() // 行内无注入元素(diff-split 渲染不依赖实体串断言)
  })

  it('空 fieldRows 渲染 null(不造空壳)', () => {
    render(<TextCandidateCard fieldRows={[]} />)
    expect(container!.querySelector('[data-testid="text-candidate-card"]')).toBeNull()
  })
})

describe('diffSegments(纯函数)', () => {
  it('相同字符串 → 双侧各一段 same,无差异段', () => {
    const { left, right } = diffSegments('夜戏', '夜戏')
    expect(left.every((s) => s.kind === 'same')).toBe(true)
    expect(right.every((s) => s.kind === 'same')).toBe(true)
  })

  it('长文本(>400)走粗 diff:公共前后缀保 same,中段各归各侧', () => {
    const a = '头'.repeat(10) + 'X'.repeat(500) + '尾'.repeat(10)
    const b = '头'.repeat(10) + 'Y'.repeat(500) + '尾'.repeat(10)
    const { left, right } = diffSegments(a, b)
    expect(left[0]!.kind).toBe('same')
    expect(left[1]!.kind).toBe('a')
    expect(right[1]!.kind).toBe('b')
    expect(left[left.length - 1]!.kind).toBe('same')
  })
})
