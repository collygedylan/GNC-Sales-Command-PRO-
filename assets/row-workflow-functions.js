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
            getFilteredManagerAssignedItemsExportRows().forEach(row => {
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
