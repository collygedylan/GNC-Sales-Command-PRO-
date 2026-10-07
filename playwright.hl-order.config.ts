import { defineConfig } from '@playwright/test';
import base from './playwright.verified-data-cache.config';
export default defineConfig({ ...base, testMatch:/.+\.spec\.(ts|js)$/,
  grep: /@hl-order/, outputDir:'./artifacts/hl-order-browser',
  reporter:[[process.env.CI ? 'github' : 'list'],['json',{outputFile:'./artifacts/hl-order-browser/results.json'}]] });
