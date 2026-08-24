import { test, expect } from '../helpers.mjs'

/**
 * Phase 62-07 Task 1 — phase62-hierarchy e2e(八用例)。
 *
 * 用例地图(-g 组词,62-07 PLAN Task 1):
 *  1 tab-fifth-reachable       : 第 5 Tab 可达;5 Tab 全在场(回归锚);根 testid + 三域节点。
 *  2 domain-counts-aggregate   : 三 hier-domain-node data-count-* = rich fixture 手算聚合;
 *                                reportAudit 成员计入所在域 total(D-03 计入面)。
 *  3 group-derivation          : 已知组键逐一可见 + 组卡 data-count-* 三态对表
 *                                (char concept/scene/voice/keyframe;voice 组键=char:{id}:voice)。
 *  4 d04-cross-source-consistency: 层级 DOM data-count-pending ≡ 测试侧从
 *                                window.__kaisCanvas.getGraph() 按 model.ts:937 公式计算的
 *                                candidates(D-04 跨源契约;零 DAG 卡片 DOM 依赖)。
 *  5 singletons-bucket         : 单件桶仅 size=1 非 reportAudit 成员(uuid 清单);reportAudit
 *                                资产卡不在任何桶;空桶(setting)整卡不渲染。
 *  6 collapse-toggle           : 单组 data-collapsed true/false 往返 + 折叠全部/展开全部。
 *  7 phase-badge               : 徽标文本 ^P\d{2}$;meta 直读(keyframe P09)vs 推导
 *                                (P04/P11)tooltip 可辨(D-01 锁)。
 *  8 library-untouched(负向)    : 切回资产库,既有断言面(.am-tree/.am-scope/.am-groups/
 *                                data-group-key)原样;层级专属面清零。
 *
 * ⚠️ 地雷 #10:e2e 跑 dist——运行本文件前必须 `npm run build`(packages/infinite-canvas),
 *    否则测的是旧构建产物。
 *
 * D-04 断言形态(62-07 plan 裁定 9,逐字落地):
 *  层级 DOM `data-count-pending` ≡ 测试侧从 window.__kaisCanvas.getGraph() 读节点按
 *  model.ts:937 公式(candidates = total - selected - eliminated;curation 桶语义
 *  curationBucket model.ts:193-204)计算的计数——两侧派生代码(AssetHierarchy 判定式 /
 *  model.ts)都不改,对齐靠 fixture 双 mock(assets-registry rich preset + save-v2 注入同
 *  curation 的 a-* 节点)。不读 DAG 卡片 DOM(脆断言面),跨源契约由「UI DOM ↔ canonical
 *  图计算」锁定。对照集 = fixture 注入的 a-* 节点(nodeMatchesDag artifactsOnly 默认 a-*
 *  前缀口径;迁移合成的 evt_* 节点无 a- 前缀不入集)。
 *
 * rich fixture 期望表(62-03 buildRichFixture 12 条 + 62-05 自动初始化稳态;
 * 组键对齐 62-01 getGroupKey 词表):
 *  ⚠️ 62-05(D-06):AssetLibrary 挂载即自动初始化——无 ★ 的非场景/非声纹组自动
 *  PATCH mtime 最新成员 isPrimaryView=true(goto#2 经 library 默认视图,goto 的
 *  networkidle 保证 PATCH+reload 链完成,层级断言面为稳态)。HIER-04 锚:「每组仍
 *  恰一 winner」+ 场景/声纹组零自动选定(checker FLAG 3,62-07 裁定)。
 *   组键                       域        sel/pend/elim/total  备注
 *   char:shenzhiyi:concept    setting   1/2/0/3              91001 ★(fixture,不重选)
 *   scene:宴会厅               setting   0/2/0/2              手动组·零自动选定(负向)
 *   char:shenzhiyi:voice      media     0/2/0/2              meta.subtype='voice_print'
 *                                                       才达键;手动组·零自动选定(负向)
 *   keyframe:S01:S01_first    setting   1/1/0/2              自动 winner=91009(mtime 最新)
 *   单件桶 media = [e2e-rich-91010(video:SH01,自动★,P11 推导)];text = [e2e-rich-91011
 *   (outline,fixture ★,subtype unknown 无徽标)];91012(document,自动★,P13 meta 直读)
 *   为 reportAudit——不进桶、层级视图零卡片渲染,仅计入域 total(D-03)。
 *   域聚合(setting 2/5/0 sum=7 · media 2/2/0 sum=4 含 91012 · text 1/0/0 sum=1;
 *   全量 5/7/0 sum=12)。
 *
 *   修复记录(62-07 Task A,orchestrator 裁定走 src 修复非 fixture 规避):前置版曾钉
 *   「91012 在 media 桶」现状——reportAudit 对该样本不可达的根因有二:① inferSubtype
 *   无 type='document' 分支且 metaSub='delivery_package' 不在 Notion 短路表(subtype
 *   'unknown' 不入表);② assetPhaseOf meta 直读早退硬编码 reportAudit:false。已修:
 *   inferSubtype 补 delivery_package 短路键 + type='document' 兜底(assetManagerData.ts,
 *   AssetItem 镜像函数同改保持等价),assetPhaseOf 的 reportAudit 改为恒由
 *   PHASE_BY_SUBTYPE 查表决定(groupCanvasLinkage.ts;徽标文案/来源仍 meta 优先,D-01
 *   语义不变)——91012 现查表得 P13+reportAudit:true,本文件按 D-03 原意断言负向面。
 */

