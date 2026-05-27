import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Test 1: 加载 Toonflow 首页
  console.log('--- Test 1: Load Toonflow ---');
  try {
    await page.goto('http://localhost:8000/project', { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: '/tmp/toonflow-home.png', fullPage: true });
    console.log('✅ Toonflow loaded');
  } catch (e) {
    console.log('❌ Failed to load /project:', e.message);
    // Try root
    try {
      await page.goto('http://localhost:8000/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.screenshot({ path: '/tmp/toonflow-root.png', fullPage: true });
      console.log('✅ Root page loaded');
    } catch (e2) {
      console.log('❌ Root also failed:', e2.message);
    }
  }

  // Test 2: 检查页面标题
  const title = await page.title();
  console.log(`  Title: ${title}`);
  const url = page.url();
  console.log(`  URL: ${url}`);

  // Test 3: UI 元素计数
  const buttons = await page.locator('button').count();
  const links = await page.locator('a').count();
  const inputs = await page.locator('input').count();
  const divs = await page.locator('div').count();
  console.log(`  Buttons: ${buttons}, Links: ${links}, Inputs: ${inputs}, Divs: ${divs}`);

  // Test 4: 页面文字
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    console.log(`  Page text preview:\n${bodyText.substring(0, 1000)}`);
  } catch (e) {
    console.log('  Could not get body text:', e.message);
  }

  // Test 5: 检查是否有 Vue app 挂载
  const appHtml = await page.locator('#app').innerHTML({ timeout: 5000 }).catch(() => 'no #app');
  console.log(`  #app content length: ${appHtml.length}`);
  if (appHtml.length < 200) {
    console.log(`  #app content: ${appHtml.substring(0, 200)}`);
  }

  await browser.close();
  console.log('\nDone!');
})();
