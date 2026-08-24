import { test, expect, getCalls } from '../helpers.mjs'

/**
 * Phase 62-07 Task 2 — phase62-selection e2e(七用例,层级化选定/批量决策/画布组同步)。
 *
 * 用例地图(-g 组词,62-07 PLAN Task 2(1)):
 *  a single-select-in-hierarchy  : hier 组内 .am-card__select-btn 点击 → PATCH 序列
 *                                 (同组其余 eliminated 先发、winner isPrimaryView:true 末发)
 *                                 与资产库 handleSelect 共享序列一致;计数芯片翻转;无画布组时
 *                                 select-winner 零调用(负向)。
 *  b select-winner-fire-and-forget: save-v2 注入 vg-e2e-1(asset-91001/91002)→ 取消选定再选定
 *                                 91001 → calls 恰 1 条 POST select-winner,body winnerNodeId
 *                                 = ^asset-91001$;未映射组(media 单件)选定零追加(负向)。
 *  c canvas-sync-fail-isolated   : failSelectWinner:true → 选定 → toast「画布侧同步失败」+
 *                                 PATCH 不回滚(winner PATCH 在场 + search 计数未增 = 无 reload)。
 *  d batch-select                : 勾选 char 组 + scene 组 → 「已选 2 组」→ 批量选定 →
 *                                 char 组恰一 winner PATCH(winner=createdAt 最新非淘汰 91003,
 *                                 **勿断组内第一个**)+ 其余待选 eliminated;scene 组零 PATCH +
 *                                 toast「批量选定完成 · 1 组（跳过 1 个手动选择组）」。
 *  e batch-eliminate-arm-confirm : 首击 data-armed=true + 文案「确认淘汰 2 组待选？」→ 5s 自动
 *                                 解除(子断言)→ 重武装二击 → 两组待选全 PATCH eliminated;
 *                                 已有 winner 组 winner 行零 PATCH(负向);select-winner 零调用。
 *  f manual-chip-placement       : hier-manual-chip 全页恰 2 枚且仅在场景/声纹组
 *                                 (char/keyframe 组零存在,负向)。
 *  g vg-chip-nav                 : hier-group-vg[data-vg-id=vg-e2e-1] 在场(唯一;其余组走降级
 *                                 文案,负向)→ 点击 → viewMode 切 canvas(react-flow 挂载 +
 *                                 hierarchy-view 卸载)+ 变体墙开(openWallByGroup 侧效,
 *                                 variant-wall DOM + data-wall-group-id;getGraph() 对照)。
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——运行本文件前必须 `npm run build`(packages/infinite-canvas)。
 *
 * D-05 断言纪律(RESEARCH C 双通道,62-03/62-04 pin 注释沿承;T-62-24):
 *   服务端 PATCH isPrimaryView=true 已自动触发 applyRegistrySelectionToCanvas——客户端
 *   POST select-winner 在常见路径是幂等 no-op(mock 200 applied:false 重放)。断言只锁
 *   「恰 N 次调用 + body winnerNodeId 为画布节点 id(asset- 前缀)」,**勿断 applied:true**,
 *   也不断言 mock fixtureVariantGroups 的 winnerNodeId 副作用。
 *
 * rich fixture 载入基线(62-03 buildRichFixture + 资产库 auto-init,实测钉死——**与
 * 62-07 PLAN 行文有两处出入,以实测为准**,详见偏差记录):
 *   - 资产库(默认视图)auto-init 对**每个无 winner 非手动组**(含单件组)逐组发 PATCH
 *     isPrimaryView:true:rich 下命中 = keyframe 组 91009(createdAt 最新,非首个 91008)
 *     + video:SH01 单件 91010 + delivery_package 单件 91012——**共 3 条**,非仅 keyframe
 *     一条(单件组同样是无 winner 非手动组,62-05 pickLatestActive 规则不豁免单件)。
 *     载入后层级计数:全部 ★5○5;media 域 ★2(91010/91012)。
 *   - PLAN(1)b「未映射组(media 单件)选定」的前提(单件载入后仍待选)被 auto-init
 *     打破:91010 载入即 ★。负向断言改走真实路径——先取消选定 91010 再选定(单件
 *     组无兄弟,各恰 1 PATCH),media 单件仍零 select-winner 追加。
 *   - D-05 失败通道(canvas-sync-fail):客户端 apiCall 对 5xx 指数退避重试
 *     (MAX_RETRIES=2,1s+2s)——mock 500 下 select-winner POST 恰 **3 次尝试**(非 1;
 *     mock 全尝试记录设计正是为此观测面),toast 在末次失败后出现。
 *   - 场景/声纹组零自动选定(HIER-04:scene:宴会厅 与 char:shenzhiyi:voice 恒 sel=0)。
 *   - char:shenzhiyi:concept 91001 为 fixture 自带 ★;createdAt 序 91003 > 91002 > 91001。
 *   - 批量选定 toast 跳过后缀仅 M>0 追加(UI-SPEC §Copywriting 条件式,62-05 裁定)。
 *   auto-init 链(逐组 PATCH→reload→search)在 goto networkidle 窗口内收敛;loadHierarchy
 *   仍以 keyframe 组属性做 settle 门,把基线变成显式断言而非竞速假设。
 */

