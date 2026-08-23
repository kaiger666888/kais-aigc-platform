import { test, expect, loadCanvas, nodeSelector, getCalls, getMockState, setSelectedNodeIds, switchToCanvasView } from '../helpers.mjs'

/**
 * Phase 59-04 — STALE-01/02/03 + SC4: 窄触发 stale 级联 e2e(mock 回放 59-02 服务端契约)
 *
 * 覆盖(SC1-SC4,命名含组词供 -g panel / reroll / orchestrate / rerun-clears 过滤):
 *  - SC1 (STALE-01): 面板配方重生成成功 → 下游 svg[aria-label="stale"] 实时出现
 *    (无 page.reload,FLAG-1 Option A 验收)→ getGraph() 链尾 stale.triggerAssetId
 *    仍指向触发资产(D-03 传递闭包链起点保持);触发节点自身无角标(新事实起点)。
 *  - SC2 (STALE-02): 事件芯片换 seed 重跑 → getCalls 断言 body.regenSource
 *    === 'reroll-seed' 且 body.params.seed 为数字 → 该资产下游角标实时出现,
 *    兄弟分支与上游不受波及。
 *  - SC3 (STALE-03 负向): 全量 orchestrate + 无 regenSource execute(ContextMenu
 *    形状)成功后角标计数不变;getMockState 复核 mock 画布零 data.stale 新写;
 *    末尾正向对照(同节点带 regenSource 重生成角标出现)防 socket 死假绿。
 *  - SC4: SC1 前置产生角标后,双出口消除——面板 [data-testid="stale-rerun-btn"]
 *    (down-1 独立叶子)与角标 click(mid-1 链头)各等 orchestrate 子集
 *    node:state success → 角标 toHaveCount(0)(52-01 链);无下游关系的节点全程无角标。
 *
 * ⚠️ 前置纪律(地雷 #10):e2e 跑 dist 非源码——运行本文件前必须 `npm run build`
 *    (packages/infinite-canvas),否则测的是旧构建产物。
 *
 * fixture 注入(58-03 范式:每用例 resetMock 后 save-v2 注入再 reload):
 *  - 拓扑: trig-1 ──┬─→ mid-1 ─→ down-2   (传递闭包链:SC1 链尾断言 + SC2 芯片
 *    (storyboard)   │   (storyboard)        evt_mid-1 的产出资产 mid-1 有下游)
 *                  └─→ down-1              (独立叶子:SC4 出口1 可单独消除)
 *  - unrel-1(audio,零连接)——无下游关系节点全程无角标的负向锚。
 *  - 芯片可见性(P19):evt_* 芯片挂在折叠资产边(asset→event→asset 折叠),故
 *    trig-1(无上游)自身无芯片——SC2 用 evt_mid-1(边 trig-1→mid-1 上)。
 *  - links 为 image 因果边;migrate 合成 evt_<id> 事件链,与 mock 回放 BFS 的
 *    下游集合一致(双端幂等收敛前提)。
 *
 * mock 回放契约(mock-backend/server.mjs Phase 59 段):execute body 含
 * regenSource 时,success 广播前逐下游节点 broadcast node:updated
 * { projectId, episodesId, node, changedFields:["data.stale"] }(scope 字段
 * 为 CR-02 修复上 wire)——客户端(59-03)scope 守卫 + 轻校验后
 * triggerStaleCascade 复用既有角标/脉动/StaleSection/useStaleRerun 全链。
 * 脉动不断言(decorative,flake-bait——UI-SPEC §2)。
 */

const TRIG = 'trig-1'
const MID = 'mid-1'
const DOWN_A = 'down-1'
const DOWN_B = 'down-2'
const UNREL = 'unrel-1'
const PID = 1
const EID = 1

