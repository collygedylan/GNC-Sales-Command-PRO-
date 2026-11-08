import assert from 'node:assert/strict';
import { harness, source, acknowledgement, button } from '../../tests/helpers/suspend-completion-fixture.mjs';

export async function lateSuspendReceiptChecks() {
  for (const switchUser of [false, true]) {
    let resolve;
    const h = harness({ api: () => new Promise((done) => { resolve = done; }) });
    const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
    await new Promise(setImmediate);
    h.ctx.currentSource = { ...source(), LAST_UPDATED: '2026-09-08T15:50:48Z' };
    h.ctx.socInventory[0] = h.ctx.currentSource;
    if (switchUser) h.ctx.currentUser = 'jd_jones';
    resolve(acknowledgement());
    await pending;
    assert.equal(h.ctx.currentSource.DATE_COMPLETED, '');
    if (switchUser) assert.equal(h.row.DATE_COMPLETED, '');
  }
}
