import { defineConfig, devices } from '@playwright/test';

// Always serve the compiled artifact. The server has no source-index fallback.
const baseURL = 'http://127.0.0.1:43136';
export default defineConfig({
  testDir: './tests', testMatch: ['verified-data-cache.e2e.spec.ts', 'request-photo-completion.e2e.spec.ts'],
  outputDir: './artifacts/verified-data-cache-browser',
  fullyParallel: false, workers: 1, retries: 0, timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: './artifacts/verified-data-cache-browser/results.json' }],
  ],
  expect: { timeout: 15_000 },
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'cache-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'cache-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'cache-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'cache-android', use: { ...devices['Pixel 7'] } },
    { name: 'cache-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43136 });"',
    url: baseURL, reuseExistingServer: false, timeout: 20_000,
    stdout: 'ignore', stderr: 'pipe',
  },
});
