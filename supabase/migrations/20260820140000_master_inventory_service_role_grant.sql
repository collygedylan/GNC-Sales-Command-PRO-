-- Drive synchronization and recovery workers use the service role to maintain
-- the canonical inventory table. RLS bypass does not imply table privileges.
grant select, insert, update, delete on table public.ph_master_inventory to service_role;
