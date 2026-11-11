export function recordEmptySecondaryResult(results, stage, folder) {
  if (!results.some(row => row.key === stage.key)) {
    results.push({ key: stage.key, outcome: 'UP_TO_DATE', processedFiles: 0, listDurationMs: folder.listDurationMs });
  }
}

export function hasPendingSecondaryFile(files, attempted) {
  return files.some(file => !attempted.has(file.id));
}

export async function markSecondaryArchive(supabase, stage, file, digest, rpc) {
  if (stage.key === 'hl_po_parsed') return;
  const transactions = stage.key === 'transactions_keyed';
  const args = transactions ? { source_drive_file_id: file.id, source_content_sha256: digest }
    : { p_drive_file_id: file.id, p_content_sha256: digest };
  await rpc(supabase, transactions ? 'mark_transactions_keyed_file_archived' : 'mark_pikes_order_file_archived', args);
}

export async function processHlPdf({ file, bytes, state, fetcher, env, status, operationalOnly }) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetcher(`${env('SUPABASE_URL')}/functions/v1/hl-po-pdf-import`, {
    method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source_file_id: file.id, source_file_name: file.name,
      pdf_base64: btoa(binary), start_page: state.nextPage || 1 }), signal: AbortSignal.timeout(25000)
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(body.code || 'HL_PO_IMPORT_FAILED');
  const complete = body.next_page === null;
  state.nextPage = body.next_page;
  state.rowCount = Number(body.total_rows || body.row_count || 0);
  if (complete && (state.rowCount < 1 || !body.run_id)) throw new Error('HL_PO_RECEIPT_UNCONFIRMED');
  if (operationalOnly) await status({ sourceProgressDelta: {
    key: 'hl_po_parsed', fileName: file.name, stage: complete ? 'published' : 'staging',
    percent: complete ? 100 : 70, rowsParsed: state.rowCount, rowsStaged: state.rowCount,
    rowsTotal: complete ? state.rowCount : null,
    ...(complete ? { publicationConfirmed: true, publishedFileName: file.name, rowsPublished: state.rowCount } : {}),
    updatedAt: new Date().toISOString()
  } });
  return complete;
}

async function prepareSecondary({ stage, file, state, digest, bytes, supabase, api }) {
  const transactions = stage.key === 'transactions_keyed';
  const prepared = await api.rpc(supabase, transactions ? 'prepare_transactions_keyed_import' : 'prepare_manager_order_import_v2',
    transactions ? { source_drive_file_id: file.id, source_file_name: file.name, source_content_sha256: digest,
      source_content_bytes: bytes.length, source_import_batch_id: state.batchId }
      : { p_source_key: stage.key, p_drive_file_id: file.id, p_file_name: file.name,
        p_content_sha256: digest, p_content_bytes: bytes.length, p_batch_id: state.batchId });
  const complete = ['archive_pending', 'processed', 'duplicate', 'duplicate_archive_pending'].includes(String(prepared.status));
  if (!complete && prepared.status !== 'importing') throw new Error('SECONDARY_PREPARE_STATE_INVALID');
  state.batchId = prepared.batchId || state.batchId;
  state.prepared = true;
  return complete;
}

export async function processSecondaryWorkbook(context) {
  const { stage, file, state, digest, bytes, supabase, parseWorkbook, api } = context;
  if (!state.prepared && await prepareSecondary(context)) return true;
  const sheet = api.readSheet(await parseWorkbook(bytes, Math.max(80, state.nextOffset) + 1001), stage.key);
  if (!state.nextOffset) state.nextOffset = sheet.header + 1;
  const part = await api.buildRows(sheet, stage, file, state);
  if (part.rows.length) await api.rpc(supabase, 'upsert_secondary_erp_delta_v23103', { p_source: stage.key, p_rows: part.rows });
  state.nextOffset = part.nextOffset;
  state.rowCount += part.rows.length;
  if (!part.done) return false;
  if (!state.rowCount) throw new Error('SECONDARY_EMPTY_IMPORT');
  const transactions = stage.key === 'transactions_keyed';
  const finalized = await api.rpc(supabase, transactions ? 'finalize_transactions_keyed_import' : 'finalize_pikes_order_import',
    transactions ? { source_drive_file_id: file.id, source_content_sha256: digest, source_sheet_name: sheet.name,
      source_header_row: sheet.header + 1, expected_row_count: state.rowCount }
      : { p_drive_file_id: file.id, p_content_sha256: digest, p_source_sheet_name: sheet.name,
        p_source_header_row: sheet.header + 1, p_expected_row_count: state.rowCount });
  if (!['archive_pending', 'duplicate_archive_pending', 'processed'].includes(String(finalized.status))) {
    throw new Error('SECONDARY_FINALIZE_STATE_INVALID');
  }
  return true;
}
