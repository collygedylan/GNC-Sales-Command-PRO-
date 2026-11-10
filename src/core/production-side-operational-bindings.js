export function createProductionLiveSyncSideAdapters() {
    const api = window.AgMetricLiveSyncAdapters;
    const registry = window.AgMetricLiveSyncRegistry;
    const array = api.rows;
    const read = async (table, query = 'select=*', options = {}) => array(await fetchAllSupabaseRows(table, query, { signal: options.signal, count: options.requireComplete === true, requireComplete: options.requireComplete === true }), table);
    const stateReady = (state, values) => Object.assign(state, values, { loaded: true, loading: false, error: '', lastLoadedAt: Date.now() });
    const managerSourceScope = () => getSupabaseReadIdentityScope();
    const emitManagerSourceRefresh = (surface, authorized, sources) => {
        const eventContext = getProductionLiveSyncSideContext();
        const rootId = surface === 'company-directory' ? 'manager-company-directory-root'
            : surface === 'hr-command' ? 'manager-hr-command-root' : '';
        const target = rootId ? document.getElementById(rootId) : null;
        if (!target?.isConnected) return false;
        return window.GncManagerSourceLiveEvents?.dispatch(target, {
            authorized: authorized === true,
            visible: !document.hidden && document.body.classList.contains('role-access-ready')
                && eventContext.view === 'managers' && activeHomeTab === surface,
            view: eventContext.view, tab: surface, sources
        }) === true;
    };
    const emitCommunicationSourceRefresh = (surface, sources) => {
        const root = document.getElementById('alpha-communications-root');
        const visible = !document.hidden && document.body.classList.contains('role-access-ready')
            && getCurrentVisibleViewId() === 'communication';
        return window.GncManagerSourceLiveEvents?.dispatch(root, {
            authorized: isAuraWidgetAuthorized() && canAccessView('communication'),
            visible, view: 'communication', tab: surface, sources
        }) === true;
    };
    const bindings = {
        ...buildOperationalSideBindings(api),
        ...buildCustomerMappingRevisionSideBindings(managerSourceScope, emitManagerSourceRefresh),
        ...buildProductionScheduleRevisionSideBindings(read, managerSourceScope, emitManagerSourceRefresh),
        ...buildDockWorkflowSideBindings(api, array, read),
        ...buildUsersSideBindings(array),
        ...buildBunchQueueSideBindings(array, read, stateReady),
        ...buildSalesWorkspaceSideBindings(array, read, stateReady),
        ...buildChatSideBindings(array, read, stateReady, emitCommunicationSourceRefresh),
        ...buildHoldRiskSideBindings(array, read, stateReady),
        ...buildItemLowStockTargetsSideBindings(api, array, read, stateReady),
        ...buildTransactionsKeyedSideBindings(array, stateReady),
        ...buildPendingOrdersSideBindings(array)
    };
    return api.create(bindings,registry);
}

function buildOperationalSideBindings(api) {
    return {
        ...buildManagerReportMetadataBindings(),
        'side:homeSyncMetadata': {
            enabled: () => canViewDashboardSyncStatus(),
            scope: () => getSupabaseReadIdentityScope(),
            stage: ctx => stageHomeSyncMetadata(ctx,api),
            commit: snapshot => {
                const labels = Object.fromEntries(getDashboardSyncMetadataSources().map(source => [source.table, source.label]));
                const retained = dashboardSyncMetadataOwner === getSupabaseReadIdentityScope() ? dashboardSyncMetadataSummaries : [];
                dashboardSyncMetadataSummaries = mergeDashboardSyncSummaries([...retained, ...snapshot.entries
                    .map(entry => collectDashboardSyncSource(entry.rows, labels[entry.table]))
                    .filter(entry => entry.iso || entry.files.length)]);
                dashboardSyncMetadataFetchedAt = Date.now();
                dashboardSyncMetadataOwner = getSupabaseReadIdentityScope();
                updateDashboardSyncSummary();
            }
        }
    };
}

