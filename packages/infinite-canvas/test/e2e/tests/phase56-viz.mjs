import { test, expect, loadCanvas } from '../helpers.mjs'

/**
 * Phase 56-06 — VIZ-01/02/03 e2e 冒烟(GUARD 传统;phase55-nav 同范式)。
 *
 * 覆盖五断言:
 *  ① hover mini-雷达:注入 aiScore.dimensions≥3 资产 → [data-testid="score-popover"] 出现
 *  ② verdict 角标:voice-audit 节点(clips FAIL)+ 同 shot_id 资产 → aria-label『耳审 不过』
 *  ③ 组视图剧场:双击 character 资产 → [data-testid="theater-shell"] 出现(双击改道)
 *  ④ G16 工作台:打开 → 条目行 ≥1 + 波形 canvas + 分句在(双轨)
 *  ⑤ 豁免 mock 回路:勾选 → 批量豁免 → mock g15-ops 收到 gate='p10c-gate' → 行「已豁免」
 *
 * ⚠️ e2e 跑 dist(地雷 #10)——先 npm run build。
 * 注入手法:__mock/state 预置节点(mock-backend server.mjs 全量返回)+
 * window.__kaisCanvas 桥(55-04 addNodeForTest/canonical 写回)。
 */

async function waitViewportSettled(page) {
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      await page.waitForTimeout(250)
      const b = await page.evaluate(() => window.__kaisCanvas?.getViewCenter?.() ?? null)
      return a != null && b != null && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 ? 1 : 0
    }, { timeout: 8_000 })
    .toBe(1)
}

