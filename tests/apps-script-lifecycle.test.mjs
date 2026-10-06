import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const required = [
  'dylan_collyge@greenleafnursery.com',
  'kayla_knepp@greenleafnursery.com',
  'jd_jones@greenleafnursery.com'
];

function createContext() {
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => '' })
    }
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  return context;
}

function collect(context, payload) {
  context.__payload = payload;
  return vm.runInContext('collectRequestRecipients_(__payload)', context);
}

function recipientList(context, payload) {
  return Array.from(collect(context, payload).toArray);
}

function assertRequiredRecipients(recipients) {
  for (const email of required) assert.ok(recipients.includes(email), `${email} was missing`);
}

test('username-only submitter is included with all required lifecycle recipients', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'morgan_anderson'
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('morgan_anderson@greenleafnursery.com'));
});

test('explicit-email submitter is included with all required lifecycle recipients', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'request_complete',
    requestCreatedByEmail: 'submitter@greenleafnursery.com'
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('submitter@greenleafnursery.com'));
});

test('submitter matching a required recipient is deduplicated', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'dylan_collyge',
    recipientEmails: ['DYLAN_COLLYGE@greenleafnursery.com']
  });
  assertRequiredRecipients(recipients);
  assert.equal(recipients.filter((email) => email === required[0]).length, 1);
});

test('missing submitter information still preserves the required three', () => {
  const context = createContext();
  const recipients = recipientList(context, { emailType: 'request_complete' });
  assert.deepEqual(recipients.sort(), required.slice().sort());
});

test('malformed and duplicate values are rejected while selected and linked reps remain', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'kayla_knepp',
    recipientEmails: ['bad-address', required[2], required[2].toUpperCase()],
    selectedRepRecipients: ['selected_rep@greenleafnursery.com'],
    linkedRepEmails: ['linked_rep@greenleafnursery.com', 'missing-at-sign']
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('selected_rep@greenleafnursery.com'));
  assert.ok(recipients.includes('linked_rep@greenleafnursery.com'));
  assert.ok(!recipients.includes('bad-address'));
  assert.equal(recipients.filter((email) => email === required[2]).length, 1);
});

function prepareSendContext() {
  const context = createContext();
  context.__captured = null;
  vm.runInContext(`
    hydrateRequestCompletePayload_ = function(payload) { return payload; };
    buildRequestEmailMessage_ = function() {
      return { subject: 'Internal lifecycle test', textBody: 'test', htmlBody: '<p>test</p>' };
    };
    resolveAutomatedEmailSenderAddress_ = function() { return 'sender@greenleafnursery.com'; };
    isGmailAdvancedServiceAvailable_ = function() { return true; };
    sendGmailApiMessage_ = function(options) {
      __captured = options;
      return {
        ok: true,
        status: 200,
        threadId: options.threadId || 'new-thread',
        messageId: '<message@example.test>',
        recipients: options.toArray || [],
        mode: options.threadId ? 'gmail_api_threaded' : 'gmail_api'
      };
    };
  `, context);
  return context;
}

test('completion replies to the submitted thread when metadata exists', () => {
  const context = prepareSendContext();
  context.__payload = {
    emailType: 'request_complete',
    requestCreatedByUsername: 'dylan_collyge',
    threadId: 'thread-123',
    messageId: '<submitted@example.test>'
  };
  const result = vm.runInContext('sendRequestEmailWithFallback_(__payload)', context);
  assert.equal(result.mode, 'gmail_api_threaded');
  assert.equal(context.__captured.threadId, 'thread-123');
  assert.equal(context.__captured.inReplyTo, '<submitted@example.test>');
  assert.equal(result.requiredRecipientsSatisfied, true);
  assert.equal(result.submitterIncluded, true);
});

test('completion uses the documented fresh-email fallback without thread metadata', () => {
  const context = prepareSendContext();
  context.__payload = {
    emailType: 'request_complete',
    requestCreatedByUsername: 'dylan_collyge'
  };
  const result = vm.runInContext('sendRequestEmailWithFallback_(__payload)', context);
  assert.equal(result.mode, 'gmail_api_fresh_completion');
  assert.equal(context.__captured.threadId, '');
  assert.match(result.message, /fresh email/i);
});

