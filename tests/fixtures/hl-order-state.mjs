import { inventoryReadFixture } from './inventory-list-read-fixture.mjs';

export const hlUserId = '54c87ebf-d76d-452b-96b4-beaaeb1742d9';
export const hlRecipient = 'dylan_collyge@greenleafnursery.com';
export const hlSoc = (source_id, changes = {}) => ({ source_id, unique_id: source_id, itemcode: 'SYNTH.003', commonname: 'Synthetic HL Holly',
  contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1', quantityordered: '10', ptravailable: null, dock: '4', planstartdate: '2026-09-15',
  stopnumber: '2', tripnumber: '1', transactionnumber: 'SYNTH-ORDER', purchaseordernumber: 'SYNTH-PO', customername: 'Synthetic Customer',
  consigneename: 'Synthetic Consignee', source_fingerprint: `fingerprint-${source_id}`, ...changes });
export const hlMaster = (unique_id, changes = {}) => inventoryReadFixture.row({ unique_id, itemcode: 'SYNTH.003', commonname: 'Synthetic HL Holly', contsize: '#3',
  locationcode: 'C.12.001', lotcode: '27.F1', ptravailable: '90', warehouseid: '10', warehousei: '10', season: 'F1', saleyear: '27', ...changes });

const clone = (value) => JSON.parse(JSON.stringify(value));
const uuid = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const fixtureShipDate = (value) => {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(text + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
  }
  const parsed = new Date(text);
  if (!text || !Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(parsed);
  const field = (type) => parts.find((part) => part.type === type).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
};

function fixturePdf() {
  const stream = 'BT /F1 12 Tf 30 70 Td (Synthetic HL preview - no email sent) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}

/** Isolated contract fixture. No real backend writes or email delivery are permitted. */
export function createHlOrderState(options = {}) {
  const sourceRows = options.rows || [hlSoc('hl-a'), hlSoc('hl-b', { quantityordered: '15', locationcode: 'C.14.002', lotcode: '26.F1' })];
  const keyFor = (row) => JSON.stringify([String(row.itemcode).trim().toUpperCase(), String(row.size ?? row.contsize).trim().toUpperCase()]);
  const sharedBalances = (rows) => {
    const groups = new Map();
    rows.forEach((row) => { const key = keyFor(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
    return [...groups].map(([key, copies]) => {
      const importedValues = copies.map((row) => row.imported === undefined ? row.remaining : row.imported);
      const known = importedValues.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
      const values = new Set(known);
      const status = values.size > 1 || copies.some((row) => row.status === 'conflict') ? 'conflict'
        : known.length !== copies.length || copies.some((row) => row.status === 'unknown') ? 'unknown' : 'ready';
      const imported = status === 'ready' ? known[0] : null, adjustment = Number(copies[0].receipt_adjustment || 0);
      return [key, { ...clone(copies[0]), lot: '27.F1', status, imported, receipt_adjustment: adjustment, remaining: imported === null ? null : imported - adjustment }];
    });
  };
  const membership = new Set((options.poMembership ?? sourceRows.map((row) => row.itemcode)).map((item) => String(item).toUpperCase()));
  const poBalances = new Map(sharedBalances(options.poBalances ?? sourceRows.map((row) => ({ itemcode: row.itemcode, size: row.contsize, remaining: 1000, imported: 1000, status: 'ready' }))));
  const state = { revision: 1, draft: [], actionable_rows: clone(sourceRows).filter((row) => membership.has(row.itemcode.toUpperCase())), dispositions: sourceRows.map((source) => ({ source_id: source.source_id, status: 'needed', source: clone(source), current_source: clone(source), available_quantity: source.available_quantity ?? Number(source.quantityordered) })), orders: [], batches: [], delivery_issues: [], po_imports: clone(options.poImports || []) };
  const control = { state, rows: sourceRows.map(({ source_id, source_fingerprint, available_quantity, ...row }) => row), poRows: options.poRows || [], master: options.master || [hlMaster('master-a'),
    hlMaster('master-b', { locationcode: 'C.14.002', lotcode: '26.F1', ptravailable: '42', saleyear: '26' }),
    hlMaster('master-other-location', { locationcode: 'A.02.001', lotcode: '25.S1', season: 'S1', saleyear: '25', ptravailable: null }),
    hlMaster('master-zero', { locationcode: 'B.01.010', lotcode: '28.F1', saleyear: '28', ptravailable: '0' }),
    hlMaster('master-other-size', { contsize: '#7', locationcode: 'A.07.001' }),
    hlMaster('master-other-item', { itemcode: 'UNRELATED', locationcode: 'A.08.001' })],
    commands: [], pdfRequests: [], blockedMutations: [], errors: [], runtime: 0, datasetRevision: 1,
    failAction: null, failPreview: false, loseSubmitResponse: false, replay: new Map(), previews: new Map(), sequence: 0,
    poBalances, receiptAdjustments: [], importPreviews: new Map(), activeCutoff: options.poCutoff || null };
  const sourceMap = new Map(sourceRows.map((row) => [row.source_id, clone(row)]));
  const source = (id) => sourceMap.get(id);
  const disposition = (id) => state.dispositions.find((entry) => entry.source_id === id);
  const problem = (message) => { const error = new Error(message); error.status = 409; throw error; };
  control.restockItems = clone(options.restockItems || []);
  control.restockReads = 0;
  control.inventorySnapshot = { revision: 'restock-master-1', completed_at: '2026-09-12T12:00:00Z' };
  control.restockSnapshot = () => ({ revision: state.revision, inventory_snapshot: clone(control.inventorySnapshot),
    items: control.restockItems.map((item) => {
      const matches = (row) => row.source?.source_kind === 'restock' && keyFor(row.source) === keyFor(item);
      const drafts = state.draft.filter(matches);
      const lines = state.orders.flatMap(order => order.lines).filter(matches);
      const saved = drafts.filter(draft => !lines.some(line => line.source_id === draft.source_id)).reduce((sum, row) => sum + row.quantity, 0);
      const incoming = lines.reduce((sum, line) => sum + line.outstanding_quantity, 0);
      return { ...clone(item), source_id: drafts.find(row => row.status === 'ready')?.source_id,
        saved_quantity: saved, incoming_quantity: incoming,
        suggested_quantity: item.status === 'ready' ? Math.max(0, Math.ceil(item.target - item.available - saved - incoming)) : null };
    }) });
  const latestImport = () => state.po_imports.filter((entry) => ['pending', 'reconciled'].includes(entry.status))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)))[0];
  control.snapshot = () => {
    const snapshot = clone(state);
    const newest = latestImport();
    snapshot.po_imports = newest?.status === 'pending' ? [clone(newest)] : [];
    const annotate = (row) => {
      const identity = row.source || row;
      row.po_match = membership.has(String(identity.itemcode).toUpperCase());
      row.po_balance = clone(poBalances.get(keyFor(identity)) || { itemcode: identity.itemcode, size: identity.contsize, lot: '27.F1', status: 'missing', remaining: null, imported: null, receipt_adjustment: 0 });
    };
    snapshot.actionable_rows = snapshot.actionable_rows.filter((row) => membership.has(row.itemcode.toUpperCase()));
    snapshot.actionable_rows.forEach(annotate); snapshot.draft.forEach(annotate);
    snapshot.orders.forEach((order) => { order.batches = snapshot.batches.filter((batch) => batch.order_id === order.id); order.lines.forEach(annotate); });
    return snapshot;
  };
  control.command = (body) => {
    control.commands.push(clone(body));
    if (control.replay.has(body.p_command_id)) return clone(control.replay.get(body.p_command_id));
    if (!body.p_command_id || !body.p_action) problem('HL_ORDER_INVALID_COMMAND');
    if (control.failAction === body.p_action) problem('HL_ORDER_REVISION_CONFLICT');
    if (Number(body.p_expected_revision) !== state.revision) problem('HL_ORDER_REVISION_CONFLICT');
    const action = body.p_action, payload = body.p_payload || {};
    let preview, poImportPreview;
    if (action === 'restock_draft_save') {
      if (JSON.stringify(payload.inventory_snapshot) !== JSON.stringify(control.inventorySnapshot)) problem('HL_RESTOCK_SNAPSHOT_STALE');
      const shipDate = fixtureShipDate(payload.ship_date);
      if (!shipDate) problem('HL_ORDER_SHIP_DATE_REQUIRED');
      for (const entry of payload.rows || []) {
        const item = control.restockSnapshot().items.find(row => keyFor(row) === keyFor(entry));
        const previous = entry.source_id && state.draft.find(row => row.source_id === entry.source_id && row.source.source_kind === 'restock');
        const sameDate = !entry.source_id && state.draft.find(row => row.status === 'ready' && row.ship_date === shipDate && row.source.source_kind === 'restock' && keyFor(row.source) === keyFor(entry));
        if (!item || item.status !== 'ready') problem('HL_RESTOCK_REVIEW_REQUIRED');
        if (!Number.isInteger(Number(entry.quantity)) || entry.quantity <= 0 || entry.quantity > item.suggested_quantity + (previous?.quantity || 0)) problem('HL_ORDER_INVALID_QUANTITY');
        const id = previous?.source_id || sameDate?.source_id || `restock:${uuid(++control.sequence)}`;
        const identity = { source_kind: 'restock', source_id: id, unique_id: id, itemcode: item.itemcode, contsize: item.size,
          commonname: item.commonname, lotcode: '27.F1', planstartdate: shipDate, quantityordered: String(item.target),
          locationcode: '', dock: '', stopnumber: '', source_fingerprint: `restock-${state.revision}` };
        sourceMap.set(id, identity);
        if (!disposition(id)) state.dispositions.push({ source_id: id, source_kind: 'restock', status: 'draft', source: clone(identity), current_source: clone(identity) });
        const active = state.orders.find(order => order.ship_date === shipDate && !['received','cancelled','received_and_cancelled'].includes(order.fulfillment_status));
        const draft = { source_id: id, source_kind: 'restock', quantity: Number(entry.quantity) + (sameDate?.quantity || 0), source: clone(identity), ship_date: shipDate,
          status: 'ready', target_order_id: active?.id || null, target_order_number: active?.order_number || null };
        state.draft = state.draft.filter(row => row.source_id !== id); state.draft.push(draft);
      }
    } else if (action === 'restock_inventory_confirm') {
      const item = control.restockItems.find(row => keyFor(row) === keyFor(payload));
      if (!item?.can_confirm_inventory || JSON.stringify(payload.inventory_snapshot) !== JSON.stringify(control.inventorySnapshot)
        || JSON.stringify(payload.receipt_watermark) !== JSON.stringify(item.receipt_watermark)) problem('HL_RESTOCK_SNAPSHOT_STALE');
      item.status = 'ready'; item.can_confirm_inventory = false;
    } else if (action === 'draft_save') {
      for (const entry of payload.rows || []) {
        if (!membership.has(String(source(entry.source_id)?.itemcode).toUpperCase())) problem('HL_ORDER_SOURCE_REVIEW_REQUIRED');
        if (!source(entry.source_id) || !Number.isInteger(Number(entry.quantity)) || !(Number(entry.quantity) > 0)
          || Number(entry.quantity) > Number(source(entry.source_id).available_quantity ?? source(entry.source_id).quantityordered)) problem('HL_ORDER_INVALID_COMMAND');
        if (disposition(entry.source_id)?.status === 'needs_review') problem('HL_ORDER_SOURCE_REVIEW_REQUIRED');
        if (disposition(entry.source_id)?.status === 'submitting') problem('HL_ORDER_DELIVERY_UNKNOWN');
        const shipDate = fixtureShipDate(source(entry.source_id).planstartdate);
        const active = state.orders.find((order) => order.ship_date === shipDate && !['received', 'cancelled', 'received_and_cancelled'].includes(order.fulfillment_status));
        const saved = { source_id: entry.source_id, quantity: Number(entry.quantity), source: clone(source(entry.source_id)), ship_date: shipDate,
          target_order_id: active?.id || null, target_order_number: active?.order_number || null, status: 'ready' };
        const index = state.draft.findIndex((row) => row.source_id === entry.source_id);
        if (index < 0) state.draft.push(saved); else state.draft[index] = saved;
        disposition(entry.source_id).status = 'draft';
      }
    } else if (action === 'draft_clear') {
      const ids = payload.source_ids || [];
      state.draft = state.draft.filter((row) => !ids.includes(row.source_id));
      ids.forEach((id) => { if (disposition(id)) disposition(id).status = 'needed'; });
    } else if (action === 'dismiss' || action === 'restore') {
      for (const id of payload.source_ids || []) {
        if (disposition(id)) disposition(id).status = action === 'dismiss' ? 'removed' : 'needed';
        state.draft = state.draft.filter((row) => row.source_id !== id);
      }
    } else if (action === 'preview' || action === 'cancellation_preview') {
      const order = action === 'cancellation_preview' ? state.orders.find((entry) => entry.id === payload.order_id) : null;
      const shipDate = order ? order.ship_date : String(payload.ship_date || state.draft.find((entry) => entry.status === 'ready')?.ship_date || '').slice(0, 10);
      if (!shipDate) problem('HL_ORDER_SHIP_DATE_REQUIRED');
      const lines = order ? (payload.lines || []).map((line) => ({ ...order.lines.find((entry) => entry.id === line.line_id)?.source, line_id: line.line_id, quantity: Number(line.quantity) }))
        : state.draft.filter((entry) => entry.status === 'ready' && entry.ship_date === shipDate).map((entry) => ({ ...entry.source, source_id: entry.source_id, quantity: entry.quantity }));
      if (!lines.length) problem('HL_ORDER_INVALID_COMMAND');
      const target = !order && state.orders.find((entry) => entry.id === state.draft.find((draft) => draft.ship_date === shipDate && draft.target_order_id)?.target_order_id);
      if (!order && target && target.status !== 'sent') problem('HL_ORDER_DELIVERY_UNKNOWN');
      preview = { id: uuid(++control.sequence), ship_date: shipDate, report: { contract_version: 'hl-order-report-v2', kind: order ? 'cancellation' : target ? 'addition' : 'submission', ship_date: shipDate,
        order_id: order?.id || target?.id || null, order_number: order?.order_number || target?.order_number || `HL-TEST-${control.sequence}`, original_order_number: order?.order_number,
        reason: payload.reason || '', created_at: '2026-09-11T16:00:00Z', lines, total_quantity: lines.reduce((total, line) => total + Number(line.quantity), 0) } };
      if (lines.some(line => line.source_kind === 'restock')) preview.report.contract_version = 'hl-order-report-v3';
      control.previews.set(preview.id, { ...clone(preview), revision: state.revision + 1 });
    } else if (action === 'submit' || action === 'cancellation_submit') {
      const saved = control.previews.get(payload.preview_id);
      if (!saved || saved.revision !== state.revision) problem('HL_ORDER_PREVIEW_STALE');
      if (action === 'submit') {
        const selected = saved.report.lines.map((line) => state.draft.find((entry) => entry.source_id === line.source_id));
        if (selected.some((entry) => !entry || entry.status !== 'ready')) problem('HL_ORDER_SOURCE_REVIEW_REQUIRED');
        const batch = { id: uuid(++control.sequence), preview_id: saved.id, event_id: null, status: 'queued', kind: saved.report.kind, ship_date: saved.report.ship_date, created_at: saved.report.created_at, sent_at: null };
        let order = saved.report.order_id ? state.orders.find((entry) => entry.id === saved.report.order_id) : null;
        if (!order) { order = { id: uuid(++control.sequence), order_number: saved.report.order_number, preview_id: saved.id, ship_date: saved.report.ship_date, created_at: saved.report.created_at, status: 'queued', fulfillment_status: 'open', receipts: [], cancellations: [], lines: [] }; state.orders.unshift(order); }
        batch.order_id = order.id; state.batches.unshift(batch);
        order.lines.push(...selected.map((entry, index) => ({ id: `line-${control.sequence}-${index}`, source_id: entry.source_id, source: clone(entry.source), ship_date: entry.ship_date, batch_id: batch.id, delivery_status: 'queued', quantity: entry.quantity, received_quantity: 0, cancelled_quantity: 0, outstanding_quantity: entry.quantity })));
        order.lines.forEach((line) => { disposition(line.source_id).status = 'submitting'; });
        selected.forEach((entry) => { entry.status = 'submitting'; });
      } else {
        const order = state.orders.find((entry) => entry.id === saved.report.order_id);
        order.cancellations.push({ id: uuid(++control.sequence), preview_id: saved.id, created_at: saved.report.created_at, status: 'queued', reason: saved.report.reason, lines: saved.report.lines });
      }
    } else if (action === 'receive') {
      const order = state.orders.find((entry) => entry.id === payload.order_id);
      if (!order) problem('HL_ORDER_INVALID_COMMAND');
      for (const input of payload.lines || []) {
        const line = order.lines.find((entry) => entry.id === input.line_id);
        const quantity = Number(input.received_quantity);
        if (!line || !Number.isInteger(quantity) || quantity < 0 || quantity > line.quantity - line.cancelled_quantity) problem('HL_ORDER_INVALID_COMMAND');
        const delta = quantity - line.received_quantity, key = keyFor(line.source), balance = poBalances.get(key);
        control.receiptAdjustments.push({ key, quantity_delta: delta, created_at: '2026-09-11T16:05:00Z' });
        if (balance) { balance.receipt_adjustment = Number(balance.receipt_adjustment || 0) + delta; if (balance.status === 'ready') balance.remaining -= delta; }
        control.poRows.filter((row) => keyFor(row) === key).forEach((row) => { row.po_remain = balance?.status === 'ready' ? balance.remaining : null; });
        control.datasetRevision++;
        order.receipts.push({ id: uuid(++control.sequence), line_id: line.id, quantity_delta: quantity - line.received_quantity, received_quantity: quantity, reason: payload.reason || '', created_at: '2026-09-11T16:05:00Z' });
        line.received_quantity = quantity;
        line.outstanding_quantity = line.quantity - line.cancelled_quantity - quantity;
        if (line.source.source_kind === 'restock' && delta) {
          const item = control.restockItems.find(row => keyFor(row) === keyFor(line.source));
          item.status = 'receipt_pending'; item.can_confirm_inventory = false;
          item.receipt_watermark = String(control.sequence); item.receipts = clone(order.receipts);
        }
      }
      order.fulfillment_status = order.lines.every((line) => !line.outstanding_quantity)
        ? order.lines.some((line) => line.cancelled_quantity > 0) ? 'received_and_cancelled' : 'received'
        : order.lines.some((line) => line.received_quantity > 0) ? 'partially_received' : 'open';
    } else if (action === 'po_import_preview') {
      const pending = state.po_imports.find((entry) => entry.id === payload.import_id && entry.status === 'pending');
      const cutoff = new Date(payload.receipt_cutoff);
      if (!pending) problem('HL_PO_IMPORT_NOT_PENDING');
      if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now() || (pending.created_at && cutoff > new Date(pending.created_at))
        || (control.activeCutoff && cutoff < new Date(control.activeCutoff))) problem('HL_PO_INVALID_CUTOFF');
      if (pending.id !== latestImport()?.id) problem('HL_PO_IMPORT_SUPERSEDED');
      poImportPreview = { id: uuid(++control.sequence), import_id: pending.id, receipt_cutoff: cutoff.toISOString(), expires_at: new Date(Date.now() + 900000).toISOString(), balances: sharedBalances(pending.balances || []).map(([, row]) => {
        const adjustment = control.receiptAdjustments.filter((entry) => entry.key === keyFor(row) && new Date(entry.created_at) > cutoff).reduce((sum, entry) => sum + entry.quantity_delta, 0);
        return { ...row, receipt_adjustment: adjustment, remaining: row.status === 'ready' ? Number(row.imported) - adjustment : null };
      }) };
      control.importPreviews.set(poImportPreview.id, { ...clone(poImportPreview), revision: state.revision + 1 });
    } else if (action === 'po_import_confirm') {
      const saved = control.importPreviews.get(payload.preview_id);
      if (!saved || saved.revision !== state.revision || new Date(saved.expires_at).getTime() <= Date.now()) problem('HL_PO_PREVIEW_STALE');
      const pending = state.po_imports.find((entry) => entry.id === saved.import_id);
      if (pending?.status !== 'pending' || pending.id !== latestImport()?.id) problem('HL_PO_IMPORT_SUPERSEDED');
      if (control.activeCutoff && new Date(saved.receipt_cutoff) < new Date(control.activeCutoff)) problem('HL_PO_PREVIEW_STALE');
      pending.status = 'reconciled'; control.activeCutoff = saved.receipt_cutoff;
      membership.clear(); poBalances.clear(); saved.balances.forEach((row) => { membership.add(row.itemcode.toUpperCase()); poBalances.set(keyFor(row), clone(row)); });
      control.datasetRevision++;
    } else if (action === 'resolve_review') {
      const entry = disposition(payload.source_id);
      if (!entry) problem('HL_ORDER_INVALID_COMMAND');
      entry.status = payload.resolution === 'remove' ? 'removed' : 'needed';
    } else if (action !== 'reconcile_delivery') problem('HL_ORDER_INVALID_COMMAND');
    state.revision++;
    state.actionable_rows = state.dispositions.filter((entry) => ['needed', 'draft', 'submitting'].includes(entry.status)).map((entry) => clone(source(entry.source_id))).filter(row => row.source_kind !== 'restock');
    const result = { ...control.snapshot(), ...(preview ? { preview } : {}), ...(poImportPreview ? { po_import_preview: poImportPreview } : {}) };
    control.replay.set(body.p_command_id, clone(result));
    return result;
  };
  control.deliver = (status = 'sent') => {
    const order = state.orders[0];
    if (!order) throw new Error('No synthetic order queued');
    order.status = status;
    const batch = state.batches.find((entry) => entry.order_id === order.id && entry.status === 'queued');
    if (batch) { batch.status = status; batch.sent_at = status === 'sent' ? '2026-09-11T16:10:00Z' : null; }
    order.lines.filter((line) => !batch || line.batch_id === batch.id).forEach((line) => { line.delivery_status = status; disposition(line.source_id).status = status === 'sent' ? 'handled' : 'submitting'; });
    if (status === 'sent') state.draft = state.draft.filter((entry) => !order.lines.some((line) => line.source_id === entry.source_id && line.delivery_status === 'sent'));
    state.actionable_rows = state.dispositions.filter((entry) => ['needed', 'draft', 'submitting'].includes(entry.status)).map((entry) => clone(source(entry.source_id))).filter(row => row.source_kind !== 'restock');
    state.delivery_issues = state.delivery_issues.filter((entry) => entry.order_id !== order.id);
    if (status === 'delivery_unknown') state.delivery_issues.push({ event_id: uuid(++control.sequence), order_id: order.id, status, message: 'Delivery could not be confirmed' });
    state.revision++;
  };
  control.confirmCancellation = () => {
    const order = state.orders[0], cancellation = order.cancellations.at(-1);
    if (!cancellation || cancellation.status !== 'queued') throw new Error('No synthetic cancellation queued');
    cancellation.status = 'sent';
    for (const input of cancellation.lines) {
      const line = order.lines.find((entry) => entry.id === input.line_id);
      line.cancelled_quantity += input.quantity;
      line.outstanding_quantity = line.quantity - line.cancelled_quantity - line.received_quantity;
    }
    order.fulfillment_status = 'partially_cancelled'; state.revision++;
  };
  control.markChanged = (sourceId, changes) => {
    const old = clone(source(sourceId));
    Object.assign(source(sourceId), changes, { source_fingerprint: `${old.source_fingerprint}-changed` });
    const raw = control.rows.find((row) => row.unique_id === sourceId);
    Object.assign(raw, changes);
    const entry = disposition(sourceId);
    Object.assign(entry, { status: 'needs_review', source: old, current_source: clone(source(sourceId)), reason: 'Source row changed', replacement_candidates: [] });
    state.draft.forEach((row) => { if (row.source_id === sourceId) row.status = 'needs_review'; });
    state.actionable_rows = state.dispositions.filter((entry) => ['needed', 'draft', 'submitting'].includes(entry.status)).map((entry) => clone(source(entry.source_id))).filter(row => row.source_kind !== 'restock');
    state.revision++; control.datasetRevision++;
  };
  return control;
}

export async function installHlOrderFixture(page, baseURL, options = {}) {
  const control = createHlOrderState(options), username = options.username || 'dylan_collyge', role = options.role || 'ADMIN';
  control.appAccessReads = 0; control.backgroundMasterReads = 0;
  control.runtimeRequests = 0; control.authTokenRequests = 0;
  if (options.seedOrder) {
    const first = control.state.actionable_rows[0];
    const command = (action, payload) => control.command({ p_command_id: uuid(++control.sequence), p_action: action, p_payload: payload, p_expected_revision: control.state.revision });
    command('draft_save', { rows: [{ source_id: first.source_id, quantity: 10 }] });
    const preview = command('preview', {}).preview;
    command('submit', { preview_id: preview.id });
    control.deliver(options.seedDelivery || 'sent');
    control.commands.length = 0;
  }
  const origin = new URL(baseURL).origin;
  const seasonSettings = [{ key: 'current_season_salesyear', value: { seasonCode: 'F1', salesYear: '27' } }];
  const claims = { sub: hlUserId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic'].join('.');
  const profile = { id: hlUserId, username, display_name: username, role, division: '10', language: 'English', disabled_at: null, locked_until: null, must_change_password: false };
  const session = { access_token: token, refresh_token: 'synthetic', expires_at: claims.exp, expires_in: 3600, token_type: 'bearer', user: { id: hlUserId, aud: 'authenticated', role: 'authenticated', email: 'hl-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  const json = (route, value, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': route.request().headers()['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile',
    'access-control-expose-headers': 'content-range',
    'access-control-allow-credentials': 'true', ...headers
  }, body: JSON.stringify(value) });
  page.on('pageerror', (error) => control.errors.push(error.message));
  const pendingRevisionReads = new Set();
  let revisionReadEpoch = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1') {
      pendingRevisionReads.add(request); revisionReadEpoch++;
    }
  });
  page.on('requestfinished', (request) => pendingRevisionReads.delete(request));
  page.on('requestfailed', (request) => pendingRevisionReads.delete(request));
  control.waitForRevisionIdle = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!pendingRevisionReads.size) {
        const epoch = revisionReadEpoch;
        // Let response bodies and their browser promise continuations finish
        // before explicit reload tears down WebKit's cross-origin requests.
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
        if (!pendingRevisionReads.size && epoch === revisionReadEpoch) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('HL_FIXTURE_REVISION_READS_DID_NOT_SETTLE');
  };
  page.on('response', (response) => { if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) control.runtime++; });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin === origin && ['GET', 'HEAD'].includes(method)) {
      if (/\/assets\/live-app-runtime[^/]*\.js/.test(url.pathname)) {
        control.runtimeRequests++;
        // Opt-in bootstrap tests control only the compiled runtime transport.
        // All auth and application behavior still comes from the actual app.
        if (options.runtimeRequest) return options.runtimeRequest(route, control);
      }
      return route.continue();
    }
    if (method === 'OPTIONS') return json(route, {});
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/token') && method === 'POST') control.authTokenRequests++;
      return json(route, url.pathname.endsWith('/user') ? session.user : session);
    }
    if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
      const body = req.postDataJSON() || {};
      if (body.type === 'hl_order_preview') {
        control.pdfRequests.push(clone(body));
        if (!control.previews.has(body.previewId) || body.nativeAuthAccessToken !== token) return json(route, { ok: false, message: 'HL_ORDER_PREVIEW_STALE' });
        return json(route, control.failPreview ? { ok: false, message: 'Synthetic PDF failure' } : { ok: true, previewId: body.previewId, pdfBase64: fixturePdf(), fileName: 'HL-TEST.pdf', mimeType: 'application/pdf', recipient: hlRecipient });
      }
      if (body.type === 'email') { control.blockedMutations.push('legacy email send'); return json(route, { ok: false }, 403); }
      return json(route, { ok: true, active: false });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const op = url.pathname.split('/').pop(), body = req.postDataJSON() || {};
      if (op === 'hl_order_state' || op === 'hl_order_command' || op === 'hl_order_restock_state') {
        if (username !== 'dylan_collyge') return json(route, { message: 'HL_ORDER_FORBIDDEN' }, 403);
        if (op === 'hl_order_state') return json(route, control.snapshot());
        if (op === 'hl_order_restock_state') { control.restockReads++; return json(route, control.restockSnapshot()); }
        try {
          const result = control.command(body);
          if (body.p_action === 'submit' && control.loseSubmitResponse) return route.abort('connectionreset');
          return json(route, result);
        } catch (error) { return json(route, { code: 'P0001', message: error.message }, error.status || 400); }
      }
      if (op === 'get_my_dataset_revisions_v1') return json(route, { contractVersion: 1, permissionVersion: 'hl-policy-1', sources: (body.p_dataset_keys || []).map((key) => ({ key, revision: String(control.datasetRevision), state: 'ready' })) });
      if (op === 'get_my_app_permissions_v1') {
        control.appAccessReads++;
        if (Number(options.appAccessDelayMs) > 0) await new Promise(resolve => setTimeout(resolve, Number(options.appAccessDelayMs)));
        return json(route, { contractVersion: 'app-access-v1', enforcementMode: 'enforced', username, role, permissions: options.appPermissions || [{ permissionKey: 'module.po-management.view', kind: 'module', moduleKey: 'po-management', allowed: true }] });
      }
      if (op === 'get_request_capabilities') return json(route, { contract_version: 2, username, scope: 'global', can_view_queue: true, can_edit: true, can_complete: true });
      if (op === 'get_request_schema_compatibility') return json(route, { compatible: true, contract_version: 2 });
      if (/^(get_|list_|report_app_health_event)/.test(op || '')) return json(route, []);
      control.blockedMutations.push(`RPC ${op}`); return json(route, { error: 'Blocked' }, 403);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!['GET', 'HEAD'].includes(method)) { control.blockedMutations.push(`${method} ${url.pathname}`); return json(route, {}, 403); }
      const table = url.pathname.split('/').pop();
      if (table === 'profiles') return json(route, /vnd\.pgrst\.object/.test(req.headers().accept || '') ? profile : [profile]);
      if (table === 'ph_app_settings') return json(route, seasonSettings);
      if (url.searchParams.get('select') === 'filename,last_updated' && url.searchParams.get('last_updated') === 'not.is.null') return json(route, []);
      if (table === 'ph_master_inventory') {
        control.backgroundMasterReads++;
        if (Number(options.holdBackgroundMasterMs) > 0) await new Promise(resolve => setTimeout(resolve, Number(options.holdBackgroundMasterMs)));
      }
      const rows = table === 'ph_soc_master' ? control.rows : table === 'ph_master_inventory' ? inventoryReadFixture.read(control.master, url.search.slice(1)).rows : table === 'ph_view_po_27f1_hl' ? control.poRows : [];
      return json(route, rows, 200, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
    }
    if (url.pathname.endsWith('/functions/v1/app-api')) {
      const body = req.postDataJSON() || {};
      if (body.action === 'native_session_bridge') return json(route, { ok: true, session: { token: 'synthetic-bridge', expiresAt: Date.now() + 3600000, username, displayName: username, role } });
      if (body.action === 'db' && String(body.method).toUpperCase() === 'GET') return json(route, { ok: true, data: body.table === 'ph_soc_master' ? control.rows : body.table === 'ph_master_inventory' ? inventoryReadFixture.read(control.master, body.query || '').rows : body.table === 'ph_app_settings' ? seasonSettings : [] });
      if (body.action === 'season_sales_office' && body.operation === 'access') return json(route, { ok: true, allowed: false, canManage: false, users: [] });
      if (['list', 'get', 'state'].includes(body.operation) || /get|load|status|preferences|capabilit|health|telemetry|event/.test(body.action || '')) return json(route, { ok: true, data: [], preferences: {}, eligible: false });
      control.blockedMutations.push(`API ${body.action}:${body.operation || ''}`); return json(route, { ok: false, error: 'Blocked' }, 403);
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript((value) => {
    if (value.startupMode === 'cold') {
      ['gnc_user_v3', 'gnc_role_v3', 'gnc_division_v1', 'gnc_language_v1', 'gnc_native_auth_profile_v1'].forEach(key => localStorage.removeItem(key));
    } else {
      localStorage.setItem('gnc_user_v3', value.username);
      localStorage.setItem('gnc_role_v3', value.role);
      localStorage.setItem('gnc_division_v1', '10');
    }
    if (value.startupMode !== 'cold') localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(value));
    // Service workers are blocked in this isolated HL suite. Expose push as
    // unavailable too, so delayed enrollment cannot replace an HL error toast.
    // Production notification behavior and the app's toast assertions stay intact.
    delete window.PushManager;
  }, { ...session, startupMode: options.startupMode || 'restored', username, role });
  // A held runtime may delay load. The shell is usable at DOMContentLoaded,
  // allowing opt-in tests to inspect it before normal cold-login automation.
  await page.goto('/', { waitUntil: options.beforeLogin ? 'domcontentloaded' : 'load' });
  if (options.beforeLogin) await options.beforeLogin(control);
  if (options.startupMode === 'cold') {
    await page.locator('#username-input').fill(username);
    await page.locator('#pin-code').fill('Synthetic-Access-123!');
    await page.locator('#login-button').click();
  }
  await page.waitForFunction(() => window.eval('typeof nativeAuthProfile !== "undefined" && !!nativeAuthProfile'));
  // A profile can exist before initial login opens Home. Navigate only after
  // that initialization has finished, without replacing any authorization state.
  await page.locator('#view-login').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.body.classList.contains('role-access-ready')
    && window.eval('hasAppliedInitialHomeView === true'));
  return control;
}
