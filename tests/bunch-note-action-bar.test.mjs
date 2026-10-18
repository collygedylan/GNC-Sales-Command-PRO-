// @test-group: bunch-notes-wizard
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../assets/bunch-note.css', import.meta.url), 'utf8');

test('Next and Save draft are in normal flow after the location setup and Advanced controls', () => {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>
    <main class="bn-root">
      <section class="bn-location-editor">
        <label>Purpose / Sequence Thread</label>
        <label>Direction</label>
        <label>Default House Plan</label>
        <label>Schedule / Prerequisite Alert</label>
        <details><summary>Advanced location controls</summary></details>
      </section>
      <div class="bn-step-actions"><button>Next</button><button>Save draft</button></div>
    </main>
  </body></html>`);
  const { document } = dom.window;
  const setup = document.querySelector('.bn-location-editor');
  const advanced = setup.querySelector('summary');
  const actions = document.querySelector('.bn-step-actions');

  assert.equal(getComputedStyle(dom.window, actions).position, 'static');
  assert.ok(advanced.compareDocumentPosition(actions) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(actions.compareDocumentPosition(advanced) & dom.window.Node.DOCUMENT_POSITION_PRECEDING);
  assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.textContent), ['Next', 'Save draft']);
  dom.window.close();
});

function getComputedStyle(window, element) {
  return window.getComputedStyle(element);
}
