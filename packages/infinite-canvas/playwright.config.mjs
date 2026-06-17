import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e/tests',
  testMatch: /.*\.mjs$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: './test/e2e/results/html', open: 'never' }],
    ['json', { outputFile: './test/e2e/results/test-results.json' }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:9876',
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
  webServer: {
    command: 'node test/e2e/mock-backend/server.mjs',
    url: 'http://localhost:9876',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
