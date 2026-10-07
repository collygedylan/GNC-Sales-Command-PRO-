import { assertEquals, assert } from 'jsr:@std/assert@1';
import { AURA_MODULE_CAPABILITIES, auraDateRange, resolveAuraIntent } from '../_shared/aura-query.ts';
import { AURA_SEASON_SOURCES } from '../_shared/aura-capabilities.ts';

Deno.test('item identifiers keep leading zeros before size, bay and lot normalization', () => {
  const q = resolveAuraIntent('Where are itemcode 00123 in D.10 bay 021 lot 27.F1?');
  assertEquals(q.mode, 'inventory'); assertEquals(q.operation, 'locations');
  assertEquals(q.filters.itemcode, '00123'); assertEquals(q.filters.locationCode, 'D.10.021');
  assertEquals(q.filters.lotcode, '27.F1'); assertEquals(q.filters.contSize, undefined);
});
Deno.test('spoken nursery sizes reuse the existing normalizers', () => {
  for (const phrase of ['three gallon', 'hash three', '#3']) {
    const q = resolveAuraIntent(`Where are ${phrase} Baby Gem?`);
    assertEquals(q.filters.contSize, '#3'); assertEquals(q.filters.productText, 'Baby Gem');
  }
  assertEquals(resolveAuraIntent('How many three deep pee roses?').filters.contSize, '3DP');
});
Deno.test('explicit common-name entities preserve multiword names and inventory stopwords', () => {
  for (const cue of ['common name', 'commonname', 'common-name']) {
    const q = resolveAuraIntent(`Where is ${cue}: Lily of the Valley in C.06?`);
    assertEquals(q.filters.commonName, 'Lily of the Valley');
    assertEquals(q.filters.productText, undefined); assertEquals(q.filters.locationCode, 'C.06');
    assertEquals(q.clarification, undefined);
  }
  assertEquals(resolveAuraIntent('Find common-name is Love in a Mist').filters.commonName, 'Love in a Mist');
  assertEquals(resolveAuraIntent("Show inventory common name: Baby's Tears").filters.commonName, "Baby's Tears");
  assertEquals(resolveAuraIntent('Find common name: "Lily of the Valley"').filters.commonName, 'Lily of the Valley');
  assertEquals(resolveAuraIntent('Where are Baby Gem in C.06?').filters.productText, 'Baby Gem');
});
Deno.test('unsupported app areas clarify instead of discarding a common-name field filter', () => {
  for (const q of ['Show sales credits for common name "Rose"', 'Show Location Work common name "Rose"', 'Read chat common name "Rose"']) {
    assert(resolveAuraIntent(q).clarification, q);
  }
});
Deno.test('quoted common names are protected before dates, status, sizes and module routing', () => {
  for (const name of ['In the Pink', 'Yesterday Today and Tomorrow', 'Open Stock', 'Sales Office Rose', 'Three Gallon Rose']) {
    for (const [left, right] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']]) {
      const q = resolveAuraIntent(`How many common name ${left}${name}${right} in open stock #3 season 27S1?`);
      assertEquals(q.filters.commonName, name); assertEquals(q.mode, 'inventory');
      assertEquals(q.filters.openStockOnly, true); assertEquals(q.filters.contSize, '#3');
      assertEquals(q.filters.season, 'S1'); assertEquals(q.filters.salesYear, 27);
      assertEquals(q.filters.status, undefined); assertEquals(q.filters.dateFrom, undefined);
      assertEquals(q.clarification, undefined);
    }
  }
  assertEquals(resolveAuraIntent("Find common name 'St. John's Wort'").filters.commonName, "St. John's Wort");
  assert(resolveAuraIntent('Find common name "Baby Gem').clarification);
  assert(resolveAuraIntent('Find common name:').clarification);
});
Deno.test('common-name filters retain explicit itemcode, genus, size, season and location', () => {
  const q = resolveAuraIntent('Where is itemcode 00123 common name Baby Gem genus Buxus #3 season 27S1 in D.10 bay 021?');
  assertEquals(q.filters.commonName, 'Baby Gem'); assertEquals(q.filters.itemcode, '00123');
  assertEquals(q.filters.genus, 'Buxus'); assertEquals(q.filters.contSize, '#3');
  assertEquals(q.filters.season, 'S1'); assertEquals(q.filters.locationCode, 'D.10.021');
  assertEquals(q.filters.productText, undefined); assertEquals(q.clarification, undefined);
});
Deno.test('common-name follow-ups carry scope and replace stale selected product identity', () => {
  const first = resolveAuraIntent('Where are #3 Baby Gem in C.06?');
  first.filters.selectionId = 'old-selection';
  const named = resolveAuraIntent('And common name "In the Pink"', { lastIntent: first });
  assertEquals(named.filters.commonName, 'In the Pink'); assertEquals(named.filters.productText, undefined);
  assertEquals(named.filters.selectionId, undefined); assertEquals(named.filters.contSize, '#3');
  assertEquals(named.filters.locationCode, 'C.06'); assertEquals(named.clarification, undefined);
  const count = resolveAuraIntent('How many of those?', { lastIntent: named });
  assertEquals(count.filters.commonName, 'In the Pink');
  for (const phrase of ['And itemcode 00456', 'And genus Acer', 'What about roses?']) {
    const next = resolveAuraIntent(phrase, { lastIntent: named });
    assertEquals(next.filters.commonName, undefined, phrase); assertEquals(next.clarification, undefined, phrase);
  }
});
Deno.test('where, who, broad ownership and quantity questions remain distinct', () => {
  assertEquals(resolveAuraIntent('Who is assigned to Acer?').operation, 'ownership');
  assertEquals(resolveAuraIntent('Who is assigned to Acer?').filters.productText, 'Acer');
  assertEquals(resolveAuraIntent('Show Zoe’s plants').mode, 'ownership');
  const q = resolveAuraIntent('How many Zoe’s plants in the perennial area?');
  assertEquals(q.operation, 'stock'); assertEquals(q.filters.assignee, 'zoe_green');
  assertEquals(q.filters.zone, 'perennial'); assertEquals(q.filters.openStockOnly, false);
});
Deno.test('available, on-hand, rows and distinct-item metrics are explicit', () => {
  assertEquals(resolveAuraIntent('How many items in C.06?').filters.countMode, 'quantity');
  assertEquals(resolveAuraIntent('How many distinct items in C.06?').filters.countMode, 'unique_items');
  assertEquals(resolveAuraIntent('How many physical rows in C.06?').filters.countMode, 'physical_rows');
  assertEquals(resolveAuraIntent('How many roses on hand?').filters.metric, 'ptronhand');
  assertEquals(resolveAuraIntent('How many roses available?').filters.openStockOnly, false);
  assertEquals(resolveAuraIntent('How many roses in open stock?').filters.openStockOnly, true);
});
Deno.test('explicit follow-up filters override memory and reuse omitted identity', () => {
  const first = resolveAuraIntent('Where are #3 Baby Gem in C.06?');
  const next = resolveAuraIntent('Only Zoe’s in D.10 bay 021', { lastIntent: first });
  assertEquals(next.filters.productText, 'Baby Gem'); assertEquals(next.filters.contSize, '#3');
  assertEquals(next.filters.locationCode, 'D.10.021'); assertEquals(next.filters.assignee, 'zoe_green');
  const count = resolveAuraIntent('How many of those?', { lastIntent: next });
  assertEquals(count.operation, 'stock'); assertEquals(count.filters.productText, 'Baby Gem');
  const newQuestion = resolveAuraIntent('Where are roses?', { lastIntent: next });
  assertEquals(newQuestion.filters.locationCode, undefined);
  assertEquals(newQuestion.filters.assignee, undefined);
});
Deno.test('ambiguous references and unsupported conversation produce clarification', () => {
  assert(resolveAuraIntent('Only Zoe’s').clarification);
  assert(resolveAuraIntent('How many of those?', { lastIntent: resolveAuraIntent('Where are roses?'), pendingChoices: [{ id: 'a' }, { id: 'b' }] }).clarification);
  assert(resolveAuraIntent('Tell me a joke').clarification);
  assert(resolveAuraIntent('Show can filling').clarification);
  assert(resolveAuraIntent('Show order pulling').clarification);
  assert(resolveAuraIntent('Where are #3 and #5 roses?').clarification);
});
Deno.test('physical perennial area is a separate filter from effective ownership', () => {
  const q = resolveAuraIntent('Where are Zoe’s plants outside the perennial area?');
  assertEquals(q.operation, 'locations'); assertEquals(q.filters.assignee, 'zoe_green');
  assertEquals(q.filters.zone, 'OUTSIDE');
});
Deno.test('historical season/year and spoken season labels are explicit', () => {
  const q = resolveAuraIntent('How many roses for season 27S1?');
  assertEquals(q.filters.season, 'S1'); assertEquals(q.filters.salesYear, 27);
  assertEquals(q.filters.productText, 'roses');
  assertEquals(resolveAuraIntent('How many roses for eff one?').filters.season, 'F1');
});
Deno.test('season source mapping distinguishes persisted history from mutable master lineage', () => {
  assertEquals(AURA_SEASON_SOURCES.request_history.historicInventoryFallback, false);
  assertEquals(AURA_SEASON_SOURCES.request_history.yearPolicy, 'persisted-season-only');
  assertEquals(AURA_SEASON_SOURCES.sales_orders.seasonalSeasonPolicy, 'state-required-no-master-fallback');
  assertEquals(AURA_SEASON_SOURCES.sales_orders.nonseasonalSeasonPolicy, 'exact-master_id-link');
  assertEquals(AURA_SEASON_SOURCES.request_queue.seasonJoin, 'master_id -> ph_master_inventory.unique_id');
  assertEquals(AURA_SEASON_SOURCES.credits.yearPolicy, 'season-only');
});
Deno.test('explicit sales-year cues are parsed independently and invalid years clarify', () => {
  const salesYear = resolveAuraIntent('Show request history for season F1 sales year 27');
  assertEquals(salesYear.filters.season, 'F1'); assertEquals(salesYear.filters.salesYear, 27);
  assertEquals(salesYear.filters.productText, undefined); assertEquals(salesYear.clarification, undefined);
  const calendarYear = resolveAuraIntent('Show credits in F1 in 2027');
  assertEquals(calendarYear.filters.season, 'F1'); assertEquals(calendarYear.filters.salesYear, 27);
  assertEquals(calendarYear.filters.productText, undefined); assertEquals(calendarYear.clarification, undefined);
  assert(resolveAuraIntent('Show active requests salesyear 150').clarification);
  assert(resolveAuraIntent('Show active requests season 2150F1').clarification);
  assert(resolveAuraIntent('Show active requests season 27F1 sales year 28').clarification);
});
Deno.test('relative season phrases are explicit query-time references and literal seasons win', () => {
  for (const phrase of ['current season', 'this season']) {
    const q = resolveAuraIntent(`How many roses in the ${phrase}?`);
    assertEquals(q.filters.seasonReference, 'current', phrase);
    assertEquals(q.filters.season, undefined, phrase);
  }
  const next = resolveAuraIntent('How many roses for next season?');
  assertEquals(next.filters.seasonReference, 'next');
  assertEquals(next.filters.season, undefined);
  const nextExplicitYear = resolveAuraIntent('How many roses for next season sales year 28?');
  assertEquals(nextExplicitYear.filters.seasonReference, 'next');
  assertEquals(nextExplicitYear.filters.salesYear, 28);

  const explicitWins = resolveAuraIntent('How many roses for current season 27S1?');
  assertEquals(explicitWins.filters.season, 'S1');
  assertEquals(explicitWins.filters.salesYear, 27);
  assertEquals(explicitWins.filters.seasonReference, undefined);

  const literalName = resolveAuraIntent('How many common name "Next Season Rose"?');
  assertEquals(literalName.filters.commonName, 'Next Season Rose');
  assertEquals(literalName.filters.seasonReference, undefined);
  const unquotedName = resolveAuraIntent('Show common name rose next season');
  assertEquals(unquotedName.filters.commonName, 'rose');
  assertEquals(unquotedName.filters.seasonReference, 'next');
  const quotedNameWithRelativeSeason = resolveAuraIntent('Show common name "Next Season" current season');
  assertEquals(quotedNameWithRelativeSeason.filters.commonName, 'Next Season');
  assertEquals(quotedNameWithRelativeSeason.filters.seasonReference, 'current');
  const nameAndYear = resolveAuraIntent('Show common name rose sales year 27');
  assertEquals(nameAndYear.filters.commonName, 'rose');
  assertEquals(nameAndYear.filters.salesYear, 27);
});
Deno.test('domain routes remove their nouns and preserve status, date and search predicates', () => {
  assertEquals(resolveAuraIntent('Show pending sales credits').capability, 'credits');
  assertEquals(resolveAuraIntent('Show pending sales credits').filters.status, 'pending');
  assertEquals(resolveAuraIntent('Show pending sales credits').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Show employee hours today').capability, 'hours');
  assertEquals(resolveAuraIntent('Show employee hours today').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Show purchase order balances for 27S1').capability, 'po_spring');
  assertEquals(resolveAuraIntent('Show purchase order balances for 27S1').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Read my latest messages').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Find customers Acme').filters.productText, 'Acme');
});
Deno.test('workflow routes keep membership separate from Eval ownership', () => {
  assertEquals(resolveAuraIntent('Show open Location Work').mode, 'location_work');
  assertEquals(resolveAuraIntent('Show open Eval Work').mode, 'eval_work');
  assertEquals(resolveAuraIntent('Show planting status').capability, 'planting');
  assertEquals(resolveAuraIntent('Show production schedule').capability, 'production_schedule');
});
Deno.test('relative dates use Chicago midnight including DST boundaries', () => {
  const range = auraDateRange('today', new Date('2026-03-08T15:00:00Z'))!;
  assertEquals(range.dateFrom, '2026-03-08T06:00:00.000Z');
  assertEquals(range.dateTo, '2026-03-09T05:00:00.000Z');
  const november = auraDateRange('today', new Date('2026-11-01T15:00:00Z'))!;
  assertEquals(november.dateFrom, '2026-11-01T05:00:00.000Z');
  assertEquals(november.dateTo, '2026-11-02T06:00:00.000Z');
  const evening = auraDateRange('tomorrow', new Date('2026-10-07T02:00:00Z'))!;
  assertEquals(evening.dateFrom, '2026-10-07T05:00:00.000Z');
});

Deno.test('every advertised module question resolves and nouns do not become search terms', () => {
  const expectedSearch: Record<string, string> = { sales: 'Acme', reserves: 'roses', bloom: 'Prepare review' };
  for (const [module, entry] of Object.entries(AURA_MODULE_CAPABILITIES)) {
    const intent = resolveAuraIntent(entry.questions[0]);
    if (!entry.available) { assert(intent.clarification, module); continue; }
    assertEquals(intent.clarification, undefined, module);
    assertEquals(intent.filters.productText, expectedSearch[module], module);
    if (module === 'chat') assertEquals(intent.mode, 'chat');
    else if (module !== 'bloom') assert(entry.capabilities.includes(intent.capability || 'inventory'), module);
  }
});
Deno.test('navigation has an allowlisted destination and never filters status=open', () => {
  const open = resolveAuraIntent('Open communication');
  assertEquals(open.operation, 'navigate'); assertEquals(open.module, 'communication');
  assertEquals(open.filters.navigationView, 'communication'); assertEquals(open.filters.status, undefined);
  assertEquals(resolveAuraIntent('Which app areas can I open?').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Open operations').filters.operations, true);
  assert(resolveAuraIntent('Open arbitrary_table').clarification);
});
Deno.test('more specific order scopes precede generic balances and invalid dates clarify', () => {
  assertEquals(resolveAuraIntent('Show HL order receipts').capability, 'hl_orders');
  assertEquals(resolveAuraIntent('Show purchase-order balances for 27S1').filters.productText, undefined);
  assertEquals(resolveAuraIntent('Show active requests').filters.status, undefined);
  assert(resolveAuraIntent('Show employee hours on 2026-02-30').clarification);
});

Deno.test('current assignment authority, Bunch Notes and directory have explicit routes', () => {
  for (const [question, capability] of [
    ['Show inventory row assignments', 'row_assignments'],
    ['Show itemcode default owners', 'default_owners'],
    ['Show Bunch Notes jobs', 'bunch_notes'],
    ['Show company directory', 'directory_contacts'],
    ['Show nursery beds', 'directory_beds'],
  ]) {
    const intent = resolveAuraIntent(question);
    assertEquals(intent.capability, capability); assertEquals(intent.clarification, undefined);
    assertEquals(intent.filters.productText, undefined); assertEquals(intent.filters.itemcode, undefined);
    assertEquals(intent.filters.countMode, 'quantity');
  }
});