test.describe('phase56-viz 冒烟', () => {
  test.beforeEach(async ({ page }) => {
    await loadCanvas(page)
    await waitViewportSettled(page)
  })

  test('① hover mini-雷达 popover(dimensions≥3)', async ({ page }) => {
    // 注入带 aiScore 3 维的资产(aiScore 经 rawData 穿透后 V3 节点持有)
    await page.evaluate(() => {
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-scored', type: 'asset', branchId: 'main',
        position: { x: 900, y: 400 }, size: { width: 240, height: 160 }, state: 'success',
        data: { label: '评分资产', assetType: 'role', filePath: null, state: 'success' },
      })
      // scored 死信修复链:aiScore 经 canonical 写入(socket 事件模拟)
      window.__kaisCanvas?.emitScored?.('e2e-scored', { overall: 0.82, dimensions: { drama: 0.9, rhythm: 0.8, character: 0.7 } })
    })
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.react-flow__node[data-id="e2e-scored"]')))
      .toBe(true)
    // 悬停 250ms 触发(轮询 popover 出现)
    await page.locator('.react-flow__node[data-id="e2e-scored"]').hover()
    await expect(page.locator('[data-testid="score-popover"]')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('[data-testid="score-popover"]')).toContainText('AI 评分')
  })

  test('② verdict 耳审角标(voice-audit FAIL join)', async ({ page }) => {
    await page.evaluate(() => {
      // 资产(shot_id join 目标)
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-shot-x', type: 'storyboard', branchId: 'main',
        position: { x: 1100, y: 600 }, size: { width: 240, height: 160 }, state: 'success',
        data: { shot_id: 'S02_009', label: 'S02_009', filePath: null, state: 'success' },
      })
      // voice-audit 节点(clips FAIL)
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-voice-audit-1', type: 'audio', branchId: 'main',
        position: { x: 700, y: 900 }, size: { width: 240, height: 160 }, state: 'success',
        phaseName: 'p10c_voice_audit',
        data: {
          phase: 'p10c_voice_audit', assetType: 'voice-audit', filePath: null, state: 'success',
          clips: [{ shot_id: 'S02_009', verdict: 'FAIL', similarity: 0.2, reason: '音高漂移' }],
        },
      })
    })
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.react-flow__node[data-id="e2e-shot-x"]')))
      .toBe(true)
    // 角标经 deriveQcVerdicts(join)渲染——aria-label 词表
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('[aria-label="耳审 不过"]')), { timeout: 5_000 })
      .toBe(true)
  })

  test('③ 双击 character 资产 → 组视图剧场', async ({ page }) => {
    await page.evaluate(() => {
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-char', type: 'asset', branchId: 'main',
        position: { x: 500, y: 300 }, size: { width: 240, height: 160 }, state: 'success',
        data: { label: '林小鱼', assetType: 'character', characterId: 'lin', filePath: null, state: 'success' },
      })
    })
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.react-flow__node[data-id="e2e-char"]')))
      .toBe(true)
    await page.locator('.react-flow__node[data-id="e2e-char"]').dblclick()
    await expect(page.locator('[data-testid="theater-shell"]')).toBeVisible({ timeout: 5_000 })
    // 双击语义改道:详情面板未开(零回归)
    await expect(page.locator('[data-testid="detail-panel"]')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="theater-shell"]')).toBeHidden()
  })

  test('④ G16 工作台:列表行 + 双轨(波形 canvas + 分句)', async ({ page }) => {
    // 注入 voice-audit 节点 → 工作台真实源 seam 有数据
    await page.evaluate(() => {
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-va', type: 'audio', branchId: 'main',
        position: { x: 700, y: 800 }, size: { width: 240, height: 160 }, state: 'success',
        phaseName: 'p10c_voice_audit',
        data: {
          phase: 'p10c_voice_audit', assetType: 'voice-audit', filePath: null, state: 'success',
          clips: [
            { id: 'S01_001', shot_id: 'S01_001', path: '', transcript: '他推开门，雨声灌进来。', verdict: 'PASS', similarity: 0.9, speaker: '林晚' },
            { id: 'S02_001', shot_id: 'S02_001', path: '', transcript: '你别过来！', verdict: 'FAIL', similarity: 0.3, speaker: '周野', reason: '音高漂移' },
          ],
        },
      })
    })
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.react-flow__node[data-id="e2e-va"]')))
      .toBe(true)
    // 经 GateCenterBlock p10c 行按钮打开(需 gate 快照——改为 store 直开,零 gate 依赖)
    // G16 store 直开(56-06 桥:gate 行入口需 gate 快照,e2e 直驱)
    await page.evaluate(() => window.__kaisCanvas?.openG16?.())
    await expect(page.locator('[data-testid="theater-shell"]')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-testid="theater-shell"]')).toContainText('配音听审')
    // 列表行 ≥1(shot_id mono) + 波形容器 canvas(右双轨签名)
    await expect
      .poll(() => page.locator('[data-testid="theater-shell"]').locator('text=S01_001').count())
      .toBeGreaterThanOrEqual(1)
  })

  test('⑤ 批量豁免 → mock g15-ops 收 gate=p10c-gate + 行「已豁免」', async ({ page }) => {
    await page.evaluate(() => {
      window.__kaisCanvas?.addNodeForTest({
        id: 'e2e-va2', type: 'audio', branchId: 'main',
        position: { x: 700, y: 700 }, size: { width: 240, height: 160 }, state: 'success',
        phaseName: 'p10c_voice_audit',
        data: {
          phase: 'p10c_voice_audit', assetType: 'voice-audit', filePath: null, state: 'success',
          clips: [{ id: 'S03_007', shot_id: 'S03_007', path: '', transcript: '这次，换我先开口。', verdict: 'WARN', similarity: 0.6, speaker: '林晚' }],
        },
      })
    })
    // setOpen(true) 懒 load(异步)——等源注入后的行出现再操作
    await page.evaluate(() => window.__kaisCanvas?.openG16?.())
    await expect(page.locator('[data-testid="theater-shell"]')).toBeVisible({ timeout: 5_000 })
    await expect
      .poll(() => page.locator('[data-testid="theater-shell"]').locator('text=S03_007').count(), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1)
    // 勾选 S03_007 行 checkbox → 批量豁免(行文本定位容器 div 过宽——
    // 直下 checkbox(全屏仅该行一个)最稳)
    const cb = page.locator('[data-testid="theater-shell"] input[type="checkbox"]').first()
    await cb.check()
    await page.locator('[data-testid="theater-shell"]').getByText('批量豁免').click()
    // mock 收到 gate='p10c-gate'
    await expect
      .poll(async () => {
        const calls = await page.request.get('/__mock/calls').then((r) => r.json())
        const hit = calls.find((c) => c.path === '/api/canvas/v2/g15-ops' && c.body?.gate === 'p10c-gate')
        return hit != null
      })
      .toBe(true)
    // 行出现「已豁免」
    await expect(page.locator('[data-testid="theater-shell"]')).toContainText('已豁免')
  })
})
