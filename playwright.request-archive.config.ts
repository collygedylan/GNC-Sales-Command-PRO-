import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.+\.spec\.(ts|js)$/,
  grep: /@request-archive/,
  outputDir: './artifacts/request-archive-mobile-browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:43116',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node scripts/serve-release-tests.mjs .',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
