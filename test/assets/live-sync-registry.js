(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricLiveSyncRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const unique = (values) => Array.from(new Set(values));
    const core = {
        master: ['ph_master_inventory'], cropRollDrive: ['ph_crop_roll_drive_rows', 'ph_crop_roll_completed_drive_keys'],
        avOpen: ['ph_master_inventory'], requests: ['ph_requests_pending', 'ph_master_inventory', 'ph_request_delivery_outbox'],
        requestHistory: ['ph_requests_completed_history'], salesCredits: ['ph_sales_credit_requests'],
        inventoryEditRequests: ['ph_inventory_edit_requests', 'ph_inventory_edit_request_events'],
        reserves: ['ph_reserves', 'ph_master_inventory'], customerRepMap: ['ph_customer_consignee_sales_reps'],
        // Raw SOC caches do not change when inventory enrichment changes.
        soc: ['ph_soc_master'], suspendTag: ['ph_soc_master'], salesOffice: ['ph_sales_office'],
        flyerRows: ['ph_flyer_folder_rows'], flyerHistory: ['ph_flyer_folder_history'],
        growerScoutReports: ['ph_grower_scout_reports'], growerScoutAssets: ['ph_grower_scout_assets'],
        warehouseAssignedItems: ['ph_inventory_row_assignments'], cav: ['ph_cav_import'], cavAvBlankKeys: ['ph_cav_import'],
        avHotPriceKeys: ['ph_cav_import', 'ph_master_inventory'], avNotes: ['ph_av_notes']
    };
    const side = {
        salesWorkspace: ['ph_requests_completed_history','ph_credit_sources','ph_credit_submissions','ph_sales_credit_requests','ph_credit_attachments'],
        settings: ['ph_app_settings'],
        driveReserves: ['ph_reserves', 'ph_master_inventory'],
        driveOpenOrders: ['ph_soc_master', 'ph_master_inventory'],
        coverage: ['ph_item_inquiry_coverage'],
        dockWorkflow: ['ph_dock_trip_status', 'ph_dock_item_status', 'ph_dock_issue_status', 'ph_dock_issue_allocations'],
        users: ['ph_app_users'],
        // This adapter is intentionally revision-only: Customer Assignments
        // owns a server-paged list and must not hydrate the full mapping table.
        customerMappingRevision: ['ph_customer_consignee_sales_reps'],
        companyDirectoryRevision: ['ph_company_directory_contacts', 'ph_company_directory_blocks', 'ph_company_directory_beds', 'ph_company_directory_codes'],
        queueInventoryRevision: ['ph_master_inventory'],
        productionScheduleRevision: ['production_schedule_active'],
        hrCommandRevision: ['core_employees', 'hr_job_codes', 'labor_timesheets', 'ph_department_calendar_events'],
        avOptionEval: ['ph_av_option_eval_requests'],
        evalWork: ['ph_eval_work', 'ph_eval_work_origin_rows', 'ph_eval_work_events', 'ph_request_delivery_outbox'],
        bunchNotes: ['bunch_note_private.jobs', 'bunch_note_private.previews'],
        bunchQueue: ['bunch_note_private.jobs', 'bunch_note_private.previews', 'ph_master_inventory'],
        locationWork: ['ph_location_work_jobs', 'ph_location_work_lines', 'ph_location_work_assignments', 'ph_request_delivery_outbox'],
        shear: ['ph_shear_list', 'ph_shear_location_inquiries', 'ph_shear_location_items', 'ph_shear_location_rows', 'ph_request_delivery_outbox'],
        productionWorkflow: ['ph_production_workflow_rows'],
        spreadCounts: ['ph_spread_counts'], bunchCounts: ['ph_bunch_counts'],
        cropRoll: ['ph_crop_roll_runs', 'ph_crop_roll_rows'],
        takeBack: ['ph_take_back_queue'],
        po: ['ph_27f1_hl_po', 'ph_27s1_hl_po', 'ph_master_inventory', 'ph_soc_master', 'hl_po_parsed'],
        chat: ['ph_chat_conversations', 'ph_chat_participants', 'ph_chat_messages'],
        calendar: ['ph_department_calendar_events'],
        weather: ['ph_weather_hourly', 'ph_weather_daily'],
        holdRisk: ['ph_hold_stop_itemcode_summaries', 'ph_hold_learning_profiles'],
        deliveryRecovery: ['ph_request_delivery_outbox'],
        managerOrders: ['ph_pikes_order_batches', 'ph_pikes_order_source_rows'],
        managerEvalSettings: ['ph_eval_report_settings'],
        reportEval1: ['ph_master_inventory', 'ph_eval_report_settings', 'ph_app_settings'],
        reportEval2: ['ph_master_inventory', 'ph_inventory_row_assignments', 'ph_eval_report_settings', 'ph_app_settings'],
        reportNcr: ['ph_master_inventory', 'ph_app_settings'],
        reportAssigned: ['ph_master_inventory', 'ph_inventory_row_assignments', 'ph_eval_report_settings'],
        reportSeason: ['ph_master_inventory', 'ph_inventory_row_assignments', 'ph_cav_import', 'ph_app_settings'],
        reportApproval: ['ph_master_inventory', 'ph_ncr_completions', 'ph_shear_list', 'ph_inventory_edit_requests'],
        homeSyncMetadata: ['ph_master_inventory', 'ph_soc_master', 'ph_reserves', 'ph_cav_import', 'hl_po_parsed'],
        itemLowStockTargets: ['ph_eval_report_settings'],
        ncr: ['ph_ncr_completions'],
        productivity: ['ph_productivity_history'],
        transactions: ['ph_inventory_transactions'],
        transactionsKeyed: ['ph_transactions_keyed_files', 'ph_transactions_keyed_rows'],
        historical: ['ph_historical_inventory_dimensions', 'ph_drive_around_report_rows'],
        access: ['profiles', 'private.app_access_permissions', 'private.app_access_policy_versions', 'private.app_access_role_grants', 'private.app_access_user_overrides', 'private.app_access_maintainers', 'private.app_access_legacy_baseline', 'private.app_access_legacy_checks', 'private.app_access_runtime_state'],
        codex: ['private.codex_ops_tasks', 'private.codex_ops_messages', 'private.codex_ops_events', 'private.codex_ops_attachments', 'private.codex_ops_approvals', 'ph_runtime_feature_flags'],
        pendingOrders: ['bloomscapes_private.orders', 'bloomscapes_private.order_lines']
    };
    const canonical = {
        requests: { active: 'ph_active_request', history: 'ph_request_history', support: 'ph_delivery_outbox' },
        driveMode: { active: 'ph_active_drive_mode', history: 'ph_drive_mode_history', support: 'ph_historical_inventory_dimensions' },
        locationMoves: { active: 'ph_active_location_moves', history: 'ph_location_moves_history', support: 'ph_location_work_jobs' },
        suspend: { active: 'ph_active_suspend', history: 'ph_suspend_history', support: 'ph_master_inventory' },
        recount: { active: 'ph_active_recount', history: 'ph_recount_history', support: 'ph_reclass_recount_lines' },
        countReview: { active: 'ph_active_count_review', history: 'ph_count_review_history', support: 'ph_bunch_counts' },
        shearList: { active: 'ph_active_shear_list', history: 'ph_shear_list_history', support: 'ph_shear_location_inquiries' },
        evalWork: { active: 'ph_active_eval_work', history: 'ph_eval_work_history', support: 'ph_eval_work_events' },
        bunchNotes: { active: 'ph_active_bunch_notes', history: 'ph_bunch_notes_history', support: 'bunch_note_private.previews' },
        docks: { active: 'ph_active_docks', history: 'ph_docks_history', support: 'ph_dock_item_status' },
        orders: { active: 'ph_active_orders', history: 'ph_orders_history', support: 'ph_pikes_order_batches' },
        reserves: { active: 'ph_active_reserves', history: 'ph_reserves_history', support: 'ph_master_inventory' },
        hlOrder: { active: 'ph_active_hl_order', history: 'ph_hl_order_history', support: 'ph_27f1_hl_po' },
        salesOffice: { active: 'ph_active_sales_office', history: 'ph_sales_office_history', support: 'ph_season_sales_office_state' },
        flyer: { active: 'ph_active_flyer', history: 'ph_flyer_history', support: 'ph_delivery_outbox' },
        cropRoll: { active: 'ph_active_crop_roll', history: 'ph_crop_roll_history', support: 'ph_crop_roll_rows' },
        production: { active: 'ph_active_production', history: 'ph_production_history', support: 'ph_productivity_history' },
        productionSchedule: { active: 'ph_active_production_schedule', history: 'ph_production_schedule_history', support: 'production_schedule_rows' },
        holdLearning: { active: 'ph_active_hold_learning', history: 'ph_hold_learning_history', support: 'ph_hold_stop_itemcode_summaries' },
        chat: { active: 'ph_active_chat', history: 'ph_chat_history', support: 'ph_chat_participants' },
        walkie: { active: 'ph_active_walkie', history: 'ph_walkie_history', support: 'ph_walkie_signal_events' }
    };
    const data = (datasets, adapters = []) => ({ kind: 'data', datasets, adapters });
    const navigation = { kind: 'navigation', datasets: [], adapters: [] };
    const staticView = { kind: 'static', datasets: [], adapters: [] };
    const views = {
        home: navigation,
        building: data(['master'], ['settings']),
        // The Managers module is a navigation hub. Each selected tab registers
        // its own joined dataset cohort below so unrelated reports don't gate it.
        managers: navigation,
        'crop-roll': data(['cropRollDrive', 'master'], ['cropRoll', 'settings']),
        drive: data(['master'], ['settings']),
        av: data(['avOpen', 'master', 'reserves', 'customerRepMap', 'avHotPriceKeys', 'avNotes'], ['settings']),
        reserves: data(['reserves', 'master', 'customerRepMap']),
        docks: data(['soc', 'master', 'customerRepMap'], ['dockWorkflow', 'queueInventoryRevision']),
        'hl-order': data(['soc', 'master']),
        'bunch-note': data([], ['bunchNotes']),
        'historical-requests': data([], []), // Narrow authenticated RPC; never materialize all requests in the shell.
        'request-sales-impact': data([], []),
        'request-history': data([], ['salesWorkspace']),
        'sales-credit': data([], ['salesWorkspace']),
        'credit-request': data([], ['salesWorkspace']),
        request: data(['requests', 'master', 'customerRepMap']),
        reports: data(['requests', 'requestHistory', 'salesCredits', 'soc', 'master', 'reserves', 'customerRepMap'], ['settings']),
        'sales-office': data(['salesOffice', 'master', 'flyerRows', 'flyerHistory'], ['settings']),
        'smart-moves': data(['master', 'soc', 'reserves', 'customerRepMap', 'requests']),
        moves: data(['salesOffice', 'master', 'requests', 'inventoryEditRequests']),
        tasks: data(['master', 'requests', 'salesOffice', 'warehouseAssignedItems'], ['settings']),
        review: data(['master'], ['ncr']), 'move-up': data(['master', 'salesOffice'], ['ncr']),
        'low-stock': data(['master'], ['settings']), advertisement: data(['master', 'avNotes', 'flyerRows', 'flyerHistory'], ['settings']),
        grower: data(['master', 'growerScoutReports', 'growerScoutAssets']),
        'pest-management': data(['master', 'growerScoutReports', 'growerScoutAssets']),
        'shear-list': data(['master', 'reserves'], ['shear']),
        'take-back': data(['master'], ['takeBack']),
        'production-workflow': data(['master'], ['productionWorkflow']),
        'sales-inventory': data(['master', 'salesOffice']),
        'inventory-suggestion': navigation,
        'inv-consolidation': data([], []),
        'weather-hold': data(['master', 'reserves'], ['weather']),
        'po-management': data([], ['po']), chat: data([], ['chat']),
        'department-calendar': data([], ['calendar', 'users']), communication: data([], ['chat', 'calendar']),
        sales: navigation, qc: navigation, office: navigation, production: navigation,
        'disease-pest': navigation, hours: staticView,
        detail: { kind: 'detail', datasets: ['master', 'reserves', 'avNotes'], adapters: ['settings'] },
        login: staticView, 'change-password': staticView
    };
    // A surface is a data-bearing subview, badge or dialog. These are not separate routes.
    const surfaces = {
        'home:sync-metadata': data([], ['homeSyncMetadata']),
        'dialog:av-notes': data(['avNotes']),
        'detail:reserves': data([], ['driveReserves']),
        'detail:open-orders': data([], ['driveOpenOrders']),
        'request:bunch-notes': data([], ['bunchQueue']),
        'request:bunch-count-review': data([], ['bunchQueue']),
        // Pending rows are fully expanded by the requests dataset. History,
        // credits and edit-request joins belong to their consuming subviews.
        'request:pending': data([], ['queueInventoryRevision']),
        // Archived rows come from the capability-checked app-api snapshot RPC;
        // they do not subscribe to or refresh the broad live Request datasets.
        'request:archived': data([]),
        'request:reps': data(['requests', 'requestHistory', 'salesCredits']),
        // Suspend Tag renders its own queue rows first. Exact inventory rows are
        // fetched lazily per card for metrics and reclassification, so neither
        // the complete master scan nor the customer map belongs in this gate.
        'request:suspend-tag': data(['suspendTag'], ['queueInventoryRevision']),
        'request:eval-work': data(['master'], ['evalWork']),
        'request:av-check': data(['master'], ['avOptionEval']),
        'request:moves': data(['master', 'inventoryEditRequests'], ['locationWork']),
        'request:recount': data(['master', 'requests', 'salesOffice'], ['ncr']),
        'request:shear-list': data(['master', 'reserves'], ['shear']),
        'request:shear-test': data(['master', 'reserves', 'inventoryEditRequests'], ['shear']),
        'request:delivery-recovery': data([], ['deliveryRecovery']),
        'sales-inventory:counting': data(['master'], ['spreadCounts', 'bunchCounts']),
        'moves:crop-roll': data(['master'], ['cropRoll']),
        'managers:orders': data([], ['managerOrders']),
        'managers:customer-rep-map': data([], ['customerMappingRevision']),
        'managers:company-directory': data([], ['companyDirectoryRevision']),
        'managers:production-schedule': data([], ['productionScheduleRevision']),
        'managers:hr-command': data([], ['hrCommandRevision']),
        'managers:moves': data(['salesOffice', 'master', 'requests', 'inventoryEditRequests']),
        'managers:inventory-checks': data(['master', 'inventoryEditRequests']),
        'managers:assigned-items-export': data(['master', 'warehouseAssignedItems'], ['itemLowStockTargets']),
        'managers:eval-reports': data(['master'], ['managerEvalSettings']),
        'managers:eval-reports-2': data(['master', 'warehouseAssignedItems'], ['managerEvalSettings']),
        'managers:eval-reports-2-low-stock': data([], ['itemLowStockTargets']),
        'managers:inventory-transaction-history': data([], ['transactions']),
        'managers:transactions-keyed': data([], ['transactionsKeyed']),
        'managers:historical-report': data([], ['historical']),
        'managers:access-control': data([], ['access']),
        'managers:codex-operations': data([], ['codex']),
        'managers:productivity': data([], ['productivity']),
        'managers:crop-roll': data(['cropRollDrive', 'master'], ['cropRoll']),
        'managers:dashboard': data([]),
        'managers:approval': data(['master']),
        'managers:inventory-checks-approvals': data(['master', 'inventoryEditRequests']),
        'managers:move-up-approvals': data(['master'], ['ncr']),
        'managers:move-down-approvals': data(['master'], ['ncr']),
        'managers:hold-release-approvals': data(['master'], ['ncr']),
        'managers:recount-approvals': data(['master'], ['ncr']),
        'managers:ncr-approvals': data(['master'], ['ncr']),
        'managers:not-on-inventory-approvals': data(['master']),
        'managers:shear-approvals': data(['master'], ['shear']),
        'managers:season-settings': data(['master'], ['settings']),
        'managers:av-blanks-photo-bypass': data(['master', 'cavAvBlankKeys', 'cav']),
        'managers:item-inquiry-coverage': data([], ['coverage']),
        'managers:shortage-cancel': data(['master']),
        'managers:block-clearing': data(['master']),
        'managers:sales-reps': data(['salesOffice', 'master', 'customerRepMap']),
        'managers:delivery-recovery': data([], ['deliveryRecovery']),
        'managers:season-priority': data(['master'], ['settings']),
        'weather-hold:risk': data([], ['holdRisk']),
        'dialog:pending-orders': data([], ['pendingOrders']),
        'dialog:dock-team': data([], ['dockWorkflow', 'users']),
        'dialog:bloom-picker': data(['reserves', 'customerRepMap']),
        'dialog:assignees': data([], ['users']),
        'dialog:eval-assignees': data(['warehouseAssignedItems'], ['users']),
        'dialog:recipients': data([], ['users']),
        'dialog:request': data(['master', 'reserves', 'customerRepMap', 'requests']),
        'dialog:item-inquiry': data(['master', 'reserves', 'avNotes'], ['coverage']),
        'dialog:shear': data(['master', 'reserves'], ['shear']),
        'badge:queue': data(['requests', 'salesCredits', 'inventoryEditRequests', 'suspendTag', 'salesOffice'], ['shear', 'evalWork', 'locationWork', 'bunchQueue']),
        'badge:communications': data([], ['chat', 'calendar'])
    };
    const evalRowViews = new Set(['drive', 'crop-roll', 'av', 'docks', 'sales-inventory', 'weather-hold', 'reserves', 'sales-office', 'moves', 'tasks', 'low-stock', 'review', 'move-up']);
    const adapters = {};
    Object.entries(core).forEach(([id, sourceKeys]) => { adapters[`core:${id}`] = { id: `core:${id}`, kind: 'core', sourceKeys }; });
    Object.entries(side).forEach(([id, sourceKeys]) => { adapters[`side:${id}`] = { id: `side:${id}`, kind: 'side', sourceKeys }; });
    function getEntries(viewId, context = {}) {
        const view = views[viewId];
        if (!view) throw new Error(`Unregistered live-sync view: ${viewId}`);
        // Assigned-work access to the Inventory hub must not grant broad inventory reads.
        if (viewId === 'sales-inventory' && context.inventoryNavigationOnly) return [navigation];
        const requestedSurfaces = context.surfaces || [];
        const requestBunchNotes = viewId === 'request' && requestedSurfaces.some(surface => ['request:bunch-notes', 'request:bunch-count-review'].includes(surface));
        const requestArchived = viewId === 'request' && requestedSurfaces.includes('request:archived');
        const requestPending = viewId === 'request' && requestedSurfaces.includes('request:pending');
        const requestSuspendTag = viewId === 'request' && requestedSurfaces.includes('request:suspend-tag');
        // A paged report owns its read-only list cache. Dialogs and write proof
        // still request their normal complete source adapters.
        const pagedReport = context.pagedReportSurface && !requestedSurfaces.some(id => id.startsWith('dialog:'));
        const reportAdapter = { eval1:'reportEval1', eval2:'reportEval2', ncr:'reportNcr', 'assigned-items':'reportAssigned', 'season-priority':'reportSeason', approval:'reportApproval' }[context.pagedReportSurface];
        const avOpen = viewId === 'av';
        const avTab = String(context.avTab || 'open').trim().toLowerCase();
        const avBucket = String(context.avSalesBucket || 'current').trim().toLowerCase();
        const avDatasets = avOpen ? ['avOpen', 'master', 'reserves'] : null;
        if (avOpen && (context.avRepCustomerFilterData === true || avTab === 'reserves'
            || avBucket === 'customer' || avBucket === 'customer-open')) avDatasets.push('customerRepMap');
        if (avOpen && avBucket === 'hot-price') avDatasets.push('avHotPriceKeys');
        const entries = [pagedReport ? data([], reportAdapter ? ['settings', reportAdapter] : []) : avOpen ? data(avDatasets, ['settings']) : requestBunchNotes ? data([], ['bunchQueue'])
            : requestArchived ? data([], [])
            : requestPending ? data(['requests'])
            : requestSuspendTag ? data([])
            : viewId === 'detail' && context.driveDetail ? data(['master'], ['settings']) : view];
        if (viewId === 'tasks') {
            const task = String(context.taskView || '').toLowerCase();
            const filter = String(context.taskFilter || '').toLowerCase();
            if (task === 'flyer') entries.push(data(['flyerRows', 'flyerHistory']));
            if ([task, filter].some(value => value === 'hot-price' || value === 'hot-price-ssn')) entries.push(data(['avHotPriceKeys']));
            // Empty explicit keys still consult the CAV fallback. Both sources
            // must be complete before claiming there are no AV Blank rows.
            if ([task, filter].includes('av-blanks')) entries.push(data(['cavAvBlankKeys', 'cav']));
            if (task === 'reserves') entries.push(data(['reserves', 'customerRepMap']));
        }
        requestedSurfaces.forEach((surface) => {
            if (!surfaces[surface]) throw new Error(`Unregistered live-sync surface: ${surface}`);
            // Suspend Tag keeps the footer's last known badge counts but does
            // not make the broad queue badge cohort a foreground gate. Save and
            // close acknowledgements update the affected count directly.
            if ((requestSuspendTag || requestBunchNotes) && surface === 'badge:queue') return;
            if (pagedReport && surface.startsWith('managers:')) return;
            entries.push(surfaces[surface]);
        });
        return entries;
    }
    function getViewAdapters(viewId, context = {}) {
        const selected = getEntries(viewId, context).flatMap((entry) => [
            ...entry.datasets.map((id) => `core:${id}`), ...entry.adapters.map((id) => `side:${id}`)
        ]);
        if (!context.pagedReportSurface && context.evalInventoryRows && (evalRowViews.has(viewId) || viewId === 'detail' && context.driveDetail)) selected.push('core:inventoryEditRequests');
        // Badge-only dependencies must not cause static forms or Chat to take on
        // inventory settings; direct inventory views and dialogs do depend on them.
        const dataEntries = getEntries(viewId, { ...context, surfaces: (context.surfaces || []).filter((id) => !id.startsWith('badge:')) });
        if (dataEntries.some((entry) => entry.datasets.some((id) => core[id].includes('ph_master_inventory')))) selected.push('side:settings');
        return unique(selected);
    }
    function getSourceKeys(ids) {
        return unique(ids.flatMap((id) => {
            if (!adapters[id]) throw new Error(`Unregistered live-sync adapter: ${id}`);
            return adapters[id].sourceKeys;
        }));
    }
    function getCoreKeys(viewId, context) {
        return getViewAdapters(viewId, context).filter((id) => id.startsWith('core:')).map((id) => id.slice(5));
    }
    [core, side, canonical, views, surfaces, adapters].forEach((group) => {
        Object.values(group).forEach((entry) => {
            if (Array.isArray(entry)) Object.freeze(entry);
            else { Object.values(entry).filter(Array.isArray).forEach(Object.freeze); Object.freeze(entry); }
        });
        Object.freeze(group);
    });
    return Object.freeze({ core, side, canonical, views, surfaces, adapters, sourceKeys: getSourceKeys(Object.keys(adapters)), getViewAdapters, getCoreKeys, getSourceKeys });
});
