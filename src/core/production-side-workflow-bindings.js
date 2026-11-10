export function buildSalesWorkspaceSideBindings(array, read, stateReady) {
    return {
        'side:salesWorkspace': {
            enabled: () => !!window.SalesWorkspace?.isView(getCurrentVisibleViewId()),
            scope: () => getCurrentVisibleViewId(),
            stage: () => globalThis.SalesWorkspace.stageRefresh(),
            commit: value => globalThis.SalesWorkspace.applyRefresh(value)
        },
        'side:productionWorkflow': {
            enabled: (ctx) => isProductionWorkflowDriveType(ctx.productionType), scope: (ctx) => ctx.productionType,
            stage: async (ctx) => { const result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'production_workflow', operation: 'list', workflow_type: ctx.productionType }, { timeoutMs: 30000, label: 'Production', signal: ctx.signal }); if (!result?.ok) throw new Error(result?.message || 'Production data is unavailable.'); return array(result.rows, 'Production'); },
            commit: (rows, ctx) => { stateReady(productionWorkflowState, { rows, workflowType: ctx.productionType }); }
        },
        'side:spreadCounts': {
            enabled: (ctx) => normalizeSpreadCountType(ctx.countType) !== 'bunch', scope: (ctx) => ctx.countType,
            stage: (ctx) => read(getActiveSpreadCountTableName(ctx.countType), `select=${SPREAD_COUNT_SELECT_FIELDS}&order=blockalpha.asc,locationcode.asc,row_order.asc,updated_at.desc`),
            commit: (rows, ctx) => { stateReady(spreadCountState, { rows, countType: normalizeSpreadCountType(ctx.countType) }); rebuildSpreadCountIndexes(); }
        },
        'side:bunchCounts': {
            enabled: (ctx) => normalizeSpreadCountType(ctx.countType) === 'bunch', scope: (ctx) => ctx.countType,
            stage: (ctx) => read(getActiveSpreadCountTableName(ctx.countType), `select=${SPREAD_COUNT_SELECT_FIELDS}&order=blockalpha.asc,locationcode.asc,row_order.asc,updated_at.desc`),
            commit: (rows, ctx) => { stateReady(spreadCountState, { rows, countType: normalizeSpreadCountType(ctx.countType) }); rebuildSpreadCountIndexes(); }
        },
        'side:takeBack': {
            stage: async () => {
                const rows = (await read(TAKE_BACK_TABLE, `select=${TAKE_BACK_SELECT_FIELDS}&status=eq.open&order=added_at.desc`)).map(normalizeTakeBackRow).filter(Boolean);
                return { rows, byId: new Map(rows.map((row) => [row.UNIQUE_ID, row])) };
            },
            commit: (value) => { takeBackRows = value.rows; takeBackRowsById = value.byId; takeBackDataLoaded = true; takeBackSchemaReady = true; }
        },
        'side:po': {
            scope: (ctx) => ctx.poSeason || '27F1',
            stage: async (ctx) => array(await fetchPoManagementRows(ctx.poSeason), 'PO Management'),
            commit: (rows, ctx) => { if ((ctx.poSeason || '27F1') === (poManagementState.season || '27F1')) stateReady(poManagementState, { rows }); }
        }
    };
}

