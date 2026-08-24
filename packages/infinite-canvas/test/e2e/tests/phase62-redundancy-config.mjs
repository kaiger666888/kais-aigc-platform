import { test, expect, getCalls } from '../helpers.mjs'

/**
 * Phase 62-07 Task 2 — phase62-redundancy-config e2e（七用例，HIER-03 冗余配置链）。
 *
 * 用例地图(-g 组词,62-07 PLAN Task 2(2)):
 *  a toggle-default-collapsed : config-rail 默认不在场;点 config-toggle 开 → rail 可见;
 *                               再点收起 → rail 卸载(负向)。
 *  b rows-complete (D-12)     : fileShape=requirement-v25 → config-row 恰 14 行
 *                               (11 嵌套+3 扁平);p09_shotlist.transition 无独立行
 *                               (漂移锁);shot_list 行 note「转场随分镜表候选整体」可见。
 *  c three-source-priority    : 先 PUT 一条 override → 该行 data-source=override 且值保真;
 *                               requirement-v25 档未覆盖行 data-source=requirement(pre=2);
 *                               legacy 档 → snapshot + 「无 v2.5 键」角标 + 值为快照默认。
 *  d pre-cap-locked-inputs    : 5 确定性键 config-pre-input disabled + 值钉 1 +
 *                               reason「确定性派生 · pre 固定为 1」可见;bgm/foley
 *                               「占位未接线」chip 在场。
 *  e write-roundtrip          : 改 p06 行 pre=3/final=2 → config-save → /__mock/calls PUT
 *                               载荷 {nCandidates:3, finalCandidates:2} 保真;
 *                               genCfgWriteState='synced' → 徽标「已同步 requirement.json」;
 *                               'file-fail' → 「文件面寻址失败——覆盖层已保存」(双 fixture)。
 *  f clamp-frontend-and-backend: final>pre → config-save disabled + 行内越界文案;
 *                               后端道:直接 PUT p07_style.style_vector {pre:3} → mock 400
 *                               「确定性派生 · pre 固定为 1」(前端输入禁用,后端兜底独立可证)。
 *  g locked-section (D-11)    : summary「不可配键 · 19」;展开恰 2 行(tts + 报告/审计汇总),
 *                               两 reason 文案在;锁定行无 input 元素(不可交互 DOM 断言)。
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——运行本文件前必须 `npm run build`(packages/infinite-canvas)。
 */

const HIER_URL = `/?${new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' }).toString()}`
const NESTED_KEYS = [
  'p01_hook.topic_kernel', 'p06_script.spatio_temporal', 'p09_shotlist.shot_list',
  'p11_video.video_render', 'p07_style.style_vector', 'p07_style.color_intent',
  'p12_compose.master_timeline', 'p12_compose.audio_mix', 'p13_master.master_mp4',
  'p12_audio.bgm', 'p12_audio.foley',
]
const FLAT_KEYS = ['p01_hook', 'p02_outline', 'p03_script']
const PRE_CAP1_KEYS = [
  'p07_style.style_vector', 'p07_style.color_intent',
  'p12_compose.master_timeline', 'p12_compose.audio_mix', 'p13_master.master_mp4',
]

async function loadHierarchyWithConfig(page, { fileShape = null } = {}) {
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  // fileShape 为 /__mock/config 顶层键（server.mjs:791 直读，非嵌套）。
  const cfg = { assetFixture: 'rich', ...(fileShape ? { fileShape } : {}) }
  await page.request.post('/__mock/config', { data: cfg })
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '资产层级', exact: true }).click()
  await expect(page.locator('[data-testid="hierarchy-view"]')).toBeVisible()
}

async function openRail(page) {
  await page.getByTestId('config-toggle').click()
  await expect(page.getByTestId('config-rail')).toBeVisible()
  // rows 加载完成门:14 行齐(D-12 完整性前提)。
  await expect(page.getByTestId('config-row')).toHaveCount(14)
}

/** PUT overrides 调用记录。 */
async function putCallsFor(page, phaseKey) {
  const calls = await getCalls(page)
  return calls.filter(
    (c) => c.method === 'PUT' && c.path === `/api/canvas/v2/generation-config/overrides/${phaseKey}`,
  )
}

