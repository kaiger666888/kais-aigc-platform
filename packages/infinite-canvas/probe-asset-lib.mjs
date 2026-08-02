import { chromium } from 'playwright'

const URL = 'http://localhost:10588/infinite-canvas/?projectId=1785119845700&episodesId=1'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const assetBtn = page.getByRole('button', { name: /^资产$/ }).first()
await assetBtn.click().catch(() => {})
await page.waitForTimeout(2500)

const report = await page.evaluate(() => {
  const countEl = document.querySelector('.am-lib__count')
  const cards = document.querySelectorAll('.am-card')
  const empty = document.querySelector('.am-empty')
  const scopeBtns = [...document.querySelectorAll('.am-scope button')].map(b => ({ t: b.textContent?.trim(), on: b.classList.contains('is-on') }))
  return {
    countText: countEl?.textContent?.trim() ?? null,
    cardCount: cards.length,
    emptyText: empty?.textContent?.trim()?.slice(0,80) ?? null,
    scopeBtns,
    cardDataUuids: [...cards].slice(0,3).map(c => c.getAttribute('data-uuid')),
  }
})

console.log('=== REPORT ===')
console.log(JSON.stringify(report, null, 2))
console.log('=== RELEVANT CONSOLE LOGS ===')
console.log(logs.filter(l => /asset|Asset|error|Error|warn|Warn|search/i.test(l)).slice(-25).join('\n') || '(none)')

await browser.close()
