import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Permanent coverage for existing regressions outside the release-tagged lanes.
// Nightly uses the current compiled artifact, never an archived versioned site.
export default defineConfig({
  ...base,
  testMatch: /(?:av-live-hydration|av-sales-stock-visibility|reclass-inquiry-compact-layout|v2311-frontend-smoke|v2312-live-sync-ui)\.e2e\.spec\.ts$/,
  grep: undefined,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  webServer: {
    command: 'node scripts/serve-release-tests.mjs',
    url: 'http://127.0.0.1:43116',
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
