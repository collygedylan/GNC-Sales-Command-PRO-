        async function waitForInteractiveOwnerWrites(url, init = {}) {
            if (String(init.method || 'GET').toUpperCase() !== 'GET' || !/\/rest\/v1\/(?:ph_master_inventory|ph_inventory_row_assignments|ph_warehouse_assigned_items)(?:\?|$)/.test(String(url))) return;
            if (typeof managerAssignedColumnState === 'undefined') return;
            const owner=managerAssignedColumnState;
            while(owner===managerAssignedColumnState && (owner.defaultPending?.size || Date.now()-Number(owner.ownerWriteAt||0)<350)) {
                if(init.signal?.aborted)throw Object.assign(new Error('Background inventory read cancelled.'),{code:'REQUEST_ABORTED'});
                await new Promise(resolve=>setTimeout(resolve,25));
            }
        }

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

        function updateManagerAssignedItemsView(options = {}) {
            const state = getManagerAssignedColumnState();
            if (options.ownerOnly && state.viewProps && state.view && state.viewHost?.isConnected) {
                state.view.update({...state.viewProps,ownerDrafts:{...state.defaultDrafts},pendingCodes:new Set(state.defaultPending||[]),selectedCodes:new Set(managerEvalAssignmentSelection)});
                clearTimeout(state.ownerPaintTimer);
                const settle = () => { if(state!==getManagerAssignedColumnState())return;if(state.defaultPending?.size){state.ownerPaintTimer=setTimeout(settle,350);return;}updateManagerAssignedItemsView();scheduleManagersRender(true); };
                state.ownerPaintTimer=setTimeout(settle,350);
                return;
            }
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
                const count = snapshot.selectedRows.length;
                bulk.textContent = 'Assign Selected (' + count + ')';
                bulk.disabled = count === 0 || [...snapshot.codes].some(code => state.defaultPending?.has(code));
            }
            const all = document.querySelector('[data-manager-assign-filtered]');
            if (all) { all.textContent = 'Assign All Filtered (' + snapshot.rows.length + ')'; all.disabled = !snapshot.rows.length || [...snapshot.codes].some(code => state.defaultPending?.has(code)); }
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
                onDefaultChange: assignManagerCheckedItemcodes,
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
            return state.viewProps = { ...state.viewHandlers, uiState: state.viewUi ||= { expanded: new Set(), anchor: null }, rows: displayed, totalRows: totalRows ?? (pageSource ? null : allRows.length), ...(pageSource ? { pageSource } : {}),
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

        function assignManagerCheckedItemcodes(code, value) {
            const snapshot = getManagerAssignedSelectionSnapshot();
            const checked = [...new Set(snapshot.selectedRows.map(row => buildManagerEvalAssignmentKey(row.ITEMCODE)))];
            const bulk = document.getElementById('manager-eval-bulk-assignee');
            if (bulk) bulk.value = value;
            return assignEvalItemcodes(checked.length > 1 ? checked : [code], value);
        }

function canViewNurseryCommandTables(user = currentUser) {
            const matrix = typeof resolveUserAccessMatrix === 'function' ? resolveUserAccessMatrix(user) : null;
            return matrix?.view_permissions?.view_nursery_command_tables === 'Y';
        }
function getNurseryTableManagementOptions(identity) {
    return {
nurseryIdentity: identity,
                    nurseryAuthorized: () => identity === getSupabaseReadIdentityScope() && canViewNurseryCommandTables(),
                    inventory: () => fullInventory,
                    inventoryReady: () => getDatasetState('master').rowCompleteness === 'complete',
                    onBunchNoteSaved: (row, decision) => {
                        const uid = String(row?.unique_id || row?.UNIQUE_ID || '');
                        const live = !row?.synthetic && fullInventory.find(item => String(item.unique_id || item.UNIQUE_ID || '') === uid);
                        if (live) live.approved_bunch_note = decision?.notes || '';
                        invalidateDriveResolvedCardState();
                    },
                    onBunchNoteError: message => showToast('Bunch Note save failed', message, true),
                    inventoryRevision: () => getDatasetLoadSignature('master') + ':' + resolvedViewStateEpoch,
                    nurseryRequest: async ({table,operation,payload}) => {
                        if (identity !== getSupabaseReadIdentityScope() || !canViewNurseryCommandTables()) throw new Error('NURSERY_ACCESS_DENIED');
                        const result = await supabaseRpc('nursery_command_v23127', {p_table:table,p_operation:operation,p_payload:payload}, {timeoutMs:30000});
                        if (identity !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
                        return result;
                    },
    };
}

        function isAllowedAppHostname(hostname = window.location.hostname, protocol = window.location.protocol) {
            const host = String(hostname).toLowerCase();
            return (protocol === 'https:' && (host === 'agmetricapp.com' || host === 'www.agmetricapp.com' || host.endsWith('.github.io')))
                || (['http:', 'https:'].includes(protocol) && ['localhost', '127.0.0.1'].includes(host));
        }
        function isQuotaBackgroundPollingAllowed() {
            const modal = document.getElementById('erp-sync-progress-modal');
            return !document.hidden && !!modal && !modal.hidden && !modal.classList.contains('hidden') && modal.style.display !== 'none';
        }

function getManagerTableManagementItems(access = getManagersToolAccess()) {
            return [
                ...(globalThis.GncNurseryModel?.TABLES || []).map(item => ({...item,visible:canViewNurseryCommandTables()})),
                { id:'assigned-items', label:'Assigned Items', section:'editable', visible:access.canViewAssignedItemsExport },
                { id:'company-directory', label:'Company Directory', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
                { id:'inquiry-coverage', label:'Inquiry Coverage', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
                { id:'customer-assignments', label:'Customer Assignments', section:'editable', visible:access.canManageCustomerRepMappings },
                { id:'user-role-access', label:'User & Role Access', section:'editable', visible:access.canManageAccessControl },
                { id:'av-note-users', label:'AV Note Users', section:'editable', visible:access.canManageAvBlanksPhotoBypass },
                { id:'season', label:'Season', section:'editable', visible:access.canManageSeasonSettings },
                { id:'season-priority', label:'Season Priority', section:'editable', visible:access.canViewSeasonPriority },
                { id:'crop-roll', label:'Crop Roll', section:'editable', visible:access.canViewCropRoll },
                { id:'production-schedule', label:'PROD SCHEDULE 102726 (2026-10-29_1232)', section:'schedule', visible:access.canViewProductionSchedule },
                { id:'historical-drive-mode', label:'Historical Drive Mode', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-soc-open-orders', label:'Historical SOC Open Orders', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-soc-reserves', label:'Historical SOC Reserves', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-requests', label:'Historical Requests', section:'archive', visible:canUseHistoricalRequests() },
                { id:'photo-history', label:'Photo History', section:'archive', visible:canOpenPhotoHistory() }
            ].filter(item => item.visible);
        }

function openManagerTableManagement(table = '') {
            const key = getManagerTableManagementKey(table) || String(table || '').trim().toLowerCase();
            if (!key) managersSearchTerm = '';
            const available = new Set(getManagerTableManagementItems().map(item => item.id));
            if (key && !available.has(key)) {
                if (key === 'photo-history' && !canOpenPhotoHistory()) return false;
                if (key === 'assigned-items' && canViewAssignedItemsExport()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'customer-assignments' && canManageCustomerRepMappings()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_CUSTOMER_REP_MAP_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'user-role-access' && canViewAccessControl()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_ACCESS_CONTROL_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'historical-requests' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-requests');
                if (key === 'historical-drive-mode' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-drive');
                if (key === 'historical-soc-open-orders' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-orders');
                if (key === 'historical-soc-reserves' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-reserves');
                return false;
            }
            if (key === 'photo-history') return openDylanPhotoHistory({ readOnly: true });
            const legacyTab = getManagerTableManagementLegacyTab(key);
            if (legacyTab) {
                managerTableManagementSelection = key;
                managerTableManagementDirectOpen = true;
                try { if (getCurrentVisibleViewId() !== 'managers') switchView('managers'); setHomeTab(legacyTab); renderManagers(); return false; }
                finally { managerTableManagementDirectOpen = false; }
            }
            if (key === 'historical-requests') return navigateQuickAccessView('archive-requests');
            if (key === 'historical-drive-mode') return navigateQuickAccessView('archive-drive');
            if (key === 'historical-soc-open-orders') return navigateQuickAccessView('archive-orders');
            if (key === 'historical-soc-reserves') return navigateQuickAccessView('archive-reserves');
            managerTableManagementSelection = key;
            destroyManagerTableManagement();
            if (getCurrentVisibleViewId() !== 'managers') switchView('managers');
            managerTableManagementDirectOpen = true;
            try { setHomeTab(MANAGER_TABLE_MANAGEMENT_VIEW); renderManagers(); return false; }
            finally { managerTableManagementDirectOpen = false; }
        }

function getManagerTableManagementKey(tab = '') {
    const key = String(tab || '').trim().toLowerCase();
    const aliases = {'assigned-items':'assigned-items','assigned-items-export':'assigned-items','company-directory':'company-directory','inquiry-coverage':'inquiry-coverage','item-inquiry-coverage':'inquiry-coverage','customer-assignments':'customer-assignments','customer-rep-map':'customer-assignments','user-role-access':'user-role-access','access-control':'user-role-access','production-schedule':'production-schedule','av-note-users':'av-note-users','av-blanks-photo-bypass':'av-note-users','season':'season','season-settings':'season','app-season-settings':'season','season-priority':'season-priority','crop-roll':'crop-roll'};
    return aliases[key] || (globalThis.GncNurseryModel?.TABLES?.some(item => item.id === key) ? key : '');
}
function getManagerTableManagementLegacyTab(key = '') {
    return {'assigned-items':'assigned-items-export','customer-assignments':'customer-rep-map','user-role-access':'access-control','production-schedule':'production-schedule','av-note-users':'av-blanks-photo-bypass','season':'season-settings','season-priority':'season-priority','crop-roll':'crop-roll'}[key] || '';
}
function renderManagerTableManagementWorkspace(content, selected = '') {
    const items = getManagerTableManagementItems(), adminOrder = ['assigned-items','user-role-access','company-directory','customer-assignments','inquiry-coverage','av-note-users','season','season-priority','crop-roll'];
    const directory = [...adminOrder.map(key => items.find(item => item.id === key)).filter(Boolean), ...items.filter(item => item.nursery || item.section === 'schedule' && !items.some(row => row.id === 'prod-schedule'))];
    if (!selected) {
        const query = typeof managersSearchTerm === 'string' ? managersSearchTerm.trim().toLowerCase() : '';
        const cards = directory.map(item => '<button type="button" class="manager-module-card" data-manager-table-card="' + esc(item.id) + '"' + (query && !item.label.toLowerCase().includes(query) ? ' hidden' : '') + ' onclick="return openManagerTableManagement(this.dataset.managerTableCard)"><span class="manager-module-icon" aria-hidden="true"><i class="ph-bold ph-table"></i></span><span class="manager-module-title">' + esc(item.label) + '</span></button>').join('');
        return '<section id="view-table-management" data-table-directory-mode="index" data-selected-table="" aria-label="Table Management directory"><div class="table-management-directory" data-table-directory>' + cards + '</div></section>';
    }
    const active = items.find(item => item.id === selected);
    const choices = [...directory, ...items.filter(item => item.section === 'archive')];
    const options = choices.map(item => '<option value="' + esc(item.id) + '" data-manager-table-pill="' + esc(item.id) + '" aria-pressed="' + (item.id === selected) + '"' + '>' + esc(item.label) + '</option>').join('');
    return '<section id="view-table-management" data-table-directory-mode="table" data-selected-table="' + esc(selected) + '" aria-label="Table Management workspace"><nav class="table-management-selector" data-table-selector aria-label="Table navigation"><button type="button" data-table-all onclick="return openManagerTableManagement()">← All Tables</button><strong class="table-management-title" title="' + esc(active?.label || selected) + '">' + esc(active?.label || selected) + '</strong><select data-table-switch aria-label="Switch Table" onchange="return openManagerTableManagement(this.value)"><option value="" selected disabled>Switch Table ▾</option>' + options + '</select></nav><div class="table-management-workspace" data-table-workspace>' + content + '</div></section>';
}
function syncManagerTableManagementViewport() {
    const root = document.getElementById('view-table-management');
    if (!root) return;
    const main = document.getElementById('main-scroll-area');
    if (main) main.scrollTop = 0;
    root.style.setProperty('--table-management-height', Math.max(180, window.innerHeight - root.getBoundingClientRect().top - 76) + 'px');
}