function buildManagerReportMetadataBindings() {
    const surfaces = {reportEval1:'eval1',reportEval2:'eval2',reportNcr:'ncr',reportAssigned:'assigned-items',
        reportSeason:'season-priority',reportApproval:'approval'};
    return Object.fromEntries(Object.entries(surfaces).map(([id,surface]) => ['side:'+id,createManagerReportMetadataBinding(surface)]));
}

function createManagerReportMetadataBinding(surface) {
    return {
        enabled:() => useManagerReportPages(surface),
        scope:() => buildManagerReportPageQuery(surface,'metadata'),
        stage:ctx => getManagerReportPageController().readPage(buildManagerReportPageQuery(surface,'metadata'),ctx.signal),
        commit:page => getManagerReportPageController().acceptMetadata(surface,page)
    };
}

async function stageHomeSyncMetadata(ctx, api) {
    const tables = ['ph_master_inventory','ph_soc_master','ph_reserves','ph_cav_import'];
    const entries = [];
    for (let offset = 0; offset < tables.length; offset += 2) {
        const batch = await Promise.all(tables.slice(offset,offset+2).map(table => readHomeSyncMetadataTable(table,ctx.signal,api)));
        entries.push(...batch);
    }
    return {entries};
}

async function readHomeSyncMetadataTable(table, signal, api) {
    try {
        const query = `select=filename,last_updated&last_updated=not.is.null&order=last_updated.desc&limit=${DASHBOARD_SYNC_METADATA_LIMIT}&offset=0`;
        const page = await runDedupeSupabaseRead(`home-sync-metadata:${table}:${query}`,
            ({signal:readSignal}) => fetchAuthenticatedSupabaseReadPage(table,query,{signal:readSignal,timeoutMs:SUPABASE_READ_TIMEOUT_MS}),{signal});
        const rows = api.rows(page?.rows,`Home ${table} metadata`);
        return {table,rows:rows.slice(0,DASHBOARD_SYNC_METADATA_LIMIT).map(row => ({
            filename:String(row?.filename || ''),last_updated:String(row?.last_updated || '')
        }))};
    } catch (error) {
        window.GncRuntimeWatchdog?.capture?.(error,`homeSyncMetadata:${table}`);
        return {table,rows:[],retained:true};
    }
}

function buildCustomerMappingRevisionSideBindings(managerSourceScope, emitManagerSourceRefresh) {
    return {
        'side:customerMappingRevision': {
            enabled: () => canManageCustomerRepMappings(),
            scope: managerSourceScope,
            stage: async (ctx) => {
                const response = await postAppFunctionJson(APP_API_FUNCTION_URL, {
                    action: 'customer-rep-map', operation: 'list', page: 0, pageSize: 1,
                    filters: {}, sort: 'customername', direction: 'asc'
                }, { timeoutMs: 20000, label: 'Customer assignment revision', signal: ctx.signal });
                if (response?.ok !== true || !/^\d+$/.test(String(response.revision ?? ''))) {
                    throw new Error('Customer assignment revision is unavailable.');
                }
                return { revision: String(response.revision) };
            },
            commit: (value) => {
                const root = document.getElementById('manager-customer-rep-map-root');
                window.GncCustomerMappingLiveEvents?.dispatch(root, {
                    authorized: canManageCustomerRepMappings(),
                    visible: !document.hidden && getCurrentVisibleViewId() === 'managers'
                        && activeHomeTab === MANAGER_CUSTOMER_REP_MAP_VIEW,
                    view: 'managers', tab: 'customer-rep-map', revision: value?.revision
                });
            }
        },
        'side:companyDirectoryRevision': {
            enabled: () => getManagersToolAccess().canManageCompanyDirectory === true,
            scope: managerSourceScope,
            // The coordinator has already validated these source revisions;
            // the module event performs the permission-scoped row reload.
            stage: async () => ({ verified: true }),
            commit: () => emitManagerSourceRefresh('company-directory', getManagersToolAccess().canManageCompanyDirectory,
                window.GncManagerSourceLiveEvents?.sourcesFor('company-directory') || [])
        },
        'side:queueInventoryRevision': {
            enabled: () => canAccessView('request') || canAccessView('docks'),
            scope: managerSourceScope,
            // Row hydration stays bounded to visible exact identities.
            // The coordinator verifies the master revision before commit.
            stage: async () => ({ verified: true }),
            commit: () => {}
        }
    };
}

