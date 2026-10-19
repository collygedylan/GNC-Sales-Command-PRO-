import { defineConfig, devices } from '@playwright/test';

const baseURL='http://127.0.0.1:43139';
export default defineConfig({
  testDir:'./tests',
  testMatch:/(v2311-frontend-smoke|suspend-tag-completion|eval-report2-async-index|reclass-splits|reclass-inquiry-compact-layout)\.e2e\.spec\.ts$/,
  grep:/@v2311-frontend-smoke|@v2311-workflow|Eval #2 shared snapshot reopens without loading flash|targeted item snapshot authorizes Reclass without promoting the global master|Move Up commits live stock before Priority inquiry|Send as Review preserves a targeted 34-unit F1 proposal/,
  outputDir:'./artifacts/v2311-scoped-browser',
  fullyParallel:false,workers:1,retries:0,maxFailures:1,timeout:90_000,forbidOnly:true,
  reporter:[[process.env.CI?'github':'list'],['json',{outputFile:'./artifacts/v2311-scoped-browser/results.json'}]],
  use:{baseURL,serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'v2311-desktop-chromium',use:{...devices['Desktop Chrome']}},
    {name:'v2311-android-chromium',use:{...devices['Pixel 7']}},
    {name:'v2311-iphone-webkit',use:{...devices['iPhone 13']}},
  ],
  webServer:{command:'node --input-type=module -e "import { startReleaseTestServer } from \'./scripts/serve-release-tests.mjs\'; await startReleaseTestServer({ port: 43139 });"',url:baseURL,reuseExistingServer:false,timeout:20_000,stdout:'ignore',stderr:'pipe'},
});
