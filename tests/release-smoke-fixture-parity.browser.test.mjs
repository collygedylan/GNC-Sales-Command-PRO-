// Production-volume fixture parity and timing execute only in the nightly node-browser lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createPreindexedMasterPageFixture } from './fixtures/preindexed-master-page-fixture.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

test('preindexed 9,487-row pages match canonical outputs under 5 ms per page', t => {
  const snapshot = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8'));
  assert.equal(snapshot.masterRows.length, 9487);
  const fixture = createPreindexedMasterPageFixture(snapshot.masterRows);
  assert.equal(fixture.rowCount, 9487);

  for (const projection of ['browse', 'full']) {
    for (let offset = 0; offset < snapshot.masterRows.length; offset += 500) {
      const request = { dataset: 'master', projection, offset, limit: 500 };
      const actual = fixture.readPage(request);
      const expected = inventoryReadFixture.readMasterPage(snapshot.masterRows, request);
      assert.deepEqual(actual, expected, `${projection} page at ${offset} must preserve exact canonical output`);
    }
  }
  for (const boundary of [
    { dataset: 'master', projection: 'browse', offset: 9487, limit: 500 },
    { dataset: 'master', projection: 'full', offset: 9500, limit: 500 },
    { dataset: 'master', projection: 'browse', offset: 9400, limit: 500 },
  ]) assert.deepEqual(fixture.readPage(boundary), inventoryReadFixture.readMasterPage(snapshot.masterRows, boundary));
  assert.throws(() => fixture.readPage({ dataset: 'master', projection: 'full', season: 'F1' }), /unexpected page parameter/);
  assert.throws(() => fixture.readPage({ dataset: 'master', projection: 'browse', offset: -1 }), /invalid page bounds/);
  const lookupId = String(snapshot.masterRows[4750].UNIQUE_ID);
  assert.deepEqual(fixture.readPage({ dataset: 'lookup', projection: 'full', offset: 0, limit: 1, uniqueId: lookupId }),
    inventoryReadFixture.readMasterPage(snapshot.masterRows, { dataset: 'lookup', projection: 'full', offset: 0, limit: 1, uniqueId: lookupId }));

  const requests = Array.from({ length: 19 }, (_, index) => ({ dataset: 'master', projection: 'browse', offset: index * 500, limit: 500 }));
  for (const request of requests) fixture.readPage(request); // warm the page/shape paths
  const elapsed = requests.flatMap(request => Array.from({ length: 20 }, () => {
    const started = performance.now();
    fixture.readPage(request);
    return performance.now() - started;
  }));
  const worst = Math.max(...elapsed);
  t.diagnostic(`PREINDEXED_PAGE_METRIC rows=9487 samples=${elapsed.length} max_ms=${worst.toFixed(3)}`);
  assert.ok(worst < 5, `worst individual page call was ${worst.toFixed(3)} ms`);
});
