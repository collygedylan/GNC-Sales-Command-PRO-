import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = readFileSync(new URL('../assets/eval-reports-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
context.globalThis = context;
vm.runInContext(engineSource, context, { filename: 'eval-reports-engine.js' });
const engine = context.GncEvalReports;

function row(itemcode, season, saleyear, overrides = {}) {
  return {
    ITEMCODE: itemcode,
    SEASON: season,
    SALEYEAR: saleyear,
    ASSIGNEDTO: '',
    PRIORITY: '',
    S_LTS: 999,
    HOLDSTOPCODE: '',
    HOLDSTOPBEGINDATE: '',
    LOCATIONNOTEDATE: '',
    LOCATIONCODE: 'A.01.001',
    ...overrides
  };
}

function ids(rows) {
  return Array.from(rows, (record) => record.TEST_ID);
}

function independentScriptCompatibleReference(rows, options = {}) {
  const currentSalesYear = Number(options.currentSalesYear) < 100 ? 2000 + Number(options.currentSalesYear) : Number(options.currentSalesYear);
  const nextSalesYear = Number(options.nextSalesYear) < 100 ? 2000 + Number(options.nextSalesYear) : Number(options.nextSalesYear);
  const nextSeason = String(options.nextSeason || 'S1').toUpperCase();
  const lowStockMax = Number(options.lowStockMax ?? 150);
  const holdAgeDays = Number(options.holdAgeDays ?? 5);
  const locationNoteAgeDays = Number(options.locationNoteAgeDays ?? 10);
  const todayDay = Math.floor(Date.UTC(2026, 7, 20) / 86400000);
  const normalizeYear = (value) => {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed < 100 ? 2000 + parsed : parsed;
  };
  const dateDay = (value) => {
    const text = String(value ?? '').trim();
    let year;
    let month;
    let day;
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
      if (!match) return null;
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
      if (year < 100) year += 2000;
    }
    const stamp = Date.UTC(year, month - 1, day);
    const check = new Date(stamp);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return Math.floor(stamp / 86400000);
  };
  const olderThan = (value, days) => {
    const parsed = dateDay(value);
    return parsed != null && todayDay - parsed > days;
  };
  const reportIds = ['s1-with-pri', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1'];
  const output = Object.fromEntries(reportIds.map((id) => [id, []]));
  for (const candidate of rows) {
    const itemCode = String(candidate.ITEMCODE || '').trim().toUpperCase();
    if (!itemCode) continue;
    const itemRows = rows.filter((record) => String(record.ITEMCODE || '').trim().toUpperCase() === itemCode);
    const season = String(candidate.SEASON || '').trim().toUpperCase();
    const year = normalizeYear(candidate.SALEYEAR);
    const validYear = year != null && year <= currentSalesYear;
    const hasPriority = itemRows.some((record) => String(record.PRIORITY || '').trim());
    const hasValidF1 = itemRows.some((record) => {
      const recordYear = normalizeYear(record.SALEYEAR);
      return String(record.SEASON || '').trim().toUpperCase() === 'F1' && recordYear != null && recordYear <= currentSalesYear;
    });
    const hasOldHold = itemRows.some((record) => olderThan(record.HOLDSTOPBEGINDATE, holdAgeDays));
    const lowStockItem = itemRows.some((record) => {
      const recordYear = normalizeYear(record.SALEYEAR);
      return String(record.SEASON || '').trim().toUpperCase() === 'F1'
        && recordYear != null && recordYear <= currentSalesYear && Number(record.S_LTS) < lowStockMax;
    });
    if (String(candidate.PRIORITY || '').trim() && season !== 'F1') output['s1-with-pri'].push(candidate.TEST_ID);
    if (olderThan(candidate.LOCATIONNOTEDATE, locationNoteAgeDays)) output['od-loc-note-date'].push(candidate.TEST_ID);
    if (olderThan(candidate.HOLDSTOPBEGINDATE, holdAgeDays)) output['hs-plus-5-days'].push(candidate.TEST_ID);
    if (hasOldHold && !String(candidate.HOLDSTOPCODE || '').trim()) output['get-off-hold'].push(candidate.TEST_ID);
    if (lowStockItem && ((['U1', 'U2', 'U3', 'X'].includes(season) && validYear) || (season === nextSeason && year === nextSalesYear))) output['low-stock'].push(candidate.TEST_ID);
    if (!hasPriority) output['no-pri'].push(candidate.TEST_ID);
    if (season === 'X') output.culls.push(candidate.TEST_ID);
    if (!hasValidF1) output['not-in-f1'].push(candidate.TEST_ID);
  }
  for (const reportId of reportIds) output[reportId].sort();
  return output;
}

const now = new Date('2026-08-20T17:00:00Z');
const expectedAssignees = [
  'abigail_vazquez', 'bobby_adair', 'charley_robertson', 'dylan_collyge', 'ellen_ward',
  'jorge_colunga', 'josh_vann', 'megan_kelly', 'mitch_kaiser', 'zoe_green'
];

test('normalizes two-digit sales years and parses inventory dates without locale guessing', () => {
  assert.equal(engine.normalizeSalesYear('27'), 2027);
  assert.equal(engine.normalizeSalesYear(99), 2099);
  assert.equal(engine.normalizeSalesYear('2027'), 2027);
  assert.equal(engine.normalizeSalesYear(''), null);
  assert.equal(engine.parseInventoryDateEpochDay('8/9/26'), engine.parseInventoryDateEpochDay('2026-08-09'));
  assert.equal(engine.parseInventoryDateEpochDay('2/30/2026'), null);
  assert.equal(engine.parseInventoryDateEpochDay('not-a-date'), null);
});

test('classifies the eight F1/27 reports with strict date and low-stock boundaries', () => {
  const rows = [
    row('A', 'F1', '27', { TEST_ID: 'a-f1', ASSIGNEDTO: 'josh_vann', PRIORITY: '1', S_LTS: 100, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/2026', LOCATIONNOTEDATE: '8/9/2026' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'X', 27, { TEST_ID: 'a-x', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', ASSIGNEDTO: 'josh_vann' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', ASSIGNEDTO: 'abigail_vazquez', HOLDSTOPBEGINDATE: 'invalid', LOCATIONNOTEDATE: 'invalid' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future-f1', ASSIGNEDTO: 'bobby_adair', S_LTS: 10 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '2', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' }),
    row('E', 'S1', 27, { TEST_ID: 'e-s1-pri', ASSIGNEDTO: 'megan_kelly', PRIORITY: '3' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1',
    currentSalesYear: 27,
    nextSeason: 'S1',
    nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 },
    now
  });

  assert.deepEqual(ids(result.reports['s1-with-pri']), ['d-boundary', 'a-f1']);
  assert.deepEqual(ids(result.reports['od-loc-note-date']), ['a-f1']);
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['a-f1']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['low-stock']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['no-pri']), ['b-u2', 'c-future-f1']);
  assert.deepEqual(ids(result.reports.culls), ['a-x']);
  assert.deepEqual(ids(result.reports['not-in-f1']), ['b-u2', 'c-future-f1', 'e-s1-pri']);
});

test('uses ItemCode-level Priority, F1, hold, and low-stock membership', () => {
  const rows = [
    row('ONE', 'F1', 27, { TEST_ID: 'one-seed', PRIORITY: '1', S_LTS: 149, HOLDSTOPBEGINDATE: '8/1/2026', HOLDSTOPCODE: 'H' }),
    row('ONE', 'U3', 27, { TEST_ID: 'one-support' }),
    row('ONE', 'U3', 28, { TEST_ID: 'one-too-new' }),
    row('TWO', 'U1', 27, { TEST_ID: 'two-a', PRIORITY: '' }),
    row('TWO', 'S1', 27, { TEST_ID: 'two-b', PRIORITY: '9' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1', currentSalesYear: 2027, nextSeason: 'S1', nextSalesYear: 2027, now
  });

  assert.deepEqual(ids(result.reports['low-stock']), ['one-support']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['one-support', 'one-too-new']);
  assert.equal(result.reports['no-pri'].some((record) => record.ITEMCODE === 'TWO'), false);
  assert.equal(result.reports['not-in-f1'].filter((record) => record.ITEMCODE === 'TWO').length, 2);
});

test('follows the configured current and next-season transition', () => {
  const rows = [
    row('SHIFT', 'S1', 27, { TEST_ID: 'shift-s1', PRIORITY: '1', S_LTS: 20 }),
    row('SHIFT', 'U1', 27, { TEST_ID: 'shift-u1' }),
    row('SHIFT', 'F1', 28, { TEST_ID: 'shift-f1-next' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'S1', currentSalesYear: 27, nextSeason: 'F1', nextSalesYear: 28, now
  });
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['shift-s1']);
  assert.deepEqual(ids(result.reports['low-stock']), ['shift-f1-next', 'shift-u1']);
});

test('sorts by AssignedTo, ItemCode, season order, sales year, and location', () => {
  const rows = [
    row('B', 'X', 27, { TEST_ID: '4', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.02.001' }),
    row('A', 'U1', 27, { TEST_ID: '3', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.01.001' }),
    row('A', 'F1', 28, { TEST_ID: '2', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'A.02.001' }),
    row('A', 'F1', 27, { TEST_ID: '1', ASSIGNEDTO: 'abigail_vazquez', LOCATIONCODE: 'A.01.001' })
  ];
  assert.deepEqual(ids(rows.slice().sort(engine.compareRows)), ['1', '2', '3', '4']);
});

test('classifies 10,000 rows in one sub-500 ms pass on the test runtime', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `ITEM-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { TEST_ID: String(index), PRIORITY: index % 7 === 0 ? '1' : '', S_LTS: index % 200 }
  ));
  const started = performance.now();
  const result = engine.classifyRows(rows, { currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `classification took ${elapsed.toFixed(1)} ms`);
});

test('overlays authoritative ITEMCODE + GENUSNAME assignments without mutating inventory', () => {
  const inventory = [
    row(' 0001 ', 'F1', 27, { GENUSNAME: ' Rosa   Rugosa ', ASSIGNEDTO: 'stale_master_user' }),
    row('0002', 'U1', 27, { GENUSNAME: 'Acer', ASSIGNEDTO: 'another_stale_user' }),
    row('0003', 'U2', 27, { GENUSNAME: 'Thuja', ASSIGNEDTO: 'must_be_ignored' })
  ];
  const assignments = expectedAssignees.map((assignedto, index) => ({
    itemcode: String(index + 1).padStart(4, '0'),
    genusname: index === 0 ? '  ROSA rugosa  ' : `Genus ${index}`,
    assignedto
  }));
  assignments[1] = { ITEMCODE: '0002', GENUSNAME: ' acer ', ASSIGNEDTO: '' };

  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments);

  assert.equal(model.rows[0].ASSIGNEDTO, 'abigail_vazquez');
  assert.equal(model.rows[1].ASSIGNEDTO, '');
  assert.equal(model.rows[2].ASSIGNEDTO, '');
  assert.equal(model.rows[0].assignedto, 'abigail_vazquez');
  assert.equal(inventory[0].ASSIGNEDTO, 'stale_master_user');
  assert.equal(inventory[1].ASSIGNEDTO, 'another_stale_user');
  assert.equal(model.matchedCount, 2);
  assert.equal(model.unassignedCount, 2);
  assert.equal(engine.buildAuthoritativeAssignmentKey(inventory[0]), '0001|rosa rugosa');
});

test('builds the assignee selector from the complete assignment table', () => {
  const assignments = expectedAssignees.map((assignedto, index) => ({
    ITEMCODE: `ROSTER-${index}`,
    GENUSNAME: `Genus ${index}`,
    ASSIGNEDTO: assignedto
  }));
  assignments.push({ ITEMCODE: 'BLANK', GENUSNAME: 'Blank Genus', ASSIGNEDTO: '' });
  const model = engine.buildAuthoritativeAssignmentModel([
    row('ONLY-MASTER-ROW', 'F1', 27, { GENUSNAME: 'No assignment', ASSIGNEDTO: 'stale_master_user' })
  ], assignments);

  assert.deepEqual(Array.from(model.assignedToOptions), ['(Unassigned)', ...expectedAssignees]);
  assert.equal(model.rows[0].ASSIGNEDTO, '');
});

test('script-compatible classifier preserves the pasted Apps Script predicates and boundaries', () => {
  const rows = [
    row('A', 'F1', 27, { TEST_ID: 'a-f1', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '1', S_LTS: 100, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/2026', LOCATIONNOTEDATE: '8/9/2026' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1', ASSIGNEDTO: 'dylan_collyge' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '2' }),
    row('A', 'X', 27, { TEST_ID: 'a-x', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '3' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', ASSIGNEDTO: 'megan_kelly', HOLDSTOPBEGINDATE: 'invalid', LOCATIONNOTEDATE: 'invalid' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future-f1', S_LTS: 10 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', PRIORITY: '4', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' }),
    row('E', 'U3', 27, { TEST_ID: 'e-u3-pri', ASSIGNEDTO: 'megan_kelly', PRIORITY: '9' })
  ];
  const result = engine.classifyScriptCompatibleRows(rows, {
    currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 }, now
  });

  assert.deepEqual(ids(result.reports['s1-with-pri']), ['a-s1', 'a-x', 'e-u3-pri']);
  assert.deepEqual(ids(result.reports['od-loc-note-date']), ['a-f1']);
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['a-f1']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['low-stock']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['no-pri']), ['c-future-f1', 'b-u2']);
  assert.deepEqual(ids(result.reports.culls), ['a-x']);
  assert.deepEqual(ids(result.reports['not-in-f1']), ['c-future-f1', 'b-u2', 'e-u3-pri']);
});

test('script-compatible fixtures match an independent Apps Script reference implementation', () => {
  const rows = [
    row('A', 'F1', 27, { TEST_ID: 'a-f1', PRIORITY: '1', S_LTS: 149, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/26', LOCATIONNOTEDATE: '2026-08-09' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', PRIORITY: '2' }),
    row('A', 'X', 2027, { TEST_ID: 'a-x' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', HOLDSTOPBEGINDATE: 'bad-date' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future', S_LTS: 1 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', PRIORITY: '3', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' })
  ];
  const expected = independentScriptCompatibleReference(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27 });
  const actual = engine.classifyScriptCompatibleRows(rows, {
    currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 }, now
  });
  for (const reportId of engine.REPORT_IDS) {
    assert.deepEqual(ids(actual.reports[reportId]).sort(), expected[reportId], reportId);
  }
});

test('script-compatible sorting keeps valid years before future or invalid years', () => {
  const rows = [
    row('SORT', 'U1', 28, { TEST_ID: 'future', ASSIGNEDTO: 'same', PRIORITY: '1' }),
    row('SORT', 'U1', '', { TEST_ID: 'invalid', ASSIGNEDTO: 'same', PRIORITY: '1' }),
    row('SORT', 'U1', 27, { TEST_ID: 'valid', ASSIGNEDTO: 'same', PRIORITY: '1' })
  ];
  const result = engine.classifyScriptCompatibleRows(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['valid', 'invalid', 'future']);
});

test('item inquiry builds dependent filters and the three Apps Script sections', () => {
  const rows = [
    row('A', 'U1', 27, { ASSIGNEDTO: 'dylan_collyge', COMMONNAME: 'Alpha', CONTSIZE: '#3', PLANTGROUPCODE: 'PG-A', GENUSNAME: 'Genus A', LOTCODE: '27.F1', LOCATIONCODE: 'A.01.001' }),
    row('A', 'U2', 27, { ASSIGNEDTO: 'dylan_collyge', COMMONNAME: 'Alpha', CONTSIZE: '#5', PLANTGROUPCODE: 'PG-A', GENUSNAME: 'Genus A', LOTCODE: '27.F1', LOCATIONCODE: 'A.01.002' }),
    row('B', 'U1', 27, { ASSIGNEDTO: 'megan_kelly', COMMONNAME: 'Beta', CONTSIZE: '#3', PLANTGROUPCODE: 'PG-B', GENUSNAME: 'Genus B', LOTCODE: '27.F1', LOCATIONCODE: 'B.01.001' }),
    row('C', 'U1', 27, { ASSIGNEDTO: '', COMMONNAME: 'Gamma', CONTSIZE: '#1', LOCATIONCODE: 'C.01.001' })
  ];
  const initial = engine.buildItemInquiryModel(rows, {});
  assert.deepEqual(Array.from(initial.options.assignedTo), ['(Unassigned)', 'dylan_collyge', 'megan_kelly']);
  assert.deepEqual(Array.from(initial.options.commonNames), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(initial.sections.location.length, 4);

  const assigned = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge' });
  assert.deepEqual(Array.from(assigned.options.locationCodes), ['A.01.001', 'A.01.002']);
  assert.deepEqual(Array.from(assigned.options.commonNames), ['Alpha']);
  assert.deepEqual(Array.from(assigned.options.contSizes), ['#3', '#5']);

  const atLocation = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge', locationCode: 'A.01.002' });
  assert.equal(atLocation.matchedRows.length, 1);
  assert.deepEqual(Array.from(atLocation.options.commonNames), ['Alpha']);
  assert.deepEqual(Array.from(atLocation.options.contSizes), ['#5']);

  const filtered = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge', locationCode: 'A.01.001', commonName: 'Alpha', contSize: '#3' });
  assert.equal(filtered.matchedRows.length, 1);
  assert.equal(filtered.filters.locationCode, 'A.01.001');
  assert.equal(filtered.sections.item[0].PLANTGROUPCODE, 'PG-A');
  assert.equal(filtered.sections.season[0].SEASON, 'U1');
  assert.equal(filtered.sections.location[0].LOCATIONCODE, 'A.01.001');
});

test('script-compatible classifier handles 10,000 rows within the existing performance budget', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `SCRIPT-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { TEST_ID: String(index), PRIORITY: index % 7 === 0 ? '1' : '', S_LTS: index % 200 }
  ));
  const started = performance.now();
  const result = engine.classifyScriptCompatibleRows(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `script-compatible classification took ${elapsed.toFixed(1)} ms`);
});

test('authoritative assignment overlay and classification stay within the 10,000-row budget', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `OVERLAY-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { GENUSNAME: `Genus ${index % 2500}`, ASSIGNEDTO: 'stale_master_user', S_LTS: index % 200 }
  ));
  const assignments = Array.from({ length: 2500 }, (_, index) => ({
    ITEMCODE: `overlay-${String(index).padStart(4, '0')}`,
    GENUSNAME: `  genus   ${index} `,
    ASSIGNEDTO: expectedAssignees[index % expectedAssignees.length]
  }));
  const started = performance.now();
  const model = engine.buildAuthoritativeAssignmentModel(rows, assignments);
  const result = engine.classifyScriptCompatibleRows(model.rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(model.matchedCount, 10000);
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `assignment overlay and classification took ${elapsed.toFixed(1)} ms`);
});

test('the live shell keeps Eval Reports #1 and settings management Dylan/Megan-only', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(html, /const MANAGER_EVAL_REPORTS_VIEW = 'eval-reports'/);
  assert.match(html, /key === 'dylan_collyge' \|\| key === 'megan_kelly'/);
  assert.match(html, /supabaseRpc\('get_eval_report_settings'/);
  assert.match(html, /supabaseRpc\('set_eval_report_settings'/);
  assert.match(html, /assets\/eval-reports-engine\.js/);
  assert.match(serviceWorker, /\.\/assets\/eval-reports-engine\.js/);
});

test('the live shell registers Eval Reports #2 without replacing Eval Reports #1', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const MANAGER_EVAL_REPORTS_VIEW = 'eval-reports'/);
  assert.match(html, /const MANAGER_EVAL_REPORTS_2_VIEW = 'eval-reports-2'/);
  assert.match(html, /tabs\.push\(\{ id: MANAGER_EVAL_REPORTS_2_VIEW, label: 'Eval Reports #2' \}\)/);
  assert.match(html, /else if \(activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW\) html \+= renderManagerEvalReports2Panel\(\)/);
  assert.match(html, /function loadManagerEvalReports2\(force = false\)/);
  assert.match(html, /ensureDatasetLoaded\('master', 'full'/);
  assert.match(html, /ensureDatasetLoaded\('warehouseAssignedItems', 'full'/);
  assert.match(html, /api\.buildAuthoritativeAssignmentModel\(fullInventory, warehouseAssignedItemsInventory\)/);
  assert.match(html, /api\.classifyScriptCompatibleRows\(assignmentModel\.rows/);
  assert.match(html, /api\.buildItemInquiryModel\(getManagerEvalReport2Rows\(\)/);
  assert.match(html, /model\.options\.assignedTo = getManagerEvalReport2AssignedToOptions\(\)/);
  assert.match(html, /getDatasetLoadSignature\('warehouseAssignedItems'\)/);
  assert.match(html, /invalidateManagerEvalReport2Cache\(\)/);
  assert.match(html, /function getManagerEvalReport2LocationOptions\(rows = null\)/);
  assert.match(html, /managerEvalReport2LocationFilter !== 'all'/);
  assert.match(html, /Report &rarr; AssignedTo &rarr; Common Name &rarr; ITEMCODE/);
  assert.match(html, /Choose Report/);
  assert.match(html, /function getManagerEvalReport2CommonNameGroups\(rows = null\)/);
  assert.match(html, /function openManagerEvalReport2CommonName\(commonName = ''\)/);
  assert.match(html, /Refresh failed; the last complete results remain visible/);
  assert.match(html, /return managerEvalReport2Cache/);
  assert.match(html, /downloadExcelWorkbook\(getDriveReportExportColumns\(\), rows, `Eval Reports #2/);
  assert.match(html, /function renderManagerEvalReport2SelectableCard\(itemGroup = null, index = 0\)/);
  assert.match(html, /function openManagerEvalReport2ItemDetail\(encodedKey = ''\)/);
  assert.match(html, /function closeManagerEvalReport2ItemDetail\(\)/);
  assert.match(html, /function renderManagerEvalReport2ItemDetail\(\)/);
  assert.match(html, /Tap for details \/ press and hold to select/);
  assert.match(html, /\['LOCATIONCODE', 'SOURCE', 'LOTCODE', 'ITEMSPEC', 'S_LTS', 'SALESNOTE', 'DESIGITEM', 'DESIGCUST', 'DESIGLOC', 'PTRAVAILABLE'\]/);
  assert.match(html, /buildManagerEvalReport2DetailField\(row, 'HOLDSTOPBEGINDATE', \{ date: true \}\)/);
  assert.match(html, /buildManagerEvalReport2DetailField\(row, 'LOCATIONPTN1'\)/);
  assert.match(html, /function toggleManagerEvalReport2ItemSelection\(encodedKey = '', forceSelected = null\)/);
  assert.match(html, /function beginManagerEvalReport2SelectionMode\(\)/);
  assert.match(html, /MANAGER_EVAL_REPORT2_LONG_PRESS_MS = 450/);
  assert.match(html, /function startManagerEvalReport2LongPress\(event = null, encodedKey = ''\)/);
  assert.match(html, /function trackManagerEvalReport2LongPress\(event = null\)/);
  assert.match(html, /oncontextmenu="return preventManagerEvalReport2ContextMenu\(event\)"/);
  assert.match(html, /function buildManagerEvalReport2ExcelAttachment\(rows = \[\]\)/);
  assert.match(html, /function canViewManagerEvalReports2\(userOverride = ''\)/);
  assert.match(html, /key === 'dylan_collyge' \|\| key === 'megan_kelly' \|\| key === 'jd_jones'/);
  assert.match(html, /managerEvalReport2SelectedItemsByKey=new Map\(\)/);
  assert.match(html, /managerEvalReport2LockedAssignedTo/);
  assert.match(html, /managerEvalReport2Cache\.rowsByItemCode = new Map\(\)/);
  assert.match(html, /function getManagerEvalReport2SelectedRows\(\)/);
  assert.match(html, /function buildManagerEvalReport2SelectableGridHtml\(itemGroups = \[\]\)/);
  assert.match(html, /function buildManagerEvalReport2ItemInquiryWorkbookBlob\(rows = \[\]\)/);
  assert.match(html, /MANAGER_EVAL_REPORT2_ITEM_INQUIRY_MAX_BYTES = 18 \* 1024 \* 1024/);
  const exportColumnBlock = html.match(/const MANAGER_EVAL_REPORT2_ITEM_INQUIRY_COLUMNS = Object\.freeze\(\[([\s\S]*?)\n        \]\);/);
  assert.ok(exportColumnBlock, 'Eval Reports #2 export columns should be declared');
  const exportLabels = Array.from(exportColumnBlock[1].matchAll(/label: '([^']+)'/g), (match) => match[1]);
  assert.deepEqual(exportLabels, [
    'ITEMCODE', 'CONTSIZE', 'COMMONNAME', 'LOCATIONCODE', 'SOURCE', 'LOTCODE', 'ITEMSPEC',
    'HOLDSTOPCODE', 'HOLDSTOPREASON', 'HOLDSTOPBEGINDATE', 's_LTS', 'SALESNOTE', 'PRIORITY',
    'DesigItem', 'DesigCust', 'DesigLoc', 'PTRAVAILABLE', 'LOCATIONNOTE', 'LOCATIONNOTEDATE',
    'LOCATIONPTN1', 'SUSPENDTO', 'SPECIALPULLER',
  ]);
  assert.doesNotMatch(exportColumnBlock[1], /label: 'ASSIGNEDTO'|label: 'REPORTS'/);
  assert.match(html, /buildExcelSheetViewsXml\(1, 0\)/);
  assert.match(html, /<autoFilter ref="A1:\$\{lastColumn\}\$\{rowNumber\}"\/>/);
  assert.match(html, /sheet name="Item Inquiry"/);
  assert.match(html, /function emailSelectedManagerEvalReport2Rows\(\)/);
  assert.match(html, /Selected ITEMCODEs:/);
  assert.match(html, /id="manager-eval-report-2-done-button"/);
  assert.match(html, /managerEvalReport2LoadState\.loading \|\| managerEvalReport2LoadState\.error/);
  assert.match(html, /Refresh the complete inventory and Assigned Items data successfully before sending/);
  assert.match(html, /emailSubType: 'eval_reports_2_item_inquiry_excel'/);
  assert.match(html, /recipientsSelectedInApp: true/);
  assert.match(html, /shiftReportFormat: 'excel'/);
  assert.match(html, /Eval Reports #2 is available only to Dylan, Megan, and JD/);
});
