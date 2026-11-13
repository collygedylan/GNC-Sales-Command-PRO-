import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { harness } from '../../tests/helpers/suspend-completion-fixture.mjs';

test('Suspend actions respect row access for reviewed and denied users', () => {
  const h = harness();
  vm.runInContext(readFileSync(new URL('../../assets/row-access-policy.js', import.meta.url), 'utf8'), h.ctx);
  h.ctx.verifiedEvidenceActor = () => ({ actor: h.ctx.currentUser, matrix: { view_permissions: { view_que: 'Y' } } });
  h.ctx.resolveCanonicalRowAccess = () => ({ canEdit: h.ctx.allowed });
  for (const status of ['awaiting_rep', 'approved']) {
    h.mirror.suspend_tag_status = status;
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), true);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'edit'), true);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'complete'), true);
  }
  h.ctx.allowed = false;
  assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), false);
});
