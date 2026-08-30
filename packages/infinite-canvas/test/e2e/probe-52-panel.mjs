// One-off probe (UAT 52): panel width (T9) + single-click persistence (T10).
// Read-only — no edits, no saves.
import { chromium } from 'playwright'
const BASE = 'http://localhost:10588'
const QS = 'projectId=9999&episodesId=1&testMode=1'
const NODE_A = 'a-p04-art4'
const NODE_B = 'a-p04-art5'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/infinite-canvas/?${QS}&focus=${NODE_A}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(800)

  const box = await page.locator('[data-testid="detail-panel"]').boundingBox()
  const vw = page.viewportSize().width
  console.log(`[T9] panel width=${Math.round(box?.width ?? -1)}px viewport=${vw}px ratio=${((box?.width ?? 0) / vw).toFixed(2)} (spec ~480px)`)

  const bInfo = await page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
    if (!el) return { found: false }
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
    return { found: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } }
  }, NODE_B)
  await page.waitForTimeout(800)
  const panelVisible = await page.locator('[data-testid="detail-panel"]').isVisible().catch(() => false)
  console.log(`[T10] clicked ${NODE_B} ${JSON.stringify(bInfo)}; panel still visible=${panelVisible} (spec: 保持打开+内容切换)`)
} catch (err) {
  console.error('PROBE FAILED:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
