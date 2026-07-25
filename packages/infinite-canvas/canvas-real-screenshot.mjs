import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

const consoleErrors = []
page.on('pageerror', e => consoleErrors.push(e.message))
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

// 真实后端，不 fixture
await page.goto('http://localhost:10588/infinite-canvas/?projectId=1784044301156&episodesId=1&testMode=1', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForSelector('.react-flow__node', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(3000)

// fitView
await page.keyboard.press('f')
await page.waitForTimeout(2000)

const nodeCount = await page.locator('.react-flow__node').count()
const storeNodes = await page.evaluate(() => window.__kaisCanvas?.getNodes()?.length ?? -1)

await page.screenshot({ path: '/tmp/canvas-real-layout.png', fullPage: false })

console.log(JSON.stringify({ nodeCount, storeNodes, consoleErrors: consoleErrors.length }, null, 2))
await browser.close()
