import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'suspend-tag-completion.e2e.spec.ts',
  grep: /@v2314-parity/,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: '.gnc-local/v2314-browser-results.json' }]],
  outputDir: '.gnc-local/v2314-browser-artifacts',
  use: {
    baseURL: 'http://127.0.0.1:43124',
    serviceWorkers: 'block',
    // DOM snapshot tracing changes render timing; retained diagnostic runs
    // are separate from the production-volume performance acceptance run.
    trace: 'off',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'python -m http.server 43124 --bind 127.0.0.1 --directory .gnc-local/v2314-site',
    url: 'http://127.0.0.1:43124',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
