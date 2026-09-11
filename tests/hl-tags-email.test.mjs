import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const userId = '12345678-1234-1234-1234-123456789abc';
const accessToken = 'native.payload.signature';
const dylanEmail = 'dylan_collyge@greenleafnursery.com';
const requiredReportCopies = ['sunday_ellis', 'sharon_combs', 'mitch_kaiser', 'jd_jones', 'megan_kelly']
  .map((name) => `${name}@greenleafnursery.com`);

function row(overrides = {}) {
  return {
    unique_id: 'SOC-1', itemcode: 'ABC', contsize: '3G', locationcode: 'C.12.4', lotcode: 'LOT-1',
    quantityordered: '12', dock: 'Dock 3', planstartdate: '', commonname: 'Azalea', ptravailable: '45',
    transactionnumber: 'ORDER-12', purchaseordernumber: 'PO-8', tripnumber: '2', stopnumber: '4',
    customername: 'Customer', consigneename: 'Consignee', ...overrides
  };
}

function harness(options = {}) {
  const reads = [];
  // Retained canonical-data helper coverage. These fixtures render messages only;
  // the public HL TAGS sender is intentionally disabled and tested separately.
  const renderedMessages = [];
  const actualSends = [];
  const logs = [];
  const canonical = options.rows || [row()];
  const reply = (status, body, headers = {}) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(body), getHeaders: () => headers });
  const context = vm.createContext({
    Utilities: { formatDate: () => '09/11/2026' },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => name === 'SUPABASE_SERVICE_ROLE_KEY' ? (options.serviceKey ?? 'sb_secret_fixture') : '' }) },
    UrlFetchApp: { fetch: (url, request) => {
      reads.push({ url, request });
      assert.equal(request.method, 'get', 'verification must only read');
      if (options.fetchError) throw new Error(`${accessToken}: ${options.fetchError}`);
      const parsed = new URL(url);
      if (parsed.pathname === '/auth/v1/user') return reply(options.authStatus ?? 200, options.authUser ?? { id: userId });
      if (parsed.pathname === '/rest/v1/profiles') {
        assert.equal(parsed.searchParams.get('id'), `eq.${userId}`);
        return reply(options.profileStatus ?? 200, options.profiles ?? [{ id: userId, username: 'dylan_collyge', disabled_at: null, locked_until: null, must_change_password: false, ...options.profile }]);
      }
      if (parsed.pathname === '/rest/v1/ph_master_inventory') {
        assert.equal(parsed.searchParams.get('select'), 'unique_id,itemcode,contsize,locationcode,lotcode,ptravailable');
        assert.equal(request.headers.Prefer, 'count=exact');
        assert.ok(parsed.searchParams.get('or')?.includes('itemcode.ilike.'), 'inventory lookup must be filtered');
        assert.equal(parsed.searchParams.get('order'), 'unique_id.asc');
        const offset = Number(parsed.searchParams.get('offset'));
        if (options.masterFetchError) throw new Error('Inventory read unavailable');
        if (options.masterPages) {
          const page = options.masterPages.find((entry) => entry.offset === offset);
          assert.ok(page, `unexpected inventory page offset ${offset}`);
          return reply(page.status ?? 200, page.rows, page.range ? { 'Content-Range': page.range } : {});
        }
        const masterRows = options.masterRows || [];
        const pageRows = masterRows.slice(offset, offset + 500);
        const range = masterRows.length ? `${offset}-${offset + pageRows.length - 1}/${masterRows.length}` : '*/0';
        return reply(options.masterStatus ?? 200, pageRows, { 'Content-Range': range });
      }
      assert.equal(parsed.pathname, '/rest/v1/ph_soc_master');
      const filter = parsed.searchParams.get('unique_id');
      assert.ok(filter.startsWith('in.(') && filter.endsWith(')'));
      const ids = JSON.parse(`[${filter.slice(4, -1)}]`);
      return reply(options.socStatus ?? 200, options.socResponse ?? canonical.filter((entry) => ids.includes(entry.unique_id)));
    } },
    GmailApp: { sendEmail: (...args) => { actualSends.push(args); } }
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  const payload = (overrides = {}) => ({ type: 'email', emailType: 'bloom_purpose_report', emailSubType: 'hl_tags', accessToken, sourceRows: canonical.map((entry) => ({ ...entry })), ...overrides });
  const invoke = (expression, input) => {
    context.__input = input;
    return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
  };
  return { reads, renderedMessages, actualSends, logs, context, payload,
    prepare: (overrides) => {
      try {
        const prepared = invoke('prepareHlTagsEmailPayload_(__input)', payload(overrides));
        const recipients = invoke('collectRequestRecipients_(__input)', prepared);
        const message = invoke('buildRequestEmailMessage_(__input)', prepared);
        renderedMessages.push([recipients.toList, message.subject, message.textBody, { htmlBody: message.htmlBody, name: prepared.fromName }]);
        return { ok: true, recipients: recipients.toArray };
      } catch (error) {
        return { ok: false, status: error.hlTagsStatus || 503, code: error.hlTagsCode || 'hl_tags_verification_unavailable', recipients: [] };
      }
    },
    recipients: (input) => invoke('collectRequestRecipients_(__input)', input),
    dispatch: (overrides) => {
      // Output serialization and unrelated queues are boundaries; authorization and delivery remain real.
      vm.runInContext('jsonOutput_ = function(value) { return value; }; shouldQueueJdApprovalEmail_ = function() { throw new Error("HL TAGS reached unrelated queue"); };', context);
      return invoke('doPost(__input)', { postData: { contents: JSON.stringify(payload(overrides)) } });
    }
  };
}

