import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function context() {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) }
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(ctx);
  return ctx;
}
const invoke = (ctx, name, ...args) => { ctx.__args = args; return vm.runInContext(`${name}(...__args)`, ctx); };

test('rep display normalization transposes only valid person names and is idempotent', () => {
  const ctx = context();
  for (const [input, expected] of [
    ['Lee, Troy', 'Troy Lee'], ['  Lee ,  Troy  ', 'Troy Lee'],
    ['Alldredge, Chance - South TX', 'Chance Alldredge - South TX'],
    [null, null], ['', ''], ['  ', '  '], ['Troy Lee', 'Troy Lee'],
    ['Lee,', 'Lee,'], [', Troy', ', Troy'], ['Lee, Troy, Jr.', 'Lee, Troy, Jr.'],
    ['InHouse Sales', 'InHouse Sales'], ['Sales, InHouse', 'Sales, InHouse'],
    ['Interdivision', 'Interdivision'], ['Company, Inc.', 'Company, Inc.']
  ]) {
    const actual = invoke(ctx, 'normalizeImportedSalesRepName_', input);
    assert.equal(actual, expected);
    assert.equal(invoke(ctx, 'normalizeImportedSalesRepName_', actual), expected);
  }
});

test('rep addresses use canonical names and repair only exact known backward fallbacks', () => {
  const ctx = context();
  for (const [name, fallback, expected] of [
    ['Lee, Troy', '', 'troy_lee@greenleafnursery.com'],
    ['Troy Lee', '', 'troy_lee@greenleafnursery.com'],
    ['  Lee ,  Troy  ', 'lee_troy@greenleafnursery.com', 'troy_lee@greenleafnursery.com'],
    ['Troy Lee', 'lee_troy@greenleafnursery.com', 'troy_lee@greenleafnursery.com'],
    ['Alldredge, Chance - South TX', '', 'chance_alldredge@greenleafnursery.com'],
    ['Chance Alldredge - South TX', 'alldredge_chance_south_tx@greenleafnursery.com', 'chance_alldredge@greenleafnursery.com'],
    ['Troy Lee', 'troy_lee@greenleafnursery.com', 'troy_lee@greenleafnursery.com'],
    ['Troy Lee', 'preferred@greenleafnursery.com', 'preferred@greenleafnursery.com'],
    ['Lee, Troy', 'lee_troy@example.com', 'lee_troy@example.com'],
    ['Chance Alldredge - South TX', 'preferred@example.com', 'preferred@example.com'],
    ['JD', '', 'jd_jones@greenleafnursery.com'],
    ['Ben Machino', '', 'ben_maschino@greenleafnursery.com'],
    ['Unlisted Person', 'person_unlisted@greenleafnursery.com', 'person_unlisted@greenleafnursery.com']
  ]) assert.equal(invoke(ctx, 'resolveRequestRecipientEmail_', name, fallback), expected, `${name} / ${fallback}`);
});

test('request display and completion greetings normalize both text and HTML without mutating the payload', () => {
  const ctx = context();
  // Exercise the real message builder while excluding unrelated item/gallery lookups.
  for (const name of [
    'buildCompletedRequestItemsHtml_', 'buildRequestItemsHtml_', 'buildRequestItemsText_',
    'buildRequestSelectionSummaryHtml_', 'buildRequestSelectionSummaryText_',
    'buildCustomerConsigneeSummaryHtml_', 'buildCustomerConsigneeSummaryText_',
    'buildAdvertisementEmailHeroHtml_', 'buildAdvertisementEmailHeroText_', 'buildRequestCompletedBySummary_',
    'buildRequestEmailSubject_'
  ]) ctx[name] = () => '';
  for (const [name, expected] of [['Lee, Troy', 'Troy Lee'], ['Alldredge, Chance - South TX', 'Chance Alldredge - South TX']]) {
    const payload = { emailType: 'request_complete', repName: name, customer: 'Fixture Customer', itemsCount: 1 };
    const message = invoke(ctx, 'buildRequestEmailMessage_', payload);
    assert.ok(message.textBody.includes(`Hello ${expected},`));
    assert.ok(message.htmlBody.includes(`<p>Hello ${expected},</p>`));
    assert.equal(payload.repName, name, 'rendering does not rewrite its input snapshot');
    const created = invoke(ctx, 'buildRequestEmailMessage_', { ...payload, emailType: 'new_request' });
    assert.ok(created.textBody.includes(`Rep: ${expected}`));
    assert.ok(created.htmlBody.includes(`<strong>Rep:</strong> ${expected}`));
  }
});
