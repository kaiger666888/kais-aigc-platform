import { chromium } from 'playwright'

const URL = 'http://localhost:10588/infinite-canvas/?projectId=1785119845700&episodesId=1'
const GROUP = 'char:S01:concept'
const GROUP_TITLE = '宴会厅 · 概念设定'

// 抓取最新 toast 文本：toast 无 className（内联样式 fixed bottom:20 right:20），
// 容器 column-reverse，最新一条是第一个子 div。
async function latestToast(page) {
  return page.evaluate(() => {
    const fixed = [...document.querySelectorAll('div')].find((d) => {
      const cs = getComputedStyle(d)
      return cs.position === 'fixed' && cs.bottom === '20px' && cs.right === '20px' && d.textContent?.trim()
    })
    const msg = fixed?.querySelector('div > span:last-child')
    return msg?.textContent?.trim() ?? null
  })
}

async function captureToastAfter(page, action) {
  let captured = null
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(150)
    captured = await latestToast(page)
    if (captured) break
  }
  return captured
}

// 清掉所有残留 toast（toast 可点击即消失），避免抓到上一条未消失的旧 toast。
async function dismissAllToasts(page) {
  for (let i = 0; i < 5; i++) {
    const remain = await page.evaluate(() => {
      const fixed = [...document.querySelectorAll('div')].find((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'fixed' && cs.bottom === '20px' && cs.right === '20px' && d.textContent?.trim()
      })
      const toasts = fixed ? [...fixed.querySelectorAll('div')] : []
      toasts.forEach((t) => t.click())
      return toasts.length
    })
    if (remain === 0) break
    await page.waitForTimeout(120)
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /^资产$/ }).first().click().catch(() => {})
await page.waitForTimeout(1500)

// ── 步骤1: 选定 tab → 取消选定 "宴会厅 v3"，恢复候选 + 抓 deselect toast ──
await dismissAllToasts(page)
const deselectBtn = page.locator('.am-card__deselect-btn').first()
const dcount = await deselectBtn.count()
console.log('选定 tab 取消选定按钮数:', dcount)
let deselectToast = null
if (dcount > 0) {
  await deselectBtn.click()
  deselectToast = await captureToastAfter(page)
}
console.log('\n=== 修改3 · Deselect Toast ===')
console.log('toast:', deselectToast)
console.log('含组名:', deselectToast ? deselectToast.includes('宴会厅') : false)

// ── 步骤2: 待选 tab → 校验分组容器 UI ──
await page.getByRole('button', { name: /待选资产/ }).first().click().catch(() => {})
await page.waitForTimeout(1200)
const groups = await page.evaluate(() => {
  return [...document.querySelectorAll('.am-group')].map((g) => ({
    groupKey: g.getAttribute('data-group-key'),
    emoji: g.querySelector('.am-group__emoji')?.textContent?.trim() ?? null,
    title: g.querySelector('.am-group__title')?.textContent?.trim() ?? null,
    count: g.querySelector('.am-group__count')?.textContent?.trim() ?? null,
    hint: g.querySelector('.am-group__hint')?.textContent?.trim() ?? null,
    cardCount: g.querySelectorAll('.am-card').length,
    hasLeftBar: getComputedStyle(g).borderLeftWidth !== '0px',
  }))
})
const target = groups.find((g) => g.groupKey === GROUP)
console.log('\n=== 修改1 · 待选分组容器 UI ===')
console.log('目标组:', JSON.stringify(target, null, 2))
const uiOk = target && target.title === GROUP_TITLE && target.count === '6 个变体'
  && target.hint?.includes('互斥组') && target.hasLeftBar && target.cardCount === 6
console.log('UI 断言通过 (title/count/hint/左竖条/6卡片):', uiOk)

// ── 步骤3: 选定第一个候选 → 抓 select toast ──
await dismissAllToasts(page)
const selectBtn = page.locator('.am-group').first().locator('.am-card__select-btn').first()
const scount = await selectBtn.count()
console.log('\n=== 修改2 · Select Toast ===')
console.log('设为选定按钮数:', scount)
let selectToast = null
if (scount > 0) {
  await selectBtn.click()
  selectToast = await captureToastAfter(page)
}
console.log('toast:', selectToast)
console.log('含组名:', selectToast ? selectToast.includes('宴会厅') : false)
console.log('含淘汰数:', selectToast ? /5 个变体已自动淘汰/.test(selectToast) : false)

// ── 步骤4: 恢复 — 取消选定，回到全候选洁净状态 ──
await page.getByRole('button', { name: /选定资产/, exact: false }).filter({ hasText: /^★/ }).first().click().catch(() => {})
await page.waitForTimeout(1500)
const restoreBtn = page.locator('.am-card__deselect-btn').first()
if (await restoreBtn.count()) {
  await restoreBtn.click()
  await page.waitForTimeout(1500)
}
console.log('\n=== 恢复后选定 tab 卡片数 ===')
const remainSel = await page.evaluate(() => document.querySelectorAll('.am-card').length)
console.log('选定 tab 剩余:', remainSel, '(应为 0 = 已恢复全候选)')

await page.screenshot({ path: '/tmp/verify-tristate-final.png' })
console.log('\n截图: /tmp/verify-tristate-final.png')

// ── 汇总 ──
console.log('\n========== 汇总 ==========')
console.log('修改1 分组UI:', uiOk ? 'PASS ✅' : 'FAIL ❌')
console.log('修改2 Select toast 含组名:', selectToast?.includes('宴会厅') ? 'PASS ✅' : 'FAIL ❌')
console.log('修改3 Deselect toast 含组名:', deselectToast?.includes('宴会厅') ? 'PASS ✅' : 'FAIL ❌')

await browser.close()
