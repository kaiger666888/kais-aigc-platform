import { chromium } from 'playwright'
const BASE = 'http://localhost:10588'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/infinite-canvas/?projectId=9999&episodesId=1&testMode=1&focus=a-p04-art4`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(600)
  const target = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')]
    const cands = []
    for (const el of nodes) {
      if (el.getAttribute('data-id') === 'a-p04-art4') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2
      if (cx > 20 && cx < 380 && cy > 60 && cy < 940) cands.push({ id: el.getAttribute('data-id'), x: Math.round(cx), y: Math.round(cy) })
    }
    return cands.slice(0, 5)
  })
  console.log('candidates left of panel:', JSON.stringify(target))
  if (target.length) {
    await page.mouse.click(target[0].x, target[0].y)
    await page.waitForTimeout(800)
    console.log('sel after:', await page.evaluate(() => window.__kaisCanvas?.getSelectedNodeIds()))
    console.log('panel visible after:', await page.locator('[data-testid="detail-panel"]').isVisible().catch(() => false))
  }
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1 } finally { await browser.close() }
