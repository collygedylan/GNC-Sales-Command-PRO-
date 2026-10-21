import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readComposedAppSource().replace(/\r\n/g, '\n');

function extractAppFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, `index.html function ${name}`);
  const end = appSource.indexOf('\n        function ', match.index + match[0].length);
  assert.ok(end > match.index, `${name} function boundary`);
  return appSource.slice(match.index, end);
}

function createCurrentSeasonContext() {
  const context = {
    Array, Math, Number, Object, String,
    PICK_NOTE_CURRENT_SEASON_CODE: 'F1',
    AV_OPEN_MAX_SALES_YEAR: 27,
    getConfiguredCurrentSeasonCode: () => 'F1',
    getConfiguredCurrentSalesYearCode: () => 27,
  };
  const functions = [
    'firstNonEmptyValue', 'parseAppNumber', 'normalizeNcrSeasonCode', 'normalizeNcrSalesYearValue',
    'parseNcrLotCode', 'getNcrLotInfo', 'getNcrSalesYear', 'getAvConfiguredCurrentSeasonCode',
    'getAvConfiguredCurrentSalesYearCode', 'getAvComparableSalesYear', 'getAvSalesSeasonValue',
    'getAvSalesYearValue', 'getAvSalesYearNumber', 'itemMatchesAvCurrentSeasonBucket',
  ].map(extractAppFunction).join('\n');
  vm.createContext(context);
  vm.runInContext(functions, context);
  return context;
}

test('Current Season includes F1 salesyear 27 and older using explicit fields or lot fallback', () => {
  const context = createCurrentSeasonContext();
  const explicitFields = { season: ' f1 ', salesyear: '27', lotcode: '26.S1' };
  const lotFallback = { lotcode: '27.f1' };
  const olderLot = { LOTCODE: '26.F1' };
  assert.equal(context.itemMatchesAvCurrentSeasonBucket(explicitFields), true);
  assert.equal(context.itemMatchesAvCurrentSeasonBucket(lotFallback), true);
  assert.equal(context.itemMatchesAvCurrentSeasonBucket(olderLot), true);
});

test('Current Season excludes salesyear 28 and other season codes, case-insensitively', () => {
  const context = createCurrentSeasonContext();
  assert.equal(context.itemMatchesAvCurrentSeasonBucket({ SEASON: 'F1', SALEYEAR: '28', LOTCODE: '27.F1' }), false);
  assert.equal(context.itemMatchesAvCurrentSeasonBucket({ LOTCODE: '28.f1' }), false);
  assert.equal(context.itemMatchesAvCurrentSeasonBucket({ season: 's1', lotcode: '27.S1' }), false);
  assert.equal(context.itemMatchesAvCurrentSeasonBucket({ SEASON: 'S1', LOTCODE: '27.F1' }), false);
});

test('REP Current Season preparation skips unrelated seasons before bounded row decoration', () => {
  const context = createCurrentSeasonContext();
  const rows = [{ LOTCODE: '26.F1' }, { LOTCODE: '27.F1' }, { LOTCODE: '28.F1' }, { LOTCODE: '27.S1' }];
  context.selectAvSalesInventorySourceRows = () => rows;
  context.applyAvOpenSalesWindowScope = value => value;
  context.applyRepU3VisibilityScope = value => value;
  context.shouldUseRepAvOpenDataset = () => true;
  vm.runInContext(extractAppFunction('getAvSalesInventorySourceRows'), context);
  assert.deepEqual(Array.from(context.getAvSalesInventorySourceRows({ skipSalesWindow: true, bucket: 'current' })), rows.slice(0, 2));
  assert.equal(context.getAvSalesInventorySourceRows({ skipSalesWindow: true, bucket: 'next-up' }), rows);
  assert.equal(context.getAvSalesInventorySourceRows({ skipSalesWindow: true }), rows);
  context.shouldUseRepAvOpenDataset = () => false;
  assert.equal(context.getAvSalesInventorySourceRows({ skipSalesWindow: true, bucket: 'current' }), rows);
});

test('non-manager sessions can load the shared current season setting from ph_app_settings', async () => {
  let cached = { seasonCode: 'F1', salesYear: 27, revision: 0 };
  let request;
  const context = {
    appSeasonSettingsRemoteLoading: false,
    appSeasonSettingsRemoteLoaded: false,
    APP_SEASON_SETTINGS_TABLE: 'ph_app_settings',
    APP_SEASON_SETTINGS_KEY: 'current_season_salesyear',
    canManageCurrentSeasonSettings: () => false,
    shouldUseProductionLiveSyncSideLoad: () => false,
    supabaseFetch: async (...args) => {
      request = args;
      return [{ key: 'current_season_salesyear', value: { seasonCode: 'S1', salesYear: 27, revision: 8 } }];
    },
    parseRemoteAppSeasonSettingsRow: row => row?.value || null,
    writeLocalAppSeasonSettings: value => { cached = value; },
    getCurrentAppSeasonSettings: () => cached,
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('refreshCurrentSeasonSettingsFromRemote'), context);

  const settings = await context.refreshCurrentSeasonSettingsFromRemote();
  assert.equal(request[0], 'ph_app_settings');
  assert.equal(request[1], 'GET');
  assert.match(request[3], /key=eq\.current_season_salesyear/);
  assert.equal(settings.seasonCode, 'S1');
  assert.equal(settings.salesYear, 27);
  assert.equal(context.appSeasonSettingsRemoteLoaded, true);
});

test('the AV live-sync view includes shared settings in the same adapter cohort', () => {
  const module = { exports: {} };
  const context = { module, globalThis: {}, Array, Object, Set, String, Error };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8'), context);
  const registry = module.exports;
  assert.ok(registry.getViewAdapters('av').includes('side:settings'));
  assert.ok(registry.getCoreKeys('av').includes('master'));
});
