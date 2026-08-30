import { chromium } from 'playwright'
const BASE = 'http://localhost:10588'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/infinite-canvas/?projectId=9999&episodesId=1&testMode=1&focus=a-p04-art4`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(600)
  console.log('sel before:', await page.evaluate(() => window.__kaisCanvas?.getSelectedNodeIds()))
  const r = await page.evaluate(() => {
    const el = document.querySelector('.react-flow__node[data-id="a-p04-art5"]')
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })
  // 真实鼠标事件序列(react-flow/d3 走 pointer/mouse down-up-click)
  await page.mouse.click(r.x, r.y)
  await page.waitForTimeout(800)
  console.log('sel after:', await page.evaluate(() => window.__kaisCanvas?.getSelectedNodeIds()))
  console.log('panel visible after:', await page.locator('[data-testid="detail-panel"]').isVisible().catch(() => false))
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1 } finally { await browser.close() }