function buildProductionScheduleRevisionSideBindings(read, managerSourceScope, emitManagerSourceRefresh) {
    return {
        'side:productionScheduleRevision': {
            enabled: () => getManagersToolAccess().canViewProductionSchedule === true,
            scope: managerSourceScope,
            // The active-snapshot adapter refreshes metadata only after the
            // coordinator confirms a new publication revision.
            stage: async () => ({ verified: true }),
            commit: () => {
                if (getCurrentVisibleViewId() === 'managers' && activeHomeTab === MANAGER_PRODUCTION_SCHEDULE_VIEW
                    && getManagersToolAccess().canViewProductionSchedule) window.GncProductionSchedule?.refresh?.();
            }
        },
        'side:hrCommandRevision': {
            enabled: () => getManagersToolAccess().canViewHrCommand === true,
            scope: managerSourceScope,
            // HR reads remain in the authorized component and its RLS-aware
            // service; this adapter only wakes that existing refresh path.
            stage: async () => ({ verified: true }),
            commit: () => emitManagerSourceRefresh('hr-command', getManagersToolAccess().canViewHrCommand,
                window.GncManagerSourceLiveEvents?.sourcesFor('hr-command') || [])
        },
        'side:driveReserves': createDriveDemandBinding('reserves', read),
        'side:driveOpenOrders': createDriveDemandBinding('open-orders', read),
        'side:settings': {
            stage: async () => {
                const rows = await read(APP_SEASON_SETTINGS_TABLE, `select=key,value,updated_by,updated_at&key=eq.${encodeURIComponent(APP_SEASON_SETTINGS_KEY)}`);
                const value = parseRemoteAppSeasonSettingsRow(rows[0]);
                if (!value) throw new Error('Current season settings are missing or invalid.');
                return value;
            },
            commit: (value) => { writeLocalAppSeasonSettings(value); appSeasonSettingsRemoteLoaded = true; }
        },
        'side:coverage': {
            enabled: () => canManageItemInquiryCoverage(),
            stage: async () => normalizeItemInquiryCoverage(await supabaseRpc('get_item_inquiry_coverage_v1', {}, { timeoutMs: 15000 })),
            commit: (value) => { itemInquiryCoverageState = value; }
        }
    };
}

