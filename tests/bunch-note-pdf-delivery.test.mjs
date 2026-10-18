import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBunchCompletionPdf } from '../supabase/functions/_shared/bunch-note-pdf-delivery.ts';

const event = overrides => ({
  event_type: 'bunch_note_submission',
  status: 'processing',
  lease_token: 'lease-1',
  event_id: 'event-1',
  payload: { automatic_completion: true, report_kind: 'completed_work', preview_id: 'preview-1' },
  ...overrides,
});

test('completion PDF requires an active outbox lease before reading frozen delivery data', async () => {
  let rpcCalls = 0;
  await assert.rejects(ensureBunchCompletionPdf({
    event: event({ status: 'pending', lease_token: null }),
    rpc: async () => { rpcCalls += 1; return { data: {}, error: null }; },
    lookupProfile: async () => null,
    render: async () => [],
  }), /BUNCH_NOTE_DELIVERY_LEASE_REQUIRED/);
  assert.equal(rpcCalls, 0);
});

test('completion PDF renders server-owned report and freezes exactly the returned bytes once', async () => {
  const rendered = [{ job_id: 'job-1', filename: 'completed-work.pdf', base64: 'cGRmLWJ5dGVz' }];
  const calls = [];
  let renderCount = 0;
  const result = await ensureBunchCompletionPdf({
    event: event(),
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'bunch_note_delivery_lookup_v1') return { data: {
        preview_id: 'preview-1', created_by: 'actor-1', pdfs: null, reports: [{ report_kind: 'completed_work' }],
      }, error: null };
      return { data: { pdfs: rendered }, error: null };
    },
    lookupProfile: async id => id === 'actor-1' ? { username: 'crew.one', displayName: 'Crew One' } : null,
    render: async (reports, preparedBy) => {
      renderCount += 1;
      assert.deepEqual(reports, [{ report_kind: 'completed_work' }]);
      assert.equal(preparedBy, 'Crew One');
      return rendered;
    },
  });
  assert.equal(result, 'frozen');
  assert.equal(renderCount, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'bunch_note_delivery_lookup_v1');
  assert.equal(calls[1].name, 'bunch_note_freeze_pdfs_v1');
  assert.equal(calls[1].args.p_preview_id, 'preview-1');
  assert.deepEqual(calls[1].args.p_pdfs, rendered);
});

test('already-frozen completion bytes are preserved without a second render or freeze', async () => {
  let renderCount = 0;
  let freezeCount = 0;
  const frozen = [{ job_id: 'job-1', filename: 'completed-work.pdf', base64: 'original-bytes' }];
  const result = await ensureBunchCompletionPdf({
    event: event(),
    rpc: async name => {
      if (name === 'bunch_note_delivery_lookup_v1') return { data: { preview_id: 'preview-1', pdfs: frozen }, error: null };
      freezeCount += 1;
      return { data: {}, error: null };
    },
    lookupProfile: async () => null,
    render: async () => { renderCount += 1; return []; },
  });
  assert.equal(result, 'already_frozen');
  assert.equal(renderCount, 0);
  assert.equal(freezeCount, 0);
});
