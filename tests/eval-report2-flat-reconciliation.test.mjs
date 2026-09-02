import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260902002912_flatten_eval_reports_2_and_reconcile_work.sql');
const appApi = read('../supabase/functions/app-api/index.ts');
const codeGs = read('../Code.gs');
const html = read('../index.html');

test('flat Eval Reports #2 cards show every current row and separate selection from card activation', () => {
  assert.match(html, /function getManagerEvalReport2AllCurrentAssignedRows/);
  assert.match(html, /safeGroup\.rows[\s\S]*LOCATIONCODE[\s\S]*LOTCODE[\s\S]*PTRONHAND[\s\S]*PTRAVAILABLE/);
  assert.match(html, /data-role="manager-eval2-selection-toggle"[\s\S]*event\.stopPropagation\(\)/);
  assert.match(html, /onclick="return openManagerEvalReport2DirectInquiry/);
  assert.match(html, /openArgosInventoryTransactionModal\(uid, 'reclass', 'eval-report-2'\)/);
  assert.match(html, /getManagerEvalReport2RenderedItemGroups\(\)/);
  assert.match(html, /managerEvalReport2VisibleItemLimit=20/);
  assert.match(html, /Load .* more ITEMCODE/);
  assert.doesNotMatch(html, /\$\{modeButton\('inquiry'/);
  assert.doesNotMatch(html, /originRows\.length > 100/);
});

test('protected batch creation recomputes report membership and permits partial success', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /create or replace function private\.eval_report2_item_qualifies_v1/);
  assert.match(migration, /create or replace function public\.create_eval_report2_batch_v1/);
  assert.match(migration, /private\.eval_report2_item_qualifies_v1\(report_id, itemcode, now\(\)\)/);
  assert.match(migration, /'result', 'already_resolved'/);
  assert.match(migration, /'partial_success'/);
  assert.match(migration, /create_old_clause[\s\S]*jsonb_array_length\(context_rows\) > 100/);
  assert.match(migration, /replace\(definition, create_old_clause, create_new_clause\)/);
  assert.match(appApi, /operation === "report_page"/);
  assert.match(appApi, /create_eval_report2_batch_v1/);
  assert.match(appApi, /resolvedItemcodes/);
  assert.match(html, /outcome === 'already_resolved'/);
  assert.match(html, /Eval Work Partially Queued/);
});

test('canonical imports close cleared report work without a completion delivery', () => {
  assert.match(migration, /check \(status in \('open', 'in_progress', 'submitted', 'cancelled', 'resolved_import'\)\)/);
  assert.match(migration, /create or replace function public\.reconcile_eval_report2_work_v1/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /p_dry_run boolean default true/);
  assert.match(migration, /set status = 'resolved_import'/);
  assert.match(migration, /'deliveryQueued', false/);
  assert.match(migration, /'deliveryEventsCreated', 0/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.reconcile_eval_report2_work_v1')), /insert into public\.ph_request_delivery_outbox/);
  assert.match(codeGs, /reconcile_eval_report2_work_v1/);
  assert.match(codeGs, /evalReport2ResolvedCount/);
  assert.match(html, /Resolved by Import/);
  assert.match(html, /preserved — no completion email/);
});

test('report predicates preserve Y and U3 SHFT exclusions and configured rules', () => {
  assert.match(migration, /p_season[\s\S]*in \('Y', 'U3'\)[\s\S]*like '%SHFT%'/);
  for (const reportId of ['s1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1']) {
    assert.match(migration, new RegExp(`'${reportId}'`));
  }
  assert.match(migration, /ph_eval_report_settings/);
  assert.match(migration, /low_stock_max_slts/);
  assert.match(migration, /hold_age_days/);
  assert.match(migration, /location_note_age_days/);
});

test('direct and assignment recipient contracts are server-owned', () => {
  assert.match(migration, /get_eval_report2_direct_inquiry_recipients_v1/);
  for (const username of ['dylan_collyge', 'megan_kelly', 'sharon_combs']) {
    assert.match(migration, new RegExp(`'${username}'`));
  }
  assert.match(migration, /actor_username = 'jd_jones'/);
  assert.match(migration, /p\.disabled_at is null/);
  assert.match(migration, /p\.locked_until is null or p\.locked_until <= now\(\)/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(codeGs, /get_eval_report2_direct_inquiry_recipients_v1/);
  assert.match(codeGs, /expectedCount = actorKey === 'jd_jones' \? 4 : 3/);
  assert.match(migration, /assignmentRecipients/);
  assert.match(migration, /array_append\(usernames, 'jd_jones'\)/);
});

test('new operations are service-only', () => {
  for (const signature of [
    'public.create_eval_report2_batch_v1(jsonb)',
    'public.get_eval_report2_direct_inquiry_recipients_v1(text)',
    'public.list_eval_report2_itemcodes_v1(jsonb)',
    'public.reconcile_eval_report2_work_v1(text, boolean, integer)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(migration, new RegExp(`revoke all on function ${escaped} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function ${escaped} to service_role`));
  }
});
