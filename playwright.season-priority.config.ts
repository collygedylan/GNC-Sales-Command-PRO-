import { defineConfig, devices } from '@playwright/test';

const remoteBaseURL = String(process.env.SEASON_PRIORITY_BASE_URL || '').trim().replace(/\/+$/, '');
const baseURL = remoteBaseURL || 'http://127.0.0.1:43121';

export default defineConfig({
  testDir: './tests',
  testMatch: /.+\.spec\.(ts|js)$/,
  grep: /@season-priority/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'artifacts/season-priority',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'cache-control': 'no-cache' },
  },
  projects: [
    { name: 'season-priority-desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'season-priority-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'season-priority-iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  // Build _site first. Only compiled static assets may reach this server.
  webServer: remoteBaseURL ? undefined : {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43121 });"',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
