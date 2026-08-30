// One-off probe (UAT verify-work 52): replicate phase52-regen.mjs REGEN-01-a
// WITHOUT the panel-reopen dblclick (panel stays open after save — test's stale
// assumption). Clicks 重生成 directly on the already-open panel, then asserts
// the execute body carries the new prompt with asset-id nodeId.
// Run: node test/e2e/probe-52-regen-a.mjs   (mock backend must be on 9876)
import { chromium } from 'playwright'

const BASE = 'http://localhost:9876'
const NEW_PROMPT = '主角转身离开'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  const params = 'projectId=1&episodesId=1&testMode=1'
  await page.request.post(`${BASE}/__mock/reset`)
  await page.goto(`${BASE}/?${params}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForFunction(() => !!window.__kaisCanvas, { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(300)

  // open panel on storyboard-1 (fresh page → no panel open yet)
  await page.locator('.react-flow__node[data-id="storyboard-1"]').dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })

  const textarea = page.locator('[data-testid="prompt-textarea"]')
  const initial = await textarea.inputValue()
  console.log(`[1] initial prompt value: ${JSON.stringify(initial)}`)

  await textarea.fill(NEW_PROMPT)
  await page.locator('[data-testid="prompt-save"]').click()

  // save → save-v2 → mock state reverse-override
  await page.waitForFunction((want) => {
    return fetch('/__mock/state').then(r => r.json()).then(s => {
      const n = s.canvas?.nodes?.find(x => x.id === 'storyboard-1')
      return n?.data?.prompt === want
    })
  }, NEW_PROMPT, { timeout: 5_000 })
  console.log('[2] save-v2 wire state contains NEW prompt ✓')

  await page.waitForTimeout(500) // graph:saved reload settle
  const afterSave = await page.locator('[data-testid="prompt-textarea"]').count()
    ? await page.locator('[data-testid="prompt-textarea"]').inputValue()
    : '(panel closed)'
  console.log(`[3] panel after save: still open=${afterSave !== '(panel closed)'}, value=${JSON.stringify(afterSave)}`)

  // click 重生成 on whatever panel state is current
  const regen = page.locator('[data-testid="prompt-regenerate"]')
  const enabled = await regen.isEnabled()
  console.log(`[4] regenerate button enabled after save: ${enabled}`)
  await regen.click()

  const calls = await page.evaluate(async () => (await (await fetch('/__mock/calls')).json()))
  const execs = (calls ?? []).filter(c => c.path === '/api/canvas/execute')
  const exec = execs[execs.length - 1]
  console.log(`[5] execute calls: ${execs.length}; last body:`)
  console.log(JSON.stringify(exec?.body, null, 2).slice(0, 600))
  console.log(`[6] ASSERT body.prompt===NEW: ${exec?.body?.prompt === NEW_PROMPT}; body.params.prompt===NEW: ${exec?.body?.params?.prompt === NEW_PROMPT}; nodeId===storyboard-1: ${exec?.body?.nodeId === 'storyboard-1'}; nodeId not evt_: ${!exec?.body?.nodeId?.startsWith('evt_')}; nodeType: ${exec?.body?.nodeType}`)
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
