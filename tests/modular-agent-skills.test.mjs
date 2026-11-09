import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const replacementSkills = [
  'agdata-core-sync',
  'agdata-canonical-engine',
  'agdata-views-workflows',
  'agdata-ui-shell',
  'agdata-services-release',
  'gnc-production-schedule-pipeline',
  'gnc-bunch-notes-and-hydro-engine',
  'gnc-nursery-stage-operations',
  'argos-erp-operations-and-orders',
  'argos-erp-finance-and-mobile-ui'
];

const gncSourceSkills = [
  'gnc-2027-production-optimizer',
  'gnc-prod-schedule-demand-cutoff-analyst',
  'gnc-sheet-header-architect',
  'gnc-future-inventory-reconciler',
  'nursery-production-reconciler',
  'gnc-president-master-orchestrator',
  'gnc-cross-sheet-bunch-notes-linker',
  'gnc-consolidation-agent',
  'gnc-bed-and-hydro-supervisor',
  'gnc-bunch-notes-and-schedule-ingest',
  'gnc-bunch-notes-rule-and-issue-auditor',
  'gnc-bunch-notes-multi-hop-sequencer',
  'gnc-bunch-notes-crew-and-ribbon-dispatcher',
  'gnc-sticking-agent',
  'gnc-cuttings-agent',
  'gnc-planting-agent',
  'gnc-can-filling-agent',
  'gnc-shift-haul-and-schedule-navigator',
  'gnc-f1-sy27-movement-manager',
  'gnc-planting-location-fallback-shield'
];

const sourceSkills = [
  'agdata-access-and-permission-matrix',
  'agdata-access-and-permissions-governor',
  'agdata-app-shell-and-navigation',
  'agdata-aura-assistant',
  'agdata-bloom-and-request-specialist',
  'agdata-docks-and-orders-specialist',
  'agdata-drive-and-av-specialist',
  'agdata-email-outbox-and-worker-guard',
  'agdata-field-ops-and-qc',
  'agdata-queue-and-reclass-specialist',
  'agdata-release-governor',
  'agdata-request-lifecycle-and-lock-guard',
  'agdata-runtime-watchdog',
  'agdata-shear-crew-load-and-gdd-guard',
  'agdata-skill-learner',
  'agdata-smart-moves-and-gdd-hold-intelligence',
  'agdata-suspend-tag-approval-specialist',
  'agdata-sync-and-supabase-architect',
  'agdata-table-management-and-directory',
  'agdata-zero-lockout-guard',
  'agdata-zero-regression-mutation-engine'
];

const directorySkills = new Map([
  ['core', 'agdata-core-sync'],
  ['engine', 'agdata-canonical-engine'],
  ['views', 'agdata-views-workflows'],
  ['ui', 'agdata-ui-shell'],
  ['services', 'agdata-services-release']
]);

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('ten replacement skills retain valid metadata and routing boundaries', () => {
  for (const skill of replacementSkills) {
    const source = read(`.agents/skills/${skill}/SKILL.md`);
    const agent = read(`.agents/skills/${skill}/agents/openai.yaml`);
    assert.match(source, new RegExp(`^---\\r?\\nname: ${skill}\\r?$`, 'm'));
    assert.match(source, /description: .+Use for /);
    assert.match(agent, /display_name:/);
  }
});

test('combined blueprint catalogs ten skills and maps 20 GNC inputs once', () => {
  const blueprint = read('docs/gemini-gnc-argos-clean-gems-blueprint.md');
  for (const skill of replacementSkills) assert.ok(blueprint.includes(`.agents/skills/${skill}/SKILL.md`));
  const found = gncSourceSkills.filter((skill) => blueprint.includes(`\`${skill}\``));
  assert.deepEqual(found, gncSourceSkills);
  assert.equal(new Set(found).size, 20);
  assert.match(blueprint, /GNC 20-to-3 consolidation/);
});

test('blueprint maps exactly 21 unique legacy inputs', () => {
  const blueprint = read('docs/gemini-clean-gems-blueprint.md');
  const found = sourceSkills.filter((skill) => blueprint.includes(`\`${skill}\``));
  assert.deepEqual(found, sourceSkills);
  assert.equal(new Set(found).size, 21);
  assert.match(blueprint, /4 \+ 5 \+ 5 \+ 2 \+ 5/);
});

test('each modular source directory routes to one replacement skill', () => {
  for (const [directory, skill] of directorySkills) {
    const instructions = read(`src/${directory}/AGENTS.md`);
    assert.match(instructions, new RegExp(`\\.agents/skills/${skill}/SKILL\\.md`));
  }
});
