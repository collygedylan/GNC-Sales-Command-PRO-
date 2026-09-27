import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Only the local runner uses this adapter. CI/hosted configurations keep their
// existing matrices. Every selected local suite serves the same fresh artifact.
const config = process.env.GNC_LOCAL_CONFIG || '';
if (!/^playwright\.[\w-]+\.config\.ts$/.test(config) || config === 'playwright.local.config.ts'
    || !process.env.GNC_LOCAL_SITE_DIR || !process.env.GNC_LOCAL_OUTPUT_DIR) throw new Error('LOCAL_BROWSER_BUILD_REQUIRED');
const base = (await import('./' + config)).default;
const baseURL = 'http://127.0.0.1:43141';
const use = { baseURL, serviceWorkers: 'block' as const, trace: 'retain-on-failure' as const, screenshot: 'only-on-failure' as const };
export default defineConfig({
  ...base, fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  outputDir: path.join(process.env.GNC_LOCAL_OUTPUT_DIR, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(process.env.GNC_LOCAL_OUTPUT_DIR, 'results.json') }]],
  use: { ...base.use, ...use },
  projects: base.projects?.map((project: any) => ({ ...project, use: { ...project.use, ...use } })),
  webServer: {
    command: 'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43141 });"',
    url: baseURL, reuseExistingServer: false, timeout: 20_000, stdout: 'ignore', stderr: 'pipe',
  },
});
