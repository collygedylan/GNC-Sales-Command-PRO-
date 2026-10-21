import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// @test-group: @reclass-inquiry,@release-smoke
const html = readComposedAppSource();
function model(user, sourceView) {
  const start = html.indexOf('        function getInventoryTransactionRequiredRecipientEmails(');
  const end = html.indexOf('        function generateArgosInventoryTransactionId(', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({
    INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_USERS: ['dylan_collyge', 'megan_kelly'],
    currentUser: user, currentUserDisplay: user,
    argosInventoryTransactionState: { sourceView, restoredRecipientEmails: ['jd_jones@greenleafnursery.com'] },
    getArgosInventoryTransactionActorEmail: () => `${user}@greenleafnursery.com`,
    resolveRequestRecipientEmail: name => `${name}@greenleafnursery.com`,
    dedupeRequestEmailRecipients: values => [...new Set(values.filter(Boolean).map(value => value.toLowerCase()))],
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    openGroupedBloomNcrRecipientModal: () => { throw Error('Reclass must not allow extra recipients'); },
  });
  vm.runInContext(html.slice(start, end), context);
  return context;
}

test('all Reclass previews contain only Dylan, Megan and the authenticated submitter', async () => {
  for (const view of ['eval-report-2', 'suspend-tag', 'av', 'item-inquiry']) {
    for (const user of ['dylan_collyge', 'megan_kelly', 'field_user', 'jd_jones', 'sunday_ellis']) {
      const context = model(user, view);
      const payload = await context.applyArgosInventoryTransactionEmailRecipients({
        actor: { email: 'forged@example.test' }, recipientEmails: ['extra@example.test'],
      });
      assert.deepEqual(Array.from(payload.recipientEmails).sort(),
        [...new Set(['dylan_collyge', 'megan_kelly', user])].map(name => `${name}@greenleafnursery.com`).sort());
    }
  }
});

test('Drive Reclass delegates recipients and actor identity to the authenticated server', async () => {
  const context = model('field_user', 'drive');
  const payload = await context.applyArgosInventoryTransactionEmailRecipients({
    actor: { email: 'forged@example.test' }, recipientEmails: ['extra@example.test'],
    emailRecipients: ['extra@example.test'], recipients: [{ email: 'extra@example.test' }],
    sourceContext: { sourceMode: 'drive' },
  });
  for (const key of ['actor', 'recipientEmails', 'emailRecipients', 'recipients']) assert.equal(key in payload, false);
});

test('Reclass fallback defaults do not retain the previous extra recipient list', () => {
  assert.match(html, /const INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_USERS = Object\.freeze\(\['dylan_collyge', 'megan_kelly'\]\)/);
});