const HIER_URL = `/?${new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' }).toString()}`

/** D-04 对照集:3 个 a-character_design-* 节点(id 前缀命中 DAG def character-design-images
 *  的 idPrefix 'a-character_design-' 口径;1 selected + 2 candidate),与 char:shenzhiyi:concept
 *  组的 o_assets 计数(★1 ○2)按 fixture 设计对齐。 */
const D04_NODE_IDS = ['a-character_design-e2e-1', 'a-character_design-e2e-2', 'a-character_design-e2e-3']

/** D-04 注入图:save-v2 全量替换 mock canvas(REGEN-01-c 注入范式)。winner 三通道冗余
 *  (顶层 isWinner → migrate §14 curation:'selected';data.isPrimaryView/curation/curationState
 *  → raw sidecar 穿透)——任一存活即 selected 桶,migrate 形状演进不脆断。 */
async function injectD04Graph(page) {
  const node = (id, { winner = false } = {}) => ({
    id,
    type: 'asset',
    position: { x: 120, y: 120 + D04_NODE_IDS.indexOf(id) * 220 },
    size: { width: 240, height: 160 },
    state: 'success',
    phaseIndex: 4,
    phaseName: 'P04 · 角色设定图',
    ...(winner ? { isWinner: true } : {}),
    data: {
      label: `角色设定图 e2e ${id}`,
      type: 'asset',
      ...(winner
        ? { isPrimaryView: true, curation: 'selected', curationState: 'selected' }
        : { curationState: 'candidate' }),
    },
  })
  await page.request.post('/api/canvas/v2/save-v2', {
    data: {
      projectId: 1,
      episodesId: 1,
      graph: {
        meta: { projectId: 1, episodesId: 1 },
        nodes: [
          node(D04_NODE_IDS[0], { winner: true }),
          node(D04_NODE_IDS[1]),
          node(D04_NODE_IDS[2]),
        ],
        links: [],
        groups: [],
        variantGroups: [],
      },
    },
  })
}

/** 层级用例起点(61-01 loadAssetCenter 先例 + 追加一步,UI-SPEC D-13):
 *  goto + 显式 reset → (可选)save-v2 注入图 → POST /__mock/config { assetFixture:'rich' }
 *  (配置在 reset 后注入,防被清)→ 重 goto(默认 library 视图挂载触发 62-05 自动初始化;
 *  networkidle 收口 PATCH+reload 链)→ 点「资产层级」→ 等 hierarchy-view + 首组卡可见
 *  → 自动初始化稳态门(★=5:concept★fixture + keyframe/video/doc 自动 + outline★fixture
 *  ——HIER-04「每组仍恰一 winner」FLAG 3 锚;破坏自动初始化/豁免规则即此处红)。 */
