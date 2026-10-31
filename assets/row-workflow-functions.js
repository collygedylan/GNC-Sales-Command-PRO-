async function uploadDrivePhotoWithNativeSession(formData, options = {}) {
            const prefix = String(formData.get('prefix') || '');
            if (!SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix)) throw new Error('Native photo upload requires a Drive evidence row.');
            const masterUid = String(formData.get('masterUid') || '').trim();
            if (!masterUid) throw new Error('Exact Drive row identity is required.');
            const headers = await getNativeAuthRequestHeaders();
            if (!headers?.Authorization) throw nativeSessionRecoveryError();
            if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
            const file = formData.get('file');
            const bytes = await file.arrayBuffer();
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
            const uidHex = Array.from(new TextEncoder().encode(masterUid), value => value.toString(16).padStart(2, '0')).join('');
            const extension = file.type === 'image/webp' ? 'webp' : 'jpg';
            const bucketName = PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default;
            const base = 'drive-evidence/' + uidHex + '/';
            const filePath = base + 'v2/' + hash + '.' + extension;
            const parts = [[base + '_thumbs/v2/' + hash + '-w144.' + extension, formData.get('thumbnail144')],
                [base + '_thumbs/v2/' + hash + '-w320.' + extension, formData.get('thumbnail320')], [filePath, file]];
            for (const [objectPath, blob] of parts) {
                if (!(blob instanceof Blob) || blob.size > 2500000) throw new Error('Optimized photo is invalid.');
                if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
                const response = await fetchWithTimeout(SUPABASE_URL + '/storage/v1/object/' + bucketName + '/' + objectPath, {
                    method: 'POST', headers: { ...headers, 'Content-Type': blob.type, 'x-upsert': 'false' },
                    referrerPolicy: 'no-referrer', body: blob, signal: options.signal
                }, Number(options.timeoutMs || SUPABASE_UPLOAD_TIMEOUT_MS), 'Drive photo storage');
                if (!response.ok) {
                    const failure = await response.json().catch(() => ({}));
                    if (response.status !== 409 && String(failure.error || failure.code) !== 'Duplicate') throw Object.assign(new Error('Photo storage did not confirm the upload.'), { status: response.status });
                }
            }
            return { ok: true, publicUrl: SUPABASE_URL + '/storage/v1/object/public/' + bucketName + '/' + filePath, filePath, bucketName };
        }

function getManagerAssignableOwnerUsers() {
            const directory = getAssignableAppUserOptions().map(entry => entry.username);
            return Array.from(new Set([...directory, ...EVAL_ASSIGNMENT_ROSTER_USERS, ...evalAssignableUsers]
                .map(normalizeEvalAssignableUser).filter(user => user && user !== 'ellen_ward' && !EVAL_TASK_INACTIVE_USERS.has(user))))
                .sort((a, b) => a.localeCompare(b));
        }

        function setManagerAssignedViewMode(value = 'unique') {
            getManagerAssignedColumnState().viewMode = value === 'rows' ? 'rows' : 'unique';
            scheduleManagersRender(true);
            return false;
        }

        function setManagerAssignedPlantGroupFilter(value = '') {
            const state = getManagerAssignedColumnState();
            if (value) state.filters.PLANTGROUPCODE = [String(value).trim().toLowerCase()];
            else delete state.filters.PLANTGROUPCODE;
            scheduleManagersRender(true);
            return false;
        }

        function selectAllFilteredManagerAssignedItems(checked) {
            getManagerAssignedSelectionSnapshot().rows.forEach(row => {
                const code = buildManagerEvalAssignmentKey(row.ITEMCODE);
                if (code) { if (checked) managerEvalAssignmentSelection.add(code); else managerEvalAssignmentSelection.delete(code); }
            });
            updateManagerAssignedItemsView();
            scheduleManagersRender(true);
            return false;
        }

