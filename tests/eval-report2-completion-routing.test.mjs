import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260901201209_eval_report2_completion_routing.sql');
const appApi = read('../supabase/functions/app-api/index.ts');
const html = read('../index.html');

test('Eval Reports #2 completion routing is server-owned and submitter-aware', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /add column if not exists submitted_by_username text/);
  assert.match(migration, /create or replace function private\.eval_work_report2_completion_emails_v4\(p_submitter_username text\)/);
  for (const username of ['dylan_collyge', 'megan_kelly', 'sharon_combs']) {
    assert.match(migration, new RegExp(`'${username}'`));
  }
  assert.match(migration, /select 'jd_jones'[\s\S]*p_submitter_username[\s\S]*= 'jd_jones'/);
  assert.match(migration, /p\.disabled_at is null/);
  assert.match(migration, /p\.locked_until is null or p\.locked_until <= now\(\)/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(migration, /expected_recipient_count := case when submitter_username = 'jd_jones' then 4 else 3 end/);
  assert.match(migration, /new\.completion_recipients := required_recipients/);
  assert.doesNotMatch(migration, /p_payload->'completionRecipients'/);
  assert.match(migration, /revoke all on function private\.eval_work_report2_completion_emails_v4\(text\)[\s\S]*from public, anon, authenticated/);
});

test('the actual assigned evaluator is authorized and audited instead of the compatibility lead', () => {
  assert.match(migration, /lower\(actor\.username\) = any\(coalesce\(work\.assignee_usernames/);
  assert.match(migration, /submitted_by_username = lower\(actor\.username\)/);
  assert.match(appApi, /p_actor_username: operation === "submit" \? actor : normalizeUsername\(row\.assignee_username\)/);
  assert.doesNotMatch(appApi, /p_actor_username: normalizeUsername\(row\.assignee_username\)/);
});

test('Manager Eval Reports #2 is tagged distinctly from Drive Mode and explains Queue completion delivery', () => {
  assert.match(appApi, /sourceMode: String\(contextInput\.sourceMode/);
  assert.match(html, /reportContext: \{[\s\S]*sourceMode,[\s\S]*reportId:/);
  assert.match(migration, /report_context->>'sourceMode'[\s\S]*= 'eval-report-2'/);
  assert.match(migration, /report_context->>'reportId'[\s\S]*<> 'drive-mode'/);
  assert.match(html, /Dylan, Megan, and Sharon; JD is added only if he submits it/);
  assert.match(html, /The completed Item Inquiry will email automatically after every row is Done or No Action/);
  assert.match(html, /getEvalWorkCompletionRecipientCopy\(work\)/);
  assert.match(html, /required Item Inquiry reviewer does not currently have an active verified email/);
  assert.match(html, /manager-eval2-batch-recipient-button[\s\S]*classList\.toggle\('hidden', isReport2\)/);
});