function buildDockWorkflowSideBindings(api, array, read) {
    return {
        'side:dockWorkflow': {
            stage: async () => {
                const [tripsResult, itemRows, issueRows, allocationRows] = await Promise.all([
                    runDockTripStatusRequest('list'), read('ph_dock_item_status', 'select=*&order=unique_id.asc'),
                    read('ph_dock_issue_status', 'select=*&order=issue_source_unique_id.asc'),
                    read('ph_dock_issue_allocations', 'select=*&order=allocation_unique_id.asc')
                ]);
                const trips = api.keyed(array(tripsResult.data, 'Dock trips'), normalizeDockTeamInfo, (row) => normalizeDockTeamTripKey(row.tripnumber));
                const items = new Map(itemRows.map((row) => [normalizeDockItemUniqueId(row.unique_id || row.UNIQUE_ID), normalizeDockItemProgress(row)]).filter(([key]) => key));
                const issues = api.keyed(issueRows, normalizeDockIssueStatusRow, (row) => row.issueSourceUniqueId);
                const allocations = api.keyed(allocationRows, normalizeDockIssueAllocationRow, (row) => row.allocationUniqueId);
                const bySource = new Map();
                allocations.forEach((row) => {
                    if (!bySource.has(row.issueSourceUniqueId)) bySource.set(row.issueSourceUniqueId, []);
                    bySource.get(row.issueSourceUniqueId).push(row);
                });
                return { trips, items, issues, allocations, bySource };
            },
            commit: (value) => {
                dockTeamStatusByTrip = value.trips; dockItemProgressByUid = value.items;
                dockIssueStatusByUid = value.issues; dockIssueAllocationsById = value.allocations; dockIssueAllocationsBySourceUid = value.bySource;
                dockTeamStatusLoaded = dockItemProgressLoaded = dockIssueDataLoaded = true;
                dockTeamSchemaReady = dockItemSchemaReady = true;
                dockTeamStatusRenderVersion += 1;
                invalidateDockWorkflowResolvedState();
            }
        }
    };
}

function buildUsersSideBindings(array) {
    return {
        'side:users': {
            stage: async () => {
                const rows = array(await supabaseFetch('ph_app_users', 'GET', null, 'select=*&order=username.asc'), 'App user directory');
                const sort = (values) => values.sort((a, b) => String(a.display || a.username || a).localeCompare(String(b.display || b.username || b), undefined, { sensitivity: 'base' }));
                const evalLabels = new Map();
                rows.forEach((row) => {
                    const username = normalizeEvalAssignableUser(row.username || row.USERNAME || '');
                    if (username) evalLabels.set(username, String(row.display_name || row.DISPLAY_NAME || formatAppUserDisplayName(username) || username));
                });
                return {
                    rows, chat: rows.map(normalizeChatUser).filter(Boolean),
                    generic: sort(rows.map(normalizeAssignableAppUserEntry).filter(Boolean)),
                    flyer: sort(rows.map(normalizeFlyerAssignableUserEntry).filter(Boolean)),
                    dock: sort(Array.from(new Set(rows.filter((row) => isDockAssignableRoleValue(row.role || row.ROLE)).map((row) => String(row.username || row.USERNAME || '').trim()).filter(Boolean)))),
                    evalUsers: sort(Array.from(new Set(rows.filter((row) => isEvalRoleValue(row.role || row.ROLE || '')).map((row) => normalizeEvalAssignableUser(row.username || row.USERNAME || '')).filter((name) => name && !EVAL_TASK_INACTIVE_USERS.has(name))))),
                    evalLabels,
                    email: rows.map(normalizeAppEmailRecipientUserEntry).filter(Boolean),
                    admin: rows.map(normalizeAdminRecipientUserEntry).filter(Boolean)
                };
            },
            commit: (value) => {
                departmentCalendarState.users = value.rows; chatUsers = value.chat;
                dockAssignableUsers = value.dock; assignableAppUsers = value.generic; assignableAppUsersLoaded = true;
                flyerAssignableUsers = value.flyer; evalAssignableUsers = value.evalUsers; evalAssignableUserLabels = value.evalLabels;
                evalAssignableUsersDirectoryResolved = true; evalAssignableUsersLastAttemptAt = Date.now();
                applyAppEmailRecipientUsersToRepGroups(value.email); appEmailRecipientUsersLoaded = true;
                applyAdminRecipientUsersToRepGroups(value.admin); appAdminRecipientUsersLoaded = true;
                applyEvalRecipientUsersToRepGroups(getEvalAssignableUserList());
                // Select values, checkbox state and unsaved text are owned
                // by their dialogs and are never reset by cache refresh.
            }
        },
        'side:avOptionEval': {
            stage: async (ctx) => {
                const query = `select=${AV_OPTION_EVAL_REQUEST_SELECT_FIELDS}&order=created_at.desc&limit=750`;
                const rows = await runDedupeSupabaseRead(`legacy:${AV_OPTION_EVAL_REQUESTS_TABLE}:${query}`, ({ signal }) => runAppApiSupabaseWrite(AV_OPTION_EVAL_REQUESTS_TABLE, 'GET', null, query, { timeoutMs: 22000, signal }), { signal: ctx?.signal || productionLiveSyncNavigation.signal });
                return array(rows).map(normalizeAvOptionEvalRequestRow).filter(Boolean);
            },
            commit: (rows) => { avOptionEvalRequests = rows; avOptionEvalRequestsLoaded = true; avOptionEvalRequestsError = ''; }
        },
        'side:evalWork': {
            stage: async (ctx) => { const result = await evalWorkApi('list', {}, { timeoutMs: 20000, signal: ctx.signal }); return { rows: array(result.data, 'Eval Work'), manager: result.manager === true }; },
            commit: (value) => { evalWorkRows = value.rows; evalWorkManager = value.manager || isEvalWorkManagerUser(); evalWorkLoaded = true; evalWorkError = ''; }
        }
    };
}

