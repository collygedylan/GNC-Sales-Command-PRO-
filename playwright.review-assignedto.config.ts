import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const canaryBaseURL = String(process.env.CANARY_BASE_URL || '').trim().replace(/\/+$/, '');

// Local runs consume the compiled release artifact without a source fallback.
// The optional canary origin uses the same isolated baseline fixture.
export default defineConfig({
  ...base,
  testMatch: /review-assignedto\.e2e\.spec\.ts/,
  use: {
    ...base.use,
    baseURL: canaryBaseURL || base.use?.baseURL,
  },
  webServer: canaryBaseURL ? undefined : {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43116 });"',
    url: base.use?.baseURL, reuseExistingServer: false, timeout: 20_000,
  },
});
