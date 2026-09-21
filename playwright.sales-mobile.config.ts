import { defineConfig, devices } from '@playwright/test';

// Exercise only the already-compiled release package; never rebuild or serve source.
const baseURL = 'http://127.0.0.1:43138';
export default defineConfig({
  testDir: './tests', testMatch: 'sales-mobile.e2e.spec.ts',
  outputDir: './artifacts/sales-mobile-browser',
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1, timeout: 90_000,
  forbidOnly: Boolean(process.env.CI), expect: { timeout: 15_000 },
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: './artifacts/sales-mobile-browser/results.json' }]],
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'sales-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'sales-android', use: { ...devices['Pixel 7'] } },
    { name: 'sales-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'sales-narrow', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 740 } } },
  ],
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43138 });"',
    url: baseURL, reuseExistingServer: false, timeout: 20_000, stdout: 'ignore', stderr: 'pipe',
  },
});
