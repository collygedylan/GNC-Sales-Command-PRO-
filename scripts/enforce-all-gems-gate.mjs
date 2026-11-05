import assert from 'node:assert/strict';
import fs from 'node:fs';
import { synchronizeGemBus } from './sync-gem-learning-bus.mjs';

const summary = synchronizeGemBus({ check: true });
const catalog = JSON.parse(fs.readFileSync(new URL('../docs/architecture/gem-contracts.json', import.meta.url), 'utf8'));
for (const gem of catalog.gems) {
  const source = fs.readFileSync(new URL(`../.codex/skills/${gem.name}/SKILL.md`, import.meta.url), 'utf8');
  assert.ok(source.includes(`name: ${gem.name}`), gem.name);
  assert.ok(gem.ownership.length && gem.rules.length && gem.commands.length, gem.name);
  for (const owner of gem.ownership) {
    const ownedSource = fs.readFileSync(new URL('../' + owner.file, import.meta.url), 'utf8');
    for (const symbol of owner.symbols) assert.ok(ownedSource.includes(symbol), owner.file + ':' + symbol);
  }
}
console.log(JSON.stringify({ gemGate: summary }));
// Preserve every existing security, AST, DOM and canonical mutation assertion.
await import('./enforce-all-14-gems-gate.mjs');
await import('../tests/gem-learning-bus.test.mjs');
