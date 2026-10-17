import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261017203000_bunch_note_multi_assignment_routing.sql', 'utf8');

test('multi assignment relation preserves legacy ownership and validates active recipients', () => {
  assert.match(sql, /bunch_note_card_assignees[\s\S]*primary key \(bunch_note_id,card_id,user_id\)/);
  assert.match(sql, /insert into bunch_note_private\.bunch_note_card_assignees[\s\S]*select bunch_note_id,card_id,owner_id/);
  assert.match(sql, /create or replace function bunch_note_private\.card_allowed[\s\S]*user_id=p_actor/);
  assert.match(sql, /normalize_work_cards[\s\S]*owner_ids[\s\S]*active_card_owner/);
});

test('card RPC assigns all recipients atomically and preserves single owner compatibility', () => {
  assert.match(sql, /create or replace function bunch_note_private\.card_command/);
  assert.match(sql, /if jsonb_typeof\(p_payload->'owner_ids'\)='array' then[\s\S]*active_card_owner\(owner\)[\s\S]*set owner_id=owner/);
  assert.match(sql, /claim_card[\s\S]*insert into bunch_note_private\.bunch_note_card_assignees/);
  assert.match(sql, /release_card[\s\S]*delete from bunch_note_private\.bunch_note_card_assignees/);
  assert.match(sql, /card.status<>'open'[\s\S]*bunch_note_card_assignees ca[\s\S]*p_operation='actual'/);
});

test('workflow routing accepts only move, bunch, and TA plans without stock writes', () => {
  assert.match(sql, /workflow_action in \('','move','bunch','ta'\)/);
  for (const house of ['South House','North House','Center House','South & Center House','North & Center House','East House','West House','East & Center House','West & Center House']) assert.ok(sql.includes(house));
  assert.match(sql, /destination_location text not null default ''/);
  assert.match(sql, /destination_house text not null default ''/);
  assert.doesNotMatch(sql, /update\s+(?:public\.)?inventory\b/i);
});



test('worker projection preserves existing actuals and limits unrelated cards while exposing assignments', () => {
  assert.match(sql, /create or replace function bunch_note_private\.card_safe_job[\s\S]*card_ids uuid\[\][\s\S]*worker_actions_json[\s\S]*actuals_json[\s\S]*audit_json/);
  assert.match(sql, /author or exists\(select 1 from bunch_note_private\.bunch_note_card_assignees ca[\s\S]*owner_ids[\s\S]*owner_names/);
  assert.match(sql, /card_instruction_snapshot[\s\S]*card-'owner_id'-'owner_name'-'owner_ids'-'owner_names'/);
  assert.match(sql, /create or replace function bunch_note_private\.card_destination_view[\s\S]*ca\.user_id=p_actor\.id[\s\S]*wc\.owner_id=p_actor\.id/);
});

test('revisions preserve relational assignments when owner fields stay unchanged and allow legacy empty routes', () => {
  assert.match(sql, /prior_card->'owner_ids' is not distinct from c->'owner_ids'[\s\S]*bunch_note_card_assignees/);
  assert.match(sql, /route not in \('move','bunch','ta',''\)[\s\S]*route='' and \(destination_location<>'' or destination_house<>''\)/);
  assert.match(sql, /if author then[\s\S]*delete from bunch_note_private\.bunch_note_card_assignees[\s\S]*user_id=actor\.id[\s\S]*released',true/);
});