function assertNoDelivery(h, result, status, code) {
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  if (code) assert.equal(result.code, code);
  assert.deepEqual(result.recipients, []);
  assert.equal(h.renderedMessages.length, 0);
}

test('native auth header remains the caller JWT with a legacy service key', () => {
  const h = harness({ serviceKey: 'legacy.service.key' });
  assert.equal(h.prepare().ok, true);
  assert.equal(h.reads[0].request.headers.Authorization, `Bearer ${accessToken}`);
  assert.equal(h.reads[0].request.headers.apikey, 'legacy.service.key');
  assert.equal(h.reads[1].request.headers.Authorization, 'Bearer legacy.service.key');
  assert.equal(h.reads[2].request.headers.Authorization, 'Bearer legacy.service.key');
  assert.ok(h.reads.every(({ request }) => request.muteHttpExceptions === true));
});

for (const token of ['', null, 'dylan_collyge', 'header.payload.signature\ninjected', 'a'.repeat(8200)]) {
  test(`missing or malformed native token is denied (${String(token).slice(0, 25)})`, () => {
    const h = harness();
    assertNoDelivery(h, h.prepare({ accessToken: token, requestedBy: 'dylan_collyge' }), 401, 'hl_tags_auth_required');
    assert.equal(h.reads.length, 0);
  });
}

test('forged JWT denied by Auth cannot use requestedBy or token claims', () => {
  const h = harness({ authStatus: 401, authUser: { user_metadata: { username: 'dylan_collyge' } } });
  assertNoDelivery(h, h.prepare({ requestedBy: 'dylan_collyge', verified: true }), 401, 'hl_tags_auth_required');
  assert.equal(h.reads.length, 1);
});

test('Auth user must contain a verified user id', () => {
  const h = harness({ authUser: { username: 'dylan_collyge' } });
  assertNoDelivery(h, h.prepare(), 401);
  assert.equal(h.reads.length, 1);
});

for (const [description, profile] of [
  ['different username', { username: 'another_user' }],
  ['case-variant username', { username: 'DYLAN_COLLYGE' }],
  ['different profile id', { id: '12345678-1234-1234-1234-123456789def' }],
  ['disabled', { disabled_at: '2026-01-01T00:00:00Z' }],
  ['locked', { locked_until: '2999-01-01T00:00:00Z' }],
  ['malformed lock', { locked_until: 'invalid' }],
  ['password change required', { must_change_password: true }],
  ['unknown password state', { must_change_password: null }]
]) {
  test(`trusted profile rejects ${description}`, () => {
    const h = harness({ profile });
    assertNoDelivery(h, h.prepare({ requestedBy: 'dylan_collyge', requestedByEmail: dylanEmail }), 403, 'hl_tags_forbidden');
    assert.equal(h.reads.length, 2);
  });
}

