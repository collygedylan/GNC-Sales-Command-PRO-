import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBunchNoteReportsPdf } from '../services/bunch-note-pdf.mjs';

function decodePdfText(value) {
  return value
    .replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([()\\])/g, '$1');
}

function inspectPdf(pdf) {
  const binary = Buffer.from(pdf.base64, 'base64').toString('latin1');
  const streams = [...binary.matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => match[1]);
  const pages = streams.map(stream => [...stream.matchAll(/\((.*?)(?<!\\)\) Tj ET/g)].map(match => decodePdfText(match[1])));
  return { binary, pages };
}

function card(id, overrides = {}) {
  return {
    id, kind: 'inventory', row_ids: [`row-${id}`], itemcode: `ITEM-${id}`,
    contsize: '2DP', commonname: `Fredonia Grape ${id}`, workflow_action: 'move',
    destination_location: 'H.00.000', notes: `leave room ${id}`, ...overrides,
  };
}

test('Bunch Note PDF centers the title, omits the block/location header and suppresses unspecified sections', async () => {
  const [pdf] = await renderBunchNoteReportsPdf([{
    job_id: 'job-1', note_number: 'BN-1', instruction_revision: 2,
    work_type: 'E.23. Bunch Notes', block: 'E', location: 'E.23.000',
    purpose_thread: 'Not specified', purposes: 'Not specified', direction: '—',
    target_houses: 'Not specified', default_house_plan: '—', priority: '—',
    instructions: '  —  ', prerequisites: '', cards: [card('1')],
    source: [{ unique_id: 'row-1', itemcode: 'ITEM-1', commonname: 'Fredonia Grape 1', contsize: '2DP' }], actions: [],
  }], 'Dylan Collyge', '2026-10-18T18:00:00.000Z');
  const { binary, pages } = inspectPdf(pdf);
  assert.match(binary, /^%PDF-1\.4/);
  assert.equal(pages.length, 1);
  const titleLine = pages[0][0];
  assert.equal(titleLine, 'E.23. Bunch Notes');
  const titleCommand = binary.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm \(E\.23\. Bunch Notes\) Tj ET/);
  assert.ok(titleCommand, 'title is emitted as positioned PDF text');
  const titleX = Number(titleCommand[1]);
  assert.ok(titleX > 190 && titleX < 250, `expected centered title origin, got x=${titleX}`);
  assert.doesNotMatch(pages.flat().join('\n'), /Block:|Location: E\.23\.000/);
  assert.doesNotMatch(pages.flat().join('\n'), /Not specified|Purpose \/ sequence|Target houses|Default house plan|Priority \/ order|General instructions|Prerequisites \/ wait instructions/);
  assert.match(pages[0].join('\n'), /Prepared by: Dylan Collyge \| Prepared: 10\/18\/2026, 01:00 PM \| Page 1 of 1/);
  assert.equal(pdf.filename, 'BN-1_R2.pdf');
});

test('walking order item fields are stacked and stay together through pagination', async () => {
  const cards = Array.from({ length: 24 }, (_, index) => card(String(index + 1), {
    left_margin: index === 4 ? 'BOB' : '',
    notes: `leave outside drape for card ${index + 1}`,
  }));
  const [pdf] = await renderBunchNoteReportsPdf([{
    job_id: 'job-2', note_number: 'BN-LONG', instruction_revision: 4,
    work_type: 'E.23. Bunch Notes', cards, actions: [],
    source: cards.map(item => ({ unique_id: `row-${item.id}`, itemcode: item.itemcode, commonname: item.commonname, contsize: item.contsize })),
  }], 'Worker', '2026-10-19T12:00:00.000Z');
  const { binary, pages } = inspectPdf(pdf);
  assert.ok(pages.length > 1, 'fixture should exercise multiple PDF pages');
  assert.equal((binary.match(/\/Type \/Page \/Parent/g) || []).length, pages.length);
  for (let index = 0; index < pages.length; index += 1) {
    assert.ok(pages[index].some(line => line.includes(`Page ${index + 1} of ${pages.length}`)), `page ${index + 1} has its own footer`);
  }
  const allText = pages.flat();
  const leadAt = allText.findIndex(line => line === '5. BOB | 2DP Fredonia Grape 5 (ITEM-5)');
  assert.notEqual(leadAt, -1);
  assert.equal(allText[leadAt + 1], 'Move to H.00.000');
  assert.equal(allText[leadAt + 2], 'Notes: leave outside drape for card 5');
  assert.doesNotMatch(allText.join('\n'), /Plan: Move to H\.00\.000/);
  const samePage = pages.find(page => page.includes('5. BOB | 2DP Fredonia Grape 5 (ITEM-5)'));
  assert.ok(samePage?.includes('Move to H.00.000') && samePage.includes('Notes: leave outside drape for card 5'));
});