/** 级联 fixture:触发资产 + 链式下游(mid-1→down-2)+ 独立叶子 + 无关节点。 */
function cascadeFixtureGraph() {
  return {
    nodes: [
      {
        id: TRIG, type: 'storyboard',
        position: { x: 400, y: 50 }, size: { width: 260, height: 180 },
        data: {
          label: '触发资产', type: 'storyboard', storyboardId: 91, duration: 3,
          prompt: '触发配方', filePath: null, thumbnailUrl: null, state: 'idle',
        },
        state: 'idle',
      },
      {
        id: MID, type: 'storyboard',
        position: { x: 220, y: 420 }, size: { width: 260, height: 180 },
        data: {
          label: '链中资产', type: 'storyboard', storyboardId: 92, duration: 3,
          prompt: '链中配方', filePath: null, thumbnailUrl: null, state: 'idle',
        },
        state: 'idle',
      },
      {
        id: DOWN_B, type: 'storyboard',
        position: { x: 220, y: 780 }, size: { width: 260, height: 180 },
        data: {
          label: '链尾资产', type: 'storyboard', storyboardId: 93, duration: 3,
          prompt: '链尾配方', filePath: null, thumbnailUrl: null, state: 'idle',
        },
        state: 'idle',
      },
      {
        id: DOWN_A, type: 'storyboard',
        position: { x: 700, y: 420 }, size: { width: 260, height: 180 },
        data: {
          label: '独立下游', type: 'storyboard', storyboardId: 94, duration: 3,
          prompt: '独立配方', filePath: null, thumbnailUrl: null, state: 'idle',
        },
        state: 'idle',
      },
      {
        id: UNREL, type: 'audio',
        position: { x: 700, y: 780 }, size: { width: 260, height: 180 },
        data: { label: '无关节点', type: 'audio', audioId: 9, filePath: null, thumbnailUrl: null, state: 'idle' },
        state: 'idle',
      },
    ],
    links: [
      { id: 'cl1', source: TRIG, target: MID, data: { dataType: 'image' } },
      { id: 'cl2', source: MID, target: DOWN_B, data: { dataType: 'image' } },
      { id: 'cl3', source: TRIG, target: DOWN_A, data: { dataType: 'image' } },
    ],
    groups: [],
    variantGroups: [],
  }
}

/** 注入级联 fixture 并 reload(load-v2 → migrate 合成 evt_ 事件链)。 */
async function injectCascadeFixture(page) {
  await page.request.post('/api/canvas/v2/save-v2', {
    data: { projectId: PID, episodesId: EID, graph: cascadeFixtureGraph() },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await switchToCanvasView(page)
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

/** 打开节点详情面板并等 PromptSection 渲染(phase52 同款)。 */
async function openDetailPanel(page, nodeId) {
  await page.locator(nodeSelector(nodeId)).dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })
}

/** 节点 stale 角标 locator(UI-SPEC §8 canonical 选择器,禁新增 testid)。 */
const staleBadge = (page, nodeId) => page.locator(`${nodeSelector(nodeId)} svg[aria-label="stale"]`)

/** 最近一条指定 path 的 mock 调用(getCalls 观测点;SC4 出口2 需取后一条 orchestrate)。 */
async function lastCall(page, path) {
  const calls = await getCalls(page)
  const hits = calls.filter((c) => c.path === path)
  return hits[hits.length - 1]
}

/** 等 store 编排态离开 running(useStaleRerun「编排进行中」守卫——SC4 双出口串行前提)。 */
async function waitForOrchIdle(page, timeout = 8_000) {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const st = window.__kaisCanvas?.getOrchestration?.()?.status
      return st === 'running' ? 'running' : 'idle-or-done'
    })
  }, { timeout }).toBe('idle-or-done')
}

/** 面板重生成提交(SC1/SC3/SC4 前置共用):开面板 → 点重生成(regenSource=panel-regen)。 */
async function panelRegen(page, nodeId = TRIG) {
  await openDetailPanel(page, nodeId)
  await expect(page.locator('[data-testid="prompt-regenerate"]')).toBeEnabled()
  await page.locator('[data-testid="prompt-regenerate"]').click()
}

