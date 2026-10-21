import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource();
const asset = new URL('../assets/stable-view-dom.js', import.meta.url);
function fixture(markup) {
  const dom = new JSDOM(`<main id="view">${markup}</main>`, { pretendToBeVisual: true });
  const { window } = dom;
  const context = vm.createContext({ window, document: window.document, productionLiveSyncRendering: true,
    cancelChunkRenderWorkForContainer() {}, clearContainerRenderSignature() {}, setContainerUiState() {},
    tuneNativeImagePerformance() {}, scheduleDeferredCardPhotoHydration() {}, queueAvCardPhotoHydration() {} });
  if (existsSync(asset)) vm.runInContext(readFileSync(asset, 'utf8'), context);
  const start = html.indexOf('        function setContainerHtml(');
  const end = html.indexOf('\n        function ', start + 1);
  vm.runInContext(html.slice(start, end), context);
  return { dom, window, context, container: window.document.getElementById('view') };
}

test('background updates retain keyed cards, event handlers, focus and typed drafts', () => {
  const f = fixture('<section><article data-request-uid="a"><button>A</button><input value="saved"></article><article data-request-uid="b">B</article></section>');
  const first = f.container.querySelector('[data-request-uid="a"]');
  const second = f.container.querySelector('[data-request-uid="b"]');
  const button = first.querySelector('button');
  const input = first.querySelector('input');
  let clicks = 0;
  button.addEventListener('click', () => { clicks++; });
  input.value = 'unsaved draft'; input.focus(); input.setSelectionRange(2, 7);
  f.context.setContainerHtml(f.container, '<section><article data-request-uid="b">B updated</article><article data-request-uid="a"><button>A updated</button><input value="remote"></article></section>');
  assert.equal(f.container.querySelector('[data-request-uid="a"]'), first);
  assert.equal(f.container.querySelector('[data-request-uid="b"]'), second);
  assert.equal(first.querySelector('button'), button);
  button.click(); assert.equal(clicks, 1);
  assert.equal(f.window.document.activeElement, input);
  assert.equal(input.value, 'unsaved draft');
  assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 7);
  assert.equal(button.textContent, 'A updated');
  assert.equal(second.textContent, 'B updated');
  f.dom.window.close();
});

test('identical background markup produces no subtree mutations', async () => {
  const markup = '<section><article data-dom-id="lot-a"><p>Available</p></article></section>';
  const f = fixture(markup); const changes = [];
  const observer = new f.window.MutationObserver(records => changes.push(...records));
  observer.observe(f.container, { childList: true, subtree: true, attributes: true, characterData: true });
  f.context.setContainerHtml(f.container, markup);
  await Promise.resolve();
  assert.equal(changes.length, 0);
  observer.disconnect(); f.dom.window.close();
});

test('unchanged deferred photos keep loaded identity and failure evidence across refreshes', () => {
  const f = fixture('<article data-request-uid="a"><img data-deferred-card-photo="1" data-src="same.jpg" src="same.jpg" data-photo-hydrated="1" data-photo-load-failed="1" class="photo app-photo-thumbnail-failed" alt="Unavailable"><span data-loc-photo-match-value>N/A</span></article>');
  const img = f.container.querySelector('img');
  f.window.invalidateCardPhotoMatchOnLoadFailure = image => {
    image.closest('article').querySelector('[data-loc-photo-match-value]').textContent = 'N/A';
  };
  f.context.setContainerHtml(f.container, '<article data-request-uid="a"><img data-deferred-card-photo="1" data-src="same.jpg" class="photo" alt=""><span data-loc-photo-match-value>Not verified</span></article>');
  assert.equal(f.container.querySelector('img'), img);
  assert.equal(img.getAttribute('src'), 'same.jpg');
  assert.equal(img.dataset.photoHydrated, '1');
  assert.equal(img.dataset.photoLoadFailed, '1');
  assert.equal(img.classList.contains('app-photo-thumbnail-failed'), true);
  assert.equal(f.container.querySelector('[data-loc-photo-match-value]').textContent, 'N/A');
  f.context.setContainerHtml(f.container, '<article data-request-uid="a"><img data-deferred-card-photo="1" data-src="changed.jpg" class="photo" alt=""><span data-loc-photo-match-value>20</span></article>');
  assert.equal(img.hasAttribute('src'), false);
  assert.equal(img.dataset.photoHydrated, undefined);
  assert.equal(img.dataset.photoLoadFailed, undefined);
  assert.equal(img.classList.contains('app-photo-thumbnail-failed'), false);
  assert.equal(f.container.querySelector('[data-loc-photo-match-value]').textContent, '20');
  f.dom.window.close();
});

