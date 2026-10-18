import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function renderPdf(report) {
  const source = read('Code.gs');
  const context = vm.createContext({
    escapeEmailHtml_: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  });
  vm.runInContext(source.slice(source.indexOf('function bunchNoteFreeHeaderInstructions_'), source.indexOf('function freezeBunchNoteReportPdfs_')), context);
  return context.buildBunchNotePdfHtml_(report);
}

test('Bunch Note PDF preserves the rich header and sequential divider/inventory rows', () => {
  const html = renderPdf({
    format_version: 5, note_number: 'BN-221', instruction_revision: 1, block: 'D', location: 'D.05.000',
    work_type: 'D.05. Whole-house Bunch Notes', purpose_thread: 'Early Winter Protect',
    purposes: 'Bunch notes', direction: 'South to North', default_house_plan: 'Bunch West & Center',
    schedule_banner: 'Complete reconsolidation first', instructions: 'Leave aisles at risers.',
    rule_chips: ['Keep the west lane open'],
    cards: [
      { id: 'row-card-1', kind: 'inventory', row_ids: ['row-1'], itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3',
        owner_names: ['Sam', 'Sharon'], workflow_action: 'compound', workflow_instructions: 'TA worst 2 and haul the remaining plants',
        destination_location: 'G.15.000', destination_qualifier: 'South House', left_margin: 'QC', notes: 'Leave aisle clear' },
      { id: 'divider-1', kind: 'divider', text: '-------- DITCH --------', left_margin: 'STOP' },
      { id: 'row-card-2', kind: 'inventory', row_ids: ['row-2'], itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2',
        workflow_action: '', workflow_instructions: '', left_margin: '*' },
    ],
    actions: [],
    source: [
      { unique_id: 'row-1', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 4, review: 0, available: 4 },
      { unique_id: 'row-2', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B', stock: 2, review: 0, available: 2 },
    ],
  });

  for (const expected of ['D.05. Whole-house Bunch Notes', 'Early Winter Protect', 'Bunch West &amp; Center',
    'Complete reconsolidation first', 'QC', 'TA worst 2 and haul the remaining plants', 'G.15.000', 'South House',
    'Header rules', 'Keep the west lane open', 'Leave aisle clear', '-------- DITCH --------', 'STOP']) assert.ok(html.includes(expected), expected);
  assert.ok(html.indexOf('PLANT-A') < html.indexOf('-------- DITCH --------'));
  assert.ok(html.indexOf('-------- DITCH --------') < html.indexOf('Hosta'));
  assert.ok(html.indexOf('QC') < html.indexOf('TA worst 2 and haul the remaining plants'));
  assert.ok(html.indexOf('#3') < html.indexOf('Peony'));
  assert.ok(!html.includes('<h2>Plant details'));
  assert.ok(!html.includes('row-1'));
  assert.ok(!html.includes('Crew / action'));
});

test('legacy Bunch Note reports retain their existing actions and source-detail presentation', () => {
  const html = renderPdf({
    note_number: 'BN-LEGACY', instruction_revision: 1, block: 'A', location: 'A.01.000',
    purposes: 'Legacy queue note', instructions: 'Keep the old workflow intact.',
    actions: [{ id: 'legacy-action', group: 'hauling', label: 'Wait for truck', instructions: 'Stage plant carts.' }],
    source: [{ unique_id: 'legacy-row-id', itemcode: 'LEGACY-1', commonname: 'Legacy Plant', contsize: '#2', lotcode: 'L1' }],
  });
  assert.ok(html.includes('Crew / action'));
  assert.ok(html.includes('Plant details — saved source snapshot'));
  assert.ok(html.includes('legacy-row-id'));
  assert.ok(html.includes('Stage plant carts.'));
  assert.ok(html.includes('<h1>Legacy queue note</h1>'));
});

test('header-only Bunch Note PDF renders the header without empty action or plant tables', () => {
  const html = renderPdf({
    format_version: 5, note_number: 'BN-HEADER', instruction_revision: 2, block: 'A', location: 'A.04.000',
    work_type: 'A.04. Whole-location notes', purpose_thread: 'Rain Days', purposes: '',
    direction: 'East to West', default_house_plan: 'Spread Space', schedule_banner: 'Nursery tour Friday',
    instructions: 'Do not count TA rows.', prerequisites: '', cards: [], actions: [], source: [],
  });

  assert.ok(html.includes('A.04. Whole-location notes'));
  assert.ok(html.includes('Whole-location instructions; no individual inventory cards selected.'));
  assert.ok(!html.includes('<h2>Crew task instructions'));
  assert.ok(!html.includes('<h2>Plant details'));
});

test('header rule chips render once while non-chip notes remain in PDF and email content', () => {
  const report = { format_version: 5, note_number: 'BN-RULES', instruction_revision: 1, block: 'A', location: 'A.03.000',
    work_type: 'A.03. Bunch Notes', purpose_thread: 'Spring cleanup',
    rule_chips: ['Keep the west lane clear'],
    instructions: 'Keep the west lane clear\nCoordinate with irrigation first', cards: [], actions: [], source: [] };
  const html = renderPdf(report);
  assert.equal((html.match(/Keep the west lane clear/g) || []).length, 1);
  assert.ok(html.includes('Coordinate with irrigation first'));
  const source = read('Code.gs');
  assert.match(source, /const headerNotes = bunchNoteFreeHeaderInstructions_\(r\);/);
});

test('existing v5 card-linked action notes remain visible and are not duplicated by the new card note field', () => {
  const oldSavedHtml = renderPdf({
    format_version: 5, note_number: 'BN-OLD', block: 'D', location: 'D.05.000',
    cards: [{ id: 'card-1', kind: 'inventory', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', row_ids: ['row-1'] }],
    actions: [{ id: 'note-1', card_id: 'card-1', label: 'Card notes', instructions: 'Keep lots separate' }],
    source: [{ unique_id: 'row-1', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3' }],
  });
  assert.ok(oldSavedHtml.includes('Card notes: Keep lots separate'));

  const migratedSavedHtml = renderPdf({
    format_version: 5, note_number: 'BN-NEW', block: 'D', location: 'D.05.000',
    cards: [{ id: 'card-1', kind: 'inventory', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', row_ids: ['row-1'], notes: 'Keep lots separate' }],
    actions: [{ id: 'note-1', card_id: 'card-1', label: 'Card notes', instructions: 'Keep lots separate' }],
    source: [{ unique_id: 'row-1', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3' }],
  });
  assert.equal((migratedSavedHtml.match(/Keep lots separate/g) || []).length, 1);
});

test('v2.2.1 migration protects card identity while supporting dividers, frozen instructions and recipients', () => {
  const sql = read('supabase/migrations/20261018014347_bunch_note_blueprint_header_pdf_delivery.sql');
  for (const expected of [
    "c->>'kind'='divider'", 'workflow_instructions', 'destination_qualifier', 'left_margin',
    "'sharon_combs'", 'owner_ids', 'require_ready', 'SOURCE_CHANGED',
    'ph_master_inventory', 'BUNCH_NOTE_OPTION_CHANGED',
  ]) assert.ok(sql.includes(expected), expected);
  assert.match(sql, /recipients_for_reports/);
  assert.match(sql, /V221_PREVIEW_DIVIDER_PATCH_MISSING/);
  assert.match(sql, /V221_IMPORT_STATE_PATCH_SOURCE_CHANGED/);
});
