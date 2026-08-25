/**
 * TextReader 单测 —— 纯解析层：
 *   parseDocumentMeta（meta JSON → 有序文档字段：键序即阅读序 + 按值分类）
 *   parseProseLines（markdown-lite：#/•/--- 三件套）
 *   isDocumentAsset（阅读器门控：meta.subtype 命中 + 裸 type 兜底）
 *
 * 只测纯规则：组件壳（TextReader 渲染）零网络零 DOM，断言面留目检。
 * fixture 用现网真实 meta 形状（她从深渊归来 Notion 导入资产，2026-08-25 取样）。
 */
import { describe, it, expect } from 'vitest'
import type { AssetDetail } from '../../../services/canvasApi'
import {
  parseDocumentMeta,
  parseProseLines,
  type DocField,
} from '../TextReader'
import {
  isDocumentAsset,
  inferSubtype,
  modalityOfType,
  TYPE_LABEL,
} from '../assetManagerData'

// ─── fixture ──────────────────────────────────────────────

/** 手造 AssetDetail（o_assets 行形状，全字段显式默认；type 用中性 character，
 *  避免 script 默认值误触文档型裸 type 兜底分支）。 */
const detail = (over: Partial<AssetDetail> = {}): AssetDetail => ({
  id: 1,
  uuid: 'uuid-1',
  name: '资产A',
  type: 'character',
  prompt: null,
  describe: null,
  projectId: 1,
  characterId: null,
  viewAngle: null,
  isPrimaryView: false,
  model: null,
  tags: null,
  state: 'active',
  meta: null,
  filePath: null,
  imageState: null,
  imageModel: null,
  resolution: null,
  createdAt: null,
  ...over,
})

/** 现网 episode_script meta 形状（截 08-25 真实行）。 */
const EP_SCRIPT_META = JSON.stringify({
  episode: 1,
  title: '签字前10分钟',
  content: '### 【信息差状态表 · Ep1校验】\n• T0主角已知：前世签协议后六年沦为工具人\n---\n正文段落一行。',
  scene: '宴会厅',
  key_props: '婚前财产放弃协议',
  subtype: 'episode_script',
  source: 'notion',
})

// ─── parseDocumentMeta ────────────────────────────────────

describe('parseDocumentMeta', () => {
  it('键序即阅读序（JSON 插入序保留），subtype/source 不渲染', () => {
    const fields = parseDocumentMeta(EP_SCRIPT_META)!
    expect(fields.map((f) => f.key)).toEqual([
      'episode', 'title', 'content', 'scene', 'key_props',
    ])
  })

  it('按值分类：数字/短串→field、长文/多行→prose', () => {
    const fields = parseDocumentMeta(EP_SCRIPT_META)!
    const byKind = Object.fromEntries(fields.map((f) => [f.key, f.kind]))
    expect(byKind.episode).toBe('field')
    expect(byKind.title).toBe('field')
    expect(byKind.content).toBe('prose')
    expect(byKind.scene).toBe('field')
  })

  it('字符串数组→list；对象数组→records（值字符串化）', () => {
    const fields = parseDocumentMeta(JSON.stringify({
      hook_checks: ['✅ 3秒开场钩', '✅ 情绪转折≥3'],
      episodes: [{ episode: 1, title: '签字前10分钟', scene: '宴会厅' }],
    }))!
    const list = fields.find((f) => f.key === 'hook_checks') as Extract<DocField, { kind: 'list' }>
    const recs = fields.find((f) => f.key === 'episodes') as Extract<DocField, { kind: 'records' }>
    expect(list.items).toHaveLength(2)
    expect(recs.records[0]).toEqual([['集数', '1'], ['标题', '签字前10分钟'], ['场景', '宴会厅']])
  })

  it('已知键映射中文标签（DOC_FIELD_LABELS），未知键回退原键名', () => {
    const fields = parseDocumentMeta('{"zz_unknown_key": "x"}')!
    expect(fields[0].label).toBe('zz_unknown_key')
    const known = parseDocumentMeta('{"scene": "宴会厅"}')!
    expect(known[0].label).toBe('场景')
  })

  it('null/非 JSON/空对象/只剩框架键 → null（调用方回退通用布局）', () => {
    expect(parseDocumentMeta(null)).toBeNull()
    expect(parseDocumentMeta('not json')).toBeNull()
    expect(parseDocumentMeta('{}')).toBeNull()
    expect(parseDocumentMeta('{"subtype":"episode_script","source":"notion"}')).toBeNull()
    // 纯数组 meta（非对象）也 null
    expect(parseDocumentMeta('[1,2]')).toBeNull()
  })
})

