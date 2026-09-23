import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeasonPriorityReport, seasonPriorityFixture, buildSeasonPriorityReportFixture } from './fixtures/season-priority-report.mjs';

for (const k of [2, 3, 4]) test(`Season Priority ${k} report preserves original rows, duplicate/missing ranks and all seasons`, () => {
  const { server, rows, result, model, pdfHtml, emailHtml } = buildSeasonPriorityReportFixture(k);
  assert.deepEqual(Array.from(result.rows, row => row.values.priority), rows.map((row, index) => index === 3 ? '1'
    : /^[1-4]$/.test(row.priority) && Number(row.priority) < k ? String(Number(row.priority) + 1) : row.priority));
  assert.equal(rows[3].priority, String(k));
  assert.equal(result.rows[3].expectedPriority, String(k));
  assert.match(pdfHtml, new RegExp(`${k} -&gt; 1`));
  assert.match(pdfHtml, /Report only; no inventory was changed/);
  assert.match(pdfHtml, /Letter landscape/);
  assert.match(pdfHtml, /thead\{display:table-header-group\}/);
  assert.match(emailHtml, /Requested priorities only/);
  for (const row of result.rows.filter(row => row.changedFields.includes('priority'))) {
    assert.ok(emailHtml.includes(row.values.locationcode));
    assert.ok(emailHtml.includes(`${row.expectedPriority} -&gt; ${row.values.priority}`));
  }
  assert.match(server.buildReclassInquiryReportText_(model), /no inventory has been changed/);
});

test('delayed delivery rejects changed priorities on affected and unchanged rows', () => {
  for (const index of [0, 3, 4, 6]) {
    const server = loadSeasonPriorityReport(), { rows, overlays, transaction } = seasonPriorityFixture();
    rows[index].priority = '98';
    const result = server.buildReclassInquiryActionRowsV3_(transaction, rows, overlays, {});
    assert.equal(result.ok, false);
    assert.match(result.message, /Priority changed/);
  }
});

test('generated contract rejects missing expectations, ambiguous lineage, incorrect rotation and scope changes', () => {
  const mutations = [
    fixture => { delete fixture.overlays[0].expected.priority; },
    fixture => { delete fixture.overlays[0].expected.lineage; },
    fixture => { fixture.overlays[1].expected.lineageHash = fixture.overlays[0].expected.lineageHash; },
    fixture => { fixture.overlays[0].proposals[0].priority = '4'; },
    fixture => { fixture.overlays[4].proposals = [{ action: 'priority_change', priority: '5' }]; },
    fixture => { fixture.transaction.seasonPriority.selectedLineageHash = 'e'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const server = loadSeasonPriorityReport(), fixture = seasonPriorityFixture();
    mutate(fixture);
    let rejected = false;
    try { rejected = server.buildReclassInquiryActionRowsV3_(fixture.transaction, fixture.rows, fixture.overlays, {}).ok === false; }
    catch (error) { assert.match(error.message, /Season Priority/); rejected = true; }
    assert.equal(rejected, true);
  }
  for (const key of ['source', 'contsize', 'desigitem', 'ptravailable']) {
    const server = loadSeasonPriorityReport(), fixture = seasonPriorityFixture();
    fixture.rows[0][key] = 'changed';
    assert.equal(server.buildReclassInquiryActionRowsV3_(fixture.transaction, fixture.rows, fixture.overlays, {}).ok, false);
  }
});

test('manual Reclass V3 without Season Priority expectations remains compatible', () => {
  const server = loadSeasonPriorityReport(), fixture = seasonPriorityFixture();
  delete fixture.transaction.seasonPriority;
  for (const overlay of fixture.overlays) for (const key of ['priority', 'lineage', 'lineageHash', 'ptravailable']) delete overlay.expected[key];
  const result = server.buildReclassInquiryActionRowsV3_(fixture.transaction, fixture.rows, fixture.overlays, {});
  assert.equal(result.ok, true);
});

test('public legacy enqueue cannot forge the protected Season Priority marker', () => {
  const server = loadSeasonPriorityReport();
  const result = server.enqueueReclassInquiryEmail_({ transaction: { seasonPriority: {} } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unauthorized');
});
