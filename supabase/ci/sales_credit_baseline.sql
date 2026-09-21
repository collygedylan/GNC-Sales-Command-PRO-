-- Disposable CI only: legacy shapes absent from the composed migration fixture.
-- Never apply this baseline to production.
create table if not exists public.ph_sales_credit_requests (
  unique_id text primary key, request_unique_id text, request_folder text, requested_by text, salesrepname text,
  customername text, consigneename text, req_customer text, master_id text, master_unique_id text,
  itemcode text, commonname text, contsize text, locationcode text, lotcode text, priority text, req_qty text,
  credit_qty text, credit_reason text, credit_note text, credit_status text not null default 'pending',
  credit_photo_link text, credit_photo_name text, request_photo_link text, request_photo_name text,
  submitted_by_username text, submitted_by_display text, submitted_by_email text, submitted_at timestamptz not null default now(),
  reviewed_by_username text, reviewed_by_display text, reviewed_at timestamptz, review_note text,
  snapshot jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ph_customer_consignee_sales_reps (
  unique_id text primary key, customeridentityid text, customername text, consigneeid text,
  consigneename text, salesrepid text, salesrepname text
);
alter table public.ph_soc_master add column if not exists salesrepid text, add column if not exists salesrepname text;