function getCommittedDriveEvidenceReceipt(result, item) {
    if (!result || result.ok !== true || !result.row || typeof result.row !== 'object') return null;
    const row = result.row;
    const masterUid = String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, item && item.master_uid, item && item.uid, '') || '').trim();
    if (!masterUid || String(row.unique_id || '').trim() !== masterUid
        || !['itemcode', 'locationcode', 'lotcode'].every(key => String(row[key] || '').trim().toUpperCase()
            === String(firstNonEmptyValue(item && item[key.toUpperCase()], item && item[key], '') || '').trim().toUpperCase())) {
        throw Object.assign(new Error('DRIVE_ROW_IDENTITY_MISMATCH'), { code: 'DRIVE_ROW_IDENTITY_MISMATCH', driveEvidenceConflict: true });
    }
    return { ...result, canonicalConfirmed: true, writeConfirmed: true };
}

function ensurePhotoTakenDateBadges(root = document) {
            const candidates = [];
            if (root && root.nodeType === 1 && root.matches && root.matches('img')) candidates.push(root);
            if (root && root.querySelectorAll) candidates.push(...root.querySelectorAll('img'));
            candidates.forEach((image) => {
                if (!image || image.closest('.photo-modal-slide')) return;
                const rawUrl = String(image.getAttribute('data-full-src') || image.getAttribute('src') || image.currentSrc || '').trim();
                const label = resolveAndFormatPhotoDate(null, rawUrl);
                if (!label) return;
                const host = image.closest('.app-inline-thumb-column, .app-av-catalog-media')
                    || image.closest('.eval-work-photo-thumb, .historical-requests__photo, button, .app-inline-thumb-box') || image.parentElement;
                if (!host || host.querySelector('.photo-thumb-date')) return;
                host.classList.add('photo-date-badge-host');
                host.insertAdjacentHTML('beforeend', `<span class="photo-thumb-date" data-photo-taken-date="${esc(label)}">${esc(label)}</span>`);
            });
        }

function getEditorLocMatchQtyValue(item = null, matchValue = '') {
            if (!item) return null;
            const liveRow = typeof findLinkedMasterRow === 'function' ? findLinkedMasterRow(item) : null;
            const row = liveRow || item;
            const stocks = [row, item].flatMap(value => [value.PTRONHAND, value.ptronhand, value.on_hand, value.onhand,
                value.onHand, value.qty_on_hand, value.oh, value.PTR_ON_HAND, value.ptr_on_hand,
                value.PTRAVAILABLE, value.ptravailable]).map(parseAppNumber).filter(value => value != null);
            const onHand = stocks.find(value => value > 0) ?? stocks[0]
                ?? (typeof getCardLocationOnHandValue === 'function' ? parseAppNumber(getCardLocationOnHandValue(row)) : null);
            return calculateLocMatchQtyValue({ ...row, PTRAVAILABLE: onHand == null ? '' : onHand }, matchValue);
        }

