import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:43142';
export default defineConfig({
  testDir: './tests', testMatch: 'module-mobile-smoke.e2e.spec.ts',
  outputDir: './artifacts/module-mobile', fullyParallel: false, workers: 1,
  retries: 0, timeout: 120_000, forbidOnly: Boolean(process.env.CI),
  expect: { timeout: 8_000 },
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: './artifacts/module-mobile/results.json' }]],
  use: { baseURL, actionTimeout: 8_000, navigationTimeout: 20_000, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'module-320', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 740 } } },
    { name: 'module-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43142 });"',
    url: baseURL, reuseExistingServer: false, timeout: 20_000, stdout: 'ignore', stderr: 'pipe',
  },
});
