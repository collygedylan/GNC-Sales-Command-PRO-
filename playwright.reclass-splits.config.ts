import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';

export default defineConfig({ ...base,
  testMatch: 'reclass-splits.e2e.spec.ts',
  projects: base.projects!.filter(project => ['cache-chromium', 'cache-android', 'cache-iphone'].includes(project.name!)),
  outputDir: './artifacts/reclass-splits-browser',
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: './artifacts/reclass-splits-browser/results.json' }]],
});
