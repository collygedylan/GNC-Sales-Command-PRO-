begin;

-- Centralized application access policy, audit release only.
-- Existing feature authorization remains authoritative until a later migration
-- deliberately changes private.app_access_runtime_state.enforcement_mode.

create table if not exists private.app_access_permissions (
  permission_key text primary key,
  permission_kind text not null check (permission_kind in ('module', 'action')),
  module_key text not null,
  label text not null,
  description text not null default '',
  scope_options text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint app_access_permissions_key_format
    check (permission_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  constraint app_access_permissions_module_format
    check (module_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  constraint app_access_permissions_scope_values
    check (scope_options <@ array['own', 'assigned', 'division', 'global']::text[])
);

create table if not exists private.app_access_policy_versions (
  id bigint generated always as identity primary key,
  contract_version text not null default 'app-access-v1'
    check (contract_version = 'app-access-v1'),
  version_number integer not null unique check (version_number > 0),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'active', 'retired')),
  base_policy_id bigint references private.app_access_policy_versions(id) on delete restrict,
  created_by_username text not null,
  created_at timestamptz not null default now(),
  reviewed_by_username text,
  reviewed_at timestamptz,
  review_reason text not null default ''
);

create unique index if not exists app_access_single_draft_idx
  on private.app_access_policy_versions ((status)) where status = 'draft';
create unique index if not exists app_access_single_active_idx
  on private.app_access_policy_versions ((status)) where status = 'active';

create table if not exists private.app_access_role_grants (
  policy_id bigint not null references private.app_access_policy_versions(id) on delete restrict,
  role_key text not null,
  permission_key text not null references private.app_access_permissions(permission_key) on delete restrict,
  allowed boolean not null,
  access_scope text,
  updated_at timestamptz not null default now(),
  primary key (policy_id, role_key, permission_key),
  constraint app_access_role_key_format check (role_key ~ '^[A-Z][A-Z0-9]{1,79}$'),
  constraint app_access_role_scope check (access_scope is null or access_scope in ('own', 'assigned', 'division', 'global'))
);

