import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { reclassHoldStopFixture } from './helpers/reclass-pdf-fixture.mjs';

test('standard Reclass report retains the published nine-column inquiry layout', () => {
  const { html } = reclassHoldStopFixture();
  const document = new JSDOM(html).window.document;
  const heads = [...document.querySelectorAll('th')].map(node => node.textContent.trim());
  assert.deepEqual(heads, ['Lotcode', 'Location', 'SOURCE', 'Priority', 'OH', 'PTRREVIEWED',
    'Loc Note Date', 'LOCATIONPTN1', 'Location Note']);
  const text = document.body.textContent.replace(/\s+/g, ' ');
  for (const value of ['Madison Hardy Star Jasmine', '001524.030.1', '27.F1', 'D.26.000',
    'Shipping', '10/19/2026', 'fullest on stake', 'needs retied']) assert.ok(text.includes(value), value);
});
