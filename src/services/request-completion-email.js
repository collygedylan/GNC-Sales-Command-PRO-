export function getRequestDeliveryRows(eventRow) {
  const payload = eventRow && eventRow.payload && typeof eventRow.payload === 'object' ? eventRow.payload : {};
  const requestIds = normalizeRequestIdList_(
    payload.request_ids || payload.requestIds || (eventRow && eventRow.request_id ? [eventRow.request_id] : [])
  );
  if (String(eventRow && eventRow.event_type || '') === 'request_created') {
    const snapshots = Array.isArray(payload.requests) ? payload.requests.filter(Boolean) : [];
    if (snapshots.length) return snapshots;
    return fetchRequestRowsForEmailRequestIds_(requestIds);
  }
  if (String(eventRow && eventRow.event_type || '') === 'request_completed') {
    const receipt = requestDeliveryRest_('rpc/request_completion_dispatch_rows_v3065','POST','', {p_event_id:eventRow.event_id});
    if (receipt?.ready !== true || !Array.isArray(receipt.rows) || !receipt.rows.length) throw new Error('REQUEST_FOLDER_NOT_COMPLETE');
    return receipt.rows;
  }
  return [];
}

export function sanitizeRequestEmailRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const next = Object.assign({}, row || {});
    const clean = String(next.av_note || next.AV_NOTE || '').split(/\s*\/\s*/).filter(function(part) {
      return part && !/(^|[^a-z])(spec|caliper|cal)([^a-z]|$)/i.test(part)
        && !/^\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:["']|in(?:ches?)?)?\s*(?:h|w|t|height|width|tall)?(?:\s*x\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:["']|in(?:ches?)?)?\s*(?:h|w|t|height|width|tall)?)?\s*$/i.test(part);
    }).join(' / ').trim();
    next.av_note = clean;
    next.AV_NOTE = clean;
    return next;
  });
}

export function buildRequestDeliveryEmailPayload(eventRow, rows) {
  if (String(eventRow?.event_type || '') === 'request_completed') rows = getRequestDeliveryRows(eventRow);
  const firstRow = Array.isArray(rows) && rows.length ? rows[0] : {};
  const eventType = String(eventRow && eventRow.event_type || '').trim();
  const requestCreatedByUsername = String(firstRow.request_created_by_username || '');
  const requestCreatedByDisplay = String(firstRow.request_created_by_display || '');
  const requestCreatedByEmail = String(firstRow.request_created_by_email || '');
  const deliveryPayload = eventRow && eventRow.payload && typeof eventRow.payload === 'object' ? eventRow.payload : {};
  const safeRows = sanitizeRequestEmailRows(rows);
  const repName = String(firstRow.sales_rep || firstRow.request_selected_rep_display || firstRow.requested_by || '');
  const updatedCompletion = eventType === 'request_completed' && deliveryPayload.updatedCompletion === true;
  return {
    type: 'email',
    emailType: eventType === 'request_completed' ? 'request_complete' : 'new_request',
    folderId: String(eventRow && eventRow.request_folder || firstRow.request_folder || ''),
    requestFolder: String(eventRow && eventRow.request_folder || firstRow.request_folder || ''),
    repName: repName,
    requestedBy: repName,
    customer: String(firstRow.req_customer || ''),
    customerName: String(firstRow.customername || firstRow.customerName || ''),
    consigneeName: String(firstRow.consigneename || firstRow.consigneeName || ''),
    itemsCount: safeRows.length,
    requestItems: safeRows,
    items: safeRows,
    requestIds: safeRows.map(function(row) { return row.unique_id; }).filter(Boolean),
    requestCreatedByUsername: requestCreatedByUsername,
    requestCreatedByDisplay: requestCreatedByDisplay,
    requestCreatedByEmail: requestCreatedByEmail,
    submittedByUsername: requestCreatedByUsername,
    submittedByDisplay: requestCreatedByDisplay,
    submittedByEmail: requestCreatedByEmail,
    internalRecipients: dedupeEmailAddresses_([REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_, deliveryPayload.recipientEmails, deliveryPayload.recipient_emails].concat(safeRows.map(function(row) { return row.recipient_emails || row.recipientEmails || []; }))),
    updatedCompletion: updatedCompletion,
    subject: updatedCompletion ? 'Updated Completion - ' + String(eventRow && eventRow.request_folder || firstRow.request_folder || '') : '',
    requestCreator: {
      creatorUsername: requestCreatedByUsername,
      creatorDisplay: requestCreatedByDisplay,
      creatorEmail: requestCreatedByEmail,
      selectedRepUsername: String(firstRow.request_selected_rep_username || ''),
      selectedRepDisplay: String(firstRow.request_selected_rep_display || ''),
      selectedRepEmail: String(firstRow.request_selected_rep_email || '')
    }
  };
}

