import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

export async function boundedPilotIdleChecks() {
  const source = readFileSync(new URL('../ui/ops-pilot-layout.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function waitForPilotIdle(');
  const node = parseExpressionAt(source, start, { ecmaVersion:'latest' });
  for (const idleAfter of [2, Infinity]) {
    let ticks = 0, measured = 0;
    const shared = { healthRetryInFlight:false };
    const context = vm.createContext({ shared, setTimeout(resolve) { ticks++; resolve(); },
      pilotInteractionActive: () => ticks < idleAfter, runLayoutHealthAssertions: () => measured++ });
    vm.runInContext(source.slice(node.start,node.end),context);
    const pending = context.waitForPilotIdle();
    await context.waitForPilotIdle();
    await pending;
    assert.equal(ticks, idleAfter === Infinity ? 40 : 2);
    assert.equal(measured, idleAfter === Infinity ? 0 : 1);
    assert.equal(shared.healthRetryInFlight, false);
  }
}
