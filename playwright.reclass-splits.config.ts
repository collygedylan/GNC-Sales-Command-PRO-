import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';

export default defineConfig({ ...base,
  testMatch: /.+\.spec\.(ts|js)$/,
  grep: /@reclass-splits/,
  projects: base.projects!.filter(project => ['cache-chromium', 'cache-android', 'cache-iphone'].includes(project.name!)),
  outputDir: process.env.GNC_RECLASS_SPLITS_OUTPUT_DIR || './artifacts/reclass-splits-browser',
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: process.env.GNC_RECLASS_SPLITS_RESULTS_FILE || './artifacts/reclass-splits-browser/results.json' }]],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
