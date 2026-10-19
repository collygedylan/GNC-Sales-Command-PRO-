import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:43139';

export default defineConfig({
  testDir: './tests',
  testMatch: /av-live-hydration\.e2e\.spec\.ts$/,
  grep: /@av-live-hydration/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  outputDir: './artifacts/v238-av-live-hydration',
  reporter: 'list',
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'av-live-hydration-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'av-live-hydration-android', use: { ...devices['Pixel 7'] } },
    { name: 'av-live-hydration-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43139 });"',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