test('missing or ambiguous profiles cannot authorize', () => {
  for (const profiles of [[], [{ id: userId }, { id: userId }]]) {
    const h = harness({ profiles });
    assertNoDelivery(h, h.prepare(), 403);
  }
});

test('expired lock allows the active account', () => {
  const h = harness({ profile: { locked_until: '2020-01-01T00:00:00Z' } });
  assert.equal(h.prepare().ok, true);
});

for (const locationcode of ['C.05', '0.00.111', 'C.12.1', 'B.10.3', 'C.14.5']) {
  test(`eligible location ${locationcode} accepts either dock or planned start`, () => {
    for (const schedule of [{ dock: '1', planstartdate: '' }, { dock: '', planstartdate: '2026-09-15' }]) {
      const h = harness({ rows: [row({ locationcode, ...schedule })] });
      assert.equal(h.prepare().ok, true);
      assert.equal(h.renderedMessages.length, 1);
    }
  });
}

for (const changes of [{ locationcode: 'C.050' }, { locationcode: 'C.12' }, { locationcode: 'C.12.' }, { locationcode: 'B.10.' }, { locationcode: 'C.14.' }, { locationcode: 'XC.12.1' }, { locationcode: 'B.11.1' }, { dock: '', planstartdate: '' }]) {
  test(`ineligible canonical row is rejected: ${JSON.stringify(changes)}`, () => {
    const h = harness({ rows: [row(changes)] });
    assertNoDelivery(h, h.prepare(), 409, 'hl_tags_selection_changed');
  });
}

for (const field of ['itemcode', 'contsize', 'locationcode', 'lotcode', 'dock', 'planstartdate', 'quantityordered']) {
  test(`changed ${field} rejects the entire selected report before delivery`, () => {
    const h = harness({ rows: [row(), row({ unique_id: 'SOC-2' })] });
    const sourceRows = h.payload().sourceRows;
    sourceRows[1][field] = field === 'quantityordered' ? '99' : 'OLD';
    assertNoDelivery(h, h.prepare({ sourceRows }), 409, 'hl_tags_selection_changed');
  });
}

test('removed or duplicated canonical rows fail closed', () => {
  for (const socResponse of [[], [row(), row()], [row({ unique_id: 'UNSELECTED' })], { error: 'invalid response' }]) {
    const h = harness({ socResponse });
    const result = h.prepare();
    assertNoDelivery(h, result, Array.isArray(socResponse) ? 409 : 503);
  }
});

test('empty, duplicate, invalid and oversized selections never fetch SOC', () => {
  const selections = [[], [row(), row()], [row({ unique_id: '' })], [row({ quantityordered: 'unknown' })], [row({ quantityordered: '0' })], [row({ quantityordered: '-1' })], [null], Array.from({ length: 501 }, (_, i) => row({ unique_id: `SOC-${i}` }))];
  for (const sourceRows of selections) {
    const h = harness();
    assertNoDelivery(h, h.prepare({ sourceRows }), 400, 'hl_tags_invalid_selection');
    assert.equal(h.reads.length, 2);
  }
});

test('canonical zero or negative quantity rejects a previously positive selection', () => {
  for (const quantityordered of ['0', '-1']) {
    const h = harness({ rows: [row({ quantityordered })] });
    assertNoDelivery(h, h.prepare({ sourceRows: [row()] }), 409, 'hl_tags_selection_changed');
  }
});

test('item and size casing groups identically to the client preview', () => {
  const h = harness({ rows: [row(), row({ unique_id: 'SOC-2', itemcode: 'abc', contsize: '3g', quantityordered: '8' })] });
  assert.equal(h.prepare().ok, true);
  assert.match(h.renderedMessages[0][2], /ABC \/ 3G: 20/);
  assert.doesNotMatch(h.renderedMessages[0][2], /abc \/ 3g: 8/);
});

