import { defineConfig, devices } from '@playwright/test';

// Uses the production-built preview prepared by the release process; no backend reset or login.
export default defineConfig({
  testDir: '.',
  testMatch: /.+\.spec\.(ts|js)$/ ,
  grep: /@partner-workspace/,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 40_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PARTNER_TEST_BASE_URL || 'http://127.0.0.1:43126',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'tablet-webkit', use: { ...devices['iPad Pro 11'] } },
  ],
  webServer: process.env.PARTNER_TEST_BASE_URL ? undefined : {
    command: 'python -m http.server 43126 --bind 127.0.0.1 --directory _site',
    cwd: '../..',
    url: 'http://127.0.0.1:43126',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