const HIER_URL = `/?${new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' }).toString()}`

const CHAR_KEY = 'char:shenzhiyi:concept'
const SCENE_KEY = 'scene:宴会厅'
const VOICE_KEY = 'char:shenzhiyi:voice'
const KEYFRAME_KEY = 'keyframe:S01:S01_first'

const charGroup = (page) => page.locator(`[data-testid="hier-group"][data-group-key="${CHAR_KEY}"]`)
const sceneGroup = (page) => page.locator(`[data-testid="hier-group"][data-group-key="${SCENE_KEY}"]`)

/** D-05/b 用图注入:save-v2 全量替换 mock canvas(61-01/REGEN-01-c 注入范式)。
 *  ⚠️ 形态裁定(实测):注入必须走 **V3 直通**(meta.version==='3')——adaptV2Graph 对
 *  V2 形态走 migrateV2toV3,变体组经 synthesizeVariantNodes 重建为 vg_nvar_* 前缀 id,
 *  `vg-e2e-1` 组键不再存活;V3 直通只过 repairToValid(zod 形状校验),组 id 原样透传。
 *  节点按 assetNodeV3Schema 最小合法形(strict);组 sourceEventId 只需是字符串(直通
 *  路径不做引用完整性检查,v2-migrated 路径才查悬空)。store.graph 经 load-v2 →
 *  adaptV2Graph → setGraph 持有该组,findVariantGroupForAsset/resolveAssetNodeId 命中;
 *  mock select-winner 路由侧查 state.fixtureVariantGroups(DEFAULT 含 vg-e2e-1)。 */
async function injectVgGraph(page) {
  const assetNode = (id, n) => ({
    id,
    kind: 'asset',
    branchId: 'br_main',
    phaseIndex: 4,
    phaseName: 'P04 · 角色设定图',
    position: { x: 120, y: 120 + n * 220 },
    size: { width: 240, height: 160 },
    state: 'success',
    stage: 'global',
    modality: 'image',
    scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    meta: { stage: 'global', assetType: 'role' },
    curation: 'candidate',
    stale: null,
  })
  await page.request.post('/api/canvas/v2/save-v2', {
    data: {
      projectId: 1,
      episodesId: 1,
      graph: {
        meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
        nodes: [assetNode('asset-91001', 0), assetNode('asset-91002', 1)],
        links: [],
        branches: [],
        variantGroups: [
          {
            id: 'vg-e2e-1',
            branchId: 'br_main',
            phaseIndex: 4,
            sourceEventId: 'evt-e2e',
            variantNodeIds: ['asset-91001', 'asset-91002'],
            selectMode: 'single',
          },
        ],
      },
    },
  })
}

