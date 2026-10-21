import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: season-office
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readComposedAppSource().replace(/\r\n/g, '\n');
function extractAppFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, name);
  const end = appSource.indexOf('\n        function ', match.index + match[0].length);
  assert.ok(end > match.index, `${name} boundary`);
  return appSource.slice(match.index, end);
}

const item = (overrides = {}) => ({ ITEMCODE: '001524.030.1', LOCATIONCODE: 'D.26.000', LOTCODE: '27.F1', SOURCE: 'DRIVE', ...overrides });
const master = (overrides = {}) => ({ ITEMCODE: '001524.030.1', LOCATIONCODE: 'D.26.000', LOTCODE: '27.F1', APP_TAB_ASSIGNMENT: 'season', SOURCE: 'DRIVE', ...overrides });

function harness({ rows = [], indexedRows = rows, scannedInventory = rows } = {}) {
  const context = {
    Array, Map, String, Object,
    fullInventory: scannedInventory,
    masterInventoryByItemCode: new Map([['001524.030.1', indexedRows]]),
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    getItemInquiryItemCode: row => String(row?.ITEMCODE ?? row?.itemcode ?? row?.ITEM ?? row?.item ?? '').trim().toUpperCase(),
    getMasterInventorySourceCode: row => String(row?.MASTER_SOURCE ?? row?.SOURCECODE ?? row?.SOURCE ?? '').trim().toUpperCase(),
    isRequestLikeItem: row => row?.REQUEST_LIKE === true,
    isDockLikeItem: row => row?.DOCK_LIKE === true,
    isSalesOfficeLikeItem: row => row?.SALES_OFFICE_LIKE === true,
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('findSeasonSalesNoteMasterCandidateForCard'), context);
  return context;
}

test('season candidate uses indexed item bucket and preserves exact identity, season, exclusions, and first matching source', () => {
  const first = master({ SOURCE: 'OTHER', UNIQUE_ID: 'first-other-source' });
  const matching = master({ SOURCE: 'DRIVE', UNIQUE_ID: 'matching-source' });
  const rows = [
    master({ REQUEST_LIKE: true }),
    master({ DOCK_LIKE: true }),
    master({ SALES_OFFICE_LIKE: true }),
    master({ LOCATIONCODE: 'D.26.001' }),
    master({ LOTCODE: '27.S1' }),
    master({ APP_TAB_ASSIGNMENT: 'request' }),
    first,
    matching,
    master({ SOURCE: 'DRIVE', UNIQUE_ID: 'later-matching-source' }),
  ];
  const context = harness({ rows });

  assert.equal(context.findSeasonSalesNoteMasterCandidateForCard(item()), matching);
  assert.equal(context.findSeasonSalesNoteMasterCandidateForCard(item({ SOURCE: '' })), first,
    'when no source is specified, retain the first eligible candidate in index order');
});

test('season candidate follows the replaced master item-code index and does not scan a 9,487-row inventory', () => {
  let fullInventoryScans = 0;
  const fullInventory = Array.from({ length: 9487 }, (_, index) => master({ UNIQUE_ID: `master-${index}` }));
  const originalFilter = fullInventory.filter.bind(fullInventory);
  fullInventory.filter = (...args) => { fullInventoryScans += 1; return originalFilter(...args); };
  const oldCandidate = master({ UNIQUE_ID: 'old-master-candidate' });
  const context = harness({ indexedRows: [oldCandidate], scannedInventory: fullInventory });

  assert.equal(context.findSeasonSalesNoteMasterCandidateForCard(item()), oldCandidate);
  const replacement = master({ UNIQUE_ID: 'replacement-master-candidate' });
  context.masterInventoryByItemCode = new Map([['001524.030.1', [replacement]]]);
  assert.equal(context.findSeasonSalesNoteMasterCandidateForCard(item()), replacement,
    'a new master snapshot index must be consulted immediately');
  assert.equal(fullInventoryScans, 0);
});

test('an available index miss does not trigger a full inventory scan; absent index retains VM compatibility fallback', () => {
  let fullInventoryScans = 0;
  const fullInventory = [master()];
  const originalFilter = fullInventory.filter.bind(fullInventory);
  fullInventory.filter = (...args) => { fullInventoryScans += 1; return originalFilter(...args); };
  const context = harness({ indexedRows: [], scannedInventory: fullInventory });

  assert.equal(context.findSeasonSalesNoteMasterCandidateForCard(item()), null);
  assert.equal(fullInventoryScans, 0, 'a valid but missing-key index is authoritative for this snapshot');

  context.masterInventoryByItemCode = null;
  assert.ok(context.findSeasonSalesNoteMasterCandidateForCard(item()));
  assert.equal(fullInventoryScans, 1, 'scan fallback is retained only for environments without the index');
});