test('Warehouse Assigned Items export converts the keyed Supabase result into complete sorted rows', () => {
  const context = createContext();
  vm.runInContext(`
    __effectiveAssignmentRoute = null;
    syncWarehouseAssignedItemsSheet_ = function(sheetId, folderId, tableName) {
      __effectiveAssignmentRoute = { sheetId, folderId, tableName };
      return __effectiveAssignmentRoute;
    };
  `, context);
  const route = JSON.parse(JSON.stringify(vm.runInContext('runWarehouseAssignedItemsOnly()', context)));
  assert.equal(route.tableName, 'ph_inventory_row_assignments');

  vm.runInContext(`
    __selectedColumns = '';
    __writtenValues = null;
    callSupabaseRpc_ = function(name, args) {
      if (name !== 'get_eval_item_low_stock_targets_v1') throw new Error('Unexpected RPC');
      return args.p_itemcodes.map(itemcode_normalized => ({ itemcode_normalized, mean_quantity: 12,
        effective_qty: 35, suggested_qty: 30, qualifying_line_count: 15,
        qualifying_day_count: 3, history_ready: true, calculated_at: '2026-09-28T12:00:00Z', updated_at: '2026-09-28T13:00:00Z' }));
    };
    getSupabaseFetchOptionsForTable_ = function() { return {}; };
    fetchAllSupabaseData = function(tableName, selectColumns) {
      __selectedColumns = selectColumns;
      return {
        row_10: { master_unique_id: 'uid-10', unique_id: 'uid-10', itemcode_normalized: '10', locationcode: 'A.01.010', lotcode: 'L10', assignedto: 'megan_kelly', default_assignedto: 'zoe_green', default_revision: 2, assignment_reason: 'itemcode_default', review_required: false },
        row_2: { master_unique_id: 'uid-2', unique_id: 'uid-2', itemcode_normalized: '2', locationcode: 'A.01.002', lotcode: 'L2', assignedto: '', default_assignedto: '', default_revision: 0, assignment_reason: 'unassigned', review_required: true },
        row_100: { master_unique_id: 'uid-100', unique_id: 'uid-100', itemcode_normalized: '100', locationcode: 'B.02.100', lotcode: 'L100', assignedto: 'dylan_collyge', assignment_reason: 'zone_zoe', zone_override_active: true, present_in_drive: true }
      };
    };
    SpreadsheetApp = {
      openById: function() {
        return {
          getSheets: function() {
            return [{
              getLastRow: function() { return 1; },
              getLastColumn: function() { return 11; },
              getRange: function() {
                return {
                  clearContent: function() {},
                  setValues: function(values) { __writtenValues = values; },
                  setFontWeight: function() {}
                };
              },
              setFrozenRows: function() {}
            }];
          }
        };
      }
    };
    emitTableSyncLiveEvent_ = function() {};
  `, context);

  const result = vm.runInContext(
    "exportWarehouseAssignedItemsToSheet_('test-sheet', 'ph_inventory_row_assignments')",
    context
  );
  const writtenValues = JSON.parse(JSON.stringify(context.__writtenValues));

  assert.match(context.__selectedColumns, /(^|,)unique_id(,|$)/);
  assert.match(context.__selectedColumns, /(^|,)master_unique_id(,|$)/);
  assert.match(context.__selectedColumns, /(^|,)default_assignedto(,|$)/);
  assert.equal(result.exportedRows, 3);
  assert.equal(writtenValues.length, 4);
  assert.deepEqual(writtenValues[0].slice(0, 18), ['MASTER_UNIQUE_ID', 'ITEMCODE', 'GENUSNAME', 'ASSIGNEDTO', 'DEFAULT_ASSIGNEDTO', 'DEFAULT_REVISION', 'ASSIGNMENT_REASON', 'REVIEW_REQUIRED', 'ZONE_OVERRIDE_ACTIVE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SOURCE', 'WAREHOUSEI', 'PRESENT_IN_DRIVE', 'ASSIGNED_AT', 'UPDATED_AT']);
  assert.deepEqual(writtenValues.slice(1).map((row) => row[1]), ['2', '10', '100']);
  assert.deepEqual(writtenValues.slice(1).map((row) => row[3]), ['', 'megan_kelly', 'dylan_collyge']);
  assert.deepEqual(writtenValues.slice(1).map((row) => row[0]), ['uid-2', 'uid-10', 'uid-100']);
  assert.deepEqual(writtenValues[0].slice(18), ['AVERAGE_ORDER_QTY', 'LOW_STOCK_QTY', 'SUGGESTED_LOW_STOCK_QTY', 'ORDER_LINE_OBSERVATIONS', 'HISTORY_DAYS', 'HISTORY_CALCULATED_AT']);
  assert.deepEqual(writtenValues[1].slice(18, 23), [12, 35, 30, 15, 3]);
});