function buildBunchQueueSideBindings(array, read, stateReady) {
    return {
        'side:bunchQueue': {
            enabled: (ctx) => !!ctx.username && canUseInvBunchNotes(),
            scope: () => window.BunchQueueShell.scope(),
            stage: (ctx) => window.BunchQueueShell.stage(ctx),
            commit: (value) => window.BunchQueueShell.commit(value)
        },
        'side:bunchNotes': {
            enabled: (ctx) => !!ctx.username,
            scope: (ctx) => ctx.username + ':' + globalThis.BunchNote.scope(),
            stage: (ctx) => globalThis.BunchNote.stage(ctx),
            commit: (value) => { globalThis.BunchNote.commit(value); }
        },
        'side:locationWork': {
            // The protected list/get API restricts non-Dylan users to
            // their assignments. Only job creation is Dylan-only.
            enabled: (ctx) => !!ctx.username,
            scope: (ctx) => ctx.locationWorkJobId || '',
            stage: async (ctx) => {
                const rows = array((await locationWorkApi('list', { status: 'all' }, { timeoutMs: 20000 })).data, 'Location Work');
                const index = rows.findIndex((row) => String(row.id || '') === ctx.locationWorkJobId);
                if (index >= 0) {
                    const detail = (await locationWorkApi('get', { jobId: ctx.locationWorkJobId }, { timeoutMs: 20000 })).data;
                    if (!detail || String(detail.id || '') !== ctx.locationWorkJobId) throw new Error('Location Work detail returned an invalid response.');
                    rows[index] = detail;
                }
                return rows;
            },
            commit: (rows) => { locationWorkRows = rows; locationWorkLoaded = true; locationWorkError = ''; }
        },
        'side:shear': {
            stage: async (ctx) => {
                const [rows, result] = await Promise.all([read(SHEAR_LIST_TABLE, `select=${SHEAR_LIST_SELECT_FIELDS}&status=eq.open&order=created_at.desc`, ctx), shearLocationWorkApi('list', { status: 'active' }, { timeoutMs: 20000, signal: ctx.signal })]);
                const inquiries = array(result.data, 'Shear inquiries');
                // The list is authoritative; only refetch expanded details.
                const detailed = await Promise.all(inquiries.map(async (entry) => {
                    if (!shearListState.openInquiryIds.has(String(entry.id || ''))) return entry;
                    const detail = await shearLocationWorkApi('get', { inquiryId: entry.id }, { timeoutMs: 20000, signal: ctx.signal });
                    if (!detail.data || typeof detail.data !== 'object') throw new Error('Shear inquiry detail was not returned.');
                    return detail.data;
                }));
                return { rows, inquiries: detailed };
            },
            commit: (value) => { stateReady(shearListState, value); }
        }
    };
}
