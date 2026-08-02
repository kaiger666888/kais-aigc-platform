import { chromium } from 'playwright'

const URL = 'http://localhost:10588/infinite-canvas/?projectId=1785119845700&episodesId=1'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const failed = []
page.on('response', async (r) => {
  const u = r.url()
  if (/\/oss\/|turnaround|\.png|\.jpg/i.test(u) && r.request().resourceType() === 'image') {
    if (!r.ok()) failed.push(`${r.status()} ${u}`)
  }
})
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /^资产$/ }).first().click().catch(()=>{})
await page.waitForTimeout(3500)

// Inspect first card's thumb
const thumbInfo = await page.evaluate(() => {
  const card = document.querySelector('.am-card')
  if (!card) return null
  const img = card.querySelector('.am-card__img')
  const emoji = card.querySelector('.am-card__emoji')
  return {
    hasImg: !!img,
    imgSrc: img?.getAttribute('src') ?? null,
    imgNaturalW: img?.naturalWidth ?? null,
    imgComplete: img?.complete ?? null,
    hasEmoji: !!emoji,
    emojiText: emoji?.textContent?.trim() ?? null,
    cardName: card.querySelector('.am-card__name')?.textContent?.trim() ?? null,
  }
})
console.log('=== FIRST CARD THUMB ===')
console.log(JSON.stringify(thumbInfo, null, 2))
console.log('=== FAILED IMAGE REQUESTS ===')
console.log(failed.length ? [...new Set(failed)].slice(0,10).join('\n') : '(none)')

// Screenshot the asset library area
const lib = page.locator('.am-lib').first()
await lib.screenshot({ path: '/tmp/asset-lib.png' }).catch(async () => { await page.screenshot({ path: '/tmp/asset-lib.png', fullPage: false }) })
console.log('screenshot saved /tmp/asset-lib.png')
await browser.close()
