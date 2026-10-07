import test from 'node:test';
import assert from 'node:assert/strict';
import { latestMigrationFunctionDefinition } from '../scripts/migration-function-source.mjs';

const target = {
  schema: 'suspend_tag_private',
  name: 'command',
  argumentTypes: ['uuid', 'text', 'jsonb', 'uuid', 'bigint'],
};

test('discovers the latest exact SuspendTag command body from active migrations', () => {
  const definition = latestMigrationFunctionDefinition(target);
  assert.match(definition, /update public\.ph_request_delivery_outbox as outbox/i);
  assert.match(definition, /where outbox\.event_id in\s*\(select request_event_id/i);
  assert.match(definition, /and outbox\.status\s*=\s*'failed'/i);
  assert.doesNotMatch(definition, /where event_id in\s*\(select request_event_id/i);
});

test('orders injected migration sources and ignores later unrelated overloads', () => {
  const sources = [
    {
      filename: '20261003_unrelated_overload.sql',
      sql: `CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation integer)
        RETURNS integer LANGUAGE sql AS $$ SELECT p_operation $$;`,
    },
    {
      filename: '20261002_original.sql',
      sql: `CREATE OR REPLACE FUNCTION suspend_tag_private.command(
        p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint
      ) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"version":"old"}'::jsonb $$;`,
    },
    {
      filename: '20261004_repair.sql',
      sql: `CREATE OR REPLACE FUNCTION suspend_tag_private.command(
        p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint
      ) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"version":"fixed"}'::jsonb $$;`,
    },
  ];
  const definition = latestMigrationFunctionDefinition({ ...target, sources });
  assert.match(definition, /version.*fixed/);
  assert.doesNotMatch(definition, /version.*old/);
});

test('fails closed when an exact target function signature is absent', () => {
  assert.throws(() => latestMigrationFunctionDefinition({
    ...target,
    sources: [{
      filename: '20261002_other_signature.sql',
      sql: `CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation integer)
        RETURNS integer LANGUAGE sql AS $$ SELECT p_operation $$;`,
    }],
  }), /MIGRATION_FUNCTION_DEFINITION_NOT_FOUND/);
});

test('quoted identifiers remain case sensitive when selecting a function', () => {
  const definition = (schema, value) => `CREATE OR REPLACE FUNCTION ${schema}.command(
    p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint
  ) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"value":"${value}"}'::jsonb $$;`;
  const actual = latestMigrationFunctionDefinition({ ...target, sources: [
    { filename: '20261001_expected.sql', sql: definition('SUSPEND_TAG_PRIVATE', 'correct') },
    { filename: '20261002_other_schema.sql', sql: definition('"SUSPEND_TAG_PRIVATE"', 'wrong') },
  ] });
  assert.match(actual, /correct/);
  assert.doesNotMatch(actual, /wrong/);
});

test('fails closed if the latest migration defines the same exact signature twice', () => {
  const definition = `CREATE OR REPLACE FUNCTION suspend_tag_private.command(
    p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint
  ) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`;
  assert.throws(() => latestMigrationFunctionDefinition({
    ...target,
    sources: [{ filename: '20261004_duplicate.sql', sql: `${definition}\n${definition}` }],
  }), /MIGRATION_FUNCTION_DEFINITION_AMBIGUOUS/);
});
