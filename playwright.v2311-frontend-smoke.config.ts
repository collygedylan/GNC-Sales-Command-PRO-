import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:43139';

export default defineConfig({
  testDir: './tests',
  testMatch: /v2311-frontend-smoke\.e2e\.spec\.ts$/,
  grep: /@v2311-frontend-smoke/,
  outputDir: './artifacts/v2311-frontend-smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: true,
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: './artifacts/v2311-frontend-smoke/results.json' }]],
  use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'v2311-desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43139 });"',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