async function postPhotoUploadWithTransientRetry(formData, options = {}) {
            const delays = [500, 1200, 2500];
            const transient = error => {
                if (['REQUEST_ABORTED', 'DATASET_READ_SCOPE_CHANGED', 'PASSWORD_CHANGE_REQUIRED'].includes(String(error && error.code || '').toUpperCase())
                    || String(error && error.name || '') === 'AbortError') return false;
                const status = Number(error && error.status) || 0;
                return status === 500 || status === 502 || status === 503 || status === 504 || status === 546
                    || error instanceof TypeError
                    || /failed to fetch|network ?error|connection (?:reset|closed)|timed? ?out|temporarily unavailable/i.test(String(error && error.message || error || ''));
            };
            for (let attempt = 0; ; attempt += 1) {
                if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) {
                    throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
                }
                try {
                    return await postAppFunctionFormData(APP_API_FUNCTION_URL, formData, {
                        timeoutMs: Math.max(1000, Number(options.timeoutMs) || SUPABASE_UPLOAD_TIMEOUT_MS),
                        signal: options.signal, isCurrent: options.isCurrent, label: 'Secure photo upload'
                    });
                } catch (error) {
                    if (attempt === 0 && transient(error) && (typeof navigator === 'undefined' || navigator.onLine !== false) && typeof formData?.get === 'function' && SECURE_DRIVE_EVIDENCE_PREFIXES.has(String(formData.get('prefix') || ''))) {
                        try { return await uploadDrivePhotoWithNativeSession(formData, options); }
                        catch (fallbackError) {
                            if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw fallbackError;
                        }
                    }
                    if (attempt >= delays.length || !transient(error)) throw error;
                    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                }
            }
        }

        function applySuspendTagInventoryReceipt(result, scope) {
            if (scope !== getSupabaseReadIdentityScope()) return false;
            const rows = Array.isArray(result?.inventoryRows) ? result.inventoryRows : result?.inventoryRow ? [result.inventoryRow] : [];
            let applied = false;
            for (const row of rows) {
                if (!row?.unique_id || !row.itemcode || !row.locationcode || isFalseBlockLocation(row.locationcode)) continue;
                const target = Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toUpperCase(),value]));
                target.SOURCE_TABLE = 'ph_master_inventory';
                reconcileConfirmedDriveEvidence({ok:true,code:'SAVED',canonicalConfirmed:true,row,locationRows:[row]}, target, 'req-', {scope,photoOnly:true,preserveDetailDraft:true});
                applied = true;
            }
            return applied;
        }
        async function publishFlyerInventoryEvidence(item, payload = {}) {
            const master = getMasterPhotoSyncItem(item) || findLinkedMasterRow(item);
            if (!master || String(master.SOURCE_TABLE || 'ph_master_inventory') !== 'ph_master_inventory') throw new Error('Exact Flyer inventory row is required.');
            const value = (flyer, normal) => firstNonEmptyValue(item[flyer],item[normal],'');
            const evidence = {spec:value('FLYER_SPEC','SPEC'),caliper:value('FLYER_CALIPER','CALIPER'),av_note:value('FLYER_AV_NOTE','AV_NOTE'),match:value('FLYER_MATCH','MATCH'),pick_note:value('FLYER_PICK','PICK'),comments:firstNonEmptyValue(payload.sales_note,item.SALES_NOTE,''),photo_link:value('FLYER_PHOTO_LINK','PHOTO_LINK'),photo_name:value('FLYER_PHOTO_NAME','PHOTO_NAME')};
            const scope=getSupabaseReadIdentityScope();
            const result=await saveSecureDriveEvidence(master,'lsn-',evidence,false,buildSecureDriveEvidenceBaseline(master));
            reconcileConfirmedDriveEvidence(result,master,'flyer-',{scope,preserveDetailDraft:true});
            return result;
        }

        function resolveUserAccessMatrix(username = currentUser) {
            return window.GncUserAccessControl?.resolveUserAccessMatrix(username, String(currentRole || '')) || null;
        }

        function getAllowedRequestModalRepOptions() {
            const matrixAccess = typeof window !== 'undefined' ? window.GncUserAccessControl : null;
            const fallback = (matrixAccess?.getAccessSalesReps() || []).map(rep => normalizeRequestRepUserOption({username:rep.username,display_name:rep.label,role:'REP'})).filter(Boolean);
            const eligibleUsers = [...requestModalRepUserOptions.filter(option => isRequestRepRoleValue(option && option.role)),...fallback];
            const optionsByIdentity = new Map();
            const add = (option, identity) => {
                if (!option || !option.label || !identity) return;
                const previous = optionsByIdentity.get(identity);
                const ids = new Set([...(previous?.salesrepIds || []), ...(option.salesrepIds || []), previous?.salesrepId, option.salesrepId].filter(Boolean));
                optionsByIdentity.set(identity, { ...previous, ...option, label: previous?.salesrepId ? previous.label : option.label,
                    salesrepIds: Array.from(ids), salesrepId: ids.size === 1 ? Array.from(ids)[0] : '' });
            };
            const directory = getRequestMappedRepDirectory();
            directory.options.forEach(option => add(option, `rep:${normalizeRequestSalesrepId(option.salesrepId) || option.salesrepId}`));
            eligibleUsers.forEach(option => {
                const id = String(option.salesrepId || '').trim();
                const username = normalizePushUsername(option.username || '');
                add(option, id ? `rep:${normalizeRequestSalesrepId(id) || id}` : `user:${username}`);
            });
            const options=Array.from(optionsByIdentity.values()).sort((a, b) => a.label.localeCompare(b.label));
            if (!matrixAccess) return options;
            const roster=new Set(matrixAccess.getAccessSalesReps().map(rep=>matrixAccess.normalizeAccessUsername(rep.username)));
            return mergeRequestModalRepOptions(options).filter(option=>roster.has(matrixAccess.normalizeAccessUsername(option.label)) && matrixAccess.canRequestSalesRep(resolveUserAccessMatrix(),option.username||option.label));
        }

        async function suspendTagApi(operation, payload, options = {}) {
            const owner = getSupabaseReadIdentityScope();
            let result;
            for (let attempt = 0; ; attempt += 1) {
                try { result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'suspend_tag', operation, payload,
                commandId: options.commandId || null, expectedVersion: options.expectedVersion == null ? null : options.expectedVersion },
                { timeoutMs: getDetailRowWriteTimeoutMs(), signal: options.signal, label: 'Suspend Tag ' + operation, idempotencyKey: options.commandId || '' });
                    break;
                } catch (error) {
                    if (!['save','complete'].includes(operation) || attempt >= 2 || !/55P03|57014/.test(String(error?.code || '')+' '+String(error?.message || '')) || owner !== getSupabaseReadIdentityScope() || options.signal?.aborted) throw error;
                    await new Promise(resolve => setTimeout(resolve, [300,700][attempt]));
                }
            }
            if (!result || result.ok !== true || !result.data) throw new Error(result && (result.code || result.error) || 'Suspend Tag was not confirmed.');
            if (owner === getSupabaseReadIdentityScope() && !['rows', 'approval', 'inbox'].includes(operation)) {
                applySuspendCandidateRows(result.data.rows);
                if (operation === 'add_candidates') applySuspendTagInventoryReceipt(result.data, owner);
            }
            return result.data;
        }

        function getManagerAssignedSelectionSnapshot() {
            const rows = getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows());
            const codes = new Set(rows.map(row => buildManagerEvalAssignmentKey(row.ITEMCODE)).filter(Boolean));
            const selectedRows = rows.filter(row => managerEvalAssignmentSelection.has(buildManagerEvalAssignmentKey(row.ITEMCODE)));
            const state = getManagerAssignedColumnState();
            const filtered = Object.values(state.filters).some(Array.isArray) || !!String(managersSearchTerm || '').trim() || getManagerAssignedItemsActiveAssigneeKey() !== 'all';
            return { rows, codes, selectedRows, filtered };
        }

        function updateManagerAssignedItemsView() {
            const state = getManagerAssignedColumnState();
            if (state.view && state.viewHost?.isConnected) state.view.update(getManagerAssignedItemsViewProps());
            const snapshot = getManagerAssignedSelectionSnapshot();
            const checkbox = document.querySelector('[data-assigned-select-all-visible]');
            if (checkbox) {
                checkbox.checked = snapshot.rows.length > 0 && snapshot.selectedRows.length === snapshot.rows.length;
                checkbox.indeterminate = snapshot.selectedRows.length > 0 && snapshot.selectedRows.length < snapshot.rows.length;
                const label = checkbox.parentElement;
                if (label?.lastChild?.nodeType === 3) label.lastChild.textContent = 'Select All Filtered (' + snapshot.rows.length + ')';
            }
            const bulk = document.querySelector('[data-manager-assign-selected]');
            if (bulk) {
                const count = snapshot.selectedRows.length || (snapshot.filtered ? snapshot.rows.length : 0);
                bulk.textContent = (snapshot.selectedRows.length ? 'Assign Selected (' : 'Assign All Filtered (') + count + ')';
                bulk.disabled = count === 0 || [...snapshot.codes].some(code => state.defaultPending?.has(code));
            }
        }

        function applyOptimisticItemcodeOwners(codes, assignee) {
            const state = getManagerAssignedColumnState(), wanted = new Set(codes), snapshots = [];
            const fields = ['DEFAULT_ASSIGNEDTO','default_assignedto','DEFAULT_OWNER','default_owner','ASSIGNEDTO','assignedto','effective_worker','EFFECTIVE_WORKER','zone_override_active','assignment_reason'];
            const seen = new Set();
            [warehouseAssignedItemsInventory, fullInventory, state.warehouseAssignedItems, state.itemcodeDefaultOwners, state.inventoryRowAssignments, state.fullInventory, state.rows, state.data, state.displayCache?.rows].filter(Array.isArray).forEach(rows => rows.forEach(row => {
                if (seen.has(row) || !wanted.has(buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode || row.itemcode_normalized))) return;
                seen.add(row); const before = Object.fromEntries(fields.map(field => [field, { exists: Object.hasOwn(row, field), value: row[field] }]));
                snapshots.push({ row, before });
                fields.slice(0,8).forEach(field => { row[field] = assignee; }); row.zone_override_active = false; row.assignment_reason = assignee ? 'itemcode_default' : 'unassigned';
            }));
            state.dataEpoch = (state.dataEpoch || 0) + 1;
            clearWarehouseAssignedItemCaches();
            if (state.displayCache) {
                const targets = getManagerItemLowStockTargetsState();
                state.displayCache.signature = getManagerAssignedDisplaySignature(state, state.displayCache.input === fullInventory, targets.revision);
                state.filteredCache = new Map();
            }
            invalidateManagerEvalReport2Cache();
            return () => { snapshots.forEach(({row,before}) => { if (row.default_owner !== assignee) return; Object.entries(before).forEach(([field, prior]) => { if(prior.exists)row[field]=prior.value;else delete row[field]; }); }); state.dataEpoch++; clearWarehouseAssignedItemCaches(); invalidateManagerEvalReport2Cache(); };
        }


        function getManagerAssignedItemsViewProps(rows = null, totalRows = null) {
            const state = getManagerAssignedColumnState();
            const low = getManagerItemLowStockTargetsState();
            const pageSource = state.viewPageSource && useManagerReportPages('assigned-items') ? { ...state.viewPageSource,
                query: buildManagerReportPageQuery('assigned-items', 'rows'), refreshKey: state.viewRefreshKey || 0 } : null;
            if (pageSource) {
                state.viewNormalizeRow ||= (row, index) => normalizeWarehouseAssignedItemRow(Object.assign({}, row), index);
                state.viewPageStateHandler ||= (page, offset, result) => {
                    const nextRevision = page?.sourceRevision || state.viewPageRevision || '';
                    const nextError = result?.error ? String(result.error.message || result.error) : '';
                    const nextMetadata = page?.metadata || state.viewMetadata || {};
                    const nextMetadataKey = JSON.stringify(nextMetadata);
                    const metadataChanged = state.viewMetadataKey !== nextMetadataKey;
                    if (state.viewPageRevision === nextRevision && state.viewPageError === nextError && state.viewMetadataKey === nextMetadataKey) return;
                    state.viewPageRevision = nextRevision; state.viewPageError = nextError;
                    state.viewMetadata = nextMetadata; state.viewMetadataKey = nextMetadataKey;
                    updateManagerAssignedItemsView();
                    if (metadataChanged && isViewVisible('managers')) scheduleManagersRender(true);
                };
                pageSource.normalizeRow = state.viewNormalizeRow;
                pageSource.onPageState = state.viewPageStateHandler;
            }
            const allRows = pageSource ? [] : getManagerAssignedItemsDisplayRows();
            const displayed = pageSource ? [] : getFilteredManagerAssignedItemsExportRows(allRows);
            state.visibleRows = displayed;
            if (!state.viewHandlers) state.viewHandlers = {
                onDefaultChange: (code, value) => assignEvalItemcodes([code], value),
                onSelectAll: checked => selectAllFilteredManagerAssignedItems(checked),
                onSelect: (code, checked) => { toggleManagerEvalAssignmentItem(code, '', checked); updateManagerAssignedItemsView(); },
                onLowStockDraft: (code, value) => { updateManagerItemLowStockDraft(code, value); updateManagerAssignedItemsView(); },
                onLowStockSave: code => saveManagerItemLowStockOverride(code),
                onLowStockReset: code => resetManagerItemLowStockOverride(code),
                onColumnFilter: (field, event) => openManagerAssignedColumnFilter(field, event.currentTarget),
                getReason: getManagerEvalAssignmentReason,
                onRetry: () => { if (state.viewPageSource) { state.viewRefreshKey = (state.viewRefreshKey || 0) + 1; updateManagerAssignedItemsView(); } else refreshManagerAssignedItemsExport(); },
                onError: error => { console.error('Assigned Items rendering failed.', error); showToast('Assigned Items Unavailable', 'Reload this module to retry.', true); }
            };
            if (!state.viewColumns) state.viewColumns = getManagerAssignedColumnDefinitions();
            const optionKey = JSON.stringify(getManagerAssignableOwnerUsers().map(user => [user, getEvalAssignableUserLabel(user)]));
            if (state.viewOptionKey !== optionKey) {
                state.viewOptionKey = optionKey;
                state.viewOptions = [{value: '', label: 'Unassigned'}, ...getManagerAssignableOwnerUsers().map(user => ({value: normalizeEvalAssignableUser(user), label: getEvalAssignableUserLabel(user)}))];
            }
            return { ...state.viewHandlers, uiState: state.viewUi ||= { expanded: new Set(), anchor: null }, rows: displayed, totalRows: totalRows ?? (pageSource ? null : allRows.length), ...(pageSource ? { pageSource } : {}),
                scrollElement: state.viewHost?.closest('[data-manager-assigned-scroll]') || document.getElementById('main-scroll-area'), columns: state.viewColumns,
                columnFilters: Object.fromEntries(state.viewColumns.map(([field]) => [field, { active: Array.isArray(state.filters[field]), open: state.editor?.field === field, label: !Array.isArray(state.filters[field]) ? 'All' : state.filters[field].length === 1 ? getManagerAssignedColumnLabel(field, state.filters[field][0]) : `${state.filters[field].length} selected` }])),
                sort: state.sort, grouped: false,
                canManageAssignments: canManageEvalItemcodeAssignments(), snapshotCurrent: isManagerAssignedSnapshotCurrent(),
                options: state.viewOptions, ownerDrafts: { ...state.defaultDrafts },
                pendingCodes: new Set(state.defaultPending || []), selectedCodes: new Set(managerEvalAssignmentSelection),
                lowStock: { targets: low.rowsByCode, drafts: new Map(low.drafts), saving: new Set(low.saving),
                    canEdit: canManageItemLowStockTargets(), error: low.error,
                    fallback: Number.isFinite(Number(managerEvalReportSettings?.lowStockMaxSLts)) ? Number(managerEvalReportSettings.lowStockMaxSLts) : 150 } };
        }

        function getManagerAssignedDisplaySignature(state, useMaster, targetRevision) {
            return `${getDatasetLoadSignature('warehouseAssignedItems')}|${useMaster ? getDatasetLoadSignature('master') : ''}|${warehouseAssignedItemsInventory.length}|${state.dataEpoch || 0}|${JSON.stringify(state.defaultDrafts || {})}|${targetRevision}|${managerEvalReportSettings?.lowStockMaxSLts}`;
        }

        function applyCommittedItemcodeOwnerReceipt(row) {
            if (typeof managerAssignedColumnState === 'undefined' || typeof currentUser !== 'string') return row;
            const state = managerAssignedColumnState;
            if (!state.ownerReceiptUser || state.ownerReceiptUser !== currentUser || !(state.ownerReceipts instanceof Map)) return row;
            const uid = String(row.master_unique_id || row.MASTER_UNIQUE_ID || '');
            const receipt = state.ownerReceipts.get(uid);
            if (!receipt) return row;
            const incoming = Number(row.default_revision ?? row.DEFAULT_REVISION ?? 0), committed = Number(receipt.default_revision || 0);
            if (incoming > committed) { state.ownerReceipts.set(uid, { ...row }); return row; }
            if (incoming < committed || Number(row.revision || 0) < Number(receipt.revision || 0)) {
                Object.assign(row, { assignedto: receipt.assignedto || '', ASSIGNEDTO: receipt.assignedto || '',
                    default_assignedto: receipt.default_assignedto || '', DEFAULT_ASSIGNEDTO: receipt.default_assignedto || '',
                    default_owner: receipt.default_assignedto || '', effective_worker: receipt.assignedto || '',
                    default_revision: committed, DEFAULT_REVISION: committed, revision: receipt.revision,
                    zone_override_active: receipt.zone_override_active, assignment_reason: receipt.assignment_reason });
            }
            return row;
        }
