import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const extract = (name) => {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n        function ', start + 1));
};
const names = ['getTaskAvBlankSeasonCandidates', 'getTaskAvBlankSavedNote', 'isTaskAvBlankRowCompleted', 'getCurrentSeasonSalesNoteWinnerRows', 'getSeasonAvBlankItems'];
const context = vm.createContext({
  firstNonEmptyValue: (...v) => v.find(x => x !== null && x !== undefined && String(x).trim() !== '') ?? '',
  isBlankishCavValue: v => !String(v ?? '').trim() || String(v).trim().toUpperCase() === 'NULL',
  normalizeNcrSeasonCode: v => String(v).trim().toUpperCase(),
  getConfiguredCurrentSeasonCode: () => 'F1',
  resolveProductivityOriginKind: r => r.APP_TAB_ASSIGNMENT === 'season' ? 'season_sales_note' : 'location_sales_note',
  isCurrentSeasonSalesNoteCandidate: r => r.SEASON === 'F1' && r.APP_TAB_ASSIGNMENT === 'season',
  getMasterItemCodeKey: r => String(r.ITEMCODE).trim().toUpperCase(),
  compareSeasonWinnerCandidates: (a, b) => Number(b.PTRAVAILABLE) - Number(a.PTRAVAILABLE),
  cavAvBlankKeyInventory: [{ ITEMCODE: 'ABC', SEASON: 'F1', HOLDSTOPREASON: '' }],
  cavInventory: [],
});
vm.runInContext(names.map(extract).join('\n'), context);
const row = patch => ({ UNIQUE_ID: 'WIN', ITEMCODE: 'ABC', SEASON: 'F1', APP_TAB_ASSIGNMENT: 'season', PTRAVAILABLE: 100, ...patch });
const doneAt = '2026-09-09T12:00:00Z';

test('confirmed note-only completion is sufficient regardless of viewer, photos or specs', () => {
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: 'Great shape', DATE_COMPLETED: doneAt })), true);
  assert.equal(context.isTaskAvBlankRowCompleted({ av_note: 'N/A', date_completed: doneAt }), true);
  const source = extract('isTaskAvBlankRowCompleted');
  assert.doesNotMatch(source, /getItemDisplayValue|PHOTO|SPEC|BypassUserAllowed|currentUser/);
});

test('unfinished notes and photos without notes remain work; blank/NULL and invalid dates are not completion', () => {
  for (const patch of [
    { AV_NOTE: 'Saved draft' }, { PHOTO_LINK: 'photo', SPEC: 'N/A' },
    { AV_NOTE: '', DATE_COMPLETED: doneAt }, { AV_NOTE: ' NULL ', DATE_COMPLETED: doneAt },
    { AV_NOTE: null, DATE_COMPLETED: doneAt }, { AV_NOTE: 'Data', DATE_COMPLETED: 'NULL' },
  ]) assert.equal(context.isTaskAvBlankRowCompleted(row(patch)), false);
});

test('canonical clear/reset invalidates old completion without accepting stale lowercase aliases', () => {
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: 'Note', DATE_COMPLETED: doneAt, AV_RULE_LAST_CLEARED_AT: '2026-09-09T13:00:00Z' })), false);
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: 'Note', DATE_COMPLETED: doneAt, AV_RULE_LAST_CLEARED_AT: doneAt })), false);
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: 'Note', DATE_COMPLETED: doneAt, AV_RULE_LAST_CLEARED_AT: '2026-09-08T13:00:00Z' })), true);
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: '', av_note: 'stale', DATE_COMPLETED: doneAt })), false);
  assert.equal(context.isTaskAvBlankRowCompleted(row({ AV_NOTE: 'Note', DATE_COMPLETED: '', date_completed: doneAt })), false);
});

test('completed winner excludes ITEMCODE rather than promoting a blank runner-up; CAV blank cannot reopen it', () => {
  const candidates = [row({ AV_NOTE: 'Saved', DATE_COMPLETED: doneAt }), row({ UNIQUE_ID: 'OTHER', PTRAVAILABLE: 20 })];
  const selected = context.getTaskAvBlankSeasonCandidates(candidates);
  assert.equal(selected.length, 2, 'completion must survive candidate sourcing');
  assert.equal(context.getSeasonAvBlankItems(selected).length, 0);
  candidates[0].DATE_COMPLETED = '';
  assert.equal(context.getSeasonAvBlankItems(selected)[0].UNIQUE_ID, 'WIN');
  assert.equal(context.getSeasonAvBlankItems(selected).length, 1);
});

test('candidate sourcing preserves season and assignment exclusions without using Sales Office completion', () => {
  const candidates = [row({ DATE_COMPLETED: doneAt }), row({ UNIQUE_ID: 'Y', SEASON: 'Y' }), row({ UNIQUE_ID: 'Z', SEASON: 'Z' }), row({ UNIQUE_ID: 'LOCATION', APP_TAB_ASSIGNMENT: 'location' })];
  assert.deepEqual(Array.from(context.getTaskAvBlankSeasonCandidates(candidates), r => r.UNIQUE_ID), ['WIN']);
  assert.doesNotMatch(extract('getTaskAvBlankSeasonCandidates'), /isSeasonBlockedFromTaskQueue|getSeasonSalesOfficeRowsByMasterId/);
  assert.match(extract('getScopedTaskQueueItems'), /keepCompletedInTaskTab = safeView === 'av-blanks'/);
  assert.match(extract('getEvalSimpleTaskFilterItems'), /getSeasonAvBlankItems\(getTaskAvBlankSeasonCandidates\(baseRows\)\)/);
  assert.match(extract('getTaskTabItems'), /getSeasonAvBlankItems\(getTaskAvBlankSeasonCandidates\(scopedItems\)\)/);
});

test('AV Blanks waits for confirmed completion and leaves existing exemption/normal requirements intact', () => {
  assert.match(html, /taskAvBlankCompletionNeedsConfirmation = isComplete && isAvBlanksPhotoBypassTaskContext\(prefix\)/);
  assert.match(html, /if \(isComplete && prefix !== 'req-' && !taskAvBlankCompletionNeedsConfirmation\)/);
  assert.match(html, /const confirmedCompletedAt = taskAvBlankCompletionNeedsConfirmation && nativeAuthSessionActive\s*\? itemToSave.DATE_COMPLETED : payload.date_completed/);
  assert.match(html, /data-av-blanks-pending>AV Note saved — Mark Done to finish/);
  assert.match(html, /canBypassAvBlanksCompletionRequirementsForCurrentUser\(itemToSave, prefix\)/);
  assert.match(html, /itemToSave.DATE_COMPLETED = previousDateCompleted/);
});

test('a verified empty CAV key snapshot cannot revive stale rows from the older full-CAV adapter', () => {
  const previous = context.cavAvBlankKeyInventory;
  context.cavInventory = previous;
  context.cavAvBlankKeyInventory = [];
  context.getDatasetState = () => ({ fullLoaded: true });
  try {
    assert.equal(context.getSeasonAvBlankItems([row({})]).length, 0);
  } finally {
    context.cavAvBlankKeyInventory = previous;
    context.cavInventory = [];
    delete context.getDatasetState;
  }
});
