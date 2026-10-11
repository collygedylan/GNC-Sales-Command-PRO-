import {defineConfig} from '@playwright/test';
import base from './playwright.verified-data-cache.config';
export default defineConfig({...base,testMatch:/.+\.spec\.(ts|js)$/,
  grep: /@bunch-note/,
 projects:base.projects!.filter(p=>['cache-chromium','cache-android','cache-iphone'].includes(p.name!)),
 outputDir:'./artifacts/bunch-note-browser',
 reporter:[[process.env.CI?'github':'list'],['json',{outputFile:'./artifacts/bunch-note-browser/results.json'}]]});
