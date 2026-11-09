import assert from 'node:assert/strict';

export async function readDefaultOwnerReplayPolicy(db) {
  const { rows } = await db.query(`
    select exists(select 1 from supabase_migrations.schema_migrations where version='20261030220000') as last_write_wins
  `);
  return rows[0].last_write_wins ? 'last-write-wins' : 'revision-conflict';
}

export function assertDefaultOwnerCompetition(policy, competing) {
  const accepted = competing.filter(result => result.status === 'fulfilled');
  const rejected = competing.filter(result => result.status === 'rejected');
  const revisions = accepted.map(result => result.value.rows[0].result.defaults[0].revision).sort((a, b) => a - b);
  if (policy === 'last-write-wins') {
    assert.equal(rejected.length, 0, rejected[0]?.reason?.message);
    assert.deepEqual(revisions, [1, 2], 'both edits receive their committed last-write-wins revision');
    return;
  }
  assert.equal(policy, 'revision-conflict');
  assert.deepEqual(revisions, [1], 'one edit receives the original optimistic revision');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, '40001');
  assert.equal(rejected[0].reason.message, 'ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT');
}