test('Bunch Note PDF prints the house plan value directly and omits per-card direction and house repetition', async () => {
  const [pdf] = await renderBunchNoteReportsPdf([{
    job_id: 'clean-plan', note_number: 'BN-CLEAN', instruction_revision: 1,
    work_type: 'F.05 Bunch Notes', default_house_plan: 'Bunch North House', direction: 'East → West',
    cards: [card('clean', { workflow_action: 'bunch', destination_house: 'North House', direction: 'East → West', house: 'Bunch North House', workflow_instructions: 'Keep lots separated' })],
    source: [{ unique_id: 'row-clean', itemcode: 'ITEM-clean', commonname: 'Fredonia Grape clean', contsize: '2DP' }], actions: [],
  }], 'Dylan', '2026-10-28T12:00:00Z');
  const text = inspectPdf(pdf).pages.flat().join('\n');
  assert.match(text, /Bunch North House/);
  assert.doesNotMatch(text, /Default house plan:/i);
  assert.doesNotMatch(text, /Direction East|House Bunch North House/);
  assert.match(text, /Bunch to North House/);
  assert.match(text, /Instructions: Keep lots separated/);
});

test('long destinations wrap within an item block without dropping qualifier text', async () => {
  const qualifier = 'Keep every plant together beside the southern greenhouse entrance with clear access for the next truck and the counting team';
  const [pdf] = await renderBunchNoteReportsPdf([{
    job_id: 'long-route', note_number: 'LONG-ROUTE', work_type: 'E.23. Bunch Notes',
    cards: [card('route', { destination_qualifier: qualifier })], source: [], actions: [],
  }], 'Worker', '2026-10-19T12:00:00Z');
  const { pages } = inspectPdf(pdf);
  const start = pages[0].findIndex(line => line.startsWith('Move to '));
  const end = pages[0].findIndex(line => line.startsWith('Notes:'));
  assert.ok(end - start >= 2, 'long route is broken into multiple indented lines');
  assert.equal(pages[0].slice(start, end).join(' '), `Move to H.00.000 | ${qualifier}`);
});

test('prepared footer timestamp uses Chicago time and completed work keeps actuals in the same frozen PDF shape', async () => {
  const [pdf] = await renderBunchNoteReportsPdf([{
    job_id: 'job-3', note_number: 'BN-WORK', instruction_revision: 3,
    report_kind: 'completed_work', work_revision: 8, work_type: 'E.23. Bunch Notes',
    cards: [card('x', { itemcode: '005664.021.1', workflow_action: 'bunch', destination_house: 'South House' })],
    source: [{ unique_id: 'row-x', itemcode: '005664.021.1', commonname: 'Mars Grape', contsize: '2DP' }],
    actions: [], progress: {}, actuals: [{ quantity: 295, destination: 'H.00.000', actor_username: 'brian_hatfield', created_at: '2026-10-19T12:00:00Z', source_snapshot: { itemcode: '005664.021.1', contsize: '2DP', lotcode: 'LOT-1' }, action_snapshot: { label: 'Move' }, review_flags: ['differs_from_planned_quantity'] }],
  }], 'Dylan', '2026-10-19T12:00:00.000Z');
  const { binary, pages } = inspectPdf(pdf);
  const text = pages.flat().join('\n');
  assert.match(text, /Prepared: 10\/19\/2026, 07:00 AM/);
  assert.match(text, /Bunch to South House/);
  assert.match(text, /Qty 295/);
  assert.match(text, /brian_hatfield/);
  assert.equal(pdf.filename, 'BN-WORK_WORK_R8.pdf');
});
