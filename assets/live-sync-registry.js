(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricLiveSyncRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const unique = (values) => Array.from(new Set(values));
    const core = {
        master: ['ph_master_inventory'], cropRollDrive: ['ph_crop_roll_drive_rows', 'ph_crop_roll_completed_drive_keys'],
        avOpen: ['ph_master_inventory'], requests: ['ph_active_request', 'ph_master_inventory', 'ph_request_delivery_outbox'],
        requestHistory: ['ph_request_history'], salesCredits: ['ph_sales_credit_requests'],
        inventoryEditRequests: ['ph_inventory_edit_requests', 'ph_inventory_edit_request_events'],
        reserves: ['ph_reserves', 'ph_master_inventory'], customerRepMap: ['ph_customer_consignee_sales_reps'],
        soc: ['ph_soc_master', 'ph_master_inventory'], salesOffice: ['ph_sales_office'],
        flyerRows: ['ph_flyer_folder_rows'], flyerHistory: ['ph_flyer_folder_history'],
        growerScoutReports: ['ph_grower_scout_reports'], growerScoutAssets: ['ph_grower_scout_assets'],
        warehouseAssignedItems: ['ph_warehouse_assigned_items'], cav: ['ph_cav_import'], cavAvBlankKeys: ['ph_cav_import'],
        avHotPriceKeys: ['ph_cav_import', 'ph_master_inventory'], avNotes: ['ph_av_notes']
    };
    const side = {
        settings: ['ph_app_settings'],
        coverage: ['ph_item_inquiry_coverage'],
        dockWorkflow: ['ph_dock_trip_status', 'ph_dock_item_status', 'ph_dock_issue_status', 'ph_dock_issue_allocations'],
        users: ['profiles'],
        avOptionEval: ['ph_av_option_eval_requests'],
        evalWork: ['ph_eval_work', 'ph_eval_work_origin_rows', 'ph_eval_work_events', 'ph_request_delivery_outbox'],
        locationWork: ['ph_location_work_jobs', 'ph_location_work_lines', 'ph_location_work_assignments', 'ph_request_delivery_outbox'],
        shear: ['ph_shear_list', 'ph_shear_location_inquiries', 'ph_shear_location_items', 'ph_shear_location_rows', 'ph_request_delivery_outbox'],
        productionWorkflow: ['ph_production_workflow_rows'],
        spreadCounts: ['ph_spread_counts'], bunchCounts: ['ph_bunch_counts'],
        cropRoll: ['ph_crop_roll_runs', 'ph_crop_roll_rows'],
        takeBack: ['ph_take_back_queue'],
        po: ['ph_27f1_hl_po', 'ph_master_inventory', 'ph_soc_master'],
        chat: ['ph_chat_conversations', 'ph_chat_participants', 'ph_chat_messages'],
        calendar: ['ph_department_calendar_events'],
        weather: ['ph_weather_hourly', 'ph_weather_daily'],
        holdRisk: ['ph_hold_stop_itemcode_summaries', 'ph_hold_learning_profiles'],
        deliveryRecovery: ['ph_request_delivery_outbox'],
        managerOrders: ['ph_pikes_order_batches', 'ph_pikes_order_source_rows'],
        managerEvalSettings: ['ph_eval_report_settings'],
        ncr: ['ph_ncr_completions'],
        productivity: ['ph_productivity_history'],
        transactions: ['ph_inventory_transactions'],
        transactionsKeyed: ['ph_transactions_keyed_files', 'ph_transactions_keyed_rows'],
        historical: ['ph_historical_inventory_dimensions', 'ph_drive_around_report_rows'],
        access: ['profiles', 'private.app_access_permissions', 'private.app_access_policy_versions', 'private.app_access_role_grants', 'private.app_access_user_overrides', 'private.app_access_maintainers', 'private.app_access_legacy_baseline', 'private.app_access_legacy_checks', 'private.app_access_runtime_state'],
        codex: ['private.codex_ops_tasks', 'private.codex_ops_messages', 'private.codex_ops_events', 'private.codex_ops_attachments', 'private.codex_ops_approvals', 'ph_runtime_feature_flags'],
        pendingOrders: ['bloomscapes_private.orders', 'bloomscapes_private.order_lines']
    };
    const data = (datasets, adapters = []) => ({ kind: 'data', datasets, adapters });
    const navigation = { kind: 'navigation', datasets: [], adapters: [] };
    const staticView = { kind: 'static', datasets: [], adapters: [] };
    const views = {
        home: data([], ['settings']),
        building: data(['master'], ['settings']),
        managers: data(['master', 'warehouseAssignedItems'], ['settings', 'coverage']),
        'crop-roll': data(['cropRollDrive', 'master'], ['cropRoll', 'settings']),
        drive: data(['master', 'reserves', 'avNotes', 'warehouseAssignedItems'], ['settings']),
        av: data(['avOpen', 'master', 'reserves', 'customerRepMap', 'avHotPriceKeys', 'avNotes'], ['settings']),
        reserves: data(['reserves', 'master', 'customerRepMap']),
        docks: data(['soc', 'master', 'customerRepMap'], ['dockWorkflow']),
        request: data(['requests', 'master', 'customerRepMap']),
        reports: data(['requests', 'requestHistory', 'salesCredits', 'soc', 'master', 'reserves', 'customerRepMap'], ['settings']),
        'sales-office': data(['salesOffice', 'master'], ['settings']),
        moves: data(['salesOffice', 'master', 'requests', 'inventoryEditRequests']),
        tasks: data(['master', 'warehouseAssignedItems', 'avNotes'], ['settings']),
        review: data(['master'], ['ncr']), 'move-up': data(['master', 'salesOffice'], ['ncr']),
        'low-stock': data(['master'], ['settings']), advertisement: data(['master', 'avNotes', 'flyerRows', 'flyerHistory'], ['settings']),
        grower: data(['master', 'growerScoutReports', 'growerScoutAssets']),
        'pest-management': data(['master', 'growerScoutReports', 'growerScoutAssets']),
        'shear-list': data(['master', 'reserves'], ['shear']),
        'take-back': data(['master'], ['takeBack']),
        'production-workflow': data(['master'], ['productionWorkflow']),
        'sales-inventory': data(['master', 'salesOffice']),
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
        'request:pending': data(['requests', 'requestHistory', 'salesCredits', 'inventoryEditRequests']),
        'request:reps': data(['requests', 'requestHistory', 'salesCredits']),
        'request:suspend-tag': data(['soc', 'master']),
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
        'managers:moves': data(['salesOffice', 'master', 'requests', 'inventoryEditRequests']),
        'managers:inventory-checks': data(['master', 'inventoryEditRequests']),
        'managers:eval-reports': data(['master', 'warehouseAssignedItems'], ['managerEvalSettings']),
        'managers:inventory-transaction-history': data([], ['transactions']),
        'managers:transactions-keyed': data([], ['transactionsKeyed']),
        'managers:historical-report': data([], ['historical']),
        'managers:access-control': data([], ['access']),
        'managers:codex-operations': data([], ['codex']),
        'managers:productivity': data([], ['productivity']),
        'managers:crop-roll': data(['cropRollDrive', 'master'], ['cropRoll']),
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
        'badge:queue': data(['requests', 'salesCredits', 'inventoryEditRequests', 'soc', 'salesOffice'], ['shear', 'evalWork']),
        'badge:communications': data([], ['chat', 'calendar'])
    };
    const evalRowViews = new Set(['drive', 'crop-roll', 'av', 'docks', 'sales-inventory', 'weather-hold', 'reserves', 'sales-office', 'moves', 'tasks', 'low-stock', 'review', 'move-up']);
    const adapters = {};
    Object.entries(core).forEach(([id, sourceKeys]) => { adapters[`core:${id}`] = { id: `core:${id}`, kind: 'core', sourceKeys }; });
    Object.entries(side).forEach(([id, sourceKeys]) => { adapters[`side:${id}`] = { id: `side:${id}`, kind: 'side', sourceKeys }; });
    // These legacy features reference schemas absent from the verified production
    // database. Keep their contract explicit; never disguise unavailable as empty.
    Object.assign(adapters['side:productionWorkflow'], {
        deploymentRequired: true,
        unavailableReason: 'Production propagation/planting data is unavailable because its database is not deployed.'
    });
    Object.assign(adapters['side:transactions'], {
        deploymentRequired: true,
        unavailableReason: 'Inventory transaction audit history is unavailable because its database is not deployed.'
    });
    function getEntries(viewId, context = {}) {
        const view = views[viewId];
        if (!view) throw new Error(`Unregistered live-sync view: ${viewId}`);
        const entries = [view];
        if (viewId === 'detail') {
            if (context.detailSourceView === 'docks') entries.push(data(['soc'], ['dockWorkflow']));
            if (context.detailSourceView === 'sales-office') entries.push(data(['salesOffice']));
            if (context.detailSourceView === 'advertisement' || (context.taskView === 'flyer' && context.detailSourceView === 'tasks')) entries.push(data(['flyerRows']));
        }
        // A Task subtype owns its dependencies. Ordinary AV Blanks must not
        // download Flyer history, another CAV copy, or another task's queue.
        if (viewId === 'tasks') {
            const task = context.taskView || 'flyer';
            const filter = context.evalSimpleTaskFilter || '';
            const blanks = task === 'av-blanks' || filter === 'av-blanks';
            const keys = [];
            if (blanks) keys.push('cavAvBlankKeys');
            else keys.push('salesOffice');
            if (task === 'eval-task') keys.push('requests');
            if (task === 'flyer') keys.push('flyerRows', 'flyerHistory');
            if (task === 'reserves' || task === 'cust') keys.push('reserves');
            if (task === 'cust') keys.push('customerRepMap');
            if (task === 'hot-price' || filter === 'hot-price' || filter === 'hot-price-ssn') keys.push('avHotPriceKeys');
            entries.push(data(keys));
        }
        if (viewId === 'sales-office' && context.salesOfficeTab === 'orders') entries.push(data(['flyerRows', 'flyerHistory']));
        (context.surfaces || []).forEach((surface) => {
            if (!surfaces[surface]) throw new Error(`Unregistered live-sync surface: ${surface}`);
            entries.push(surfaces[surface]);
        });
        return entries;
    }
    function getViewAdapters(viewId, context = {}) {
        const selected = getEntries(viewId, context).flatMap((entry) => [
            ...entry.datasets.map((id) => `core:${id}`), ...entry.adapters.map((id) => `side:${id}`)
        ]);
        if (context.evalInventoryRows && evalRowViews.has(viewId)) selected.push('core:inventoryEditRequests');
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
    [core, side, views, surfaces, adapters].forEach((group) => {
        Object.values(group).forEach((entry) => {
            if (Array.isArray(entry)) Object.freeze(entry);
            else { Object.values(entry).filter(Array.isArray).forEach(Object.freeze); Object.freeze(entry); }
        });
        Object.freeze(group);
    });
    return Object.freeze({ core, side, views, surfaces, adapters, sourceKeys: getSourceKeys(Object.keys(adapters)), getViewAdapters, getCoreKeys, getSourceKeys });
});
