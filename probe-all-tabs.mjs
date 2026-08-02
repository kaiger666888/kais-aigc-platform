import { chromium } from 'playwright'

const BASE = 'http://localhost:10588/infinite-canvas/'
const browser = await chromium.launch({ headless: true })

async function probe(label, url) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  // open asset manager
  await page.getByRole('button', { name: /^资产$/ }).first().click().catch(()=>{})
  await page.waitForTimeout(2000)
  const clickTab = async (name) => {
    await page.locator('.am-tab', { hasText: name }).first().click().catch(()=>{})
    await page.waitForTimeout(1500)
  }
  const snap = async () => page.evaluate(() => ({
    count: document.querySelector('.am-lib__count')?.textContent?.trim() ?? null,
    cards: document.querySelectorAll('.am-card').length,
    empty: document.querySelector('.am-empty')?.textContent?.trim()?.slice(0,60) ?? null,
    sceneList: document.querySelectorAll('.am-scene-card').length,
    variants: document.querySelectorAll('.am-variant').length,
    sceneHead: document.querySelector('.am-scene__head h1')?.textContent?.trim() ?? null,
    detName: document.querySelector('.am-det__name, .am-scene__head h1')?.textContent?.trim() ?? null,
    scopeOn: document.querySelector('.am-scope button.is-on')?.textContent?.trim() ?? null,
  }))
  console.log(`\n===== ${label} (${url.split('?')[1] || 'no-params'}) =====`)
  // Library
  await clickTab('资产库')
  let s = await snap(); console.log(`[资产库] count=${s.count} cards=${s.cards} empty="${s.empty}" scope=${s.scopeOn}`)
  // Wardrobe
  await clickTab('角色衣柜')
  s = await snap(); console.log(`[角色衣柜] sceneList(char count)=${s.sceneList} empty="${s.empty}"`)
  // Scenes
  await clickTab('场景管理')
  s = await snap(); console.log(`[场景管理] sceneList=${s.sceneList} variants=${s.variants} head="${s.sceneHead}" empty="${s.empty}"`)
  // Detail: go back to library, click first card
  await clickTab('资产库')
  await page.locator('.am-card').first().click().catch(()=>{})
  await page.waitForTimeout(1500)
  s = await snap()
  const detBig = await page.evaluate(() => ({
    bigImg: !!document.querySelector('.am-det__big-img'),
    bigEmoji: document.querySelector('.am-det__big')?.textContent?.trim() ?? null,
    name: document.querySelector('.am-det__name')?.textContent?.trim() ?? null,
    view: document.querySelector('.am-tabs .am-tab.is-on')?.textContent?.trim() ?? null,
  }))
  console.log(`[资产详情] tab=${detBig.view} name="${detBig.name}" bigImg=${detBig.bigImg} bigEmoji="${detBig.bigEmoji}"`)
  if (errs.length) console.log('  pageerrors:', errs.slice(0,3).join(' | '))
  await page.close()
}

await probe('WITH project', `${BASE}?projectId=1785119845700&episodesId=1`)
await probe('NO project', `${BASE}`)
await browser.close()
