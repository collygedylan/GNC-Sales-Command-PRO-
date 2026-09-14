import { defineConfig, devices } from '@playwright/test';

const remote = String(process.env.STABLE_BACKGROUND_REFRESH_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remote || 'http://127.0.0.1:43128';

export default defineConfig({
  testDir: './tests', testMatch: /stable-background-refresh\.e2e\.spec\.ts/,
  fullyParallel: false, workers: 1, retries: 0, timeout: 90_000,
  expect: { timeout: 12_000 }, reporter: 'list',
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure', extraHTTPHeaders: { 'cache-control': 'no-cache' } },
  projects: [
    { name: 'stable-background-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'stable-background-android', use: { ...devices['Pixel 5'] } },
    { name: 'stable-background-iphone', use: { ...devices['iPhone 13'] } }
  ],
  webServer: remote ? undefined : { command: 'python -m http.server 43128 --bind 127.0.0.1 --directory _site', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 20_000 }
});