test('500 selected rows are fetched in bounded chunks and rendered once', () => {
  const rows = Array.from({ length: 500 }, (_, i) => row({ unique_id: `SOC-${i}` }));
  const h = harness({ rows });
  assert.equal(h.prepare().ok, true);
  const socReads = h.reads.filter(({ url }) => new URL(url).pathname === '/rest/v1/ph_soc_master');
  assert.ok(socReads.length >= 10);
  assert.ok(socReads.every(({ url }) => url.length < 1800));
  assert.equal(h.renderedMessages.length, 1);
  assert.match(h.renderedMessages[0][2], /ABC \/ 3G: 6000/);
});

test('PostgREST special characters in an ID remain one exact quoted value', () => {
  const h = harness({ rows: [row({ unique_id: 'SOC,"one\\two)&limit=1' })] });
  assert.equal(h.prepare().ok, true);
  const url = new URL(h.reads[2].url);
  assert.equal(url.searchParams.has('limit'), false);
  assert.deepEqual([...url.searchParams.keys()], ['select', 'unique_id']);
});

test('blank item and size do not add eligibility rules or fabricated identity', () => {
  const h = harness({ rows: [row({ itemcode: '', contsize: null, ptravailable: undefined })] });
  assert.equal(h.prepare().ok, true);
  assert.match(h.renderedMessages[0][2], /— \/ —: 12/);
  assert.match(h.renderedMessages[0][2], /PTR available: Unknown/);
});

test('HL TAGS always resolves only Dylan and replaces client content with escaped canonical grouped data', () => {
  const rows = [row({ commonname: '<img src=x onerror="attack">', customername: 'Customer & <company>', ptravailable: null }), row({ unique_id: 'SOC-2', quantityordered: '1,200' }), row({ unique_id: 'SOC-3', contsize: '5G', quantityordered: '7' })];
  const h = harness({ rows });
  const sourceRows = h.payload().sourceRows;
  sourceRows[0].commonname = 'Spoofed name';
  sourceRows[0].ptravailable = '999999';
  sourceRows[0].transactionnumber = 'Spoofed order';
  const result = h.prepare({ sourceRows, subject: 'Injected subject', formattedItemsHtml: '<script>injected</script>', requestedBy: 'someone_else',
    requestedByEmail: 'attacker@example.com', repEmail: 'attacker@example.com', recipientEmails: ['attacker@example.com'], emailRecipients: ['attacker@example.com'],
    internalRecipients: ['attacker@example.com'], recipients: ['attacker@example.com'], cc: 'attacker@example.com', bcc: 'attacker@example.com',
    sendToAllSalesReps: true, dylanRecipientOverride: true, fromName: 'Injected Sender' });
  assert.deepEqual(result.recipients, [dylanEmail]);
  assert.equal(result.ok, true);
  assert.equal(h.renderedMessages.length, 1);
  const [to, subject, textBody, options] = h.renderedMessages[0];
  assert.equal(to, dylanEmail);
  assert.equal(subject, 'HL TAGS');
  assert.equal(options.name, 'GNC PH HL Order');
  assert.deepEqual(Object.keys(options).sort(), ['htmlBody', 'name']);
  assert.match(textBody, /ABC \/ 3G: 1212/);
  assert.match(textBody, /ABC \/ 5G: 7/);
  assert.match(textBody, /PTR available: Unknown/);
  assert.match(textBody, /Order: ORDER-12/);
  assert.match(options.htmlBody, /&lt;img src=x onerror=&quot;attack&quot;&gt;/);
  assert.match(options.htmlBody, /Customer &amp; &lt;company&gt;/);
  assert.doesNotMatch(options.htmlBody, /<img src=x|<script>|Spoofed|999999|attacker@example/);
  assert.ok(!JSON.stringify(h.logs).includes(accessToken));
});

