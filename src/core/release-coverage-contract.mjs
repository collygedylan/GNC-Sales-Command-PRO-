import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

export function blockClearingBridgeContract(root) {
  const source=readFileSync(path.join(root,'tests/block-clearing.e2e.spec.ts'),'utf8');
  assert.match(source,/const lexicalTestBridge =/);
  assert.match(source,/__blockClearingTestEval = \(source\) => eval\(source\)/);
  assert.match(source,/live-app-runtime-v/);
  assert.match(source,/url\.pathname\.endsWith\('\/assets\/app-runtime\.js'\)/);
  assert.equal((source.match(/body: \(await response\.text\(\)\) \+ lexicalTestBridge/g)||[]).length,2);
  assert.match(source,/await page\.waitForFunction\(\(\) => typeof \(window as any\)\.__blockClearingTestEval === 'function'\)/);
  assert.doesNotMatch(source,/writeFile|copyFile/);
}
