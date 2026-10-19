import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { reclassHoldStopFixture } from './helpers/reclass-pdf-fixture.mjs';

test('confirmed Hold Stop report keeps codes compact and audit metadata outside the narrow cells', () => {
  const { html } = reclassHoldStopFixture();
  const document = new JSDOM(html).window.document;
  const heads = [...document.querySelectorAll('.column-heading-row th')].map(n => n.textContent);
  const cells = [...document.querySelectorAll('[data-location-row] td')];
  const cell = label => cells[heads.indexOf(label)];
  assert.equal(cell('H/S').textContent.trim(), 'S');
  assert.equal(cell('Priority').textContent.trim(), '1');
  assert.equal(cell('Loc Note Date').textContent.trim(), '10/19/2026');
  assert.match(document.querySelector('.report-audit').textContent, /By MK \| Eval 10\/19\/2026 \| Updated 10\/19\/2026 11:56:05 AM/);
  assert.match(document.querySelector('.report-audit').textContent, /Same item 001524/);
  assert.match(document.querySelector('.identity').textContent, /Item Spec34" H/);
  assert.equal(cell('Source').classList.contains('code-cell'), true);
  assert.equal(cell('H/S Reason').classList.contains('note-cell'), true);
  assert.match(html, /white-space:nowrap/);
});