async function loadHierarchy(page, { injectGraph = false } = {}) {
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  if (injectGraph) await injectD04Graph(page)
  await page.request.post('/__mock/config', { data: { assetFixture: 'rich' } })
  await page.goto(HIER_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '资产层级', exact: true }).click()
  await expect(page.locator('[data-testid="hierarchy-view"]')).toBeVisible()
  await expect(page.locator('[data-testid="hier-group"]').first()).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => page.evaluate(() =>
      document.querySelector('[data-testid="hier-all-node"] [data-count-selected]')?.getAttribute('data-count-selected') ?? null),
      { timeout: 15_000 })
    .toBe('5')
}

test.describe('phase62-hierarchy 资产层级', () => {
  test('tab-fifth-reachable: 第 5 Tab 可达 + is-on 切换 + 域固定纲', async ({ page }) => {
    await loadHierarchy(page)

    // 5 Tab 全在场(既有 4 Tab 回归锚 + 新第 5 Tab)
    await expect(page.locator('.am-tab')).toHaveCount(5)
    for (const label of ['资产库', '角色管理', '场景管理', '创作文档', '资产层级']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    // 资产层级 is-on 可切换:切走再切回,层级根 testid 随之卸载/重挂
    const hierTab = page.getByRole('button', { name: '资产层级', exact: true })
    await expect(hierTab).toHaveClass(/is-on/)
    await page.getByRole('button', { name: '资产库', exact: true }).click()
    await expect(page.locator('[data-testid="hierarchy-view"]')).toHaveCount(0)
    await hierTab.click()
    await expect(page.locator('[data-testid="hierarchy-view"]')).toBeVisible()

    // 根 testid + 「全部」节点 + 三域节点固定纲(setting/media/text)
    await expect(page.locator('[data-testid="hier-all-node"]')).toBeVisible()
    for (const dom of ['setting', 'media', 'text']) {
      await expect(page.locator(`[data-testid="hier-domain-node"][data-domain="${dom}"]`)).toBeVisible()
    }
  })

  test('domain-counts-aggregate: 三域计数 = rich fixture 手算聚合(reportAudit 计入)', async ({ page }) => {
    await loadHierarchy(page)

    const snap = await page.evaluate(() => {
      const domains = {}
      for (const el of document.querySelectorAll('[data-testid="hier-domain-node"]')) {
        const read = () => ({
          sel: Number(el.getAttribute('data-count-selected')),
          pend: Number(el.getAttribute('data-count-pending')),
          elim: Number(el.getAttribute('data-count-eliminated')),
        })
        domains[el.getAttribute('data-domain')] = read()
      }
      const all = document.querySelector('[data-testid="hier-all-node"]')
      return {
        domains,
        all: {
          sel: Number(all.querySelector('[data-count-selected]').getAttribute('data-count-selected')),
          pend: Number(all.querySelector('[data-count-pending]').getAttribute('data-count-pending')),
          elim: Number(all.querySelector('[data-count-eliminated]').getAttribute('data-count-eliminated')),
        },
      }
    })

    // 三域固定纲齐全
    expect(Object.keys(snap.domains).sort()).toEqual(['media', 'setting', 'text'])

    // 期望表(头部注释手算,62-05 自动初始化稳态):setting 91001★/91009★ +
    // 91002/91003/91004/91005/91008;media 91006/91007(voice 豁免)+ 91010★/91012★;
    // text 91011★。三态和 = 域 total(域节点无 data-count-total 属性,以三态和互证 total)。
    expect(snap.domains.setting).toEqual({ sel: 2, pend: 5, elim: 0 })
    expect(snap.domains.media).toEqual({ sel: 2, pend: 2, elim: 0 })
    expect(snap.domains.text).toEqual({ sel: 1, pend: 0, elim: 0 })
    // D-03 计入面:media 三态和 4 = voice×2 + video + delivery_package(91012 无论
    // 是否 reportAudit 均计入域计数;若被错误排除于域聚合,sel+pend 将为 3 → 此处红)。
    expect(snap.domains.media.sel + snap.domains.media.pend + snap.domains.media.elim).toBe(4)
    expect(snap.domains.setting.sel + snap.domains.setting.pend + snap.domains.setting.elim).toBe(7)
    expect(snap.domains.text.sel + snap.domains.text.pend + snap.domains.text.elim).toBe(1)

    // 「全部」节点 = 全量聚合(12 条:★5——concept/keyframe/video/doc/outline 各恰一
    // winner;场景/声纹组零自动选定)
    expect(snap.all).toEqual({ sel: 5, pend: 7, elim: 0 })
  })

  test('group-derivation: 组卡按 getGroupKey 派生 + 三态计数对表', async ({ page }) => {
    await loadHierarchy(page)

    const groups = await page.evaluate(() => {
      const out = {}
      for (const el of document.querySelectorAll('[data-testid="hier-group"]')) {
        out[el.getAttribute('data-group-key')] = {
          sel: Number(el.getAttribute('data-count-selected')),
          pend: Number(el.getAttribute('data-count-pending')),
          elim: Number(el.getAttribute('data-count-eliminated')),
          total: Number(el.getAttribute('data-count-total')),
        }
      }
      return out
    })

    // 互斥组恰 4 个(size≥2 组;单件走桶);组键词表逐一钉死——voice 组键 =
    // char:{id}:voice(经 meta.subtype='voice_print' 到达,非 char:shenzhiyi 混编)
    expect(Object.keys(groups).sort()).toEqual([
      'char:shenzhiyi:concept',
      'char:shenzhiyi:voice',
      'keyframe:S01:S01_first',
      'scene:宴会厅',
    ].sort())

    // 组内三态数对表(头部注释期望表,62-05 自动初始化稳态)
    expect(groups['char:shenzhiyi:concept']).toEqual({ sel: 1, pend: 2, elim: 0, total: 3 })
    // HIER-04 负向(checker FLAG 3):场景组/声纹组零自动选定(sel 恒 0)
    expect(groups['scene:宴会厅']).toEqual({ sel: 0, pend: 2, elim: 0, total: 2 })
    expect(groups['char:shenzhiyi:voice']).toEqual({ sel: 0, pend: 2, elim: 0, total: 2 })
    // keyframe:S01:S01_first = S01_first_v1/_v2 剥 _v 后同键(不分帧混组);
    // 自动 winner = 91009(createdAt 最新,D-06 mtime 规则)——「每组仍恰一 winner」锚
    expect(groups['keyframe:S01:S01_first']).toEqual({ sel: 1, pend: 1, elim: 0, total: 2 })

    // 负向:voice 未并进 concept 组(concept total 恰 3,不含 91006/91007)
    expect(groups['char:shenzhiyi:concept'].total).toBe(3)
  })

  test('d04-cross-source-consistency: DOM data-count-pending ≡ getGraph() :937 公式计算(D-04)', async ({ page }) => {
    await loadHierarchy(page, { injectGraph: true })

    // canonical 图含注入节点(load-v2 → adapt/migrate → setGraph;id 经迁移保持)
    await expect
      .poll(async () => page.evaluate((ids) => {
        const ns = window.__kaisCanvas?.getGraph()?.nodes ?? []
        return ids.filter((id) => ns.some((n) => n.id === id)).length
      }, D04_NODE_IDS), { timeout: 15_000 })
      .toBe(3)

    // 测试侧计算:curationBucket 语义(model.ts:193-204)逐节点分桶 + :937 公式
    // candidates = total - selected - eliminated。读取形状兼容 V3 store 图节点
    // (顶层 curation;getGraph() 投影)与 RF 视图模型节点(data.v3.curation)——两投影
    // 同源(graphToViewModel 直嵌 AssetNodeV3),curation 读值等价。
    const graphCounts = await page.evaluate((ids) => {
      const nodes = (window.__kaisCanvas?.getGraph()?.nodes ?? []).filter((n) => ids.includes(n.id))
      const bucketOf = (n) => {
        const data = n.data && typeof n.data === 'object' ? n.data : {}
        const v3 = data.v3 && typeof data.v3 === 'object' ? data.v3 : null
        const curation = n.curation ?? v3?.curation ?? data.curation
        const curationState = data.curationState
        if (curation === 'selected' || curationState === 'selected') return 'selected'
        if (data.isPrimaryView === true || v3?.isPrimaryView === true) return 'selected'
        if (curation === 'deprecated' || curationState === 'eliminated') return 'eliminated'
        if (curationState === 'candidate' || curationState === 'active') return 'candidate'
        return 'neutral' // migrate 默认 candidate 占位:not 显式待选,但 :937 公式仍计入 candidates
      }
      const buckets = nodes.map(bucketOf)
      const selected = buckets.filter((b) => b === 'selected').length
      const eliminated = buckets.filter((b) => b === 'eliminated').length
      return {
        total: nodes.length,
        selected,
        eliminated,
        candidates: Math.max(0, nodes.length - selected - eliminated),
      }
    }, D04_NODE_IDS)

    // DOM 侧:o_assets rich preset 派生的组卡计数(属性断言,非 innerText)
    const domEl = page.locator('[data-testid="hier-group"][data-group-key="char:shenzhiyi:concept"]')
    await expect(domEl).toBeVisible()
    const domCounts = {
      pend: Number(await domEl.getAttribute('data-count-pending')),
      sel: Number(await domEl.getAttribute('data-count-selected')),
      elim: Number(await domEl.getAttribute('data-count-eliminated')),
    }

    // D-04 跨源契约本体:两侧派生代码零改动,DOM ≡ 图计算。另钉 fixture 对齐值
    // (1/2/0——防两侧同向漂移双双相等的假绿)。
    expect(graphCounts.total).toBe(3)
    expect(graphCounts.selected).toBe(1)
    expect(graphCounts.eliminated).toBe(0)
    expect(graphCounts.candidates).toBe(domCounts.pend)
    expect(graphCounts.selected).toBe(domCounts.sel)
    expect(graphCounts.eliminated).toBe(domCounts.elim)
    expect(domCounts).toEqual({ sel: 1, pend: 2, elim: 0 })
  })

  test('singletons-bucket: 桶内 size=1 非 reportAudit 成员清单钉死(D-03 排除面负向)', async ({ page }) => {
    await loadHierarchy(page)

    const snap = await page.evaluate(() => {
      const bucketOf = (dom) => {
        const el = document.querySelector(`[data-testid="hier-singletons"][data-domain="${dom}"]`)
        return el
          ? [...el.querySelectorAll('.am-card')].map((c) => c.getAttribute('data-uuid'))
          : null
      }
      return {
        media: bucketOf('media'),
        text: bucketOf('text'),
        settingBucketCount: document.querySelectorAll('[data-testid="hier-singletons"][data-domain="setting"]').length,
        deliveryCardInHierarchyCount: document.querySelectorAll('.am-card[data-uuid="e2e-rich-91012"]').length,
      }
    })

    // 桶内 uuid 清单断言(修复后 D-03 原意):media = video:SH01(91010)——91012 为
    // reportAudit(inferSubtype 'delivery_package' → PHASE_BY_SUBTYPE P13+reportAudit,
    // 见头部修复记录),不进桶;text = outline(91011)
    expect(snap.media).toEqual(['e2e-rich-91010'])
    expect(snap.text).toEqual(['e2e-rich-91011'])
    // setting 域无 size=1 组 → 空桶整卡不渲染(C3「桶空则整卡不渲染」)
    expect(snap.settingBucketCount).toBe(0)
    // D-03 双面闭环·排除侧:reportAudit 资产卡在层级视图全页零渲染(无组卡/无桶卡);
    // 计入侧由用例 2 锁定(media 三态和=4 含 91012)。
    expect(snap.deliveryCardInHierarchyCount).toBe(0)
  })

  test('collapse-toggle: 单组折叠往返 + 折叠全部/展开全部', async ({ page }) => {
    await loadHierarchy(page)

    // 首组(setting 域序首 = char:shenzhiyi:concept)默认展开 → 折叠 → 复原
    const firstGroup = page.locator('[data-testid="hier-group"]').first()
    await expect(firstGroup).toHaveAttribute('data-group-key', 'char:shenzhiyi:concept')
    await expect(firstGroup).toHaveAttribute('data-collapsed', 'false')
    await firstGroup.locator('.am-tree-toggle').click()
    await expect(firstGroup).toHaveAttribute('data-collapsed', 'true')
    await firstGroup.locator('.am-tree-toggle').click()
    await expect(firstGroup).toHaveAttribute('data-collapsed', 'false')

    // 折叠全部 → 全部 4 组 data-collapsed="true";展开全部 → 复原全 false
    await page.locator('[data-testid="hier-collapse-all"]').click()
    await expect(page.locator('[data-testid="hier-group"][data-collapsed="true"]')).toHaveCount(4)
    await page.locator('[data-testid="hier-expand-all"]').click()
    await expect(page.locator('[data-testid="hier-group"][data-collapsed="false"]')).toHaveCount(4)
    await expect(page.locator('[data-testid="hier-group"][data-collapsed="true"]')).toHaveCount(0)
  })

  test('phase-badge: 徽标 ^P\\d{2}$ + meta 直读/推导 tooltip 可辨(D-01)', async ({ page }) => {
    await loadHierarchy(page)

    // 全部徽标(组头 hier-group-phase + 单件卡 hier-card-phase)文本均 ^P\d{2}$
    // (T-62-12 直读白名单 + PHASE_BY_SUBTYPE 查表两路产物都受检):
    // 4 组头(char P04 推导/scene P07 推导/voice P10 推导/keyframe P09 直读)
    // + 1 单件卡(video P11 推导;91012 reportAudit 不渲染卡,D-03——徽标数=5)
    const badges = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="hier-group-phase"], [data-testid="hier-card-phase"]')]
        .map((el) => el.textContent.trim()))
    expect(badges.length).toBe(5)
    for (const t of badges) expect(t).toMatch(/^P\d{2}$/)

    // 推导样本(单件卡):91010 video → P11(video_clips 查表),tooltip「按子类型推导」
    // (media 桶修复后仅此一卡)
    const cardBadge = page.locator('.am-card[data-uuid="e2e-rich-91010"] [data-testid="hier-card-phase"]')
    await expect(cardBadge).toHaveText('P11')
    await cardBadge.hover()
    expect(await cardBadge.getAttribute('title')).toBe('按子类型推导')

    // meta 直读样本(组头):keyframe 组 meta.phaseCode='P09' 直读优先于查表
    // (直读路径 reportAudit 解耦见头部修复记录——直读只接管文案,不影响排除面)
    const kfBadge = page.locator('[data-testid="hier-group"][data-group-key="keyframe:S01:S01_first"] [data-testid="hier-group-phase"]')
    await expect(kfBadge).toHaveText('P09')
    await kfBadge.hover()
    expect(await kfBadge.getAttribute('title')).toBe('资产 meta 直读')

    // 推导样本(组头):char 组 → P04(查表;viewAngle=front → turnaround_view 同为 P04)
    const charBadge = page.locator('[data-testid="hier-group"][data-group-key="char:shenzhiyi:concept"] [data-testid="hier-group-phase"]')
    await expect(charBadge).toHaveText('P04')
    await charBadge.hover()
    expect(await charBadge.getAttribute('title')).toBe('按子类型推导')

    // 负向:outline 单件(91011,subtype unknown 不在表)无徽标
    expect(await page.locator('[data-testid="hier-singletons"][data-domain="text"] [data-testid="hier-card-phase"]').count()).toBe(0)
  })

  test('library-untouched: 切回资产库既有断言面原样(负向)', async ({ page }) => {
    await loadHierarchy(page)

    // 从层级视图切回资产库
    await page.getByRole('button', { name: '资产库', exact: true }).click()

    // 层级专属面清零(负向)
    await expect(page.locator('[data-testid="hierarchy-view"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="hier-domain-node"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="hier-all-node"]')).toHaveCount(0)
    // 批量条/手动 chip 不出现在资产库视图(62-05 面负向锚,库视图零扰动)
    await expect(page.locator('[data-testid="hier-batch-bar"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="hier-manual-chip"]')).toHaveCount(0)

    // 既有断言面原样(选择器与 61-debt 同源):四级层级树 / 三态 tab(可交互) /
    // 组容器(.am-groups 仅待选 tab 渲染——AssetLibrary:1272 既有门控,先切 tab) /
    // data-group-key / 资产卡全套
    await expect(page.locator('.am-tree').first()).toBeVisible()
    await expect(page.locator('.am-scope')).toBeVisible()
    await page.locator('.am-scope button', { hasText: '待选资产' }).click()
    await expect(page.locator('.am-groups').first()).toBeVisible()
    expect(await page.locator('.am-group[data-group-key]').count()).toBeGreaterThan(0)
    expect(await page.locator('.am-card[data-uuid]').count()).toBeGreaterThan(0)
    expect(await page.locator('.am-card__locate').count()).toBeGreaterThan(0)
  })
})