create table if not exists private.app_access_user_overrides (
  policy_id bigint not null references private.app_access_policy_versions(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  permission_key text not null references private.app_access_permissions(permission_key) on delete restrict,
  allowed boolean not null,
  access_scope text,
  updated_at timestamptz not null default now(),
  primary key (policy_id, profile_id, permission_key),
  constraint app_access_user_scope check (access_scope is null or access_scope in ('own', 'assigned', 'division', 'global'))
);

create table if not exists private.app_access_maintainers (
  username text primary key,
  created_at timestamptz not null default now(),
  constraint app_access_maintainer_username check (username = lower(btrim(username)))
);

create table if not exists private.app_access_legacy_baseline (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  permission_key text not null references private.app_access_permissions(permission_key) on delete restrict,
  allowed boolean not null,
  access_scope text,
  captured_at timestamptz not null default now(),
  primary key (profile_id, permission_key),
  constraint app_access_baseline_scope check (access_scope is null or access_scope in ('own', 'assigned', 'division', 'global'))
);

create table if not exists private.app_access_legacy_checks (
  check_key text primary key,
  permission_key text references private.app_access_permissions(permission_key) on delete restrict,
  enforcement_surface text not null check (enforcement_surface in ('client', 'rpc', 'rls', 'edge', 'apps_script')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint app_access_legacy_check_key_format
    check (check_key ~ '^[a-z][a-z0-9_.-]{2,159}$')
);

create table if not exists private.app_access_change_events (
  id bigint generated always as identity primary key,
  policy_id bigint references private.app_access_policy_versions(id) on delete restrict,
  actor_username text not null,
  event_type text not null check (event_type in ('draft_changed', 'policy_reviewed', 'draft_created')),
  target_type text not null check (target_type in ('policy', 'role', 'user')),
  target_key text not null,
  permission_key text,
  previous_value jsonb,
  next_value jsonb,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint app_access_change_reason_length check (char_length(reason) between 4 and 500),
  constraint app_access_change_value_size check (
    octet_length(coalesce(previous_value, '{}'::jsonb)::text) <= 2048
    and octet_length(coalesce(next_value, '{}'::jsonb)::text) <= 2048
  )
);

create table if not exists private.app_access_runtime_state (
  singleton boolean primary key default true check (singleton),
  contract_version text not null default 'app-access-v1'
    check (contract_version = 'app-access-v1'),
  enforcement_mode text not null default 'audit'
    check (enforcement_mode in ('audit', 'enforced')),
  reviewed_policy_id bigint references private.app_access_policy_versions(id) on delete restrict,
  active_policy_id bigint references private.app_access_policy_versions(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table private.app_access_permissions enable row level security;
alter table private.app_access_policy_versions enable row level security;
alter table private.app_access_role_grants enable row level security;
alter table private.app_access_user_overrides enable row level security;
alter table private.app_access_maintainers enable row level security;
alter table private.app_access_legacy_baseline enable row level security;
alter table private.app_access_legacy_checks enable row level security;
alter table private.app_access_change_events enable row level security;
alter table private.app_access_runtime_state enable row level security;

revoke all on table private.app_access_permissions from public, anon, authenticated;
revoke all on table private.app_access_policy_versions from public, anon, authenticated;
revoke all on table private.app_access_role_grants from public, anon, authenticated;
revoke all on table private.app_access_user_overrides from public, anon, authenticated;
revoke all on table private.app_access_maintainers from public, anon, authenticated;
revoke all on table private.app_access_legacy_baseline from public, anon, authenticated;
revoke all on table private.app_access_legacy_checks from public, anon, authenticated;
revoke all on table private.app_access_change_events from public, anon, authenticated;
revoke all on table private.app_access_runtime_state from public, anon, authenticated;

insert into private.app_access_maintainers (username)
values ('dylan_collyge'), ('megan_kelly'), ('jd_jones')
on conflict (username) do nothing;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order)
values
  ('module.drive.view', 'module', 'drive', 'Drive', 'Open Drive Mode.', '{}', 100),
  ('module.tasks.view', 'module', 'tasks', 'Tasks', 'Open Tasks.', '{}', 110),
  ('module.docks.view', 'module', 'docks', 'Docks', 'Open Docks.', '{}', 120),
  ('module.take-back.view', 'module', 'take-back', 'Take Back', 'Open Take Back.', '{}', 130),
  ('module.production.view', 'module', 'production', 'Production', 'Open Production.', '{}', 140),
  ('module.production-workflow.view', 'module', 'production-workflow', 'Production Workflow', 'Use Production workflows.', '{}', 150),
  ('module.weather-hold.view', 'module', 'weather-hold', 'Weather Hold', 'Open Weather Hold.', '{}', 160),
  ('module.shear-list.view', 'module', 'shear-list', 'Shear List', 'Open Shear List.', '{}', 170),
  ('module.sales.view', 'module', 'sales', 'Sales', 'Open Sales.', '{}', 180),
  ('module.managers.view', 'module', 'managers', 'Managers', 'Open Managers.', '{}', 190),
  ('module.building.view', 'module', 'building', 'Building', 'Open Building.', '{}', 200),
  ('module.qc.view', 'module', 'qc', 'QC', 'Open QC.', '{}', 210),
  ('module.av.view', 'module', 'av', 'AV', 'Open AV.', '{}', 220),
  ('module.request.view', 'module', 'request', 'Request Queue', 'Open Request and Queue.', '{}', 230),
  ('module.reserves.view', 'module', 'reserves', 'Reserves', 'Open Reserves.', '{}', 240),
  ('module.sales-office.view', 'module', 'sales-office', 'Sales Office', 'Open Sales Office.', '{}', 250),
  ('module.office.view', 'module', 'office', 'Office', 'Open Office.', '{}', 260),
  ('module.po-management.view', 'module', 'po-management', 'PO Management', 'Open PO Management.', '{}', 270),
  ('module.sales-inventory.view', 'module', 'sales-inventory', 'Inventory', 'Open Sales Inventory.', '{}', 280),
  ('module.moves.view', 'module', 'moves', 'Moves', 'Open Moves.', '{}', 290),
  ('module.reports.view', 'module', 'reports', 'Reports', 'Open Reports.', '{}', 300),
  ('module.hours.view', 'module', 'hours', 'Labor Hours', 'Open Labor Hours.', '{}', 310),
  ('module.low-stock.view', 'module', 'low-stock', 'Low Stock', 'Open Low Stock.', '{}', 320),
  ('module.review.view', 'module', 'review', 'Review', 'Open Review.', '{}', 330),
  ('module.move-up.view', 'module', 'move-up', 'Move Up', 'Open Move Up.', '{}', 340),
  ('module.advertisement.view', 'module', 'advertisement', 'Advertisement', 'Open Advertisement.', '{}', 350),
  ('module.disease-pest.view', 'module', 'disease-pest', 'Disease / Pest', 'Open Disease and Pest.', '{}', 360),
  ('module.grower.view', 'module', 'grower', 'Grower', 'Open Grower.', '{}', 370),
  ('module.pest-management.view', 'module', 'pest-management', 'Pest Management', 'Open Pest Management.', '{}', 380),
  ('module.communication.view', 'module', 'communication', 'Communication', 'Open Communication.', '{}', 390),
  ('module.department-calendar.view', 'module', 'department-calendar', 'Department Calendar', 'Open Department Calendar.', '{}', 400),
  ('module.chat.view', 'module', 'chat', 'Chat', 'Open Chat.', '{}', 410),
  ('module.crop-roll.view', 'module', 'crop-roll', 'Crop Roll', 'Open Crop Roll.', '{}', 420),

  ('request.view_queue', 'action', 'request', 'View Queue', 'View the authorized Request queue.', '{own,assigned,division,global}', 1000),
  ('request.create_general', 'action', 'request', 'Create Request', 'Create a general or plant request.', '{}', 1010),
  ('request.create_av', 'action', 'request', 'Create AV Request', 'Create an AV request.', '{}', 1020),
  ('request.take_photo', 'action', 'request', 'Request Photos', 'Add Request photos within authorized rows.', '{}', 1030),
  ('request.edit', 'action', 'request', 'Edit Request', 'Edit authorized Request rows.', '{}', 1040),
  ('request.complete', 'action', 'request', 'Complete Request', 'Complete authorized Request rows.', '{}', 1050),
  ('request.archive', 'action', 'request', 'Archive Request', 'Archive authorized Request rows.', '{}', 1060),
  ('eval_work.view_assigned', 'action', 'eval-work', 'View Assigned Eval Work', 'View Eval Work assigned to the current user.', '{assigned,global}', 1100),
  ('eval_work.create', 'action', 'eval-work', 'Create Eval Work', 'Create an Eval Work assignment.', '{}', 1110),
  ('eval_work.manage', 'action', 'eval-work', 'Manage Eval Work', 'Reassign or cancel open Eval Work.', '{}', 1120),
  ('eval_work.submit', 'action', 'eval-work', 'Submit Eval Work', 'Submit assigned Eval Work.', '{}', 1130),
  ('reclass.email', 'action', 'reclass', 'Email Item Inquiry', 'Send a Reclass Item Inquiry email.', '{}', 1200),
  ('reclass.review.create', 'action', 'reclass', 'Send as Review', 'Create review work from Reclass.', '{}', 1210),
  ('po_management.view', 'action', 'po-management', 'View PO Rows', 'Read the secured PO Management dataset.', '{}', 1300),
  ('transactions_keyed.view', 'action', 'transactions-keyed', 'View Transactions Keyed', 'Open keyed transaction reporting.', '{}', 1310),
  ('bloom_picker.order', 'action', 'bloom-picker', 'Bloom Picker Order', 'Create Bloom Picker orders.', '{}', 1320),
  ('inventory.edit', 'action', 'inventory', 'Edit Inventory Evidence', 'Edit authorized evidence fields.', '{}', 1330),
  ('inventory.photo', 'action', 'inventory', 'Inventory Photos', 'Add or remove authorized inventory photos.', '{}', 1340),
  ('moves.manage', 'action', 'moves', 'Manage Moves', 'Create and manage move sessions.', '{}', 1350),
  ('manager.approval.view', 'action', 'managers', 'Approval', 'Open Manager Approval.', '{}', 1400),
  ('manager.productivity.view', 'action', 'managers', 'Productivity', 'Open Manager Productivity.', '{}', 1410),
  ('manager.crop_roll.view', 'action', 'managers', 'Crop Roll', 'Open Manager Crop Roll.', '{}', 1420),
  ('manager.season_settings.manage', 'action', 'managers', 'Season Settings', 'Manage current season settings.', '{}', 1430),
  ('manager.av_blanks_bypass.manage', 'action', 'managers', 'AV Blanks Settings', 'Manage AV Blanks photo bypass.', '{}', 1440),
  ('manager.inventory_transactions.view', 'action', 'managers', 'Transaction History', 'View inventory transactions.', '{}', 1450),
  ('manager.transactions_keyed.view', 'action', 'managers', 'Transactions Keyed', 'View Transactions Keyed.', '{}', 1460),
  ('manager.assigned_items_export.view', 'action', 'managers', 'Assigned Items', 'View assigned-item exports.', '{}', 1470),
  ('manager.eval_reports.view', 'action', 'managers', 'Eval Reports', 'Open Eval Reports.', '{}', 1480),
  ('manager.eval_reports_2.view', 'action', 'managers', 'Eval Reports #2', 'Open Eval Reports #2.', '{}', 1490),
  ('manager.historical_report.view', 'action', 'managers', 'Historical Report', 'Open Historical Report.', '{}', 1500),
  ('manager.shortage_cancel.view', 'action', 'managers', 'Shortage / Cancel', 'Open Shortage and Cancel.', '{}', 1510),
  ('manager.block_clearing.view', 'action', 'managers', 'Block Clearing', 'Open Block Clearing.', '{}', 1520),
  ('manager.shear_approvals.manage', 'action', 'managers', 'Shear Approvals', 'Manage Shear approvals.', '{}', 1530),
  ('manager.ncr_approvals.manage', 'action', 'managers', 'NCR Approvals', 'Manage NCR approvals.', '{}', 1540),
  ('manager.not_on_inventory.manage', 'action', 'managers', 'Not On Inventory', 'Manage Not On Inventory approvals.', '{}', 1550),
  ('access_control.manage', 'action', 'access-control', 'Access Control', 'Review and edit the audit access policy.', '{}', 1600)
on conflict (permission_key) do update set
  permission_kind = excluded.permission_kind,
  module_key = excluded.module_key,
  label = excluded.label,
  description = excluded.description,
  scope_options = excluded.scope_options,
  sort_order = excluded.sort_order,
  active = true;

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('client.can_access_view.drive', 'module.drive.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.tasks', 'module.tasks.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.docks', 'module.docks.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.take_back', 'module.take-back.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.production', 'module.production.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.production_workflow', 'module.production-workflow.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.weather_hold', 'module.weather-hold.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.shear_list', 'module.shear-list.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.sales', 'module.sales.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.managers', 'module.managers.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.can_access_view.po_management', 'module.po-management.view', 'client', 'Legacy module visibility and route guard.'),
  ('client.request_capabilities.queue', 'request.view_queue', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.create_general', 'request.create_general', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.create_av', 'request.create_av', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.photo', 'request.take_photo', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.edit', 'request.edit', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.complete', 'request.complete', 'client', 'Legacy Request capability snapshot.'),
  ('client.request_capabilities.archive', 'request.archive', 'client', 'Legacy Request capability snapshot.'),
  ('rpc.get_request_capabilities', 'request.view_queue', 'rpc', 'Server-issued Request capability contract.'),
  ('rls.request_rows', 'request.view_queue', 'rls', 'Row ownership and assignment remain independently authoritative.'),
  ('edge.eval_work_create', 'eval_work.create', 'edge', 'Authenticated Eval Work creation.'),
  ('edge.eval_work_submit', 'eval_work.submit', 'edge', 'Assigned evaluator submit path.'),
  ('rls.eval_work_rows', 'eval_work.view_assigned', 'rls', 'Eval Work ownership and manager scope.'),
  ('apps_script.reclass_email', 'reclass.email', 'apps_script', 'Signed server decision required before Apps Script delivery.'),
  ('client.reclass_review', 'reclass.review.create', 'client', 'Send as Review visibility.'),
  ('rls.po_management', 'po_management.view', 'rls', 'PO view security-invoker policy.'),
  ('client.bloom_picker_order', 'bloom_picker.order', 'client', 'Named-user Bloom Picker order control.'),
  ('client.inventory_edit', 'inventory.edit', 'client', 'Inventory evidence edit controls.'),
  ('client.inventory_photo', 'inventory.photo', 'client', 'Secured photo controls.'),
  ('client.manager.access_control', 'access_control.manage', 'client', 'Access Control manager module.'),
  ('rpc.access_control_matrix', 'access_control.manage', 'rpc', 'Maintainer-only matrix RPC.'),
  ('rpc.access_control_save', 'access_control.manage', 'rpc', 'Maintainer-only optimistic draft save.'),
  ('rpc.access_control_publish', 'access_control.manage', 'rpc', 'Maintainer-only audit publication.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

insert into private.app_access_policy_versions
  (version_number, revision, status, created_by_username, review_reason)
values (1, 1, 'draft', 'system_migration', 'Initial audit baseline')
on conflict (version_number) do nothing;

insert into private.app_access_runtime_state (singleton, contract_version, enforcement_mode)
values (true, 'app-access-v1', 'audit')
on conflict (singleton) do update set
  contract_version = excluded.contract_version,
  enforcement_mode = 'audit',
  updated_at = now();

-- Seed module defaults from the current client role map. DATAENTRY roles are
-- intentionally captured as broad legacy access for audit; unknown future
-- roles receive no grants and therefore default to denied.
with draft as (
  select id from private.app_access_policy_versions where status = 'draft' limit 1
), role_modules(role_key, module_keys) as (
  values
    ('ADMIN', array['*']::text[]),
    ('ADMINISTRATOR', array['*']::text[]),
    ('MANAGER', array['*']::text[]),
    ('DATAENTRY', array['*']::text[]),
    ('DATAENTRYSUPERVISOR', array['*']::text[]),
    ('REP', array['drive','sales','av','docks','request','tasks','weather-hold','communication','department-calendar','chat','sales-office','office']::text[]),
    ('SALESREP', array['drive','sales','av','docks','request','tasks','weather-hold','communication','department-calendar','chat','sales-office','office']::text[]),
    ('CSR', array['drive','sales','av','docks','request','tasks','weather-hold','communication','department-calendar','chat','sales-office','office']::text[]),
    ('QC', array['take-back','production','production-workflow','weather-hold','shear-list','communication','department-calendar','chat','qc','drive','docks','tasks','request']::text[]),
    ('QCSUPERVISOR', array['take-back','production','production-workflow','weather-hold','shear-list','communication','department-calendar','chat','qc','drive','docks','tasks','request']::text[]),
    ('FOREMAN', array['drive','take-back','production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request','communication','department-calendar','chat','hours','grower']::text[]),
    ('GROWER', array['production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request','grower','communication','department-calendar','chat']::text[]),
    ('TAKEBACK', array['take-back','production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request']::text[]),
    ('TAKEBACKS', array['take-back','production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request']::text[]),
    ('EVAL', array['sales-inventory','tasks','drive','request','moves','docks','communication','department-calendar','chat','av','sales-office','weather-hold']::text[]),
    ('EVALUATOR', array['sales-inventory','tasks','drive','request','moves','docks','communication','department-calendar','chat','av','sales-office','weather-hold']::text[]),
    ('DIVISION', array['request','communication','department-calendar','chat']::text[])
)
insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select d.id, rm.role_key, p.permission_key, true, null
from draft d
cross join role_modules rm
join private.app_access_permissions p
  on p.permission_kind = 'module'
 and (rm.module_keys = array['*']::text[] or p.module_key = any(rm.module_keys))
on conflict (policy_id, role_key, permission_key) do nothing;

with draft as (
  select id from private.app_access_policy_versions where status = 'draft' limit 1
), active_roles(role_key) as (
  values ('ADMIN'),('ADMINISTRATOR'),('MANAGER'),('DATAENTRY'),('DATAENTRYSUPERVISOR'),
         ('REP'),('SALESREP'),('CSR'),('QC'),('QCSUPERVISOR'),('FOREMAN'),('GROWER'),
         ('TAKEBACK'),('TAKEBACKS'),('EVAL'),('EVALUATOR'),('DIVISION')
)
insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select d.id, r.role_key, 'request.view_queue', true,
  case
    when r.role_key in ('ADMIN','ADMINISTRATOR','MANAGER') then 'global'
    when r.role_key in ('EVAL','EVALUATOR') then 'assigned'
    when r.role_key = 'DIVISION' then 'division'
    else 'own'
  end
from draft d cross join active_roles r
on conflict (policy_id, role_key, permission_key) do nothing;

with draft as (
  select id from private.app_access_policy_versions where status = 'draft' limit 1
), role_actions(role_key, permission_key) as (
  select role_key, permission_key
  from unnest(array['ADMIN','ADMINISTRATOR','MANAGER','DATAENTRY','DATAENTRYSUPERVISOR','CSR','FOREMAN','GROWER','TAKEBACK','TAKEBACKS','EVAL','EVALUATOR','DIVISION']) as roles(role_key)
  cross join unnest(array['request.create_general','request.create_av']) as permissions(permission_key)
  union all
  select role_key, permission_key
  from unnest(array['REP','SALESREP']) as roles(role_key)
  cross join unnest(array['request.create_av']) as permissions(permission_key)
  union all
  select role_key, permission_key
  from unnest(array['ADMIN','ADMINISTRATOR','MANAGER','DATAENTRY','DATAENTRYSUPERVISOR','REP','SALESREP','CSR','FOREMAN','GROWER','TAKEBACK','TAKEBACKS','EVAL','EVALUATOR','DIVISION']) as roles(role_key)
  cross join unnest(array['request.take_photo','request.edit','request.complete','eval_work.view_assigned','eval_work.submit','reclass.email','inventory.edit','inventory.photo']) as permissions(permission_key)
  union all
  select role_key, 'request.archive'
  from unnest(array['ADMIN','ADMINISTRATOR','MANAGER']) as roles(role_key)
  union all
  select role_key, 'po_management.view'
  from unnest(array['ADMIN','MANAGER']) as roles(role_key)
)
insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select d.id, ra.role_key, ra.permission_key, true,
  case when ra.permission_key = 'eval_work.view_assigned' then 'assigned' else null end
from draft d cross join role_actions ra
on conflict (policy_id, role_key, permission_key) do nothing;

-- Named legacy exceptions are explicit user overrides in the audit policy.
with draft as (
  select id from private.app_access_policy_versions where status = 'draft' limit 1
), manager_profiles as (
  select p.id, lower(btrim(p.username)) as username
  from public.profiles p
  where lower(btrim(p.username)) in ('dylan_collyge','megan_kelly','jd_jones')
), manager_permissions(username, permission_key) as (
  values
    ('dylan_collyge','access_control.manage'),('megan_kelly','access_control.manage'),('jd_jones','access_control.manage'),
    ('dylan_collyge','manager.transactions_keyed.view'),('megan_kelly','manager.transactions_keyed.view'),('jd_jones','manager.transactions_keyed.view'),
    ('dylan_collyge','manager.eval_reports_2.view'),('megan_kelly','manager.eval_reports_2.view'),('jd_jones','manager.eval_reports_2.view'),
    ('dylan_collyge','manager.eval_reports.view'),('megan_kelly','manager.eval_reports.view'),
    ('dylan_collyge','manager.historical_report.view'),('megan_kelly','manager.historical_report.view'),
    ('dylan_collyge','manager.shortage_cancel.view'),('megan_kelly','manager.shortage_cancel.view'),
    ('dylan_collyge','manager.block_clearing.view'),('megan_kelly','manager.block_clearing.view'),
    ('dylan_collyge','manager.assigned_items_export.view'),('megan_kelly','manager.assigned_items_export.view'),('jd_jones','manager.assigned_items_export.view'),
    ('dylan_collyge','manager.productivity.view'),('megan_kelly','manager.productivity.view'),('jd_jones','manager.productivity.view'),
    ('dylan_collyge','manager.approval.view'),('megan_kelly','manager.approval.view'),('jd_jones','manager.approval.view'),
    ('dylan_collyge','manager.shear_approvals.manage'),('megan_kelly','manager.shear_approvals.manage'),('jd_jones','manager.shear_approvals.manage'),
    ('dylan_collyge','manager.ncr_approvals.manage'),('megan_kelly','manager.ncr_approvals.manage'),('jd_jones','manager.ncr_approvals.manage'),
    ('dylan_collyge','manager.not_on_inventory.manage'),('megan_kelly','manager.not_on_inventory.manage'),('jd_jones','manager.not_on_inventory.manage'),
    ('dylan_collyge','manager.season_settings.manage'),('megan_kelly','manager.season_settings.manage'),('jd_jones','manager.season_settings.manage'),
    ('dylan_collyge','manager.av_blanks_bypass.manage'),('megan_kelly','manager.av_blanks_bypass.manage'),('jd_jones','manager.av_blanks_bypass.manage'),
    ('dylan_collyge','manager.inventory_transactions.view'),('megan_kelly','manager.inventory_transactions.view'),('jd_jones','manager.inventory_transactions.view'),
    ('dylan_collyge','manager.crop_roll.view'),('megan_kelly','manager.crop_roll.view'),('jd_jones','manager.crop_roll.view'),
    ('dylan_collyge','eval_work.create'),('megan_kelly','eval_work.create'),
    ('dylan_collyge','eval_work.manage'),('megan_kelly','eval_work.manage'),
    ('dylan_collyge','reclass.review.create'),('megan_kelly','reclass.review.create'),
    ('dylan_collyge','transactions_keyed.view'),('megan_kelly','transactions_keyed.view'),('jd_jones','transactions_keyed.view'),
    ('dylan_collyge','moves.manage'),('megan_kelly','moves.manage'),('jd_jones','moves.manage'),
    ('dylan_collyge','bloom_picker.order'),
    ('dylan_collyge','module.disease-pest.view'),('dylan_collyge','module.pest-management.view')
)
insert into private.app_access_user_overrides
  (policy_id, profile_id, permission_key, allowed, access_scope)
select d.id, mp.id, mper.permission_key, true,
  case when mper.permission_key = 'eval_work.view_assigned' then 'global' else null end
from draft d
join manager_profiles mp on true
join manager_permissions mper on mper.username = mp.username
on conflict (policy_id, profile_id, permission_key) do nothing;

with draft as (
  select id from private.app_access_policy_versions where status = 'draft' limit 1
), request_overrides(username, permission_key, allowed, access_scope) as (
  values
    ('dylan_collyge','request.view_queue',true,'global'),
    ('megan_kelly','request.view_queue',true,'global'),
    ('jd_jones','request.view_queue',true,'global'),
    ('kayla_knepp','request.view_queue',true,'global'),
    ('dylan_collyge','request.create_general',true,null),
    ('megan_kelly','request.create_general',true,null),
    ('jd_jones','request.create_general',true,null),
    ('kayla_knepp','request.create_general',true,null),
    ('ben_brown','request.create_general',true,null),
    ('chance_alldredge','request.create_general',true,null),
    ('kayla_knepp','request.create_av',true,null),
    ('kayla_knepp','request.take_photo',true,null),
    ('kayla_knepp','request.edit',true,null),
    ('kayla_knepp','request.complete',true,null),
    ('kayla_knepp','request.archive',true,null),
    ('brandt_emerson','module.managers.view',false,null)
)
insert into private.app_access_user_overrides
  (policy_id, profile_id, permission_key, allowed, access_scope)
select d.id, p.id, ro.permission_key, ro.allowed, ro.access_scope
from draft d
join request_overrides ro on true
join public.profiles p on lower(btrim(p.username)) = ro.username
on conflict (policy_id, profile_id, permission_key) do update set
  allowed = excluded.allowed,
  access_scope = excluded.access_scope,
  updated_at = now();

create index if not exists app_access_role_grants_lookup_idx
  on private.app_access_role_grants (policy_id, role_key, permission_key);
create index if not exists app_access_user_overrides_lookup_idx
  on private.app_access_user_overrides (policy_id, profile_id, permission_key);
create index if not exists app_access_baseline_permission_idx
  on private.app_access_legacy_baseline (permission_key, allowed);
create index if not exists app_access_events_policy_created_idx
  on private.app_access_change_events (policy_id, created_at desc);

create or replace function private.is_access_control_maintainer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join private.app_access_maintainers m
      on m.username = lower(btrim(p.username))
    where p.id = (select auth.uid())
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
  )
$$;

create or replace function private.resolve_app_access_policy_id_v1(p_prefer_draft boolean default false)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_prefer_draft then (
      select v.id from private.app_access_policy_versions v
      where v.status = 'draft' order by v.version_number desc limit 1
    )
    when s.enforcement_mode = 'enforced' and s.active_policy_id is not null then s.active_policy_id
    when s.reviewed_policy_id is not null then s.reviewed_policy_id
    else (
      select v.id from private.app_access_policy_versions v
      where v.status = 'draft' order by v.version_number desc limit 1
    )
  end
  from private.app_access_runtime_state s
  where s.singleton
$$;

create or replace function private.get_effective_app_permissions_v1(
  p_profile_id uuid,
  p_policy_id bigint
)
returns table (
  permission_key text,
  permission_kind text,
  module_key text,
  label text,
  description text,
  scope_options text[],
  sort_order integer,
  allowed boolean,
  access_scope text,
  decision_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  with profile as (
    select p.id, private.normalized_profile_role(p.role) as role_key,
           p.disabled_at, p.locked_until
    from public.profiles p
    where p.id = p_profile_id
    limit 1
  )
  select perm.permission_key,
         perm.permission_kind,
         perm.module_key,
         perm.label,
         perm.description,
         perm.scope_options,
         perm.sort_order,
         case
           when profile.id is null or profile.disabled_at is not null
             or (profile.locked_until is not null and profile.locked_until > now()) then false
           else coalesce(u.allowed, r.allowed, false)
         end as allowed,
         case
           when profile.id is null or profile.disabled_at is not null
             or (profile.locked_until is not null and profile.locked_until > now()) then null
           when u.permission_key is not null then u.access_scope
           when r.permission_key is not null then r.access_scope
           else null
         end as access_scope,
         case
           when profile.id is null or profile.disabled_at is not null
             or (profile.locked_until is not null and profile.locked_until > now()) then 'default-deny'
           when u.permission_key is not null then 'user'
           when r.permission_key is not null then 'role'
           else 'default-deny'
         end as decision_source
  from private.app_access_permissions perm
  left join profile on true
  left join private.app_access_role_grants r
    on r.policy_id = p_policy_id
   and r.role_key = profile.role_key
   and r.permission_key = perm.permission_key
  left join private.app_access_user_overrides u
    on u.policy_id = p_policy_id
   and u.profile_id = profile.id
   and u.permission_key = perm.permission_key
  where perm.active
  order by perm.sort_order, perm.permission_key
$$;

-- Capture an immutable estimate of the existing policy at migration time. The
-- audit matrix compares future draft edits to this baseline; it does not use
-- the baseline to authorize requests.
insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, e.permission_key, e.allowed, e.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(true)
) e
on conflict (profile_id, permission_key) do nothing;

create or replace function public.get_my_app_permissions_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles;
  state private.app_access_runtime_state;
  policy private.app_access_policy_versions;
  permissions jsonb;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'APP_ACCESS_PROFILE_REQUIRED';
  end if;

  select * into state from private.app_access_runtime_state where singleton;
  select * into policy
  from private.app_access_policy_versions
  where id = private.resolve_app_access_policy_id_v1(false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionKey', e.permission_key,
    'kind', e.permission_kind,
    'moduleKey', e.module_key,
    'label', e.label,
    'allowed', e.allowed,
    'scope', e.access_scope,
    'source', e.decision_source
  ) order by e.sort_order, e.permission_key), '[]'::jsonb)
  into permissions
  from private.get_effective_app_permissions_v1(profile.id, policy.id) e;

  return jsonb_build_object(
    'contractVersion', 'app-access-v1',
    'enforcementMode', state.enforcement_mode,
    'policyVersion', policy.version_number,
    'policyRevision', policy.revision,
    'username', lower(btrim(profile.username)),
    'role', profile.role,
    'permissions', permissions
  );
end
$$;

create or replace function public.get_access_control_matrix_v1(
  p_policy_version_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  policy private.app_access_policy_versions;
  state private.app_access_runtime_state;
  permission_rows jsonb;
  user_rows jsonb;
  role_rows jsonb;
  mismatch_count bigint := 0;
  baseline_missing_count bigint := 0;
begin
  if not private.is_access_control_maintainer() then
    raise exception using errcode = '42501', message = 'ACCESS_CONTROL_FORBIDDEN';
  end if;

  select * into state from private.app_access_runtime_state where singleton;
  select * into policy
  from private.app_access_policy_versions v
  where v.id = coalesce(p_policy_version_id, private.resolve_app_access_policy_id_v1(true))
  limit 1;
  if policy.id is null then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_POLICY_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionKey', p.permission_key,
    'kind', p.permission_kind,
    'moduleKey', p.module_key,
    'label', p.label,
    'description', p.description,
    'scopeOptions', to_jsonb(p.scope_options),
    'sortOrder', p.sort_order
  ) order by p.sort_order, p.permission_key), '[]'::jsonb)
  into permission_rows
  from private.app_access_permissions p
  where p.active;

  with active_profiles as (
    select p.* from public.profiles p
    where p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
  ), decisions as (
    select p.id as profile_id, e.*,
           b.allowed as legacy_allowed,
           b.access_scope as legacy_scope,
           b.permission_key is not null as baseline_present
    from active_profiles p
    cross join lateral private.get_effective_app_permissions_v1(p.id, policy.id) e
    left join private.app_access_legacy_baseline b
      on b.profile_id = p.id and b.permission_key = e.permission_key
  ), user_decisions as (
    select d.profile_id,
           jsonb_object_agg(d.permission_key, jsonb_build_object(
             'allowed', d.allowed,
             'scope', d.access_scope,
             'source', d.decision_source,
             'legacyAllowed', d.legacy_allowed,
             'legacyScope', d.legacy_scope,
             'baselinePresent', d.baseline_present,
             'mismatch', d.baseline_present and (d.allowed is distinct from d.legacy_allowed or d.access_scope is distinct from d.legacy_scope)
           )) as decisions
    from decisions d
    group by d.profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'username', lower(btrim(p.username)),
    'displayName', coalesce(nullif(p.display_name, ''), p.username),
    'role', p.role,
    'roleKey', private.normalized_profile_role(p.role),
    'decisions', ud.decisions
  ) order by lower(coalesce(nullif(p.display_name, ''), p.username)), lower(p.username)), '[]'::jsonb)
  into user_rows
  from active_profiles p
  join user_decisions ud on ud.profile_id = p.id;

  with roles as (
    select distinct private.normalized_profile_role(p.role) as role_key
    from public.profiles p
    where p.disabled_at is null
    union
    select distinct r.role_key from private.app_access_role_grants r where r.policy_id = policy.id
  ), role_decisions as (
    select roles.role_key,
           jsonb_object_agg(perm.permission_key, jsonb_build_object(
             'allowed', coalesce(grant_row.allowed, false),
             'scope', grant_row.access_scope,
             'source', case when grant_row.permission_key is null then 'default-deny' else 'role' end
           )) as decisions
    from roles
    cross join private.app_access_permissions perm
    left join private.app_access_role_grants grant_row
      on grant_row.policy_id = policy.id
     and grant_row.role_key = roles.role_key
     and grant_row.permission_key = perm.permission_key
    where perm.active and roles.role_key <> ''
    group by roles.role_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'roleKey', rd.role_key,
    'decisions', rd.decisions
  ) order by rd.role_key), '[]'::jsonb)
  into role_rows
  from role_decisions rd;

  select count(*) filter (
           where b.permission_key is not null
             and (e.allowed is distinct from b.allowed or e.access_scope is distinct from b.access_scope)
         ),
         count(*) filter (where b.permission_key is null)
    into mismatch_count, baseline_missing_count
  from public.profiles p
  cross join lateral private.get_effective_app_permissions_v1(p.id, policy.id) e
  left join private.app_access_legacy_baseline b
    on b.profile_id = p.id and b.permission_key = e.permission_key
  where p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now());

  return jsonb_build_object(
    'contractVersion', 'app-access-v1',
    'enforcementMode', state.enforcement_mode,
    'policy', jsonb_build_object(
      'id', policy.id,
      'version', policy.version_number,
      'revision', policy.revision,
      'status', policy.status,
      'reviewedAt', policy.reviewed_at,
      'reviewedBy', policy.reviewed_by_username
    ),
    'permissions', permission_rows,
    'users', user_rows,
    'roles', role_rows,
    'summary', jsonb_build_object(
      'userCount', jsonb_array_length(user_rows),
      'permissionCount', jsonb_array_length(permission_rows),
      'mismatchCount', mismatch_count,
      'baselineMissingCount', baseline_missing_count
    )
  );