export function buildChatSideBindings(array, read, stateReady, emitCommunicationSourceRefresh) {
    return {
        'side:chat': {
            scope: (ctx) => ctx.username,
            stage: async (ctx) => {
                const own = array(await chatApiGet(CHAT_PARTICIPANTS_TABLE, `select=*&username=eq.${encodeURIComponent(ctx.username)}&is_archived=eq.false&order=joined_at.desc`, 'Chat participants', ctx)).map(normalizeChatParticipant).filter(Boolean);
                const ids = Array.from(new Set(own.map((entry) => entry.conversationId).filter(Boolean)));
                if (!ids.length) return { conversations: [], participants: own, messages: [], ids };
                const idList = ids.join(',');
                const [conversations, participants, messages] = await Promise.all([
                    chatApiGet(CHAT_CONVERSATIONS_TABLE, `select=*&id=in.(${idList})&order=updated_at.desc`, 'Chat conversations', ctx),
                    chatApiGet(CHAT_PARTICIPANTS_TABLE, `select=*&conversation_id=in.(${idList})&order=display_name.asc`, 'Chat participants', ctx),
                    chatApiGet(CHAT_MESSAGES_TABLE, `select=*&conversation_id=in.(${idList})&order=created_at.desc&limit=500`, 'Chat messages', ctx)
                ]);
                return { ids, conversations: array(conversations).map(normalizeChatConversation).filter(Boolean), participants: array(participants).map(normalizeChatParticipant).filter(Boolean), messages: array(messages).map(normalizeChatMessage).filter(Boolean).sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) };
            },
            commit: (value) => {
                chatConversations = value.conversations; chatParticipants = value.participants; chatMessages = value.messages; chatDataLoaded = true;
                if (activeChatConversationId && !value.ids.includes(activeChatConversationId)) activeChatConversationId = '';
                emitCommunicationSourceRefresh('communications-chat',
                    window.GncManagerSourceLiveEvents?.sourcesFor('communications-chat') || []);
                // Read receipts and notifications belong to explicit user activity, not passive hydration.
            }
        },
        'side:calendar': {
            stage: async (ctx) => (await read(DEPARTMENT_CALENDAR_EVENTS_TABLE, 'select=*&order=start_at.asc', ctx)).map(normalizeDepartmentCalendarEvent).filter(Boolean),
            commit: (events) => {
                stateReady(departmentCalendarState, { events });
                emitCommunicationSourceRefresh('communications-calendar',
                    window.GncManagerSourceLiveEvents?.sourcesFor('communications-calendar') || []);
            }
        },
        'side:weather': {
            stage: async () => {
                const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
                const [weatherRows, dailyWeatherRows] = await Promise.all([
                    read('ph_weather_hourly', `select=observed_at,local_time,temperature_f,relative_humidity,precipitation_in,wind_speed_mph,wind_direction_deg,gdd_base_50,chill_hours&station_key=eq.park_hill_ok&observed_at=gte.${encodeURIComponent(cutoff)}&order=observed_at.desc`),
                    read('ph_weather_daily', `select=date,temperature_high_f,temperature_low_f,daily_gdd_base_50,precipitation_in,wind_speed_mph,wind_direction_deg&station_key=eq.park_hill_ok&date=gte.${cutoff.slice(0, 10)}&order=date.desc`)
                ]);
                return { weatherRows, dailyWeatherRows };
            },
            commit: (value) => { stateReady(weatherHoldState, value); }
        }
    };
}

