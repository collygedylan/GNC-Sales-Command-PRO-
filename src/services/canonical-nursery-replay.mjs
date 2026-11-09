const nurseryMigration = '20261101030000_agdata_v23127_nursery_command.sql';
const seedLiteral = /\$nursery_seed\$([\s\S]*?)\$nursery_seed\$(?=::jsonb)/g;
const maxLiteralLength = 16_384;
const seedTable = 'pg_temp.ci_nursery_seed_fragments';

function chunkSeedLiteral(payload, seedId) {
  const chunks = [];
  for (let start = 0; start < payload.length;) {
    let end = Math.min(start + maxLiteralLength, payload.length);
    const next = payload.charCodeAt(end);
    if (next >= 0xdc00 && next <= 0xdfff) end--;
    const literal = `$nursery_seed$${payload.slice(start, end)}$nursery_seed$`;
    chunks.push(`insert into ${seedTable} values (${seedId},${chunks.length},${literal});`);
    start = end;
  }
  return chunks.join('\n');
}

// Keep each original target INSERT and its exact JSON text while bounding CLI statements.
export function splitCanonicalNurseryReplaySeed(source, migrationName) {
  if (migrationName !== nurseryMigration) return source;
  const seeds = [];
  const replay = source.replace(seedLiteral, (literal, payload) => {
    if (payload.length <= maxLiteralLength) return literal;
    if (!payload.startsWith('[') || !payload.endsWith(']')) throw new Error('DATABASE_NURSERY_SEED_ARRAY_INVALID');
    const seedId = seeds.length;
    seeds.push(chunkSeedLiteral(payload, seedId));
    return `(select string_agg(fragment,'' order by ordinal) from ${seedTable} where seed_id=${seedId})`;
  });
  if (seeds.length === 0) return replay;
  const begin = /^BEGIN;\r?\n/;
  if (!begin.test(replay)) throw new Error('DATABASE_NURSERY_SEED_TRANSACTION_REQUIRED');
  const prelude = ['-- Begin disposable Nursery seed fragments',
    'create temp table ci_nursery_seed_fragments(seed_id integer,ordinal integer,fragment text) on commit drop;',
    ...seeds, '-- End disposable Nursery seed fragments', ''].join('\n');
  return replay.replace(begin, match => match + prelude);
}
