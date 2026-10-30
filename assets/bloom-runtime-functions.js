function isBloomEmailPurposeReasonRequired(purpose = bloomEmailPurposeAction) {
            return purpose === 'hold' || purpose === 'stop_ship' || purpose === 'note';
        }

        function isBloomEmailPurposeRecipientRequired(purpose = bloomEmailPurposeAction) {
            return BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(purpose);
        }

        function shouldCollectBloomEmailPurposeRecipientsBeforeAction(purpose = bloomEmailPurposeAction) {
            return isBloomEmailPurposeRecipientRequired(purpose) && purpose !== 'take_off_hold';
        }

        function getBloomPurposeActionLabel(purpose = bloomEmailPurposeAction) {
            if (purpose === 'hold') return 'On Hold';
            if (purpose === 'take_off_hold') return 'Off Hold';
            if (purpose === 'stop_ship') return 'Stop Ship';
            if (purpose === 'off_stop_ship') return 'Off Stop Ship';
            if (purpose === 'shift') return 'Shift';
            if (purpose === 'ncr') return 'NCR';
            if (purpose === 'recount') return 'Re-Count';
            if (purpose === 'priority_change') return 'Priority Change';
            if (purpose === 'move_up') return 'Move Up';
            if (purpose === 'move_down') return 'Move Down';
            if (purpose === 'note') return 'Note';
            if (purpose === 'shear') return 'Shear List';
            return BLOOM_EMAIL_PURPOSE_LABELS[purpose] || BLOOM_EMAIL_PURPOSE_LABELS.general;
        }

        function getBloomPurposeReasonLabel(purpose = bloomEmailPurposeAction) {
            if (purpose === 'hold') return 'Hold Reason';
            if (purpose === 'take_off_hold') return 'Off Hold Note';
            if (purpose === 'stop_ship') return 'Stop Ship Reason';
            if (purpose === 'off_stop_ship') return 'Off Stop Ship Note';
            if (purpose === 'move_down') return 'Move Down Note';
            if (purpose === 'recount') return 'Re-Count Note';
            if (purpose === 'priority_change') return 'Priority Change Note';
            if (purpose === 'note') return 'Note';
            if (purpose === 'shear') return 'Shear Instructions';
            return 'Note';
        }

        function getBloomPurposeReportTitle(purpose = bloomEmailPurposeAction) {
            if (purpose === 'hold') return 'GNC PH On Hold';
            if (purpose === 'take_off_hold') return 'GNC PH Off Hold';
            if (purpose === 'stop_ship') return 'GNC PH Stop Ship';
            if (purpose === 'off_stop_ship') return 'GNC PH Off Stop Ship';
            if (purpose === 'shift') return 'GNC PH Shift';
            if (purpose === 'ncr') return 'GNC PH NCR';
            if (purpose === 'recount') return 'GNC PH Re-Count';
            if (purpose === 'priority_change') return 'GNC PH Priority Change';
            if (purpose === 'move_up') return 'GNC PH Move Up';
            if (purpose === 'move_down') return 'GNC PH Move Down';
            if (purpose === 'note') return 'GNC PH Note';
            if (purpose === 'shear') return 'GNC PH Shear List';
            return `GNC ${BLOOM_EMAIL_PURPOSE_LABELS[purpose] || BLOOM_EMAIL_PURPOSE_LABELS.general}`;
        }

        function normalizeBloomPurposeRecipientEmail(value = '') {
            const email = String(value || '').trim().toLowerCase();
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
        }

        function formatBloomPurposeDisplayName(value = '') {
            const raw = String(value || '').replace(/@.*$/, '').replace(/[._-]+/g, ' ').trim();
            if (!raw) return 'User';
            return raw.replace(/\b[a-z]/gi, (match) => match.toUpperCase());
        }

        function getBloomPurposeRecipientOptions() {
            requestAdminRecipientUsersForSelector();
            const byEmail = new Map();
            const addRecipient = (entry = {}) => {
                const username = normalizePushUsername(firstNonEmptyValue(entry.username, entry.userName, entry.display, ''));
                const email = normalizeBloomPurposeRecipientEmail(firstNonEmptyValue(entry.email, entry.address, getGreenleafEmailForUsername(username), ''));
                if (!email) return;
                const display = String(firstNonEmptyValue(entry.display, entry.name, formatBloomPurposeDisplayName(username || email), '') || '').trim() || formatBloomPurposeDisplayName(email);
                const role = String(firstNonEmptyValue(entry.role, entry.ROLE, '') || '').trim();
                byEmail.set(email, { email, username, display, role });
            };
            BLOOM_EMAIL_PURPOSE_FALLBACK_RECIPIENTS.forEach(addRecipient);
            BLOOM_CROP_UPDATE_INTERNAL_RECIPIENTS.forEach((email) => addRecipient({ email, display: formatBloomPurposeDisplayName(email) }));
            try {
                getAssignableAppUserOptions([...PRIVILEGED_MANAGER_USER_KEYS, 'kayla_knepp', 'nelly_aguilar', 'abbey_burka']).forEach(addRecipient);
            } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomPurposeRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(appEmailRecipientUsers) ? appEmailRecipientUsers : []).forEach(addRecipient); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomPurposeRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
            BLOOM_CROP_UPDATE_REP_GROUPS.forEach((group) => {
                (group && Array.isArray(group.reps) ? group.reps : []).forEach((rep) => addRecipient({ username: rep, display: rep, role: group.label || '' }));
            });
            return Array.from(byEmail.values()).sort((a, b) => a.display.localeCompare(b.display));
        }

        function getBloomEmailPurposeRecipientFilter(options = getBloomPurposeRecipientOptions()) {
            const query = normalizeRepMatchToken(bloomEmailPurposeRecipientSearch);
            if (!query) return options;
            return options.filter((option) => {
                const haystack = normalizeRepMatchToken(`${option.display} ${option.username} ${option.email} ${option.role}`);
                return haystack.includes(query);
            });
        }

        function getBloomEmailPurposeSelectedRecipientOptions() {
            const selected = new Set(Array.from(bloomEmailPurposeSelectedRecipients || []).map(normalizeBloomPurposeRecipientEmail).filter(Boolean));
            return getBloomPurposeRecipientOptions().filter((option) => selected.has(option.email));
        }

        function syncBloomEmailPurposeRecipientUi() {
            const wrap = document.getElementById('bloom-email-purpose-recipient-wrap');
            const list = document.getElementById('bloom-email-purpose-recipient-list');
            const count = document.getElementById('bloom-email-purpose-recipient-count');
            const search = document.getElementById('bloom-email-purpose-recipient-search');
            const required = shouldCollectBloomEmailPurposeRecipientsBeforeAction();
            if (wrap) wrap.classList.toggle('hidden', !required);
            if (!required) return;
            if (search && search.value !== bloomEmailPurposeRecipientSearch) search.value = bloomEmailPurposeRecipientSearch;
            const allOptions = getBloomPurposeRecipientOptions();
            const visibleOptions = getBloomEmailPurposeRecipientFilter(allOptions);
            const selectedOptions = getBloomEmailPurposeSelectedRecipientOptions();
            if (count) count.textContent = `${selectedOptions.length} selected`;
            if (!list) return;
            if (!visibleOptions.length) {
                list.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-400">No matching recipients.</div>';
                return;
            }
            list.innerHTML = visibleOptions.map((option) => {
                const selected = bloomEmailPurposeSelectedRecipients.has(option.email);
                return `<button type="button" aria-pressed="${selected ? 'true' : 'false'}" class="rounded-xl border px-3 py-3 text-left shadow-sm active:scale-[.99] ${selected ? 'border-[#007a4d] bg-white text-[#007a4d]' : 'border-slate-200 bg-white text-slate-700'}" onclick="return toggleBloomEmailPurposeRecipient('${encodeURIComponent(option.email)}')">
                    <div class="flex items-center justify-between gap-2">
                        <span class="min-w-0 truncate text-sm font-black">${esc(option.display)}</span>
                        <span class="rounded-full ${selected ? 'bg-emerald-100 text-[#007a4d]' : 'bg-slate-100 text-slate-500'} px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]">${selected ? 'Selected' : 'Tap'}</span>
                    </div>
                    <div class="mt-1 truncate text-[10px] font-bold text-slate-400">${esc(option.email)}</div>
                </button>`;
            }).join('');
        }

        function toggleBloomEmailPurposeRecipient(encodedEmail = '') {
            const email = normalizeBloomPurposeRecipientEmail(decodeURIComponent(String(encodedEmail || '')));
            if (!email) return false;
            if (bloomEmailPurposeSelectedRecipients.has(email)) bloomEmailPurposeSelectedRecipients.delete(email);
            else bloomEmailPurposeSelectedRecipients.add(email);
            syncBloomEmailPurposeRecipientUi();
            return false;
        }

        function setBloomEmailPurposeRecipientSearch(value = '') {
            bloomEmailPurposeRecipientSearch = String(value || '').trim();
            syncBloomEmailPurposeRecipientUi();
            return false;
        }

        function setBloomEmailPurposeAllRecipients(selected = true) {
            const options = getBloomEmailPurposeRecipientFilter();
            if (selected) {
                options.forEach((option) => bloomEmailPurposeSelectedRecipients.add(option.email));
            } else {
                options.forEach((option) => bloomEmailPurposeSelectedRecipients.delete(option.email));
            }
            syncBloomEmailPurposeRecipientUi();
            return false;
        }

        function getGroupedBloomNcrRowKey(item = null, fallbackIndex = 0) {
            return String(firstNonEmptyValue(
                getNcrSourceUniqueId(item),
                item && item.UNIQUE_ID,
                item && item.unique_id,
                item && item.DOM_ID,
                `row-${fallbackIndex}`
            ) || '').trim();
        }

        function getGroupedBloomNcrRowLabel(item = null, index = 0) {
            const commonName = String(firstNonEmptyValue(item && item.COMMONNAME, item && item.commonname, 'Unknown Item') || 'Unknown Item').trim();
            const contSize = String(firstNonEmptyValue(item && item.CONTSIZE, item && item.contsize, '') || '').trim();
            const itemCode = String(firstNonEmptyValue(item && item.ITEMCODE, item && item.itemcode, '') || '').trim();
            const locationCode = String(firstNonEmptyValue(item && item.LOCATIONCODE, item && item.locationcode, '') || '').trim();
            const lotCode = String(firstNonEmptyValue(item && item.LOTCODE, item && item.lotcode, '') || '').trim();
            return [
                `${index + 1}. ${commonName}${contSize ? ` (${contSize})` : ''}`,
                itemCode ? `Item ${itemCode}` : '',
                locationCode ? `Loc ${locationCode}` : '',
                lotCode ? `Lot ${lotCode}` : ''
            ].filter(Boolean).join(' | ');
        }

        function isGroupedBloomNcrRowSelectionEnabled() {
            return !!(groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.enableRowSelection);
        }

        function getGroupedBloomNcrSelectableRows() {
            const rows = Array.isArray(groupedBloomNcrRecipientItems) ? groupedBloomNcrRecipientItems : [];
            return rows.map((item, index) => ({
                item,
                index,
                key: getGroupedBloomNcrRowKey(item, index),
                label: getGroupedBloomNcrRowLabel(item, index)
            })).filter((entry) => entry.key);
        }

        function getGroupedBloomNcrSelectedRows() {
            const selectableRows = getGroupedBloomNcrSelectableRows();
            if (!isGroupedBloomNcrRowSelectionEnabled()) return selectableRows.map((entry) => entry.item);
            return selectableRows
                .filter((entry) => groupedBloomNcrSelectedRowKeys.has(entry.key))
                .map((entry) => entry.item);
        }

        function syncGroupedBloomNcrRowSelectionUi() {
            const wrap = document.getElementById('grouped-bloom-ncr-row-selection-wrap');
            const list = document.getElementById('grouped-bloom-ncr-row-selection-list');
            const count = document.getElementById('grouped-bloom-ncr-row-selection-count');
            const title = document.getElementById('grouped-bloom-ncr-row-selection-title');
            const enabled = isGroupedBloomNcrRowSelectionEnabled();
            if (wrap) wrap.classList.toggle('hidden', !enabled);
            if (!enabled) return;
            const selectableRows = getGroupedBloomNcrSelectableRows();
            const selectedCount = selectableRows.filter((entry) => groupedBloomNcrSelectedRowKeys.has(entry.key)).length;
            if (title) title.textContent = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.rowSelectionTitle, 'Rows To Send') || 'Rows To Send');
            if (count) count.textContent = `${selectedCount}/${selectableRows.length} selected`;
            if (!list) return;
            if (!selectableRows.length) {
                list.innerHTML = '<div class="rounded-xl border border-dashed border-amber-200 bg-white px-3 py-3 text-xs font-bold text-amber-700">No rows available to send.</div>';
                return;
            }
            list.innerHTML = selectableRows.map((entry) => {
                const selected = groupedBloomNcrSelectedRowKeys.has(entry.key);
                const row = entry.item || {};
                const photoCount = extractSharePhotoUrls(getDriveCustomerOutreachPhotoCsv(row), row).length;
                const meta = [
                    firstNonEmptyValue(row.LOCATIONCODE, row.locationcode, '') ? `Loc ${firstNonEmptyValue(row.LOCATIONCODE, row.locationcode, '')}` : '',
                    firstNonEmptyValue(row.LOTCODE, row.lotcode, '') ? `Lot ${firstNonEmptyValue(row.LOTCODE, row.lotcode, '')}` : '',
                    photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'No photo'
                ].filter(Boolean).join(' | ');
                return `<button type="button" aria-pressed="${selected ? 'true' : 'false'}" class="rounded-xl border px-3 py-3 text-left shadow-sm active:scale-[.99] ${selected ? 'border-amber-300 bg-white text-slate-900' : 'border-amber-100 bg-white/70 text-slate-600'}" onclick="return toggleGroupedBloomNcrRowSelection('${encodeURIComponent(entry.key)}')">
                    <div class="flex items-start justify-between gap-2">
                        <span class="min-w-0 text-sm font-black leading-5">${esc(entry.label)}</span>
                        <span class="shrink-0 rounded-full ${selected ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'} px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]">${selected ? 'Send' : 'Skip'}</span>
                    </div>
                    ${meta ? `<div class="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">${esc(meta)}</div>` : ''}
                </button>`;
            }).join('');
        }

        function toggleGroupedBloomNcrRowSelection(encodedKey = '') {
            const key = decodeURIComponent(String(encodedKey || '')).trim();
            if (!key) return false;
            if (groupedBloomNcrSelectedRowKeys.has(key)) groupedBloomNcrSelectedRowKeys.delete(key);
            else groupedBloomNcrSelectedRowKeys.add(key);
            syncGroupedBloomNcrRecipientUi();
            return false;
        }

        function setGroupedBloomNcrAllRowsSelected(selected = true) {
            const rows = getGroupedBloomNcrSelectableRows();
            if (selected) rows.forEach((entry) => groupedBloomNcrSelectedRowKeys.add(entry.key));
            else groupedBloomNcrSelectedRowKeys = new Set();
            syncGroupedBloomNcrRecipientUi();
            return false;
        }

        function getGroupedBloomNcrRowOption(rowOptionsByUid = null, item = null, index = 0) {
            const key = getGroupedBloomNcrRowKey(item, index);
            if (rowOptionsByUid && typeof rowOptionsByUid.get === 'function') return rowOptionsByUid.get(key) || null;
            if (rowOptionsByUid && typeof rowOptionsByUid === 'object') return rowOptionsByUid[key] || null;
            return getApprovalRowOptionsMetaFromItem(item);
        }

        function applyGroupedBloomNcrRowOptionsToItem(item = null, rowOptions = null) {
            if (!item || !rowOptions) return item;
            const normalizedOptions = normalizeApprovalRowOptionsMeta(rowOptions) || rowOptions;
            const approvalType = normalizeNcrApprovalType(firstNonEmptyValue(normalizedOptions.approvalType, normalizedOptions.type, normalizedOptions.screenValues && normalizedOptions.screenValues.actionType, 'new-crop'));
            const recommendationMeta = normalizeApprovalRecommendationMeta(normalizedOptions.recommendationMeta || normalizedOptions.approvalRecommendation || null, { type: approvalType });
            const screenValues = normalizedOptions.screenValues && typeof normalizedOptions.screenValues === 'object' ? normalizedOptions.screenValues : {};
            const ncrQty = firstNonEmptyValue(
                normalizedOptions.ncrQty,
                screenValues.releaseQty,
                screenValues.release_qty,
                recommendationMeta && recommendationMeta.suggestedQty,
                ''
            );
            item.GROUPED_BLOOM_NCR_ROW_OPTIONS = normalizedOptions;
            item.groupedBloomNcrRowOptions = normalizedOptions;
            item.NCR_REQUESTED_QTY = ncrQty;
            item.ncr_requested_qty = ncrQty;
            if (approvalType === 'new-crop') {
                item.BLOOM_ACTION_RELEASE_QTY = ncrQty;
                item.bloom_action_release_qty = ncrQty;
            }
            if (approvalType === 'move-up') {
                const moveUpQty = firstNonEmptyValue(normalizedOptions.moveUpQty, ncrQty, '');
                item.BLOOM_ACTION_MOVE_UP_QTY = moveUpQty;
                item.bloom_action_move_up_qty = moveUpQty;
            }
            item.NCR_REMOVE_HOLDSTOP = normalizedOptions.removeHoldStop ? 'YES' : 'NO';
            item.ncr_remove_holdstop = normalizedOptions.removeHoldStop ? 'YES' : 'NO';
            item.NCR_PRIORITY_ONE = normalizedOptions.priorityOne ? 'YES' : 'NO';
            item.ncr_priority_one = normalizedOptions.priorityOne ? 'YES' : 'NO';
            if (ncrQty !== '' && ncrQty !== null && typeof ncrQty !== 'undefined') {
                item.LOC_MATCH_QTY = ncrQty;
                item.loc_match_qty = ncrQty;
            }
            if (recommendationMeta) {
                item.APPROVAL_RECOMMENDATION = recommendationMeta;
                item.approvalRecommendation = recommendationMeta;
            }
            applyNcrApprovalMessageToItem(item, mergeApprovalMessageWithRowOptions(getRawNcrApprovalMessageFromItem(item), normalizedOptions));
            if (normalizedOptions.priorityOne) {
                item.PRIORITY = '1';
                item.priority = '1';
            }
            if (normalizedOptions.removeHoldStop) {
                item.HOLDSTOPCODE = '';
                item.holdstopcode = '';
                item.HOLSTOPCODE = '';
                item.holstopcode = '';
                item.HOLDSTOPREASON = '';
                item.holdstopreason = '';
            }
            return item;
        }

        async function collectGroupedBloomNcrRowOptions(rows = [], approvalMessage = '') {
            const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
            const optionsByUid = new Map();
            for (let index = 0; index < safeRows.length; index += 1) {
                const item = safeRows[index];
                const label = getGroupedBloomNcrRowLabel(item, index);
                const recommendationMeta = await promptApprovalRecommendationQuantity(item, 'new-crop', { approvalMessage });
                if (!recommendationMeta) return null;
                const holdCode = getHoldStopSnapshotFromItem(item);
                let removeHoldStop = false;
                if (hasBlockingHoldStopCodeForAv(holdCode)) {
                    removeHoldStop = await showAppConfirm(`This NCR row is on hold/stop ship (${holdCode}).\n\nRemove the holdstopcode for this row?\n\n${label}`, {
                        title: 'Remove Hold/Stop?',
                        confirmLabel: 'Remove',
                        cancelLabel: 'Keep'
                    });
                }
                const priorityOne = await showAppConfirm(`Make this NCR row priority 1?\n\n${label}`, {
                    title: 'Priority 1?',
                    confirmLabel: 'Yes',
                    cancelLabel: 'No'
                });
                const rowOptions = {
                    recommendationMeta,
                    ncrQty: recommendationMeta.suggestedQty,
                    removeHoldStop,
                    holdStopCode: holdCode,
                    priorityOne
                };
                applyGroupedBloomNcrRowOptionsToItem(item, rowOptions);
                optionsByUid.set(getGroupedBloomNcrRowKey(item, index), rowOptions);
            }
            return optionsByUid;
        }

        function getGroupedBloomNcrRecipientOptions() {
            const byEmail = new Map();
            const appUsersOnly = !!(groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.appUsersOnly);
            const allowedUsernames = new Set((Array.isArray(groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.allowedUsernames) ? groupedBloomNcrRecipientModalOptions.allowedUsernames : []).map(normalizePushUsername).filter(Boolean));
            const addRecipient = (entry = {}) => {
                const username = normalizePushUsername(firstNonEmptyValue(entry.username, entry.userName, entry.display, ''));
                const email = normalizeBloomPurposeRecipientEmail(firstNonEmptyValue(entry.email, entry.address, resolveRequestRecipientEmail(username), getGreenleafEmailForUsername(username), ''));
                if (!email) return;
                const display = String(firstNonEmptyValue(entry.display, entry.name, formatBloomPurposeDisplayName(username || email), '') || '').trim() || formatBloomPurposeDisplayName(email);
                const role = String(firstNonEmptyValue(entry.role, entry.ROLE, '') || '').trim();
                byEmail.set(email, { email, username, display, role });
            };
            if (appUsersOnly) {
                try { (allowedUsernames.size ? getEvalWorkAssignableUserOptions(Array.from(allowedUsernames)) : getAssignableAppUserOptions()).forEach(addRecipient); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getGroupedBloomNcrRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
            } else {
                try { getBloomPurposeRecipientOptions().forEach(addRecipient); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getGroupedBloomNcrRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
                try { getAssignableAppUserOptions([...PRIVILEGED_MANAGER_USER_KEYS]).forEach(addRecipient); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getGroupedBloomNcrRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
                try { (Array.isArray(appAdminRecipientUsers) ? appAdminRecipientUsers : []).forEach(addRecipient); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getGroupedBloomNcrRecipientOptions", 'HANDLED_OPERATION_FAILURE'); }
                BLOOM_GROUPED_NCR_ALLOWED_USER_KEYS.forEach((username) => addRecipient({ username, display: formatBloomPurposeDisplayName(username), role: 'NCR' }));
                Array.from(groupedBloomNcrSelectedRecipients || []).forEach((email) => {
                    const safeEmail = normalizeBloomPurposeRecipientEmail(email);
                    if (safeEmail && !byEmail.has(safeEmail)) addRecipient({ email: safeEmail, display: formatBloomPurposeDisplayName(safeEmail), role: 'Selected' });
                });
            }
            return Array.from(byEmail.values()).filter((entry) => !allowedUsernames.size || allowedUsernames.has(normalizePushUsername(entry.username))).sort((a, b) => a.display.localeCompare(b.display));
        }

        function getGroupedBloomNcrRecipientFilter(options = getGroupedBloomNcrRecipientOptions()) {
            const query = normalizeRepMatchToken(groupedBloomNcrRecipientSearch);
            if (!query) return options;
            return options.filter((option) => {
                const haystack = normalizeRepMatchToken(`${option.display} ${option.username} ${option.email} ${option.role}`);
                return haystack.includes(query);
            });
        }

        function getGroupedBloomNcrSelectedRecipientOptions() {
            const selected = new Set(Array.from(groupedBloomNcrSelectedRecipients || []).map(normalizeBloomPurposeRecipientEmail).filter(Boolean));
            return getGroupedBloomNcrRecipientOptions().filter((option) => selected.has(option.email));
        }

        function getGroupedBloomNcrRequiredRecipientEmails() {
            const options = groupedBloomNcrRecipientModalOptions && typeof groupedBloomNcrRecipientModalOptions === 'object'
                ? groupedBloomNcrRecipientModalOptions
                : {};
            return dedupeRequestEmailRecipients([
                ...(Array.isArray(options.requiredEmails) ? options.requiredEmails : []),
                ...(Array.isArray(options.requiredRecipientEmails) ? options.requiredRecipientEmails : [])
            ]);
        }

        function isGroupedBloomNcrRequiredRecipientEmail(email = '') {
            const safeEmail = normalizeBloomPurposeRecipientEmail(email);
            if (!safeEmail) return false;
            return getGroupedBloomNcrRequiredRecipientEmails().map(normalizeBloomPurposeRecipientEmail).includes(safeEmail);
        }

        function syncGroupedBloomNcrRecipientUi() {
            const list = document.getElementById('grouped-bloom-ncr-recipient-list');
            const count = document.getElementById('grouped-bloom-ncr-recipient-count');
            const search = document.getElementById('grouped-bloom-ncr-recipient-search');
            const preview = document.getElementById('grouped-bloom-ncr-recipient-preview');
            const brand = document.getElementById('grouped-bloom-ncr-recipient-brand');
            const title = document.getElementById('grouped-bloom-ncr-recipient-title');
            const bulkActions = document.getElementById('grouped-bloom-ncr-recipient-bulk-actions');
            const rowSelectionEnabled = isGroupedBloomNcrRowSelectionEnabled();
            const singleSelect = !!(groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.singleSelect);
            if (search && search.value !== groupedBloomNcrRecipientSearch) search.value = groupedBloomNcrRecipientSearch;
            if (search) search.placeholder = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.searchPlaceholder, 'Type a name or email address...') || 'Type a name or email address...');
            if (brand) brand.textContent = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.brandLabel, 'GNC PH NCR') || 'GNC PH NCR');
            if (title) title.textContent = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.title, 'Select Email Recipients') || 'Select Email Recipients');
            if (bulkActions) bulkActions.classList.toggle('hidden', singleSelect);
            const allOptions = getGroupedBloomNcrRecipientOptions();
            const visibleOptions = getGroupedBloomNcrRecipientFilter(allOptions);
            const selectedOptions = getGroupedBloomNcrSelectedRecipientOptions();
            if (count) count.textContent = singleSelect ? (selectedOptions.length ? '1 evaluator selected' : 'Choose one evaluator') : `${selectedOptions.length} selected`;
            if (preview) {
                const rows = rowSelectionEnabled ? getGroupedBloomNcrSelectedRows() : (Array.isArray(groupedBloomNcrRecipientItems) ? groupedBloomNcrRecipientItems : []);
                const firstRows = rows.slice(0, 4).map((item, index) => getGroupedBloomNcrRowLabel(item, index));
                const previewLabel = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.previewLabel, 'Email includes') || 'Email includes');
                preview.innerHTML = `<div class="text-[10px] font-black uppercase tracking-[0.14em] text-[#007a4d]">${esc(previewLabel)}</div><div class="mt-1">${esc(rows.length)} selected row${rows.length === 1 ? '' : 's'}<br>${firstRows.map(esc).join('<br>')}${rows.length > 4 ? `<br>${esc(`+ ${rows.length - 4} more rows`)}` : ''}</div>`;
            }
            syncGroupedBloomNcrRowSelectionUi();
            const sendBtn = document.getElementById('grouped-bloom-ncr-recipient-send-btn');
            if (sendBtn) {
                const hasSelectedRows = !rowSelectionEnabled || getGroupedBloomNcrSelectedRows().length > 0;
                const disabled = !selectedOptions.length || !hasSelectedRows;
                sendBtn.textContent = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.confirmLabel, 'Send Email') || 'Send Email');
                sendBtn.disabled = disabled;
                sendBtn.classList.toggle('opacity-60', disabled);
                sendBtn.classList.toggle('pointer-events-none', disabled);
            }
            if (!list) return;
            if (!visibleOptions.length) {
                list.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-400">No matching app users.</div>';
                return;
            }
            list.innerHTML = visibleOptions.map((option) => {
                const selected = groupedBloomNcrSelectedRecipients.has(option.email);
                const required = isGroupedBloomNcrRequiredRecipientEmail(option.email);
                return `<button type="button" aria-pressed="${selected ? 'true' : 'false'}" class="rounded-xl border px-3 py-3 text-left shadow-sm active:scale-[.99] ${selected ? 'border-[#007a4d] bg-white text-[#007a4d]' : 'border-slate-200 bg-white text-slate-700'} ${required ? 'cursor-default' : ''}" onclick="${required ? 'return false' : `return toggleGroupedBloomNcrRecipient('${encodeURIComponent(option.email)}')`}">
                    <div class="flex items-center justify-between gap-2">
                        <span class="min-w-0 truncate text-sm font-black">${esc(option.display)}</span>
                        <span class="rounded-full ${required ? 'bg-yellow-100 text-yellow-800' : (selected ? 'bg-emerald-100 text-[#007a4d]' : 'bg-slate-100 text-slate-500')} px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]">${required ? 'Required' : (selected ? 'Selected' : 'Tap')}</span>
                    </div>
                    <div class="mt-1 truncate text-[10px] font-bold text-slate-400">${esc(option.email)}</div>
                </button>`;
            }).join('');
        }

        function toggleGroupedBloomNcrRecipient(encodedEmail = '') {
            const email = normalizeBloomPurposeRecipientEmail(decodeURIComponent(String(encodedEmail || '')));
            if (!email) return false;
            if (isGroupedBloomNcrRequiredRecipientEmail(email)) {
                groupedBloomNcrSelectedRecipients.add(email);
                syncGroupedBloomNcrRecipientUi();
                return false;
            }
            if (groupedBloomNcrSelectedRecipients.has(email)) groupedBloomNcrSelectedRecipients.delete(email);
            else {
                if (groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.singleSelect) groupedBloomNcrSelectedRecipients = new Set();
                groupedBloomNcrSelectedRecipients.add(email);
            }
            syncGroupedBloomNcrRecipientUi();
            return false;
        }

        function setGroupedBloomNcrRecipientSearch(value = '') {
            groupedBloomNcrRecipientSearch = String(value || '').trim();
            syncGroupedBloomNcrRecipientUi();
            return false;
        }

        function setGroupedBloomNcrAllRecipients(selected = true) {
            const options = getGroupedBloomNcrRecipientFilter();
            if (selected) options.forEach((option) => groupedBloomNcrSelectedRecipients.add(option.email));
            else options.forEach((option) => {
                if (!isGroupedBloomNcrRequiredRecipientEmail(option.email)) groupedBloomNcrSelectedRecipients.delete(option.email);
            });
            getGroupedBloomNcrRequiredRecipientEmails().forEach((email) => groupedBloomNcrSelectedRecipients.add(normalizeBloomPurposeRecipientEmail(email)));
            syncGroupedBloomNcrRecipientUi();
            return false;
        }

        function closeGroupedBloomNcrRecipientModal(choice = 'cancel') {
            const action = String(choice || 'cancel').trim().toLowerCase();
            if (action === 'send' && !getGroupedBloomNcrSelectedRecipientOptions().length) {
                const noun = String(firstNonEmptyValue(groupedBloomNcrRecipientModalOptions.selectionNoun, 'recipient') || 'recipient');
                showToast(`Select ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`, `Select at least one app user before continuing.`, true);
                syncGroupedBloomNcrRecipientUi();
                return false;
            }
            if (action === 'send' && isGroupedBloomNcrRowSelectionEnabled() && !getGroupedBloomNcrSelectedRows().length) {
                showToast('Select Rows', 'Choose at least one row to include in the email.', true);
                syncGroupedBloomNcrRecipientUi();
                return false;
            }
            const modal = document.getElementById('grouped-bloom-ncr-recipient-modal');
            if (modal) modal.classList.add('hidden');
            const selectedEmails = action === 'send'
                ? dedupeRequestEmailRecipients([
                    ...getGroupedBloomNcrSelectedRecipientOptions().map((option) => option.email),
                    ...getGroupedBloomNcrRequiredRecipientEmails()
                ])
                : null;
            const selectedRows = action === 'send' ? getGroupedBloomNcrSelectedRows() : null;
            const returnSelection = !!(groupedBloomNcrRecipientModalOptions && groupedBloomNcrRecipientModalOptions.returnSelection);
            groupedBloomNcrRecipientSearch = '';
            groupedBloomNcrSelectedRecipients = new Set();
            groupedBloomNcrRecipientItems = [];
            groupedBloomNcrSelectedRowKeys = new Set();
            groupedBloomNcrRecipientModalOptions = {};
            const search = document.getElementById('grouped-bloom-ncr-recipient-search');
            if (search) search.value = '';
            const resolver = groupedBloomNcrRecipientResolver;
            groupedBloomNcrRecipientResolver = null;
            if (resolver) resolver(returnSelection && action === 'send'
                ? { recipientEmails: selectedEmails || [], rows: selectedRows || [] }
                : selectedEmails);
            return false;
        }

        async function openGroupedBloomNcrRecipientModal(items = [], defaultEmails = [], options = {}) {
            const rows = (Array.isArray(items) ? items : []).filter(Boolean);
            const modal = document.getElementById('grouped-bloom-ncr-recipient-modal');
            if (!modal) return dedupeRequestEmailRecipients(defaultEmails);
            groupedBloomNcrRecipientItems = rows.slice();
            groupedBloomNcrRecipientModalOptions = options && typeof options === 'object' ? { ...options } : {};
            groupedBloomNcrRecipientSearch = '';
            const requiredEmails = [
                ...(Array.isArray(groupedBloomNcrRecipientModalOptions.requiredEmails) ? groupedBloomNcrRecipientModalOptions.requiredEmails : []),
                ...(Array.isArray(groupedBloomNcrRecipientModalOptions.requiredRecipientEmails) ? groupedBloomNcrRecipientModalOptions.requiredRecipientEmails : [])
            ];
            groupedBloomNcrSelectedRecipients = new Set(dedupeRequestEmailRecipients([...(defaultEmails || []), ...requiredEmails]).map(normalizeBloomPurposeRecipientEmail).filter(Boolean));
            groupedBloomNcrSelectedRowKeys = new Set(getGroupedBloomNcrSelectableRows().map((entry) => entry.key));
            const search = document.getElementById('grouped-bloom-ncr-recipient-search');
            if (search) search.value = '';
            if (groupedBloomNcrRecipientResolver) {
                const previousResolver = groupedBloomNcrRecipientResolver;
                groupedBloomNcrRecipientResolver = null;
                previousResolver(null);
            }
            modal.classList.remove('hidden');
            syncGroupedBloomNcrRecipientUi();
            Promise.all([
                typeof ensureAssignableAppUsers === 'function' ? ensureAssignableAppUsers(false).catch(() => []) : Promise.resolve([]),
                typeof ensureAdminRecipientUsers === 'function' ? ensureAdminRecipientUsers(false).catch(() => []) : Promise.resolve([])
            ]).then(() => syncGroupedBloomNcrRecipientUi()).catch(() => syncGroupedBloomNcrRecipientUi());
            return new Promise((resolve) => {
                groupedBloomNcrRecipientResolver = resolve;
                if (search) setTimeout(() => {
                    try { search.focus({ preventScroll: true }); } catch (err) { search.focus(); }
                }, 30);
            });
        }

        function getBloomPurposeRowValue(item = null, fields = [], fallback = '') {
            const values = (Array.isArray(fields) ? fields : []).map((field) => item && item[field]);
            return String(firstNonEmptyValue(...values, fallback) || fallback || '').trim();
        }

        function getBloomPurposeReportQty(item = null) {
            if (typeof getDockOrderedQtyDisplay === 'function' && isDockLikeItem(item)) {
                const dockQty = getDockOrderedQtyDisplay(item) || formatDockDisplayQty(getDockDisplayQty(item));
                if (dockQty) return dockQty;
            }
            const directQty = getBloomPurposeRowValue(item, [
                'LOC_MATCH_QTY', 'loc_match_qty',
                'NCR_REQUESTED_QTY', 'ncr_requested_qty',
                'REQ_QTY', 'req_qty',
                'REQUEST_QTY', 'request_qty',
                'PTRAVAILABLE', 'ptravailable',
                'ORDERED_QTY', 'ordered_qty',
                'ORDEREDQUANTITY', 'orderedquantity',
                'QTYORDERED', 'qtyordered',
                'QTY_ORDERED', 'qty_ordered',
                'QUANTITY', 'quantity',
                'QTY', 'qty'
            ], '');
            if (directQty) return directQty;
            const ptr = Number(getBloomPurposeRowValue(item, ['PTRAVAILABLE', 'ptravailable'], ''));
            return Number.isFinite(ptr) && ptr >= 0 ? String(ptr) : '-';
        }

        function getBloomPurposeShearSnapshot(item = null) {
            return item && item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {};
        }

        function formatBloomPurposeShearPercent(value = '') {
            const safeValue = String(value == null ? '' : value).trim();
            if (!safeValue) return '-';
            return safeValue.endsWith('%') ? safeValue : `${safeValue}%`;
        }

        function getBloomPurposeReportRow(item = null) {
            const qty = getBloomPurposeReportQty(item);
            const shearSnapshot = getBloomPurposeShearSnapshot(item);
            const percentToShear = getBloomPurposeRowValue(item, [
                'PERCENT_TO_SHEAR', 'percent_to_shear',
                'SHEAR_PERCENT', 'shear_percent'
            ], getBloomPurposeRowValue(shearSnapshot, ['percent_to_shear', 'PERCENT_TO_SHEAR', 'shear_percent', 'SHEAR_PERCENT'], ''));
            const shearType = getBloomPurposeRowValue(item, [
                'SHEAR_TYPE', 'shear_type',
                'SHEARTYPE', 'shearType'
            ], getBloomPurposeRowValue(shearSnapshot, ['shear_type', 'SHEAR_TYPE', 'shearType', 'SHEARTYPE'], ''));
            return {
                itemCode: getBloomPurposeRowValue(item, ['ITEMCODE', 'itemcode', 'REQ_ITEMCODE', 'req_itemcode', 'ITEM_CODE'], '-'),
                commonName: getBloomPurposeRowValue(item, ['COMMONNAME', 'commonname', 'REQ_COMMONNAME', 'req_commonname', 'NAME'], 'Unknown'),
                contSize: getBloomPurposeRowValue(item, ['CONTSIZE', 'contsize', 'REQ_CONTSIZE', 'req_contsize', 'SIZE'], '-'),
                locationCode: getBloomPurposeRowValue(item, ['LOCATIONCODE', 'locationcode', 'REQ_LOCATIONCODE', 'req_locationcode', 'LOCATION_CODE', 'LOCATION'], '-'),
                lotCode: getBloomPurposeRowValue(item, ['LOTCODE', 'lotcode', 'REQ_LOTCODE', 'req_lotcode', 'LOT', 'lot'], '-'),
                customer: getBloomPurposeRowValue(item, ['CUSTOMERNAME', 'customername', 'CUSTOMER', 'REQ_CUSTOMER', 'req_customer'], '-'),
                consignee: getBloomPurposeRowValue(item, ['CONSIGNEENAME', 'consigneename', 'CONSIGNEE'], ''),
                salesRep: getBloomPurposeRowValue(item, ['SALESREPNAME', 'salesrepname', 'SALESREP', 'REQUESTED_BY', 'requested_by'], ''),
                dock: getBloomPurposeRowValue(item, ['DOCK_NUM', 'DOCK', 'dock_num', 'dock'], ''),
                drop: getBloomPurposeRowValue(item, ['STOPNUMBER', 'STOP', 'drop_number', 'DROP', 'drop'], ''),
                percentToShear: formatBloomPurposeShearPercent(percentToShear),
                shearType: shearType ? normalizeShearListType(shearType) : SHEAR_LIST_DEFAULT_TYPE,
                qty: qty || '-'
            };
        }

        function getBloomPurposeReportColumns(purpose = '') {
            if (String(purpose || '').trim().toLowerCase() === 'shear') {
                return [
                    { label: 'ITEMCODE', value: (row) => row.itemCode },
                    { label: 'COMMONNAME', value: (row) => row.commonName },
                    { label: 'CONTSIZE', value: (row) => row.contSize },
                    { label: 'LOTCODE', value: (row) => row.lotCode },
                    { label: '% TO SHEAR', value: (row) => row.percentToShear },
                    { label: 'SHEAR TYPE', value: (row) => row.shearType },
                    { label: 'PTRAVAILABLE', value: (row) => row.qty }
                ];
            }
            return [
                { label: 'ITEMCODE', value: (row) => row.itemCode },
                { label: 'COMMONNAME', value: (row) => row.commonName },
                { label: 'CONTSIZE', value: (row) => row.contSize },
                { label: 'LOCATIONCODE', value: (row) => row.locationCode },
                { label: 'LOTCODE', value: (row) => row.lotCode },
                { label: 'QTY', value: (row) => row.qty }
            ];
        }

        function buildBloomPurposeReportTable(rows = [], purpose = '') {
            const columns = getBloomPurposeReportColumns(purpose);
            const header = columns.map((column) => column.label).join('\t');
            const body = (rows || []).map((item) => {
                const row = getBloomPurposeReportRow(item);
                return columns.map((column) => column.value(row) || '-').join('\t');
            });
            return [header, ...body].join('\n');
        }

        function closeBloomEmailPurposeModal() {
            const modal = document.getElementById('bloom-email-purpose-modal');
            if (modal) modal.classList.add('hidden');
            bloomEmailPurposeItems = [];
            bloomEmailPurposeSelectionKind = '';
            bloomEmailPurposeAction = 'general';
            bloomEmailPurposeRecipientSearch = '';
            bloomEmailPurposeSelectedRecipients = new Set();
            bloomEmailPurposeSending = false;
            const recipientSearch = document.getElementById('bloom-email-purpose-recipient-search');
            if (recipientSearch) recipientSearch.value = '';
            return false;
        }

        function getBloomEmailPurposeRowsForShare() {
            return Array.isArray(bloomEmailPurposeItems) ? bloomEmailPurposeItems.filter(Boolean) : [];
        }

        function getBloomEmailPurposeCoreLine(item = null, index = 0) {
            const commonName = String(firstNonEmptyValue(item && item.COMMONNAME, item && item.commonname, item && item.REQ_COMMONNAME, item && item.req_commonname, item && item.NAME, 'Unknown') || 'Unknown').trim();
            const contSize = String(firstNonEmptyValue(item && item.CONTSIZE, item && item.contsize, item && item.REQ_CONTSIZE, item && item.req_contsize, item && item.SIZE, '') || '').trim();
            const itemCode = String(firstNonEmptyValue(item && item.ITEMCODE, item && item.itemcode, item && item.REQ_ITEMCODE, item && item.req_itemcode, item && item.ITEM_CODE, '') || '').trim();
            const locationCode = String(firstNonEmptyValue(item && item.LOCATIONCODE, item && item.locationcode, item && item.REQ_LOCATIONCODE, item && item.req_locationcode, item && item.LOCATION_CODE, item && item.LOCATION, '') || '').trim();
            const parts = [
                `${index + 1}. ${commonName}${contSize ? ` (${contSize})` : ''}`,
                itemCode ? `Item Code: ${itemCode}` : '',
                locationCode ? `Location Code: ${locationCode}` : ''
            ].filter(Boolean);
            return parts.join('\n');
        }

        function formatBloomPurposeDocksText(items = []) {
            let returnText = 'DOCK NOTES\n\n';
            (items || []).forEach((item, itemIndex) => {
                returnText += `${getBloomEmailPurposeCoreLine(item, itemIndex)}\n`;
                const dockLabel = String(firstNonEmptyValue(item && item.DOCK_NUM, item && item.DOCK, item && item.dock_num, '') || '').trim();
                const dropLabel = String(firstNonEmptyValue(item && item.STOPNUMBER, item && item.STOP, item && item.drop_number, '') || '').trim();
                const customer = String(firstNonEmptyValue(item && item.CUSTOMERNAME, item && item.customername, item && item.CUSTOMER, '') || '').trim();
                const qty = getDockOrderedQtyDisplay(item) || formatDockDisplayQty(getDockDisplayQty(item));
                if (dockLabel) returnText += `Dock: ${dockLabel}\n`;
                if (dropLabel) returnText += `Drop: ${dropLabel}\n`;
                if (customer) returnText += `Customer: ${customer}\n`;
                if (qty) returnText += `Qty: ${qty}\n`;
                if (item && item.DOCK_SPEC) returnText += `Spec: ${item.DOCK_SPEC}\n`;
                if (item && item.DOCK_CALIPER) returnText += `Caliper: ${item.DOCK_CALIPER}\n`;
                if (item && item.DOCK_NOTE) returnText += `Dock Note: ${item.DOCK_NOTE}\n`;
                if (typeof getDockOwnedPhotoLinkCsv === 'function') {
                    extractSharePhotoUrls(getDockOwnedPhotoLinkCsv(item, { includePending: false }))
                        .forEach(photo => { returnText += `${photo.label}: ${photo.url}\n`; });
                }
                if (itemIndex < (items || []).length - 1) returnText += '\n';
            });
            return returnText.trimEnd();
        }

        function formatBloomPurposeItemsText(items = [], selectionKind = '', options = {}) {
            const safeOptions = options && typeof options === 'object' ? options : {};
            const headerLabel = Object.prototype.hasOwnProperty.call(safeOptions, 'headerLabel')
                ? String(safeOptions.headerLabel || '')
                : 'CARD DETAILS';
            const shareOptions = { includePhotoUrls: true, ...safeOptions };
            if (selectionKind === 'request') return formatRequestItemsText(items, headerLabel, shareOptions);
            if (selectionKind === 'docks') return formatBloomPurposeDocksText(items);
            return formatInventoryItemsText(items, headerLabel, shareOptions);
        }

        function buildBloomPurposeEmailSubject(purpose = 'general', items = []) {
            if (BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(purpose)) {
                const rows = Array.isArray(items) ? items.filter(Boolean) : [];
                const first = getBloomPurposeReportRow(rows[0] || {});
                const customer = first.customer && first.customer !== '-' ? first.customer : '';
                const dateLabel = formatRequestEmailSubjectDate(new Date());
                const title = getBloomPurposeReportTitle(purpose);
                return `${title}${customer ? ` ${customer}` : ''}${dateLabel ? ` ${dateLabel}` : ''}`.trim();
            }
            const label = BLOOM_EMAIL_PURPOSE_LABELS[purpose] || BLOOM_EMAIL_PURPOSE_LABELS.general;
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            const firstName = String(firstNonEmptyValue(rows[0] && rows[0].COMMONNAME, rows[0] && rows[0].commonname, rows[0] && rows[0].REQ_COMMONNAME, 'Selected Rows') || 'Selected Rows').trim();
            return rows.length === 1 ? `GNC ${label}: ${firstName}` : `GNC ${label}: ${rows.length} rows`;
        }

        function buildBloomPurposeEmailText(items = [], selectionKind = '', purpose = 'general', reason = '', recipientEmails = []) {
            if (BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(purpose)) {
                const rows = Array.isArray(items) ? items.filter(Boolean) : [];
                const title = getBloomPurposeReportTitle(purpose);
                const actionLabel = getBloomPurposeActionLabel(purpose);
                const reasonLabel = getBloomPurposeReasonLabel(purpose);
                const submittedBy = String(firstNonEmptyValue(currentUserDisplay, currentUser, 'Unknown') || 'Unknown').trim();
                const nowLabel = new Date().toLocaleString('en-US');
                const first = getBloomPurposeReportRow(rows[0] || {});
                const customerLine = first.customer && first.customer !== '-' ? first.customer : 'N/A';
                const lines = [
                    title,
                    `${actionLabel} Request Submitted`,
                    '',
                    `Submitted By: ${submittedBy}`,
                    `Submitted: ${nowLabel}`,
                    `Customer: ${customerLine}`,
                    `Items Requested: ${rows.length}`,
                    reason ? `${reasonLabel}: ${reason}` : '',
                    ''
                ];
                const recipients = dedupeRequestEmailRecipients(recipientEmails);
                if (recipients.length) lines.push(`Recipients: ${recipients.join(', ')}`, '');
                lines.push('Selected Rows');
                lines.push(buildBloomPurposeReportTable(rows, purpose));
                if (String(purpose || '').trim().toLowerCase() !== 'shear') {
                    lines.push('', 'Card Details');
                    lines.push(formatBloomPurposeItemsText(rows, selectionKind));
                }
                return lines.filter((line, index, arr) => line !== '' || arr[index - 1] !== '').join('\n').trim();
            }
            const label = BLOOM_EMAIL_PURPOSE_LABELS[purpose] || BLOOM_EMAIL_PURPOSE_LABELS.general;
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (String(purpose || '').trim().toLowerCase() === 'general') {
                return formatBloomPurposeItemsText(rows, selectionKind, {
                    headerLabel: '',
                    includeHeader: false,
                    includePhotoUrls: true,
                    omitFieldLabels: ['Pick Note']
                }).trim();
            }
            const lines = [
                `GNC ${label}`,
                `Rows: ${rows.length}`,
                ''
            ];
            if (reason && BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(purpose)) lines.push(`${getBloomPurposeReasonLabel(purpose)}: ${reason}`, '');
            if (BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(purpose)) {
                lines.push('Required Row Info:');
                rows.forEach((item, index) => lines.push(getBloomEmailPurposeCoreLine(item, index)));
                lines.push('');
            }
            lines.push(formatBloomPurposeItemsText(rows, selectionKind));
            return lines.filter((line, index, arr) => line !== '' || arr[index - 1] !== '').join('\n').trim();
        }

        function buildBloomPurposePayloadItems(items = []) {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            return rows.map((item) => {
                const row = getBloomPurposeReportRow(item);
                return {
                    ...(item || {}),
                    ITEMCODE: row.itemCode,
                    itemcode: row.itemCode,
                    COMMONNAME: row.commonName,
                    commonname: row.commonName,
                    CONTSIZE: row.contSize,
                    contsize: row.contSize,
                    LOCATIONCODE: row.locationCode,
                    locationcode: row.locationCode,
                    LOTCODE: row.lotCode,
                    lotcode: row.lotCode,
                    CUSTOMERNAME: row.customer,
                    customername: row.customer,
                    CUSTOMER: row.customer,
                    REQ_CUSTOMER: row.customer,
                    CONSIGNEENAME: row.consignee,
                    consigneename: row.consignee,
                    SALESREPNAME: row.salesRep,
                    salesrepname: row.salesRep,
                    DOCK_NUM: row.dock,
                    STOPNUMBER: row.drop,
                    REQUEST_QTY: row.qty,
                    request_qty: row.qty,
                    REQ_QTY: row.qty,
                    req_qty: row.qty,
                    QTY: row.qty,
                    qty: row.qty
                };
            });
        }

        function buildBloomPurposeReportTableHtml(items = [], purpose = '') {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!rows.length) return '';
            const columns = getBloomPurposeReportColumns(purpose);
            const headerHtml = columns.map((column) => `<th style="background:#f0fdf4;border:1px solid #bbf7d0;padding:8px;text-align:left;font-size:11px;letter-spacing:.04em;color:#007a4d;">${escapeShareHtml(column.label)}</th>`).join('');
            const bodyHtml = rows.map((item) => {
                const row = getBloomPurposeReportRow(item);
                return `<tr>${columns.map((column) => `<td style="border:1px solid #dcfce7;padding:8px;font-size:12px;vertical-align:top;">${escapeShareHtml(column.value(row) || '-')}</td>`).join('')}</tr>`;
            }).join('');
            return `<div style="overflow-x:auto;margin:0 0 16px 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;min-width:560px;"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
        }

        function buildBloomPurposeEmailHtml(items = [], selectionKind = '', purpose = '') {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (String(purpose || '').trim().toLowerCase() === 'shear') {
                return [
                    '<p style="font-weight:700; margin-bottom:12px;">Shear List Rows</p>',
                    buildBloomPurposeReportTableHtml(rows, purpose) || '<p style="font-size: 12px; color: #777;">No shear row details were provided.</p>'
                ].join('');
            }
            const payloadItems = buildBloomPurposePayloadItems(rows);
            let detailsHtml = '';
            if (selectionKind === 'request') {
                detailsHtml = formatRequestItemsHtml(payloadItems, 'Card Details');
            } else if (selectionKind === 'docks') {
                detailsHtml = formatRequestItemsHtml(payloadItems, 'Card Details') || formatInventoryItemsHtml(payloadItems, 'Card Details');
            } else {
                detailsHtml = formatInventoryItemsHtml(payloadItems, 'Card Details');
            }
            return [
                '<p style="font-weight:700; margin-bottom:12px;">Selected Rows</p>',
                buildBloomPurposeReportTableHtml(rows, purpose),
                '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
                detailsHtml || '<p style="font-size: 12px; color: #777;">No card details were provided.</p>'
            ].join('');
        }

        function getBloomEmailPurposeActionVisibility(rows = getBloomEmailPurposeRowsForShare()) {
            const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
            const selectionKind = getBloomDirectShareSelectionKind(safeRows);
            const actionVisibility = getBloomPickerActionVisibility(safeRows);
            return {
                showCropUpdate: selectionKind === 'inventory' && canUseBloomCropUpdateEmail(safeRows),
                showShift: selectionKind === 'inventory' && canUseBloomCropUpdateEmail(safeRows),
                showNcr: selectionKind === 'inventory' && !!actionVisibility.showNcr,
                showMoveUp: selectionKind === 'inventory' && !!actionVisibility.showMove,
                showMoveDown: selectionKind === 'inventory'
            };
        }

        function syncBloomEmailPurposeActionOptions(rows = getBloomEmailPurposeRowsForShare()) {
            const visibility = getBloomEmailPurposeActionVisibility(rows);
            const shiftOption = document.querySelector('[data-bloom-email-purpose-option="shift"]');
            const cropOption = document.querySelector('[data-bloom-email-purpose-option="crop_update"]');
            const ncrOption = document.querySelector('[data-bloom-email-purpose-option="ncr"]');
            const moveUpOption = document.querySelector('[data-bloom-email-purpose-option="move_up"]');
            const moveDownOption = document.querySelector('[data-bloom-email-purpose-option="move_down"]');
            if (shiftOption) shiftOption.classList.toggle('hidden', !visibility.showShift);
            if (cropOption) cropOption.classList.toggle('hidden', !visibility.showCropUpdate);
            if (ncrOption) ncrOption.classList.toggle('hidden', !visibility.showNcr);
            if (moveUpOption) moveUpOption.classList.toggle('hidden', !visibility.showMoveUp);
            if (moveDownOption) moveDownOption.classList.toggle('hidden', !visibility.showMoveDown);
            BLOOM_EMAIL_PURPOSE_RECLASS_ONLY_ACTIONS.forEach((action) => {
                const option = document.querySelector(`[data-bloom-email-purpose-option="${action}"]`);
                if (option) option.classList.add('hidden');
            });
            if (BLOOM_EMAIL_PURPOSE_RECLASS_ONLY_ACTIONS.has(bloomEmailPurposeAction)
                || (bloomEmailPurposeAction === 'shift' && !visibility.showShift)
                || (bloomEmailPurposeAction === 'crop_update' && !visibility.showCropUpdate)
                || (bloomEmailPurposeAction === 'ncr' && !visibility.showNcr)
                || (bloomEmailPurposeAction === 'move_up' && !visibility.showMoveUp)
                || (bloomEmailPurposeAction === 'move_down' && !visibility.showMoveDown)) {
                bloomEmailPurposeAction = 'general';
            }
        }

        function syncBloomEmailPurposeModalUi() {
            const rows = getBloomEmailPurposeRowsForShare();
            const countEl = document.getElementById('bloom-email-purpose-count');
            const titleEl = document.getElementById('bloom-email-purpose-title');
            const reasonWrap = document.getElementById('bloom-email-purpose-reason-wrap');
            const reasonLabel = document.getElementById('bloom-email-purpose-reason-label');
            const reasonInput = document.getElementById('bloom-email-purpose-reason');
            const sendBtn = document.getElementById('bloom-email-purpose-send-btn');
            const preview = document.getElementById('bloom-email-purpose-preview');
            syncBloomEmailPurposeActionOptions(rows);
            const label = BLOOM_EMAIL_PURPOSE_LABELS[bloomEmailPurposeAction] || BLOOM_EMAIL_PURPOSE_LABELS.general;
            const reportTitle = getBloomPurposeReportTitle(bloomEmailPurposeAction);
            if (titleEl) titleEl.textContent = (isBloomEmailPurposeRecipientRequired() || bloomEmailPurposeAction === 'ncr') ? reportTitle : label;
            if (countEl) countEl.textContent = `${rows.length} selected row${rows.length === 1 ? '' : 's'}`;
            if (reasonWrap) reasonWrap.classList.toggle('hidden', !isBloomEmailPurposeReasonRequired());
            if (reasonLabel) reasonLabel.textContent = `${getBloomPurposeReasonLabel(bloomEmailPurposeAction)} Required`;
            if (reasonInput) reasonInput.placeholder = bloomEmailPurposeAction === 'note'
                ? 'Enter the note to include with this report...'
                : `Enter the ${getBloomPurposeReasonLabel(bloomEmailPurposeAction).toLowerCase()} before sending...`;
            if (sendBtn) {
                sendBtn.disabled = bloomEmailPurposeSending;
                const actionLabel = (bloomEmailPurposeAction === 'crop_update' || bloomEmailPurposeAction === 'shift')
                    ? 'Continue'
                    : (BLOOM_ACTION_ROW_FORM_PURPOSES.has(bloomEmailPurposeAction) ? 'Continue' : (bloomEmailPurposeAction === 'move_up' ? 'Move Up' : 'Send Email'));
                sendBtn.textContent = bloomEmailPurposeSending ? 'Sending...' : actionLabel;
                sendBtn.classList.toggle('opacity-70', bloomEmailPurposeSending);
                sendBtn.classList.toggle('pointer-events-none', bloomEmailPurposeSending);
            }
            if (preview) {
                const firstRows = rows.slice(0, 4).map((item, index) => getBloomEmailPurposeCoreLine(item, index).replace(/\n/g, ' | '));
                const previewLabel = bloomEmailPurposeAction === 'ncr' || bloomEmailPurposeAction === 'move_up' || bloomEmailPurposeAction === 'shift' ? 'Action includes' : 'Email includes';
                preview.innerHTML = `<div class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">${previewLabel}</div><div class="mt-1">${esc(reportTitle)}<br>${firstRows.map(esc).join('<br>')}${rows.length > 4 ? `<br>${esc(`+ ${rows.length - 4} more rows`)}` : ''}</div>`;
            }
            syncBloomEmailPurposeRecipientUi();
            document.querySelectorAll('[data-bloom-email-purpose-option]').forEach((button) => {
                const active = button.getAttribute('data-bloom-email-purpose-option') === bloomEmailPurposeAction;
                button.classList.toggle('bg-emerald-50', active);
                button.classList.toggle('border-emerald-100', active);
                button.classList.toggle('text-[#007a4d]', active);
                button.classList.toggle('bg-white', !active);
                button.classList.toggle('border-slate-200', !active);
                button.classList.toggle('text-slate-700', !active);
            });
        }

        function selectBloomEmailPurpose(purpose = 'general') {
            const safePurpose = String(purpose || '').trim();
            if (BLOOM_EMAIL_PURPOSE_RECLASS_ONLY_ACTIONS.has(safePurpose)) {
                showToast('Use Reclass', 'Send this request from the Reclass transaction card.', true);
                bloomEmailPurposeAction = 'general';
            } else {
                bloomEmailPurposeAction = BLOOM_EMAIL_PURPOSE_LABELS[safePurpose] ? safePurpose : 'general';
            }
            syncBloomEmailPurposeModalUi();
            const reason = document.getElementById('bloom-email-purpose-reason');
            if (reason && isBloomEmailPurposeReasonRequired()) {
                setTimeout(() => {
                    try { reason.focus({ preventScroll: true }); } catch (err) { reason.focus(); }
                }, 30);
            }
            return false;
        }

        function openBloomEmailPurposeModal(items = getCartSelectedItems(), selectionKind = getBloomDirectShareSelectionKind(items)) {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!rows.length) {
                showToast('Bloom Picker Empty', 'Add one or more rows to Bloom Picker first.', true);
                return false;
            }
            bloomEmailPurposeItems = rows.slice();
            bloomEmailPurposeSelectionKind = selectionKind || getBloomDirectShareSelectionKind(rows);
            bloomEmailPurposeAction = 'general';
            bloomEmailPurposeRecipientSearch = '';
            bloomEmailPurposeSelectedRecipients = new Set();
            bloomEmailPurposeSending = false;
            const reason = document.getElementById('bloom-email-purpose-reason');
            if (reason) reason.value = '';
            const recipientSearch = document.getElementById('bloom-email-purpose-recipient-search');
            if (recipientSearch) recipientSearch.value = '';
            syncBloomEmailPurposeActionOptions(rows);
            const modal = document.getElementById('bloom-email-purpose-modal');
            if (modal) modal.classList.remove('hidden');
            syncBloomEmailPurposeModalUi();
            return false;
        }

        function formatBloomActionRowTimestamp(date = new Date()) {
            const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
            return safeDate.toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit'
            });
        }

        function getBloomActionRowPtrAvailableDefault(item = null) {
            return String(firstNonEmptyValue(
                item && item.PTRAVAILABLE,
                item && item.ptravailable,
                item && item.LOC_AVAIL,
                item && item.loc_avail,
                item && item.LOC_AVAILABLE,
                item && item.loc_available,
                getCardPtrAvailableValue(item),
                ''
            ) || '').trim();
        }

        function getBloomActionRowReleaseQtyDefault(item = null) {
            const explicit = firstNonEmptyValue(
                item && item.NCR_REQUESTED_QTY,
                item && item.ncr_requested_qty,
                item && item.BLOOM_ACTION_RELEASE_QTY,
                item && item.bloom_action_release_qty,
                item && item.LOC_MATCH_QTY,
                item && item.loc_match_qty,
                ''
            );
            if (explicit !== '') return String(explicit).trim();
            const suggested = getApprovalSuggestedQtyFromItem(item, 'new-crop');
            return suggested !== '' && suggested !== null && typeof suggested !== 'undefined' ? String(suggested).trim() : '';
        }

        function getBloomActionRowMoveUpQtyDefault(item = null) {
            return '';
        }

        function getBloomActionMoveSeasonOptions() {
            const configuredOrder = ['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z'];
            const seen = new Set();
            return configuredOrder
                .map((season) => normalizeAppCurrentSeasonCode(season))
                .filter((season) => {
                    if (!season || seen.has(season)) return false;
                    seen.add(season);
                    return true;
                });
        }

        function normalizeBloomActionMoveSeason(value = '') {
            const raw = normalizeAppCurrentSeasonCode(value);
            const options = getBloomActionMoveSeasonOptions();
            if (raw === 'U' && options.includes('U1')) return 'U1';
            return options.includes(raw) ? raw : (options[0] || 'S1');
        }

        function getBloomActionMoveLotCode(season = '') {
            const salesYear = normalizeAppCurrentSalesYear(getConfiguredCurrentSalesYearCode());
            const safeSeason = normalizeBloomActionMoveSeason(season);
            return `${salesYear}.${safeSeason}`;
        }

        function getBloomActionMoveDownSeasonOptions() {
            return getBloomActionMoveSeasonOptions();
        }

        function normalizeBloomActionMoveDownSeason(value = '') {
            return normalizeBloomActionMoveSeason(value);
        }

        function getBloomActionMoveDownLotCode(season = '') {
            return getBloomActionMoveLotCode(season);
        }

        function getBloomActionRowMoveDownQtyDefault(item = null) {
            return String(firstNonEmptyValue(
                item && item.BLOOM_ACTION_MOVE_DOWN_QTY,
                item && item.bloom_action_move_down_qty,
                item && item.LOC_MATCH_QTY,
                item && item.loc_match_qty,
                getBloomActionRowPtrAvailableDefault(item),
                ''
            ) || '').trim();
        }

        function getBloomActionRowItemCode(item = null) {
            return String(firstNonEmptyValue(item && item.ITEMCODE, item && item.itemcode, item && item.ITEM_CODE, item && item.item_code, '') || '').trim().toUpperCase();
        }

        function getBloomActionRowExplicitSeasonCode(item = null) {
            const explicit = String(firstNonEmptyValue(item && item.SEASON, item && item.season, item && item.SEASONCODE, item && item.seasoncode, '') || '').trim().toUpperCase().replace(/\s+/g, '');
            const raw = explicit || String(firstNonEmptyValue(item && item.LOTCODE, item && item.lotcode, item && item.LOT, item && item.lot, '') || '').trim().toUpperCase().split('.').pop();
            if (raw === 'S') return 'S1';
            if (raw === 'F') return 'F1';
            return raw || '';
        }

        function getBloomActionRowExplicitSalesYearCode(item = null) {
            const explicit = firstNonEmptyValue(
                item && item.SALEYEAR,
                item && item.saleyear,
                item && item.SALESYEAR,
                item && item.salesyear,
                item && item.SALES_YEAR,
                item && item.sales_year,
                ''
            );
            const raw = String(explicit || '').trim() || String(firstNonEmptyValue(item && item.LOTCODE, item && item.lotcode, item && item.LOT, item && item.lot, '') || '').trim().split('.')[0];
            if (!String(raw || '').trim()) return null;
            return normalizeAppCurrentSalesYear(raw);
        }

        function getBloomActionRowIdentityValues(item = null) {
            if (!item || typeof item !== 'object') return [];
            const values = [
                item.UNIQUE_ID,
                item.unique_id,
                item.MASTER_UNIQUE_ID,
                item.master_unique_id,
                item.MASTER_ID,
                item.master_id,
                item.SOURCE_UNIQUE_ID,
                item.source_unique_id,
                item.REQUEST_SOURCE_UID,
                item.request_source_uid,
                item.DOM_ID,
                item.dom_id
            ];
            const seen = new Set();
            return values.map((value) => String(value == null ? '' : value).trim()).filter((value) => {
                if (!value || seen.has(value)) return false;
                seen.add(value);
                return true;
            });
        }

        function getBloomActionRowSourceLotCode(item = null) {
            return String(firstNonEmptyValue(item && item.LOTCODE, item && item.lotcode, item && item.REQ_LOTCODE, item && item.req_lotcode, item && item.LOT, item && item.lot, '') || '').trim().toUpperCase();
        }

        function getBloomActionRowSourceLocationCode(item = null) {
            return String(firstNonEmptyValue(item && item.LOCATIONCODE, item && item.locationcode, item && item.REQ_LOCATIONCODE, item && item.req_locationcode, item && item.LOCATION_CODE, item && item.location_code, '') || '').trim().toUpperCase();
        }

        function isBloomActionBlankishSourceValue(value = '') {
            const raw = String(value == null ? '' : value).trim();
            if (!raw) return true;
            return ['-', '=', 'BLANK', 'NULL', 'N/A', 'NA'].includes(raw.toUpperCase());
        }

        function getBloomActionRowSourceCandidates(item = null) {
            const safeItem = item && typeof item === 'object' ? item : null;
            const candidates = [];
            const seenObjects = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
            const pushCandidate = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return;
                if (seenObjects) {
                    if (seenObjects.has(candidate)) return;
                    seenObjects.add(candidate);
                }
                candidates.push(candidate);
            };
            const uidValues = getBloomActionRowIdentityValues(safeItem);
            uidValues.forEach((uid) => {
                try { pushCandidate(masterInventoryById.get(uid)); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
                try { pushCandidate(findItemByUniqueId(uid)); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
                try { pushCandidate(findItemByDomId(uid)); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            });
            try { if (!masterInventoryById.size && Array.isArray(fullInventory) && fullInventory.length) rebuildMasterInventoryIndexes(); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            const itemCode = getBloomActionRowItemCode(safeItem);
            const locationCode = getBloomActionRowSourceLocationCode(safeItem);
            const lotCode = getBloomActionRowSourceLotCode(safeItem);
            const uidSet = new Set(uidValues);
            const matchesItem = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return false;
                const candidateUids = getBloomActionRowIdentityValues(candidate);
                if (candidateUids.some((uid) => uidSet.has(uid))) return true;
                if (!itemCode || getBloomActionRowItemCode(candidate) !== itemCode) return false;
                if (locationCode && getBloomActionRowSourceLocationCode(candidate) !== locationCode) return false;
                if (lotCode && getBloomActionRowSourceLotCode(candidate) !== lotCode) return false;
                return true;
            };
            const scanCollection = (collection) => {
                (Array.isArray(collection) ? collection : []).forEach((candidate) => {
                    if (matchesItem(candidate)) pushCandidate(candidate);
                });
            };
            try { scanCollection(Array.from(masterInventoryById.values())); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { scanCollection(fullInventory); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { scanCollection(avOpenInventory); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { scanCollection(managerReviewInventory); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { scanCollection(moveUpInventory); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { scanCollection(salesOfficeInventory); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowSourceCandidates", 'HANDLED_OPERATION_FAILURE'); }
            pushCandidate(safeItem);
            return candidates;
        }

        function getBloomActionRowRawHoldStopCodeValue(item = null) {
            return String(firstNonEmptyValue(
                item && item.HOLDSTOPCODE,
                item && item.holdstopcode,
                item && item.HOLSTOPCODE,
                item && item.holstopcode,
                item && item.HOLD_STOP_CODE,
                item && item.hold_stop_code,
                item && item.HOLDSTOP_CODE,
                item && item.holdstop_code,
                item && item.HOLDSTOP,
                item && item.holdstop,
                ''
            ) || '').trim();
        }

        function getBloomActionRowRawHoldStopReasonValue(item = null) {
            return String(firstNonEmptyValue(
                item && item.HOLDSTOPREASON,
                item && item.holdstopreason,
                item && item.HOLSTOPREASON,
                item && item.holstopreason,
                item && item.HOLD_STOP_REASON,
                item && item.hold_stop_reason,
                item && item.HOLDREASON,
                item && item.holdreason,
                item && item.HOLD_REASON,
                item && item.hold_reason,
                item && item.HOLDSTOPREASONCODE,
                item && item.holdstopreasoncode,
                ''
            ) || '').trim();
        }

        function getBloomActionRowCurrentHoldStopFromSource(item = null) {
            const rows = getBloomActionRowSourceCandidates(item);
            for (const row of rows) {
                const raw = getBloomActionRowRawHoldStopCodeValue(row);
                if (!isBloomActionBlankishSourceValue(raw)) return raw.toUpperCase();
            }
            return '';
        }

        function getBloomActionRowCurrentHoldStopReasonFromSource(item = null) {
            const rows = getBloomActionRowSourceCandidates(item);
            for (const row of rows) {
                const raw = getBloomActionRowRawHoldStopReasonValue(row);
                if (!isBloomActionBlankishSourceValue(raw)) return normalizeBloomActionHoldStopReasonValue(raw);
            }
            return '';
        }

        function getBloomActionRowCurrentSeasonItemCodeHoldStop(item = null) {
            const itemCode = getBloomActionRowItemCode(item);
            if (!itemCode) return '';
            const settings = getCurrentAppSeasonSettings();
            const currentSeason = String(settings && settings.seasonCode || '').trim().toUpperCase();
            const currentSalesYear = Number(settings && settings.salesYear);
            if (!currentSeason || !Number.isFinite(currentSalesYear)) return '';
            const candidates = [];
            const seen = new Set();
            const pushCandidate = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return;
                const uid = String(firstNonEmptyValue(candidate.UNIQUE_ID, candidate.unique_id, candidate.DOM_ID, '') || '').trim();
                const key = uid || `${getBloomActionRowItemCode(candidate)}|${String(firstNonEmptyValue(candidate.LOCATIONCODE, candidate.locationcode, '') || '').trim()}|${String(firstNonEmptyValue(candidate.LOTCODE, candidate.lotcode, '') || '').trim()}|${candidates.length}`;
                if (seen.has(key)) return;
                seen.add(key);
                candidates.push(candidate);
            };
            pushCandidate(item);
            try { if (!masterInventoryById.size && Array.isArray(fullInventory) && fullInventory.length) rebuildMasterInventoryIndexes(); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowCurrentSeasonItemCodeHoldStop", 'HANDLED_OPERATION_FAILURE'); }
            try { Array.from(masterInventoryById.values()).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowCurrentSeasonItemCodeHoldStop", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(fullInventory) ? fullInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowCurrentSeasonItemCodeHoldStop", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(avOpenInventory) ? avOpenInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getBloomActionRowCurrentSeasonItemCodeHoldStop", 'HANDLED_OPERATION_FAILURE'); }
            const directCodes = [];
            const tokenSet = new Set();
            candidates.forEach((candidate) => {
                if (getBloomActionRowItemCode(candidate) !== itemCode) return;
                if (getBloomActionRowExplicitSeasonCode(candidate) !== currentSeason) return;
                const salesYear = getBloomActionRowExplicitSalesYearCode(candidate);
                if (salesYear !== currentSalesYear) return;
                const code = getHoldStopSnapshotFromItem(candidate);
                if (!code || isBloomActionBlankishSourceValue(code)) return;
                directCodes.push(code);
                getHoldStopBlockTokens(code).forEach((token) => tokenSet.add(token));
            });
            const blockingCode = ['H', 'S'].filter((token) => tokenSet.has(token)).join('');
            return blockingCode || directCodes[0] || '';
        }

        function normalizeOffHoldPriorityRequestValue(value = '') {
            const raw = String(value == null ? '' : value).trim();
            const digits = raw.replace(/[^\d]/g, '').slice(0, 2);
            return digits || '';
        }

        function getOffHoldPriorityChangeDefaultPriority(context = bloomActionRowFormContext) {
            const safeContext = context || {};
            let defaultPriority = '';
            try {
                const drafts = ensureBloomActionRowFormDrafts(safeContext);
                for (const draft of drafts) {
                    defaultPriority = normalizeOffHoldPriorityRequestValue(firstNonEmptyValue(draft && draft.priority, ''));
                    if (defaultPriority) break;
                }
            } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeDefaultPriority", 'HANDLED_OPERATION_FAILURE'); }
            return defaultPriority || '1';
        }

        function getOffHoldPriorityChangeRowKey(row = null, index = 0) {
            if (!row || typeof row !== 'object') return `row-${index}`;
            const uid = String(firstNonEmptyValue(row.key, row.uid, row.uniqueId, row.unique_id, row.UNIQUE_ID, row.DOM_ID, row.domId, '') || '').trim();
            if (uid) return uid;
            return [
                getBloomActionRowItemCode(row),
                getBloomActionRowSourceLocationCode(row),
                getBloomActionRowSourceLotCode(row),
                String(firstNonEmptyValue(getMasterInventorySourceCode(row), row.SOURCE, row.source, '') || '').trim().toUpperCase(),
                String(firstNonEmptyValue(row.PRIORITY, row.priority, '') || '').trim(),
                String(firstNonEmptyValue(row.SALESYEAR, row.salesyear, '') || '').trim(),
                index
            ].join('|');
        }

        function buildOffHoldPriorityChangeRowSnapshot(row = null, options = {}) {
            if (!row || typeof row !== 'object') return null;
            const requestedPriority = normalizeOffHoldPriorityRequestValue(options && options.requestedPriority) || '1';
            return {
                key: getOffHoldPriorityChangeRowKey(row, options && options.index || 0),
                itemCode: getBloomActionRowItemCode(row),
                commonName: String(firstNonEmptyValue(row.COMMONNAME, row.commonName, row.commonname, '') || '').trim(),
                contSize: String(firstNonEmptyValue(row.CONTSIZE, row.contSize, row.contsize, '') || '').trim(),
                locationcode: getBloomActionRowSourceLocationCode(row),
                lotcode: getBloomActionRowSourceLotCode(row),
                source: String(firstNonEmptyValue(getMasterInventorySourceCode(row), row.SOURCE, row.source, row.SOURCECODE, row.sourcecode, '') || '').trim().toUpperCase(),
                currentPriority: String(firstNonEmptyValue(row.PRIORITY, row.priority, '') || '').trim(),
                requestedPriority,
                season: getBloomActionRowExplicitSeasonCode(row),
                salesYear: getBloomActionRowExplicitSalesYearCode(row)
            };
        }

        function getOffHoldPriorityChangeCandidates(anchorRows = []) {
            const anchors = (Array.isArray(anchorRows) ? anchorRows : [anchorRows]).filter(Boolean);
            const itemCodes = new Set(anchors.map(getBloomActionRowItemCode).filter(Boolean));
            if (!itemCodes.size) return [];
            const settings = getCurrentAppSeasonSettings();
            const currentSeason = normalizeAppCurrentSeasonCode(firstNonEmptyValue(settings && settings.seasonCode, ''));
            const currentSalesYearFallback = typeof getConfiguredCurrentSalesYearCode === 'function' ? getConfiguredCurrentSalesYearCode() : '';
            const currentSalesYear = Number(firstNonEmptyValue(settings && settings.salesYear, currentSalesYearFallback, ''));
            const candidates = [];
            const seen = new Set();
            const pushCandidate = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return;
                if (!itemCodes.has(getBloomActionRowItemCode(candidate))) return;
                const season = normalizeAppCurrentSeasonCode(getBloomActionRowExplicitSeasonCode(candidate));
                if (currentSeason && season !== currentSeason) return;
                const salesYear = Number(getBloomActionRowExplicitSalesYearCode(candidate));
                if (Number.isFinite(currentSalesYear) && (!Number.isFinite(salesYear) || salesYear > currentSalesYear)) return;
                const key = getOffHoldPriorityChangeRowKey(candidate, candidates.length);
                if (seen.has(key)) return;
                seen.add(key);
                candidates.push(candidate);
            };
            anchors.forEach(pushCandidate);
            try { if (!masterInventoryById.size && Array.isArray(fullInventory) && fullInventory.length) rebuildMasterInventoryIndexes(); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { Array.from(masterInventoryById.values()).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(fullInventory) ? fullInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(avOpenInventory) ? avOpenInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(managerReviewInventory) ? managerReviewInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(moveUpInventory) ? moveUpInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            try { (Array.isArray(salesOfficeInventory) ? salesOfficeInventory : []).forEach(pushCandidate); } catch (err) { globalThis.reportHandledRuntimeIssue?.("getOffHoldPriorityChangeCandidates", 'HANDLED_OPERATION_FAILURE'); }
            return candidates
                .map((row, index) => buildOffHoldPriorityChangeRowSnapshot(row, { index }))
                .filter((row) => row && row.itemCode)
                .sort((a, b) => `${a.locationcode}|${a.source}|${a.lotcode}`.localeCompare(`${b.locationcode}|${b.source}|${b.lotcode}`));
        }

        function ensureOffHoldPriorityChangeModal() {
            let modal = document.getElementById('off-hold-priority-change-modal');
            if (modal) return modal;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `<div id="off-hold-priority-change-modal" class="fixed inset-0 z-[10080] hidden bg-black/45 p-3 backdrop-blur-sm">
                <div class="mx-auto flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl">
                    <div class="flex items-start justify-between gap-3 border-b border-emerald-100 px-5 py-4">
                        <div>
                            <div class="text-[10px] font-black uppercase tracking-[0.16em] text-[#007a4d]">Off Hold Request</div>
                            <div class="mt-1 text-xl font-black text-slate-900">Add Priority Change</div>
                            <div id="off-hold-priority-change-count" class="mt-1 text-xs font-bold text-slate-500">0 selected</div>
                        </div>
                        <button type="button" class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 shadow-sm" onclick="return closeOffHoldPriorityChangeModal('cancel')">Close</button>
                    </div>
                    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                        <div class="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                            <label class="block">
                                <span class="mb-1 ml-1 block text-[9px] font-black uppercase tracking-[0.14em] text-[#007a4d]">Requested Priority</span>
                                <input id="off-hold-priority-change-requested-priority" class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base font-black text-slate-900 shadow-sm focus:border-[#007a4d] focus:outline-none" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="1" oninput="return setOffHoldPriorityChangeRequestedPriority(this.value)">
                            </label>
                            <div class="mt-2 text-xs font-bold text-slate-600">Select same-item rows from the current season with sales year less than or equal to the current sales year.</div>
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <button type="button" class="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#007a4d]" onclick="return setOffHoldPriorityChangeRowsSelected(true)">Select All</button>
                            <button type="button" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500" onclick="return setOffHoldPriorityChangeRowsSelected(false)">Clear</button>
                        </div>
                        <div id="off-hold-priority-change-list" class="mt-3 grid grid-cols-1 gap-2"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
                        <button type="button" class="rounded-xl bg-white px-4 py-4 text-[12px] font-black uppercase tracking-[0.18em] text-slate-700 shadow-sm" onclick="return closeOffHoldPriorityChangeModal('cancel')">No Priority</button>
                        <button type="button" class="rounded-xl bg-[#007a4d] px-4 py-4 text-[12px] font-black uppercase tracking-[0.18em] text-white shadow-sm" onclick="return closeOffHoldPriorityChangeModal('add')">Add Selected</button>
                    </div>
                </div>
            </div>`;
            modal = wrapper.firstElementChild;
            document.body.appendChild(modal);
            return modal;
        }

        function syncOffHoldPriorityChangeModalUi() {
            const count = document.getElementById('off-hold-priority-change-count');
            const list = document.getElementById('off-hold-priority-change-list');
            const priorityInput = document.getElementById('off-hold-priority-change-requested-priority');
            if (priorityInput && priorityInput.value !== offHoldPriorityChangeRequestedPriority) priorityInput.value = offHoldPriorityChangeRequestedPriority;
            const selectedCount = Array.from(offHoldPriorityChangeSelectedRowKeys || []).length;
            if (count) count.textContent = `${selectedCount} selected`;
            if (!list) return;
            const rows = Array.isArray(offHoldPriorityChangeCandidateRows) ? offHoldPriorityChangeCandidateRows : [];
            if (!rows.length) {
                list.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm font-bold text-slate-400">No matching current-season rows were found.</div>';
                return;
            }
            list.innerHTML = rows.map((row, index) => {
                const key = row.key || getOffHoldPriorityChangeRowKey(row, index);
                const selected = offHoldPriorityChangeSelectedRowKeys.has(key);
                const encodedKey = encodeURIComponent(key);
                return `<button type="button" aria-pressed="${selected ? 'true' : 'false'}" class="rounded-2xl border px-4 py-3 text-left shadow-sm active:scale-[.99] ${selected ? 'border-[#007a4d] bg-emerald-50 text-[#007a4d]' : 'border-slate-200 bg-white text-slate-800'}" onclick="return toggleOffHoldPriorityChangeRow('${encodedKey}')">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="min-w-0">
                            <div class="truncate text-sm font-black">${escapeHtml(row.locationcode || 'No Loc')} <span class="text-slate-400">|</span> ${escapeHtml(row.source || '-')} <span class="text-slate-400">|</span> PRI ${escapeHtml(row.currentPriority || '-')}</div>
                            <div class="mt-1 truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Lot ${escapeHtml(row.lotcode || '-')} | Season ${escapeHtml(row.season || '-')} | Salesyear ${escapeHtml(row.salesYear || '-')}</div>
                        </div>
                        <span class="rounded-full ${selected ? 'bg-emerald-100 text-[#007a4d]' : 'bg-slate-100 text-slate-500'} px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]">${selected ? 'Selected' : 'Tap'}</span>
                    </div>
                </button>`;
            }).join('');
        }

        function setOffHoldPriorityChangeRequestedPriority(value = '') {
            offHoldPriorityChangeRequestedPriority = normalizeOffHoldPriorityRequestValue(value);
            const input = document.getElementById('off-hold-priority-change-requested-priority');
            if (input && input.value !== offHoldPriorityChangeRequestedPriority) input.value = offHoldPriorityChangeRequestedPriority;
            return false;
        }

        function toggleOffHoldPriorityChangeRow(encodedKey = '') {
            const key = decodeURIComponent(String(encodedKey || ''));
            if (!key) return false;
            if (offHoldPriorityChangeSelectedRowKeys.has(key)) offHoldPriorityChangeSelectedRowKeys.delete(key);
            else offHoldPriorityChangeSelectedRowKeys.add(key);
            syncOffHoldPriorityChangeModalUi();
            return false;
        }

        function setOffHoldPriorityChangeRowsSelected(selected = true) {
            offHoldPriorityChangeSelectedRowKeys = selected
                ? new Set(offHoldPriorityChangeCandidateRows.map((row, index) => row.key || getOffHoldPriorityChangeRowKey(row, index)))
                : new Set();
            syncOffHoldPriorityChangeModalUi();
            return false;
        }

        function closeOffHoldPriorityChangeModal(choice = 'cancel') {
            const action = String(choice || 'cancel').trim().toLowerCase();
            if (action === 'add') {
                const requestedPriority = normalizeOffHoldPriorityRequestValue(offHoldPriorityChangeRequestedPriority);
                if (!requestedPriority) {
                    showToast('Priority Required', 'Enter the requested priority before adding rows.', true);
                    return false;
                }
                const selectedRows = offHoldPriorityChangeCandidateRows
                    .filter((row, index) => offHoldPriorityChangeSelectedRowKeys.has(row.key || getOffHoldPriorityChangeRowKey(row, index)))
                    .map((row) => ({ ...row, requestedPriority }));
                if (!selectedRows.length) {
                    showToast('Select Rows', 'Choose at least one row for the priority change request.', true);
                    return false;
                }
                const modal = document.getElementById('off-hold-priority-change-modal');
                if (modal) modal.classList.add('hidden');
                const resolver = offHoldPriorityChangeResolver;
                offHoldPriorityChangeResolver = null;
                offHoldPriorityChangeCandidateRows = [];
                offHoldPriorityChangeSelectedRowKeys = new Set();
                if (resolver) resolver(selectedRows);
                return false;
            }
            const modal = document.getElementById('off-hold-priority-change-modal');
            if (modal) modal.classList.add('hidden');
            const resolver = offHoldPriorityChangeResolver;
            offHoldPriorityChangeResolver = null;
            offHoldPriorityChangeCandidateRows = [];
            offHoldPriorityChangeSelectedRowKeys = new Set();
            if (resolver) resolver([]);
            return false;
        }

        async function openOffHoldPriorityChangeModal(rows = [], options = {}) {
            const modal = ensureOffHoldPriorityChangeModal();
            const requestedPriority = normalizeOffHoldPriorityRequestValue(options && options.requestedPriority) || '1';
            offHoldPriorityChangeRequestedPriority = requestedPriority;
            offHoldPriorityChangeCandidateRows = (Array.isArray(rows) ? rows : []).map((row, index) => ({
                ...row,
                key: row.key || getOffHoldPriorityChangeRowKey(row, index),
                requestedPriority
            }));
            offHoldPriorityChangeSelectedRowKeys = new Set();
            if (offHoldPriorityChangeResolver) {
                const previousResolver = offHoldPriorityChangeResolver;
                offHoldPriorityChangeResolver = null;
                previousResolver([]);
            }
            modal.classList.remove('hidden');
            syncOffHoldPriorityChangeModalUi();
            const input = document.getElementById('off-hold-priority-change-requested-priority');
            if (input) setTimeout(() => {
                try { input.focus({ preventScroll: true }); input.select(); } catch (err) { input.focus(); }
            }, 30);
            return new Promise((resolve) => {
                offHoldPriorityChangeResolver = resolve;
            });
        }

        async function maybeCollectOffHoldPriorityChangeRows(rows = [], context = bloomActionRowFormContext) {
            const candidates = getOffHoldPriorityChangeCandidates(rows);
            if (!candidates.length) return [];
            const includePriorityChange = await showAppConfirm('Do you want to include a priority change request for this item in the same Off Hold email?', {
                title: 'Priority Change?',
                confirmLabel: 'Add Priority',
                cancelLabel: 'No Priority'
            });
            if (!includePriorityChange) return [];
            const selectedRows = await openOffHoldPriorityChangeModal(candidates, {
                requestedPriority: getOffHoldPriorityChangeDefaultPriority(context)
            });
            return Array.isArray(selectedRows) ? selectedRows : [];
        }

        function getBloomActionRowCurrentHoldStop(item = null) {
            const directHoldStop = getBloomActionRowRawHoldStopCodeValue(item);
            return getBloomActionRowCurrentSeasonItemCodeHoldStop(item) || getBloomActionRowCurrentHoldStopFromSource(item) || directHoldStop;
        }

        function normalizeBloomActionHoldStopCodeChoice(value = '', action = '') {
            const raw = String(value == null ? '' : value).trim().toUpperCase();
            if (!raw) return '';
            const tokens = getHoldStopBlockTokens(raw);
            const safeAction = String(action || '').trim();
            if (safeAction === 'stop_ship' && tokens.has('S')) return 'S';
            if (safeAction === 'hold' && tokens.has('H')) return 'H';
            if (tokens.has('S')) return 'S';
            if (tokens.has('H')) return 'H';
            return raw === 'S' || raw === 'H' ? raw : '';
        }

        function normalizeBloomActionHoldStopReasonValue(value = '') {
            return String(value == null ? '' : value).trim().toLowerCase();
        }

        function getBloomActionRowCurrentHoldStopReason(item = null) {
            return getBloomActionRowCurrentHoldStopReasonFromSource(item)
                || normalizeBloomActionHoldStopReasonValue(getBloomActionRowRawHoldStopReasonValue(item));
        }

        function getBloomActionRowHoldStopDefault(action = '', item = null) {
            const current = normalizeBloomActionHoldStopCodeChoice(getBloomActionRowCurrentHoldStop(item), action);
            if (action === 'take_off_hold' || action === 'off_stop_ship') return '';
            if (current) return current;
            if (action === 'hold') return 'H';
            if (action === 'stop_ship') return 'S';
            return current;
        }

        function getBloomActionRowReadonlyValue(item = null, field = '') {
            if (field === 'lotcode') return getBloomPurposeRowValue(item, ['LOTCODE', 'lotcode', 'REQ_LOTCODE', 'req_lotcode', 'LOT', 'lot'], '');
            if (field === 'locationcode') return getBloomPurposeRowValue(item, ['LOCATIONCODE', 'locationcode', 'REQ_LOCATIONCODE', 'req_locationcode', 'LOCATION_CODE', 'LOCATION'], '');
            if (field === 'source' || field === 'sourcecode') return String(firstNonEmptyValue(getMasterInventorySourceCode(item), item && item.SOURCECODE, item && item.sourcecode, item && item.SOURCE, item && item.source, '') || '').trim();
            if (field === 'ptronhand') return getCardPtrOnHandValue(item);
            if (field === 'ptrreviewed') return String(firstNonEmptyValue(item && item.PTRREVIEWED, item && item.ptrreviewed, '') || '').trim();
            if (field === 'locationptn1') return String(firstNonEmptyValue(item && item.LOCATIONPTN1, item && item.locationptn1, item && item.LOC_PTN1, item && item.loc_ptn1, '') || '').trim();
            return '';
        }

        function getBloomActionRowBaseLocationNote(item = null) {
            return String(firstNonEmptyValue(item && item.LOCATIONNOTE, item && item.locationnote, item && item.LOCATION_NOTE, item && item.location_note, '') || '').trim();
        }

        function formatBloomActionNcrLocationNoteDate(value = '') {
            const parsed = value ? new Date(value) : new Date();
            const safeDate = parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
            return safeDate.toLocaleDateString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric'
            });
        }

        function buildBloomActionNcrLocationNoteLine(releaseQty = '', ptrAvailable = '', timestampIso = '') {
            const releaseLabel = String(releaseQty == null ? '' : releaseQty).trim() || '0';
            const ptrLabel = String(ptrAvailable == null ? '' : ptrAvailable).trim() || '0';
            return `NCR ${releaseLabel} / ${ptrLabel} ${formatBloomActionNcrLocationNoteDate(timestampIso)}`;
        }

        function buildBloomActionNcrLocationNote(baseNote = '', releaseQty = '', ptrAvailable = '', timestampIso = '') {
            const base = String(baseNote || '').trim();
            const ncrLine = buildBloomActionNcrLocationNoteLine(releaseQty, ptrAvailable, timestampIso);
            if (base) {
                const normalizedLine = normalizeBloomActionLocationNote(ncrLine);
                const hasLine = base.split(/\n+/).some((line) => normalizeBloomActionLocationNote(line) === normalizedLine);
                if (hasLine) return base;
            }
            return [base, ncrLine].filter(Boolean).join('\n');
        }

        function normalizeBloomActionLocationNote(value = '') {
            return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
        }

        function getBloomActionRowDefaultValues(item = null, action = '', timestampIso = '') {
            const rowOptions = getApprovalRowOptionsMetaFromItem(item);
            const screenValues = rowOptions && rowOptions.screenValues && typeof rowOptions.screenValues === 'object' ? rowOptions.screenValues : {};
            const hasScreenLocationNote = Object.prototype.hasOwnProperty.call(screenValues, 'locationnote');
            const ptravailable = String(firstNonEmptyValue(screenValues.ptravailable, getBloomActionRowPtrAvailableDefault(item), '') || '').trim();
            const releaseQty = action === 'ncr' ? String(firstNonEmptyValue(screenValues.releaseQty, getBloomActionRowReleaseQtyDefault(item), '') || '').trim() : '';
            const moveUpQty = '';
            const moveUpSeason = action === 'move_up' ? normalizeBloomActionMoveSeason(firstNonEmptyValue(screenValues.moveUpSeason, screenValues.move_up_season, screenValues.destinationSeason, screenValues.destination_season, '')) : '';
            const moveDownQty = action === 'move_down' ? String(firstNonEmptyValue(screenValues.moveDownQty, getBloomActionRowMoveDownQtyDefault(item), '') || '').trim() : '';
            const moveDownSeason = action === 'move_down' ? normalizeBloomActionMoveDownSeason(firstNonEmptyValue(screenValues.moveDownSeason, screenValues.move_down_season, screenValues.destinationSeason, screenValues.destination_season, '')) : '';
            const baseLocationNote = getBloomActionRowBaseLocationNote(item);
            const timestampDate = timestampIso ? new Date(timestampIso) : new Date();
            const timestampLabel = formatBloomActionRowTimestamp(timestampDate);
            const currentUserLabel = String(firstNonEmptyValue(currentUser, currentUserDisplay, '') || '').trim();
            const locationnote = hasScreenLocationNote
                ? String(screenValues.locationnote || '').trim()
                : (action === 'note' || action === 'recount'
                ? ''
                : (action === 'ncr'
                ? buildBloomActionNcrLocationNote(baseLocationNote, releaseQty, ptravailable, timestampIso)
                : baseLocationNote));
            return {
                ptravailable,
                releaseQty,
                moveUpQty,
                holdstopcode: normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(screenValues.holdstopcode, getBloomActionRowHoldStopDefault(action, item), ''), action),
                holdstopreason: normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(screenValues.holdstopreason, getBloomActionRowCurrentHoldStopReason(item), '')),
                priority: String(action === 'priority_change'
                    ? firstNonEmptyValue(screenValues.priority, '')
                    : firstNonEmptyValue(screenValues.priority, item && item.PRIORITY, item && item.priority, '') || '').trim(),
                priBy: String(firstNonEmptyValue(screenValues.priBy, item && item.PRISETBY, item && item.prisetby, item && item.PRIBY, item && item.priby, currentUserLabel, '') || '').trim(),
                lotcode: String(firstNonEmptyValue(
                    screenValues.lotcode,
                    action === 'move_up' ? getBloomActionMoveLotCode(moveUpSeason) : '',
                    action === 'move_down' ? getBloomActionMoveDownLotCode(moveDownSeason) : '',
                    getBloomActionRowReadonlyValue(item, 'lotcode'),
                    ''
                ) || '').trim(),
                locationcode: String(firstNonEmptyValue(screenValues.locationcode, getBloomActionRowReadonlyValue(item, 'locationcode'), '') || '').trim(),
                source: String(firstNonEmptyValue(screenValues.source, screenValues.sourcecode, getBloomActionRowReadonlyValue(item, 'source'), '') || '').trim(),
                ptronhand: String(firstNonEmptyValue(screenValues.ptronhand, getBloomActionRowReadonlyValue(item, 'ptronhand'), '') || '').trim(),
                ptrreviewed: String(firstNonEmptyValue(screenValues.ptrreviewed, getBloomActionRowReadonlyValue(item, 'ptrreviewed'), '') || '').trim(),
                evaldate: String(firstNonEmptyValue(screenValues.evaldate, item && item.EVALDATE, item && item.evaldate, timestampLabel, '') || '').trim(),
                priorityUpdate: String(firstNonEmptyValue(screenValues.priorityUpdate, item && item.PRIUPDATED, item && item.priupdated, timestampLabel, '') || '').trim(),
                locationnoteDate: String(firstNonEmptyValue(screenValues.locationnoteDate, item && item.LOCATIONNOTEDATE, item && item.locationnotedate, timestampLabel, '') || '').trim(),
                locationnote,
                moveUpSeason,
                moveDownQty,
                moveDownSeason,
                destinationSeason: action === 'move_up' ? moveUpSeason : (action === 'move_down' ? moveDownSeason : ''),
                locationptn1: String(firstNonEmptyValue(screenValues.locationptn1, getBloomActionRowReadonlyValue(item, 'locationptn1'), '') || '').trim(),
                locationnoteBase: baseLocationNote,
                locationnoteAutoLine: action === 'ncr' ? buildBloomActionNcrLocationNoteLine(releaseQty, ptravailable, timestampIso) : '',
                locationnoteAutoValue: action === 'ncr' ? locationnote : '',
                locationnoteEdited: false
            };
        }

        function getBloomActionRowStoredValue(values = null, field = '', fallback = '') {
            if (values && Object.prototype.hasOwnProperty.call(values, field)) {
                return String(values[field] == null ? '' : values[field]).trim();
            }
            return String(fallback == null ? '' : fallback).trim();
        }

        function ensureBloomActionRowFormDrafts(context = bloomActionRowFormContext) {
            const safeContext = context || {};
            const rows = Array.isArray(safeContext.rows) ? safeContext.rows.filter(Boolean) : [];
            if (!Array.isArray(safeContext.valuesByIndex)) safeContext.valuesByIndex = [];
            rows.forEach((item, index) => {
                if (!safeContext.valuesByIndex[index] || typeof safeContext.valuesByIndex[index] !== 'object') {
                    safeContext.valuesByIndex[index] = getBloomActionRowDefaultValues(item, safeContext.action || '', safeContext.timestampIso || '');
                }
            });
            if (safeContext.valuesByIndex.length > rows.length) safeContext.valuesByIndex.length = rows.length;
            return safeContext.valuesByIndex;
        }

        function getBloomActionRowFormCurrentIndex(context = bloomActionRowFormContext) {
            const safeContext = context || {};
            const rows = Array.isArray(safeContext.rows) ? safeContext.rows.filter(Boolean) : [];
            const maxIndex = Math.max(0, rows.length - 1);
            const rawIndex = Number(safeContext.currentIndex || 0);
            const currentIndex = Number.isFinite(rawIndex) ? Math.min(maxIndex, Math.max(0, Math.floor(rawIndex))) : 0;
            safeContext.currentIndex = currentIndex;
            return currentIndex;
        }

        function getBloomActionRowFormDraft(context = bloomActionRowFormContext, index = 0) {
            const safeContext = context || {};
            const rows = Array.isArray(safeContext.rows) ? safeContext.rows.filter(Boolean) : [];
            const drafts = ensureBloomActionRowFormDrafts(safeContext);
            const item = rows[index] || null;
            const fallback = getBloomActionRowDefaultValues(item, safeContext.action || '', safeContext.timestampIso || '');
            return { ...fallback, ...(drafts[index] || {}) };
        }

        function buildBloomActionRowFormCard(item = null, index = 0, context = {}) {
            const action = String(context.action || '').trim();
            const timestampLabel = String(context.timestampLabel || '').trim();
            const currentUserLabel = String(firstNonEmptyValue(currentUser, currentUserDisplay, 'Unknown') || 'Unknown').trim();
            const row = getBloomPurposeReportRow(item || {});
            const cardTitle = `${index + 1}. ${row.commonName || 'Unknown'}${row.contSize && row.contSize !== '-' ? ` (${row.contSize})` : ''}`;
            const savedValues = getBloomActionRowFormDraft(context, index);
            const ptrAvailable = getBloomActionRowStoredValue(savedValues, 'ptravailable', getBloomActionRowPtrAvailableDefault(item));
            const releaseQty = getBloomActionRowStoredValue(savedValues, 'releaseQty', getBloomActionRowReleaseQtyDefault(item));
            const moveUpQty = action === 'move_up' ? getBloomActionRowStoredValue(savedValues, 'moveUpQty', '') : getBloomActionRowStoredValue(savedValues, 'moveUpQty', getBloomActionRowMoveUpQtyDefault(item));
            const moveUpSeason = normalizeBloomActionMoveSeason(getBloomActionRowStoredValue(savedValues, 'moveUpSeason', getBloomActionRowStoredValue(savedValues, 'destinationSeason', '')));
            const moveDownQty = getBloomActionRowStoredValue(savedValues, 'moveDownQty', getBloomActionRowMoveDownQtyDefault(item));
            const moveDownSeason = normalizeBloomActionMoveDownSeason(getBloomActionRowStoredValue(savedValues, 'moveDownSeason', getBloomActionRowStoredValue(savedValues, 'destinationSeason', '')));
            const holdstop = normalizeBloomActionHoldStopCodeChoice(getBloomActionRowStoredValue(savedValues, 'holdstopcode', getBloomActionRowHoldStopDefault(action, item)), action);
            const holdstopreason = normalizeBloomActionHoldStopReasonValue(getBloomActionRowStoredValue(savedValues, 'holdstopreason', getBloomActionRowCurrentHoldStopReason(item)));
            const isPriorityChangeAction = action === 'priority_change';
            const currentPriority = String(firstNonEmptyValue(item && item.PRIORITY, item && item.priority, '') || '').trim();
            const priority = getBloomActionRowStoredValue(savedValues, 'priority', isPriorityChangeAction ? '' : currentPriority);
            const priBy = getBloomActionRowStoredValue(savedValues, 'priBy', currentUserLabel);
            const lotcode = getBloomActionRowStoredValue(savedValues, 'lotcode', action === 'move_up'
                ? getBloomActionMoveLotCode(moveUpSeason)
                : (action === 'move_down' ? getBloomActionMoveDownLotCode(moveDownSeason) : getBloomActionRowReadonlyValue(item, 'lotcode')));
            const locationcode = getBloomActionRowStoredValue(savedValues, 'locationcode', getBloomActionRowReadonlyValue(item, 'locationcode'));
            const source = getBloomActionRowStoredValue(savedValues, 'source', getBloomActionRowReadonlyValue(item, 'source'));
            const ptronhand = getBloomActionRowStoredValue(savedValues, 'ptronhand', getBloomActionRowReadonlyValue(item, 'ptronhand'));
            const ptrreviewed = getBloomActionRowStoredValue(savedValues, 'ptrreviewed', getBloomActionRowReadonlyValue(item, 'ptrreviewed'));
            const evaldate = getBloomActionRowStoredValue(savedValues, 'evaldate', timestampLabel);
            const priorityUpdate = getBloomActionRowStoredValue(savedValues, 'priorityUpdate', timestampLabel);
            const locationnoteDate = getBloomActionRowStoredValue(savedValues, 'locationnoteDate', timestampLabel);
            const locationNote = getBloomActionRowStoredValue(savedValues, 'locationnote', getBloomActionRowBaseLocationNote(item));
            const locationptn1 = getBloomActionRowStoredValue(savedValues, 'locationptn1', getBloomActionRowReadonlyValue(item, 'locationptn1'));
            const inputBase = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-900 shadow-sm focus:border-[#007a4d] focus:outline-none';
            const labelBase = 'mb-1 ml-1 block text-[9px] font-black uppercase tracking-[0.14em] text-[#007a4d]';
            const editInput = (label, field, value, attrs = '') => `<label class="block"><span class="${labelBase}">${escapeHtml(label)}</span><input data-bloom-action-field="${escapeHtml(field)}" data-index="${index}" class="${inputBase}" value="${escapeHtml(value || '')}" ${attrs}></label>`;
            const noteFieldLabel = action === 'note' || action === 'recount' ? 'Note' : 'Locationnote';
            const noteFieldPlaceholder = action === 'note' ? 'Note' : (action === 'recount' ? 'Optional recount note' : 'Location note');
            const releaseQtyHtml = action === 'ncr'
                ? `<label class="block"><span class="${labelBase}">Release QTY</span><input data-bloom-action-field="release_qty" data-index="${index}" class="${inputBase}" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(releaseQty)}" placeholder="Release qty" oninput="handleBloomActionRowQtyInput(${index})"></label>`
                : '';
            const moveSeasonOptionsHtml = (selectedSeason) => getBloomActionMoveSeasonOptions().map((season) => `<option value="${escapeHtml(season)}"${season === selectedSeason ? ' selected' : ''}>${escapeHtml(season)}</option>`).join('');
            const moveUpQtyHtml = action === 'move_up'
                ? `<label class="block"><span class="${labelBase}">Move Up QTY</span><input data-bloom-action-field="move_up_qty" data-index="${index}" class="${inputBase}" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(moveUpQty)}" placeholder="Move up qty"></label><label class="block"><span class="${labelBase}">Move Up Season</span><select data-bloom-action-field="move_up_season" data-index="${index}" class="${inputBase}" onchange="return handleBloomActionMoveSeasonChange(${index}, 'move_up')">${moveSeasonOptionsHtml(moveUpSeason)}</select></label>`
                : '';
            const moveDownHtml = action === 'move_down'
                ? `<label class="block"><span class="${labelBase}">Move Down QTY</span><input data-bloom-action-field="move_down_qty" data-index="${index}" class="${inputBase}" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(moveDownQty)}" placeholder="Move down qty"></label><label class="block"><span class="${labelBase}">Move Down Season</span><select data-bloom-action-field="move_down_season" data-index="${index}" class="${inputBase}" onchange="return handleBloomActionMoveSeasonChange(${index}, 'move_down')">${moveSeasonOptionsHtml(moveDownSeason)}</select></label>`
                : '';
            const holdstopOptions = ['', 'S', 'H'].map((option) => `<option value="${escapeHtml(option)}"${option === holdstop ? ' selected' : ''}>${escapeHtml(option || 'Blank')}</option>`).join('');
            const currentSeasonSltsSummary = action === 'ncr' ? getNcrCurrentSeasonSltsSummary(item) : null;
            const currentSeasonSltsHtml = currentSeasonSltsSummary
                ? `<div class="mt-3 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-purple-900">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="text-[9px] font-black uppercase tracking-[0.14em] text-purple-700">Current Salesyear S_LTS</span>
                        <span class="text-lg font-black">${escapeHtml(buildNcrCurrentSeasonSltsDisplayValue(currentSeasonSltsSummary))}</span>
                    </div>
                    <div class="mt-0.5 text-[10px] font-bold text-purple-700">${escapeHtml(buildNcrCurrentSeasonSltsLabel(currentSeasonSltsSummary))}</div>
                </div>`
                : '';
            return `<div class="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" data-bloom-action-row-card data-index="${index}">
                <div class="mb-3">
                    <div class="text-[10px] font-black uppercase tracking-[0.14em] text-[#007a4d]">${escapeHtml(getBloomPurposeReportTitle(action))}</div>
                    <div class="mt-1 text-base font-black leading-tight text-slate-900">${escapeHtml(cardTitle)}</div>
                    <div class="mt-1 text-[11px] font-bold text-slate-500">Item ${escapeHtml(row.itemCode || '-')} | Loc ${escapeHtml(row.locationCode || '-')} | Lot ${escapeHtml(row.lotCode || '-')}</div>
                    ${currentSeasonSltsHtml}
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label class="block"><span class="${labelBase}">PTRAVAILABLE</span><input data-bloom-action-field="ptravailable" data-index="${index}" class="${inputBase}" inputmode="numeric" pattern="-?[0-9]*" value="${escapeHtml(ptrAvailable)}" placeholder="PTR available" oninput="handleBloomActionRowQtyInput(${index})"></label>
                    ${releaseQtyHtml}
                    ${moveUpQtyHtml}
                    ${moveDownHtml}
                    <label class="block"><span class="${labelBase}">Holdstopcode</span><select data-bloom-action-field="holdstopcode" data-index="${index}" class="${inputBase}">${holdstopOptions}</select></label>
                    <label class="block"><span class="${labelBase}">Holdstopreason</span><input data-bloom-action-field="holdstopreason" data-index="${index}" class="${inputBase} lowercase" value="${escapeHtml(holdstopreason)}" placeholder="hold reason" autocapitalize="none" spellcheck="false" oninput="return handleBloomActionHoldStopReasonInput(this)"></label>
                    ${editInput('Lotcode', 'lotcode', lotcode)}
                    ${editInput('Locationcode', 'locationcode', locationcode)}
                    ${editInput('Source', 'source', source)}
                    <label class="block"><span class="${labelBase}">${isPriorityChangeAction ? 'Requested Priority' : 'Priority'}</span><input data-bloom-action-field="priority" data-index="${index}" class="${inputBase}" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(priority)}" placeholder="${isPriorityChangeAction ? `Current ${escapeHtml(currentPriority || '-')}` : 'Optional'}"></label>
                    ${editInput('PTRONHAND', 'ptronhand', ptronhand, 'inputmode="numeric" pattern="-?[0-9]*"')}
                    ${editInput('PTRREVIEWED', 'ptrreviewed', ptrreviewed)}
                    ${editInput('Eval Date', 'evaldate', evaldate)}
                    ${editInput('PRI BY', 'priby', priBy)}
                    ${editInput('Pri Update', 'priority_update', priorityUpdate)}
                    ${editInput('Note Date', 'locationnote_date', locationnoteDate)}
                </div>
                <label class="mt-3 block"><span class="${labelBase}">${escapeHtml(noteFieldLabel)}</span><textarea data-bloom-action-field="locationnote" data-index="${index}" class="${inputBase} min-h-[86px] resize-y font-bold" placeholder="${escapeHtml(noteFieldPlaceholder)}" oninput="handleBloomActionRowLocationNoteInput(${index})">${escapeHtml(locationNote)}</textarea></label>
                <label class="mt-3 block"><span class="${labelBase}">LOCATIONPTN1</span><input data-bloom-action-field="locationptn1" data-index="${index}" class="${inputBase}" value="${escapeHtml(locationptn1)}" placeholder="LOCATIONPTN1" onkeydown="return handleBloomActionRowLastFieldKeydown(event)"></label>
            </div>`;
        }

        function syncBloomActionRowFormModalUi(options = {}) {
            const preserveList = !!(options && options.preserveList);
            const context = bloomActionRowFormContext || {};
            const rows = Array.isArray(context.rows) ? context.rows.filter(Boolean) : [];
            ensureBloomActionRowFormDrafts(context);
            const currentIndex = getBloomActionRowFormCurrentIndex(context);
            const title = document.getElementById('bloom-action-row-form-title');
            const count = document.getElementById('bloom-action-row-form-count');
            const list = document.getElementById('bloom-action-row-form-list');
            const backBtn = document.getElementById('bloom-action-row-form-back-btn');
            const submitBtn = document.getElementById('bloom-action-row-form-submit-btn');
            const reportTitle = getBloomPurposeReportTitle(context.action || '');
            if (title) title.textContent = reportTitle;
            if (count) {
                const countLabel = rows.length > 1
                    ? `${rows.length} selected rows | Row ${currentIndex + 1} of ${rows.length}`
                    : `${rows.length} selected row${rows.length === 1 ? '' : 's'}`;
                count.textContent = `${countLabel}${context.timestampLabel ? ` | ${context.timestampLabel}` : ''}`;
            }
            if (list && !preserveList) {
                const currentRow = rows[currentIndex] || null;
                list.innerHTML = currentRow
                    ? buildBloomActionRowFormCard(currentRow, currentIndex, context)
                    : '<div class="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm font-bold text-slate-400">No rows selected.</div>';
                try { list.scrollTop = 0; } catch (err) { globalThis.safeIgnoreProbeError?.("syncBloomActionRowFormModalUi"); }
            }
            if (backBtn) {
                backBtn.textContent = currentIndex > 0 ? 'Back' : 'Cancel';
                backBtn.disabled = bloomActionRowFormSubmitting;
                backBtn.classList.toggle('opacity-70', bloomActionRowFormSubmitting);
                backBtn.classList.toggle('pointer-events-none', bloomActionRowFormSubmitting);
            }
            if (submitBtn) {
                const isContinueAction = context.action === 'ncr' || context.action === 'move_up';
                const finalStep = currentIndex >= rows.length - 1;
                submitBtn.textContent = bloomActionRowFormSubmitting ? (isContinueAction ? 'Starting...' : 'Sending...') : (finalStep ? 'Done' : 'Next');
                submitBtn.disabled = bloomActionRowFormSubmitting;
                submitBtn.classList.toggle('opacity-70', bloomActionRowFormSubmitting);
                submitBtn.classList.toggle('pointer-events-none', bloomActionRowFormSubmitting);
            }
        }

        function openBloomActionRowFormModal(rows = [], options = {}) {
            const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
            if (!safeRows.length) {
                showToast('Bloom Picker Empty', 'Add one or more rows to Bloom Picker first.', true);
                return false;
            }
            const now = new Date();
            const action = String(options.action || bloomEmailPurposeAction || 'general').trim() || 'general';
            const initialValuesByIndex = Array.isArray(options.initialValuesByIndex) ? options.initialValuesByIndex : [];
            bloomActionRowFormContext = {
                rows: safeRows.slice(),
                action,
                selectionKind: String(options.selectionKind || bloomEmailPurposeSelectionKind || getBloomDirectShareSelectionKind(safeRows) || '').trim(),
                reason: String(options.reason || '').trim(),
                recipientEmails: dedupeRequestEmailRecipients(options.recipientEmails || []),
                afterPersist: typeof options.afterPersist === 'function' ? options.afterPersist : null,
                emailOnly: options.emailOnly === true,
                recipientModalCompleted: options.recipientModalCompleted === true,
                timestampIso: now.toISOString(),
                timestampLabel: formatBloomActionRowTimestamp(now),
                currentIndex: 0,
                valuesByIndex: safeRows.map((item, index) => ({
                    ...getBloomActionRowDefaultValues(item, action, now.toISOString()),
                    ...((initialValuesByIndex[index] && typeof initialValuesByIndex[index] === 'object') ? initialValuesByIndex[index] : {})
                }))
            };
            bloomActionRowFormSubmitting = false;
            const purposeModal = document.getElementById('bloom-email-purpose-modal');
            if (purposeModal) purposeModal.classList.add('hidden');
            const modal = document.getElementById('bloom-action-row-form-modal');
            if (modal) modal.classList.remove('hidden');
            syncBloomActionRowFormModalUi();
            return false;
        }

        function closeBloomActionRowFormModal() {
            const modal = document.getElementById('bloom-action-row-form-modal');
            if (modal) modal.classList.add('hidden');
            const list = document.getElementById('bloom-action-row-form-list');
            if (list) list.innerHTML = '';
            bloomActionRowFormContext = null;
            bloomActionRowFormSubmitting = false;
            return false;
        }

        async function resolveBloomActionRowFormRecipientEmails(context = {}, rows = [], action = 'general', existingEmails = []) {
            const optionRecipientEmails = dedupeRequestEmailRecipients(Array.isArray(existingEmails) ? existingEmails : [existingEmails].filter(Boolean));
            const defaultRecipientEmails = dedupeRequestEmailRecipients([
                ...getInventoryTransactionRequiredRecipientEmails(),
                resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            ]);
            const recipientEmails = dedupeRequestEmailRecipients([
                ...optionRecipientEmails,
                ...defaultRecipientEmails
            ]);
            if (!isBloomEmailPurposeRecipientRequired(action) || optionRecipientEmails.length) return recipientEmails;
            const selectedEmails = await openGroupedBloomNcrRecipientModal(rows, defaultRecipientEmails);
            return dedupeRequestEmailRecipients([
                ...(selectedEmails || []),
                ...defaultRecipientEmails
            ]);
        }

        function getBloomActionRowFormField(index = 0, field = '') {
            return document.querySelector(`[data-bloom-action-field="${field}"][data-index="${index}"]`);
        }

        function getBloomActionRowFormValues(index = 0) {
            const getValue = (field) => {
                const el = getBloomActionRowFormField(index, field);
                return el ? String(el.value || '').trim() : '';
            };
            return {
                ptravailable: getValue('ptravailable'),
                releaseQty: getValue('release_qty'),
                moveUpQty: getValue('move_up_qty'),
                moveUpSeason: getValue('move_up_season'),
                moveDownQty: getValue('move_down_qty'),
                moveDownSeason: getValue('move_down_season'),
                holdstopcode: normalizeBloomActionHoldStopCodeChoice(getValue('holdstopcode')),
                holdstopreason: normalizeBloomActionHoldStopReasonValue(getValue('holdstopreason')),
                priority: getValue('priority'),
                priBy: getValue('priby'),
                lotcode: getValue('lotcode'),
                locationcode: getValue('locationcode'),
                source: getValue('source'),
                ptronhand: getValue('ptronhand'),
                ptrreviewed: getValue('ptrreviewed'),
                evaldate: getValue('evaldate'),
                priorityUpdate: getValue('priority_update'),
                locationnoteDate: getValue('locationnote_date'),
                locationnote: getValue('locationnote'),
                locationptn1: getValue('locationptn1')
            };
        }

        function handleBloomActionRowLastFieldKeydown(event = null) {
            if (!event || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return true;
            event.preventDefault();
            submitBloomActionRowForm();
            return false;
        }

        function decorateBloomActionRowFormValuesForDraft(values = {}, context = bloomActionRowFormContext, index = 0, item = null, previousDraft = null) {
            const safeContext = context || {};
            const draft = previousDraft && typeof previousDraft === 'object'
                ? previousDraft
                : getBloomActionRowFormDraft(safeContext, index);
            const decorated = { ...(draft || {}), ...(values || {}) };
            if (safeContext.action !== 'ncr') return decorated;
            const baseLocationNote = Object.prototype.hasOwnProperty.call(draft || {}, 'locationnoteBase')
                ? String(draft.locationnoteBase || '').trim()
                : getBloomActionRowBaseLocationNote(item);
            const autoLine = buildBloomActionNcrLocationNoteLine(decorated.releaseQty, decorated.ptravailable, safeContext.timestampIso || '');
            const autoValue = buildBloomActionNcrLocationNote(baseLocationNote, decorated.releaseQty, decorated.ptravailable, safeContext.timestampIso || '');
            const previousAutoValue = String(draft && draft.locationnoteAutoValue ? draft.locationnoteAutoValue : autoValue);
            const currentNote = String(decorated.locationnote == null ? '' : decorated.locationnote).trim();
            const userEdited = !!(draft && draft.locationnoteEdited)
                || (currentNote && normalizeBloomActionLocationNote(currentNote) !== normalizeBloomActionLocationNote(previousAutoValue));
            decorated.locationnoteBase = baseLocationNote;
            decorated.locationnoteAutoLine = autoLine;
            decorated.locationnoteAutoValue = autoValue;
            decorated.locationnoteEdited = userEdited;
            if (!userEdited) decorated.locationnote = autoValue;
            return decorated;
        }

        function handleBloomActionRowQtyInput(index = 0) {
            const context = bloomActionRowFormContext || {};
            if (context.action !== 'ncr') return false;
            const rows = Array.isArray(context.rows) ? context.rows.filter(Boolean) : [];
            const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0;
            const item = rows[safeIndex] || null;
            ensureBloomActionRowFormDrafts(context);
            const previousDraft = getBloomActionRowFormDraft(context, safeIndex);
            const values = getBloomActionRowFormValues(safeIndex);
            const noteEl = getBloomActionRowFormField(safeIndex, 'locationnote');
            const decorated = decorateBloomActionRowFormValuesForDraft(values, context, safeIndex, item, previousDraft);
            if (noteEl && !decorated.locationnoteEdited) noteEl.value = decorated.locationnote || '';
            context.valuesByIndex[safeIndex] = decorated;
            return false;
        }

        function handleBloomActionMoveSeasonChange(index = 0, requestedAction = '') {
            const context = bloomActionRowFormContext || {};
            const action = requestedAction || context.action;
            if (action !== 'move_up' && action !== 'move_down') return false;
            const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0;
            ensureBloomActionRowFormDrafts(context);
            const values = getBloomActionRowFormValues(safeIndex);
            const rawSeason = action === 'move_up' ? values.moveUpSeason : values.moveDownSeason;
            const season = normalizeBloomActionMoveSeason(rawSeason);
            if (action === 'move_up') values.moveUpSeason = season;
            if (action === 'move_down') values.moveDownSeason = season;
            values.destinationSeason = season;
            values.lotcode = getBloomActionMoveLotCode(season);
            const lotEl = getBloomActionRowFormField(safeIndex, 'lotcode');
            if (lotEl) lotEl.value = values.lotcode;
            context.valuesByIndex[safeIndex] = decorateBloomActionRowFormValuesForDraft(values, context, safeIndex, (context.rows || [])[safeIndex] || null, getBloomActionRowFormDraft(context, safeIndex));
            return false;
        }

        function handleBloomActionMoveDownSeasonChange(index = 0) {
            return handleBloomActionMoveSeasonChange(index, 'move_down');
        }

        function handleBloomActionHoldStopReasonInput(input = null) {
            if (!input) return true;
            const lower = String(input.value == null ? '' : input.value).toLowerCase();
            if (input.value !== lower) input.value = lower;
            return true;
        }

        function handleBloomActionRowLocationNoteInput(index = 0) {
            const context = bloomActionRowFormContext || {};
            const rows = Array.isArray(context.rows) ? context.rows.filter(Boolean) : [];
            const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0;
            const item = rows[safeIndex] || null;
            ensureBloomActionRowFormDrafts(context);
            const previousDraft = getBloomActionRowFormDraft(context, safeIndex);
            const values = getBloomActionRowFormValues(safeIndex);
            const decorated = decorateBloomActionRowFormValuesForDraft(values, context, safeIndex, item, previousDraft);
            decorated.locationnote = values.locationnote;
            decorated.locationnoteEdited = true;
            context.valuesByIndex[safeIndex] = decorated;
            return false;
        }

        function persistCurrentBloomActionRowFormDraft(context = bloomActionRowFormContext) {
            const safeContext = context || {};
            const rows = Array.isArray(safeContext.rows) ? safeContext.rows.filter(Boolean) : [];
            if (!rows.length) return null;
            ensureBloomActionRowFormDrafts(safeContext);
            const currentIndex = getBloomActionRowFormCurrentIndex(safeContext);
            const item = rows[currentIndex] || null;
            const previousDraft = getBloomActionRowFormDraft(safeContext, currentIndex);
            const values = decorateBloomActionRowFormValuesForDraft(getBloomActionRowFormValues(currentIndex), safeContext, currentIndex, item, previousDraft);
            values.originalHoldStop = getBloomActionRowCurrentHoldStop(item);
            safeContext.valuesByIndex[currentIndex] = values;
            return values;
        }

        function getBloomActionRowFormValidationError(values = {}, index = 0, context = {}) {
            const ptrAvailableNumber = parseAppNumber(values.ptravailable);
            if (values.ptravailable === '' || ptrAvailableNumber === null) {
                return {
                    title: 'PTRAVAILABLE Required',
                    message: `Enter a valid PTRAVAILABLE for row ${index + 1}.`,
                    field: 'ptravailable'
                };
            }
            if (context.action === 'ncr') {
                const releaseQtyNumber = parseAppNumber(values.releaseQty);
                if (values.releaseQty === '' || releaseQtyNumber === null || releaseQtyNumber < 0) {
                    return {
                        title: 'Release QTY Required',
                        message: `Enter a valid Release QTY for row ${index + 1}.`,
                        field: 'release_qty'
                    };
                }
            }
            if (context.action === 'move_up') {
                const moveUpQtyNumber = parseAppNumber(values.moveUpQty);
                if (values.moveUpQty === '' || moveUpQtyNumber === null || moveUpQtyNumber < 0) {
                    return {
                        title: 'Move Up Required',
                        message: `Enter a valid Move Up amount for row ${index + 1}.`,
                        field: 'move_up_qty'
                    };
                }
                const selectedMoveUpSeason = normalizeAppCurrentSeasonCode(values.moveUpSeason);
                if (!getBloomActionMoveSeasonOptions().includes(selectedMoveUpSeason)) {
                    return {
                        title: 'Move Up Season',
                        message: `Select a destination season for row ${index + 1}.`,
                        field: 'move_up_season'
                    };
                }
            }
            if (context.action === 'move_down') {
                const moveDownQtyNumber = parseAppNumber(values.moveDownQty);
                if (values.moveDownQty !== '' && (moveDownQtyNumber === null || moveDownQtyNumber < 0)) {
                    return {
                        title: 'Move Down QTY',
                        message: `Enter a valid Move Down QTY for row ${index + 1}, or leave it blank.`,
                        field: 'move_down_qty'
                    };
                }
                const selectedMoveDownSeason = normalizeAppCurrentSeasonCode(values.moveDownSeason);
                if (!getBloomActionMoveDownSeasonOptions().includes(selectedMoveDownSeason)) {
                    return {
                        title: 'Move Down Season',
                        message: `Select a destination season for row ${index + 1}.`,
                        field: 'move_down_season'
                    };
                }
            }
            if (context.action === 'priority_change') {
                const requestedPriority = normalizeArgosInventoryTransactionPriorityValue(values.priority);
                if (requestedPriority === null || !requestedPriority) {
                    return {
                        title: 'Priority Required',
                        message: `Enter the requested priority for row ${index + 1}.`,
                        field: 'priority'
                    };
                }
            }
            if ((context.action === 'hold' || context.action === 'stop_ship') && !values.holdstopcode) {
                return {
                    title: 'Holdstopcode Required',
                    message: `Enter a holdstopcode for row ${index + 1}.`,
                    field: 'holdstopcode'
                };
            }
            return null;
        }

        function showBloomActionRowFormValidationError(error = null, index = 0) {
            if (!error) return;
            showToast(error.title || 'Check Row', error.message || `Check row ${index + 1}.`, true);
            const field = error.field ? getBloomActionRowFormField(index, error.field) : null;
            if (field) {
                setTimeout(() => {
                    try { field.focus({ preventScroll: true }); } catch (err) { field.focus(); }
                }, 30);
            }
        }

        function handleBloomActionRowFormBack() {
            if (bloomActionRowFormSubmitting) return false;
            const context = bloomActionRowFormContext || {};
            const rows = Array.isArray(context.rows) ? context.rows.filter(Boolean) : [];
            if (!rows.length) return closeBloomActionRowFormModal();
            const currentIndex = getBloomActionRowFormCurrentIndex(context);
            if (currentIndex <= 0) return closeBloomActionRowFormModal();
            persistCurrentBloomActionRowFormDraft(context);
            context.currentIndex = currentIndex - 1;
            syncBloomActionRowFormModalUi();
            return false;
        }

        function buildBloomActionRowFormPayload(values = {}, context = {}) {
            const timestamp = String(context.timestampIso || new Date().toISOString()).trim();
            const ptrAvailableNumber = parseAppNumber(values.ptravailable);
            const releaseQtyNumber = parseAppNumber(values.releaseQty);
            const moveUpQtyNumber = parseAppNumber(values.moveUpQty);
            const moveDownQtyNumber = parseAppNumber(values.moveDownQty);
            const ptrOnHandNumber = parseAppNumber(values.ptronhand);
            const timestampLabel = String(context.timestampLabel || '').trim();
            const normalizeTimestampValue = (value) => {
                const raw = String(value == null ? '' : value).trim();
                if (!raw || (timestampLabel && raw === timestampLabel)) return timestamp;
                return raw;
            };
            const payload = {
                ptravailable: ptrAvailableNumber !== null ? Math.floor(ptrAvailableNumber) : String(values.ptravailable || '').trim(),
                holdstopcode: normalizeBloomActionHoldStopCodeChoice(values.holdstopcode) || null,
                holdstopreason: normalizeBloomActionHoldStopReasonValue(values.holdstopreason) || null,
                lotcode: values.lotcode || null,
                locationcode: values.locationcode || null,
                source: values.source || null,
                ptronhand: ptrOnHandNumber !== null ? Math.floor(ptrOnHandNumber) : String(values.ptronhand || '').trim(),
                ptrreviewed: values.ptrreviewed || null,
                locationnote: values.locationnote || null,
                locationnotedate: normalizeTimestampValue(values.locationnoteDate),
                locationptn1: values.locationptn1 || null,
                priority: values.priority || null,
                prisetby: String(firstNonEmptyValue(values.priBy, currentUser, currentUserDisplay, '') || '').trim() || null,
                priupdated: normalizeTimestampValue(values.priorityUpdate),
                evaldate: normalizeTimestampValue(values.evaldate)
            };
            if (context.action === 'ncr') {
                payload.loc_match_qty = releaseQtyNumber !== null ? Math.max(0, Math.floor(releaseQtyNumber)) : String(values.releaseQty || '').trim();
            }
            if (context.action === 'move_up') {
                payload.lotcode = getBloomActionMoveLotCode(values.moveUpSeason || values.destinationSeason || '');
                payload.loc_match_qty = moveUpQtyNumber !== null ? Math.max(0, Math.floor(moveUpQtyNumber)) : String(values.moveUpQty || '').trim();
            }
            if (context.action === 'move_down') {
                payload.lotcode = getBloomActionMoveDownLotCode(values.moveDownSeason || values.destinationSeason || '');
                if (values.moveDownQty !== '') {
                    payload.loc_match_qty = moveDownQtyNumber !== null ? Math.max(0, Math.floor(moveDownQtyNumber)) : String(values.moveDownQty || '').trim();
                }
            }
            if (context.action === 'take_off_hold' || context.action === 'off_stop_ship') {
                payload.holdstopcode = null;
                payload.holdstopreason = null;
            }
            return payload;
        }

        async function patchBloomActionRowFormRow(item = null, payload = {}) {
            const uid = getNcrSourceUniqueId(item);
            if (!uid) throw new Error('Selected row is missing a unique id.');
            const optionalColumnOrder = ['evaldate', 'prisetby', 'priupdated', 'locationnotedate', 'loc_match_qty', 'ptravailable', 'lotcode', 'locationcode', 'source', 'ptronhand', 'ptrreviewed', 'holdstopreason', 'locationptn1'];
            let workingPayload = { ...(payload || {}) };
            let lastError = null;
            for (let attempt = 0; attempt <= optionalColumnOrder.length; attempt += 1) {
                try {
                    await runDetailWriteWithRetry('ph_master_inventory', 'PATCH', workingPayload, `unique_id=eq.${encodeURIComponent(uid)}`, {
                        retries: 1,
                        retryDelayMs: 250,
                        idempotencyKey: `bloom-master:${uid}`,
                        timeoutMs: SUPABASE_WRITE_TIMEOUT_MS
                    });
                    return workingPayload;
                } catch (error) {
                    lastError = error;
                    const message = String(error && error.message ? error.message : error || '').toLowerCase();
                    const missingKey = optionalColumnOrder.find((key) => Object.prototype.hasOwnProperty.call(workingPayload, key) && message.includes(key));
                    const fallbackKey = message.includes('column') ? optionalColumnOrder.find((key) => Object.prototype.hasOwnProperty.call(workingPayload, key)) : '';
                    const removeKey = missingKey || fallbackKey;
                    if (!removeKey) throw error;
                    delete workingPayload[removeKey];
                }
            }
            throw lastError || new Error('Could not update the selected row.');
        }

        function buildBloomActionRowFormRowOptions(item = null, payload = {}, values = {}, context = {}) {
            const formAction = String(context && context.action || '').trim();
            const action = formAction === 'move_up'
                ? 'move-up'
                : ((formAction === 'take_off_hold' || formAction === 'off_stop_ship') ? 'hold-release' : 'new-crop');
            const qtyValue = action === 'move-up'
                ? String(firstNonEmptyValue(values.moveUpQty, payload.loc_match_qty, '') || '').trim()
                : (action === 'new-crop' ? payload.loc_match_qty : '');
            const moveDownQty = String(firstNonEmptyValue(values.moveDownQty, payload.loc_match_qty, '') || '').trim();
            const moveUpSeason = formAction === 'move_up' ? normalizeBloomActionMoveSeason(values.moveUpSeason || values.destinationSeason || '') : '';
            const moveDownSeason = formAction === 'move_down' ? normalizeBloomActionMoveDownSeason(values.moveDownSeason || values.destinationSeason || '') : '';
            const destinationSeason = formAction === 'move_up'
                ? moveUpSeason
                : (formAction === 'move_down' ? moveDownSeason : String(firstNonEmptyValue(values.destinationSeason, '') || '').trim());
            const originalHoldStopCode = String(firstNonEmptyValue(
                getBloomActionRowCurrentHoldStopFromSource(item),
                values.originalHoldStop,
                getBloomActionRowCurrentHoldStop(item),
                ''
            ) || '').trim();
            const originalHoldStopReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(
                getBloomActionRowCurrentHoldStopReasonFromSource(item),
                values.holdstopreason,
                payload.holdstopreason,
                getBloomActionRowCurrentHoldStopReason(item),
                ''
            ));
            const screenValues = {
                actionType: action,
                approvalType: action,
                ptravailable: payload.ptravailable == null ? '' : payload.ptravailable,
                releaseQty: action === 'new-crop' ? (payload.loc_match_qty == null ? '' : payload.loc_match_qty) : '',
                moveUpQty: action === 'move-up' ? qtyValue : '',
                moveUpSeason,
                moveDownQty,
                moveDownSeason,
                destinationSeason,
                destinationLotcode: firstNonEmptyValue(values.lotcode, payload.lotcode, getBloomActionRowReadonlyValue(item, 'lotcode'), ''),
                holdstopcode: normalizeBloomActionHoldStopCodeChoice(payload.holdstopcode),
                holdstopreason: originalHoldStopReason,
                originalHoldStopCode,
                original_holdstopcode: originalHoldStopCode,
                originalHoldStopReason,
                original_holdstopreason: originalHoldStopReason,
                priority: payload.priority || '',
                priBy: firstNonEmptyValue(values.priBy, payload.prisetby, ''),
                lotcode: firstNonEmptyValue(values.lotcode, payload.lotcode, getBloomActionRowReadonlyValue(item, 'lotcode'), ''),
                locationcode: firstNonEmptyValue(values.locationcode, payload.locationcode, getBloomActionRowReadonlyValue(item, 'locationcode'), ''),
                source: firstNonEmptyValue(values.source, payload.source, getBloomActionRowReadonlyValue(item, 'source'), ''),
                sourcecode: firstNonEmptyValue(values.source, payload.source, getBloomActionRowReadonlyValue(item, 'source'), ''),
                ptronhand: firstNonEmptyValue(values.ptronhand, payload.ptronhand, getBloomActionRowReadonlyValue(item, 'ptronhand'), ''),
                ptrreviewed: firstNonEmptyValue(values.ptrreviewed, payload.ptrreviewed, getBloomActionRowReadonlyValue(item, 'ptrreviewed'), ''),
                evaldate: firstNonEmptyValue(values.evaldate, payload.evaldate, ''),
                priorityUpdate: firstNonEmptyValue(values.priorityUpdate, payload.priupdated, ''),
                locationnoteDate: firstNonEmptyValue(values.locationnoteDate, payload.locationnotedate, ''),
                locationnote: payload.locationnote || '',
                note: (formAction === 'note' || formAction === 'recount') ? (payload.locationnote || '') : '',
                locationptn1: firstNonEmptyValue(values.locationptn1, payload.locationptn1, getBloomActionRowReadonlyValue(item, 'locationptn1'), '')
            };
            const recommendationMeta = normalizeApprovalRecommendationMeta({
                type: action,
                suggestedQty: qtyValue,
                calculatedQty: qtyValue,
                baseQty: getApprovalBaseQtyFromItem(item),
                percent: firstNonEmptyValue(item && item.MATCH, item && item.match, ''),
                source: 'bloom-action-row-form'
            }, { type: action, suggestedQty: qtyValue });
            return {
                approvalType: action,
                type: action,
                recommendationMeta,
                ncrQty: qtyValue,
                moveUpQty: action === 'move-up' ? qtyValue : undefined,
                moveUpSeason: moveUpSeason || undefined,
                moveDownSeason: formAction === 'move_down' ? moveDownSeason : undefined,
                destinationSeason: destinationSeason || undefined,
                removeHoldStop: !String(payload.holdstopcode || '').trim() && hasBlockingHoldStopCodeForAv(values.originalHoldStop || ''),
                holdStopCode: originalHoldStopCode,
                holdStopReason: originalHoldStopReason,
                originalHoldStopCode,
                original_holdstopcode: originalHoldStopCode,
                originalHoldStopReason,
                original_holdstopreason: originalHoldStopReason,
                priorityOne: String(payload.priority || '').trim() === '1',
                screenValues
            };
        }

        function applyBloomActionRowFormPayloadToLocalRow(item = null, payload = {}, values = {}, context = {}) {
            if (!item || !payload) return item;
            applyMasterSyncPayloadToLocalRow(item, payload);
            const assign = (upper, lower, value) => {
                item[upper] = value == null ? '' : value;
                item[lower] = value == null ? '' : value;
            };
            if (Object.prototype.hasOwnProperty.call(payload, 'locationnote')) assign('LOCATIONNOTE', 'locationnote', payload.locationnote || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'locationnotedate')) assign('LOCATIONNOTEDATE', 'locationnotedate', payload.locationnotedate || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'prisetby')) assign('PRISETBY', 'prisetby', payload.prisetby || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'priupdated')) assign('PRIUPDATED', 'priupdated', payload.priupdated || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'evaldate')) assign('EVALDATE', 'evaldate', payload.evaldate || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'ptravailable')) assign('PTRAVAILABLE', 'ptravailable', payload.ptravailable == null ? '' : payload.ptravailable);
            if (Object.prototype.hasOwnProperty.call(payload, 'holdstopcode')) assign('HOLDSTOPCODE', 'holdstopcode', payload.holdstopcode || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'holdstopreason')) assign('HOLDSTOPREASON', 'holdstopreason', payload.holdstopreason || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'lotcode')) assign('LOTCODE', 'lotcode', payload.lotcode || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'locationcode')) assign('LOCATIONCODE', 'locationcode', payload.locationcode || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'source')) assign('SOURCE', 'source', payload.source || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'ptronhand')) assign('PTRONHAND', 'ptronhand', payload.ptronhand == null ? '' : payload.ptronhand);
            if (Object.prototype.hasOwnProperty.call(payload, 'ptrreviewed')) assign('PTRREVIEWED', 'ptrreviewed', payload.ptrreviewed || '');
            if (Object.prototype.hasOwnProperty.call(payload, 'locationptn1')) assign('LOCATIONPTN1', 'locationptn1', payload.locationptn1 || '');
            if (context.action === 'ncr') {
                const rowOptions = buildBloomActionRowFormRowOptions(item, payload, values, context);
                applyGroupedBloomNcrRowOptionsToItem(item, rowOptions);
            }
            if (context.action === 'move_up') {
                const moveUpQty = String(firstNonEmptyValue(values.moveUpQty, payload.loc_match_qty, payload.ptravailable, '') || '').trim();
                item.BLOOM_ACTION_MOVE_UP_QTY = moveUpQty;
                item.bloom_action_move_up_qty = moveUpQty;
                const rowOptions = buildBloomActionRowFormRowOptions(item, payload, values, context);
                applyGroupedBloomNcrRowOptionsToItem(item, rowOptions);
            }
            syncRowDataAcrossViews(item);
            invalidateResolvedViewStateCaches();
            ['drive', 'av', 'request', 'reports', 'tasks', 'managers', 'review', 'move-up'].forEach((viewId) => {
                try { markViewDirty(viewId); } catch (err) { globalThis.reportHandledRuntimeIssue?.("applyBloomActionRowFormPayloadToLocalRow", 'HANDLED_OPERATION_FAILURE'); }
            });
            persistCurrentCache(false, 'bloom-action-row-form');
            return item;
        }

        async function persistBloomActionRowFormRows(context = bloomActionRowFormContext) {
            const safeContext = context || {};
            const rows = Array.isArray(safeContext.rows) ? safeContext.rows.filter(Boolean) : [];
            const rowOptionsByUid = new Map();
            persistCurrentBloomActionRowFormDraft(safeContext);
            ensureBloomActionRowFormDrafts(safeContext);
            for (let index = 0; index < rows.length; index += 1) {
                const item = rows[index];
                const values = getBloomActionRowFormDraft(safeContext, index);
                values.originalHoldStop = getBloomActionRowCurrentHoldStop(item);
                const validationError = getBloomActionRowFormValidationError(values, index, safeContext);
                if (validationError) {
                    safeContext.currentIndex = index;
                    syncBloomActionRowFormModalUi();
                    showBloomActionRowFormValidationError(validationError, index);
                    return null;
                }
                const fullPayload = buildBloomActionRowFormPayload(values, safeContext);
                if (safeContext.action === 'ncr' || safeContext.emailOnly === true) {
                    const rowOptions = buildBloomActionRowFormRowOptions(item, fullPayload, values, safeContext);
                    if (rowOptions) rowOptionsByUid.set(getGroupedBloomNcrRowKey(item, index), rowOptions);
                    continue;
                }
                await patchBloomActionRowFormRow(item, fullPayload);
                applyBloomActionRowFormPayloadToLocalRow(item, fullPayload, values, safeContext);
                if (safeContext.action === 'ncr' || safeContext.action === 'move_up') {
                    const rowOptions = item && item.GROUPED_BLOOM_NCR_ROW_OPTIONS ? item.GROUPED_BLOOM_NCR_ROW_OPTIONS : null;
                    if (rowOptions) rowOptionsByUid.set(getGroupedBloomNcrRowKey(item, index), rowOptions);
                }
            }
            return { rows, rowOptionsByUid };
        }

        async function submitBloomActionNcrRowsToApproval(rows = [], rowOptionsByUid = null, options = {}) {
            const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
            const safeOptions = options || {};
            if (!safeRows.length) {
                showToast('NCR Empty', 'No NCR rows were selected.', true);
                return false;
            }
            const requester = safeOptions.requester || getCurrentNcrApprovalRequesterEntry() || {
                username: String(currentUser || '').trim(),
                display: String(firstNonEmptyValue(currentUserDisplay, currentUser, '') || '').trim(),
                email: resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            };
            const approvalMessage = String(firstNonEmptyValue(safeOptions.approvalMessage, safeOptions.reason, '') || '').trim();
            let submittedCount = 0;
            for (let index = 0; index < safeRows.length; index += 1) {
                const item = safeRows[index];
                const rowOptions = rowOptionsByUid ? getGroupedBloomNcrRowOption(rowOptionsByUid, item, index) : null;
                if (rowOptions) applyGroupedBloomNcrRowOptionsToItem(item, rowOptions);
                await submitNcrApprovalToDylan(item, 'new-crop', {
                    requester,
                    requestedByEmail: firstNonEmptyValue(safeOptions.requestedByEmail, requester && requester.email, resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')),
                    requestedByUsername: firstNonEmptyValue(safeOptions.requestedByUsername, requester && requester.username, currentUser, ''),
                    requestedByDisplay: firstNonEmptyValue(safeOptions.requestedByDisplay, requester && requester.display, currentUserDisplay, ''),
                    photoUrls: safeOptions.photoUrls || getNcrApprovalPhotoUrls(item) || [],
                    allowMissingPhoto: safeOptions.allowMissingPhoto !== false,
                    approvalMessage,
                    rowOptions,
                    recommendationMeta: rowOptions && rowOptions.recommendationMeta ? rowOptions.recommendationMeta : null,
                    skipEmail: true
                });
                clearNcrDraft(item);
                submittedCount += 1;
            }
            managerReviewInventoryDirty = true;
            moveUpInventoryDirty = true;
            markViewDirty('review');
            markViewDirty('move-up');
            markViewDirty('tasks');
            markViewDirty('managers');
            taskScopedQueueItemsCache.clear();
            taskHotStateCache.clear();
            taskResolvedStateCache = null;
            if (safeOptions.clearSelection !== false) clearSelection();
            showToast('NCR Rows sent', `${submittedCount} NCR row${submittedCount === 1 ? '' : 's'} sent to Managers > NCR Approval.`);
            return true;
        }

        async function submitBloomActionHoldReleaseRowsToApproval(rows = [], rowOptionsByUid = null, options = {}) {
            const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
            const safeOptions = options || {};
            if (!safeRows.length) {
                showToast('Off Hold Empty', 'No Off Hold rows were selected.', true);
                return 0;
            }
            const requester = safeOptions.requester || getCurrentNcrApprovalRequesterEntry() || {
                username: String(currentUser || '').trim(),
                display: String(firstNonEmptyValue(currentUserDisplay, currentUser, '') || '').trim(),
                email: resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            };
            const approvalMessage = String(firstNonEmptyValue(safeOptions.approvalMessage, safeOptions.reason, '') || '').trim();
            let submittedCount = 0;
            for (let index = 0; index < safeRows.length; index += 1) {
                const item = safeRows[index];
                const rowOptions = rowOptionsByUid ? getGroupedBloomNcrRowOption(rowOptionsByUid, item, index) : null;
                if (rowOptions) applyGroupedBloomNcrRowOptionsToItem(item, rowOptions);
                await submitNcrApprovalToDylan(item, 'hold-release', {
                    requester,
                    requestedByEmail: firstNonEmptyValue(safeOptions.requestedByEmail, requester && requester.email, resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')),
                    requestedByUsername: firstNonEmptyValue(safeOptions.requestedByUsername, requester && requester.username, currentUser, ''),
                    requestedByDisplay: firstNonEmptyValue(safeOptions.requestedByDisplay, requester && requester.display, currentUserDisplay, currentUser, ''),
                    photoUrls: safeOptions.photoUrls || getNcrApprovalPhotoUrls(item) || [],
                    allowMissingPhoto: safeOptions.allowMissingPhoto !== false,
                    allowMissingAvNote: true,
                    approvalMessage,
                    rowOptions,
                    recommendationMeta: rowOptions && rowOptions.recommendationMeta ? rowOptions.recommendationMeta : null,
                    skipEmail: true,
                    dylanOnly: true
                });
                clearNcrDraft(item);
                submittedCount += 1;
            }
            managerReviewInventoryDirty = true;
            moveUpInventoryDirty = true;
            markViewDirty('review');
            markViewDirty('move-up');
            markViewDirty('tasks');
            markViewDirty('managers');
            clearNcrApprovalTaskViewCaches();
            scheduleNcrApprovalTaskRowsRefresh(getNcrApprovalTaskViewForType('hold-release'), { force: true, bypassThrottle: true, quiet: true });
            if (safeOptions.clearSelection !== false) clearSelection();
            if (safeOptions.showToast !== false) {
                showToast('Off Hold Rows sent', `${submittedCount} Off Hold row${submittedCount === 1 ? '' : 's'} sent to Managers > Off Hold Approval.`);
            }
            return submittedCount;
        }

        function getPaperNcrDisplayValue(value = '', fallback = '-') {
            const raw = String(value === null || typeof value === 'undefined' ? '' : value).trim();
            return raw || fallback;
        }

        function normalizePaperNcrSalesNoteValue(value = '') {
            const raw = String(value === null || typeof value === 'undefined' ? '' : value).trim();
            if (!raw || raw === '-') return '';
            return raw.toUpperCase();
        }

        function normalizePaperNcrCompareValue(value = '') {
            return String(value === null || typeof value === 'undefined' ? '' : value).replace(/\s+/g, ' ').trim().toUpperCase();
        }

        function isPaperNcrValueChanged(nextValue = '', originalValue = '') {
            return normalizePaperNcrCompareValue(nextValue) !== normalizePaperNcrCompareValue(originalValue);
        }

        function normalizePaperNcrChangedFieldDisplayValue(value = '') {
            const raw = String(value === null || typeof value === 'undefined' ? '' : value).trim();
            if (!raw || ['BLANK', 'NULL', '-'].includes(raw.toUpperCase())) return '';
            return raw;
        }

        function getPaperNcrChangedFieldValue(row = {}, keys = [], fallback = '') {
            const safeRow = row && typeof row === 'object' ? row : {};
            for (const key of (Array.isArray(keys) ? keys : [])) {
                if (Object.prototype.hasOwnProperty.call(safeRow, key)) {
                    const value = safeRow[key];
                    if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') return value;
                }
            }
            return fallback == null ? '' : fallback;
        }

        function buildPaperNcrChangedFieldRows(row = {}, fallbackRow = {}) {
            const safeRow = row && typeof row === 'object' ? row : {};
            const fallback = fallbackRow && typeof fallbackRow === 'object' ? fallbackRow : {};
            const actionType = normalizePaperNcrRowAction(firstNonEmptyValue(safeRow.actionType, safeRow.NCR_ACTION_TYPE, safeRow.action_type, 'ncr'));
            const clearsHoldStop = actionType === 'off-hold' || actionType === 'off-stop';
            const rows = [];
            const add = (label, currentValue, requestedValue, options = {}) => {
                const current = normalizePaperNcrChangedFieldDisplayValue(currentValue);
                const requested = normalizePaperNcrChangedFieldDisplayValue(requestedValue);
                if (!requested && !options.allowBlankRequested) return;
                if (normalizePaperNcrCompareValue(current) === normalizePaperNcrCompareValue(requested)) return;
                rows.push({
                    label,
                    current: current || 'Blank',
                    requested: requested || 'Blank'
                });
            };
            add('PRIORITY',
                getPaperNcrChangedFieldValue(safeRow, ['originalPriority', 'original_priority', 'ORIGINAL_PRIORITY'], getPaperNcrChangedFieldValue(fallback, ['priority', 'PRIORITY'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['priority', 'PRIORITY', 'NCR_PRIORITY', 'requestedPriority', 'REQUESTED_PRIORITY'], '')
            );
            add('HOLDSTOPCODE',
                getPaperNcrChangedFieldValue(safeRow, ['originalHoldStopCode', 'original_holdstopcode', 'ORIGINAL_HOLDSTOPCODE'], getPaperNcrChangedFieldValue(fallback, ['holdStopCode', 'holdstopcode', 'HOLDSTOPCODE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['holdStopCode', 'holdstopcode', 'HOLDSTOPCODE', 'NCR_HOLDSTOPCODE'], ''),
                { allowBlankRequested: clearsHoldStop }
            );
            add('HOLDSTOPREASON',
                getPaperNcrChangedFieldValue(safeRow, ['originalHoldStopReason', 'original_holdstopreason', 'ORIGINAL_HOLDSTOPREASON'], getPaperNcrChangedFieldValue(fallback, ['holdStopReason', 'holdstopreason', 'HOLDSTOPREASON'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['holdStopReason', 'holdstopreason', 'HOLDSTOPREASON', 'NCR_HOLDSTOPREASON'], ''),
                { allowBlankRequested: clearsHoldStop }
            );
            add('LOTCODE',
                getPaperNcrChangedFieldValue(safeRow, ['originalLotcode', 'original_lotcode', 'ORIGINAL_LOTCODE'], getPaperNcrChangedFieldValue(fallback, ['lotcode', 'LOTCODE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['lotcode', 'LOTCODE'], getPaperNcrChangedFieldValue(fallback, ['lotcode', 'LOTCODE'], ''))
            );
            add('LOCATIONCODE',
                getPaperNcrChangedFieldValue(safeRow, ['originalLocationcode', 'original_locationcode', 'ORIGINAL_LOCATIONCODE'], getPaperNcrChangedFieldValue(fallback, ['locationcode', 'LOCATIONCODE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['locationcode', 'LOCATIONCODE'], getPaperNcrChangedFieldValue(fallback, ['locationcode', 'LOCATIONCODE'], ''))
            );
            add('SOURCE',
                getPaperNcrChangedFieldValue(safeRow, ['originalSource', 'original_source', 'ORIGINAL_SOURCE'], getPaperNcrChangedFieldValue(fallback, ['source', 'SOURCE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['source', 'SOURCE'], getPaperNcrChangedFieldValue(fallback, ['source', 'SOURCE'], ''))
            );
            add('PTRONHAND',
                getPaperNcrChangedFieldValue(safeRow, ['originalPtronhand', 'original_ptronhand', 'ORIGINAL_PTRONHAND'], getPaperNcrChangedFieldValue(fallback, ['ptronhand', 'PTRONHAND'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['ptronhand', 'PTRONHAND'], getPaperNcrChangedFieldValue(fallback, ['ptronhand', 'PTRONHAND'], ''))
            );
            add('PTRREVIEWED',
                getPaperNcrChangedFieldValue(safeRow, ['originalPtrreviewed', 'original_ptrreviewed', 'ORIGINAL_PTRREVIEWED'], getPaperNcrChangedFieldValue(fallback, ['ptrreviewed', 'PTRREVIEWED'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['ptrreviewed', 'PTRREVIEWED'], getPaperNcrChangedFieldValue(fallback, ['ptrreviewed', 'PTRREVIEWED'], ''))
            );
            add('PTRAVAILABLE',
                getPaperNcrChangedFieldValue(safeRow, ['originalPtravailable', 'original_ptravailable', 'ORIGINAL_PTRAVAILABLE'], getPaperNcrChangedFieldValue(fallback, ['ptravailable', 'PTRAVAILABLE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['ptravailable', 'PTRAVAILABLE'], getPaperNcrChangedFieldValue(fallback, ['ptravailable', 'PTRAVAILABLE'], ''))
            );
            add('EVAL DATE',
                getPaperNcrChangedFieldValue(safeRow, ['originalEvalDate', 'originalEvaldate', 'original_evaldate', 'ORIGINAL_EVALDATE'], getPaperNcrChangedFieldValue(fallback, ['evalDate', 'evaldate', 'EVALDATE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['evalDate', 'evaldate', 'EVALDATE'], getPaperNcrChangedFieldValue(fallback, ['evalDate', 'evaldate', 'EVALDATE'], ''))
            );
            add('PRI BY',
                getPaperNcrChangedFieldValue(safeRow, ['originalPriBy', 'originalPriby', 'original_priby', 'ORIGINAL_PRIBY', 'originalPriSetBy', 'originalPrisetby'], getPaperNcrChangedFieldValue(fallback, ['priBy', 'priby', 'PRISETBY', 'prisetby'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['priBy', 'priby', 'PRISETBY', 'prisetby'], getPaperNcrChangedFieldValue(fallback, ['priBy', 'priby', 'PRISETBY', 'prisetby'], ''))
            );
            add('PRI UPDATE',
                getPaperNcrChangedFieldValue(safeRow, ['originalPriUpdate', 'originalPriupdated', 'original_priupdated', 'ORIGINAL_PRIUPDATED'], getPaperNcrChangedFieldValue(fallback, ['priUpdate', 'priupdated', 'PRIUPDATED'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['priUpdate', 'priupdated', 'PRIUPDATED'], getPaperNcrChangedFieldValue(fallback, ['priUpdate', 'priupdated', 'PRIUPDATED'], ''))
            );
            add('NOTE DATE',
                getPaperNcrChangedFieldValue(safeRow, ['originalLocationNoteDate', 'original_locationnotedate', 'ORIGINAL_LOCATIONNOTEDATE'], getPaperNcrChangedFieldValue(fallback, ['locationnoteDate', 'locationnotedate', 'LOCATIONNOTEDATE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['locationnoteDate', 'locationnotedate', 'LOCATIONNOTEDATE', 'NCR_LOCATIONNOTEDATE'], '')
            );
            add('LOCATIONNOTE',
                getPaperNcrChangedFieldValue(safeRow, ['originalLocationNote', 'original_locationnote', 'ORIGINAL_LOCATIONNOTE'], getPaperNcrChangedFieldValue(fallback, ['locationnote', 'LOCATIONNOTE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['locationnote', 'LOCATIONNOTE', 'NCR_LOCATIONNOTE'], '')
            );
            add('LOCATIONPTN1',
                getPaperNcrChangedFieldValue(safeRow, ['originalLocationPtn1', 'original_locationptn1', 'ORIGINAL_LOCATIONPTN1'], getPaperNcrChangedFieldValue(fallback, ['locationptn1', 'LOCATIONPTN1'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['locationptn1', 'LOCATIONPTN1', 'NCR_LOCATIONPTN1'], '')
            );
            add('SALESNOTE',
                getPaperNcrChangedFieldValue(safeRow, ['originalSalesNote', 'original_salesnote', 'ORIGINAL_SALESNOTE'], getPaperNcrChangedFieldValue(fallback, ['salesNote', 'salesnote', 'SALESNOTE'], '')),
                getPaperNcrChangedFieldValue(safeRow, ['salesNote', 'salesnote', 'SALESNOTE', 'NCR_SALESNOTE'], '')
            );
            return rows;
        }

        function serializePaperNcrChangedFields(rows = []) {
            try {
                return JSON.stringify((Array.isArray(rows) ? rows : []).map((field) => ({
                    label: String(field && field.label || '').trim(),
                    current: String(field && field.current || '').trim(),
                    requested: String(field && field.requested || '').trim()
                })).filter((field) => field.label));
            } catch (error) {
                return '';
            }
        }

        function getPaperNcrQtyDisplay(value = '') {
            const raw = String(value === null || typeof value === 'undefined' ? '' : value).trim();
            return raw && raw !== '-' ? raw : '0';
        }

        function getPaperNcrRowKey(row = null, fallbackIndex = 0) {
            const uid = String(firstNonEmptyValue(row && row.UNIQUE_ID, row && row.unique_id, row && row.uid, '') || '').trim();
            if (uid) return `uid:${uid}`;
            const domId = String(firstNonEmptyValue(row && row.DOM_ID, row && row.dom_id, row && row.domId, '') || '').trim();
            if (domId) return `dom:${domId}`;
            const itemKey = typeof getItemInquiryRowKey === 'function' ? getItemInquiryRowKey(row) : '';
            return itemKey ? `inq:${itemKey}` : `row:${fallbackIndex}`;
        }

        function getPaperNcrSelectedRowKeys(rows = []) {
            const keys = new Set();
            (Array.isArray(rows) ? rows : []).filter(Boolean).forEach((row, index) => {
                const rowKey = getPaperNcrRowKey(row, index);
                const uid = String(firstNonEmptyValue(row && row.UNIQUE_ID, row && row.unique_id, '') || '').trim();
                const domId = String(firstNonEmptyValue(row && row.DOM_ID, row && row.dom_id, '') || '').trim();
                const inquiryKey = typeof getItemInquiryRowKey === 'function' ? getItemInquiryRowKey(row) : '';
                [rowKey, uid ? `uid:${uid}` : '', domId ? `dom:${domId}` : '', inquiryKey ? `inq:${inquiryKey}` : '']
                    .filter(Boolean)
                    .forEach((key) => keys.add(key));
            });
            return keys;
        }

        function formatPaperNcrShortDate(value = new Date()) {
            const date = value instanceof Date ? value : new Date(value);
            const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
            const yy = String(safeDate.getFullYear()).slice(-2);
            return `${safeDate.getMonth() + 1}/${safeDate.getDate()}/${yy}`;
        }

        function formatPaperNcrNoteDateValue(value = new Date()) {
            const date = value instanceof Date ? value : new Date(value);
            if (date instanceof Date && !Number.isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            }
            return String(value || '').trim();
        }

        function buildPaperNcrDefaultNote(snapshot = {}, qty = '', dateValue = new Date(), actionType = 'ncr') {
            const prefix = getPaperNcrRowActionLabel(actionType);
            const ncrQty = getPaperNcrQtyDisplay(qty);
            const totalQty = getPaperNcrQtyDisplay(firstNonEmptyValue(snapshot.ptravailable, snapshot.PTRAVAILABLE, snapshot.ptronhand, snapshot.PTRONHAND, ''));
            const location = getPaperNcrDisplayValue(firstNonEmptyValue(snapshot.locationcode, snapshot.locationCode, snapshot.LOCATIONCODE, ''), '-');
            const lot = getPaperNcrDisplayValue(firstNonEmptyValue(snapshot.lotcode, snapshot.lotCode, snapshot.LOTCODE, ''), '-');
            return `${prefix} ${ncrQty}/${totalQty} loc ${location} lot ${lot} ${formatPaperNcrShortDate(dateValue)}`;
        }

        function buildPaperNcrRecountLine(snapshot = {}, dateValue = new Date()) {
            const onHand = getPaperNcrQtyDisplay(firstNonEmptyValue(snapshot.ptronhand, snapshot.PTRONHAND, ''));
            const location = getPaperNcrDisplayValue(firstNonEmptyValue(snapshot.locationcode, snapshot.locationCode, snapshot.LOCATIONCODE, ''), '-');
            const lot = getPaperNcrDisplayValue(firstNonEmptyValue(snapshot.lotcode, snapshot.lotCode, snapshot.LOTCODE, ''), '-');
            return `RECOUNT loc ${location} lot ${lot}: verify PTRONHAND ${onHand} is accurate ${formatPaperNcrShortDate(dateValue)}`;
        }

        function isPaperNcrAutoNote(value = '') {
            return /^(NCR|Move Up|Move Down|On Hold|Off Hold|On Stop|Off Stop|Send As Note|Location Move|Add To Shear List)\s+\S+\/\S+\s+loc\s+/i.test(String(value || '').trim())
                || /^RECOUNT\s+loc\s+/i.test(String(value || '').trim());
        }

        function getPaperNcrPrimaryQtyForAction(state = {}, actionType = 'ncr') {
            const action = normalizePaperNcrRowAction(actionType);
            if (action === 'move-up') return firstNonEmptyValue(state.moveUpQty, state.ncrQty, '');
            if (action === 'move-down') return firstNonEmptyValue(state.moveDownQty, state.ncrQty, '');
            if (action === 'note' || action === 'recount' || action === 'location-move' || action === 'shear') return '';
            return firstNonEmptyValue(state.ncrQty, '');
        }

        function refreshPaperNcrStateAutoNoteForAction(state = null, snapshot = {}, createdAt = new Date()) {
            if (!state) return state;
            const actionType = normalizePaperNcrRowAction(state.actionType || 'ncr');
            if (actionType === 'note' || actionType === 'recount' || actionType === 'move-up' || actionType === 'location-move' || actionType === 'shear') return state;
            const nextNote = buildPaperNcrDefaultNote(snapshot || {}, getPaperNcrPrimaryQtyForAction(state, actionType), createdAt, actionType);
            const currentLine = String(firstNonEmptyValue(state.ncrNote, '') || '').trim();
            const currentLocationNote = String(firstNonEmptyValue(state.locationnote, '') || '').trim();
            if (!currentLine || isPaperNcrAutoNote(currentLine)) state.ncrNote = nextNote;
            if (!currentLocationNote || currentLocationNote === currentLine || isPaperNcrAutoNote(currentLocationNote)) state.locationnote = nextNote;
            return state;
        }

        function getPaperNcrPackageIdentity(item = null) {
            const reportRow = getGroupedBloomNcrReportRow(item, null, 0);
            return {
                itemCode: String(firstNonEmptyValue(reportRow.itemCode, item && item.ITEMCODE, item && item.itemcode, '') || '').trim(),
                commonName: String(firstNonEmptyValue(reportRow.commonName, item && item.COMMONNAME, item && item.commonname, 'Unknown Item') || 'Unknown Item').trim(),
                contSize: String(firstNonEmptyValue(reportRow.contSize, item && item.CONTSIZE, item && item.contsize, '-') || '-').trim(),
                genus: String(firstNonEmptyValue(reportRow.genus, item && item.GENUS, item && item.genus, '') || '').trim(),
                fieldTagColor: String(firstNonEmptyValue(reportRow.fieldTagColor, item && item.FIELDTAGCOLOR, item && item.fieldtagcolor, '') || '').trim()
            };
        }

        function buildPaperNcrRowSnapshot(row = null, index = 0) {
            const reportRow = getGroupedBloomNcrReportRow(row, null, index);
            const key = getPaperNcrRowKey(row, index);
            return normalizePaperNcrPackageRow({
                rowIndex: index + 1,
                key,
                uid: firstNonEmptyValue(row && row.UNIQUE_ID, row && row.unique_id, ''),
                domId: firstNonEmptyValue(row && row.DOM_ID, row && row.dom_id, ''),
                itemCode: reportRow.itemCode,
                commonName: reportRow.commonName,
                contSize: reportRow.contSize,
                lotcode: firstNonEmptyValue(reportRow.lotcode, reportRow.lotCode, row && row.LOTCODE, row && row.lotcode, ''),
                locationcode: firstNonEmptyValue(reportRow.locationcode, reportRow.locationCode, row && row.LOCATIONCODE, row && row.locationcode, ''),
                source: firstNonEmptyValue(reportRow.source, reportRow.sourcecode, ''),
                desigCust: firstNonEmptyValue(reportRow.desigCust, row && row.DESIGCUST, row && row.desigcust, ''),
                priority: firstNonEmptyValue(reportRow.priority, ''),
                ptronhand: firstNonEmptyValue(reportRow.ptronhand, ''),
                ptrreviewed: firstNonEmptyValue(reportRow.ptrreviewed, ''),
                ptravailable: firstNonEmptyValue(reportRow.ptravailable, ''),
                evaldate: firstNonEmptyValue(reportRow.evaldate, ''),
                priBy: firstNonEmptyValue(reportRow.priBy, ''),
                priorityUpdate: firstNonEmptyValue(reportRow.priorityUpdate, ''),
                locationnoteDate: firstNonEmptyValue(reportRow.locationnoteDate, ''),
                locationnote: firstNonEmptyValue(reportRow.locationnote, ''),
                locationptn1: firstNonEmptyValue(reportRow.locationptn1, ''),
                holdStopCode: firstNonEmptyValue(reportRow.holdStopCode, ''),
                holdStopReason: firstNonEmptyValue(reportRow.holdStopReason, ''),
                salesNote: firstNonEmptyValue(reportRow.salesNote, ''),
                photoLink: mergePhotoCsvList([
                    row && row.ROW_PHOTO_LINK,
                    row && row.SAVED_PHOTO_LINK,
                    row && row.PHOTO_LINK,
                    row && row.PHOTOLINK,
                    row && row.REQ_PHOTO_LINK,
                    row && row.REQUEST_PHOTO_LINK,
                    row && row.DOCK_PHOTO_LINK,
                    row && row.DOCKPHOTO_LINK,
                    reportRow.photoLink,
                    reportRow.ROW_PHOTO_LINK
                ]),
                photoName: mergePhotoCsvList([
                    row && row.ROW_PHOTO_NAME,
                    row && row.SAVED_PHOTO_NAME,
                    row && row.PHOTO_NAME,
                    row && row.PHOTONAME,
                    row && row.REQ_PHOTO_NAME,
                    row && row.REQUEST_PHOTO_NAME,
                    row && row.DOCK_PHOTO_NAME,
                    row && row.DOCKPHOTO_NAME,
                    reportRow.photoName,
                    reportRow.ROW_PHOTO_NAME
                ])
            });
        }

        function getPaperNcrPackageRowsForItem(anchorItem = null) {
            const rows = typeof getItemInquiryRows === 'function' ? getItemInquiryRows(anchorItem) : [];
            return rows && rows.length ? rows : [anchorItem].filter(Boolean);
        }

        function buildPaperNcrRowState(snapshot = {}, sourceRow = null, checked = false, options = {}) {
            const now = options && options.createdAt ? new Date(options.createdAt) : new Date();
            const existingRowOptions = normalizeApprovalRowOptionsMeta(options && options.rowOptions ? options.rowOptions : getApprovalRowOptionsMetaFromItem(sourceRow));
            const packageApprovalType = inferPaperNcrApprovalType(options || null, options && options.approvalType || 'new-crop');
            const rowAction = resolvePaperNcrRowActionForApprovalType(getPaperNcrRowActionFromAppAction(firstNonEmptyValue(
                options && options.action,
                options && options.rowAction,
                existingRowOptions && existingRowOptions.approvalType,
                existingRowOptions && existingRowOptions.type,
                existingRowOptions && existingRowOptions.screenValues && existingRowOptions.screenValues.actionType,
                'ncr'
            )), packageApprovalType);
            const rowOptionsScreenValues = existingRowOptions && existingRowOptions.screenValues && typeof existingRowOptions.screenValues === 'object' ? existingRowOptions.screenValues : {};
            const recommendationQty = firstNonEmptyValue(
                existingRowOptions && existingRowOptions.moveUpQty,
                rowOptionsScreenValues.moveUpQty,
                existingRowOptions && existingRowOptions.recommendationMeta && existingRowOptions.recommendationMeta.suggestedQty,
                existingRowOptions && existingRowOptions.ncrQty,
                rowOptionsScreenValues.releaseQty,
                ''
            );
            const releaseQty = rowAction === 'move-up'
                ? String(firstNonEmptyValue(
                    recommendationQty,
                    sourceRow && sourceRow.BLOOM_ACTION_MOVE_UP_QTY,
                    sourceRow && sourceRow.bloom_action_move_up_qty,
                    ''
                ) || '').trim()
                : String(firstNonEmptyValue(
                    sourceRow && sourceRow.NCR_REQUESTED_QTY,
                    sourceRow && sourceRow.ncr_requested_qty,
                    sourceRow && sourceRow.BLOOM_ACTION_RELEASE_QTY,
                    sourceRow && sourceRow.bloom_action_release_qty,
                    snapshot.ptravailable,
                    getBloomActionRowReleaseQtyDefault(sourceRow),
                    ''
                ) || '').trim();
            const priority = String(firstNonEmptyValue(snapshot.priority, '') || '').trim();
            const holdCode = normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(snapshot.holdStopCode, snapshot.holdstopcode, ''));
            const holdReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(snapshot.holdStopReason, snapshot.holdstopreason, '')).toLowerCase();
            const originalSalesNote = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(snapshot.salesNote, snapshot.SALESNOTE, ''));
            const salesNote = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(
                existingRowOptions && existingRowOptions.salesNote,
                rowOptionsScreenValues.salesNote,
                rowOptionsScreenValues.salesnote,
                originalSalesNote,
                ''
            ));
            const noteDate = formatPaperNcrNoteDateValue(now);
            const requestedNote = (rowAction === 'note' || rowAction === 'recount')
                ? String(firstNonEmptyValue(
                    rowOptionsScreenValues.note,
                    rowOptionsScreenValues.locationnote,
                    rowOptionsScreenValues.message,
                    existingRowOptions && existingRowOptions.note,
                    existingRowOptions && existingRowOptions.locationnote,
                    existingRowOptions && existingRowOptions.message,
                    options && options.reason,
                    options && options.message,
                    ''
                ) || '').trim()
                : '';
            let defaultNote = '';
            if (rowAction === 'note') defaultNote = requestedNote;
            else if (rowAction === 'recount') defaultNote = requestedNote || buildPaperNcrRecountLine(snapshot, now);
            else if (rowAction !== 'move-up') defaultNote = buildPaperNcrDefaultNote(snapshot, releaseQty, now, rowAction);
            const currentLocationNote = String(firstNonEmptyValue(snapshot.locationnote, '') || '').trim();
            return {
                checked: !!checked,
                actionType: rowAction,
                ncrQty: releaseQty,
                moveUpQty: rowAction === 'move-up' ? String(firstNonEmptyValue(existingRowOptions && existingRowOptions.moveUpQty, rowOptionsScreenValues.moveUpQty, recommendationQty, '') || '').trim() : '',
                moveDownQty: rowAction === 'move-down' ? String(firstNonEmptyValue(existingRowOptions && existingRowOptions.moveDownQty, releaseQty, '') || '').trim() : '',
                moveDownSeason: rowAction === 'move-down' ? normalizePaperNcrMoveDownSeason(existingRowOptions && existingRowOptions.moveDownSeason || getPaperNcrDefaultMoveSeason()) : getPaperNcrDefaultMoveSeason(),
                priority: normalizePaperNcrPriorityForAction(priority, rowAction),
                locationnoteDate: (rowAction === 'note' || rowAction === 'recount') ? String(firstNonEmptyValue(snapshot.locationnoteDate, '') || '').trim() : noteDate,
                locationnote: (rowAction === 'note' || rowAction === 'recount' || rowAction === 'move-up') ? currentLocationNote : defaultNote,
                locationptn1: String(firstNonEmptyValue(snapshot.locationptn1, '') || '').trim(),
                holdstopcode: holdCode,
                holdstopreason: holdReason,
                salesNote,
                ncrNote: rowAction === 'move-up' ? '' : defaultNote,
                note: (rowAction === 'note' || rowAction === 'recount') ? requestedNote : '',
                originalPriority: priority,
                originalLocationNoteDate: String(firstNonEmptyValue(snapshot.locationnoteDate, '') || '').trim(),
                originalLocationNote: String(firstNonEmptyValue(snapshot.locationnote, '') || '').trim(),
                originalLocationPtn1: String(firstNonEmptyValue(snapshot.locationptn1, '') || '').trim(),
                originalHoldStopCode: String(firstNonEmptyValue(snapshot.holdStopCode, '') || '').trim(),
                originalHoldStopReason: holdReason,
                originalSalesNote
            };
        }

        function buildPaperNcrPackageDraft(anchorItem = null, selectedRows = [], options = {}) {
            if (!anchorItem) return null;
            const identity = getPaperNcrPackageIdentity(anchorItem);
            if (!identity.itemCode) return null;
            const inquiryRows = getPaperNcrPackageRowsForItem(anchorItem);
            const selectedKeys = getPaperNcrSelectedRowKeys(selectedRows);
            const sourceRowsByKey = new Map();
            (Array.isArray(selectedRows) ? selectedRows : []).filter(Boolean).forEach((row, index) => {
                sourceRowsByKey.set(getPaperNcrRowKey(row, index), row);
                const inquiryKey = typeof getItemInquiryRowKey === 'function' ? getItemInquiryRowKey(row) : '';
                if (inquiryKey) sourceRowsByKey.set(`inq:${inquiryKey}`, row);
            });
            const snapshots = inquiryRows.map((row, index) => buildPaperNcrRowSnapshot(row, index)).filter(Boolean);
            const anchorUid = String(firstNonEmptyValue(anchorItem && anchorItem.UNIQUE_ID, anchorItem && anchorItem.unique_id, '') || '').trim();
            let checkedCount = 0;
            const rowStates = snapshots.map((snapshot, index) => {
                const matched = [snapshot.key, snapshot.uid ? `uid:${snapshot.uid}` : '', snapshot.domId ? `dom:${snapshot.domId}` : '']
                    .some((key) => key && selectedKeys.has(key));
                const sourceRow = sourceRowsByKey.get(snapshot.key) || (snapshot.uid ? sourceRowsByKey.get(`uid:${snapshot.uid}`) : null) || inquiryRows[index] || anchorItem;
                if (matched) checkedCount += 1;
                return buildPaperNcrRowState(snapshot, sourceRow, matched, options);
            });
            if (!checkedCount && rowStates.length) {
                const anchorKey = getPaperNcrRowKey(anchorItem, 0);
                const index = Math.max(0, snapshots.findIndex((snapshot) => snapshot.key === anchorKey || (anchorUid && snapshot.uid === anchorUid)));
                rowStates[index].checked = true;
            }
            return {
                id: `paper-ncr-${identity.itemCode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                itemCode: identity.itemCode,
                commonName: identity.commonName,
                contSize: identity.contSize,
                genus: identity.genus,
                fieldTagColor: identity.fieldTagColor,
                type: inferPaperNcrApprovalTypeFromAction(getPaperNcrRowActionFromAppAction(options && options.action || 'ncr'), options && options.approvalType || 'new-crop'),
                approvalType: inferPaperNcrApprovalTypeFromAction(getPaperNcrRowActionFromAppAction(options && options.action || 'ncr'), options && options.approvalType || 'new-crop'),
                anchorUid,
                anchorItem,
                allRows: snapshots,
                rowStates,
                createdAt: String(firstNonEmptyValue(options && options.createdAt, new Date().toISOString()) || '').trim(),
                createdBy: normalizePushUsername(firstNonEmptyValue(options && options.requestedByUsername, currentUser, currentUserDisplay, '')),
                createdByDisplay: String(firstNonEmptyValue(options && options.requestedByDisplay, currentUserDisplay, currentUser, '') || '').trim(),
                createdByEmail: normalizeRequestEmailAddress(firstNonEmptyValue(options && options.requestedByEmail, resolveRequestRecipientEmail(currentUser || currentUserDisplay || ''), ''))
            };
        }

        function getPaperNcrPackageActiveCount(pkg = null) {
            return pkg && Array.isArray(pkg.rowStates) ? pkg.rowStates.filter((state) => state && state.checked).length : 0;
        }

        function getPaperNcrPackageRowDisplay(snapshot = {}, field = '', quantity = false) {
            const value = firstNonEmptyValue(snapshot && snapshot[field], '');
            return quantity ? getPaperNcrQtyDisplay(value) : getPaperNcrDisplayValue(value);
        }

        function buildPaperNcrRowActionOptionsHtml(selectedAction = 'ncr') {
            const selected = normalizePaperNcrRowAction(selectedAction);
            return [
                ['ncr', 'NCR'],
                ['move-up', 'Move Up'],
                ['move-down', 'Move Down'],
                ['on-hold', 'On Hold'],
                ['off-hold', 'Off Hold'],
                ['on-stop', 'On Stop'],
                ['off-stop', 'Off Stop']
            ].map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
        }

        function buildPaperNcrHoldStopCodeOptionsHtml(selectedCode = '', actionType = 'ncr', originalCode = '') {
            const selected = normalizeBloomActionHoldStopCodeChoice(selectedCode);
            const original = normalizeBloomActionHoldStopCodeChoice(originalCode);
            const action = normalizePaperNcrRowAction(actionType);
            const blankLabel = action === 'off-hold' || action === 'off-stop' ? 'Blank / release' : 'Blank';
            return [
                ['', blankLabel],
                ['H', original === 'H' ? 'H (current)' : 'H'],
                ['S', original === 'S' ? 'S (current)' : 'S']
            ].map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
        }

        function buildPaperNcrMoveDownSeasonOptionsHtml(selectedSeason = '') {
            const selected = normalizePaperNcrMoveDownSeason(selectedSeason);
            return getPaperNcrMoveDownSeasonOptions()
                .map((season) => `<option value="${escapeHtml(season)}"${season === selected ? ' selected' : ''}>${escapeHtml(season)}</option>`)
                .join('');
        }

        function getPaperNcrSalesNoteInputId(pkgIndex = 0, rowIndex = 0) {
            return `paper-ncr-sales-note-${Number(pkgIndex) || 0}-${Number(rowIndex) || 0}`;
        }

        function getPaperNcrSalesNoteListId(pkgIndex = 0, rowIndex = 0) {
            return `paper-ncr-sales-note-list-${Number(pkgIndex) || 0}-${Number(rowIndex) || 0}`;
        }

        function getPaperNcrSalesNoteOriginalValue(pkgIndex = 0, rowIndex = 0) {
            const context = paperNcrPackageContext || {};
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            const state = pkg && pkg.rowStates ? pkg.rowStates[rowIndex] : null;
            const snapshot = pkg && pkg.allRows ? pkg.allRows[rowIndex] : null;
            return normalizePaperNcrSalesNoteValue(firstNonEmptyValue(
                state && state.originalSalesNote,
                snapshot && snapshot.salesNote,
                ''
            ));
        }

        function updatePaperNcrSalesNoteHighlight(pkgIndex = 0, rowIndex = 0) {
            const input = document.getElementById(getPaperNcrSalesNoteInputId(pkgIndex, rowIndex));
            if (!input) return false;
            const changed = isPaperNcrValueChanged(input.value, getPaperNcrSalesNoteOriginalValue(pkgIndex, rowIndex));
            input.classList.toggle('border-yellow-300', changed);
            input.classList.toggle('bg-yellow-50', changed);
            input.classList.toggle('ring-1', changed);
            input.classList.toggle('ring-yellow-200', changed);
            input.classList.toggle('border-slate-200', !changed);
            input.classList.toggle('bg-white', !changed);
            return false;
        }

        function debouncedFilterPaperNcrSalesNotes(pkgIndex = 0, rowIndex = 0) {
            const key = `paper-ncr-sales-${Number(pkgIndex) || 0}-${Number(rowIndex) || 0}`;
            if (avNoteFilterTimers[key]) clearTimeout(avNoteFilterTimers[key]);
            const delayMs = isIOSDevice() ? 180 : ((isTouchOptimizedDevice() || isCoarsePointerDevice()) ? 100 : 70);
            avNoteFilterTimers[key] = setTimeout(() => {
                avNoteFilterTimers[key] = null;
                requestAnimationFrame(() => filterPaperNcrSalesNotes(pkgIndex, rowIndex));
            }, delayMs);
            return false;
        }

        function filterPaperNcrSalesNotes(pkgIndex = 0, rowIndex = 0) {
            const input = document.getElementById(getPaperNcrSalesNoteInputId(pkgIndex, rowIndex));
            const list = document.getElementById(getPaperNcrSalesNoteListId(pkgIndex, rowIndex));
            if (!input || !list) return false;
            const context = paperNcrPackageContext || {};
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            const snapshot = pkg && pkg.allRows ? pkg.allRows[rowIndex] : null;
            const commonName = String(firstNonEmptyValue(snapshot && snapshot.commonName, pkg && pkg.commonName, '') || '').trim().toUpperCase();
            const contextItem = {
                ITEMCODE: firstNonEmptyValue(snapshot && snapshot.itemcode, snapshot && snapshot.ITEMCODE, pkg && pkg.itemcode, ''),
                COMMONNAME: commonName
            };
            void ensureItemcodeAvNoteOptions(contextItem, () => filterPaperNcrSalesNotes(pkgIndex, rowIndex));
            const inputVal = String(input.value || '').trim().toUpperCase();
            let matchingNotes = getIndexedAvNotes(contextItem).map((note) => normalizePaperNcrSalesNoteValue(note)).filter(Boolean);
            matchingNotes = [...new Set(matchingNotes)];
            if (inputVal) matchingNotes = matchingNotes.filter((note) => String(note).toUpperCase().includes(inputVal));
            if (!matchingNotes.length) {
                list.classList.add('hidden');
                return false;
            }
            const touchOptimized = isIOSDevice() || isStandaloneApp() || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
            list.innerHTML = matchingNotes.slice(0, touchOptimized ? 18 : 24)
                .map((note) => `<button type="button" class="block w-full border-b border-gray-100 px-3 py-2 text-left text-[12px] font-bold text-blue-800 hover:bg-blue-50 active:bg-blue-100" onmousedown="event.preventDefault()" onclick="return selectPaperNcrSalesNote(${Number(pkgIndex) || 0}, ${Number(rowIndex) || 0}, '${escJsAttrValue(note)}')">${escapeHtml(note)}</button>`)
                .join('');
            list.classList.remove('hidden');
            return false;
        }

        function selectPaperNcrSalesNote(pkgIndex = 0, rowIndex = 0, note = '') {
            const input = document.getElementById(getPaperNcrSalesNoteInputId(pkgIndex, rowIndex));
            const list = document.getElementById(getPaperNcrSalesNoteListId(pkgIndex, rowIndex));
            if (!input) return false;
            input.value = normalizePaperNcrSalesNoteValue(note);
            if (list) list.classList.add('hidden');
            const context = paperNcrPackageContext || {};
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            const state = pkg && pkg.rowStates ? pkg.rowStates[rowIndex] : null;
            if (state) state.salesNote = input.value;
            updatePaperNcrSalesNoteHighlight(pkgIndex, rowIndex);
            input.focus();
            return false;
        }

        function persistCurrentPaperNcrPackageDraft(context = paperNcrPackageContext) {
            if (!context || !Array.isArray(context.packages)) return null;
            const pkgIndex = Math.max(0, Math.min(Number(context.currentIndex) || 0, context.packages.length - 1));
            const pkg = context.packages[pkgIndex];
            if (!pkg || !Array.isArray(pkg.rowStates)) return pkg;
            const container = document.getElementById('paper-ncr-package-list');
            if (!container) return pkg;
            container.querySelectorAll('[data-paper-ncr-field]').forEach((el) => {
                const rowIndex = Number(el.getAttribute('data-paper-ncr-row'));
                const field = String(el.getAttribute('data-paper-ncr-field') || '').trim();
                if (!Number.isFinite(rowIndex) || !field || !pkg.rowStates[rowIndex]) return;
                if (field === 'checked') {
                    pkg.rowStates[rowIndex].checked = !!el.checked;
                    return;
                }
                let value = String(el.value === null || typeof el.value === 'undefined' ? '' : el.value).trim();
                if (field === 'holdstopreason') value = normalizeBloomActionHoldStopReasonValue(value).toLowerCase();
                if (field === 'holdstopcode') value = normalizeBloomActionHoldStopCodeChoice(value);
                if (field === 'actionType') value = normalizePaperNcrRowAction(value);
            if (field === 'moveDownSeason') value = normalizePaperNcrMoveDownSeason(value);
            if (field === 'salesNote') value = normalizePaperNcrSalesNoteValue(value);
                pkg.rowStates[rowIndex][field] = value;
            });
            pkg.rowStates.forEach((state, rowIndex) => {
                if (!state || !state.checked) return;
                const snapshot = pkg.allRows && pkg.allRows[rowIndex] ? pkg.allRows[rowIndex] : {};
                const actionType = resolvePaperNcrRowActionForApprovalType(state.actionType || '', pkg.approvalType || pkg.type || 'new-crop');
                state.actionType = actionType;
                if (actionType === 'move-up') {
                    if (state.moveUpQty) state.ncrQty = state.moveUpQty;
                }
                if (actionType === 'move-down') {
                    const availableQty = String(firstNonEmptyValue(snapshot.ptravailable, state.ncrQty, '') || '').trim();
                    state.priority = '';
                    if (availableQty) state.ncrQty = availableQty;
                }
                refreshPaperNcrStateAutoNoteForAction(state, snapshot, context.createdAt || pkg.createdAt || new Date());
            });
            return pkg;
        }

        function buildPaperNcrPackagePayload(pkg = null) {
            if (!pkg) return null;
            const allRows = (Array.isArray(pkg.allRows) ? pkg.allRows : []).map((row, index) => normalizePaperNcrPackageRow(row, index)).filter(Boolean);
            const packageType = inferPaperNcrApprovalType(pkg, 'new-crop');
            const activeRows = allRows.map((snapshot, index) => {
                const state = pkg.rowStates && pkg.rowStates[index] ? pkg.rowStates[index] : {};
                if (!state.checked) return null;
                const actionType = resolvePaperNcrRowActionForApprovalType(state.actionType || '', packageType);
                const primaryQty = getPaperNcrPrimaryQtyForAction(state, actionType);
                return normalizePaperNcrActiveRow({
                    ...snapshot,
                    actionType,
                    ncrQty: actionType === 'move-up' ? primaryQty : state.ncrQty,
                    moveUpQty: actionType === 'move-up' ? primaryQty : state.moveUpQty,
                    moveDownQty: state.moveDownQty,
                    moveDownSeason: state.moveDownSeason,
                    ncrNote: state.ncrNote,
                    priority: state.priority,
                    locationnoteDate: state.locationnoteDate,
                    locationnote: state.locationnote,
                    locationptn1: state.locationptn1,
                    holdStopCode: state.holdstopcode,
                    holdStopReason: state.holdstopreason,
                    salesNote: state.salesNote,
                    originalPriority: state.originalPriority,
                    originalLocationNoteDate: state.originalLocationNoteDate,
                    originalLocationNote: state.originalLocationNote,
                    originalLocationPtn1: state.originalLocationPtn1,
                    originalHoldStopCode: state.originalHoldStopCode,
                    originalHoldStopReason: state.originalHoldStopReason,
                    originalSalesNote: state.originalSalesNote
                }, index, packageType);
            }).filter(Boolean);
            return normalizePaperNcrPackage({
                id: pkg.id,
                type: packageType,
                approvalType: packageType,
                itemCode: pkg.itemCode,
                commonName: pkg.commonName,
                contSize: pkg.contSize,
                genus: pkg.genus,
                fieldTagColor: pkg.fieldTagColor,
                anchorUid: pkg.anchorUid,
                createdBy: pkg.createdBy,
                createdByDisplay: pkg.createdByDisplay,
                createdByEmail: pkg.createdByEmail,
                createdAt: pkg.createdAt,
                allRows,
                activeRows,
                offHoldPriorityChangeRows: normalizePaperNcrPriorityChangeRows(pkg.offHoldPriorityChangeRows || pkg.priorityChangeRows || []),
                priorityChangeRows: normalizePaperNcrPriorityChangeRows(pkg.offHoldPriorityChangeRows || pkg.priorityChangeRows || [])
            });
        }

        function getPaperInquiryReportActionFromBloomAction(action = '') {
            const normalized = String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalized === 'ncr') return 'ncr';
            if (normalized === 'move_up') return 'move-up';
            if (normalized === 'move_down') return 'move-down';
            if (normalized === 'hold' || normalized === 'on_hold' || normalized === 'place_on_hold') return 'on-hold';
            if (normalized === 'take_off_hold' || normalized === 'off_hold' || normalized === 'hold_release') return 'off-hold';
            if (normalized === 'stop_ship' || normalized === 'on_stop') return 'on-stop';
            if (normalized === 'off_stop_ship' || normalized === 'off_stop') return 'off-stop';
            if (normalized === 'note' || normalized === 'send_note' || normalized === 'send_as_note') return 'note';
            if (normalized === 'recount' || normalized === 're_count') return 'recount';
            if (normalized === 'location_move') return 'location-move';
            if (normalized === 'shear' || normalized === 'shear_list' || normalized === 'add_to_shear_list') return 'shear';
            return '';
        }

        function shouldUsePaperInquiryReportEmailForAction(action = '') {
            return !!getPaperInquiryReportActionFromBloomAction(action);
        }

        function buildPaperNcrPackageFromBloomActionRows(rows = [], options = {}) {
            const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
            if (!safeRows.length) return null;
            const safeOptions = options || {};
            const actionType = getPaperInquiryReportActionFromBloomAction(safeOptions.action || safeOptions.purpose || 'ncr') || 'ncr';
            const createdAt = String(firstNonEmptyValue(safeOptions.createdAt, safeOptions.timestampIso, new Date().toISOString()) || '').trim();
            const anchorItem = safeRows[0];
            const identity = getPaperNcrPackageIdentity(anchorItem);
            if (!identity.itemCode) return null;
            const rowOptionsByUid = safeOptions.rowOptionsByUid || safeOptions.rowOptions || null;
            const allRows = safeRows.map((row, index) => buildPaperNcrRowSnapshot(row, index)).filter(Boolean);
            const offHoldPriorityChangeRows = normalizePaperNcrPriorityChangeRows(safeOptions.offHoldPriorityChangeRows || safeOptions.priorityChangeRows || []);
            const rowStates = allRows.map((snapshot, index) => {
                const sourceRow = safeRows[index] || anchorItem;
                const rowOptions = getGroupedBloomNcrRowOption(rowOptionsByUid, sourceRow, index);
                const normalizedOptions = normalizeApprovalRowOptionsMeta(rowOptions) || rowOptions || null;
                const screenValues = normalizedOptions && normalizedOptions.screenValues && typeof normalizedOptions.screenValues === 'object'
                    ? normalizedOptions.screenValues
                    : {};
                const state = buildPaperNcrRowState(snapshot, sourceRow, true, {
                    ...safeOptions,
                    action: actionType,
                    rowAction: actionType,
                    approvalType: inferPaperNcrApprovalTypeFromAction(actionType, safeOptions.approvalType || safeOptions.type || 'new-crop'),
                    rowOptions: normalizedOptions,
                    createdAt
                }) || {};
                state.checked = true;
                state.actionType = actionType;
                if (actionType === 'move-up') {
                    const moveUpQty = String(firstNonEmptyValue(normalizedOptions && normalizedOptions.moveUpQty, screenValues.moveUpQty, state.moveUpQty, state.ncrQty, '') || '').trim();
                    state.moveUpQty = moveUpQty;
                    state.ncrQty = moveUpQty || state.ncrQty || '';
                }
                if (actionType === 'move-down') {
                    state.moveDownQty = String(firstNonEmptyValue(normalizedOptions && normalizedOptions.moveDownQty, screenValues.moveDownQty, state.moveDownQty, state.ncrQty, '') || '').trim();
                    state.moveDownSeason = normalizePaperNcrMoveDownSeason(firstNonEmptyValue(normalizedOptions && normalizedOptions.moveDownSeason, screenValues.moveDownSeason, state.moveDownSeason, getPaperNcrDefaultMoveSeason()));
                    state.priority = '';
                }
                if (actionType === 'ncr') {
                    const ncrQty = String(firstNonEmptyValue(normalizedOptions && normalizedOptions.ncrQty, screenValues.releaseQty, screenValues.release_qty, state.ncrQty, '') || '').trim();
                    state.ncrQty = ncrQty || state.ncrQty || '';
                }
                if (actionType === 'on-hold' || actionType === 'on-stop') {
                    state.holdstopcode = normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(normalizedOptions && normalizedOptions.holdStopCode, screenValues.holdstopcode, state.holdstopcode, ''), actionType === 'on-stop' ? 'stop_ship' : 'hold');
                    state.holdstopreason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(normalizedOptions && normalizedOptions.holdStopReason, screenValues.holdstopreason, state.holdstopreason, ''));
                }
                if (actionType === 'off-hold' || actionType === 'off-stop') {
                    const sourceHoldStopCode = String(firstNonEmptyValue(
                        getBloomActionRowCurrentHoldStopFromSource(sourceRow),
                        getBloomActionRowCurrentHoldStop(sourceRow),
                        ''
                    ) || '').trim();
                    const sourceHoldStopReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(
                        getBloomActionRowCurrentHoldStopReasonFromSource(sourceRow),
                        getBloomActionRowCurrentHoldStopReason(sourceRow),
                        ''
                    ));
                    const originalHoldStopCode = normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(
                        sourceHoldStopCode,
                        state.originalHoldStopCode,
                        normalizedOptions && normalizedOptions.originalHoldStopCode,
                        normalizedOptions && normalizedOptions.holdStopCode,
                        snapshot.holdStopCode,
                        snapshot.holdstopcode,
                        sourceRow && sourceRow.HOLDSTOPCODE,
                        sourceRow && sourceRow.holdstopcode,
                        sourceRow && sourceRow.HOLSTOPCODE,
                        sourceRow && sourceRow.holstopcode,
                        sourceRow && sourceRow.HOLD_STOP_CODE,
                        sourceRow && sourceRow.hold_stop_code,
                        screenValues.originalHoldStopCode,
                        screenValues.original_holdstopcode,
                        screenValues.currentHoldStopCode,
                        screenValues.current_holdstopcode,
                        screenValues.originalHoldStop,
                        ''
                    ));
                    const originalHoldStopReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(
                        sourceHoldStopReason,
                        state.originalHoldStopReason,
                        normalizedOptions && normalizedOptions.originalHoldStopReason,
                        snapshot.holdStopReason,
                        snapshot.holdstopreason,
                        sourceRow && sourceRow.HOLDSTOPREASON,
                        sourceRow && sourceRow.holdstopreason,
                        sourceRow && sourceRow.HOLSTOPREASON,
                        sourceRow && sourceRow.holstopreason,
                        sourceRow && sourceRow.HOLD_STOP_REASON,
                        sourceRow && sourceRow.hold_stop_reason,
                        sourceRow && sourceRow.HOLDREASON,
                        sourceRow && sourceRow.holdreason,
                        normalizedOptions && normalizedOptions.holdStopReason,
                        screenValues.originalHoldStopReason,
                        screenValues.original_holdstopreason,
                        screenValues.currentHoldStopReason,
                        screenValues.current_holdstopreason,
                        screenValues.holdstopreason,
                        ''
                    ));
                    if (originalHoldStopCode) state.originalHoldStopCode = originalHoldStopCode;
                    if (originalHoldStopReason) state.originalHoldStopReason = originalHoldStopReason;
                    state.holdstopcode = '';
                    state.holdstopreason = '';
                }
                state.locationnoteDate = String(firstNonEmptyValue(screenValues.locationnoteDate, state.locationnoteDate, '') || '').trim();
                state.locationnote = String(firstNonEmptyValue(screenValues.locationnote, state.locationnote, '') || '').trim();
                state.locationptn1 = String(firstNonEmptyValue(screenValues.locationptn1, state.locationptn1, '') || '').trim();
                state.salesNote = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(normalizedOptions && normalizedOptions.salesNote, screenValues.salesNote, screenValues.salesnote, state.salesNote, ''));
                if (actionType === 'note') {
                    const requestedLine = String(firstNonEmptyValue(
                        screenValues.note,
                        screenValues.locationnote,
                        screenValues.message,
                        normalizedOptions && normalizedOptions.note,
                        normalizedOptions && normalizedOptions.locationnote,
                        normalizedOptions && normalizedOptions.message,
                        safeOptions.reason,
                        safeOptions.message,
                        ''
                    ) || '').trim();
                    state.ncrQty = '';
                    state.moveUpQty = '';
                    state.moveDownQty = '';
                    state.ncrNote = requestedLine;
                    state.note = requestedLine;
                    state.locationnoteDate = state.originalLocationNoteDate || '';
                    state.locationnote = state.originalLocationNote || '';
                    state.locationptn1 = state.originalLocationPtn1 || state.locationptn1 || '';
                } else if (actionType === 'recount') {
                    const requestedLine = String(firstNonEmptyValue(
                        screenValues.note,
                        screenValues.locationnote,
                        screenValues.message,
                        normalizedOptions && normalizedOptions.note,
                        normalizedOptions && normalizedOptions.locationnote,
                        normalizedOptions && normalizedOptions.message,
                        safeOptions.reason,
                        safeOptions.message,
                        ''
                    ) || '').trim() || buildPaperNcrRecountLine(snapshot, createdAt || new Date());
                    state.ncrQty = '';
                    state.moveUpQty = '';
                    state.moveDownQty = '';
                    state.ncrNote = requestedLine;
                    state.note = String(firstNonEmptyValue(screenValues.note, screenValues.locationnote, normalizedOptions && normalizedOptions.note, normalizedOptions && normalizedOptions.locationnote, '') || '').trim();
                    state.locationnoteDate = state.originalLocationNoteDate || '';
                    state.locationnote = state.originalLocationNote || '';
                    state.locationptn1 = state.originalLocationPtn1 || state.locationptn1 || '';
                } else if (actionType === 'location-move' || actionType === 'shear') {
                    const requestedLine = String(firstNonEmptyValue(
                        screenValues.locationnote,
                        screenValues.note,
                        screenValues.message,
                        normalizedOptions && normalizedOptions.locationnote,
                        normalizedOptions && normalizedOptions.note,
                        normalizedOptions && normalizedOptions.message,
                        safeOptions.reason,
                        safeOptions.message,
                        ''
                    ) || '').trim();
                    state.ncrQty = '';
                    state.moveUpQty = '';
                    state.moveDownQty = '';
                    state.ncrNote = requestedLine;
                    state.locationnote = requestedLine || state.originalLocationNote || '';
                } else {
                    refreshPaperNcrStateAutoNoteForAction(state, snapshot, createdAt || new Date());
                }
                return state;
            });
            return buildPaperNcrPackagePayload({
                id: `paper-${actionType}-email-${identity.itemCode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                itemCode: identity.itemCode,
                commonName: identity.commonName,
                contSize: identity.contSize,
                genus: identity.genus,
                fieldTagColor: identity.fieldTagColor,
                type: inferPaperNcrApprovalTypeFromAction(actionType, safeOptions.approvalType || safeOptions.type || 'new-crop'),
                approvalType: inferPaperNcrApprovalTypeFromAction(actionType, safeOptions.approvalType || safeOptions.type || 'new-crop'),
                anchorUid: String(firstNonEmptyValue(anchorItem && anchorItem.UNIQUE_ID, anchorItem && anchorItem.unique_id, '') || '').trim(),
                anchorItem,
                allRows,
                rowStates,
                createdAt,
                createdBy: normalizePushUsername(firstNonEmptyValue(safeOptions.requestedByUsername, currentUser, currentUserDisplay, '')),
                createdByDisplay: String(firstNonEmptyValue(safeOptions.requestedByDisplay, currentUserDisplay, currentUser, '') || '').trim(),
                createdByEmail: normalizeRequestEmailAddress(firstNonEmptyValue(safeOptions.requestedByEmail, resolveRequestRecipientEmail(currentUser || currentUserDisplay || ''), '')),
                offHoldPriorityChangeRows,
                priorityChangeRows: offHoldPriorityChangeRows
            });
        }

        function getPaperNcrApprovalReviewRowKeys(row = null, index = 0) {
            const keys = new Set();
            if (!row) return keys;
            const rowKey = String(firstNonEmptyValue(row.key, row.rowKey, '') || '').trim();
            const uid = String(firstNonEmptyValue(row.uid, row.uniqueId, row.unique_id, row.UNIQUE_ID, '') || '').trim();
            const domId = String(firstNonEmptyValue(row.domId, row.dom_id, row.DOM_ID, '') || '').trim();
            const rowIndex = String(firstNonEmptyValue(row.rowIndex, row.index, '') || '').trim();
            [rowKey, uid ? `uid:${uid}` : '', domId ? `dom:${domId}` : '', rowIndex ? `row:${rowIndex}` : '', `index:${index}`]
                .filter(Boolean)
                .forEach((key) => keys.add(key));
            return keys;
        }

        function paperNcrApprovalReviewRowsMatch(a = null, b = null, index = 0) {
            const bKeys = getPaperNcrApprovalReviewRowKeys(b, index);
            if (!bKeys.size) return false;
            for (const key of getPaperNcrApprovalReviewRowKeys(a, index)) {
                if (bKeys.has(key)) return true;
            }
            return false;
        }

        function getPaperNcrApprovalReviewAnchorIndex(draft = null, item = null) {
            const rows = draft && Array.isArray(draft.allRows) ? draft.allRows : [];
            if (!rows.length || !item) return -1;
            const candidates = new Set([
                getPaperNcrRowKey(item, 0),
                typeof getItemInquiryRowKey === 'function' ? `inq:${getItemInquiryRowKey(item)}` : '',
                String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, '') || '').trim(),
                String(firstNonEmptyValue(item && item.DOM_ID, item && item.dom_id, '') || '').trim()
            ].filter(Boolean));
            let index = rows.findIndex((row, rowIndex) => {
                for (const key of getPaperNcrApprovalReviewRowKeys(row, rowIndex)) {
                    if (candidates.has(key) || candidates.has(key.replace(/^uid:/, '')) || candidates.has(key.replace(/^dom:/, ''))) return true;
                }
                return false;
            });
            if (index >= 0) return index;
            const itemCode = String(firstNonEmptyValue(item && item.ITEMCODE, item && item.itemcode, '') || '').trim().toUpperCase();
            const locationCode = String(firstNonEmptyValue(item && item.LOCATIONCODE, item && item.locationcode, '') || '').trim().toUpperCase();
            const lotCode = String(firstNonEmptyValue(item && item.LOTCODE, item && item.lotcode, '') || '').trim().toUpperCase();
            return rows.findIndex((row) => (
                (!itemCode || String(firstNonEmptyValue(row && row.itemCode, row && row.ITEMCODE, '') || '').trim().toUpperCase() === itemCode)
                && (!locationCode || String(firstNonEmptyValue(row && row.locationcode, row && row.locationCode, row && row.LOCATIONCODE, '') || '').trim().toUpperCase() === locationCode)
                && (!lotCode || String(firstNonEmptyValue(row && row.lotcode, row && row.lotCode, row && row.LOTCODE, '') || '').trim().toUpperCase() === lotCode)
            ));
        }

        function applyPaperNcrActiveRowToState(state = null, activeRow = null, snapshot = null, approvalType = 'new-crop', createdAt = new Date()) {
            if (!state || !activeRow) return state;
            state.checked = true;
            state.actionType = resolvePaperNcrRowActionForApprovalType(
                firstNonEmptyValue(activeRow.actionType, activeRow.action_type, activeRow.action, ''),
                firstNonEmptyValue(activeRow.approvalType, activeRow.approval_type, activeRow.type, approvalType, 'new-crop')
            );
            state.ncrQty = String(activeRow.ncrQty == null ? '' : activeRow.ncrQty).trim();
            state.moveUpQty = String(firstNonEmptyValue(activeRow.moveUpQty, state.actionType === 'move-up' ? state.ncrQty : '') || '').trim();
            state.moveDownQty = String(activeRow.moveDownQty == null ? '' : activeRow.moveDownQty).trim();
            state.moveDownSeason = normalizePaperNcrMoveDownSeason(activeRow.moveDownSeason || getPaperNcrDefaultMoveSeason());
            state.priority = normalizePaperNcrPriorityForAction(activeRow.priority, state.actionType);
            state.locationnoteDate = String(activeRow.locationnoteDate == null ? '' : activeRow.locationnoteDate).trim();
            state.locationnote = String(activeRow.locationnote == null ? '' : activeRow.locationnote).trim();
            state.locationptn1 = String(activeRow.locationptn1 == null ? '' : activeRow.locationptn1).trim();
            state.holdstopcode = normalizeBloomActionHoldStopCodeChoice(activeRow.holdStopCode == null ? '' : activeRow.holdStopCode);
            state.holdstopreason = normalizeBloomActionHoldStopReasonValue(activeRow.holdStopReason == null ? '' : activeRow.holdStopReason).toLowerCase();
            state.salesNote = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(activeRow.salesNote, state.salesNote, snapshot && snapshot.salesNote, ''));
            state.ncrNote = String(activeRow.ncrNote == null ? '' : activeRow.ncrNote).trim();
            state.originalPriority = String(firstNonEmptyValue(activeRow.originalPriority, state.originalPriority, '') || '').trim();
            state.originalLocationNoteDate = String(firstNonEmptyValue(activeRow.originalLocationNoteDate, state.originalLocationNoteDate, '') || '').trim();
            state.originalLocationNote = String(firstNonEmptyValue(activeRow.originalLocationNote, state.originalLocationNote, '') || '').trim();
            state.originalLocationPtn1 = String(firstNonEmptyValue(activeRow.originalLocationPtn1, state.originalLocationPtn1, '') || '').trim();
            state.originalHoldStopCode = String(firstNonEmptyValue(activeRow.originalHoldStopCode, state.originalHoldStopCode, '') || '').trim();
            state.originalHoldStopReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(activeRow.originalHoldStopReason, state.originalHoldStopReason, '')).toLowerCase();
            state.originalSalesNote = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(activeRow.originalSalesNote, state.originalSalesNote, snapshot && snapshot.salesNote, ''));
            if (state.actionType === 'move-up' && state.moveUpQty) state.ncrQty = state.moveUpQty;
            refreshPaperNcrStateAutoNoteForAction(state, snapshot || activeRow, createdAt);
            return state;
        }

        function applyNcrApprovalRowOptionsToPaperState(state = null, rowOptions = null, sourceRow = null) {
            if (!state || !rowOptions) return state;
            const screenValues = rowOptions && rowOptions.screenValues && typeof rowOptions.screenValues === 'object' ? rowOptions.screenValues : {};
            const actionType = resolvePaperNcrRowActionForApprovalType(
                getPaperNcrRowActionFromAppAction(firstNonEmptyValue(rowOptions.approvalType, rowOptions.type, screenValues.actionType, 'ncr')),
                firstNonEmptyValue(rowOptions.approvalType, rowOptions.type, screenValues.approvalType, 'new-crop')
            );
            const ncrQty = firstNonEmptyValue(rowOptions.ncrQty, rowOptions.releaseQty, screenValues.releaseQty, screenValues.loc_match_qty, sourceRow && sourceRow.LOC_MATCH_QTY, state.ncrQty, '');
            const moveUpQty = firstNonEmptyValue(rowOptions.moveUpQty, screenValues.moveUpQty, rowOptions.recommendationMeta && rowOptions.recommendationMeta.suggestedQty, state.moveUpQty, actionType === 'move-up' ? ncrQty : '');
            const moveDownQty = firstNonEmptyValue(rowOptions.moveDownQty, screenValues.moveDownQty, state.moveDownQty, '');
            const moveDownSeason = firstNonEmptyValue(rowOptions.moveDownSeason, screenValues.moveDownSeason, state.moveDownSeason, getPaperNcrDefaultMoveSeason());
            const priority = firstNonEmptyValue(screenValues.priority, rowOptions.priority, sourceRow && sourceRow.PRIORITY, state.priority, '');
            const noteDate = firstNonEmptyValue(screenValues.locationnoteDate, screenValues.locationnotedate, rowOptions.locationnoteDate, sourceRow && sourceRow.LOCATIONNOTEDATE, state.locationnoteDate, '');
            const locationNote = firstNonEmptyValue(screenValues.locationnote, rowOptions.locationnote, sourceRow && sourceRow.LOCATIONNOTE, state.locationnote, '');
            const ptn1 = firstNonEmptyValue(screenValues.locationptn1, rowOptions.locationptn1, sourceRow && sourceRow.LOCATIONPTN1, state.locationptn1, '');
            const holdCode = firstNonEmptyValue(screenValues.holdstopcode, rowOptions.holdStopCode, rowOptions.holdstopcode, sourceRow && sourceRow.HOLDSTOPCODE, state.holdstopcode, '');
            const holdReason = firstNonEmptyValue(screenValues.holdstopreason, rowOptions.holdStopReason, rowOptions.holdstopreason, sourceRow && sourceRow.HOLDSTOPREASON, state.holdstopreason, '');
            const salesNote = firstNonEmptyValue(screenValues.salesNote, screenValues.salesnote, rowOptions.salesNote, rowOptions.salesnote, sourceRow && sourceRow.SALESNOTE, state.salesNote, '');
            state.actionType = actionType;
            state.ncrQty = String(ncrQty == null ? '' : ncrQty).trim();
            state.moveUpQty = String(moveUpQty == null ? '' : moveUpQty).trim();
            state.moveDownQty = String(moveDownQty == null ? '' : moveDownQty).trim();
            state.moveDownSeason = normalizePaperNcrMoveDownSeason(moveDownSeason);
            state.priority = normalizePaperNcrPriorityForAction(priority, state.actionType);
            state.locationnoteDate = String(noteDate == null ? '' : noteDate).trim();
            state.locationnote = String(locationNote == null ? '' : locationNote).trim();
            state.locationptn1 = String(ptn1 == null ? '' : ptn1).trim();
            state.holdstopcode = normalizeBloomActionHoldStopCodeChoice(holdCode == null ? '' : holdCode);
            state.holdstopreason = normalizeBloomActionHoldStopReasonValue(holdReason == null ? '' : holdReason).toLowerCase();
            state.salesNote = normalizePaperNcrSalesNoteValue(salesNote);
            if (state.actionType === 'move-up' && state.moveUpQty) state.ncrQty = state.moveUpQty;
            refreshPaperNcrStateAutoNoteForAction(state, sourceRow || {}, new Date());
            return state;
        }

        function buildPaperNcrApprovalReviewDraft(item = null, existingPackage = null, options = {}) {
            if (!item) return null;
            const safeExistingPackage = normalizePaperNcrPackage(existingPackage || getPaperNcrPackageFromItem(item));
            const reviewApprovalType = inferPaperNcrApprovalType(safeExistingPackage || options || null, options && options.approvalType || getNcrApprovalTypeForItem(item));
            const createdAt = String(firstNonEmptyValue(safeExistingPackage && safeExistingPackage.createdAt, options && options.createdAt, new Date().toISOString()) || '').trim();
            const draft = buildPaperNcrPackageDraft(item, [item], {
                createdAt,
                approvalType: reviewApprovalType,
                action: getPaperNcrDefaultRowActionForApprovalType(reviewApprovalType),
                requestedByUsername: firstNonEmptyValue(safeExistingPackage && safeExistingPackage.createdBy, options && options.requestedByUsername, currentUser, ''),
                requestedByDisplay: firstNonEmptyValue(safeExistingPackage && safeExistingPackage.createdByDisplay, options && options.requestedByDisplay, currentUserDisplay, currentUser, ''),
                requestedByEmail: firstNonEmptyValue(safeExistingPackage && safeExistingPackage.createdByEmail, options && options.requestedByEmail, resolveRequestRecipientEmail(currentUser || currentUserDisplay || ''), '')
            });
            if (!draft) return null;
            if (safeExistingPackage) {
                draft.id = safeExistingPackage.id || draft.id;
                draft.type = safeExistingPackage.type || draft.type;
                draft.approvalType = safeExistingPackage.approvalType || safeExistingPackage.type || draft.approvalType;
                draft.commonName = safeExistingPackage.commonName || draft.commonName;
                draft.contSize = safeExistingPackage.contSize || draft.contSize;
                draft.genus = safeExistingPackage.genus || draft.genus;
                draft.fieldTagColor = safeExistingPackage.fieldTagColor || draft.fieldTagColor;
                draft.anchorUid = safeExistingPackage.anchorUid || draft.anchorUid;
                draft.createdBy = safeExistingPackage.createdBy || draft.createdBy;
                draft.createdByDisplay = safeExistingPackage.createdByDisplay || draft.createdByDisplay;
                draft.createdByEmail = safeExistingPackage.createdByEmail || draft.createdByEmail;
                draft.createdAt = safeExistingPackage.createdAt || draft.createdAt;
                const existingRows = safeExistingPackage.allRows || [];
                existingRows.forEach((existingRow, existingIndex) => {
                    const alreadyPresent = (draft.allRows || []).some((row, rowIndex) => paperNcrApprovalReviewRowsMatch(row, existingRow, rowIndex));
                    if (!alreadyPresent) {
                        const normalizedRow = normalizePaperNcrPackageRow(existingRow, draft.allRows.length || existingIndex);
                        if (normalizedRow) {
                            draft.allRows.push(normalizedRow);
                            draft.rowStates.push(buildPaperNcrRowState(normalizedRow, null, false, { createdAt }));
                        }
                    }
                });
                const activeMap = getPaperNcrPackageActiveRowMap(safeExistingPackage);
                let activeMatches = 0;
                draft.rowStates.forEach((state) => { if (state) state.checked = false; });
                draft.allRows.forEach((snapshot, index) => {
                    const activeRow = getPaperNcrActiveRowForSnapshot(snapshot, index, activeMap);
                    if (!activeRow || !draft.rowStates[index]) return;
                    applyPaperNcrActiveRowToState(draft.rowStates[index], activeRow, snapshot, draft.approvalType || reviewApprovalType, draft.createdAt || createdAt);
                    activeMatches += 1;
                });
                if (activeMatches) {
                    const anchorIndexForReview = getPaperNcrApprovalReviewAnchorIndex(draft, item);
                    if (anchorIndexForReview >= 0 && draft.rowStates[anchorIndexForReview]) {
                        const anchorSnapshot = draft.allRows && draft.allRows[anchorIndexForReview] ? draft.allRows[anchorIndexForReview] : null;
                        const anchorActiveRow = getPaperNcrActiveRowForSnapshot(anchorSnapshot, anchorIndexForReview, activeMap);
                        if (anchorActiveRow) {
                            applyPaperNcrActiveRowToState(draft.rowStates[anchorIndexForReview], anchorActiveRow, anchorSnapshot, draft.approvalType || reviewApprovalType, draft.createdAt || createdAt);
                        } else {
                            applyNcrApprovalRowOptionsToPaperState(draft.rowStates[anchorIndexForReview], getApprovalRowOptionsMetaFromItem(item), item);
                        }
                        draft.rowStates.forEach((state, index) => { if (state) state.checked = index === anchorIndexForReview; });
                    }
                    return draft;
                }
            }
            draft.type = inferPaperNcrApprovalType(options || null, getNcrApprovalTypeForItem(item));
            draft.approvalType = draft.type;
            const approvalRowOptions = getApprovalRowOptionsMetaFromItem(item);
            const anchorIndex = Math.max(0, getPaperNcrApprovalReviewAnchorIndex(draft, item));
            draft.rowStates.forEach((state) => { if (state) state.checked = false; });
            if (draft.rowStates[anchorIndex]) {
                draft.rowStates[anchorIndex].checked = true;
                applyNcrApprovalRowOptionsToPaperState(draft.rowStates[anchorIndex], approvalRowOptions, item);
            }
            return draft;
        }

        function buildPaperNcrPackagePayloadWithEditedRows(pkg = null) {
            const payload = buildPaperNcrPackagePayload(pkg);
            if (!payload) return null;
            const activeMap = getPaperNcrPackageActiveRowMap(payload);
            const allRows = (payload.allRows || []).map((row, index) => {
                const activeRow = getPaperNcrActiveRowForSnapshot(row, index, activeMap);
                if (!activeRow) return row;
                return normalizePaperNcrPackageRow({
                    ...row,
                    priority: activeRow.priority,
                    locationnoteDate: activeRow.locationnoteDate,
                    locationnote: activeRow.locationnote,
                    locationptn1: activeRow.locationptn1,
                    holdStopCode: activeRow.holdStopCode,
                    holdStopReason: activeRow.holdStopReason,
                    salesNote: activeRow.salesNote
                }, index) || row;
            });
            const packageType = inferPaperNcrApprovalType(payload, payload.type || 'new-crop');
            const activeRows = (payload.activeRows || []).map((activeRow, index) => normalizePaperNcrActiveRow(activeRow, index, packageType)).filter(Boolean);
            return normalizePaperNcrPackage({
                ...payload,
                type: packageType,
                approvalType: packageType,
                allRows,
                activeRows
            });
        }

        function preparePaperNcrApprovalReviewFinalPackage() {
            if (paperNcrPackageSubmitting) return null;
            const context = paperNcrPackageContext || {};
            if (context.mode !== 'approval-review' || !Array.isArray(context.packages) || !context.packages.length) {
                showToast('Package Empty', 'No item inquiry approval review is open.', true);
                return null;
            }
            persistCurrentPaperNcrPackageDraft(context);
            const currentIndex = Math.max(0, Math.min(Number(context.currentIndex) || 0, context.packages.length - 1));
            const currentError = validatePaperNcrPackage(context.packages[currentIndex], currentIndex);
            if (currentError) {
                showToast('Check Lines', currentError, true);
                return null;
            }
            if (currentIndex < context.packages.length - 1) {
                context.currentIndex = currentIndex + 1;
                syncPaperNcrPackageModalUi();
                return null;
            }
            for (let index = 0; index < context.packages.length; index += 1) {
                const error = validatePaperNcrPackage(context.packages[index], index);
                if (error) {
                    context.currentIndex = index;
                    syncPaperNcrPackageModalUi();
                    showToast('Check Lines', error, true);
                    return null;
                }
            }
            const approvalItem = context.approvalItem || (context.approvalUid ? findItemByUniqueId(context.approvalUid) : null);
            const approvalUid = String(firstNonEmptyValue(context.approvalUid, getNcrSourceUniqueId(approvalItem), '') || '').trim();
            if (!approvalItem || !approvalUid) {
                showToast('Not Found', 'That approval row could not be found.', true);
                return null;
            }
            const finalPackage = buildPaperNcrPackagePayloadWithEditedRows(context.packages[0]);
            if (!finalPackage || !finalPackage.activeRows.length) {
                showToast('Check Lines', 'At least one active line must be checked before sending.', true);
                return null;
            }
            const approvalType = inferPaperNcrApprovalType(finalPackage, context.approvalType || getNcrApprovalTypeForItem(approvalItem));
            return {
                context,
                approvalItem,
                approvalUid,
                finalPackage,
                approvalType
            };
        }

        async function approvePaperNcrPackageReviewToOutbox() {
            const prepared = preparePaperNcrApprovalReviewFinalPackage();
            if (!prepared) return false;
            const { context, approvalItem, approvalUid, finalPackage, approvalType } = prepared;
            const reviewStage = getPaperNcrApprovalReviewStage(context);
            const shouldMoveToJd = approvalType !== 'recount' && reviewStage !== 'jd' && reviewStage !== 'outbox';
            const packageLabel = getPaperNcrPackageLabel(finalPackage, approvalType);
            paperNcrPackageSubmitting = true;
            syncPaperNcrPackageModalUi({ preserveList: true });
            try {
                showToast(shouldMoveToJd ? 'Approving To JD' : 'Adding To Session', shouldMoveToJd ? `Sending this ${packageLabel} approval to JD.` : `Adding this approved row to the ${packageLabel} email session.`, false);
                applyPaperNcrPackageToItem(approvalItem, finalPackage);
                const savedAt = new Date().toISOString();
                const approvalMessage = mergeApprovalMessageWithPaperNcrPackage(getRawNcrApprovalMessageFromItem(approvalItem), finalPackage);
                const masterItem = await writeNcrApprovalMasterPayload(approvalItem, shouldMoveToJd
                    ? {
                        app_tab_assignment: getNcrApprovalAssignment(approvalType, 'jd'),
                        assignedto: NCR_APPROVAL_JD_USER,
                        date_completed: null,
                        updated_at: savedAt,
                        ncr_approval_message: approvalMessage || null
                    }
                    : {
                        app_tab_assignment: getNcrApprovalAssignment(approvalType, 'outbox'),
                        assignedto: '',
                        updated_at: savedAt,
                        ncr_approval_message: approvalMessage || null
                    }, shouldMoveToJd ? 'paper-ncr-approval-to-jd' : 'paper-ncr-approval-outbox');
                let notifyWarning = '';
                if (shouldMoveToJd) {
                    try {
                        const notifyItem = masterItem || approvalItem;
                        if (notifyItem && !getPaperNcrPackageFromItem(notifyItem)) {
                            notifyItem.PAPER_NCR_PACKAGE = finalPackage;
                            notifyItem.paperNcrPackage = finalPackage;
                        }
                        await notifyNcrApprovalStage(notifyItem, approvalType, 'jd', {
                            requester: getNcrApprovalRequesterEntryFromItem(notifyItem) || (context && context.requester) || null,
                            forceImmediate: true,
                            queueJdApprovalEmail: false
                        });
                    } catch (notifyError) {
                        notifyWarning = notifyError && notifyError.message ? notifyError.message : 'JD email did not send.';
                        console.warn('Item inquiry approval moved to JD but notification failed', notifyError);
                    }
                }
                clearNcrApprovalTaskViewCaches();
                markViewDirty('tasks');
                markViewDirty('managers');
                markViewDirty('review');
                closePaperNcrPackageModal();
                if (shouldMoveToJd) removeNcrApprovalCardFromCurrentTaskView(approvalUid);
                if (isViewVisible('tasks') && isNcrApprovalTaskView(activeTaskTab)) scheduleTasksRender(0, 0, true);
                if (isViewVisible('managers') && isManagerApprovalTab(activeHomeTab)) scheduleManagersRender(true);
                showToast(shouldMoveToJd ? 'Sent To JD' : 'Added To Session', shouldMoveToJd
                    ? `${packageLabel} row moved to JD approval.${notifyWarning ? ` Email warning: ${notifyWarning}` : ''}`
                    : `${packageLabel} row is ready for the batch email.`, !!notifyWarning);
            } catch (error) {
                console.error('Item inquiry approval outbox failed', error);
                showToast('Could Not Save', error && error.message ? error.message : `Could not save this ${packageLabel} approval.`, true);
                paperNcrPackageSubmitting = false;
                syncPaperNcrPackageModalUi({ preserveList: true });
            }
            return false;
        }

        async function submitPaperNcrApprovalReviewModal() {
            if (paperNcrPackageSubmitting) return false;
            const prepared = preparePaperNcrApprovalReviewFinalPackage();
            if (!prepared) return false;
            const { approvalItem, approvalUid, finalPackage, approvalType } = prepared;
            paperNcrPackageSubmitting = true;
            syncPaperNcrPackageModalUi({ preserveList: true });
            const requiredRecipientEmails = getPaperNcrApprovalFinalRecipientEmails(approvalItem, finalPackage);
            const packageLabel = getPaperNcrPackageLabel(finalPackage, approvalType);
            const recipientEmails = await openGroupedBloomNcrRecipientModal(buildPaperNcrPackageShareRows(finalPackage, true), requiredRecipientEmails, {
                requiredEmails: requiredRecipientEmails,
                brandLabel: `GNC PH ${packageLabel}`,
                title: `Select ${packageLabel} Email Recipients`
            });
            if (!recipientEmails || !recipientEmails.length) {
                paperNcrPackageSubmitting = false;
                syncPaperNcrPackageModalUi({ preserveList: true });
                return false;
            }
            paperNcrPackageSubmitting = true;
            closePaperNcrPackageModal();
            closeBloomEmailPurposeModal();
            closeBloomActionRowFormModal();
            toggleCartPanel(false);
            paperNcrPackageSubmitting = true;
            try {
                showToast('Sending Email', 'Sending the updated item inquiry email in the background.', false);
                await sendPaperNcrPackageFinalEmail(approvalItem, finalPackage, { recipientEmails });
                applyPaperNcrPackageToItem(approvalItem, finalPackage);
                const completedAt = new Date().toISOString();
                const approvalMessage = mergeApprovalMessageWithPaperNcrPackage(getRawNcrApprovalMessageFromItem(approvalItem), finalPackage);
                const nextStage = approvalType === 'recount' ? 'inventory' : 'complete';
                await writeNcrApprovalMasterPayload(approvalItem, {
                    app_tab_assignment: getNcrApprovalAssignment(approvalType, nextStage),
                    assignedto: '',
                    date_completed: approvalType === 'recount' ? null : completedAt,
                    updated_at: completedAt,
                    ncr_approval_message: approvalMessage || null
                }, approvalType === 'recount' ? 'paper-recount-approval-to-recount-queue' : 'paper-ncr-approval-review-complete');
                removeNcrApprovalCardFromCurrentTaskView(approvalUid);
                clearNcrApprovalTaskViewCaches();
                markViewDirty('tasks');
                markViewDirty('managers');
                markViewDirty('review');
                if (approvalType === 'recount') {
                    markViewDirty('request');
                    markViewDirty('moves');
                }
                paperNcrPackageSubmitting = false;
                showToast('Email Sent', approvalType === 'recount'
                    ? 'The Re-Count email was sent and the row was placed in Que > Recount.'
                    : `The updated item inquiry email was sent and the ${getNcrApprovalTypeLabel(approvalType)} approval was completed.`);
            } catch (error) {
                console.error('Item inquiry approval review failed', error);
                showToast('Could Not Send', error && error.message ? error.message : 'Could not send the item inquiry email.', true);
                paperNcrPackageSubmitting = false;
            }
            return false;
        }

        function openNcrApprovalItemInquiryReview(uniqueId = '', button = null) {
            const uid = String(uniqueId || '').trim();
            const item = uid ? findItemByUniqueId(uid) : null;
            if (!item) {
                showToast('Not Found', 'That NCR approval row could not be found.', true);
                return false;
            }
            const type = getNcrApprovalTypeFromAssignment(getNcrApprovalAssignmentValue(item)) || 'new-crop';
            const existingPackage = getPaperNcrPackageFromItem(item);
            const approvalType = inferPaperNcrApprovalType(existingPackage, getNcrApprovalTypeForItem(item));
            const reviewDraft = buildPaperNcrApprovalReviewDraft(item, existingPackage, { createdAt: new Date().toISOString(), approvalType });
            if (!reviewDraft) {
                showToast('NCR Unavailable', 'No item inquiry rows were available for this NCR approval.', true);
                return false;
            }
            paperNcrPackageContext = {
                mode: 'approval-review',
                packages: [reviewDraft],
                currentIndex: 0,
                requester: getCurrentNcrApprovalRequesterEntry(),
                approvalItem: item,
                approvalUid: uid,
                approvalMessage: getNcrApprovalMessageFromItem(item),
                approvalType,
                clearSelection: false,
                createdAt: reviewDraft.createdAt || new Date().toISOString(),
                selectionKind: 'approval-review'
            };
            paperNcrPackageSubmitting = false;
            if (button) button.blur && button.blur();
            closeBloomEmailPurposeModal();
            closeBloomActionRowFormModal();
            toggleCartPanel(false);
            const modal = document.getElementById('paper-ncr-package-modal');
            if (modal) modal.classList.remove('hidden');
            syncPaperNcrPackageModalUi();
            return false;
        }

        function buildPaperNcrPackageModalHtml(pkg = null, pkgIndex = 0, context = paperNcrPackageContext) {
            if (!pkg) return '<div class="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400">No item inquiry package loaded.</div>';
            const h = (value) => escapeHtml(String(value === null || typeof value === 'undefined' ? '' : value));
            const rows = Array.isArray(pkg.allRows) ? pkg.allRows : [];
            const states = Array.isArray(pkg.rowStates) ? pkg.rowStates : [];
            const approvalReviewMode = context && context.mode === 'approval-review';
            const visibleRowCount = approvalReviewMode
                ? rows.filter((_snapshot, rowIndex) => states[rowIndex] && states[rowIndex].checked).length
                : rows.length;
            const packageApprovalType = inferPaperNcrApprovalType(pkg, context && context.approvalType || 'new-crop');
            const tableRowsHtml = rows.map((snapshot, rowIndex) => {
                const state = states[rowIndex] || {};
                const checked = !!state.checked;
                if (approvalReviewMode && !checked) return '';
                const actionType = resolvePaperNcrRowActionForApprovalType(state.actionType || '', packageApprovalType);
                if (checked && states[rowIndex]) {
                    states[rowIndex].actionType = actionType;
                    if (actionType === 'move-up') {
                        if (!String(states[rowIndex].moveUpQty || '').trim()) states[rowIndex].moveUpQty = String(firstNonEmptyValue(states[rowIndex].ncrQty, '') || '').trim();
                        if (states[rowIndex].moveUpQty) states[rowIndex].ncrQty = states[rowIndex].moveUpQty;
                    }
                }
                const actionLabel = getPaperNcrRowActionLabel(actionType);
                const effectivePriority = checked && actionType === 'move-down'
                    ? ''
                    : (checked ? String(firstNonEmptyValue(state.priority, snapshot.priority, '') || '').trim() : String(firstNonEmptyValue(snapshot.priority, '') || '').trim());
                const priorityIsHot = effectivePriority === '1';
                const rowClickAttrs = checked ? '' : `onclick="return togglePaperNcrLine(${pkgIndex}, ${rowIndex}, true)"`;
                const rowTone = checked ? 'border-amber-300 bg-amber-50/80 ring-1 ring-amber-200' : 'border-slate-200 bg-white';
                const rowLabel = `R${snapshot.rowIndex || rowIndex + 1}`;
                const priorityInputClass = priorityIsHot
                    ? 'mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-2 text-[12px] font-black text-slate-900 ring-1 ring-yellow-200'
                    : 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black text-slate-900';
                const priorityHtml = actionType === 'move-down'
                    ? `<label class="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Priority<input type="text" class="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[12px] font-black text-slate-400" value="" placeholder="Blank for move down" disabled></label>`
                    : `<label class="text-[9px] font-black uppercase tracking-[0.12em] ${priorityIsHot ? 'text-yellow-700' : 'text-slate-500'}">Priority<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="priority" type="text" class="${priorityInputClass}" value="${h(state.priority)}" oninput="const hot=this.value.trim()==='1'; this.classList.toggle('bg-yellow-50', hot); this.classList.toggle('border-yellow-300', hot); this.classList.toggle('ring-1', hot); this.classList.toggle('ring-yellow-200', hot);"></label>`;
                const moveDownHtml = actionType === 'move-down'
                    ? `<label class="text-[9px] font-black uppercase tracking-[0.12em] text-yellow-700">Move Down Qty<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="moveDownQty" type="number" min="0" step="1" inputmode="numeric" class="mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-2 text-right text-[12px] font-black text-slate-900 ring-1 ring-yellow-200" value="${h(state.moveDownQty)}" placeholder="Qty"></label><label class="text-[9px] font-black uppercase tracking-[0.12em] text-yellow-700">Move Down Season<select data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="moveDownSeason" class="mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-2 text-[12px] font-black text-slate-900 ring-1 ring-yellow-200">${buildPaperNcrMoveDownSeasonOptionsHtml(state.moveDownSeason || getPaperNcrDefaultMoveSeason())}</select></label>`
                    : '';
                const primaryQtyField = actionType === 'move-up' ? 'moveUpQty' : 'ncrQty';
                const primaryQtyLabel = getPaperNcrQuantityLabelForAction(actionType);
                const primaryQtyValue = actionType === 'move-up' ? firstNonEmptyValue(state.moveUpQty, state.ncrQty, '') : state.ncrQty;
                const primaryQtyHtml = ['ncr', 'move-up'].includes(actionType)
                    ? `<label class="text-[9px] font-black uppercase tracking-[0.12em] text-yellow-700">${h(primaryQtyLabel)}<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="${h(primaryQtyField)}" type="number" min="0" step="1" inputmode="numeric" class="mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-2 text-right text-[12px] font-black text-slate-900 ring-1 ring-yellow-200" value="${h(primaryQtyValue)}" oninput="return updatePaperNcrLineAutoNote(${pkgIndex}, ${rowIndex})" onchange="return updatePaperNcrLineAutoNote(${pkgIndex}, ${rowIndex})"></label>`
                    : '';
                const originalHoldStopCode = firstNonEmptyValue(state.originalHoldStopCode, snapshot.holdStopCode, snapshot.holdstopcode, '');
                const holdStopCodeOptionsHtml = buildPaperNcrHoldStopCodeOptionsHtml(state.holdstopcode, actionType, originalHoldStopCode);
                const salesNoteOriginal = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(state.originalSalesNote, snapshot.salesNote, ''));
                const salesNoteValue = normalizePaperNcrSalesNoteValue(firstNonEmptyValue(state.salesNote, salesNoteOriginal, ''));
                const salesNoteChanged = isPaperNcrValueChanged(salesNoteValue, salesNoteOriginal);
                const salesNoteInputClass = salesNoteChanged
                    ? 'mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-2 text-[12px] font-black text-slate-900 ring-1 ring-yellow-200'
                    : 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black text-slate-900';
                const salesNoteInputId = getPaperNcrSalesNoteInputId(pkgIndex, rowIndex);
                const salesNoteListId = getPaperNcrSalesNoteListId(pkgIndex, rowIndex);
                const salesNoteHtml = `<label class="relative col-span-2 text-[9px] font-black uppercase tracking-[0.12em] ${salesNoteChanged ? 'text-yellow-700' : 'text-blue-700'} lg:col-span-3">Sales Note<input id="${h(salesNoteInputId)}" data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="salesNote" type="text" class="${salesNoteInputClass}" value="${h(salesNoteValue)}" autocomplete="off" onfocus="return filterPaperNcrSalesNotes(${pkgIndex}, ${rowIndex})" oninput="this.value=normalizePaperNcrSalesNoteValue(this.value); updatePaperNcrSalesNoteHighlight(${pkgIndex}, ${rowIndex}); return debouncedFilterPaperNcrSalesNotes(${pkgIndex}, ${rowIndex})" onchange="this.value=normalizePaperNcrSalesNoteValue(this.value); return updatePaperNcrSalesNoteHighlight(${pkgIndex}, ${rowIndex})"><div id="${h(salesNoteListId)}" class="absolute left-0 right-0 top-full z-30 mt-1 hidden max-h-44 overflow-y-auto rounded-lg border border-blue-100 bg-white text-left shadow-xl"></div></label>`;
                const editHtml = checked ? `<div class="mt-2 grid grid-cols-2 gap-1.5 border-t border-amber-100 pt-2 sm:grid-cols-3 lg:grid-cols-6" onclick="event.stopPropagation()">
                    <label class="text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">Action<select data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="actionType" class="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-[12px] font-black text-slate-900 ring-1 ring-amber-100" onchange="return setPaperNcrLineAction(${pkgIndex}, ${rowIndex}, this.value)">${buildPaperNcrRowActionOptionsHtml(actionType)}</select></label>
                    ${primaryQtyHtml}
                    ${moveDownHtml}
                    ${priorityHtml}
                    <label class="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">Note Date<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="locationnoteDate" type="text" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black text-slate-900" value="${h(state.locationnoteDate)}"></label>
                    <label class="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">LOCATIONPTN1<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="locationptn1" type="text" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black text-slate-900" value="${h(state.locationptn1)}"></label>
                    <label class="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">Hold/Stop Code<select data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="holdstopcode" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black text-slate-900">${holdStopCodeOptionsHtml}</select></label>
                    <label class="col-span-2 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 lg:col-span-2">Hold/Stop Reason<input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="holdstopreason" type="text" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-black lowercase text-slate-900" value="${h(state.holdstopreason)}" oninput="this.value=this.value.toLowerCase()"></label>
                    ${salesNoteHtml}
                    <label class="col-span-2 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700 lg:col-span-3">Location Note<textarea data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="locationnote" class="mt-1 h-14 w-full resize-y rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-[12px] font-bold leading-4 text-emerald-950">${h(state.locationnote)}</textarea></label>
                    <label class="col-span-2 text-[9px] font-black uppercase tracking-[0.12em] text-blue-700 lg:col-span-3">${h(actionLabel)} Line<textarea data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="ncrNote" class="mt-1 h-14 w-full resize-y rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-[12px] font-bold leading-4 text-blue-950">${h(state.ncrNote)}</textarea></label>
                </div>` : '';
                return `<div class="rounded-xl border ${rowTone} p-2 shadow-sm ${checked ? '' : 'cursor-pointer'}" ${rowClickAttrs}>
                    <div class="grid items-center gap-x-1 text-[11px] font-black text-slate-900" style="grid-template-columns:2rem 2.2rem minmax(3.6rem,.75fr) minmax(4.4rem,1fr) minmax(1.7rem,.35fr) minmax(1.5rem,.32fr) minmax(2.2rem,.46fr) minmax(2.1rem,.44fr) minmax(2.35rem,.48fr);">
                        <input data-paper-ncr-row="${rowIndex}" data-paper-ncr-field="checked" type="checkbox" class="h-5 w-5 rounded border-slate-300 text-amber-500 focus:ring-amber-300" ${checked ? 'checked' : ''} onclick="event.stopPropagation(); return togglePaperNcrLine(${pkgIndex}, ${rowIndex}, this.checked)">
                        <div class="truncate text-[9px] uppercase text-slate-400">${h(rowLabel)}</div>
                        <div class="truncate">${h(getPaperNcrPackageRowDisplay(snapshot, 'lotcode'))}</div>
                        <div class="truncate">${h(getPaperNcrPackageRowDisplay(snapshot, 'locationcode'))}</div>
                        <div class="truncate">${h(getPaperNcrPackageRowDisplay(snapshot, 'source'))}</div>
                        <div class="truncate ${priorityIsHot ? 'rounded-md border border-yellow-300 bg-yellow-100 px-1 text-yellow-900' : ''}">${h(getPaperNcrDisplayValue(effectivePriority))}</div>
                        <div class="truncate text-right">${h(getPaperNcrPackageRowDisplay(snapshot, 'ptronhand', true))}</div>
                        <div class="truncate text-right">${h(getPaperNcrPackageRowDisplay(snapshot, 'ptrreviewed', true))}</div>
                        <div class="truncate text-right">${h(getPaperNcrPackageRowDisplay(snapshot, 'ptravailable', true))}</div>
                    </div>
                    ${checked ? `<div class="mt-1 inline-flex max-w-full rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">${h(actionLabel)}</div>` : ''}
                    <div class="mt-1 grid grid-cols-[minmax(4rem,.55fr)_minmax(0,1fr)] gap-1 text-[9px] font-black leading-tight">
                        <div class="rounded-lg border border-slate-100 bg-slate-50 px-1.5 py-1 text-slate-500"><span class="uppercase tracking-[0.1em]">Date</span><div class="truncate text-slate-900">${h(getPaperNcrDisplayValue(snapshot.locationnoteDate))}</div></div>
                        <div class="rounded-lg border border-emerald-100 bg-emerald-50 px-1.5 py-1 text-emerald-700"><span class="uppercase tracking-[0.1em]">Location Note</span><div class="truncate text-emerald-950">${h(getPaperNcrDisplayValue(snapshot.locationnote))}</div></div>
                    </div>
                    ${editHtml}
                </div>`;
            }).join('');
            return `<div class="rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:p-4">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#007a4d]"><i class="ph-bold ph-magnifying-glass"></i><span>Item Inquiry ${h(getPaperNcrPackageLabel(pkg, context && context.approvalType || 'new-crop'))}</span></div>
                        <div class="mt-2 text-xl font-black leading-tight text-slate-900">${h(pkg.commonName || 'Unknown Item')}</div>
                        <div class="mt-0.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">${h(pkg.itemCode || '-')} | ${h(pkg.contSize || '-')} ${pkg.genus ? `| ${h(pkg.genus)}` : ''}</div>
                    </div>
                    <div class="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">${getPaperNcrPackageActiveCount(pkg)} Active / ${visibleRowCount} Row${visibleRowCount === 1 ? '' : 's'}</div>
                </div>
                ${approvalReviewMode ? '' : `<div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700" onclick="return setPaperNcrPackageAllRows(${pkgIndex}, true)">Check All</button>
                    <button type="button" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600" onclick="return setPaperNcrPackageAllRows(${pkgIndex}, false)">Clear</button>
                    <button type="button" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700" onclick="return setPaperNcrPackagePriorityForChecked(${pkgIndex}, '1')">P1 Checked</button>
                </div>`}
                <div class="mt-3 grid gap-2">${tableRowsHtml || '<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs font-bold text-slate-400">No item inquiry rows found for this item code.</div>'}</div>
            </div>`;
        }

        function syncPaperNcrPackageModalUi(options = {}) {
            const context = paperNcrPackageContext || {};
            const approvalReviewMode = context.mode === 'approval-review';
            const packages = Array.isArray(context.packages) ? context.packages : [];
            const currentIndex = Math.max(0, Math.min(Number(context.currentIndex) || 0, Math.max(0, packages.length - 1)));
            context.currentIndex = currentIndex;
            const pkg = packages[currentIndex] || null;
            const eyebrow = document.getElementById('paper-ncr-package-eyebrow');
            const title = document.getElementById('paper-ncr-package-title');
            const count = document.getElementById('paper-ncr-package-count');
            const list = document.getElementById('paper-ncr-package-list');
            const backBtn = document.getElementById('paper-ncr-package-back-btn');
            const footer = document.getElementById('paper-ncr-package-footer');
            const outboxBtn = document.getElementById('paper-ncr-package-outbox-btn');
            const submitBtn = document.getElementById('paper-ncr-package-submit-btn');
            const packageLabel = getPaperNcrPackageLabel(pkg || context, context.approvalType || 'new-crop');
            const reviewStage = approvalReviewMode ? getPaperNcrApprovalReviewStage(context) : '';
            const contextApprovalType = inferPaperNcrApprovalType(pkg || context, context.approvalType || 'new-crop');
            const isRecountReview = contextApprovalType === 'recount';
            const isFirstStageReview = approvalReviewMode && !isRecountReview && reviewStage !== 'jd' && reviewStage !== 'outbox';
            if (eyebrow) eyebrow.textContent = `Item Inquiry ${packageLabel}`;
            if (title) title.textContent = pkg ? `${pkg.commonName || 'Item'} ${approvalReviewMode ? `${packageLabel} Approval` : packageLabel}` : (approvalReviewMode ? `${packageLabel} Approval` : `Item Inquiry ${packageLabel}`);
            if (count) count.textContent = packages.length ? `Item ${currentIndex + 1} of ${packages.length} | ${getPaperNcrPackageActiveCount(pkg)} active line${getPaperNcrPackageActiveCount(pkg) === 1 ? '' : 's'}` : '';
            if (list && !options.preserveList) list.innerHTML = buildPaperNcrPackageModalHtml(pkg, currentIndex, context);
            if (backBtn) backBtn.textContent = currentIndex > 0 ? 'Back' : 'Cancel';
            if (footer) {
                footer.classList.toggle('grid-cols-2', !approvalReviewMode);
                footer.classList.toggle('grid-cols-1', approvalReviewMode);
                footer.classList.toggle('sm:grid-cols-3', approvalReviewMode);
            }
            if (outboxBtn) {
                const showOutbox = approvalReviewMode && !isRecountReview && currentIndex >= packages.length - 1;
                outboxBtn.classList.toggle('hidden', !showOutbox);
                outboxBtn.textContent = paperNcrPackageSubmitting
                    ? 'Saving...'
                    : (isFirstStageReview ? `Approve ${packageLabel} To JD` : `Add To ${packageLabel} Session`);
                outboxBtn.disabled = !!paperNcrPackageSubmitting;
                outboxBtn.classList.toggle('opacity-60', !!paperNcrPackageSubmitting);
            }
            if (submitBtn) {
                const showSubmit = !isFirstStageReview;
                submitBtn.classList.toggle('hidden', !showSubmit);
                submitBtn.textContent = currentIndex < packages.length - 1 ? 'Next Item' : (paperNcrPackageSubmitting ? (approvalReviewMode ? 'Sending...' : 'Submitting...') : (approvalReviewMode ? 'Send Now' : `Submit ${packageLabel}`));
                submitBtn.disabled = !!paperNcrPackageSubmitting;
                submitBtn.classList.toggle('opacity-60', !!paperNcrPackageSubmitting);
            }
        }

        function openPaperNcrPackageModal(rows = [], options = {}) {
            const safeRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
            if (!safeRows.length) {
                showToast('Package Empty', 'Select at least one row for the item inquiry package.', true);
                return false;
            }
            const requester = options && options.requester ? options.requester : (getCurrentNcrApprovalRequesterEntry() || {
                username: String(currentUser || '').trim(),
                display: String(firstNonEmptyValue(currentUserDisplay, currentUser, '') || '').trim(),
                email: resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            });
            const createdAt = new Date().toISOString();
            const approvalType = inferPaperNcrApprovalType({
                type: firstNonEmptyValue(options && options.approvalType, ''),
                activeRows: [{ actionType: getPaperNcrRowActionFromAppAction(options && options.action || 'ncr') }]
            }, 'new-crop');
            const groups = new Map();
            safeRows.forEach((row) => {
                const itemCode = getItemInquiryItemCode(row);
                if (!itemCode) return;
                if (!groups.has(itemCode)) groups.set(itemCode, []);
                groups.get(itemCode).push(row);
            });
            const packages = Array.from(groups.values()).map((groupRows) => buildPaperNcrPackageDraft(groupRows[0], groupRows, {
                createdAt,
                action: options && options.action ? options.action : 'ncr',
                approvalType,
                requestedByUsername: firstNonEmptyValue(options && options.requestedByUsername, requester && requester.username, currentUser, ''),
                requestedByDisplay: firstNonEmptyValue(options && options.requestedByDisplay, requester && requester.display, currentUserDisplay, currentUser, ''),
                requestedByEmail: firstNonEmptyValue(options && options.requestedByEmail, requester && requester.email, resolveRequestRecipientEmail(currentUser || currentUserDisplay || ''), '')
            })).filter(Boolean);
            if (!packages.length) {
                showToast('Package Unavailable', 'No item-code inventory rows were available for the item inquiry package.', true);
                return false;
            }
            paperNcrPackageContext = {
                packages,
                currentIndex: 0,
                requester,
                approvalMessage: String(firstNonEmptyValue(options && options.approvalMessage, options && options.reason, '') || '').trim(),
                approvalType,
                approvalAvNote: String(firstNonEmptyValue(options && options.approvalAvNote, options && options.avNote, '') || '').trim(),
                photoUrls: Array.isArray(options && options.photoUrls) ? options.photoUrls : [],
                allowMissingPhoto: options && Object.prototype.hasOwnProperty.call(options, 'allowMissingPhoto') ? options.allowMissingPhoto : true,
                allowMissingAvNote: options && Object.prototype.hasOwnProperty.call(options, 'allowMissingAvNote') ? options.allowMissingAvNote : true,
                afterSubmit: options && typeof options.afterSubmit === 'function' ? options.afterSubmit : null,
                clearSelection: options && options.clearSelection !== false,
                createdAt,
                selectionKind: String(firstNonEmptyValue(options && options.selectionKind, getBloomDirectShareSelectionKind(safeRows), 'inventory') || 'inventory').trim()
            };
            paperNcrPackageSubmitting = false;
            closeBloomEmailPurposeModal();
            closeBloomActionRowFormModal();
            toggleCartPanel(false);
            const modal = document.getElementById('paper-ncr-package-modal');
            if (modal) modal.classList.remove('hidden');
            syncPaperNcrPackageModalUi();
            return false;
        }

        function closePaperNcrPackageModal() {
            const modal = document.getElementById('paper-ncr-package-modal');
            if (modal) modal.classList.add('hidden');
            paperNcrPackageContext = null;
            paperNcrPackageSubmitting = false;
            return false;
        }

        function handlePaperNcrPackageBack() {
            persistCurrentPaperNcrPackageDraft();
            const context = paperNcrPackageContext;
            if (!context) return closePaperNcrPackageModal();
            if ((Number(context.currentIndex) || 0) > 0) {
                context.currentIndex -= 1;
                syncPaperNcrPackageModalUi();
                return false;
            }
            return closePaperNcrPackageModal();
        }

        function togglePaperNcrLine(pkgIndex = 0, rowIndex = 0, checked = false) {
            persistCurrentPaperNcrPackageDraft();
            const context = paperNcrPackageContext;
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            if (!pkg || !pkg.rowStates || !pkg.rowStates[rowIndex]) return false;
            pkg.rowStates[rowIndex].checked = !!checked;
            if (checked) {
                const snapshot = pkg.allRows && pkg.allRows[rowIndex] ? pkg.allRows[rowIndex] : {};
                const packageApprovalType = inferPaperNcrApprovalType(pkg, context && context.approvalType || 'new-crop');
                if (!String(pkg.rowStates[rowIndex].actionType || '').trim()) {
                    pkg.rowStates[rowIndex].actionType = getPaperNcrDefaultRowActionForApprovalType(packageApprovalType);
                } else {
                    pkg.rowStates[rowIndex].actionType = resolvePaperNcrRowActionForApprovalType(pkg.rowStates[rowIndex].actionType, packageApprovalType);
                }
                if (pkg.rowStates[rowIndex].actionType === 'move-up') {
                    if (!String(pkg.rowStates[rowIndex].moveUpQty || '').trim()) {
                        pkg.rowStates[rowIndex].moveUpQty = String(firstNonEmptyValue(pkg.rowStates[rowIndex].ncrQty, '') || '').trim();
                    }
                    if (pkg.rowStates[rowIndex].moveUpQty) pkg.rowStates[rowIndex].ncrQty = pkg.rowStates[rowIndex].moveUpQty;
                }
                if (!String(pkg.rowStates[rowIndex].ncrNote || '').trim()) {
                    pkg.rowStates[rowIndex].ncrNote = buildPaperNcrDefaultNote(snapshot, getPaperNcrPrimaryQtyForAction(pkg.rowStates[rowIndex], pkg.rowStates[rowIndex].actionType), context.createdAt || new Date(), pkg.rowStates[rowIndex].actionType);
                }
                if (!String(pkg.rowStates[rowIndex].locationnote || '').trim()) {
                    pkg.rowStates[rowIndex].locationnote = pkg.rowStates[rowIndex].ncrNote;
                }
            }
            syncPaperNcrPackageModalUi();
            return false;
        }

        function setPaperNcrLineAction(pkgIndex = 0, rowIndex = 0, actionType = 'ncr') {
            persistCurrentPaperNcrPackageDraft();
            const context = paperNcrPackageContext;
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            if (!pkg || !pkg.rowStates || !pkg.rowStates[rowIndex]) return false;
            const state = pkg.rowStates[rowIndex];
            const snapshot = pkg.allRows && pkg.allRows[rowIndex] ? pkg.allRows[rowIndex] : {};
            const availableQty = String(firstNonEmptyValue(snapshot.ptravailable, state.ncrQty, '') || '').trim();
            state.checked = true;
            state.actionType = normalizePaperNcrRowAction(actionType);
            if (state.actionType === 'move-down') {
                state.moveDownSeason = normalizePaperNcrMoveDownSeason(state.moveDownSeason || getPaperNcrDefaultMoveSeason());
                state.priority = '';
                if (availableQty) state.ncrQty = availableQty;
                if (!String(state.moveDownQty || '').trim()) state.moveDownQty = String(firstNonEmptyValue(availableQty, state.ncrQty, '') || '').trim();
            }
            if (state.actionType === 'move-up' && !String(state.moveUpQty || '').trim()) {
                state.moveUpQty = String(firstNonEmptyValue(state.ncrQty, '') || '').trim();
            }
            if (state.actionType === 'move-up' && state.moveUpQty) state.ncrQty = state.moveUpQty;
            refreshPaperNcrStateAutoNoteForAction(state, snapshot, context && context.createdAt || new Date());
            syncPaperNcrPackageModalUi();
            return false;
        }

        function updatePaperNcrLineAutoNote(pkgIndex = 0, rowIndex = 0) {
            const context = paperNcrPackageContext;
            persistCurrentPaperNcrPackageDraft(context);
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            const state = pkg && pkg.rowStates ? pkg.rowStates[rowIndex] : null;
            if (!pkg || !state) return false;
            const snapshot = pkg.allRows && pkg.allRows[rowIndex] ? pkg.allRows[rowIndex] : {};
            refreshPaperNcrStateAutoNoteForAction(state, snapshot, context && context.createdAt || pkg.createdAt || new Date());
            const container = document.getElementById('paper-ncr-package-list');
            if (container) {
                ['locationnote', 'ncrNote'].forEach((field) => {
                    const el = container.querySelector(`[data-paper-ncr-row="${rowIndex}"][data-paper-ncr-field="${field}"]`);
                    if (el && String(el.value || '') !== String(state[field] || '')) el.value = String(state[field] || '');
                });
            }
            return false;
        }

        function setPaperNcrPackageAllRows(pkgIndex = 0, checked = true) {
            persistCurrentPaperNcrPackageDraft();
            const context = paperNcrPackageContext;
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            if (!pkg || !Array.isArray(pkg.rowStates)) return false;
            const packageApprovalType = inferPaperNcrApprovalType(pkg, context && context.approvalType || 'new-crop');
            const defaultAction = getPaperNcrDefaultRowActionForApprovalType(packageApprovalType);
            pkg.rowStates.forEach((state) => {
                state.checked = !!checked;
                if (checked && !String(state.actionType || '').trim()) state.actionType = defaultAction;
                if (checked) state.actionType = resolvePaperNcrRowActionForApprovalType(state.actionType, packageApprovalType);
            });
            syncPaperNcrPackageModalUi();
            return false;
        }

        function setPaperNcrPackagePriorityForChecked(pkgIndex = 0, priority = '1') {
            persistCurrentPaperNcrPackageDraft();
            const context = paperNcrPackageContext;
            const pkg = context && context.packages ? context.packages[pkgIndex] : null;
            if (!pkg || !Array.isArray(pkg.rowStates)) return false;
            pkg.rowStates.forEach((state) => {
                if (state && state.checked) {
                    state.priority = normalizePaperNcrPriorityForAction(priority, state.actionType || 'ncr');
                }
            });
            syncPaperNcrPackageModalUi();
            return false;
        }

        function validatePaperNcrPackage(pkg = null, index = 0) {
            if (!pkg) return 'Item inquiry package was not found.';
            if (!getPaperNcrPackageActiveCount(pkg)) return `${pkg.commonName || `Item ${index + 1}`} needs at least one checked active line.`;
            const states = Array.isArray(pkg.rowStates) ? pkg.rowStates : [];
            for (let rowIndex = 0; rowIndex < states.length; rowIndex += 1) {
                const state = states[rowIndex];
                if (!state || !state.checked) continue;
                const rowLabel = `row ${rowIndex + 1}`;
                const action = normalizePaperNcrRowAction(state.actionType || 'ncr');
                if (action === 'move-up') {
                    const qtyNumber = parseAppNumber(state.moveUpQty);
                    if (String(state.moveUpQty || '').trim() === '' || qtyNumber === null || qtyNumber < 0) {
                        return `${pkg.commonName || `Item ${index + 1}`} ${rowLabel} needs a valid Move Up Qty.`;
                    }
                }
                if (action === 'move-down') {
                    const qtyNumber = parseAppNumber(state.moveDownQty);
                    if (String(state.moveDownQty || '').trim() === '' || qtyNumber === null || qtyNumber < 0) {
                        return `${pkg.commonName || `Item ${index + 1}`} ${rowLabel} needs a valid Move Down Qty.`;
                    }
                    if (!getPaperNcrMoveDownSeasonOptions().includes(normalizePaperNcrMoveDownSeason(state.moveDownSeason))) {
                        return `${pkg.commonName || `Item ${index + 1}`} ${rowLabel} needs a Move Down season.`;
                    }
                }
                const clearsHoldStop = action === 'off-hold' || action === 'off-stop';
                if (!clearsHoldStop) {
                    const originalHoldStopCode = normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(
                        state.originalHoldStopCode,
                        state.original_holdstopcode,
                        ''
                    ));
                    const requestedHoldStopCode = normalizeBloomActionHoldStopCodeChoice(firstNonEmptyValue(
                        state.holdStopCode,
                        state.holdstopcode,
                        state.HOLDSTOPCODE,
                        ''
                    ));
                    const requestedHoldStopReason = normalizeBloomActionHoldStopReasonValue(firstNonEmptyValue(
                        state.holdStopReason,
                        state.holdstopreason,
                        state.HOLDSTOPREASON,
                        ''
                    ));
                    if (requestedHoldStopCode && requestedHoldStopCode !== originalHoldStopCode && !requestedHoldStopReason) {
                        return `${pkg.commonName || `Item ${index + 1}`} ${rowLabel} needs a Hold/Stop Reason when changing Hold/Stop Code.`;
                    }
                }
            }
            return '';
        }

        async function submitPaperNcrPackagesToApproval(packages = [], context = paperNcrPackageContext) {
            const requester = context && context.requester ? context.requester : (getCurrentNcrApprovalRequesterEntry() || {
                username: String(currentUser || '').trim(),
                display: String(firstNonEmptyValue(currentUserDisplay, currentUser, '') || '').trim(),
                email: resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            });
            let submittedCount = 0;
            for (let index = 0; index < packages.length; index += 1) {
                const pkg = packages[index];
                const packagePayload = buildPaperNcrPackagePayload(pkg);
                if (!packagePayload || !packagePayload.activeRows.length) continue;
                const approvalType = inferPaperNcrApprovalType(packagePayload, context && context.approvalType || packagePayload.type || 'new-crop');
                const packageLabel = getPaperNcrPackageLabel(packagePayload, approvalType);
                const anchor = pkg.anchorItem
                    || (pkg.anchorUid ? findItemByUniqueId(pkg.anchorUid) : null)
                    || (packagePayload.anchorUid ? findItemByUniqueId(packagePayload.anchorUid) : null);
                if (!anchor) throw new Error(`Could not find the anchor row for ${packagePayload.commonName || packagePayload.itemCode}.`);
                const messageParts = [
                    String(firstNonEmptyValue(context && context.approvalMessage, '') || '').trim(),
                    `Item inquiry ${packageLabel} package: ${packagePayload.activeRows.length} active line${packagePayload.activeRows.length === 1 ? '' : 's'} / ${packagePayload.allRows.length} item inquiry row${packagePayload.allRows.length === 1 ? '' : 's'}.`
                ].filter(Boolean);
                await submitNcrApprovalToDylan(anchor, approvalType, {
                    requester,
                    requestedByEmail: firstNonEmptyValue(requester && requester.email, resolveRequestRecipientEmail(currentUser || currentUserDisplay || ''), ''),
                    requestedByUsername: firstNonEmptyValue(requester && requester.username, currentUser, ''),
                    requestedByDisplay: firstNonEmptyValue(requester && requester.display, currentUserDisplay, currentUser, ''),
                    approvalMessage: messageParts.join('\n'),
                    itemInquiryPackage: packagePayload,
                    photoUrls: context && Array.isArray(context.photoUrls) ? context.photoUrls : [],
                    allowMissingPhoto: context && Object.prototype.hasOwnProperty.call(context, 'allowMissingPhoto') ? context.allowMissingPhoto : true,
                    allowMissingAvNote: context && Object.prototype.hasOwnProperty.call(context, 'allowMissingAvNote') ? context.allowMissingAvNote : true,
                    approvalAvNote: context && context.approvalAvNote ? context.approvalAvNote : '',
                    skipEmail: true,
                    dylanOnly: true
                });
                submittedCount += 1;
            }
            managerReviewInventoryDirty = true;
            moveUpInventoryDirty = true;
            markViewDirty('review');
            markViewDirty('move-up');
            markViewDirty('tasks');
            markViewDirty('managers');
            taskScopedQueueItemsCache.clear();
            taskHotStateCache.clear();
            taskResolvedStateCache = null;
            if (!submittedCount) throw new Error('No checked active lines were submitted.');
            if (!context || context.clearSelection !== false) clearSelection();
            showToast('Sent For Approval', `${submittedCount} item inquiry package${submittedCount === 1 ? '' : 's'} sent to Dylan for approval.`);
            return true;
        }

        async function submitPaperNcrPackageModal() {
            if (paperNcrPackageContext && paperNcrPackageContext.mode === 'approval-review') {
                return submitPaperNcrApprovalReviewModal();
            }
            if (paperNcrPackageSubmitting) return false;
            const context = paperNcrPackageContext;
            if (!context || !Array.isArray(context.packages) || !context.packages.length) {
                showToast('Package Empty', 'No item inquiry package is open.', true);
                return false;
            }
            persistCurrentPaperNcrPackageDraft(context);
            const currentIndex = Math.max(0, Math.min(Number(context.currentIndex) || 0, context.packages.length - 1));
            const currentError = validatePaperNcrPackage(context.packages[currentIndex], currentIndex);
            if (currentError) {
                showToast('Check Lines', currentError, true);
                return false;
            }
            if (currentIndex < context.packages.length - 1) {
                context.currentIndex = currentIndex + 1;
                syncPaperNcrPackageModalUi();
                return false;
            }
            for (let index = 0; index < context.packages.length; index += 1) {
                const error = validatePaperNcrPackage(context.packages[index], index);
                if (error) {
                    context.currentIndex = index;
                    syncPaperNcrPackageModalUi();
                    showToast('Check Lines', error, true);
                    return false;
                }
            }
            paperNcrPackageSubmitting = true;
            syncPaperNcrPackageModalUi({ preserveList: true });
            try {
                showToast('Submitting Package', `Sending ${context.packages.length} item package${context.packages.length === 1 ? '' : 's'} to Dylan.`, false);
                await submitPaperNcrPackagesToApproval(context.packages, context);
                if (context && typeof context.afterSubmit === 'function') await context.afterSubmit(context);
                closePaperNcrPackageModal();
                closeBloomEmailPurposeModal();
                closeBloomActionRowFormModal();
                toggleCartPanel(false);
            } catch (error) {
                console.error('Item inquiry package submit failed', error);
                showToast('Could Not Submit', error && error.message ? error.message : 'Could not submit the item inquiry package.', true);
                paperNcrPackageSubmitting = false;
                syncPaperNcrPackageModalUi({ preserveList: true });
            }
            return false;
        }

        async function submitBloomActionRowForm() {
            if (bloomActionRowFormSubmitting) return false;
            const context = bloomActionRowFormContext || {};
            const rows = Array.isArray(context.rows) ? context.rows.filter(Boolean) : [];
            if (!rows.length) {
                showToast('Bloom Picker Empty', 'No rows are selected.', true);
                return false;
            }
            const currentIndex = getBloomActionRowFormCurrentIndex(context);
            const currentValues = persistCurrentBloomActionRowFormDraft(context);
            const currentError = getBloomActionRowFormValidationError(currentValues || {}, currentIndex, context);
            if (currentError) {
                showBloomActionRowFormValidationError(currentError, currentIndex);
                return false;
            }
            if (currentIndex < rows.length - 1) {
                context.currentIndex = currentIndex + 1;
                syncBloomActionRowFormModalUi();
                return false;
            }
            bloomActionRowFormSubmitting = true;
            syncBloomActionRowFormModalUi({ preserveList: true });
            try {
                const action = context.action || 'general';
                if (action === 'ncr' || context.emailOnly === true) {
                    const label = action === 'ncr' ? 'NCR' : getBloomPurposeActionLabel(action);
                    showToast(action === 'ncr' ? 'Preparing Approval' : 'Preparing Email', `Preparing ${rows.length} ${label} row${rows.length === 1 ? '' : 's'}${action === 'ncr' ? ' for approval' : ' for email'}.`, false);
                } else {
                    showToast('Updating Rows', `Saving ${rows.length} row${rows.length === 1 ? '' : 's'} before sending.`, false);
                }
                const persisted = await persistBloomActionRowFormRows(context);
                if (!persisted) {
                    bloomActionRowFormSubmitting = false;
                    syncBloomActionRowFormModalUi({ preserveList: true });
                    return false;
                }
                if (typeof context.afterPersist === 'function') {
                    closeBloomActionRowFormModal();
                    closeBloomEmailPurposeModal();
                    toggleCartPanel(false);
                    return await context.afterPersist(persisted, context);
                }
                if (action === 'ncr') {
                    closeBloomActionRowFormModal();
                    closeBloomEmailPurposeModal();
                    toggleCartPanel(false);
                    return submitBloomActionNcrRowsToApproval(persisted.rows, persisted.rowOptionsByUid, {
                        approvalMessage: context.reason,
                        recipientEmails: context.recipientEmails,
                        clearSelection: true
                    });
                }
                if (action === 'move_up') {
                    closeBloomActionRowFormModal();
                    closeBloomEmailPurposeModal();
                    toggleCartPanel(false);
                    return openSelectedRowsMoveModal();
                }
                let recipientEmails = dedupeRequestEmailRecipients(context.recipientEmails || []);
                if (action === 'take_off_hold') {
                    const priorityChangeRows = await maybeCollectOffHoldPriorityChangeRows(persisted.rows, context);
                    recipientEmails = await resolveBloomActionRowFormRecipientEmails(context, persisted.rows, action, recipientEmails);
                    if (!recipientEmails.length) {
                        bloomActionRowFormSubmitting = false;
                        syncBloomActionRowFormModalUi({ preserveList: true });
                        return false;
                    }
                    const sent = await sendBloomActionReportEmailOnly(persisted.rows, {
                        action,
                        reason: context.reason,
                        recipientEmails,
                        recipientModalCompleted: context.recipientModalCompleted === true,
                        skipRecipientModal: !!recipientEmails.length,
                        skipDylanRecipientOverride: !!recipientEmails.length,
                        rowOptionsByUid: persisted.rowOptionsByUid || null,
                        offHoldPriorityChangeRows: priorityChangeRows,
                        priorityChangeRows
                    });
                    if (!sent) {
                        bloomActionRowFormSubmitting = false;
                        syncBloomActionRowFormModalUi({ preserveList: true });
                        return false;
                    }
                    closeBloomActionRowFormModal();
                    closeBloomEmailPurposeModal();
                    clearSelection();
                    toggleCartPanel(false);
                    showToast('Email Sent', `${getBloomPurposeReportTitle(action)} was sent from the app.`);
                    return false;
                }
                if (BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(action)) {
                    recipientEmails = await resolveBloomActionRowFormRecipientEmails(context, persisted.rows, action, recipientEmails);
                    if (!recipientEmails.length) {
                        bloomActionRowFormSubmitting = false;
                        syncBloomActionRowFormModalUi({ preserveList: true });
                        return false;
                    }
                    const sent = await sendBloomActionReportEmailOnly(persisted.rows, {
                        action,
                        reason: context.reason,
                        recipientEmails,
                        recipientModalCompleted: context.recipientModalCompleted === true,
                        skipRecipientModal: !!recipientEmails.length,
                        skipDylanRecipientOverride: !!recipientEmails.length,
                        rowOptionsByUid: persisted.rowOptionsByUid || null
                    });
                    if (!sent) {
                        bloomActionRowFormSubmitting = false;
                        syncBloomActionRowFormModalUi({ preserveList: true });
                        return false;
                    }
                    closeBloomActionRowFormModal();
                    closeBloomEmailPurposeModal();
                    clearSelection();
                    toggleCartPanel(false);
                    showToast('Email Sent', `${getBloomPurposeReportTitle(action)} was sent from the app.`);
                    return false;
                }
                await shareBloomPurposeEmail(persisted.rows, context.selectionKind, action, context.reason, recipientEmails);
                closeBloomActionRowFormModal();
                closeBloomEmailPurposeModal();
                clearSelection();
                toggleCartPanel(false);
                showToast('Email Sent', `${getBloomPurposeReportTitle(action)} was sent from the app.`);
            } catch (error) {
                bloomActionRowFormSubmitting = false;
                syncBloomActionRowFormModalUi({ preserveList: true });
                showToast('Send Failed', error && error.message ? error.message : 'Could not update and send the selected rows.', true);
            }
            return false;
        }

        async function sendBloomPurposeReportEmail(items = [], selectionKind = '', purpose = 'general', reason = '', recipientEmails = []) {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            const safeRecipients = dedupeRequestEmailRecipients(recipientEmails);
            if (!rows.length) throw new Error('No selected rows to email.');
            if (!safeRecipients.length) throw new Error('Select at least one recipient before sending.');
            const title = getBloomPurposeReportTitle(purpose);
            const subject = buildBloomPurposeEmailSubject(purpose, rows);
            const actionLabel = getBloomPurposeActionLabel(purpose);
            const reasonLabel = getBloomPurposeReasonLabel(purpose);
            const submittedBy = String(firstNonEmptyValue(currentUserDisplay, currentUser, 'Unknown') || 'Unknown').trim();
            const first = getBloomPurposeReportRow(rows[0] || {});
            const customer = first.customer && first.customer !== '-' ? first.customer : 'N/A';
            const payloadItems = buildBloomPurposePayloadItems(rows);
            const payload = {
                type: 'email',
                emailType: 'bloom_purpose_report',
                subject,
                brandLabel: title,
                fromName: title,
                emailDisplayName: title,
                sourceLabel: title,
                actionLabel,
                reasonLabel,
                reason,
                message: reason,
                userMessage: reason,
                customer,
                itemsCount: rows.length,
                requestItems: payloadItems,
                sourceRows: payloadItems,
                items: payloadItems,
                formattedItemsText: buildBloomPurposeEmailText(rows, selectionKind, purpose, reason, safeRecipients),
                formattedItemsHtml: buildBloomPurposeEmailHtml(rows, selectionKind, purpose),
                recipientEmails: safeRecipients,
                emailRecipients: safeRecipients,
                recipients: safeRecipients,
                requestedBy: String(currentUser || '').trim(),
                requestedByDisplay: submittedBy,
                submittedBy
            };
            const responseData = await postGoogleScriptEmailPayload(payload, REQUEST_EMAIL_SCRIPT_TIMEOUT_MS, `${title} Email`);
            if (!responseData || responseData.ok !== true) {
                throw new Error(getGoogleScriptEmailFailureMessage(responseData, `${title} email did not send.`));
            }
            return responseData;
        }

        async function sendPaperInquiryActionReportEmailOnly(items = [], options = {}) {
            const safeOptions = options || {};
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            const action = String(safeOptions.action || safeOptions.purpose || 'ncr').trim() || 'ncr';
            const actionType = getPaperInquiryReportActionFromBloomAction(action) || 'ncr';
            const actionLabel = getPaperNcrRowActionLabel(actionType);
            if (!rows.length) throw new Error('No selected rows to email.');
            const defaultRecipientEmails = dedupeRequestEmailRecipients([
                ...getInventoryTransactionRequiredRecipientEmails(),
                resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            ]);
            const optionRecipientEmails = dedupeRequestEmailRecipients([
                ...(Array.isArray(safeOptions.recipientEmails) ? safeOptions.recipientEmails : [safeOptions.recipientEmails].filter(Boolean)),
                ...(Array.isArray(safeOptions.emailRecipients) ? safeOptions.emailRecipients : [safeOptions.emailRecipients].filter(Boolean)),
                ...(Array.isArray(safeOptions.recipients) ? safeOptions.recipients : [safeOptions.recipients].filter(Boolean))
            ]);
            if (safeOptions.recipientModalCompleted === true && !optionRecipientEmails.length) {
                showToast('Select Recipients', 'The recipient selection did not carry into the send step. Select the row again and choose the recipients before continuing.', true);
                return false;
            }
            const recipientModalOptions = {
                brandLabel: `GNC PH ${actionLabel}`,
                title: `Select ${actionLabel} Email Recipients`
            };
            const selectedRecipientEmails = (safeOptions.skipRecipientModal === true || safeOptions.recipientModalCompleted === true) && optionRecipientEmails.length
                ? optionRecipientEmails
                : await openGroupedBloomNcrRecipientModal(rows, optionRecipientEmails.length ? optionRecipientEmails : defaultRecipientEmails, recipientModalOptions);
            const safeRecipients = dedupeRequestEmailRecipients([
                ...(selectedRecipientEmails || []),
                ...defaultRecipientEmails
            ]);
            if (!safeRecipients || !safeRecipients.length) return false;
            const pkg = buildPaperNcrPackageFromBloomActionRows(rows, {
                ...safeOptions,
                action,
                rowAction: actionType
            });
            if (!pkg || !pkg.activeRows || !pkg.activeRows.length) {
                throw new Error(`No ${actionLabel} rows were ready to email.`);
            }
            showToast('Sending...', `Sending ${pkg.activeRows.length} ${actionLabel} row${pkg.activeRows.length === 1 ? '' : 's'} by email.`, false);
            const responseData = await sendPaperNcrPackageFinalEmail(rows[0] || null, pkg, {
                recipientEmails: safeRecipients,
                skipDylanRecipientOverride: true
            });
            if (safeOptions.clearSelection === true) clearSelection();
            showToast('Email Sent', `${actionLabel} email sent for ${pkg.activeRows.length} row${pkg.activeRows.length === 1 ? '' : 's'}.`);
            return responseData;
        }

        async function sendBloomActionReportEmailOnly(items = [], options = {}) {
            const safeOptions = options || {};
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            const action = String(safeOptions.action || safeOptions.purpose || 'hold').trim() || 'hold';
            if (!rows.length) throw new Error('No selected rows to email.');
            if (shouldUsePaperInquiryReportEmailForAction(action)) {
                return sendPaperInquiryActionReportEmailOnly(rows, safeOptions);
            }
            const defaultRecipientEmails = dedupeRequestEmailRecipients([
                ...getInventoryTransactionRequiredRecipientEmails(),
                resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            ]);
            const optionRecipientEmails = dedupeRequestEmailRecipients([
                ...(Array.isArray(safeOptions.recipientEmails) ? safeOptions.recipientEmails : [safeOptions.recipientEmails].filter(Boolean)),
                ...(Array.isArray(safeOptions.emailRecipients) ? safeOptions.emailRecipients : [safeOptions.emailRecipients].filter(Boolean)),
                ...(Array.isArray(safeOptions.recipients) ? safeOptions.recipients : [safeOptions.recipients].filter(Boolean))
            ]);
            const selectedRecipientEmails = safeOptions.skipRecipientModal === true && optionRecipientEmails.length
                ? optionRecipientEmails
                : await openGroupedBloomNcrRecipientModal(rows, optionRecipientEmails.length ? optionRecipientEmails : defaultRecipientEmails);
            const safeRecipients = dedupeRequestEmailRecipients([
                ...(selectedRecipientEmails || []),
                ...defaultRecipientEmails
            ]);
            if (!safeRecipients || !safeRecipients.length) return false;
            const title = getBloomPurposeReportTitle(action);
            const subject = buildBloomPurposeEmailSubject(action, rows);
            const reason = String(firstNonEmptyValue(safeOptions.reason, safeOptions.message, '') || '').trim();
            const submittedBy = String(firstNonEmptyValue(currentUserDisplay, currentUser, 'Unknown') || 'Unknown').trim();
            const first = getBloomPurposeReportRow(rows[0] || {});
            const customer = first.customer && first.customer !== '-' ? first.customer : 'N/A';
            const payloadItems = buildBloomPurposePayloadItems(rows);
            const payload = {
                type: 'email',
                emailType: 'bloom_purpose_report',
                emailSubType: 'bloom_action_report',
                email_sub_type: 'bloom_action_report',
                subject,
                brandLabel: title,
                fromName: title,
                emailDisplayName: title,
                sourceLabel: title,
                actionLabel: getBloomPurposeActionLabel(action),
                reasonLabel: getBloomPurposeReasonLabel(action),
                reason,
                message: reason,
                userMessage: reason,
                customer,
                itemsCount: rows.length,
                requestItems: payloadItems,
                sourceRows: payloadItems,
                items: payloadItems,
                formattedItemsText: buildBloomActionReportEmailText(rows, {
                    action,
                    reason,
                    rowOptionsByUid: safeOptions.rowOptionsByUid || null,
                    submittedBy
                }),
                formattedItemsHtml: buildBloomActionReportEmailHtml(rows, {
                    action,
                    reason,
                    rowOptionsByUid: safeOptions.rowOptionsByUid || null,
                    submittedBy
                }),
                recipientEmails: safeRecipients,
                emailRecipients: safeRecipients,
                recipients: safeRecipients,
                requestedBy: String(currentUser || '').trim(),
                requestedByDisplay: submittedBy,
                submittedBy,
                emailOnlyReport: true,
                email_only_report: true
            };
            const responseData = await postGoogleScriptEmailPayload(payload, REQUEST_EMAIL_SCRIPT_TIMEOUT_MS, `${title} Email`);
            if (!responseData || responseData.ok !== true) {
                throw new Error(getGoogleScriptEmailFailureMessage(responseData, `${title} email did not send.`));
            }
            if (safeOptions.clearSelection === true) clearSelection();
            return responseData;
        }

        async function shareBloomPurposeEmail(items = [], selectionKind = '', purpose = 'general', reason = '', recipientEmails = []) {
            const subject = buildBloomPurposeEmailSubject(purpose, items);
            const safeRecipients = dedupeRequestEmailRecipients(recipientEmails);
            if (isBloomEmailPurposeRecipientRequired(purpose)) {
                return sendBloomPurposeReportEmail(items, selectionKind, purpose, reason, safeRecipients);
            }
            const text = buildBloomPurposeEmailText(items, selectionKind, purpose, reason, safeRecipients);
            try {
                await copyTextWithFallback(text);
            } catch (copyErr) { globalThis.reportHandledRuntimeIssue?.("shareBloomPurposeEmail", 'HANDLED_OPERATION_FAILURE'); }
            const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
            try {
                const shared = await handleMobileShare('email', subject, text);
                if (!shared) window.location.href = mailtoHref;
                clearSelection();
                toggleCartPanel(false);
                showToast('Email Ready', 'The selected card details are ready to send.');
                return true;
            } catch (error) {
                window.location.href = mailtoHref;
                clearSelection();
                toggleCartPanel(false);
                showToast('Email Ready', 'The selected card details are ready to send.');
                return true;
            }
        }

        function buildShearListAddedReportRows(payloads = [], itemsByUniqueId = new Map()) {
            return (Array.isArray(payloads) ? payloads : []).filter(Boolean).map((payload) => {
                const sourceItem = itemsByUniqueId && typeof itemsByUniqueId.get === 'function'
                    ? (itemsByUniqueId.get(payload.unique_id) || null)
                    : null;
                const snapshot = payload && payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
                const row = {
                    ...(sourceItem || {}),
                    ...(payload || {})
                };
                row.ITEMCODE = String(firstNonEmptyValue(payload.itemcode, row.ITEMCODE, row.itemcode, '') || '').trim();
                row.itemcode = row.ITEMCODE;
                row.COMMONNAME = String(firstNonEmptyValue(payload.commonname, row.COMMONNAME, row.commonname, '') || '').trim();
                row.commonname = row.COMMONNAME;
                row.CONTSIZE = String(firstNonEmptyValue(payload.contsize, row.CONTSIZE, row.contsize, '') || '').trim();
                row.contsize = row.CONTSIZE;
                row.LOTCODE = String(firstNonEmptyValue(payload.lotcode, row.LOTCODE, row.lotcode, '') || '').trim();
                row.lotcode = row.LOTCODE;
                row.LOCATIONCODE = String(firstNonEmptyValue(payload.locationcode, row.LOCATIONCODE, row.locationcode, '') || '').trim();
                row.locationcode = row.LOCATIONCODE;
                row.PTRAVAILABLE = String(firstNonEmptyValue(payload.ptravailable, row.PTRAVAILABLE, row.ptravailable, '') || '').trim();
                row.ptravailable = row.PTRAVAILABLE;
                row.PERCENT_TO_SHEAR = String(firstNonEmptyValue(payload.percent_to_shear, row.PERCENT_TO_SHEAR, row.percent_to_shear, snapshot.percent_to_shear, '') || '').trim();
                row.percent_to_shear = row.PERCENT_TO_SHEAR;
                row.SHEAR_TYPE = normalizeShearListType(firstNonEmptyValue(row.SHEAR_TYPE, row.shear_type, snapshot.shear_type, snapshot.shearType, ''));
                row.shear_type = row.SHEAR_TYPE;
                return row;
            }).filter((row) => row.ITEMCODE || row.COMMONNAME || row.LOTCODE || row.PTRAVAILABLE || row.PERCENT_TO_SHEAR || row.SHEAR_TYPE);
        }

        async function sendShearListAddedReportEmail(payloads = [], itemsByUniqueId = new Map(), options = {}) {
            const rows = buildShearListAddedReportRows(payloads, itemsByUniqueId);
            if (!rows.length) return false;
            const safeOptions = options && typeof options === 'object' ? options : {};
            const defaultRecipientEmails = dedupeRequestEmailRecipients([
                ...BLOOM_CROP_UPDATE_INTERNAL_RECIPIENTS,
                resolveRequestRecipientEmail(currentUser || currentUserDisplay || '')
            ]);
            const pickedEmails = safeOptions.skipRecipientModal === true
                ? defaultRecipientEmails
                : await openGroupedBloomNcrRecipientModal(rows, defaultRecipientEmails, {
                    brandLabel: 'GNC PH Shear List',
                    title: 'Select Shear List Recipients'
                });
            const recipientEmails = dedupeRequestEmailRecipients(pickedEmails || []);
            if (!recipientEmails.length) return false;
            showToast('Sending Email', `Sending Shear List report for ${rows.length} row${rows.length === 1 ? '' : 's'}.`, false);
            await sendBloomPurposeReportEmail(rows, 'inventory', 'shear', '', recipientEmails);
            return true;
        }

        function sendBloomEmailPurpose() {
            if (bloomEmailPurposeSending) return false;
            if (BLOOM_EMAIL_PURPOSE_RECLASS_ONLY_ACTIONS.has(bloomEmailPurposeAction)) {
                showToast('Use Reclass', 'Send this request from the Reclass transaction card.', true);
                bloomEmailPurposeAction = 'general';
                syncBloomEmailPurposeModalUi();
                return false;
            }
            const rows = getBloomEmailPurposeRowsForShare();
            if (!rows.length) {
                showToast('Bloom Picker Empty', 'Add one or more rows to Bloom Picker first.', true);
                return false;
            }
            if (bloomEmailPurposeAction === 'crop_update') {
                if (bloomEmailPurposeSelectionKind === 'inventory' && canUseBloomCropUpdateEmail(rows)) {
                    closeBloomEmailPurposeModal();
                    return openBloomCropUpdateModal(rows);
                }
                showToast('Crop Update Unavailable', 'Crop update email is only available for Drive Mode rows.', true);
                return false;
            }
            if (bloomEmailPurposeAction === 'shift') {
                if (bloomEmailPurposeSelectionKind === 'inventory' && canUseBloomCropUpdateEmail(rows)) {
                    closeBloomEmailPurposeModal();
                    return openBloomCropUpdateModal(rows, { emailContext: buildDriveShiftEmailContext(rows) });
                }
                showToast('Shift Unavailable', 'Shift email is only available for eligible Drive Mode rows.', true);
                return false;
            }
            if (bloomEmailPurposeAction === 'ncr') {
                const visibility = getBloomEmailPurposeActionVisibility(rows);
                if (!visibility.showNcr) {
                    showToast('NCR Unavailable', 'Only eligible inventory rows can be sent as NCR from Bloom Picker.', true);
                    return false;
                }
                return openPaperNcrPackageModal(rows, {
                    action: 'ncr',
                    selectionKind: bloomEmailPurposeSelectionKind,
                    clearSelection: true
                });
            }
            if (bloomEmailPurposeAction === 'move_up') {
                const visibility = getBloomEmailPurposeActionVisibility(rows);
                if (!visibility.showMoveUp) {
                    showToast('Move Up Unavailable', 'Only eligible inventory rows can be sent to Move Up from Bloom Picker.', true);
                    return false;
                }
                return openBloomActionRowFormModal(rows, {
                    action: 'move_up',
                    selectionKind: bloomEmailPurposeSelectionKind,
                    emailOnly: true,
                    afterPersist: async (persisted) => {
                        const persistedRows = persisted && Array.isArray(persisted.rows) ? persisted.rows.filter(Boolean) : rows;
                        return await sendPaperInquiryActionReportEmailOnly(persistedRows, {
                            action: 'move_up',
                            rowOptionsByUid: persisted && persisted.rowOptionsByUid ? persisted.rowOptionsByUid : null,
                            clearSelection: true
                        });
                    }
                });
            }
            const reasonEl = document.getElementById('bloom-email-purpose-reason');
            const reason = reasonEl ? String(reasonEl.value || '').trim() : '';
            if (isBloomEmailPurposeReasonRequired() && !reason) {
                showToast('Reason Required', 'Enter a hold or stop ship reason before sending.', true);
                if (reasonEl) {
                    try { reasonEl.focus({ preventScroll: true }); } catch (err) { reasonEl.focus(); }
                }
                return false;
            }
            const collectRecipientsNow = shouldCollectBloomEmailPurposeRecipientsBeforeAction();
            const recipientOptions = collectRecipientsNow ? getBloomEmailPurposeSelectedRecipientOptions() : [];
            if (collectRecipientsNow && !recipientOptions.length) {
                showToast('Select Recipients', 'Select who needs to receive this email before sending.', true);
                syncBloomEmailPurposeRecipientUi();
                const recipientSearch = document.getElementById('bloom-email-purpose-recipient-search');
                if (recipientSearch) {
                    try { recipientSearch.focus({ preventScroll: true }); } catch (err) { recipientSearch.focus(); }
                }
                return false;
            }
            const action = bloomEmailPurposeAction;
            const selectionKind = bloomEmailPurposeSelectionKind;
            const recipientEmails = recipientOptions.map((option) => option.email);
            if (BLOOM_ACTION_ROW_FORM_PURPOSES.has(action)) {
                return openBloomActionRowFormModal(rows, {
                    action,
                    selectionKind,
                    reason,
                    recipientEmails,
                    emailRecipients: recipientEmails,
                    recipients: recipientEmails,
                    recipientModalCompleted: collectRecipientsNow,
                    emailOnly: BLOOM_EMAIL_PURPOSE_REPORT_ACTIONS.has(action)
                });
            }
            const mustSendInApp = isBloomEmailPurposeRecipientRequired(action);
            bloomEmailPurposeSending = true;
            syncBloomEmailPurposeModalUi();
            showToast(mustSendInApp ? 'Sending Email' : 'Preparing Email', mustSendInApp ? `Sending ${getBloomPurposeReportTitle(action)} from the app.` : 'Preparing selected row details.');
            shareBloomPurposeEmail(rows, selectionKind, action, reason, recipientEmails).then(() => {
                bloomEmailPurposeSending = false;
                closeBloomEmailPurposeModal();
                if (mustSendInApp) {
                    clearSelection();
                    toggleCartPanel(false);
                    showToast('Email Sent', `${getBloomPurposeReportTitle(action)} was sent from the app.`);
                }
            }).catch((error) => {
                bloomEmailPurposeSending = false;
                syncBloomEmailPurposeModalUi();
                showToast('Email Failed', error && error.message ? error.message : 'Could not send the email.', true);
            });
            return false;
        }

        function toggleBloomShareMenu(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const actionVisibility = getBloomPickerActionVisibility(getCartSelectedItems());
            if (!selectedItems.size || !(actionVisibility.showCopy || actionVisibility.showEmail || actionVisibility.showText)) {
                bloomShareMenuOpen = false;
                syncBloomShareMenuUi(actionVisibility);
                return false;
            }
            bloomShareMenuOpen = !bloomShareMenuOpen;
            syncBloomShareMenuUi(actionVisibility);
            return false;
        }

        function getBloomDirectShareSelectionKind(items = getCartSelectedItems()) {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!rows.length) return 'empty';
            const requestOnly = rows.every((item) => isRequestLikeItem(item));
            if (requestOnly) return 'request';
            const docksOnly = rows.every((item) => isDockLikeItem(item));
            if (docksOnly) return 'docks';
            const inventoryLikeOnly = rows.every((item) => !isRequestLikeItem(item) && !isDockLikeItem(item));
            if (inventoryLikeOnly) return 'inventory';
            return 'mixed';
        }

        function executeBloomDirectShareAction(action) {
            const items = getCartSelectedItems();
            if (!items.length) {
                showToast('Bloom Picker Empty', 'Add one or more rows to Bloom Picker first.', true);
                return false;
            }
            const selectionKind = getBloomDirectShareSelectionKind(items);
            if (selectionKind === 'mixed') {
                showToast('Share One Type', 'Share one row type at a time from Bloom Picker.', true);
                return false;
            }
            const batchActionOptions = {
                preferBloomTextPhotoAttachments: action === 'text' && canUseBloomPicker(items)
            };
            if (action === 'email') {
                return openBloomEmailPurposeModal(items, selectionKind);
            }
            toggleCartPanel(false);
            if (selectionKind === 'request') {
                void executeBatchAction(action, 'request', batchActionOptions);
                return false;
            }
            if (selectionKind === 'docks') {
                void executeBatchAction(action, 'docks', batchActionOptions);
                return false;
            }
            if (selectionKind === 'inventory') {
                void executeBatchAction(action, 'inventory', batchActionOptions);
                return false;
            }
            showToast('Share Unavailable', 'Those Bloom Picker rows cannot be shared right now.', true);
            return false;
        }

        function handleBloomShareMenuSelection(event, action) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            bloomShareMenuOpen = false;
            syncBloomShareMenuUi();
            return executeBloomDirectShareAction(action);
        }
