import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.AV_SALES_STOCK_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43138';

export default defineConfig({
  testDir: './tests',
  testMatch: /av-sales-stock-visibility\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: './artifacts/av-sales-stock-visibility',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'av-sales-stock-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'av-sales-stock-android', use: { ...devices['Pixel 7'] } },
    { name: 'av-sales-stock-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: remote ? undefined : {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43138 });"',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