// ─── parseProseLines ──────────────────────────────────────

describe('parseProseLines', () => {
  it('# 标题 / • 列表 / --- 分隔 / 段落，空行折叠', () => {
    const lines = parseProseLines('### 【钩子】\n• 第一条\n• 第二条\n\n---\n\n正文段落')
    expect(lines).toEqual([
      { t: 'h', level: 3, text: '【钩子】' },
      { t: 'li', text: '第一条' },
      { t: 'li', text: '第二条' },
      { t: 'hr' },
      { t: 'p', text: '正文段落' },
    ])
  })

  it('#### 四级标题收敛到 3；-/*/· 列表标记等价', () => {
    const lines = parseProseLines('#### 深\n- a\n* b\n· c')
    expect(lines[0]).toMatchObject({ t: 'h', level: 3 })
    expect(lines.slice(1).every((l) => l.t === 'li')).toBe(true)
  })

  it('正文内嵌的 --- 前后有文字时不误判分隔线', () => {
    expect(parseProseLines('a---b')).toEqual([{ t: 'p', text: 'a---b' }])
  })
})

// ─── isDocumentAsset / 类型映射 ────────────────────────────

describe('isDocumentAsset（阅读器门控）', () => {
  it('meta.subtype 命中 8 类文档子类型 → true', () => {
    for (const sub of ['episode_script', 'story_framework', 'pipeline_requirement', 'scene_design', 'costume_design', 'character_bible', 'voice_profile', 'bgm_design']) {
      expect(isDocumentAsset(detail({ meta: `{"subtype":"${sub}"}` }))).toBe(true)
    }
  })

  it('裸 type 兜底：script/story/requirement 无 subtype 也命中', () => {
    expect(isDocumentAsset(detail({ type: 'script', meta: '{"content":"x"}' }))).toBe(true)
    expect(isDocumentAsset(detail({ type: 'story', meta: '{"layers":[]}' }))).toBe(true)
    expect(isDocumentAsset(detail({ type: 'requirement', meta: '{"genre":"x"}' }))).toBe(true)
  })

  it('非文档资产（媒体/管线状态 meta）→ false', () => {
    expect(isDocumentAsset(detail({ filePath: '/x.png', meta: '{"costume_set":"daily"}' }))).toBe(false)
    expect(isDocumentAsset(detail({ type: 'script_phase', meta: '{"phase":"p01_hook_topic","score":8.3}' }))).toBe(false)
    // 注：character 无 filePath 在 inferSubtype 里就是 character_bible（文档型），
    // 负例必须带图才有意义。
    expect(isDocumentAsset(detail({ filePath: '/x.png' }))).toBe(false)
  })
})

describe('Notion 文档型 DB type 映射（08-24 缺口②）', () => {
  it('script/story/requirement/document 进文本模态（金），不再误染青/玫', () => {
    for (const t of ['script', 'story', 'requirement', 'document']) {
      expect(modalityOfType(t)).toBe('text')
    }
  })

  it('TYPE_LABEL 有中文标签（详情副标题不再空白）', () => {
    expect(TYPE_LABEL.script).toBe('剧本')
    expect(TYPE_LABEL.story).toBe('故事框架')
    expect(TYPE_LABEL.requirement).toBe('创作需求')
    expect(TYPE_LABEL.document).toBe('文档')
  })

  it('inferSubtype 裸 type 兜底落树（episode_script/story_framework/pipeline_requirement）', () => {
    expect(inferSubtype(detail({ type: 'script' }))).toBe('episode_script')
    expect(inferSubtype(detail({ type: 'story' }))).toBe('story_framework')
    expect(inferSubtype(detail({ type: 'requirement' }))).toBe('pipeline_requirement')
  })
})
