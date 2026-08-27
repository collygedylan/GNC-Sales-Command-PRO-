import { defineConfig, devices } from '@playwright/test';

const baseURL = String(process.env.CANARY_BASE_URL || '').trim().replace(/\/+$/, '');
if (!baseURL) throw new Error('CANARY_BASE_URL_REQUIRED');

export default defineConfig({
  testDir: './tests',
  testMatch: /production-request-canary\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'cache-control': 'no-cache, no-store, must-revalidate',
      pragma: 'no-cache'
    }
  },
  projects: [
    { name: 'production-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'production-iphone-webkit', use: { ...devices['iPhone 13'] } }
  ]
});
