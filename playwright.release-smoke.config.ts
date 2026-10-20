import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const siteDir = process.env.RELEASE_SMOKE_SITE_DIR;
const outputDir = process.env.RELEASE_SMOKE_OUTPUT_DIR;
if (!siteDir || !outputDir) throw new Error('RELEASE_SMOKE_SEALED_SITE_REQUIRED');

export default defineConfig({
  testDir: './tests',
  testMatch: 'suspend-tag-completion.e2e.spec.ts',
  grep: /@release-smoke/,
  // Run the three viewport projects in parallel, with each profile's cases
  // sequential so multiple WebKit pages do not contend for animation frames.
  fullyParallel: false,
  workers: 3,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: path.join(outputDir, 'results.json') }]],
  outputDir: path.join(outputDir, 'artifacts'),
  use: {
    baseURL: 'http://127.0.0.1:43124',
    serviceWorkers: 'block',
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
    command: `node --input-type=module -e "import {startReleaseTestServer} from './scripts/serve-release-tests.mjs'; await startReleaseTestServer({port:43124});"`,
    url: 'http://127.0.0.1:43124',
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { GNC_LOCAL_SITE_DIR: siteDir },
  },
});