export function buildHoldRiskSideBindings(array, read, stateReady) {
    return {
        'side:holdRisk': {
            enabled: () => canUseWeatherHoldRiskTools(),
            stage: async () => {
                const [holdSummaries, holdProfiles] = await Promise.all([read('ph_hold_stop_itemcode_summaries', 'select=*&order=itemcode.asc'), read('ph_hold_learning_profiles', 'select=*&order=itemcode.asc')]);
                return { holdSummaries, holdProfiles };
            },
            commit: (value) => { Object.assign(weatherHoldState, value, { riskLoaded: true, riskError: '', riskLastLoadedAt: Date.now() }); }
        },
        'side:deliveryRecovery': {
            enabled: () => canManageRequestDeliveryRecovery(),
            stage: async () => {
                const [rows, statuses] = await Promise.all([supabaseRpc('get_request_delivery_recovery_queue', {}, { timeoutMs: 30000 }), read('ph_request_delivery_status', 'select=delivery_status')]);
                const summary = { pending: 0, processing: 0, failed: 0, delivered: 0 };
                statuses.forEach((row) => { const status = String(row.delivery_status || '').toLowerCase(); if (Object.hasOwn(summary, status)) summary[status] += 1; });
                return { rows: array(rows), summary };
            },
            commit: (value) => { requestDeliveryRecoveryRows = value.rows; requestDeliveryRecoverySummary = value.summary; requestDeliveryRecoveryError = ''; }
        },
        'side:managerOrders': {
            enabled: () => canViewManagerOrders(), scope: (ctx) => [ctx.managerOrders.level, ctx.managerOrders.sourceKey, ctx.managerOrders.batchId, ctx.managerOrders.assignees],
            stage: async (ctx) => {
                const current = ctx.managerOrders;
                if (current.level === 'detail' && current.batchId) {
                    let cursor = null; let result; const rows = [];
                    do {
                        result = await supabaseRpc('get_manager_order_batch_v1', { p_batch_id: current.batchId, p_assignedto_keys: current.assignees, p_after_itemcode: cursor?.itemcode || null, p_after_unique_id: cursor?.uniqueId || null, p_limit: 100 }, { timeoutMs: 20000 });
                        rows.push(...array(result?.rows, 'Order batch')); cursor = result.nextCursor;
                    } while (result.hasMore && cursor && rows.length < Math.max(100, current.rowCount));
                    return { batch: result.batch || null, rows, assignees: array(result.assignees), unmatchedItems: array(result.unmatchedItems), unmatchedItemsTruncated: !!result.unmatchedItemsTruncated, filteredRowCount: Number(result.filteredRowCount || 0), rowsHasMore: !!result.hasMore, rowsNextCursor: cursor };
                }
                if (current.sourceKey && current.level === 'batches') {
                    let cursor = null; let result; const batches = [];
                    do {
                        result = await supabaseRpc('get_manager_order_batches_v1', { p_source_key: current.sourceKey, p_before_imported_at: cursor?.importedAt || null, p_before_batch_id: cursor?.batchId || null, p_limit: 25 }, { timeoutMs: 15000 });
                        batches.push(...array(result?.batches, 'Order batches')); cursor = result.nextCursor;
                    } while (result.hasMore && cursor && batches.length < Math.max(25, current.batchCount));
                    return { batches, batchesHasMore: !!result.hasMore, batchesNextCursor: cursor };
                }
                const result = await supabaseRpc('get_manager_order_sources_v1', {}, { timeoutMs: 15000 });
                return { sources: array(result?.sources, 'Order sources') };
            },
            commit: (value) => { stateReady(managerOrdersState, value); }
        },
        'side:managerEvalSettings': {
            enabled: () => canViewManagerEvalReports() || canViewManagerEvalReports2(),
            stage: async () => normalizeManagerEvalReportSettings(await supabaseRpc('get_eval_report_settings', {}, { timeoutMs: 15000 })),
            commit: (value) => { managerEvalReportSettings = value; stateReady(managerEvalReportSettingsState, { fallback: false }); invalidateManagerEvalReportCache(); }
        }
    };
}

