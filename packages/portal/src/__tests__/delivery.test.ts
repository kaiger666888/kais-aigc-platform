import { describe, expect, it } from 'vitest'
import {
  pickMaster,
  classifyDeliveryNodes,
  resolveProjectId,
  masterSrc,
  formatBytes,
  type DeliveryNode,
} from '../lib/delivery'
import type { ProjectInfo } from '@ic/services/canvasApi'

/** fixture 节点工厂（load-v2 图节点最小形状：id + type + data.{label,filePath,assetType,tags}）。 */
function n(
  id: string,
  o: Partial<{ type: string; label: string; filePath: string; assetType: string; tags: string[]; size: number }> = {},
): DeliveryNode {
  return {
    id,
    type: o.type,
    data: {
      ...(o.label !== undefined ? { label: o.label } : {}),
      ...(o.filePath !== undefined ? { filePath: o.filePath } : {}),
      ...(o.assetType !== undefined ? { assetType: o.assetType } : {}),
      ...(o.tags !== undefined ? { tags: o.tags } : {}),
      ...(o.size !== undefined ? { size: o.size } : {}),
    },
  }
}

function project(id: number, name: string, eps: number[]): ProjectInfo {
  return {
    id,
    name,
    assetCount: 0,
    storyboardCount: 0,
    videoCount: 0,
    episodeCount: eps.length,
    episodes: eps.map((e) => ({ id: e, nodeCount: 0 })),
  }
}

// ─── resolveProjectId（Q5 反查：一集属一项目）────────────────────────────

describe('resolveProjectId', () => {
  it('episodes[].id 命中 → 返回 projectId', () => {
    const projects = [project(3, '甲项目', [1, 2]), project(7, '乙项目', [9, 10])]
    expect(resolveProjectId(projects, 9)).toBe(7)
    expect(resolveProjectId(projects, 1)).toBe(3)
  })

  it('未命中 / 空 episodes → null', () => {
    const projects = [project(3, '甲项目', [1, 2]), project(8, '空项目', [])]
    expect(resolveProjectId(projects, 999)).toBeNull()
    expect(resolveProjectId(projects, 42)).toBeNull()
    expect(resolveProjectId([], 1)).toBeNull()
  })
})

// ─── pickMaster（A4 三分支）──────────────────────────────────────────────

describe('pickMaster', () => {
  it('分支 1：名/路径含 master 的 video 优先（多候选按名称字典序确定性）', () => {
    const nodes = [
      n('a', { type: 'video', label: 'preview_01', filePath: '/oss/x/preview_01.mp4' }),
      n('b', { type: 'video', label: 'master_z', filePath: '/oss/x/master_z.mp4' }),
      n('c', { type: 'video', label: 'master_a', filePath: '/oss/x/master_a.mp4' }),
    ]
    expect(pickMaster(nodes)?.id).toBe('c')
  })

  it('分支 2：无 master 标记且唯一 video → 兜底该 video（assetType=delivery + .mp4 也算 video 形）', () => {
    const nodes = [
      n('s', { type: 'script', label: 'P13 交付', filePath: '/assets/P13/note.md' }),
      n('v', { type: 'video', label: 'final_cut', filePath: '/oss/x/final.mp4' }),
    ]
    expect(pickMaster(nodes)?.id).toBe('v')
    // assetType=delivery + .mp4 路径（无 type 字段的契约形态）
    const nodes2 = [n('d', { label: 'final', filePath: '/assets/P13/final.mp4', assetType: 'delivery' })]
    expect(pickMaster(nodes2)?.id).toBe('d')
  })

  it('分支 3：多个无标记 video → filePath 含 mp4 的第一个（名称字典序；无 mp4 则全体池兜底）', () => {
    const nodes = [
      n('z', { type: 'video', label: 'b_clip', filePath: '/oss/x/b.mov' }),
      n('y', { type: 'video', label: 'b', filePath: '/oss/x/b.mp4' }),
      n('x', { type: 'video', label: 'a', filePath: '/oss/x/a.mp4' }),
    ]
    expect(pickMaster(nodes)?.id).toBe('x')
    // 全员无 mp4 → 名称字典序第一个
    const nodes2 = [
      n('p', { type: 'video', label: 'b', filePath: '/oss/x/b.mov' }),
      n('q', { type: 'video', label: 'a', filePath: '/oss/x/a.mov' }),
    ]
    expect(pickMaster(nodes2)?.id).toBe('q')
  })

  it('空集 / 无 video → undefined', () => {
    expect(pickMaster([])).toBeUndefined()
    expect(pickMaster([n('s', { type: 'script', label: 'qc' })])).toBeUndefined()
  })
})

