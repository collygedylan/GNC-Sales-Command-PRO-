import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = html.slice(start + 1).search(/\n        (?:async )?function \w+\(/);
  return html.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('direct Suspend rerender projects asynchronously hydrated inventory photo and evaluation evidence', () => {
  const source = { UNIQUE_ID: 'soc-448', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1', SOURCE: 'SOC' };
  const mirror = { UNIQUE_ID: 'dock_suspend_dc_soc-448', DOCK_SUSPEND_DC_REQUEST: true, SOURCE_TABLE: 'ph_soc_master',
    REQUEST_SOURCE: 'docks', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1' };
  const canonical = { UNIQUE_ID: 'master-448', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1', SOURCE: 'GREENLEAF',
    PHOTO_LINK: 'https://photos.example.test/2026/10/18/004380.010.1.webp', PHOTO_NAME: '2026-10-18-004380.010.1.webp',
    DATE_COMPLETED: '2026-10-18T12:00:00Z', SPEC: '6-8" H', MATCH: '80%', AV_NOTE: 'SPEC - 6-8" H' };
  let hydratedRow = null;
  const firstNonEmptyValue = (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
  const context = {
    String, Object, Array, Map,
    firstNonEmptyValue,
    isDockSuspendDcRequestMirrorRow: row => row === mirror,
    findDockSuspendDcRequestSourceRow: () => source,
    findDockSuspendDcRequestCardDisplayDataRow: () => null,
    getDockSuspendDcRequestLinkedMasterRow: () => null,
    getQueueCardInventoryRow: () => hydratedRow,
    getDriveCustomerOutreachPhotoCsv: row => row.PHOTO_LINK || row.photo_link || '',
    getDriveCustomerOutreachSpec: row => row.SPEC || row.spec || '',
    getItemDisplayValue: (row, key) => row[key] ?? row[key.toLowerCase()] ?? '',
    getCurrentCardLocPhotoMatchQtyValue: () => '',
    getDisplayLocMatchQtyValue: () => '',
    getMasterAvInvalidationReasons: () => [],
    getPhotoUrlList: value => String(value || '').split(',').filter(Boolean),
    mergePhotoCsvList: values => [...new Set(values.flatMap(value => String(value || '').split(',').map(part => part.trim()).filter(Boolean)) )].join(','),
    normalizeRowPhotoFields: row => row,
    buildSearchIndex: row => row,
    syncDockSuspendDcRequestPhotoAliases: () => {},
    syncDockSuspendDcRequestQuantityAliases: () => {},
  };
  vm.createContext(context);
  vm.runInContext(extract('buildDockSuspendDcRequestCardDisplayItem'), context);

  const firstRender = context.buildDockSuspendDcRequestCardDisplayItem(mirror, 'request');
  assert.equal(firstRender.REQ_PHOTO_LINK, undefined, 'before the deferred identity batch resolves, request has no photo');
  hydratedRow = canonical;
  const afterHydration = context.buildDockSuspendDcRequestCardDisplayItem(mirror, 'request');
  assert.equal(afterHydration.REQ_PHOTO_LINK, canonical.PHOTO_LINK);
  assert.equal(afterHydration.REQ_SPEC, '6-8" H');
  assert.equal(afterHydration.REQ_MATCH, '80%');
  assert.equal(afterHydration.AV_NOTE, 'SPEC - 6-8" H');
  assert.equal(afterHydration.AV_RULE_PHOTO_UPDATED_AT, canonical.DATE_COMPLETED);
});