export function buildItemLowStockTargetsSideBindings(api, array, read, stateReady) {
    return {
        'side:itemLowStockTargets': {
            enabled: () => canReadItemLowStockTargets(),
            // Source timestamps and view epochs change when this adapter commits; using them as scope would invalidate the same lookup forever.
            scope: () => JSON.stringify(getManagerItemLowStockTargetCodes()),
            stage: async () => {
                const assignedRows = Array.isArray(warehouseAssignedItemsInventory) ? warehouseAssignedItemsInventory : [];
                const codes = getManagerItemLowStockTargetCodes(assignedRows);
                return { key: getManagerAssignedItemTargetKey(assignedRows), rows: await fetchManagerItemLowStockTargets(codes) };
            },
            commit: (snapshot) => {
                const state = getManagerItemLowStockTargetsState();
                const rowsByCode = new Map();
                (Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : []).forEach(target => {
                    const code = normalizeManagerItemLowStockTargetCode(target && target.itemcode_normalized);
                    if (code) rowsByCode.set(code, target);
                });
                state.rowsByCode = rowsByCode;
                state.key = snapshot && snapshot.key || getManagerAssignedItemTargetKey();
                state.revision += 1;
            }
        },
        'side:ncr': {
            stage: async () => api.keyed(await read(NCR_COMPLETIONS_TABLE, `select=${NCR_COMPLETION_SELECT_FIELDS}&order=completed_at.desc`), (row) => row, (row) => String(row.source_unique_id || '').trim()),
            commit: (value) => { ncrCompletionRecordsByUid = value; ncrCompletionsLoaded = true; ncrCompletionSchemaReady = true; }
        },
        'side:productivity': {
            enabled: (ctx) => !!ctx.productivityUser, scope: (ctx) => ctx.productivityUser,
            stage: async (ctx) => mergeProductivityHistoryRows([], await read(PRODUCTIVITY_HISTORY_TABLE, `select=${PRODUCTIVITY_HISTORY_SELECT_FIELDS}&completed_by_username=eq.${encodeURIComponent(ctx.productivityUser)}&order=completed_at.desc`)).filter((row) => isSupportedProductivitySourceKind(firstNonEmptyValue(row?.source_kind, row?.snapshot?.source_kind, ''))),
            commit: (rows, ctx) => { productivityHistoryByUser.set(ctx.productivityUser, rows); stateReady(getProductivityHistoryState(ctx.productivityUser), { loadedAt: new Date().toISOString(), schemaReady: true }); }
        },
        'side:transactions': {
            enabled: () => canViewInventoryTransactionHistory(),
            scope: (ctx) => ctx.transactions,
            stage: async (ctx) => {
                const state = ctx.transactions;
                const result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'inventory_transaction_history', filter_action: state.action || 'all', search: state.search || managersSearchTerm || '', dateStart: state.dateStart || '', dateEnd: state.dateEnd || '', limit: 100, offset: state.offset || 0 }, { timeoutMs: 45000, label: 'Transaction History' });
                if (!result || result.ok === false || result.httpOk === false) throw new Error(result?.message || 'Transaction history could not load.');
                return { rows: array(result.rows, 'Transaction history'), hasMore: result.hasMore === true, count: result.count };
            },
            commit: (rows) => { stateReady(inventoryTransactionHistoryState, rows); if (typeof refreshInventoryTransactionHistoryResults === 'function') refreshInventoryTransactionHistoryResults(); }
        }
    };
}