test('remote verification failures return safe messages without delivery or token logs', () => {
  for (const options of [{ serviceKey: '' }, { fetchError: 'network unavailable' }, { authStatus: 500 }, { profileStatus: 503 }, { socStatus: 500 }]) {
    const h = harness(options);
    const result = h.prepare();
    assertNoDelivery(h, result, 503, 'hl_tags_verification_unavailable');
    assert.ok(!JSON.stringify([result, h.logs]).includes(accessToken));
  }
});

test('retired direct HL TAGS sender requires updating the app without auth, data reads or mail', () => {
  for (const accessToken of ['', 'native.payload.signature']) {
    const h = harness();
    const result = h.dispatch({ accessToken, approvalStage: 'jd', delayMs: 60000 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'hl_order_update_app_required');
    assert.equal(result.status, 409);
    assert.equal(h.actualSends.length, 0);
    assert.equal(h.reads.length, 0);
  }
});

test('ordinary Bloom reports retain all automatic and selected recipients and named Gmail delivery', () => {
  const h = harness();
  const result = h.recipients({ emailType: 'bloom_purpose_report', emailSubType: 'other_purpose', requestedBy: 'dylan_collyge', recipientEmails: ['selected@example.com'] });
  assert.deepEqual([...result.toArray].sort(), [...requiredReportCopies, dylanEmail, 'selected@example.com'].sort());
  assert.equal(h.reads.length, 0);
  h.context.__input = h.payload({ emailSubType: 'other_purpose', folderId: 'synthetic-bloom-report', sourceRows: [], requestedBy: 'dylan_collyge', recipientEmails: ['selected@example.com'] });
  const sent = vm.runInContext('sendRequestEmailWithFallback_(__input)', h.context);
  assert.equal(sent.ok, true);
  assert.equal(h.actualSends.length, 1);
  assert.deepEqual(h.actualSends[0][0].split(',').sort(), [...requiredReportCopies, dylanEmail, 'selected@example.com'].sort());
});

function masterRow(overrides = {}) {
  return { unique_id: 'MASTER-1', itemcode: 'ABC', contsize: '3G', locationcode: 'C.12.4', lotcode: 'LOT-1', ptravailable: '27', ...overrides };
}

test('exact master match enriches availability only and normalizes all four key fields', () => {
  const h = harness({ rows: [row({ ptravailable: '999' })], masterRows: [masterRow({ itemcode: ' abc ', contsize: ' 3g ', locationcode: ' c.12.4 ', lotcode: ' lot-1 ', commonname: 'Wrong inventory name', quantityordered: '9999' })] });
  assert.equal(h.prepare().ok, true);
  const text = h.renderedMessages[0][2];
  assert.match(text, /PTR available: 27/);
  assert.match(text, /SOC row: SOC-1/);
  assert.match(text, /Common name: Azalea/);
  assert.match(text, /Ordered quantity: 12/);
  assert.match(text, /Azalea · ABC \/ 3G: 12/);
  assert.match(h.renderedMessages[0][3].htmlBody, /Azalea · ABC \/ 3G/);
  assert.match(h.renderedMessages[0][3].htmlBody, /<th>Ordered quantity<\/th>/);
  assert.doesNotMatch(text, /Wrong inventory|9999|MASTER-1/);
});

test('zero inventory availability remains known', () => {
  const h = harness({ masterRows: [masterRow({ ptravailable: 0 })] });
  assert.equal(h.prepare().ok, true);
  assert.match(h.renderedMessages[0][2], /PTR available: 0/);
});

test('finite numeric inventory values use the same parsing as the client preview', () => {
  for (const [ptravailable, expected] of [['1,234', '1234'], ['1e2', '100'], [1e-7, '1e-7']]) {
    const h = harness({ masterRows: [masterRow({ ptravailable })] });
    assert.equal(h.prepare().ok, true);
    assert.ok(h.renderedMessages[0][2].includes(`PTR available: ${expected}`));
  }
});

test('missing, ambiguous, incomplete keys and invalid quantities remain unknown without SOC fallback', () => {
  const cases = [[], [masterRow(), masterRow({ unique_id: 'MASTER-2' })], [masterRow({ unique_id: '' })],
    [masterRow({ itemcode: 'ABCD' })], [masterRow({ contsize: '5G' })], [masterRow({ locationcode: 'C.12.5' })], [masterRow({ lotcode: 'LOT-2' })],
    [masterRow({ ptravailable: '' })], [masterRow({ ptravailable: '-1' })], [masterRow({ ptravailable: 'unknown' })]];
  for (const masterRows of cases) {
    const h = harness({ rows: [row({ ptravailable: '999' })], masterRows });
    assert.equal(h.prepare().ok, true);
    assert.match(h.renderedMessages[0][2], /PTR available: Unknown/);
    assert.equal(h.renderedMessages.length, 1);
  }
});

test('matching duplicate inventory rows count once, conflicting duplicate quantities remain unknown', () => {
  const same = harness({ masterRows: [masterRow(), masterRow({ ptravailable: 27 })] });
  assert.equal(same.prepare().ok, true);
  assert.match(same.renderedMessages[0][2], /PTR available: 27/);
  const conflicting = harness({ masterRows: [masterRow(), masterRow({ ptravailable: 28 }), masterRow()] });
  assert.equal(conflicting.prepare().ok, true);
  assert.match(conflicting.renderedMessages[0][2], /PTR available: Unknown/);
});

test('master pagination finds a second matching identity beyond the first page', () => {
  const unrelated = Array.from({ length: 499 }, (_, i) => masterRow({ unique_id: `OTHER-${i}`, locationcode: 'OTHER' }));
  const h = harness({ masterRows: [masterRow(), ...unrelated, masterRow({ unique_id: 'MASTER-2' })] });
  assert.equal(h.prepare().ok, true);
  assert.match(h.renderedMessages[0][2], /PTR available: Unknown/);
  assert.deepEqual(h.reads.filter(({ url }) => url.includes('/ph_master_inventory?')).map(({ url }) => new URL(url).searchParams.get('offset')), ['0', '500']);
});

test('capped master pages continue from the returned range instead of assuming completion', () => {
  const h = harness({ masterPages: [
    { offset: 0, rows: [masterRow({ locationcode: 'OTHER' })], range: '0-0/2' },
    { offset: 1, rows: [masterRow()], range: '1-1/2' }
  ] });
  assert.equal(h.prepare().ok, true);
  assert.match(h.renderedMessages[0][2], /PTR available: 27/);
});

test('failed or unverified complete inventory reads keep availability unknown and still render', () => {
  const cases = [
    { masterStatus: 503 }, { masterFetchError: true },
    { masterPages: [{ offset: 0, rows: [masterRow()] }] },
    { masterPages: [{ offset: 0, rows: [masterRow()], range: '0-0/10001' }] },
    { masterPages: [{ offset: 0, rows: [masterRow()], range: '0-0/2' }, { offset: 1, rows: [], range: '*/2' }] },
    { masterPages: [{ offset: 0, rows: [masterRow()], range: '0-0/2' }, { offset: 1, rows: [masterRow()], range: '1-1/3' }] },
    { masterPages: [{ offset: 0, rows: [masterRow()], range: '0-0/2' }, { offset: 1, rows: [masterRow()], status: 500 }] }
  ];
  for (const options of cases) {
    const h = harness(options);
    assert.equal(h.prepare().ok, true);
    assert.match(h.renderedMessages[0][2], /PTR available: Unknown/);
    assert.equal(h.renderedMessages.length, 1);
  }
});

test('master itemcode lookups are bounded and blank itemcodes never issue an unfiltered read', () => {
  const h = harness({ rows: Array.from({ length: 43 }, (_, i) => row({ unique_id: `SOC-${i}`, itemcode: `ITEM${i}` })) });
  assert.equal(h.prepare().ok, true);
  const reads = h.reads.filter(({ url }) => url.includes('/ph_master_inventory?'));
  assert.equal(reads.length, 3);
  assert.ok(reads.every(({ url }) => url.length < 1800));
  const blank = harness({ rows: [row({ itemcode: '' })] });
  assert.equal(blank.prepare().ok, true);
  assert.ok(blank.reads.every(({ url }) => !url.includes('/ph_master_inventory?')));
});
