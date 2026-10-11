// @test-group: foundation
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { installPerformanceDomRemovalObserver } from '../scripts/performance-dom-observer.mjs';

async function flushMutations() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('stable list roots count removals even when the list is detached before MutationObserver delivery', async () => {
  const dom = new JSDOM('<!doctype html><main class="main-scroll"><ul class="request-list"><li id="row"></li></ul></main>');
  const { document, MutationObserver } = dom.window;
  const observer = installPerformanceDomRemovalObserver({ document, MutationObserver });
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  observer.reset('request');
  const list = document.querySelector('.request-list');
  document.querySelector('#row').remove();
  list.remove();
  await flushMutations();
  assert.deepEqual({ ...observer.snapshot('request') }, { domRemovals: 1 });
  assert.deepEqual({ ...observer.snapshot('drive') }, { domRemovals: 0 });
  dom.window.close();
});

test('nested owned roots are counted once and detached warm roots are released', async () => {
  const dom = new JSDOM('<!doctype html><main class="main-scroll"><div id="request-content"><ul class="request-list"><li id="row"></li></ul></div></main>');
  const { document, MutationObserver } = dom.window;
  const observer = installPerformanceDomRemovalObserver({ document, MutationObserver });
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  observer.reset('request');
  document.querySelector('#row').remove();
  await flushMutations();
  assert.deepEqual({ ...observer.snapshot('request') }, { domRemovals: 1 });

  const detachedDom = new JSDOM('<!doctype html><main class="main-scroll"></main>');
  const detachedObserver = installPerformanceDomRemovalObserver({ document: detachedDom.window.document, MutationObserver: detachedDom.window.MutationObserver });
  detachedDom.window.document.dispatchEvent(new detachedDom.window.Event('DOMContentLoaded'));
  const detachedMain = detachedDom.window.document.querySelector('main');
  const nextList = document.createElement('ul');
  nextList.className = 'request-list';
  nextList.innerHTML = '<li id="next"></li>';
  detachedMain.append(nextList);
  await flushMutations();
  detachedObserver.reset('request');
  nextList.querySelector('#next').remove();
  nextList.remove();
  await flushMutations();
  assert.deepEqual({ ...detachedObserver.snapshot('request') }, { domRemovals: 1 });
  dom.window.close();
  detachedDom.window.close();
});

test('React list additions and removals in one turn are counted when the sample flushes', () => {
  const dom = new JSDOM('<!doctype html><main class="main-scroll"></main>');
  const { document, MutationObserver } = dom.window;
  const observer = installPerformanceDomRemovalObserver({ document, MutationObserver });
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  observer.reset('request');
  const list = document.createElement('ul');
  list.className = 'request-list';
  list.innerHTML = '<li id="row"></li>';
  document.querySelector('main').append(list);
  list.querySelector('#row').remove();
  assert.deepEqual({ ...observer.snapshot('request') }, { domRemovals: 1 });
  list.innerHTML = '<li id="reinserted"></li>';
  document.querySelector('main').append(list);
  list.querySelector('#reinserted').remove();
  assert.deepEqual({ ...observer.snapshot('request') }, { domRemovals: 2 }, 'reusing the same list node remains observable exactly once');
  dom.window.close();
});
