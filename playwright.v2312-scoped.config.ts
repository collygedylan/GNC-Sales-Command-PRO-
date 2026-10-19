import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
const siteDir = '.gnc-local/foundation-site-v2312-reset1';
if (!readFileSync(`${siteDir}/assets/ops-precision-pilot.css`).equals(readFileSync('assets/ops-precision-pilot.css'))) throw new Error('V2312_TEST_SITE_CSS_STALE');
if (JSON.parse(readFileSync(`${siteDir}/manifest.json`, 'utf8')).version !== 'AgData v2.3.12') throw new Error('V2312_TEST_SITE_MANIFEST_STALE');
const baseURL = 'http://127.0.0.1:43140';
export default defineConfig({
  testDir: './tests', testMatch: /(v2312-live-sync-ui|suspend-tag-compaction|suspend-tag-completion)\.e2e\.spec\.ts$/,
  grep: /@v2312-ui|compact Suspend keeps/,
  outputDir: './artifacts/v2312-scoped-browser', fullyParallel: false, workers: 1,
  retries: 0, maxFailures: 1, timeout: 90000, forbidOnly: true,
  reporter: [['list'], ['json', { outputFile: './artifacts/v2312-scoped-browser/results.json' }]],
  use: { baseURL, serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'v2312-desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'v2312-android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'v2312-iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43140, siteDir: \'./.gnc-local/foundation-site-v2312-reset1\' });"', url: baseURL, reuseExistingServer: false, timeout: 20000, stdout: 'ignore', stderr: 'pipe' },
});
