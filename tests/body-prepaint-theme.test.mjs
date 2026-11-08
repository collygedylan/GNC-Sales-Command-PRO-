import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/body-prepaint-theme.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('body theme is applied synchronously before the application content', () => {
  const script = shell.indexOf('src="./assets/body-prepaint-theme.js');
  assert.ok(script > shell.indexOf('<body ') && script < shell.indexOf('id="app-wrapper"'));
  for (const [saved, expected] of [['dark', 'dark'], ['light', 'light'], ['unexpected', 'light']]) {
    const document = { body: { dataset: {}, style: {} } };
    vm.runInNewContext(source, { window: { __GNC_PREPAINT_THEME__: saved }, document });
    assert.deepEqual(document.body.dataset, { opsTheme: expected, opsThemeMode: expected });
    assert.equal(document.body.style.colorScheme, expected);
  }
});