test.describe('phase62 redundancy-config', () => {
  test('a toggle-default-collapsed: 默认收起 → 开合往返', async ({ page }) => {
    await loadHierarchyWithConfig(page)
    await expect(page.getByTestId('config-rail')).toHaveCount(0)
    await openRail(page)
    await page.getByTestId('config-toggle').click()
    await expect(page.getByTestId('config-rail')).toHaveCount(0)
  })

  test('b rows-complete: 14 行 + transition 无独立行 + note 在场 (D-12)', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'requirement-v25' })
    await openRail(page)
    for (const key of [...NESTED_KEYS, ...FLAT_KEYS]) {
      await expect(page.locator(`[data-testid="config-row"][data-phase-key="${key}"]`)).toHaveCount(1)
    }
    // D-12 漂移锁:transition 已并入 shot_list(27-02 单键裁决),无独立行。
    expect(await page.locator('[data-phase-key="p09_shotlist.transition"]').count()).toBe(0)
    const shotRow = page.locator('[data-testid="config-row"][data-phase-key="p09_shotlist.shot_list"]')
    await expect(shotRow).toContainText('转场随分镜表候选整体')
    // requirement 档实测值样本:全键 {pre:2, final:1} + data-source=requirement。
    const p06 = page.locator('[data-testid="config-row"][data-phase-key="p06_script.spatio_temporal"]')
    await expect(p06).toHaveAttribute('data-source', 'requirement')
  })

  test('c three-source-priority: override > requirement > legacy 快照回落', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'requirement-v25' })
    await openRail(page)
    // override 源:直接经服务写一条(与 UI 保存同端点),读侧重载后行角标翻转。
    await page.request.put('/api/canvas/v2/generation-config/overrides/p06_script.spatio_temporal', {
      data: { projectId: 1, episodesId: 1, nCandidates: 4, finalCandidates: 2 },
    })
    await page.getByTestId('config-toggle').click() // 收起
    await openRail(page)
    const p06 = page.locator('[data-testid="config-row"][data-phase-key="p06_script.spatio_temporal"]')
    await expect(p06).toHaveAttribute('data-source', 'override')
    await expect(p06.locator('[data-testid="config-pre-input"]')).toHaveValue('4')

    // legacy 档:快照默认 + 「无 v2.5 键」角标(嵌套 1/1;扁平 pre=3 final=1)。
    await loadHierarchyWithConfig(page, { fileShape: 'legacy' })
    await openRail(page)
    const tk = page.locator('[data-testid="config-row"][data-phase-key="p01_hook.topic_kernel"]')
    await expect(tk).toHaveAttribute('data-source', 'snapshot')
    // 每行两个 SourceChip(pre/final 各一)——strict mode 取 first。
    await expect(tk.locator('[data-testid="config-source-chip"]').first()).toContainText('无 v2.5 键')
    await expect(tk.locator('[data-testid="config-pre-input"]')).toHaveValue('1')
    const flat = page.locator('[data-testid="config-row"][data-phase-key="p02_outline"]')
    await expect(flat.locator('[data-testid="config-pre-input"]')).toHaveValue('3')
    await expect(flat.locator('[data-testid="config-final-input"]')).toHaveValue('1')
  })

  test('d pre-cap-locked-inputs: 5 确定性键钉 1 禁用 + 占位 chip', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'not-found' })
    await openRail(page)
    for (const key of PRE_CAP1_KEYS) {
      const row = page.locator(`[data-testid="config-row"][data-phase-key="${key}"]`)
      await expect(row.locator('[data-testid="config-pre-input"]')).toBeDisabled()
      await expect(row.locator('[data-testid="config-pre-input"]')).toHaveValue('1')
      await expect(row).toContainText('确定性派生 · pre 固定为 1')
    }
    // unwired 键(bgm/foley):「占位未接线」灰 chip。
    for (const key of ['p12_audio.bgm', 'p12_audio.foley']) {
      const row = page.locator(`[data-testid="config-row"][data-phase-key="${key}"]`)
      await expect(row.getByTestId('config-unwired-chip')).toContainText('占位未接线')
    }
    // gpuHint(p11_video):⚠ 提示在。
    await expect(page.locator('[data-testid="config-row"][data-phase-key="p11_video.video_render"] .am-cfg__gpu-hint')).toHaveCount(1)
  })

  test('e write-roundtrip: PUT 载荷保真 + synced/file-fail 双徽标', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'requirement-v25' })
    await openRail(page)
    // 编辑 p06 行 pre=3/final=2 → dirty → 保存。
    const p06 = page.locator('[data-testid="config-row"][data-phase-key="p06_script.spatio_temporal"]')
    await p06.locator('[data-testid="config-pre-input"]').fill('3')
    await p06.locator('[data-testid="config-final-input"]').fill('2')
    await expect(p06).toContainText('未保存')
    await p06.getByTestId('config-save').click()
    // 载荷保真(logCall 记录)。
    const calls = await putCallsFor(page, 'p06_script.spatio_temporal')
    expect(calls.length).toBe(1)
    expect(calls[0].body?.nCandidates ?? calls[0].nCandidates).toBe(3)
    expect(calls[0].body?.finalCandidates ?? calls[0].finalCandidates).toBe(2)
    // 缺省 writeState=override → 「已存覆盖层」。
    await expect(p06.getByTestId('config-write-badge')).toHaveAttribute('data-write-state', 'override')
    await expect(p06.getByTestId('config-write-badge')).toContainText('已存覆盖层')

    // synced fixture:「已同步 requirement.json」。
    await page.request.post('/__mock/config', { data: { genCfgWriteState: 'synced' } })
    const p02 = page.locator('[data-testid="config-row"][data-phase-key="p02_outline"]')
    await p02.locator('[data-testid="config-final-input"]').fill('2')
    await p02.getByTestId('config-save').click()
    await expect(p02.getByTestId('config-write-badge')).toHaveAttribute('data-write-state', 'synced')
    await expect(p02.getByTestId('config-write-badge')).toContainText('已同步 requirement.json')

    // file-fail fixture:「文件面寻址失败——覆盖层已保存」(不假成功双 fixture)。
    await page.request.post('/__mock/config', { data: { genCfgWriteState: 'file-fail' } })
    const p03 = page.locator('[data-testid="config-row"][data-phase-key="p03_script"]')
    await p03.locator('[data-testid="config-final-input"]').fill('2')
    await p03.getByTestId('config-save').click()
    await expect(p03.getByTestId('config-write-badge')).toHaveAttribute('data-write-state', 'file-fail')
    await expect(p03.getByTestId('config-write-badge')).toContainText('文件面寻址失败——覆盖层已保存')
  })

  test('f clamp-frontend-and-backend: final>pre 禁存+文案;后端 400 兜底独立可证', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'requirement-v25' })
    await openRail(page)
    // 前端第一道:p06 final>pre → save disabled + 行内越界文案。
    const p06 = page.locator('[data-testid="config-row"][data-phase-key="p06_script.spatio_temporal"]')
    await p06.locator('[data-testid="config-final-input"]').fill('9')
    await expect(p06).toContainText('数值越界：pre ≥ 1，final 需在 1..pre 之间')
    await expect(p06.getByTestId('config-save')).toBeDisabled()

    // 后端第二道(独立面):前端禁用使 UI 无法发 preCap1 超帽请求——直接打端点证明兜底。
    const res = await page.request.put('/api/canvas/v2/generation-config/overrides/p07_style.style_vector', {
      data: { projectId: 1, episodesId: 1, nCandidates: 3, finalCandidates: 1 },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.message).toBe('确定性派生 · pre 固定为 1')
  })

  test('g locked-section: 「不可配键 · 19」+ 恰 2 禁用行无 input', async ({ page }) => {
    await loadHierarchyWithConfig(page, { fileShape: 'not-found' })
    await openRail(page)
    const section = page.getByTestId('config-locked-section')
    await expect(section.locator('summary')).toContainText('不可配键 · 19')
    await section.locator('summary').click()
    const lockedRows = section.getByTestId('config-row-locked')
    await expect(lockedRows).toHaveCount(2)
    await expect(lockedRows.nth(0)).toHaveAttribute('data-phase-key', 'p10_voice.tts')
    await expect(lockedRows.nth(0)).toContainText('钉死 1')
    await expect(lockedRows.nth(1)).toContainText('报告/审计类 · 管线固定')
    await expect(lockedRows.nth(1)).toContainText('18 键')
    // 不可交互 DOM 断言:锁定行内无任何 input 元素。
    expect(await section.locator('input').count()).toBe(0)
  })
})