/** 层级用例起点(61-01 loadAssetCenter 先例 + 追加一步,UI-SPEC D-13;phase62-hierarchy
 *  同型):goto + 显式 reset → (可选)save-v2 注入 vg 图 → POST /__mock/config
 *  { assetFixture:'rich' }(配置在 reset 后注入,防被清)→ 重 goto → 点「资产层级」→
 *  等 hierarchy-view + 首组卡 → auto-init settle 门(keyframe 组 sel=1/pend=1,头部
 *  基线注释)→ __kaisCanvas 挂载。 */
async function loadHierarchy(page, { injectVg = false } = {}) {
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  if (injectVg) await injectVgGraph(page)
  await page.request.post('/__mock/config', { data: { assetFixture: 'rich' } })
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '资产层级', exact: true }).click()
  await expect(page.locator('[data-testid="hierarchy-view"]')).toBeVisible()
  await expect(page.locator('[data-testid="hier-group"]').first()).toBeVisible({ timeout: 15_000 })
  // auto-init settle 门:91009 已被资产库自动初始化选为 keyframe 组 winner(mtime 最新)。
  await expect
    .poll(async () => page.evaluate((key) => {
      const el = document.querySelector(`[data-testid="hier-group"][data-group-key="${key}"]`)
      return el ? `${el.getAttribute('data-count-selected')}/${el.getAttribute('data-count-pending')}` : null
    }, KEYFRAME_KEY), { timeout: 10_000 })
    .toBe('1/1')
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
}

/** /__mock/calls 里的 PATCH /api/v1/assets-registry/:id 过滤(按资产 id 集)。 */
async function patchCallsFor(page, ids) {
  const set = new Set(ids.map(String))
  const calls = await getCalls(page)
  return calls.filter((c) => {
    if (c.method !== 'PATCH') return false
    const m = c.path?.match(/^\/api\/v1\/assets-registry\/(\d+)$/)
    return m != null && set.has(m[1])
  })
}

/** select-winner POST 调用记录(全变体组路由)。 */
async function selectWinnerCalls(page) {
  const calls = await getCalls(page)
  return calls.filter((c) => c.method === 'POST' && /^\/api\/canvas\/v2\/variant-groups\/.+\/select-winner$/.test(c.path ?? ''))
}

/** search 调用计数(canvas-sync-fail 用例的「无 reload」证据面)。 */
async function searchCallCount(page) {
  const calls = await getCalls(page)
  return calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/assets-registry/search').length
}

/** 组卡三态计数快照(属性断言,非 innerText)。 */
async function groupCounts(page, key) {
  return page.evaluate((k) => {
    const el = document.querySelector(`[data-testid="hier-group"][data-group-key="${k}"]`)
    return el == null ? null : {
      sel: Number(el.getAttribute('data-count-selected')),
      pend: Number(el.getAttribute('data-count-pending')),
      elim: Number(el.getAttribute('data-count-eliminated')),
    }
  }, key)
}

