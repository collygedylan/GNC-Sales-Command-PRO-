import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const privateCatalog = JSON.parse(readFileSync(new URL('../supabase/schema/baseline-private.catalog.json', import.meta.url), 'utf8'));
const baselineSql = readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
const deliveryWorker = readFileSync(new URL('../supabase/functions/request-delivery-worker/index.ts', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `function ${name} exists`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function emailHarness() {
  const context = vm.createContext({
    REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_: ['orders@example.test'],
    firstNonEmptyRequestValue_: function() {
      for (const value of arguments) {
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
      }
      return '';
    },
    getRequestEmailPayloadItems_: payload => payload.requestItems || [],
    resolveRequestGalleryFolderId_: () => 'request-folder',
    cacheRequestGalleryPayload_: () => {},
    getRequestItemPhotoUrls_: () => [],
    buildRequestRowGalleryUrl_: () => '',
    getEmailTableValue_: (item, keys, fallback) => {
      for (const key of keys) {
        const value = item[key];
        if (String(value == null ? '' : value).trim() !== '') return value;
      }
      return fallback == null ? '' : fallback;
    },
    buildEmailTableDataCell_: value => String(value == null ? '' : value),
    buildEmailTable_: (headers, cells) => '<table><thead>' + headers.join('|') + '</thead><tbody>' + cells.join('|') + '</tbody></table>',
    buildRequestChangedFieldsTableHtml_: () => '',
    buildRequestRowPhotoPreviewHtml_: () => '',
    getRequestLocPhotoMatchEmailValue_: () => '',
    getRequestCompleteEmailSnapshotComments_: () => '',
    getRequestNcrCurrentSeasonSltsEmailField_: () => null,
    escapeEmailHtml_: value => String(value == null ? '' : value),
    formatRequestCompletionUserLabel_: () => '',
    formatApprovalRequesterLabel_: () => '',
    getEvalTaskEmailTypeLabel_: () => '',
    getEvalTaskRequestedByFromItem_: () => '',
    formatRequestPercentForEmail_: value => value,
    isCaliperEmailField_: () => false,
    hasCaliperEmailValue_: () => false,
    CALIPER_MEASUREMENT_NOTE_: ''
  });
  vm.runInContext([
    'buildRequestDeliveryEmailPayload_',
    'buildRequestItemsText_',
    'buildRequestItemFieldRowsText_',
    'buildRequestItemFieldRowsHtml_',
    'buildRequestEmailTableItemsHtml_'
  ].map(extractFunction).join('\n'), context);
  return context;
}

test('request-created delivery snapshots render lowercase req_qty in text and HTML', () => {
  const context = emailHarness();
  const rows = [
    { unique_id: 'one', itemcode: 'A1', commonname: 'Item One', contsize: '#1', req_qty: '12' },
    { unique_id: 'two', itemcode: 'A2', commonname: 'Item Two', contsize: '#2', req_qty: 0 },
    { unique_id: 'three', itemcode: 'A3', commonname: 'Item Three', contsize: '#3', req_qty: null },
    { unique_id: 'four', itemcode: 'A4', commonname: 'Item Four', contsize: '#4', req_qty: '' },
    { unique_id: 'five', itemcode: 'A5', commonname: 'Item Five', contsize: '#5', req_qty: '7', requested_qty: '99', REQ_QTY: '88' }
  ];
  const payload = context.buildRequestDeliveryEmailPayload_({
    event_type: 'request_created', request_folder: 'request-folder'
  }, rows);

  assert.equal(payload.itemsCount, 5);
  assert.deepEqual(Array.from(payload.internalRecipients), ['orders@example.test']);
  assert.equal(payload.requestItems[0].req_qty, '12', 'builder retains the raw delivery snapshot');

  const text = context.buildRequestItemsText_(payload);
  assert.match(text, /Requested Qty: 12/);
  assert.match(text, /Requested Qty: 0/);
  assert.match(text, /Requested Qty: 7/);
  assert.doesNotMatch(text, /Requested Qty: (?:99|88)/);
  assert.equal((text.match(/Requested Qty:/g) || []).length, 3, 'null and blank quantities stay omitted');

  const html = context.buildRequestEmailTableItemsHtml_(payload, { includePhotos: false });
  assert.match(html, /QTY[^]*?12/);
  assert.match(html, /QTY[^]*?0/);
  assert.match(html, /QTY[^]*?7/);
  assert.doesNotMatch(html, /99|88/);
  assert.equal((html.match(/QTY/g) || []).length, 3, 'null and blank quantities stay omitted from HTML');
});

test('N/A / N/A customer identity survives request delivery with item metrics and photo fields', () => {
  const context = emailHarness();
  const requestRow = {
    unique_id: 'na-request-1', req_customer: 'N/A | N/A', customeridentityid: 'AGDATA_NA_CUSTOMER',
    customername: 'N/A', consigneeidentityid: 'AGDATA_NA_CONSIGNEE', consigneename: 'N/A',
    req_qty: '3', itemcode: 'TREE-1', loc_photo_match: 'Y', loc_on_hand: '12', photo_link: 'https://example.test/plant.jpg'
  };
  const payload = context.buildRequestDeliveryEmailPayload_({
    event_type: 'request_created', request_folder: 'na-folder'
  }, [requestRow]);
  assert.equal(payload.customer, 'N/A | N/A');
  assert.equal(payload.itemsCount, 1);
  assert.deepEqual(payload.requestItems[0], requestRow);
  const text = context.buildRequestItemsText_(payload);
  assert.match(text, /Requested Qty: 3/);
});

test('request email field renderers retain lowercase alias precedence and explicit zero', () => {
  const context = emailHarness();
  for (const [item, expected] of [
    [{ req_qty: '12' }, '12'],
    [{ req_qty: 0 }, '0'],
    [{ req_qty: null, requested_qty: '4' }, '4'],
    [{ req_qty: '', REQ_QTY: '5' }, '5'],
    [{ req_qty: null }, '']
  ]) {
    const text = context.buildRequestItemFieldRowsText_(item);
    const html = context.buildRequestItemFieldRowsHtml_(item);
    if (expected) {
      assert.match(text, new RegExp('Requested Qty: ' + expected));
      assert.match(html, new RegExp('Requested Qty:</strong> ' + expected));
    } else {
      assert.doesNotMatch(text, /Requested Qty:/);
      assert.doesNotMatch(html, /Requested Qty:/);
    }
  }
});

test('request batch acknowledgment and delivery retry match the checked-in server contract', () => {
  const batchFunction = privateCatalog.functions.find(fn => fn.schema === 'private' && fn.name === 'insert_request_batch');
  assert.ok(batchFunction, 'private.insert_request_batch is present in the baseline catalog');
  const definition = batchFunction.definition;
  for (const responseField of ["'client_batch_id', p_client_batch_id", "'inserted_count', inserted_count", "'rows', snapshots", "'delivery_state', 'pending'"]) {
    assert.ok(definition.includes(responseField), `server acknowledgment includes ${responseField}`);
  }
  assert.match(definition, /'requests',\s*snapshots/);
  assert.match(definition, /on conflict \(event_key\) do nothing/i, 'replaying the same batch does not enqueue a second event');
  assert.match(definition, /on conflict \(unique_id\) do nothing/i, 'replaying the exact request IDs does not insert duplicates');

  const generalStart = baselineSql.indexOf('CREATE FUNCTION public.create_request_batch(client_batch_id uuid, requests jsonb)');
  const avStart = baselineSql.indexOf('CREATE FUNCTION public.create_av_request_batch(client_batch_id uuid, requests jsonb)');
  assert.ok(generalStart >= 0 && avStart >= 0, 'both public batch wrappers exist');
  const general = baselineSql.slice(generalStart, baselineSql.indexOf('ALTER FUNCTION public.create_request_batch', generalStart));
  const av = baselineSql.slice(avStart, baselineSql.indexOf('ALTER FUNCTION public.create_av_request_batch', avStart));
  assert.match(general, /private\.can_create_general_requests\(\)/);
  assert.match(general, /private\.stamp_request_batch_creator\(requests\)/);
  assert.match(general, /private\.insert_request_batch\([\s\S]*?'general'/);
  assert.match(av, /private\.can_create_av_requests\(\)/);
  assert.match(av, /private\.stamp_request_batch_creator\(requests\)/);
  assert.match(av, /private\.insert_request_batch\([\s\S]*?'av'/);
  for (const rpcName of ['create_request_batch', 'create_av_request_batch']) {
    const aclStart = baselineSql.indexOf(`REVOKE ALL ON FUNCTION public.${rpcName}(`);
    assert.ok(aclStart >= 0, `${rpcName} remains explicitly revoked from PUBLIC`);
    const serviceGrant = baselineSql.indexOf('GRANT ALL ON FUNCTION public.' + rpcName, baselineSql.indexOf('TO authenticated;', aclStart));
    const aclEnd = baselineSql.indexOf(';', serviceGrant);
    const acl = baselineSql.slice(aclStart, aclEnd + 1);
    assert.match(acl, /FROM PUBLIC;/);
    assert.match(acl, /TO authenticated;/);
    assert.match(acl, /TO service_role;/);
  }

  assert.match(deliveryWorker, /function loadRequestRows\([\s\S]*?payload\.requests/);
  assert.match(deliveryWorker, /claim_request_delivery_events/);
  assert.doesNotMatch(deliveryWorker, /rpc\(["']create_(?:av_)?request_batch["']/i,
    'delivery retries claim stored outbox events; they do not create request tickets again');
});
