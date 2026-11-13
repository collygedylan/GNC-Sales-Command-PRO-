import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const liveShellBuild = readFileSync(new URL('../../scripts/build-live-shell.mjs', import.meta.url), 'utf8');

function makeCompiledLoginShell(readyState = 'complete') {
  const bootstrap = liveShellBuild.match(/const runtimeTag = `<script>\r?\n([\s\S]*?)\r?\n<\/script>`;/)?.[1];
  assert.ok(bootstrap, 'exercise the actual emitted bootstrap');
  const dom = new JSDOM('<button id="login-button" disabled></button><button id="login-password-toggle" disabled></button><input id="pin-code"><div id="login-runtime-feedback"><p id="login-runtime-status">Preparing app…</p><button id="login-runtime-reload" hidden></button></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  Object.defineProperty(window.document, 'readyState', { value: readyState });
  const timers = new Map(), cleared = new Set();
  window.setTimeout = (callback, ms) => { timers.set(ms, callback); return ms; };
  window.clearTimeout = id => cleared.add(id);
  window.requestAnimationFrame = callback => callback();
  window.eval(bootstrap);
  return { dom, window, element: id => window.document.getElementById(id), script: window.document.querySelector('script'),
    slow: () => timers.get(15000)(), deadline: timers.get(1200), cleared: () => cleared.has(15000) };
}

test('compiled login starts within 1200ms when window load stalls', () => {
  const shell = makeCompiledLoginShell('loading');
  assert.equal(shell.script, null);
  shell.deadline();
  assert.equal(shell.window.document.querySelectorAll('script').length, 1);
  shell.window.dispatchEvent(new shell.window.Event('load'));
  assert.equal(shell.window.document.querySelectorAll('script').length, 1);
  assert.equal(shell.element('login-button').disabled, true);
  shell.dom.window.close();
});

test('compiled login bootstrap handles slow, failed and incomplete execution without an early submit', () => {
  const shell = makeCompiledLoginShell();
  shell.slow();
  assert.equal(shell.element('login-runtime-status').textContent, 'App is taking longer to load');
  assert.equal(shell.element('login-runtime-reload').hidden, false);
  let submits = 0;
  shell.window.triggerLoginFromUI = () => { submits++; };
  // Even partially executed runtime listeners cannot bypass the capture guard.
  shell.element('login-button').disabled = false;
  shell.element('login-button').addEventListener('click', shell.window.triggerLoginFromUI);
  shell.element('pin-code').addEventListener('keydown', shell.window.triggerLoginFromUI);
  shell.element('login-button').click();
  shell.element('pin-code').dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(submits, 0);
  shell.window.__gncAppRuntimeExecuted = true;
  shell.script.onload();
  assert.equal(shell.element('login-button').disabled, false);
  assert.equal(shell.element('login-runtime-feedback').hidden, true);
  assert.equal(shell.cleared(), true);
  assert.equal(submits, 0, 'readiness must not replay an early submission');
  shell.element('login-button').click();
  assert.equal(submits, 1, 'normal interaction resumes after readiness');
  shell.slow();
  assert.equal(shell.element('login-button').disabled, false, 'a late timer cannot relock ready Login');
  shell.dom.window.close();

  for (const mode of ['transport', 'execution']) {
    const failure = makeCompiledLoginShell();
    failure.window.triggerLoginFromUI = () => {};
    if (mode === 'transport') failure.script.onerror();
    else failure.script.onload();
    assert.equal(failure.element('login-runtime-status').textContent, 'App could not load', mode);
    assert.equal(failure.element('login-button').disabled, true, mode);
    assert.equal(failure.element('login-runtime-reload').hidden, false, mode);
    failure.dom.window.close();
  }
});
