// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const client = readFileSync(new URL('../assets/ops-precision-pilot.js', import.meta.url), 'utf8');
const source = client.slice(client.indexOf('  const BROWSE_RAIL_SELECTOR'), client.indexOf('  function requestPreferenceSave'));

function fixture() {
  const dom = new JSDOM('<div id="drive-toolbar-rail"><button>A</button><button>B</button><button>C</button></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  window.eval(`${source}\nwindow.decorateRails = decorateCompactBrowseRails;`);
  const query = window.document.querySelectorAll.bind(window.document);
  let scans = 0;
  window.document.querySelectorAll = selector => { scans++; return query(selector); };
  return { window, close: () => window.close(), scans: () => scans, rail: window.document.getElementById('drive-toolbar-rail') };
}

test('desktop skips mobile rail scans until a mobile layout needs restoration', () => {
  const f = fixture();
  try {
    const buttons = Array.from(f.rail.children);
    f.window.innerWidth = 1440;
    f.window.decorateRails();
    f.window.decorateRails();
    assert.equal(f.scans(), 0);
    assert.deepEqual(Array.from(f.rail.children), buttons);

    f.window.innerWidth = 390;
    f.window.decorateRails();
    assert.equal(f.scans(), 1);
    const details = f.rail.querySelector('details');
    assert.ok(details);
    assert.deepEqual(Array.from(details.lastElementChild.children), buttons.slice(1));
    f.window.decorateRails();
    assert.equal(f.rail.querySelector('details'), details, 'unchanged mobile controls retain their nodes');

    f.window.innerWidth = 1440;
    f.window.decorateRails();
    assert.deepEqual(Array.from(f.rail.children), buttons, 'desktop restores the original controls in order');
    assert.equal(f.rail.classList.contains('mobile-browse-rail'), false);
    const restoredScans = f.scans();
    f.window.decorateRails();
    assert.equal(f.scans(), restoredScans, 'subsequent desktop card updates do not scan unrelated rails');

    f.window.innerWidth = 390;
    f.window.decorateRails();
    assert.ok(f.rail.querySelector('details'), 'resizing back to mobile still recreates the disclosure');
  } finally { f.close(); }
});

test('mobile rail replacement preserves the stored disclosure state', () => {
  const f = fixture();
  try {
    f.window.innerWidth = 390;
    f.window.decorateRails();
    const details = f.rail.querySelector('details');
    details.open = true;
    details.dispatchEvent(new f.window.Event('toggle'));
    const replacement = f.window.document.createElement('div');
    replacement.id = f.rail.id;
    replacement.innerHTML = '<button>D</button><button>E</button><button>F</button>';
    f.rail.replaceWith(replacement);
    f.window.decorateRails();
    assert.equal(replacement.querySelector('details').open, true);
    f.window.innerWidth = 1440;
    f.window.decorateRails();
    assert.deepEqual(Array.from(replacement.children, child => child.textContent), ['D', 'E', 'F']);
  } finally { f.close(); }
});
