import { defineConfig, devices } from '@playwright/test';

// Uses the production-built preview prepared by the release process; no backend reset or login.
export default defineConfig({
  testDir: '.',
  testMatch: 'partner-workspace.e2e.spec.ts',
  workers: 1,
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
});
