import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260922233000_manager_season_priority_inquiry_v1.sql');
const optimization = read('supabase/migrations/20260923174000_optimize_manager_season_priority_scope.sql');
const api = read('supabase/functions/app-api/index.ts');

test('Season Priority is a service-only Manager/Admin protected Reclass extension', () => {
  for (const role of ['ADMIN', 'ADMINISTRATOR', 'MANAGER']) {
    assert.match(migration, new RegExp(`\\('${role}'\\)`));
  }
  assert.match(migration, /private\.normalized_profile_role\(actor\.role\) not in \('ADMIN', 'ADMINISTRATOR', 'MANAGER'\)/);
  assert.match(migration, /module\.managers\.view/);
  assert.match(migration, /managers\.season_priority\.submit/);
  assert.match(migration, /insert into private\.app_access_legacy_baseline[\s\S]*managers\.season_priority\.submit/);
  for (const signature of [
    'manager_season_priority_list_v1\\(uuid, text\\)',
    'submit_manager_season_priority_v1\\(uuid, text, integer, text, text\\)',
    'manager_season_priority_state_v1\\(uuid, text\\[\\]\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`));
  }
});

test('list is ready-fenced, server-selected, assignment-aware, and returns the full scope fingerprint', () => {
  assert.match(migration, /ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items/);
  assert.match(migration, /row_number\(\) over[\s\S]*season_sales_safe_numeric_v1\(m\.ptravailable\)[\s\S]*btrim\(m\.priority\)::integer asc[\s\S]*eval_work_natural_sort_key_v1\(m\.locationcode\)[\s\S]*m\.unique_id/);
  assert.match(migration, /winner_rank = 1[\s\S]*btrim\(priority\) ~ '\^\[2-4\]\$'/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.manager_season_priority_list_v1'), migration.indexOf('create or replace function private.manager_season_priority_scope_v1')), /date_completed/);
  assert.match(migration, /private\.season_sales_settings_v1\(\)->>'seasonCode'/);
  assert.match(migration, /roster_available boolean[\s\S]*exists\(select 1 from public\.ph_warehouse_assigned_items\)/);
  assert.match(migration, /case when roster_available[\s\S]*regexp_split_to_array\(coalesce\(e\.assignedto/);
  for (const field of ['sourceUid', 'ptravailable', 'source', 'currentAssignment', 'warehouseAssignedTo', 'resolvedAssignedTo', 'assignmentAuthoritative', 'noteContext', 'lineageHash', 'scopeFingerprint']) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
});

test('scope optimization preserves the protected contract and indexes every assignment row', () => {
  const scope = optimization.match(/create or replace function private\.manager_season_priority_scope_v1\(p_itemcode text\)[\s\S]*?\$function\$;/i)?.[0];
  assert.ok(scope, 'scope helper is replaced');
  assert.match(scope, /scope_rows as materialized\s*\(/i);
  assert.match(scope, /hashed_rows as materialized\s*\(/i);
  assert.match(scope, /to_jsonb\(m\)/);
  assert.match(scope, /private\.manager_season_priority_lineage_v1\(/);
  assert.match(scope, /security definer\s+set search_path = ''/i);
  const assignmentIndex = optimization.match(/create\s+index(?:\s+if\s+not\s+exists)?\s+\w+\s+on\s+public\.ph_warehouse_assigned_items\s*\([^;]*upper\(btrim\(coalesce\(itemcode_normalized,\s*itemcode,\s*''\)\)\)[^;]*;/i)?.[0];
  assert.ok(assignmentIndex, 'all-row assignment index matches the list lookup expression');
  assert.doesNotMatch(assignmentIndex, /\bwhere\b/i);
  assert.doesNotMatch(optimization, /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:public\.)?(?:ph_master_inventory|ph_warehouse_assigned_items|ph_cav_import)\b/i);
  assert.doesNotMatch(optimization, /\bgrant\b[^;]*\b(?:public|anon|authenticated)\b|\brevoke\b[^;]*\bservice_role\b|\bdisable\s+row\s+level\s+security\b/i);
});

test('submit freezes every same-item row and rotates duplicate and missing ranks without inventory writes', () => {
  assert.match(migration, /where upper\(btrim\(coalesce\(m\.itemcode, ''\)\)\) = itemcode_value[\s\S]*for share/);
  assert.match(migration, /when unique_id = source_row\.unique_id then 1/);
  assert.match(migration, /when old_priority between 1 and p_expected_priority - 1 then old_priority \+ 1/);
  assert.match(migration, /else old_priority/);
  assert.match(migration, /'seasonPriority'[\s\S]*'priority_one_rotation'/);
  assert.match(migration, /'expected'[\s\S]*'priority'[\s\S]*'lineageHash'[\s\S]*'lineage'/);
  assert.match(migration, /'proposals'[\s\S]*'priority_change'/);
  assert.match(migration, /public\.enqueue_drive_reclass_inquiry_v1/);
  assert.doesNotMatch(migration, /update public\.ph_master_inventory|insert into public\.ph_master_inventory|delete from public\.ph_master_inventory/);
});

test('active fingerprint dedupe reuses one event and the minimal receipt persists terminal acknowledgment', () => {
  assert.match(migration, /unique index manager_season_priority_one_active_fingerprint[\s\S]*where resolution is null/);
  assert.match(migration, /unique index manager_season_priority_one_active_itemcode[\s\S]*where resolution is null/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('manager-season-priority-item:' \|\| itemcode_value, 0\)\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('manager-season-priority:' \|\| request_fingerprint, 0\)\)/);
  assert.match(migration, /SEASON_PRIORITY_ITEM_PENDING/);
  assert.match(migration, /retry_drive_reclass_inquiry_v1\(original_actor, original_token\)/);
  assert.match(migration, /current_hash = pending\.expected_after_hash[\s\S]*'fulfilled'/);
  assert.match(migration, /current_hash <> pending\.before_state_hash[\s\S]*'stale'/);
  assert.match(migration, /when p_receipt\.resolution = 'stale' then 'superseded'/);
  assert.match(migration, /resolution is null/);
  assert.doesNotMatch(migration, /update public\.ph_request_delivery_outbox[\s\S]*payload\s*=/);
});

test('app API exposes only the three actor-bound Season Priority operations', () => {
  for (const operation of ['season_priority_list', 'season_priority_submit', 'season_priority_state']) {
    assert.match(api, new RegExp(`operation === "${operation}"`));
  }
  for (const rpc of ['manager_season_priority_list_v1', 'submit_manager_season_priority_v1', 'manager_season_priority_state_v1']) {
    assert.match(api, new RegExp(`supabase\\.rpc\\("${rpc}"`));
  }
  assert.match(api, /p_actor_id: activeProfile\.id/);
  assert.match(api, /function seasonPriorityErrorResponse/);
  assert.match(api, /hasOwnProperty\.call\(manualTransaction, "seasonPriority"\)[\s\S]*SEASON_PRIORITY_MARKER_RESERVED/);
  assert.doesNotMatch(api.slice(api.indexOf('if (operation === "season_priority_submit")'), api.indexOf('if (operation === "create")')), /actorUsername|recipientEmails|recipients/);
});