test.describe('phase62-selection 层级选定与批量决策', () => {
  test('single-select-in-hierarchy: 组内选定 PATCH 序列与资产库一致 + 芯片翻转', async ({ page }) => {
    await loadHierarchy(page)

    // 载入基线钉死(头部注释):auto-init 恰 3 条 PATCH——每个无 winner 非手动组各一
    // (keyframe 91009 + video 单件 91010 + delivery 单件 91012;全部 isPrimaryView:true);
    // 手动组零自动选定(HIER-04 负向:scene/voice 恒 sel=0)。
    const baseline = await patchCallsFor(page, [91004, 91005, 91006, 91007, 91008, 91009, 91010, 91012])
    expect(baseline.map((c) => c.path.split('/').pop()).sort()).toEqual(['91009', '91010', '91012'])
    for (const c of baseline) {
      expect(c.body).toEqual({ isPrimaryView: true })
    }
    expect((await groupCounts(page, SCENE_KEY)).sel).toBe(0)
    expect((await groupCounts(page, VOICE_KEY)).sel).toBe(0)

    // 起始态:char 组 1/2/0(91001★ + 91002/91003 待选);批量条未渲染(负向锚)
    expect(await groupCounts(page, CHAR_KEY)).toEqual({ sel: 1, pend: 2, elim: 0 })
    expect(await page.locator('[data-testid="hier-batch-bar"]').count()).toBe(0)

    // 层级视图 L3 卡上点「★ 选定」(91002 待选卡;共享 selectGroupWinner = 资产库同调用点)
    await page.locator('.am-card[data-uuid="e2e-rich-91002"] .am-card__select-btn').click()

    // 完成门(WR-03 教训:先 poll 到位再读明细)——恰 3 条 PATCH(2 淘汰 + 1 winner)
    await expect
      .poll(async () => (await patchCallsFor(page, [91001, 91002, 91003])).length, { timeout: 10_000 })
      .toBe(3)
    const patches = await patchCallsFor(page, [91001, 91002, 91003])
    const byId = Object.fromEntries(patches.map((c) => [c.path.split('/').pop(), c]))
    // 与资产库 handleSelect 同语义:同组其余 → { isPrimaryView:false, state:'eliminated' }…
    expect(byId['91001'].body).toEqual({ isPrimaryView: false, state: 'eliminated' })
    expect(byId['91003'].body).toEqual({ isPrimaryView: false, state: 'eliminated' })
    // …winner → { isPrimaryView:true, state:'active' } 且最后发出(others 先发、winner 末发)
    expect(byId['91002'].body).toEqual({ isPrimaryView: true, state: 'active' })
    const winnerIdx = patches.findIndex((c) => c.path.endsWith('/91002'))
    for (let i = 0; i < patches.length; i++) {
      if (i !== winnerIdx) expect(winnerIdx).toBeGreaterThan(i)
    }

    // UI 计数芯片翻转:★ 换主仍 1、○ 2→0、✕ 0→2(属性断言)
    await expect
      .poll(async () => groupCounts(page, CHAR_KEY), { timeout: 8_000 })
      .toEqual({ sel: 1, pend: 0, elim: 2 })

    // D-05 负向:未注入画布组(findVariantGroupForAsset 未命中)→ select-winner 零调用
    expect(await selectWinnerCalls(page)).toHaveLength(0)
  })

  test('select-winner-fire-and-forget: 恰一次 POST + winnerNodeId=asset-91001(勿断 applied)', async ({ page }) => {
    await loadHierarchy(page, { injectVg: true })

    // 前置:vg-e2e-1 已进 canonical 图(getGraph 对照;migrate 保 id)
    const vgInGraph = await page.evaluate(() =>
      (window.__kaisCanvas?.getGraph()?.variantGroups ?? []).some((g) => g.id === 'vg-e2e-1'))
    expect(vgInGraph).toBe(true)

    // ① 取消选定 91001(fixture ★)→ 组内 3 条全待选(完成门 = 取消选定 PATCH 落库,
    //    非仅乐观计数——后续窗口基线依赖它已入 calls)
    await page.locator('.am-card[data-uuid="e2e-rich-91001"] .am-card__deselect-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91001])).length, { timeout: 10_000 })
      .toBe(1)
    expect((await patchCallsFor(page, [91001]))[0].body).toEqual({ isPrimaryView: false, state: 'active' })
    await expect
      .poll(async () => groupCounts(page, CHAR_KEY), { timeout: 8_000 })
      .toEqual({ sel: 0, pend: 3, elim: 0 })

    // ② 重新选定 91001 → PATCH 3 条 + D-05 fire-and-forget:恰 1 条 select-winner POST
    //    (窗口基线在点击前快照——取消选定那 1 条不计入)
    const base = (await patchCallsFor(page, [91001, 91002, 91003])).length
    expect(base).toBe(1)
    await page.locator('.am-card[data-uuid="e2e-rich-91001"] .am-card__select-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91001, 91002, 91003])).length - base, { timeout: 10_000 })
      .toBe(3)
    await expect
      .poll(async () => (await selectWinnerCalls(page)).length, { timeout: 10_000 })
      .toBe(1)

    // 断言纪律(T-62-24):只锁调用发生 + body winnerNodeId 为 asset- 前缀画布节点 id
    // (非 registry 主键);**勿断 applied:true**(幂等重放 applied:false 属常态)。
    const sw = (await selectWinnerCalls(page))[0]
    expect(sw.path).toBe('/api/canvas/v2/variant-groups/vg-e2e-1/select-winner')
    expect(sw.body.winnerNodeId).toMatch(/^asset-91001$/)
    expect(sw.body.groupId).toBe('vg-e2e-1')

    // ③ 负向:未映射组选定零追加——media 单件 video:SH01(91010,不在任何变体组)。
    //    auto-init 已将其置 ★(基线注释),走真实路径:取消选定 → 再选定(单件组无兄弟,
    //    两步各恰 1 PATCH;91010 全程共 3 条 PATCH = auto-init 1 + 取消 1 + 选定 1)。
    const base91010 = (await patchCallsFor(page, [91010])).length
    expect(base91010).toBe(1) // auto-init 的 {isPrimaryView:true}
    await page.locator('.am-card[data-uuid="e2e-rich-91010"] .am-card__deselect-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91010])).length - base91010, { timeout: 10_000 })
      .toBe(1)
    await page.locator('.am-card[data-uuid="e2e-rich-91010"] .am-card__select-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91010])).length - base91010, { timeout: 10_000 })
      .toBe(2)
    const last91010 = (await patchCallsFor(page, [91010])).at(-1)
    expect(last91010.body).toEqual({ isPrimaryView: true, state: 'active' })
    // select-winner 计数仍恰 1(91010 的选定不触发画布侧通道)
    expect(await selectWinnerCalls(page)).toHaveLength(1)
  })

  test('canvas-sync-fail-isolated: mock 500 → toast「画布侧同步失败」+ PATCH 不回滚', async ({ page }) => {
    await loadHierarchy(page, { injectVg: true })
    // 注入失败开关(merge 进 state.config,不动 rich fixture / 变体组注册表)
    await page.request.post('/__mock/config', { data: { failSelectWinner: true } })

    const searchBefore = await searchCallCount(page)
    expect(searchBefore).toBeGreaterThanOrEqual(2) // 初载 1 + auto-init reload 1

    // 选定 91002(待选,∈ vg-e2e-1)→ 主通道 3 PATCH 全成 + 画布侧 500 → toast
    await page.locator('.am-card[data-uuid="e2e-rich-91002"] .am-card__select-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91001, 91002, 91003])).length, { timeout: 10_000 })
      .toBe(3)
    // D-05 指定原文(toast 3s 自灭窗口内断言;与成功 toast 叠放,按文本定向。
    // 出现时机 = apiCall 末次重试失败后 ≈3s(1s+2s backoff),timeout 留 8s 裕量防负载抖动)
    await expect(page.getByText('画布侧同步失败')).toBeVisible({ timeout: 8_000 })

    // o_assets 已写不回滚:winner PATCH 在场 + 语义正确(isPrimaryView:true)…
    const winnerPatches = (await patchCallsFor(page, [91002])).filter((c) => c.body.isPrimaryView === true)
    expect(winnerPatches).toHaveLength(1)
    // …且无 reload(fail 分支只 toast,不回滚主通道——search 计数不增即为证据)
    expect(await searchCallCount(page)).toBe(searchBefore)
    // UI 侧保持乐观结果(★ 仍在:sel=1/pend=0/elim=2,未被打回)
    await expect
      .poll(async () => groupCounts(page, CHAR_KEY), { timeout: 8_000 })
      .toEqual({ sel: 1, pend: 0, elim: 2 })
    // 500 的 select-winner 调用本身仍被全尝试记录:恰 3 次(apiCall 对 5xx 指数退避
    // 重试 MAX_RETRIES=2:1 次 + 2 重试,1s+2s backoff;头部队列注释),全部同
    // winnerNodeId——断言不含 applied 语义(mock 全尝试记录正是此观测面)
    const swAll = await selectWinnerCalls(page)
    expect(swAll).toHaveLength(3)
    for (const c of swAll) {
      expect(c.path).toBe('/api/canvas/v2/variant-groups/vg-e2e-1/select-winner')
      expect(c.body.winnerNodeId).toBe('asset-91002')
    }
  })

  test('batch-select: 每组恰一 winner PATCH(createdAt 最新)+ 手动组跳过 toast', async ({ page }) => {
    await loadHierarchy(page)

    // 前置:先取消 91001 的选定 → char 组 3 条全待选(批量选定对已有 winner 组是幂等跳过,
    // 62-05 planBatchSelection hasPrimary 分支;本用例要观察的正是「按需初始化」路径)。
    // 完成门 = 取消选定 PATCH 落库(非仅乐观计数),保证下方窗口基线恰 1。
    await page.locator('.am-card[data-uuid="e2e-rich-91001"] .am-card__deselect-btn').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91001])).length, { timeout: 10_000 })
      .toBe(1)
    await expect
      .poll(async () => groupCounts(page, CHAR_KEY), { timeout: 8_000 })
      .toEqual({ sel: 0, pend: 3, elim: 0 })
    const searchBefore = await searchCallCount(page)

    // 勾选 char 组 + scene 组(手动组 checkbox 不禁用——批量淘汰可用,D-07 只绑批量选定)
    await page.locator(`[data-testid="hier-group-check"][data-group-key="${CHAR_KEY}"]`).check()
    await expect(page.locator('[data-testid="hier-batch-bar"]')).toBeVisible()
    await expect(page.getByText('已选 1 组')).toBeVisible()
    await page.locator(`[data-testid="hier-group-check"][data-group-key="${SCENE_KEY}"]`).check()
    await expect(page.getByText('已选 2 组')).toBeVisible()

    // 窗口基线在点击前快照(取消选定的 PATCH 已由上方完成门确认入 calls,恰 1 条;
    // 批量窗口内恰 3 条 PATCH = 91001/91002 eliminated + 91003 winner)
    const base = (await patchCallsFor(page, [91001, 91002, 91003])).length
    expect(base).toBe(1)
    await page.locator('[data-testid="hier-batch-select"]').click()
    await expect
      .poll(async () => (await patchCallsFor(page, [91001, 91002, 91003])).length - base, { timeout: 10_000 })
      .toBe(3)
    const patches = (await patchCallsFor(page, [91001, 91002, 91003])).slice(base)
    // winner = createdAt 最新非淘汰(91003,62-05 D-06 mtime 规则;**勿断组内第一个**)
    const winnerPatches = patches.filter((c) => c.body.isPrimaryView === true)
    expect(winnerPatches).toHaveLength(1)
    expect(winnerPatches[0].path).toBe('/api/v1/assets-registry/91003')
    expect(winnerPatches[0].body).toEqual({ isPrimaryView: true, state: 'active' })
    // 其余待选全淘汰(91001 含被取消选定的原 winner——按待选语义正确入淘汰集)
    for (const id of ['91001', '91002']) {
      const p = patches.find((c) => c.path.endsWith(`/${id}`))
      expect(p.body).toEqual({ isPrimaryView: false, state: 'eliminated' })
    }

    // HIER-04/D-07 负向:scene 手动组零 PATCH(跳过非静默,由 toast 明示)
    expect(await patchCallsFor(page, [91004, 91005])).toHaveLength(0)

    // 汇总 toast(UI-SPEC §Copywriting 逐字;跳过后缀 M>0 才追加——M=1 在场)
    await expect(page.getByText('批量选定完成 · 1 组（跳过 1 个手动选择组）', { exact: true }))
      .toBeVisible({ timeout: 5_000 })

    // 执行后清选择集(批量条退场);本用例未注入画布组 → D-05 零调用(负向)
    await expect(page.locator('[data-testid="hier-batch-bar"]')).toHaveCount(0)
    expect(await selectWinnerCalls(page)).toHaveLength(0)
    expect(await searchCallCount(page)).toBe(searchBefore) // 无 reload(逐项乐观更新)
  })

  test('batch-eliminate-arm-confirm: 二击武装执行 + winner 行零 PATCH(负向)', async ({ page }) => {
    await loadHierarchy(page)

    const eliminateBtn = page.locator('[data-testid="hier-batch-eliminate"]')
    // 勾选 char 组(已有 winner 91001 + 待选 91002/91003)+ scene 组(待选 91004/91005)
    await page.locator(`[data-testid="hier-group-check"][data-group-key="${CHAR_KEY}"]`).check()
    await page.locator(`[data-testid="hier-group-check"][data-group-key="${SCENE_KEY}"]`).check()
    await expect(page.getByText('已选 2 组')).toBeVisible()

    // 首击:只武装不发请求(data-armed 属性断言 + 确认文案逐字)
    await eliminateBtn.click()
    await expect(eliminateBtn).toHaveAttribute('data-armed', 'true')
    await expect(eliminateBtn).toHaveText('确认淘汰 2 组待选？')
    // 武装期零 PATCH(arm 不产生网络副作用)
    await page.waitForTimeout(300)
    expect((await patchCallsFor(page, [91001, 91002, 91003, 91004, 91005])).length).toBe(0)

    // 5s 自动解除(62-05 armed 状态机子断言):armed=false + 文案复原,选择集不动
    await page.waitForTimeout(5_500)
    await expect(eliminateBtn).toHaveAttribute('data-armed', 'false')
    await expect(eliminateBtn).toHaveText('批量淘汰')
    await expect(page.getByText('已选 2 组')).toBeVisible()

    // 重武装 + 二击执行
    await eliminateBtn.click()
    await expect(eliminateBtn).toHaveAttribute('data-armed', 'true')
    await eliminateBtn.click()

    // 完成门:两组待选成员 4 条全 PATCH eliminated
    await expect
      .poll(async () => (await patchCallsFor(page, [91002, 91003, 91004, 91005])).length, { timeout: 10_000 })
      .toBe(4)
    const patches = await patchCallsFor(page, [91002, 91003, 91004, 91005])
    expect(patches.map((c) => c.path.split('/').pop()).sort()).toEqual(['91002', '91003', '91004', '91005'])
    for (const c of patches) expect(c.body).toEqual({ state: 'eliminated' })

    // 负向:已有 winner 组的 winner 行零 PATCH(91001 全程未被触碰)
    expect(await patchCallsFor(page, [91001])).toHaveLength(0)
    // 负向:批量淘汰无 winner 选定语义 → D-05 select-winner 零调用
    expect(await selectWinnerCalls(page)).toHaveLength(0)

    // 汇总 toast 逐字 + 执行后清选择集
    await expect(page.getByText('批量淘汰完成 · 2 组共 4 个待选已淘汰', { exact: true }))
      .toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-testid="hier-batch-bar"]')).toHaveCount(0)
    // 终态计数:char sel=1/elim=2(winner 不动)、scene elim=2(手动组不豁免批量淘汰)
    await expect
      .poll(async () => groupCounts(page, CHAR_KEY), { timeout: 8_000 })
      .toEqual({ sel: 1, pend: 0, elim: 2 })
    await expect
      .poll(async () => groupCounts(page, SCENE_KEY), { timeout: 8_000 })
      .toEqual({ sel: 0, pend: 0, elim: 2 })
  })

  test('manual-chip-placement: ✋ 手动 chip 仅场景/声纹组 2 枚(负向)', async ({ page }) => {
    await loadHierarchy(page)

    // 全页恰 2 枚,且分别落位场景组/声纹组(条件渲染保证;非手动组零存在)
    expect(await page.locator('[data-testid="hier-manual-chip"]').count()).toBe(2)
    await expect(page.locator(`[data-testid="hier-group"][data-group-key="${SCENE_KEY}"] [data-testid="hier-manual-chip"]`))
      .toBeVisible()
    await expect(page.locator(`[data-testid="hier-group"][data-group-key="${VOICE_KEY}"] [data-testid="hier-manual-chip"]`))
      .toBeVisible()
    for (const key of [CHAR_KEY, KEYFRAME_KEY]) {
      expect(await page.locator(`[data-testid="hier-group"][data-group-key="${key}"] [data-testid="hier-manual-chip"]`).count()).toBe(0)
    }
    // 单件桶(media/text)不带手动 chip(桶无组层决策面)
    expect(await page.locator('[data-testid="hier-singletons"] [data-testid="hier-manual-chip"]').count()).toBe(0)
    // chip title 逐字(D-07 语义串)
    const title = await page.locator(`[data-testid="hier-group"][data-group-key="${SCENE_KEY}"] [data-testid="hier-manual-chip"]`)
      .getAttribute('title')
    expect(title).toBe('场景/声纹不参与批量选定 · 需逐组手动选择')
  })

  test('vg-chip-nav: 画布组 chip 唯一在场 → 点击切画布 + 变体墙开', async ({ page }) => {
    await loadHierarchy(page, { injectVg: true })

    // 唯一命中:char 组 primary=91001 ∈ vg-e2e-1 → hier-group-vg 恰 1 枚(其余组走
    // 「去画布选片 →」降级文案,负向互证)
    const vgChip = page.locator('[data-testid="hier-group-vg"][data-vg-id="vg-e2e-1"]')
    await expect(vgChip).toBeVisible()
    expect(await page.locator('[data-testid="hier-group-vg"]').count()).toBe(1)
    expect(await page.locator(`[data-testid="hier-group"][data-group-key="${SCENE_KEY}"]`).getByText('去画布选片 →').count()).toBe(1)

    // 点击 → openWallByGroup + setViewMode('canvas'):
    //  - 视图切换:ReactFlow 挂载 + AssetManager(含 hierarchy-view)卸载
    //  - 变体墙:variant-wall DOM 在场且组 id 对上(openWallByGroup 侧效;wall 为
    //    fixed 覆盖层,FlowCanvas 根级挂载,不随视图门控)
    await vgChip.click()
    await page.waitForSelector('.react-flow__pane', { timeout: 15_000 })
    await expect(page.locator('[data-testid="hierarchy-view"]')).toHaveCount(0)
    const wall = page.locator('[data-testid="variant-wall"]')
    await expect(wall).toBeVisible({ timeout: 5_000 })
    await expect(wall).toHaveAttribute('data-wall-group-id', 'vg-e2e-1')
    // canonical 对照:store 图仍持 vg-e2e-1(getGraph 只读桥;两成员节点在图)
    const graphOk = await page.evaluate(() => {
      const g = window.__kaisCanvas?.getGraph()
      const vg = (g?.variantGroups ?? []).find((x) => x.id === 'vg-e2e-1')
      return vg != null && vg.variantNodeIds.includes('asset-91001') && vg.variantNodeIds.includes('asset-91002')
    })
    expect(graphOk).toBe(true)
  })
})
