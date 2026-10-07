export type AuraCapability = {
  id?: string;
  module: string;
  table: string;
  key: string;
  fields: string;
  searchFields: readonly string[];
  filterFields: readonly string[];
  title: string;
  reviewView?: string;
  fixedFilters?: Readonly<Record<string, string | boolean>>;
  dateField?: string;
  reader?: "inventory" | "low_stock" | "production_schedule" | "operations" | "settings" | "navigation" | "hl_orders";
};

/** Fixed projections only. Reads still run with the caller's JWT so database RLS applies. */
const baseCapabilities: Readonly<Record<string, AuraCapability>> = Object.freeze({
  request_queue: { module: "request", table: "ph_request_queue_live_rows", key: "unique_id", fields: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,requested_by,request_folder,req_customer,req_qty,req_status,req_archived,created_at,updated_at", searchFields: ["itemcode", "commonname", "request_folder", "req_customer", "requested_by"], filterFields: ["itemcode", "locationcode", "lotcode", "req_status", "requested_by", "request_selected_rep_username"], title: "Requests" },
  active_request: { module: "request", table: "ph_active_request_live_rows", key: "unique_id", fields: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,requested_by,request_folder,req_customer,req_qty,req_status,req_archived,created_at,updated_at", searchFields: ["itemcode", "commonname", "request_folder", "req_customer", "requested_by"], filterFields: ["itemcode", "locationcode", "lotcode", "req_status", "requested_by"], title: "Active requests" },
  request_history: { module: "reports", table: "ph_request_history", key: "id", fields: "id,unique_id,itemcode,commonname,contsize,locationcode,lotcode,requested_by,request_folder,req_qty,req_status,created_at,date_completed", searchFields: ["itemcode", "commonname", "request_folder", "requested_by"], filterFields: ["itemcode", "locationcode", "lotcode", "req_status", "requested_by"], title: "Request history" },
  sales_orders: { module: "sales-office", table: "ph_sales_office", key: "unique_id", fields: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,order_folder,order_number,order_customer,order_qty,order_status,workflow_status,completed_at,updated_at", searchFields: ["itemcode", "commonname", "order_folder", "order_number", "order_customer"], filterFields: ["itemcode", "locationcode", "lotcode", "order_status", "workflow_status", "order_folder"], title: "Sales office orders" },
  soc_orders: { module: "docks", table: "ph_soc_master", key: "unique_id", fields: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,warehouseid,warehousename,tripnumber,stopnumber,dock_num,assignedto,salesrepname,customername,consigneename,quantityordered,quantityshipped,requestdate,stagename,last_updated", searchFields: ["itemcode", "commonname", "tripnumber", "dock_num", "customername", "consigneename", "salesrepname"], filterFields: ["itemcode", "locationcode", "lotcode", "tripnumber", "dock_num", "assignedto", "salesrepname", "customername", "consigneename", "stagename"], title: "Sales orders" },
  reserves: { module: "reserves", table: "ph_reserves", key: "unique_id", fields: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,warehouseid,warehousename,assignedto,assigned_to,customername,consigneename,salesrepname,quantityordered,quantityshipped,date_completed,last_updated", searchFields: ["itemcode", "commonname", "lotcode", "customername", "consigneename", "salesrepname"], filterFields: ["itemcode", "locationcode", "lotcode", "assignedto", "assigned_to", "customername", "consigneename", "salesrepname", "warehouseid"], title: "Reserves" },
  eval_work: { module: "review", table: "ph_eval_work", key: "id", fields: "id,status,assignee_username,assignee_display,assigned_to_users,assignee_usernames,itemcode,commonname,contsize,origin_locationcode,origin_lotcode,created_at,updated_at,started_at,submitted_at", searchFields: ["itemcode", "commonname", "assignee_username", "assignee_display"], filterFields: ["status", "assignee_username", "itemcode"], title: "Eval work" },
  location_work: { module: "tasks", table: "ph_location_work_jobs", key: "id", fields: "id,title,status,revision,line_count,resolved_line_count,assigned_usernames,created_by_username,created_at,updated_at,completed_by_username,completed_at", searchFields: ["title", "assigned_usernames", "created_by_username"], filterFields: ["status", "created_by_username"], title: "Location work" },
  inventory_edits: { module: "drive", table: "ph_inventory_edit_requests", key: "id", fields: "id,status,workflow_stage,request_type,priority_flag,source_unique_id,commonname,contsize,itemcode,locationcode,lotcode,requested,reason,created_at,updated_at", searchFields: ["itemcode", "commonname", "requested", "reason"], filterFields: ["id", "status", "workflow_stage", "request_type", "itemcode", "locationcode", "lotcode"], title: "Inventory edits" },
  shear: { module: "drive", table: "ph_shear_list", key: "unique_id", fields: "unique_id,status,percent_to_shear,itemcode,commonname,contsize,locationcode,lotcode,season,created_by_username,created_at,completed_by_username,completed_at,instructions", searchFields: ["itemcode", "commonname", "status", "instructions"], filterFields: ["unique_id", "status", "itemcode", "locationcode", "lotcode", "season"], title: "Shear work" },
  dock_team: { module: "docks", table: "ph_dock_team_status", key: "dock_num", fields: "dock_num,checker,inspector,mistake,status,updated_by,updated_at", searchFields: ["dock_num", "checker", "inspector", "status"], filterFields: ["dock_num", "status", "updated_by"], title: "Dock status" },
  dock_item: { module: "docks", table: "ph_dock_item_status", key: "unique_id", fields: "unique_id,checker_done,inspector_done,checker_completed_by,inspector_completed_by,updated_by,updated_at", searchFields: ["unique_id", "checker_completed_by", "inspector_completed_by"], filterFields: ["unique_id", "checker_done", "inspector_done", "updated_by"], title: "Dock checks" },
  dock_issue: { module: "docks", table: "ph_dock_issue_status", key: "issue_source_unique_id", fields: "issue_source_unique_id,dock_num,stop_number,source_locationcode,source_itemcode,source_commonname,source_contsize,source_lotcode,source_qty,source_salesrep,issue_note,issue_state,flagged_by,flagged_at,resolved_by,resolved_at", searchFields: ["dock_num", "source_itemcode", "source_commonname", "issue_note", "source_salesrep"], filterFields: ["issue_source_unique_id", "dock_num", "source_locationcode", "source_itemcode", "source_lotcode", "issue_state"], title: "Dock issues" },
  calendar: { module: "calendar", table: "ph_department_calendar_events", key: "unique_id", fields: "unique_id,department,event_type,title,description,start_at,end_at,all_day,requested_by_username,requested_by_display,assigned_to_username,assigned_to_display,status,approved_by_username,approved_at,assigned_usernames,created_at,updated_at", searchFields: ["department", "title", "description", "requested_by_username", "assigned_to_username"], filterFields: ["department", "event_type", "status", "requested_by_username", "assigned_to_username"], title: "Department calendar" },
  time_off: { module: "hours", table: "ph_department_calendar_events", key: "unique_id", fields: "unique_id,department,title,description,start_at,end_at,all_day,requested_by_username,requested_by_display,assigned_to_username,assigned_to_display,status,approved_by_username,approved_at,created_at,updated_at", searchFields: ["title", "description", "requested_by_username", "assigned_to_username"], filterFields: ["status", "requested_by_username", "assigned_to_username"], title: "Time off" },
  productivity: { module: "reports", table: "ph_productivity_history", key: "event_key", fields: "event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,itemcode,commonname,contsize,locationcode,lotcode,request_folder", searchFields: ["completed_by_username", "completed_by_display", "source_kind", "itemcode", "commonname"], filterFields: ["completed_by_username", "completed_at", "source_kind", "source_table", "source_unique_id"], title: "Productivity history" },
  scout_reports: { module: "drive", table: "ph_grower_scout_reports", key: "unique_id", fields: "unique_id,status,locationcode,itemcode,genus,common_name,contsize,season,manual_note,transcript,ai_summary,pest_issue,disease_issue,nutrient_issue,issue_type,severity,diagnosis,recommended_treatment,review_status,reviewer_note,created_by_username,created_at,updated_at", searchFields: ["itemcode", "common_name", "issue_type", "manual_note", "diagnosis"], filterFields: ["unique_id", "itemcode", "locationcode", "created_by_username", "review_status", "status"], title: "Scout reports" },
  weather_daily: { module: "reports", table: "ph_weather_daily", key: "unique_id", fields: "unique_id,station_key,date,temperature_high_f,temperature_low_f,daily_gdd_base_50,precipitation_in,wind_speed_mph,wind_direction_deg,source,created_at,updated_at", searchFields: ["station_key", "source"], filterFields: ["station_key", "date"], title: "Daily weather" },
  weather_hourly: { module: "reports", table: "ph_weather_hourly", key: "unique_id", fields: "unique_id,station_key,observed_at,local_time,temperature_f,relative_humidity,precipitation_in,wind_speed_mph,gdd_base_50,chill_hours,source,created_at,updated_at", searchFields: ["station_key", "source"], filterFields: ["station_key", "observed_at"], title: "Hourly weather" },
  photo_history: { module: "drive", table: "ph_photo_history_assets", key: "id", fields: "id,source_key,bucket,path,filename,photo_at,itemcode,commonname,contsize,locationcode,lotcode,contexts,search_text,storage_available,drive_file_id,indexed_at", searchFields: ["itemcode", "commonname", "locationcode", "lotcode", "filename", "search_text"], filterFields: ["source_key", "itemcode", "locationcode", "lotcode"], title: "Photo history" },
  marketing: { module: "drive", table: "marketing_materials", key: "unique_id", fields: "unique_id,title,format,image_url,image_path,design_json,created_by_username,created_by_display,created_at,updated_at", searchFields: ["title", "format"], filterFields: ["unique_id"], title: "Marketing materials" },
});

const capability = (module: string, table: string, key: string, fields: string, search: string, title: string,
  options: Partial<AuraCapability> = {}): AuraCapability => ({ module, table, key, fields,
    searchFields: search ? search.split(',') : [], filterFields: fields.split(','), title, reviewView: module, ...options });
const special = (module: string, reader: AuraCapability['reader'], title: string): AuraCapability =>
  capability(module, '', '', '', '', title, { reader });
const productionFields = 'unique_id,workflow_type,status,revision,itemcode,commonname,contsize,locationcode,lotcode,season,quantity,baynumber,instructions,created_by_username,created_at,updated_at,completed_at';
const creditFields = 'unique_id,request_folder,itemcode,commonname,contsize,locationcode,lotcode,customername,consigneename,credit_qty,credit_status,credit_reason,credit_note,submitted_by_username,submitted_at,reviewed_at,revision';
const poFields = 'id,itemcode,commonname,contsize,locationcode,lotcode,total_quantity_ordered,ptronhand,lot_pend_rec,po_remain,customername,consigneename,built_at';

/** Every projection is server-owned. Special readers call existing read-only business APIs. */
export const AURA_READ_CAPABILITIES: Readonly<Record<string, AuraCapability>> = Object.freeze(Object.fromEntries(
  Object.entries({
    ...baseCapabilities,
    inventory: special('drive', 'inventory', 'Inventory'),
    navigation: special('home', 'navigation', 'Available app areas'),
    settings: special('managers', 'settings', 'Visible Eval settings'),
    operations: special('managers', 'operations', 'Operations tasks'),
    low_stock: special('low-stock', 'low_stock', 'Item low-stock targets'),
    hl_orders: special('hl-order', 'hl_orders', 'HL orders and receipts'),
    production_schedule: special('production', 'production_schedule', 'Production schedule'),
    request_history: { ...baseCapabilities.request_history, module: 'request-history', reviewView: 'request-history' },
    calendar: { ...baseCapabilities.calendar, module: 'department-calendar', reviewView: 'department-calendar', dateField: 'start_at' },
    time_off: { ...baseCapabilities.time_off, module: 'department-calendar', reviewView: 'department-calendar', fixedFilters: { event_type: 'time_off' }, dateField: 'start_at' },
    location_work: { ...baseCapabilities.location_work, searchFields: ['title', 'created_by_username'] },
    inventory_edits: { ...baseCapabilities.inventory_edits, searchFields: ['itemcode', 'commonname', 'reason'] },
    shear: { ...baseCapabilities.shear, module: 'shear-list', reviewView: 'shear-list' },
    scout_reports: { ...baseCapabilities.scout_reports, module: 'grower', reviewView: 'grower', dateField: 'created_at' },
    weather_daily: { ...baseCapabilities.weather_daily, module: 'weather-hold', reviewView: 'weather-hold', dateField: 'date' },
    weather_hourly: { ...baseCapabilities.weather_hourly, module: 'weather-hold', reviewView: 'weather-hold', dateField: 'observed_at' },
    marketing: { ...baseCapabilities.marketing, module: 'advertisement', reviewView: 'advertisement' },
    av: capability('av', 'ph_cav_import', 'unique_id', 'unique_id,itemcode,commonname,contsize,season,ptravailable,available,reserved_qty,order_qty,hold_reason,holdstopreason,unit_price,last_updated', 'itemcode,commonname', 'Published availability'),
    av_notes: capability('av', 'ph_av_notes', 'unique_id', 'unique_id,commonname,salesnote', 'commonname,salesnote', 'AV notes'),
    customers: capability('sales', 'ph_customer_consignee_sales_reps', 'unique_id', 'unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,consigneestatus,salesrepname,updated_at', 'customername,consigneename,salesrepname', 'Customers'),
    credits: capability('sales-credit', 'ph_sales_credit_requests', 'unique_id', creditFields, 'itemcode,commonname,customername,consigneename,request_folder', 'Sales credits', { dateField: 'submitted_at' }),
    credit_requests: capability('credit-request', 'ph_sales_credit_requests', 'unique_id', creditFields, 'itemcode,commonname,customername,consigneename,request_folder', 'Credit requests', { dateField: 'submitted_at' }),
    dock_trips: capability('docks', 'ph_dock_trip_status', 'tripnumber', 'tripnumber,dock_num,checker,inspector,mistake,status,revision,updated_at', 'tripnumber,dock_num,checker,inspector', 'Dock trips'),
    bunch: capability('bunch-note', 'ph_bunch_counts', 'unique_id', 'unique_id,source_unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,direction,row_order,counted_qty,counted_by_username,counted_at,updated_at', 'itemcode,commonname', 'Bunch counts', { dateField: 'counted_at' }),
    moves: capability('moves', 'ph_inventory_edit_requests', 'id', 'id,status,workflow_stage,request_type,itemcode,commonname,contsize,locationcode,lotcode,reason,sent_by,created_at,updated_at', 'itemcode,commonname,reason', 'Inventory change requests'),
    take_back: capability('take-back', 'ph_take_back_queue', 'unique_id', 'unique_id,status,master_unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,s_lts,holdstopcode,added_by_username,added_at,completed_at,updated_at', 'itemcode,commonname', 'Take-back queue'),
    propagation: capability('production:propagation', 'ph_production_workflow_rows', 'unique_id', productionFields, 'itemcode,commonname,instructions', 'Propagation', { fixedFilters: { workflow_type: 'propagation' }, reviewView: 'production-workflow' }),
    planting: capability('production:planting', 'ph_production_workflow_rows', 'unique_id', productionFields, 'itemcode,commonname,instructions', 'Planting', { fixedFilters: { workflow_type: 'planting' }, reviewView: 'production-workflow' }),
    production_work: capability('production-workflow', 'ph_production_workflow_rows', 'unique_id', productionFields, 'itemcode,commonname,instructions', 'Production work'),
    po_fall: capability('po-management', 'ph_view_po_27f1_hl', 'id', poFields, 'itemcode,commonname,customername,consigneename', '27F1 purchase-order balances'),
    po_spring: capability('po-management', 'ph_view_po_27s1_hl', 'id', poFields, 'itemcode,commonname,customername,consigneename', '27S1 purchase-order balances'),
    crop_runs: capability('crop-roll', 'ph_crop_roll_runs', 'run_id', 'run_id,run_name,status,created_by,created_at,archived_at,snapshot_count', 'run_id,run_name', 'Crop-roll runs'),
    crop_rows: capability('crop-roll', 'ph_crop_roll_rows', 'row_id', 'row_id,run_id,itemcode,commonname,contsize,genus,locationcode,original_lotcode,assignedto,row_status,completed_at,target_lotcode,target_season,updated_at', 'itemcode,commonname,run_id', 'Crop-roll rows'),
    pest: capability('pest-management', 'ph_grower_scout_reports', 'unique_id', 'unique_id,status,review_status,itemcode,common_name,contsize,locationcode,issue_type,severity,diagnosis,manual_note,pest_issue,follow_up_date,created_at,updated_at', 'itemcode,common_name,diagnosis,issue_type', 'Recorded pest observations', { fixedFilters: { pest_issue: true }, dateField: 'created_at' }),
    disease: capability('disease-pest', 'ph_grower_scout_reports', 'unique_id', 'unique_id,status,review_status,itemcode,common_name,contsize,locationcode,issue_type,severity,diagnosis,manual_note,disease_issue,follow_up_date,created_at,updated_at', 'itemcode,common_name,diagnosis,issue_type', 'Recorded disease observations', { fixedFilters: { disease_issue: true }, dateField: 'created_at' }),
    employees: capability('hours', 'core_employees', 'id', 'id,emp_number,name,department,role,hired_date,vacation_balance,active,updated_at', 'emp_number,name,department', 'Employees'),
    hr_events: capability('hours', 'hr_events', 'id', 'id,emp_number,event_type,effective_at,created_at', 'emp_number,event_type', 'HR event status', { dateField: 'effective_at' }),
    hours: capability('hours', 'labor_timesheets', 'id', 'id,employee_id,work_date,job_code,hours,updated_at', 'job_code', 'Recorded employee hours', { dateField: 'work_date' }),
    department_hours: capability('hours', 'ph_labor_hours', 'id', 'id,date_reported,department,man_hours,submitted_by,submitted_at', 'department,submitted_by', 'Department hours', { dateField: 'date_reported' }),
    access: capability('access-control', 'profiles', 'id', 'id,username,display_name,role,disabled_at', 'username,display_name,role', 'Visible account access'),
    transactions: capability('inventory-transaction-history', 'ph_inventory_transactions', 'unique_id', 'unique_id,created_at,action,actor_username,source_unique_id,source_itemcode,source_lotcode,source_locationcode,destination_itemcode,destination_lotcode,destination_locationcode,quantity,status', 'source_itemcode,source_locationcode,actor_username', 'Inventory transactions', { dateField: 'created_at' }),
  } as Record<string, AuraCapability>).map(([id, value]) => [id, Object.freeze({ ...value, id, reviewView: value.reviewView || value.module })])
));

/** Ordered domain vocabulary. Product words are parsed separately after the matched phrase. */
export const AURA_DOMAIN_ROUTES = Object.freeze([
  { pattern: /\b(?:production schedules?|schedule sheets?)\b/i, capability: 'production_schedule' },
  { pattern: /\b(?:release|deploy|merge|operations?(?: tasks?)?|codex tasks?)\b/i, capability: 'operations' },
  { pattern: /\b(?:low[ -]stock(?: targets?)?|stock targets?)\b/i, capability: 'low_stock' },
  { pattern: /\bhl (?:orders?|receipts?|balances?)(?: (?:receipts?|balances?))?\b/i, capability: 'hl_orders' },
  { pattern: /\b(?:purchase[ -]orders?(?: (?:balances?|receipts?))?|po (?:management|balances?|receipts?)|receipts?|balances?)\b/i, capability: 'po_fall' },
  { pattern: /\bcrop[ -]roll (?:runs?|status)\b/i, capability: 'crop_runs' },
  { pattern: /\bcrop[ -]roll\b/i, capability: 'crop_rows' },
  { pattern: /\b(?:credit requests?)\b/i, capability: 'credit_requests' },
  { pattern: /\b(?:sales credits?|credits?)\b/i, capability: 'credits' },
  { pattern: /\b(?:request history|archived requests?)\b/i, capability: 'request_history' },
  { pattern: /\b(?:sales office(?: work| orders?)?|sales orders?)\b/i, capability: 'sales_orders' },
  { pattern: /\bactive requests?\b/i, capability: 'active_request' },
  { pattern: /\b(?:customers?|consignees?)\b/i, capability: 'customers' },
  { pattern: /\b(?:reserves?|reservations?)\b/i, capability: 'reserves' },
  { pattern: /\b(?:av notes?)\b/i, capability: 'av_notes' },
  { pattern: /\b(?:av|cav|published availability|sales inventory)\b/i, capability: 'av' },
  { pattern: /\b(?:propagation|propagate)\b/i, capability: 'propagation' },
  { pattern: /\b(?:planting)\b/i, capability: 'planting' },
  { pattern: /\b(?:production work|production workflow)\b/i, capability: 'production_work' },
  { pattern: /\b(?:bunch notes?|bunch counts?)\b/i, capability: 'bunch' },
  { pattern: /\b(?:shear|shearing)(?: work| list)?\b/i, capability: 'shear' },
  { pattern: /\btake[ -]back(?: queue)?\b/i, capability: 'take_back' },
  { pattern: /\binventory change requests?\b/i, capability: 'moves' },
  { pattern: /\b(?:move[ -]up(?: requests?)?|moves?|ncr|recounts?|inventory edits?)\b/i, capability: 'inventory_edits' },
  { pattern: /\b(?:trip|trips|dock trips?)\b/i, capability: 'dock_trips' },
  { pattern: /\b(?:dock issues?|qc issues?)\b/i, capability: 'dock_issue' },
  { pattern: /\b(?:dock|docks|quality control|qc)\b/i, capability: 'dock_team' },
  { pattern: /\b(?:department hours?)\b/i, capability: 'department_hours' },
  { pattern: /\b(?:(?:employee|labor|recorded) hours?|timesheets?)\b/i, capability: 'hours' },
  { pattern: /\b(?:hr events?|disciplin(?:e|ary)|promotions?|transfers?)\b/i, capability: 'hr_events' },
  { pattern: /\b(?:employees?|staff|vacation balance)\b/i, capability: 'employees' },
  { pattern: /\b(?:hours?|timesheets?)\b/i, capability: 'hours' },
  { pattern: /\b(?:time off|vacation|sick leave)\b/i, capability: 'time_off' },
  { pattern: /\b(?:calendar|meetings?|events?)\b/i, capability: 'calendar' },
  { pattern: /\bdiseases?(?: observations?| reports?)?\b/i, capability: 'disease' },
  { pattern: /\bpests?(?: observations?| reports?)?\b/i, capability: 'pest' },
  { pattern: /\b(?:grower|scout|scouting|observations?)\b/i, capability: 'scout_reports' },
  { pattern: /\b(?:hourly weather)\b/i, capability: 'weather_hourly' },
  { pattern: /\b(?:weather|forecasts?|temperature|rain|risk)\b/i, capability: 'weather_daily' },
  { pattern: /\b(?:marketing|materials?|advertis(?:ement|ing)|flyers?)\b/i, capability: 'marketing' },
  { pattern: /\b(?:photos?|pictures?)\b/i, capability: 'photo_history' },
  { pattern: /\b(?:inventory transactions?|transaction history)\b/i, capability: 'transactions' },
  { pattern: /\b(?:access|permissions?|accounts?)\b/i, capability: 'access' },
  { pattern: /\b(?:settings|low stock threshold)\b/i, capability: 'settings' },
  { pattern: /\b(?:productivity(?: history)?|reports?)\b/i, capability: 'productivity' },
  { pattern: /\b(?:app areas?|modules?|navigation|home|office|communication)\b/i, capability: 'navigation' },
]);

const moduleEntry = (reviewView: string, capabilities: string[], question: string, available = true) =>
  Object.freeze({ capabilities, questions: [question], reviewView, available });
/** Coverage of navigation_catalog_v1, including explicit unavailable app features. */
export const AURA_MODULE_CAPABILITIES = Object.freeze({
  home: moduleEntry('home', ['navigation'], 'Which app areas can I open?'),
  drive: moduleEntry('drive', ['inventory', 'photo_history'], 'Where is item 00123?'),
  tasks: moduleEntry('tasks', ['eval_work', 'location_work'], 'Show open Location Work'),
  docks: moduleEntry('docks', ['dock_trips', 'dock_team', 'dock_item', 'dock_issue', 'soc_orders'], 'Show dock trips'),
  request: moduleEntry('request', ['request_queue', 'active_request'], 'Show active requests'),
  bloom: moduleEntry('bloom', ['inventory', 'customers'], 'Prepare an order for review'),
  communication: moduleEntry('communication', ['navigation'], 'Open communication'),
  'department-calendar': moduleEntry('department-calendar', ['calendar', 'time_off'], 'Show calendar events tomorrow'),
  chat: moduleEntry('chat', [], 'Read my authorized chat messages'),
  sales: moduleEntry('sales', ['customers', 'soc_orders'], 'Find customer Acme'),
  'sales-office': moduleEntry('sales-office', ['sales_orders'], 'Show sales office work'),
  'request-history': moduleEntry('request-history', ['request_history'], 'Show request history'),
  'sales-credit': moduleEntry('sales-credit', ['credits'], 'Show pending sales credits'),
  'credit-request': moduleEntry('credit-request', ['credit_requests'], 'Show credit requests'),
  av: moduleEntry('av', ['av', 'av_notes'], 'Show published availability'),
  reserves: moduleEntry('reserves', ['reserves'], 'Show reserves for roses'),
  advertisement: moduleEntry('advertisement', ['marketing'], 'Find marketing materials'),
  'sales-inventory': moduleEntry('sales-inventory', ['av'], 'Show sales inventory'),
  'weather-hold': moduleEntry('weather-hold', ['weather_daily', 'weather_hourly'], 'Show stored weather records'),
  'bunch-note': moduleEntry('bunch-note', ['bunch'], 'Show bunch counts'),
  'hl-order': moduleEntry('hl-order', ['hl_orders'], 'Show HL orders'),
  'po-management': moduleEntry('po-management', ['po_fall', 'po_spring'], 'Show purchase-order balances for 27S1'),
  'crop-roll': moduleEntry('crop-roll', ['crop_rows', 'crop_runs'], 'Show crop-roll status'),
  office: moduleEntry('office', ['navigation'], 'Open office'),
  production: moduleEntry('production', ['production_schedule'], 'Show production schedule'),
  'production-workflow': moduleEntry('production-workflow', ['production_work'], 'Show production work'),
  'production:propagation': moduleEntry('production-workflow', ['propagation'], 'Show propagation status'),
  'production:planting': moduleEntry('production-workflow', ['planting'], 'Show planting status'),
  'take-back': moduleEntry('take-back', ['take_back'], 'Show take-back queue'),
  'shear-list': moduleEntry('shear-list', ['shear'], 'Show shear work'),
  grower: moduleEntry('grower', ['scout_reports'], 'Show recorded observations'),
  qc: moduleEntry('qc', ['dock_issue', 'dock_item'], 'Show QC issues'),
  moves: moduleEntry('moves', ['moves'], 'Show inventory change requests'),
  hours: moduleEntry('hours', ['employees', 'hours', 'department_hours', 'hr_events'], 'Show employee hours'),
  'low-stock': moduleEntry('low-stock', ['low_stock'], 'Show low-stock targets'),
  review: moduleEntry('review', ['eval_work', 'inventory_edits'], 'Show outstanding Eval work'),
  'move-up': moduleEntry('move-up', ['inventory_edits'], 'Show move-up requests'),
  managers: moduleEntry('managers', ['operations', 'settings'], 'Show operations tasks'),
  reports: moduleEntry('reports', ['productivity'], 'Show productivity history'),
  'inventory-transaction-history': moduleEntry('inventory-transaction-history', ['transactions'], 'Show inventory transactions'),
  'access-control': moduleEntry('access-control', ['access'], 'Show visible account access'),
  'disease-pest': moduleEntry('disease-pest', ['disease'], 'Show disease observations'),
  'pest-management': moduleEntry('pest-management', ['pest'], 'Show pest observations'),
  'production:can-filling': moduleEntry('production', [], 'Can filling is unavailable in the app', false),
  'production:order-pulling': moduleEntry('tasks', [], 'Order pulling is unavailable in the app', false),
});

