import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // === Step 1: Login ===
  console.log('=== Step 1: Login ===');
  await page.goto('http://localhost:8000/project#/login', { waitUntil: 'networkidle', timeout: 30000 });
  
  const visibleInputs = page.locator('input:visible');
  await visibleInputs.nth(0).fill('admin');
  await visibleInputs.nth(1).fill('admin123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log(`After login URL: ${page.url()}`);
  await page.screenshot({ path: '/tmp/toonflow-02-loggedin.png', fullPage: true });

  // === Step 2: Dismiss welcome dialog ===
  console.log('\n=== Step 2: Dismiss Welcome ===');
  // Click "跳过引导" or close the dialog
  const skipBtn = page.locator('button:has-text("跳过引导")');
  if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipBtn.click();
    console.log('Clicked skip guide');
    await page.waitForTimeout(1000);
  } else {
    // Try pressing Escape to close dialog
    await page.keyboard.press('Escape');
    console.log('Pressed Escape to close dialog');
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: '/tmp/toonflow-03-no-dialog.png', fullPage: true });

  // === Step 3: Check project list ===
  console.log('\n=== Step 3: Project List ===');
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  console.log(`Page text:\n${bodyText.substring(0, 1500)}`);

  // === Step 4: Create new project ===
  console.log('\n=== Step 4: Create Project ===');
  const newBtn = page.locator('button:has-text("新建项目")');
  if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newBtn.click();
    console.log('Clicked 新建项目');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/toonflow-04-create-project.png', fullPage: true });
    console.log(`URL: ${page.url()}`);

    // Fill project form
    const formText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    console.log(`Form text:\n${formText.substring(0, 1000)}`);

    // Try to fill the form
    const formInputs = page.locator('input:visible');
    const formInputCount = await formInputs.count();
    console.log(`Form inputs: ${formInputCount}`);
    
    for (let i = 0; i < formInputCount; i++) {
      const ph = await formInputs.nth(i).getAttribute('placeholder');
      const tp = await formInputs.nth(i).getAttribute('type');
      console.log(`  Input ${i}: placeholder="${ph}" type="${tp}"`);
    }

    // Fill project name
    const nameInput = page.locator('input[placeholder*="项目名"], input[placeholder*="名称"]').first();
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill('Playwright Test Project');
      console.log('Filled project name');
    } else if (formInputCount > 0) {
      await formInputs.first().fill('Playwright Test Project');
      console.log('Filled first input as project name');
    }

    // Look for textarea for description
    const textareas = page.locator('textarea:visible');
    const taCount = await textareas.count();
    if (taCount > 0) {
      await textareas.first().fill('Created by Playwright automated test');
      console.log('Filled description');
    }

    await page.screenshot({ path: '/tmp/toonflow-05-form-filled.png', fullPage: true });

    // Submit the form
    const submitBtn = page.locator('button:has-text("确定"), button:has-text("创建"), button:has-text("提交"), button:has-text("保存")');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      console.log('Submitted form');
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle').catch(() => {});
      console.log(`After submit URL: ${page.url()}`);
      await page.screenshot({ path: '/tmp/toonflow-06-after-create.png', fullPage: true });
    }
  }

  // === Step 5: Final state ===
  console.log('\n=== Step 5: Final ===');
  const finalText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  console.log(`Final page text:\n${finalText.substring(0, 1000)}`);
  await page.screenshot({ path: '/tmp/toonflow-07-final.png', fullPage: true });

  await browser.close();
  console.log('\n✅ Playwright E2E completed!');
})();
