import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = 'docs/architecture/gem-contracts.json';
const marker = '<!-- GEM-BUS:START -->';
const endMarker = '<!-- GEM-BUS:END -->';
const read = (base, file) => fs.readFileSync(path.join(base, file), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export function validateIncident(incident, catalog) {
  for (const key of ['id', 'rootCause', 'rule', 'assertion', 'evidence']) {
    if (typeof incident[key] !== 'string' || !incident[key].trim()) throw Error('INCIDENT_FIELD_REQUIRED:' + key);
  }
  if (!Array.isArray(incident.owners) || !incident.owners.length || incident.owners.some(n => !catalog.gems.some(g => g.name === n))) throw Error('INCIDENT_OWNER_INVALID');
  if (!Array.isArray(incident.affected) || !incident.affected.length) throw Error('INCIDENT_AFFECTED_REQUIRED');
  if (/\b(?:sb_secret_|sbp_)|Bearer\s+\S+/i.test(JSON.stringify(incident))) throw Error('INCIDENT_SECRET_FORBIDDEN');
  return incident;
}

export function renderGemContract(gem, catalog) {
  const incidents = catalog.incidents.filter(i => i.owners.includes(gem.name) || i.owners.includes(gem.twin));
  return [marker, '## Shared Engineering Contract', '',
    `Scope: ${gem.scope}`, '', '### Exact ownership',
    ...gem.ownership.map(o => `- ${o.file}: ${o.symbols.length ? o.symbols.join(', ') : 'module contract'}.`),
    `- DOM: ${gem.selectors.join(', ') || 'No DOM mutation owned; inspect the consuming domain.'}`,
    `- PostgreSQL: ${gem.relations.join(', ') || 'No independent SQL writes owned.'}`,
    'Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.', '',
    '### Preconditions',
    'Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.', '',
    '### Postconditions and invariant equations',
    ...gem.rules.map(rule => `- ${rule}`),
    '- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.',
    '- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.', '',
    '### Cross-Gem Dependencies',
    `Read contracts from: ${gem.dependencies.join(', ')}. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: ${gem.twin}.`, '',
    '### Runnable verification',
    ...gem.commands.map(command => `- \`${command}\``),
    '- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname=\'supabase_realtime\';`',
    'Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.', '',
    '### Forbidden Anti-Patterns (Never Repeat)',
    ...gem.forbidden.map(rule => `- ${rule}`),
    ...incidents.map(i => `- ${i.id}: ${i.rootCause} ${i.rule} Permanent assertion: ${i.assertion}. Evidence: ${i.evidence}.`),
    'Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.', endMarker].join('\n');
}

export function synchronizeGemBus({ base = root, check = false, incident } = {}) {
  const catalog = JSON.parse(read(base, catalogPath));
  if (incident) {
    validateIncident(incident, catalog);
    const previous = catalog.incidents.find(i => i.id === incident.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(incident)) throw Error('INCIDENT_APPEND_ONLY');
    if (!previous) catalog.incidents.push(incident);
  }
  const names = new Set(catalog.gems.map(g => g.name));
  if (catalog.required.length !== 118 || new Set(catalog.required).size !== 118 || catalog.required.some(n => !names.has(n))) throw Error('REQUIRED_GEM_CATALOG_INVALID');
  if (names.size !== catalog.gems.length) throw Error('DUPLICATE_GEM');
  const writes = new Map();
  const nodes = catalog.gems.map(gem => {
    if (!names.has(gem.twin) || catalog.gems.find(g => g.name === gem.twin).twin !== gem.name || gem.dependencies.some(n => !names.has(n))) throw Error('GEM_GRAPH_INVALID:' + gem.name);
    const file = `.codex/skills/${gem.name}/SKILL.md`;
    const source = read(base, file);
    const block = renderGemContract(gem, catalog);
    const start = source.indexOf(marker), end = source.indexOf(endMarker);
    if ((start < 0) !== (end < 0) || end >= 0 && end < start) throw Error('GEM_BLOCK_CORRUPT:' + gem.name);
    const next = start < 0 ? source.trimEnd() + '\n\n' + block + '\n' : source.slice(0, start) + block + source.slice(end + endMarker.length);
    if (next !== source) writes.set(file, next);
    return { name: gem.name, twin: gem.twin, group: gem.group, dependencies: gem.dependencies,
      subscribers: catalog.gems.filter(g => g.dependencies.includes(gem.name)).map(g => g.name),
      contracts: gem.rules, ownership: gem.ownership, skillDigest: hash(next),
      incidents: catalog.incidents.filter(i => i.owners.includes(gem.name) || i.owners.includes(gem.twin)).map(i => i.id) };
  });
  for (const item of catalog.incidents) validateIncident(item, catalog);
  const bus = { schemaVersion: 1, requiredCount: 118, totalCount: nodes.length, catalogDigest: hash(JSON.stringify(catalog)),
    automaticTriggers: ['pre-commit', 'AGENTS task start/completion'],
    limitation: 'Only supplied, reviewed evidence is ingested. No access to other chats; no autonomous production writes.', nodes };
  const ledger = ['# Gem incident ledger', '', 'Recorded evidence only. Historical entries preserve source attribution; they are not new live verification.', '',
    ...catalog.incidents.flatMap(i => [`## ${i.id}`, `Owners: ${i.owners.join(', ')}`, `Affected: ${i.affected.join(', ')}`, `Root cause: ${i.rootCause}`, `Rule: ${i.rule}`, `Assertion: ${i.assertion}`, `Evidence: ${i.evidence}`, '']),
    '## Historical source contracts', ...catalog.history.map(h => `- ${h.source}: ${h.rule}`), ''].join('\n');
  for (const [file, value] of [[catalogPath, JSON.stringify(catalog, null, 2) + '\n'], ['.gnc-local/gem-shared-memory-bus.json', JSON.stringify(bus, null, 2) + '\n'], ['.gnc-local/gem-incident-ledger.md', ledger]]) {
    let before; try { before = read(base, file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before !== value) writes.set(file, value);
  }
  if (check && writes.size) throw Error('GEM_SYNC_REQUIRED:' + [...writes.keys()].join(','));
  if (!check) for (const [file, value] of writes) { fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true }); fs.writeFileSync(path.join(base, file), value); }
  return { required: 118, total: nodes.length, incidents: catalog.incidents.length, changedFiles: writes.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--incident');
  const incident = index < 0 ? undefined : JSON.parse(fs.readFileSync(args[index + 1], 'utf8'));
  console.log(JSON.stringify(synchronizeGemBus({ check: args.includes('--check'), incident })));
}
