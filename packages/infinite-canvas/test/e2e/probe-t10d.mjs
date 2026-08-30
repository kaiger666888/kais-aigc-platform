import { chromium } from 'playwright'
const BASE = 'http://localhost:10588'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/infinite-canvas/?projectId=9999&episodesId=1&testMode=1&focus=a-p04-art4`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(600)
  const title1 = (await page.locator('[data-testid="detail-panel"]').innerText()).slice(0, 120).replace(/\n/g, ' | ')
  await page.mouse.click(368, 182) // a-p04-art31 center
  await page.waitForTimeout(800)
  const title2 = (await page.locator('[data-testid="detail-panel"]').innerText()).slice(0, 120).replace(/\n/g, ' | ')
  console.log('panel before:', title1)
  console.log('panel after :', title2)
  console.log('content followed click =', title1 !== title2)
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1 } finally { await browser.close() }
