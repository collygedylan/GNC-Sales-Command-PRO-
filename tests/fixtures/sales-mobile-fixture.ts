import type { Page, Route } from '@playwright/test';
import { installHlOrderFixture, hlMaster, hlSoc, hlUserId } from './hl-order-state.mjs';

// Browser contract fixtures prove the compiled UI transport and recovery paths.
// RLS, transactions and competing sessions are tested separately against PostgreSQL.
const copy = <T>(value: T): T => structuredClone(value);
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const customerKey = 'customer-acme-north';
export const folderName = 'Acme Nursery — North Farm';
const source = (number: number, name: string) => ({
  id: id(number), source_kind: 'docks', source_id: `dock-${number}`,
  revision: 1, customer_key: customerKey, claims: [], canAuthorizeRepeat: false,
  snapshot: { commonname: name, itemcode: `CREDIT.${number}`, contsize: '#3', lotcode: '27.F1',
    locationcode: `D.08.00${number}`, quantityordered: number * 10, dock: '8',
    planstartdate: '2026-09-20', transactionnumber: `SHIPMENT-${number}`,
    customername: 'Acme Nursery', consigneename: 'North Farm', assigned_rep_id: hlUserId },
});

export async function installSalesMobileFixture(page: Page, baseURL: string, options: { role?: string } = {}) {
  const sources = [source(1, 'Blue Hydrangea'), source(2, 'Red Hydrangea')];
  const history = Array.from({ length: 63 }, (_, index) => {
    const at = new Date(Date.UTC(2026, 8, 20, 12, -index)).toISOString();
    const snapshot = { ...sources[0].snapshot, unique_id: `history-${index}`, itemcode: `HIST.${index}`,
      commonname: index === 62 ? 'Rare Orchid' : `Cedar ${String(index).padStart(2, '0')}`,
      date_completed: at, created_at: '2026-08-01T12:00:00Z', req_status: 'COMPLETED', req_note: `Completed instruction ${index}` };
    return { id: id(100 + index), source_kind: 'request_history', source_id: snapshot.unique_id,
      snapshot, ...snapshot, status: 'completed', sort_at: at, customerKey, canRequestCredit: index !== 1 };
  });
  const pendingAt = '2026-09-20T14:00:00Z';
  history.push({ ...history[0], id: id(190), source_id: 'history-pending', commonname: 'Pending Magnolia',
    customerKey: 'customer-acme-unknown', status: 'pending', sort_at: pendingAt,
    snapshot: { ...history[0].snapshot, unique_id: 'history-pending', consigneename: '', commonname: 'Pending Magnolia',
      date_completed: '', created_at: pendingAt, req_status: 'PENDING' } });
  const requestSources = history.filter(row => row.status === 'completed').map((row, index) => ({
    id: id(500 + index), source_kind: 'request_history', source_id: row.source_id,
    revision: 1, customer_key: row.customerKey, snapshot: copy(row.snapshot),
    claims: [], canAuthorizeRepeat: false,
  }));
  const allSources = [...sources, ...requestSources];
  const drafts = new Map<string, any>(), submissions = new Map<string, any>(), attachments = new Map<string, any>();
  const productionRows = new Map<string, any>();
  const inventoryRows = Array.from({ length: 101 }, (_, index) => ({ id: id(700 + index), action: 'qty',
    status: index === 100 ? 'requested' : 'applied', actor_username: 'dylan_collyge', created_at: '2026-09-20T12:00:00Z',
    source_itemcode: `TX${String(index).padStart(4, '0')}`, source_lotcode: '27.F1', source_locationcode: 'D.08.001',
    quantity: 2, reason: index === 100 ? 'Beyond first page request' : `Audit reason ${index}`,
    source_before: { ptronhand: 20, ptravailable: 15 }, source_after: index === 100 ? null : { ptronhand: 18, ptravailable: 13 } }));
  const commands: any[] = [], replay = new Map<string, { fingerprint: string; data: any }>();
  const navigation: any = {
    profileId: hlUserId, username: 'dylan_collyge', role: 'ADMIN', manager: true,
    accessRevision: 0, footerRevision: 0, shortcuts: ['drive', 'tasks', 'docks', 'request', 'bloom'],
    views: [['drive', 'Drive'], ['tasks', 'Tasks'], ['docks', 'Docks'], ['request', 'Queue'], ['bloom', 'Bloom'],
      ['sales', 'Sales'], ['sales-office', 'Sales Office'], ['request-history', 'Request History'],
      ['sales-credit', 'Credit'], ['credit-request', 'Credit Request'], ['communication', 'Communication'], ['reports', 'Reports']]
      .map(([view, label]) => ({ view, label, parent: ['request-history', 'sales-credit', 'credit-request'].includes(view) ? 'sales' : null,
        selectable: view !== 'communication', allowed: true, override: null, protectedReason: view === 'credit-request' ? 'Reviewer actions remain protected' : null })),
  };
  const control = {
    sources, requestSources, history, drafts, submissions, attachments, commands, navigation, productionRows, inventoryRows,
    failUploads: false, loseSubmitAcknowledgement: false, rejectShortcutSave: false,
    denyHistory: false, denySource: false, contractErrors: [] as string[], native: null as any,
    seedReview() {
      const submissionId = id(300);
      const lines = sources.map((row, index) => ({ id: id(310 + index), submission_id: submissionId,
        source_id: row.id, snapshot: copy(row.snapshot), quantity: index + 2, explanation: `Evidence for line ${index + 1}`,
        status: 'pending', revision: 1, attachment_ids: [], reviewHistory: [], canAmend: true }));
      submissions.set(submissionId, { submission: { id: submissionId, snapshot: copy(sources[0].snapshot),
        state: 'submitted', submitted_at: '2026-09-20T14:00:00Z', revision: 1 }, lines });
      return submissionId;
    },
  };
  const folder = { customerKey, customername: 'Acme Nursery', consigneename: 'North Farm', count: 2 };
  const folderFor = (row: any) => ({ customerKey: row.customerKey || row.customer_key,
    customername: row.snapshot.customername, consigneename: row.snapshot.consigneename || null });
  const pageRows = (rows: any[], payload: any) => {
    const offset = Number(payload.cursor || 0), limit = Math.min(100, Number(payload.limit || 50));
    return { rows: rows.slice(offset, offset + limit), nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
  };
  const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
  const requireRevision = (body: any, revision: number) => {
    if (body.expectedRevision !== revision) fail('REVISION_CONFLICT');
    if (!/^[a-f\d-]{36}$/i.test(body.commandId || '')) fail('COMMAND_ID_REQUIRED', 400);
  };
  const contract = (body: any) => {
    const p = body.payload || {}, op = body.operation;
    if (body.action === 'production_workflow') {
      if (op === 'list') return { rows: [...productionRows.values()].filter(row => row.workflow_type === body.workflow_type && row.status === 'open').map(copy) };
      if (!body.command_id || !['propagation', 'planting'].includes(body.workflow_type)) fail('WORKFLOW_COMMAND_INVALID', 400);
      if (op === 'add') {
        if (body.expected_revision !== 0 || !body.source_identity?.unique_id || !(body.row?.quantity > 0)) fail('WORKFLOW_SOURCE_INVALID');
        if (productionRows.get(body.row.unique_id)?.status === 'open') fail('WORKFLOW_ALREADY_OPEN');
        const row = { ...copy(body.row), revision: 1, status: 'open', owner_id: hlUserId };
        productionRows.set(row.unique_id, row); return { row: copy(row) };
      }
      if (op === 'complete') {
        const row = productionRows.get(body.unique_id);
        if (!row || row.revision !== body.expected_revision || row.status !== 'open') fail('WORKFLOW_REVISION_CONFLICT');
        row.status = 'complete'; row.revision++; return { row: copy(row) };
      }
      fail(`Unexpected production operation ${op}`, 400);
    }
    if (body.action === 'inventory_transaction_history') {
      const query = String(body.search || '').trim().toLowerCase();
      const matching = inventoryRows.filter(row => (body.filter_action === 'all' || row.action === body.filter_action) && JSON.stringify(row).toLowerCase().includes(query));
      const offset = Number(body.offset || 0), limit = Number(body.limit || 100);
      return { rows: matching.slice(offset, offset + limit).map(copy), hasMore: offset + limit < matching.length };
    }
    if (body.action === 'navigation_preferences') {
      if (op === 'get') return copy(navigation);
      if (op === 'save_shortcuts') {
        requireRevision(body, navigation.footerRevision);
        if (control.rejectShortcutSave || p.shortcuts.some((view: string) => !navigation.views.some((v: any) => v.view === view && v.allowed && v.selectable))) fail('NAVIGATION_SHORTCUT_NOT_ALLOWED', 403);
        navigation.shortcuts = copy(p.shortcuts); navigation.footerRevision++;
        return copy(navigation);
      }
      fail(`Unexpected navigation operation ${op}`, 400);
    }
    if (op === 'compatibility') return { rows: [], nextCursor: null };
    if (body.action === 'request_history') {
      if (control.denyHistory) fail('SALES_ACCESS_DENIED', 403);
      if (op === 'folders') {
        const visible = history.filter(row => p.status === 'all' || row.status === p.status);
        const groups = new Map<string, any>();
        for (const row of visible) {
          const existing = groups.get(row.customerKey);
          if (existing) existing.count++;
          else groups.set(row.customerKey, { ...folderFor(row), count: 1 });
        }
        return { folders: [...groups.values()], nextCursor: null };
      }
      if (op === 'search') {
        const query = String(p.query || '').trim().toLowerCase();
        return pageRows(history.filter(row => (p.status === 'all' || row.status === (p.status || 'completed')) &&
          (!p.customerKey || row.customerKey === p.customerKey) &&
          [row.snapshot.customername, row.snapshot.consigneename, row.snapshot.itemcode, row.snapshot.commonname,
            [row.snapshot.customername, row.snapshot.consigneename || 'Unknown consignee'].join(' — ')]
            .join(' ').toLowerCase().includes(query))
          .sort((a, b) => b.sort_at.localeCompare(a.sort_at) || b.id.localeCompare(a.id)), p);
      }
      fail(`Unexpected history operation ${op}`, 400);
    }
    if (['folders', 'sources', 'source'].includes(op) && !['docks', 'request_history'].includes(p.sourceKind))
      fail('SOURCE_KIND_REQUIRED', 400);
    const creditSources = p.sourceKind === 'request_history' ? requestSources : sources;
    if (op === 'folders') return { folders: [{ ...folder, count: creditSources.length }], nextCursor: null };
    if (op === 'sources') return { ...pageRows(creditSources.filter(row => row.customer_key === p.customerKey &&
      `${row.snapshot.itemcode} ${row.snapshot.commonname}`.toLowerCase().includes(String(p.query || '').trim().toLowerCase())), p), requesters: [] };
    if (op === 'source') {
      if (control.denySource) fail('SOURCE_ACCESS_DENIED', 403);
      const row = creditSources.find(sourceRow => sourceRow.source_id === p.sourceUniqueId);
      if (!row) fail('SOURCE_NOT_FOUND', 404);
      return { source: copy(row), folder: folderFor(row) };
    }
    if (op === 'drafts') return { drafts: [...drafts.values()].filter(draft => !submissions.has(draft.id)).map(copy) };
    if (op === 'attachment_upload') {
      if (control.failUploads) fail('Photo upload unavailable. Your entries and photos are retained.');
      if (!allSources.some(row => row.id === p.sourceId) || !p.mime?.startsWith('image/') || !p.base64) fail('INVALID_ATTACHMENT', 400);
      const attachmentId = id(400 + attachments.size);
      attachments.set(attachmentId, copy(p));
      return { attachmentId, sourceId: p.sourceId, mime: p.mime, size: Buffer.from(p.base64, 'base64').length };
    }
    if (op === 'save_draft') {
      const previous = drafts.get(p.id); requireRevision(body, previous?.revision || 0);
      if (submissions.has(p.id)) fail('SUBMISSION_ALREADY_SAVED');
      const draft = { ...copy(p), customer_key: p.customerKey,
        snapshot: copy(allSources.find(row => row.id === p.lines[0]?.sourceId)?.snapshot || sources[0].snapshot),
        lines: p.lines.map((line: any) => ({ ...copy(line), snapshot: copy(allSources.find(row => row.id === line.sourceId)?.snapshot) })),
        revision: (previous?.revision || 0) + 1 };
      drafts.set(draft.id, draft); return { draft: copy(draft) };
    }
    if (op === 'submit') {
      const draft = drafts.get(p.id); if (!draft) fail('DRAFT_NOT_FOUND', 404);
      requireRevision(body, draft.revision);
      if (submissions.has(p.id)) fail('DUPLICATE_SUBMISSION');
      if (!draft.lines.length || draft.lines.some((line: any) => !(line.quantity > 0) || !line.explanation?.trim())) fail('COMPLETE_EACH_LINE', 400);
      const submission = { id: draft.id, snapshot: copy(draft.snapshot), state: 'submitted', revision: draft.revision + 1, submitted_at: '2026-09-20T14:00:00Z' };
      submissions.set(draft.id, { submission, lines: draft.lines.map((line: any) => ({ ...copy(line), source_id: line.sourceId,
        submission_id: draft.id, status: 'pending', revision: 1, attachment_ids: copy(line.attachmentIds), reviewHistory: [], canAmend: true })) });
      return { submission: copy(submission) };
    }
    if (op === 'submissions') {
      const rows = [...submissions.values()].map(entry => ({ ...copy(entry.submission),
        line_count: entry.lines.filter((line: any) => line.status === p.status).length })).filter(row => row.line_count > 0);
      return { ...pageRows(rows, p), canReview: true };
    }
    if (op === 'detail') {
      const entry = submissions.get(p.id); if (entry) return { ...copy(entry), canReview: true };
      if (drafts.has(p.id)) return { draft: copy(drafts.get(p.id)) };
      fail('NOT_FOUND', 404);
    }
    if (op === 'review_line') {
      const line = [...submissions.values()].flatMap(entry => entry.lines).find(line => line.id === p.lineId);
      if (!line) fail('NOT_FOUND', 404); requireRevision(body, line.revision);
      if (line.status !== 'pending') fail('LINE_ALREADY_REVIEWED');
      if (p.decision === 'denied' && !p.reason?.trim()) fail('DENIAL_REASON_REQUIRED', 400);
      line.status = p.decision; line.revision++; line.review_note = p.reason;
      line.reviewHistory.push({ event_type: p.decision, actor_id: hlUserId, created_at: '2026-09-20T15:00:00Z', reason: p.reason });
      return { line: copy(line) };
    }
    fail(`Unexpected sales operation ${op}`, 400);
  };
  const handle = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (!['request_history', 'sales_credit', 'navigation_preferences', 'production_workflow', 'inventory_transaction_history'].includes(body?.action)) return route.fallback();
    commands.push(copy(body));
    const headers = { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' };
    try {
      const commandId = body.commandId || body.command_id;
      const key = `${body.action}:${commandId || ''}`, fingerprint = JSON.stringify({ ...body, commandId: undefined, command_id: undefined });
      const saved = commandId && replay.get(key);
      if (saved && saved.fingerprint !== fingerprint) fail('COMMAND_ID_REUSE');
      const data = saved ? copy(saved.data) : contract(body);
      if (commandId && !saved) replay.set(key, { fingerprint, data: copy(data) });
      // Apply the command once, then fail its acknowledgement. Retry must replay
      // this result without saving a new draft, uploading again, or claiming twice.
      if (body.operation === 'submit' && control.loseSubmitAcknowledgement) fail('Submission acknowledgement lost. Retry Submit to confirm the saved result.');
      const envelope = ['production_workflow', 'inventory_transaction_history'].includes(body.action) ? { ok: true, ...data } : { ok: true, data };
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(envelope) });
    } catch (error: any) {
      if (/^Unexpected/.test(error.message)) control.contractErrors.push(error.message);
      return route.fulfill({ status: error.status || 400, headers, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: error.message, message: error.message, code: error.message }) });
    }
  };
  control.native = await installHlOrderFixture(page, baseURL, {
    role: options.role,
    ...(options.role === 'SALES' ? { rows: sources.map(row => hlSoc(row.source_id, { ...row.snapshot, salesrepname: 'Dylan Collyge' })) } : {}),
    master: [hlMaster('production-source', { blockalpha: 'D', locationcode: 'D.08.001',
      itemcode: 'PROP.001', commonname: 'Propagation Holly', ptronhand: '20', ptravailable: '15' })],
    beforeNavigate: async () => { await page.route('**/functions/v1/app-api', handle); },
  });
  await page.waitForFunction(() => Boolean((window as any).GncNavigationPreferences?.snapshot?.views?.length));
  return control;
}
