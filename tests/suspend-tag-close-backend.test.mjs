import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handler = readFileSync(new URL('../supabase/functions/_shared/suspend-tag.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261014173230_suspend_tag_close_inventory_sync.sql', import.meta.url), 'utf8');
const command = migration.slice(migration.indexOf('create or replace function suspend_tag_private.command'), migration.indexOf('$$;', migration.indexOf('create or replace function suspend_tag_private.command')) + 3);

test('Suspend Tag close is editor-only, versioned, receipt-backed, and cancels review without sending email', () => {
  assert.match(handler, /\['rows',\s*'save',\s*'complete',\s*'close',\s*'send'/);
  assert.match(handler, /!\['rows',\s*'approval',\s*'decide'\]\.includes\(operation\)/);
  assert.match(command, /select \* into receipt from suspend_tag_private\.commands[\s\S]*?if found then[\s\S]*?return receipt\.response;/);
  assert.match(command, /if p_operation='close' then[\s\S]*?perform suspend_tag_private\.validate_review\(s\);[\s\S]*?status='superseded'[\s\S]*?suspend=null,suspend_to=null[\s\S]*?status='completed'/);
  assert.match(command, /'inventoryRow',/);
  const closeBranch = command.slice(command.indexOf("if p_operation='close' then"), command.indexOf("elsif p_operation='send' then"));
  assert.doesNotMatch(closeBranch, /request_approval|ph_request_delivery_outbox/);
});

test('inventory evidence synchronization is exact, ambiguity-safe, and refreshes AV rule evidence timestamps', () => {
  assert.match(command, /candidate_count/);
  assert.match(command, /SUSPEND_TAG_INVENTORY_AMBIGUOUS/);
  assert.match(command, /last_updated=greatest\(clock_timestamp\(\),coalesce\(m\.last_updated,'-infinity'::timestamptz\)\+interval '1 microsecond'\)/);
  assert.match(command, /av_rule_spec_updated_at/);
  assert.match(command, /av_rule_match_updated_at/);
  assert.match(command, /av_rule_photo_updated_at/);
  assert.match(command, /av_rule_bundle_updated_at/);
});