test.describe('Phase 59-04 — STALE 窄触发级联 (SC1-SC4, mock 回放 59-02 契约)', () => {
  test('panel regen cascades stale to downstream (SC1)', async ({ page }) => {
    await loadCanvas(page)
    await injectCascadeFixture(page)

    await panelRegen(page, TRIG)

    // 请求体:regenSource 身份标识(59-03 发射 → mock logCall 完整 body 观测点)
    let exec
    await expect.poll(async () => {
      exec = await lastCall(page, '/api/canvas/execute')
      return exec?.body?.regenSource
    }, { timeout: 5_000 }).toBe('panel-regen')
    expect(exec.body.nodeId).toBe(TRIG)

    // 下游角标实时出现——全程无 page.reload()(FLAG-1 Option A 实时性验收);
    // mid-1(直接)与 down-2(经 mid-1 传递闭包,D-03)都标
    await expect(staleBadge(page, MID)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_B)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_A)).toBeVisible({ timeout: 5_000 })
    // 触发节点自身无角标(新事实起点不自标,宪法 §13)
    await expect(staleBadge(page, TRIG)).toHaveCount(0)
    // 无下游关系节点不受波及
    await expect(staleBadge(page, UNREL)).toHaveCount(0)

    // canonical 层:链尾 down-2 的 stale.triggerAssetId 仍指向触发资产
    // (传递闭包下链起点保持——trigger* 记录链条起点,宪法 §13)+ 三字段形状
    const staleTail = await page.evaluate((nid) => {
      const g = window.__kaisCanvas?.getGraph()
      return g?.nodes.find((n) => n.id === nid)?.stale ?? null
    }, DOWN_B)
    expect(staleTail).not.toBeNull()
    expect(staleTail.triggerAssetId).toBe(TRIG)
    expect(typeof staleTail.since).toBe('number')
    expect(typeof staleTail.triggerEventId).toBe('string')
  })

  test('seed reroll cascades stale and passes seed (SC2)', async ({ page }) => {
    await loadCanvas(page)
    await injectCascadeFixture(page)

    // 事件芯片 → popover → 换 seed(phase52-reroll 交互路径;选中产出资产强制
    // 芯片完整态 P19;evt_mid-1 挂在折叠边 trig-1→mid-1 上,产出资产 mid-1 有下游)。
    // 芯片挂边中点,本 fixture 布局下与节点卡重叠(nodes z 序在边之上,实体 click
    // 被 node div 截获)——对芯片内层 onClick div 直接 dispatchEvent(click)
    // (React 合成事件经 root 冒泡捕获,等价触发 handleEventChipClick)。
    await setSelectedNodeIds(page, [MID])
    const chip = page.locator(`[data-testid="edge-op-chip"][data-event-id="evt_${MID}"]`)
    await chip.first().locator('div').first().dispatchEvent('click')
    await expect(page.locator('[data-testid="event-params-popover"]')).toBeVisible()
    await page.locator('[data-testid="reroll-seed-btn"]').click()

    // 请求体:reroll-seed 身份标识 + seed 为数字(透传链 59-02 REGEN-02)
    let exec
    await expect.poll(async () => {
      exec = await lastCall(page, '/api/canvas/execute')
      return exec?.body?.regenSource
    }, { timeout: 5_000 }).toBe('reroll-seed')
    expect(typeof exec.body.params?.seed).toBe('number')
    // 59-fix WR-05:顶层 prompt 专用通道到达(CR-01 白名单后 params 袋内 prompt
    // 不再达引擎,服务端回落 extractPrompt 依赖持久化行零漂移;顶层通道使
    // 「同配方」承诺不依赖兜底巧合——NodeDetailPanel 同款双通道)。
    expect(exec.body.prompt).toBe('链中配方')
    // 产出资产 id(地雷 #4 裁定:role:'output' 反查,非 evt_*)
    expect(exec.body.nodeId).toBe(MID)
    expect(exec.body.nodeId.startsWith('evt_')).toBe(false)

    // mid-1 下游角标实时出现——无 page.reload();触发资产自身/上游/兄弟分支均无角标
    await expect(staleBadge(page, DOWN_B)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, MID)).toHaveCount(0)
    await expect(staleBadge(page, TRIG)).toHaveCount(0)
    await expect(staleBadge(page, DOWN_A)).toHaveCount(0)
  })

  test('cross-episode node:updated is scope-guarded (CR-02)', async ({ page }) => {
    await loadCanvas(page)
    await injectCascadeFixture(page)

    const badgeAll = page.locator('.react-flow__node svg[aria-label="stale"]')
    await expect(badgeAll).toHaveCount(0)

    // 同 room(project:{id})他 episode 的 stale 广播——确定性节点 id 跨 episodes
    // 复用(import-from-dir p04/a-p04-* 形态),修复前客户端无 scope 守卫会对他集
    // 广播误触发本集级联(角标出现 + 下次 save 落库脏行)。修复后 scope 不匹配
    // 静默 return:零角标、零 store 写入。
    const foreignPayload = {
      projectId: PID,
      episodesId: EID + 500, // 他 episode——同室跨集串扰面(CR-02)
      node: {
        id: MID, type: 'storyboard', state: 'idle',
        data: {
          label: '跨集注入', type: 'storyboard',
          stale: { since: Date.now(), triggerAssetId: TRIG, triggerEventId: `evt_${TRIG}` },
        },
      },
      changedFields: ['data.stale'],
    }
    await page.request.post('/__mock/emit', {
      data: { projectId: PID, event: 'node:updated', data: foreignPayload },
    })
    await page.waitForTimeout(600)
    await expect(staleBadge(page, MID)).toHaveCount(0)
    await expect(badgeAll).toHaveCount(0)

    // 正向对照(守卫非死码/socket 正常):同 scope 注入 → 级联照常,角标出现
    await page.request.post('/__mock/emit', {
      data: {
        projectId: PID, event: 'node:updated',
        data: { ...foreignPayload, episodesId: EID },
      },
    })
    await expect(staleBadge(page, MID)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_B)).toBeVisible({ timeout: 5_000 })
    // 触发资产自身与无关节点不受波及(宪法 §13)
    await expect(staleBadge(page, TRIG)).toHaveCount(0)
    await expect(staleBadge(page, UNREL)).toHaveCount(0)
  })

  test('orchestrate does not cascade (SC3-negative)', async ({ page }) => {
    await loadCanvas(page)
    await injectCascadeFixture(page)

    const badgeAll = page.locator('.react-flow__node svg[aria-label="stale"]')
    await expect(badgeAll).toHaveCount(0)

    // 负向 #2:全量 orchestrate(SC3)——mock 广播各节点 node:state success,
    // 等全部 fixture 节点 success(mock 侧写 state)再断言角标计数不变
    const orch = await page.request.post('/api/canvas/orchestrate', {
      data: { projectId: PID, episodesId: EID },
    })
    expect(orch.status()).toBe(200)
    await expect.poll(async () => {
      const s = await getMockState(page)
      return (s.canvas.nodes ?? []).every((n) => n.state === 'success')
    }, { timeout: 8_000 }).toBe(true)
    await waitForOrchIdle(page)
    await expect(badgeAll).toHaveCount(0)

    // 负向 #1:无 regenSource execute(ContextMenu 形状)→ 等节点 state success
    // 广播到达页面(socket 链)→ 角标计数仍不变
    await page.request.post('/api/canvas/execute', {
      data: { projectId: PID, episodesId: EID, nodeId: TRIG, nodeType: 'storyboard', prompt: 'ContextMenu 形状无标记' },
    })
    await expect.poll(async () => {
      return page.evaluate((nid) => {
        return window.__kaisCanvas?.getNodes()?.find((n) => n.id === nid)?.data?.state ?? null
      }, TRIG)
    }, { timeout: 5_000 }).toBe('success')
    await expect(badgeAll).toHaveCount(0)

    // mock 侧复核:零 data.stale 新写(回放逻辑严格在 regenSource 分支内)
    const s = await getMockState(page)
    const staleIds = (s.canvas.nodes ?? []).filter((n) => n.data?.stale != null).map((n) => n.id)
    expect(staleIds).toEqual([])

    // 正向对照(防「socket 死 → 零事件 → 假绿」):同节点带 regenSource 重生成,
    // 角标必须出现——零以上的零才是级联语义的负向证据
    await panelRegen(page, TRIG)
    await expect(staleBadge(page, MID)).toBeVisible({ timeout: 5_000 })
  })

  test('rerun-clears badge via existing exits (SC4)', async ({ page }) => {
    await loadCanvas(page)
    await injectCascadeFixture(page)
    // 时序确定性(mock config 既有控制面 + 59-04 新增旋钮):rerunStaleChain 先
    // save(stale 上 wire,52-02 语义)再 orchestrate 子集——save 的 graph:saved
    // 自回声触发全量 reload,与 node:state running/success 本地清 stale(52-01
    // 两态都清)存在既有竞态窗口(reload 落地实测 ~1s 且抖动,restore 可能落在
    // clear 之后 → 角标复活)。该写-写竞态是 RESEARCH Pitfall 4 已知边界、planner
    // 裁定本 phase 不做合并写——本用例以 suppressGraphSaved 旋钮把自回声 reload
    // 从被测面剔除(被测语义 = 既有出口重跑 → success 清角标,52-01 链),
    // 产品竞态在 SUMMARY 如实记录。
    await page.request.post('/__mock/config', { data: { suppressGraphSaved: true } })

    // SC1 前置:面板重生成 → 三下游角标(mid-1/down-2 链 + down-1 独立叶子)
    await panelRegen(page, TRIG)
    await expect(staleBadge(page, MID)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_A)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, DOWN_B)).toBeVisible({ timeout: 5_000 })
    await expect(staleBadge(page, UNREL)).toHaveCount(0) // 无下游关系节点全程无角标

    // 出口 1(面板):down-1 详情面板 StaleSection 重跑按钮 → orchestrate 子集
    await openDetailPanel(page, DOWN_A)
    await page.locator('[data-testid="stale-rerun-btn"]').click()
    let orch
    await expect.poll(async () => {
      orch = await lastCall(page, '/api/canvas/orchestrate')
      return Array.isArray(orch?.body?.nodeIds) && orch.body.nodeIds.includes(DOWN_A)
    }, { timeout: 8_000 }).toBe(true)
    expect(orch.body.nodeIds).not.toContain(UNREL)
    // node:state success → applySocketNodeState 清 stale(52-01)→ down-1 角标消失
    await expect(staleBadge(page, DOWN_A)).toHaveCount(0, { timeout: 8_000 })
    // mid-1/down-2 链不受波及(未进本次子集)
    await expect(staleBadge(page, MID)).toBeVisible()
    await expect(staleBadge(page, DOWN_B)).toBeVisible()
    // 等「编排进行中」守卫解除(否则出口 2 被 useStaleRerun 守卫 toast 早退)
    await waitForOrchIdle(page)

    // 出口 2(角标):mid-1 svg[aria-label="stale"] click(stopPropagation 隔离)
    // → 链子集 [mid-1, down-2](getDownstreamIds 传递闭包)
    await staleBadge(page, MID).click()
    let orch2
    await expect.poll(async () => {
      orch2 = await lastCall(page, '/api/canvas/orchestrate')
      return Array.isArray(orch2?.body?.nodeIds) && orch2.body.nodeIds.includes(MID)
    }, { timeout: 8_000 }).toBe(true)
    expect(orch2.body.nodeIds).toContain(DOWN_B)
    expect(orch2.body.nodeIds).not.toContain(DOWN_A)
    expect(orch2.body.nodeIds).not.toContain(UNREL)
    await expect(staleBadge(page, MID)).toHaveCount(0, { timeout: 8_000 })
    await expect(staleBadge(page, DOWN_B)).toHaveCount(0, { timeout: 8_000 })

    // 收尾复核:无关节点全程无角标;全画布角标归零
    await expect(staleBadge(page, UNREL)).toHaveCount(0)
    await expect(page.locator('.react-flow__node svg[aria-label="stale"]')).toHaveCount(0)
  })
})
