import { test, expect, getCalls } from '../helpers.mjs'

/**
 * phase-config-model — GLM 模型配置 e2e（08-25 配置 Tab · ConfigPanel）。
 *
 *  a render-defaults    : 配置 Tab → model-config-section 五字段在场 + 值 = 默认 +
 *                         source chip default（apiKey 留空时）。
 *  b save-roundtrip     : 改 textModel/scorerVisionModel/apiKey → 保存 → toast +
 *                         PUT 载荷保真 + 重进 Tab 值回读 file 源（mock 内存持久）。
 *  c apibase-validation : apiBase 填非 http(s) → 保存被前端拦（warning toast，零 PUT）；
 *                         直接打端点 400（后端兜底独立可证）。
 *
 * ⚠️ e2e 跑 dist——运行前必须 `npm run build`（packages/infinite-canvas）。
 */

const URL_ = `/?${new URLSearchParams({ projectId: '1', episodesId: '1', testMode: '1' }).toString()}`

async function loadConfigTab(page) {
  await page.goto(URL_, { waitUntil: 'networkidle' })
  await page.request.post('/__mock/reset')
  await page.goto(URL_, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '配置', exact: true }).click()
  await expect(page.getByTestId('config-view')).toBeVisible()
  await expect(page.getByTestId('model-config-input-textModel')).toBeVisible()
}

async function putModelCalls(page) {
  const calls = await getCalls(page)
  return calls.filter((c) => c.method === 'PUT' && c.path === '/api/canvas/v2/model-config')
}

test.describe('phase config-model', () => {
  test('a render-defaults: 五字段 + 默认值 + default 来源角标', async ({ page }) => {
    await loadConfigTab(page)
    await expect(page.getByTestId('model-config-input-scorerVisionModel')).toHaveValue('glm-4v-flash')
    await expect(page.getByTestId('model-config-input-textModel')).toHaveValue('glm-5.1')
    await expect(page.getByTestId('model-config-input-visionModel')).toHaveValue('glm-4.6v')
    await expect(page.getByTestId('model-config-input-apiBase')).toHaveValue('https://open.bigmodel.cn/api/paas/v4')
    await expect(page.getByTestId('model-config-input-apiKey')).toHaveValue('')
    // 全字段 default 源（mock 未写 modelConfig）。
    await expect(
      page.locator('[data-testid="model-config-source"][data-source="default"]'),
    ).toHaveCount(5)
  })

  test('b save-roundtrip: PUT 载荷保真 + 重进回读 file 源', async ({ page }) => {
    await loadConfigTab(page)
    await page.getByTestId('model-config-input-textModel').fill('glm-5.2')
    await page.getByTestId('model-config-input-scorerVisionModel').fill('glm-4.6v')
    await page.getByTestId('model-config-input-apiKey').fill('sk-test-123')
    await page.getByTestId('model-config-save').click()
    await expect(page.getByText('GLM 模型配置已保存')).toBeVisible()

    const calls = await putModelCalls(page)
    expect(calls.length).toBe(1)
    expect(calls[0].body?.textModel ?? calls[0].textModel).toBe('glm-5.2')
    expect(calls[0].body?.scorerVisionModel ?? calls[0].scorerVisionModel).toBe('glm-4.6v')
    expect(calls[0].body?.apiKey ?? calls[0].apiKey).toBe('sk-test-123')

    // 重进 Tab（mock 内存持久）→ 值回读 + 全 5 字段 file 源（表单整对象提交）。
    await page.getByRole('button', { name: '资产库', exact: true }).click()
    await page.getByRole('button', { name: '配置', exact: true }).click()
    await expect(page.getByTestId('model-config-input-textModel')).toHaveValue('glm-5.2')
    await expect(page.locator('[data-testid="model-config-source"][data-source="file"]')).toHaveCount(5)
  })

  test('c apibase-validation: 前端拦截零 PUT;后端 400 兜底独立可证', async ({ page }) => {
    await loadConfigTab(page)
    await page.getByTestId('model-config-input-apiBase').fill('ftp://bad.example')
    await page.getByTestId('model-config-save').click()
    await expect(page.getByText('API Base 须为 http(s):// 开头')).toBeVisible()
    expect((await putModelCalls(page)).length).toBe(0)

    // 后端道:直接打端点证明兜底(前端拦截使 UI 无法发出该请求)。
    const res = await page.request.put('/api/canvas/v2/model-config', {
      data: { apiBase: 'ftp://bad.example' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.message).toBe('apiBase 须为 http(s):// 开头')
  })
})