// ─── classifyDeliveryNodes（U-12 三型分类）──────────────────────────────

describe('classifyDeliveryNodes', () => {
  it('三型分类 + 排序（成片 → 交付包 → 质检报告，组内名称字典序）', () => {
    const nodes = [
      n('qc1', { type: 'script', label: 'master-qc-summary' }),
      n('pkg', { type: 'script', label: 'delivery-package', filePath: '/oss/x/pkg.zip' }),
      n('mst', { type: 'video', label: 'master.mp4', filePath: '/oss/x/master.mp4', size: 191260000 }),
    ]
    const { master, items } = classifyDeliveryNodes(nodes)
    expect(master?.id).toBe('mst')
    expect(items.map((i) => i.kind)).toEqual(['master', 'package', 'qc'])
    expect(items.map((i) => i.id)).toEqual(['mst', 'pkg', 'qc1'])
    expect(items[0]).toMatchObject({ label: 'master.mp4', filePath: '/oss/x/master.mp4', size: 191260000 })
  })

  it('中文名「包」也归交付包；无 label 用 id；size 缺省', () => {
    const nodes = [
      n('a-delivery_package', { type: 'script' }),
      n('a-master-qc', { type: 'script', label: '质检汇总' }),
    ]
    const { master, items } = classifyDeliveryNodes(nodes)
    expect(master).toBeUndefined()
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId['a-delivery_package'].kind).toBe('package')
    expect(byId['a-delivery_package'].label).toBe('a-delivery_package')
    expect(byId['a-master-qc'].kind).toBe('qc')
    expect(byId['a-master-qc'].size).toBeUndefined()
  })

  it('空集 → { master: undefined, items: [] }（空态判定输入）', () => {
    expect(classifyDeliveryNodes([])).toEqual({ master: undefined, items: [] })
  })
})

// ─── masterSrc / formatBytes（媒体链与人类可读尺寸）─────────────────────

describe('masterSrc（resolveMediaUrl 薄封）', () => {
  it('/oss 相对路径直通（同源 OSS_ORIGIN 缺省）', () => {
    expect(masterSrc(n('m', { type: 'video', filePath: '/oss/pipeline/abc/master.mp4' }))).toBe(
      '/oss/pipeline/abc/master.mp4',
    )
  })

  it('绝对 FS 路径 → /local-file 兜底（白名单代理）', () => {
    expect(masterSrc(n('m', { type: 'video', filePath: '/data/workspace/kais-hermes-skills/runs/x/master.mp4' }))).toBe(
      '/local-file?path=' + encodeURIComponent('/data/workspace/kais-hermes-skills/runs/x/master.mp4'),
    )
  })

  it('无 master / 空 filePath → null', () => {
    expect(masterSrc(undefined)).toBeNull()
    expect(masterSrc(n('m', { type: 'video' }))).toBeNull()
  })
})

describe('formatBytes（KB/MB 人类可读）', () => {
  it('MB 一位小数 / KB 整数 / 缺省 null', () => {
    expect(formatBytes(191260000)).toBe('182.4 MB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(null)).toBeNull()
  })
})
