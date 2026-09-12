import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';
export default defineConfig({ ...base, testMatch: 'hl-restock.e2e.spec.ts', outputDir: './artifacts/hl-restock-browser',
  ...(process.env.HL_RESTOCK_BASE_URL ? { use: { ...base.use, baseURL: process.env.HL_RESTOCK_BASE_URL }, webServer: undefined } : {}),
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: './artifacts/hl-restock-browser/results.json' }]] });