end
$$;

create or replace function public.save_access_control_draft_v1(
  p_expected_revision integer,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  policy private.app_access_policy_versions;
  change_row jsonb;
  target_type_value text;
  target_key_value text;
  permission_key_value text;
  decision_value text;
  scope_value text;
  profile_id_value uuid;
  permission_row private.app_access_permissions;
  previous_value jsonb;
  next_value jsonb;
  applied_count integer := 0;
begin
  actor := private.current_active_profile();
  if actor.id is null or not private.is_access_control_maintainer() then
    raise exception using errcode = '42501', message = 'ACCESS_CONTROL_FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 4 and 500 then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_REASON_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_changes) < 1
     or jsonb_array_length(p_changes) > 500 then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_CHANGES_INVALID';
  end if;

  select * into policy
  from private.app_access_policy_versions
  where status = 'draft'
  order by version_number desc
  limit 1
  for update;
  if policy.id is null then
    raise exception using errcode = '40001', message = 'ACCESS_CONTROL_DRAFT_MISSING';
  end if;
  if policy.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ACCESS_CONTROL_VERSION_CONFLICT';
  end if;

  for change_row in select value from jsonb_array_elements(p_changes) loop
    target_type_value := lower(btrim(coalesce(change_row->>'targetType', '')));
    target_key_value := btrim(coalesce(change_row->>'targetKey', ''));
    permission_key_value := lower(btrim(coalesce(change_row->>'permissionKey', '')));
    decision_value := lower(btrim(coalesce(change_row->>'decision', '')));
    scope_value := nullif(lower(btrim(coalesce(change_row->>'scope', ''))), '');

    if target_type_value not in ('role', 'user') or decision_value not in ('inherit', 'allow', 'deny') then
      raise exception using errcode = '22023', message = 'ACCESS_CONTROL_CHANGE_INVALID';
    end if;
    select * into permission_row
    from private.app_access_permissions p
    where p.permission_key = permission_key_value and p.active;
    if permission_row.permission_key is null then
      raise exception using errcode = '22023', message = 'ACCESS_CONTROL_PERMISSION_UNKNOWN';
    end if;
    if scope_value is not null and not (scope_value = any(permission_row.scope_options)) then
      raise exception using errcode = '22023', message = 'ACCESS_CONTROL_SCOPE_INVALID';
    end if;
    if cardinality(permission_row.scope_options) = 0 or decision_value <> 'allow' then
      scope_value := null;
    elsif scope_value is null then
      raise exception using errcode = '22023', message = 'ACCESS_CONTROL_SCOPE_REQUIRED';
    end if;

    if target_type_value = 'role' then
      target_key_value := private.normalized_profile_role(target_key_value);
      if target_key_value = '' then
        raise exception using errcode = '22023', message = 'ACCESS_CONTROL_ROLE_INVALID';
      end if;
      select jsonb_build_object('allowed', g.allowed, 'scope', g.access_scope)
        into previous_value
      from private.app_access_role_grants g
      where g.policy_id = policy.id and g.role_key = target_key_value
        and g.permission_key = permission_key_value;

      if decision_value = 'inherit' then
        delete from private.app_access_role_grants
        where policy_id = policy.id and role_key = target_key_value
          and permission_key = permission_key_value;
        next_value := null;
      else
        insert into private.app_access_role_grants
          (policy_id, role_key, permission_key, allowed, access_scope, updated_at)
        values (policy.id, target_key_value, permission_key_value, decision_value = 'allow', scope_value, now())
        on conflict (policy_id, role_key, permission_key) do update set
          allowed = excluded.allowed,
          access_scope = excluded.access_scope,
          updated_at = now();
        next_value := jsonb_build_object('allowed', decision_value = 'allow', 'scope', scope_value);
      end if;
    else
      select p.id into profile_id_value
      from public.profiles p
      where lower(btrim(p.username)) = lower(btrim(target_key_value))
      limit 1;
      if profile_id_value is null then
        raise exception using errcode = '22023', message = 'ACCESS_CONTROL_USER_UNKNOWN';
      end if;
      target_key_value := lower(btrim(target_key_value));
      select jsonb_build_object('allowed', o.allowed, 'scope', o.access_scope)
        into previous_value
      from private.app_access_user_overrides o
      where o.policy_id = policy.id and o.profile_id = profile_id_value
        and o.permission_key = permission_key_value;

      if decision_value = 'inherit' then
        delete from private.app_access_user_overrides
        where policy_id = policy.id and profile_id = profile_id_value
          and permission_key = permission_key_value;
        next_value := null;
      else
        insert into private.app_access_user_overrides
          (policy_id, profile_id, permission_key, allowed, access_scope, updated_at)
        values (policy.id, profile_id_value, permission_key_value, decision_value = 'allow', scope_value, now())
        on conflict (policy_id, profile_id, permission_key) do update set
          allowed = excluded.allowed,
          access_scope = excluded.access_scope,
          updated_at = now();
        next_value := jsonb_build_object('allowed', decision_value = 'allow', 'scope', scope_value);
      end if;
    end if;

    if previous_value is distinct from next_value then
      insert into private.app_access_change_events
        (policy_id, actor_username, event_type, target_type, target_key,
         permission_key, previous_value, next_value, reason)
      values
        (policy.id, lower(btrim(actor.username)), 'draft_changed', target_type_value,
         target_key_value, permission_key_value, previous_value, next_value, btrim(p_reason));
      applied_count := applied_count + 1;
    end if;
  end loop;

  if applied_count > 0 then
    update private.app_access_policy_versions
    set revision = revision + 1
    where id = policy.id
    returning * into policy;
  end if;

  return jsonb_build_object(
    'contractVersion', 'app-access-v1',
    'policyId', policy.id,
    'policyVersion', policy.version_number,
    'revision', policy.revision,
    'appliedCount', applied_count,
    'enforcementMode', 'audit'
  );
end
$$;

create or replace function public.publish_access_control_policy_v1(
  p_expected_revision integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  reviewed private.app_access_policy_versions;
  next_draft private.app_access_policy_versions;
begin
  actor := private.current_active_profile();
  if actor.id is null or not private.is_access_control_maintainer() then
    raise exception using errcode = '42501', message = 'ACCESS_CONTROL_FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 4 and 500 then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_REASON_REQUIRED';
  end if;

  select * into reviewed
  from private.app_access_policy_versions
  where status = 'draft'
  order by version_number desc
  limit 1
  for update;
  if reviewed.id is null or reviewed.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ACCESS_CONTROL_VERSION_CONFLICT';
  end if;

  update private.app_access_policy_versions
  set status = 'reviewed', reviewed_by_username = lower(btrim(actor.username)),
      reviewed_at = now(), review_reason = btrim(p_reason)
  where id = reviewed.id
  returning * into reviewed;

  update private.app_access_runtime_state
  set reviewed_policy_id = reviewed.id, updated_at = now()
  where singleton;

  insert into private.app_access_change_events
    (policy_id, actor_username, event_type, target_type, target_key,
     permission_key, previous_value, next_value, reason)
  values
    (reviewed.id, lower(btrim(actor.username)), 'policy_reviewed', 'policy',
     reviewed.version_number::text, null,
     jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'reviewed'), btrim(p_reason));

  insert into private.app_access_policy_versions
    (version_number, revision, status, base_policy_id, created_by_username, review_reason)
  values
    ((select coalesce(max(version_number), 0) + 1 from private.app_access_policy_versions),
     1, 'draft', reviewed.id, lower(btrim(actor.username)), 'Draft copied from reviewed policy')
  returning * into next_draft;

  insert into private.app_access_role_grants
    (policy_id, role_key, permission_key, allowed, access_scope, updated_at)
  select next_draft.id, role_key, permission_key, allowed, access_scope, now()
  from private.app_access_role_grants where policy_id = reviewed.id;

  insert into private.app_access_user_overrides
    (policy_id, profile_id, permission_key, allowed, access_scope, updated_at)
  select next_draft.id, profile_id, permission_key, allowed, access_scope, now()
  from private.app_access_user_overrides where policy_id = reviewed.id;

  insert into private.app_access_change_events
    (policy_id, actor_username, event_type, target_type, target_key,
     permission_key, previous_value, next_value, reason)
  values
    (next_draft.id, lower(btrim(actor.username)), 'draft_created', 'policy',
     next_draft.version_number::text, null, null,
     jsonb_build_object('basePolicyId', reviewed.id), 'Draft created after audit publication');

  return jsonb_build_object(
    'contractVersion', 'app-access-v1',
    'enforcementMode', 'audit',
    'reviewedPolicyId', reviewed.id,
    'reviewedPolicyVersion', reviewed.version_number,
    'draftPolicyId', next_draft.id,
    'draftPolicyVersion', next_draft.version_number,
    'draftRevision', next_draft.revision
  );
end
$$;

create or replace function public.get_access_control_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  state private.app_access_runtime_state;
  permission_count bigint := 0;
  active_user_count bigint := 0;
  baseline_missing_count bigint := 0;
  unknown_role_count bigint := 0;
  maintainer_count bigint := 0;
  legacy_mismatch_count bigint := 0;
  unknown_permission_count bigint := 0;
  unmapped_legacy_check_count bigint := 0;
  draft_policy_id bigint;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'ACCESS_CONTROL_HEALTH_FORBIDDEN';
  end if;
  select * into state from private.app_access_runtime_state where singleton;
  draft_policy_id := private.resolve_app_access_policy_id_v1(true);
  select count(*) into permission_count from private.app_access_permissions where active;
  select count(*) into active_user_count from public.profiles
    where disabled_at is null and (locked_until is null or locked_until <= now());
  select count(*) into maintainer_count
  from private.app_access_maintainers m
  join public.profiles p on lower(btrim(p.username)) = m.username
  where p.disabled_at is null and (p.locked_until is null or p.locked_until <= now());
  select count(*) into baseline_missing_count
  from public.profiles p
  cross join private.app_access_permissions perm
  left join private.app_access_legacy_baseline b
    on b.profile_id = p.id and b.permission_key = perm.permission_key
  where p.disabled_at is null and perm.active and b.permission_key is null;
  select count(*) into unknown_role_count
  from public.profiles p
  where p.disabled_at is null
    and not exists (
      select 1 from private.app_access_role_grants g
      where g.policy_id = draft_policy_id
        and g.role_key = private.normalized_profile_role(p.role)
    );
  select count(*) into legacy_mismatch_count
  from public.profiles p
  cross join lateral private.get_effective_app_permissions_v1(p.id, draft_policy_id) e
  join private.app_access_legacy_baseline b
    on b.profile_id = p.id and b.permission_key = e.permission_key
  where p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and (e.allowed is distinct from b.allowed or e.access_scope is distinct from b.access_scope);
  select count(*) into unknown_permission_count
  from private.app_access_legacy_checks c
  left join private.app_access_permissions p on p.permission_key = c.permission_key and p.active
  where c.permission_key is null or p.permission_key is null;
  select count(*) into unmapped_legacy_check_count
  from private.app_access_legacy_checks c
  where c.permission_key is null;

  return jsonb_build_object(
    'contract_version', 'app-access-v1',
    'enforcement_mode', state.enforcement_mode,
    'permission_count', permission_count,
    'active_user_count', active_user_count,
    'maintainer_count', maintainer_count,
    'baseline_missing_count', baseline_missing_count,
    'unknown_role_count', unknown_role_count,
    'legacy_mismatch_count', legacy_mismatch_count,
    'unknown_permission_count', unknown_permission_count,
    'unmapped_legacy_check_count', unmapped_legacy_check_count,
    'legacy_check_count', (select count(*) from private.app_access_legacy_checks),
    'draft_policy_id', draft_policy_id,
    'reviewed_policy_id', state.reviewed_policy_id,
    'active_policy_id', state.active_policy_id
  );
end
$$;

revoke all on function private.is_access_control_maintainer() from public, anon, authenticated;
revoke all on function private.resolve_app_access_policy_id_v1(boolean) from public, anon, authenticated;
revoke all on function private.get_effective_app_permissions_v1(uuid, bigint) from public, anon, authenticated;

revoke all on function public.get_my_app_permissions_v1() from public, anon, authenticated;
revoke all on function public.get_access_control_matrix_v1(bigint) from public, anon, authenticated;
revoke all on function public.save_access_control_draft_v1(integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.publish_access_control_policy_v1(integer, text) from public, anon, authenticated;
revoke all on function public.get_access_control_health_snapshot_v1() from public, anon, authenticated;

grant execute on function public.get_my_app_permissions_v1() to authenticated;
grant execute on function public.get_access_control_matrix_v1(bigint) to authenticated;
grant execute on function public.save_access_control_draft_v1(integer, jsonb, text) to authenticated;
grant execute on function public.publish_access_control_policy_v1(integer, text) to authenticated;
grant execute on function public.get_access_control_health_snapshot_v1() to service_role;

comment on function public.get_my_app_permissions_v1() is
  'Returns only the authenticated caller effective app-access-v1 audit snapshot.';
comment on function public.get_access_control_matrix_v1(bigint) is
  'Maintainer-only effective access matrix with sanitized legacy comparison.';
comment on function public.save_access_control_draft_v1(integer, jsonb, text) is
  'Maintainer-only optimistic draft policy update; audit mode does not change live authorization.';
comment on function public.publish_access_control_policy_v1(integer, text) is
  'Publishes an immutable reviewed audit policy and creates the next draft; enforcement remains audit-only.';
comment on function public.get_access_control_health_snapshot_v1() is
  'Service-only sanitized centralized-access coverage evidence.';

notify pgrst, 'reload schema';

commit;