export function buildTransactionsKeyedSideBindings(array, stateReady) {
    return {
        'side:transactionsKeyed': {
            enabled: () => canViewTransactionsKeyed(), scope: (ctx) => [ctx.transactionsKeyed.selectedDate, ctx.transactionsKeyed.search],
            stage: async (ctx) => {
                const state = ctx.transactionsKeyed;
                const result = await supabaseRpc('get_transactions_keyed_dashboard', { selected_date: state.selectedDate || null, creator_search: state.search || '', all_dates_offset: 0, all_dates_limit: Math.max(250, state.dateCount), files_offset: 0, files_limit: Math.max(50, state.fileCount) }, { timeoutMs: 30000 });
                for (const key of ['availableDates', 'dateMetrics', 'allDates', 'files']) array(result?.[key], key);
                return result;
            },
            commit: (value) => {
                const keys = ['summary', 'availableDates', 'dateMetrics', 'allDates', 'files', 'allDatesHasMore', 'filesHasMore', 'allDatesTotal', 'filesTotal'];
                stateReady(managerTransactionsKeyedState, Object.fromEntries(keys.map((key) => [key, value[key]])));
            }
        },
        'side:historical': {
            enabled: () => canViewManagerHistoricalReport(), scope: (ctx) => [ctx.historical.level, ctx.historical.name, ctx.historical.size, ctx.historical.columns, ctx.historical.dateStart, ctx.historical.dateEnd, ctx.historical.search],
            stage: async (ctx) => {
                const state = ctx.historical;
                if (state.level === 'names') return { commonNames: array(await supabaseRpc('search_historical_inventory_common_names', { search_text: state.search || '', result_limit: 100 }, { timeoutMs: 30000 })) };
                if (state.level === 'sizes') return { containerSizes: array(await supabaseRpc('get_historical_inventory_container_sizes', { common_name: state.name }, { timeoutMs: 30000 })) };
                let cursor = {}; let result; const rows = [];
                do {
                    result = await supabaseRpc('get_historical_inventory_rows', { common_name: state.name, container_size: state.size, selected_columns: state.columns, start_date: state.dateStart || null, end_date: state.dateEnd || null, cursor_report_date: cursor.report_date || null, cursor_unique_id: cursor.unique_id || null, result_limit: 100 }, { timeoutMs: 45000 });
                    rows.push(...array(result?.rows, 'Historical inventory')); cursor = result.next_cursor || {};
                } while (result.has_more && result.next_cursor && rows.length < Math.max(100, state.rowCount));
                return { rows, loadedColumns: array(result.selected_columns), hasMore: !!result.has_more, nextCursor: result.next_cursor || null };
            },
            commit: (value) => { stateReady(managerHistoricalReportState, value); }
        },
        'side:access': {
            enabled: () => canViewAccessControl(), scope: (ctx) => ctx.accessQuery,
            stage: async (ctx) => {
                const value = normalizeAccessControlMatrix(await supabaseRpc(isKaylaLimitedAccessManagerUser() ? 'get_limited_access_control_matrix_v1' : 'get_access_control_matrix_v2', { p_query: ctx.accessQuery }, { timeoutMs: 20000 }));
                if (!value) throw new Error('ACCESS_CONTROL_RESPONSE_INVALID');
                return value;
            },
            commit: (value) => { stateReady(accessControlAdminState, { data: value, capabilities: value.capabilities }); }
        },
        'side:codex': {
            enabled: (ctx) => ctx.username === 'dylan_collyge', scope: (ctx) => ctx.codexTaskId,
            stage: async (ctx) => {
                const capabilities = await invokeCodexOpsApi('capabilities', {}, 20000);
                if (capabilities?.canView !== true || capabilities.submissionEnabled !== true) return { capabilities, tasks: [], activeTask: null };
                const [tasks, task] = await Promise.all([invokeCodexOpsApi('list', { limit: 50 }, 25000), ctx.codexTaskId ? invokeCodexOpsApi('get', { taskId: ctx.codexTaskId, eventLimit: 200 }, 25000) : null]);
                return { capabilities, tasks: array(tasks), activeTask: task };
            },
            commit: (value) => { Object.assign(codexOpsState, value, { capabilitiesLoaded: true, tasksLoaded: true, error: '' }); }
        }
    };
}

export function buildPendingOrdersSideBindings(array) {
    return {
        'side:pendingOrders': {
            enabled: () => canViewBloomscapesPendingOrders(),
            stage: async (ctx) => {
                if (!canViewBloomscapesPendingOrders()) throw new Error('Private order access is unavailable.');
                const orders = []; let result;
                do {
                    const last = orders[orders.length - 1];
                    result = await supabaseRpc('bloomscapes_pending_command', { p_action: 'state', p_payload: last ? { beforeTime: last.created_at, beforeId: last.id } : {}, p_request_id: null }, { timeoutMs: 20000 });
                    if (result?.mode !== 'pending-unpaid' || result.paymentEnabled !== false || result.stockReserved !== false) throw new Error('Unexpected pending-order response.');
                    orders.push(...array(result.orders, 'Pending orders'));
                } while (result.orders.length === 25 && orders.length < Math.max(25, ctx.pendingOrderCount));
                return { orders, more: result.orders.length === 25 };
            },
            commit: (value) => { if (canViewBloomscapesPendingOrders()) Object.assign(bloomscapesPendingState, value, { error: '' }); }
        }
    };
}