test('background refresh preserves a mounted React island but permission removal still removes it', () => {
  const f = fixture('<section><div id="manager-assigned-items-root" data-preserve-dom><input value="draft"></div><p>Old total</p></section>');
  const island = f.container.querySelector('[data-preserve-dom]');
  const child = island.firstChild;
  f.context.setContainerHtml(f.container, '<section><div id="manager-assigned-items-root" data-preserve-dom></div><p>New total</p></section>');
  assert.equal(f.container.querySelector('[data-preserve-dom]'), island);
  assert.equal(island.firstChild, child);
  assert.equal(f.container.querySelector('p').textContent, 'New total');
  f.context.setContainerHtml(f.container, '<p role="alert">Access restricted</p>');
  assert.equal(island.isConnected, false);
  assert.equal(f.container.textContent, 'Access restricted');
  f.dom.window.close();
});

test('foreground replacement and explicit clearing retain their existing lifecycle', () => {
  const f = fixture('<article data-dom-id="a">Old</article>');
  const old = f.container.firstChild;
  f.context.productionLiveSyncRendering = false;
  f.context.setContainerHtml(f.container, '<article data-dom-id="a">New</article>');
  assert.notEqual(f.container.firstChild, old);
  f.context.setContainerHtml(f.container, '');
  assert.equal(f.container.childNodes.length, 0);
  f.dom.window.close();
});

test('duplicate incoming identifiers never collapse visible rows', () => {
  const f = fixture('<article data-dom-id="a">A</article>');
  f.context.setContainerHtml(f.container, '<article data-dom-id="a">One</article><article data-dom-id="a">Two</article>');
  assert.deepEqual(Array.from(f.container.children, node => node.textContent), ['One', 'Two']);
  f.dom.window.close();
});

test('mounted islands retain their ownership marker through repeated legacy shells', () => {
  const f = fixture('<div id="custom-island" data-preserve-dom><button>Mounted</button></div>');
  const button = f.container.querySelector('button');
  for (let pass = 0; pass < 2; pass++) f.context.setContainerHtml(f.container, '<div id="custom-island"></div>');
  assert.equal(f.container.querySelector('button'), button);
  f.dom.window.close();
});

test('mounted legacy islands retain initialization markers without freezing wrapper classes', () => {
  const f = fixture('<div id="directory" class="old" data-preserve-dom data-company-directory-mounted="true"><button>Mounted</button></div>');
  const root = f.container.firstElementChild;
  const button = root.firstElementChild;
  f.context.setContainerHtml(f.container, '<div id="directory" class="new"></div>');
  assert.equal(root.dataset.companyDirectoryMounted, 'true');
  assert.equal(root.className, 'new');
  assert.equal(root.firstElementChild, button);
  f.dom.window.close();
});

test('blurred drafts and expanded details survive unrelated background text changes', () => {
  const f = fixture('<article id="a"><input value="saved"><details><summary>More</summary>Before</details></article>');
  const input = f.container.querySelector('input'); input.value = 'unsaved';
  const details = f.container.querySelector('details'); details.open = true;
  f.context.setContainerHtml(f.container, '<article id="a"><input value="server"><details><summary>More</summary>After</details></article>');
  assert.equal(input.value, 'unsaved'); assert.equal(details.open, true);
  assert.match(details.textContent, /After/); f.dom.window.close();
});
