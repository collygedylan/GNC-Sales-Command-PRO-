-- Customer / consignee -> sales rep master map.
-- Safe to run more than once before using the Run Script button.

create table if not exists public.v2_customer_consignee_sales_reps (
    unique_id text primary key,
    customeridentityid text,
    customername text,
    customergroup text,
    customergroupname text,
    customeraddress_1 text,
    customeraddress_2 text,
    customercity text,
    customerstate text,
    customerzip text,
    customercounty text,
    customercountry text,
    creditmanagerid text,
    creditmanagername text,
    customerstatus text,
    sortname text,
    requirepo text,
    ediworequired text,
    top10 text,
    mailings text,
    majoracct text,
    autoemail_inv text,
    syninvoiceemail text,
    termscode text,
    termsdescription text,
    delayed_due_1 text,
    delayed_due_2 text,
    tax_exempt_number text,
    tax_exempt_date text,
    combine_for_vip text,
    customerpurchasediscount text,
    discount_applies text,
    discounttype text,
    majorcommtype text,
    groupapprovalrequired text,
    edicustomer text,
    edirollup text,
    ackversion text,
    delversion text,
    invversion text,
    creditstatus text,
    creditrating text,
    creditlimit text,
    consigneegroup text,
    consigneegroupname text,
    consigneeid text,
    consigneename text,
    consigneeaddress_1 text,
    consigneeaddress_2 text,
    consigneecity text,
    consigneestate text,
    consigneezip text,
    consigneecounty text,
    consigneecountry text,
    salesrepid text,
    salesrepname text,
    territorycode text,
    territorydesc text,
    cadisc_percent text,
    custmajoracct text,
    autoemailack text,
    synemailack text,
    consigneetype text,
    storenumber text,
    tagcode text,
    qacode text,
    consigneestatus text,
    phfreightzone text,
    txfreightzone text,
    ncfreightzone text,
    phpriceschedule text,
    txpriceschedule text,
    ncpriceschedule text,
    taxcode text,
    nsy_lic_no text,
    nsy_lic_exp text,
    generalloadinstr text,
    okloadinst text,
    txloadinst text,
    ncloadinst text,
    driverdirections text,
    consigneedeliverynote text,
    primarycontactid text,
    primarycontactname text,
    primarycontactphone text,
    primarycontactcell text,
    primarycontactfax text,
    primarycontactemail text,
    secondarycontactid text,
    secondarycontactname text,
    secondarycontactphone text,
    secondarycontactcell text,
    secondarycontactfax text,
    secondarycontactemail text,
    principalcontactid text,
    principalcontactname text,
    principalcontactphone text,
    principalcontactcell text,
    principalcontactfax text,
    principalcontactemail text,
    billingcontactid text,
    billingcontactname text,
    billingcontactphone text,
    billingcontactcell text,
    billingcontactfax text,
    billingcontactemail text,
    shippingcontactid text,
    shippingcontactname text,
    shippingcontactphone text,
    shippingcontactcell text,
    shippingcontactfax text,
    shippingcontactemail text,
    shipcontactcommentstring text,
    cust_notes text,
    sendstatements text,
    emailstatements text,
    statementsent text,
    filename text,
    source_file_name text,
    source_row_number integer,
    row_hash text,
    imported_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_customer_rep_customername
    on public.v2_customer_consignee_sales_reps (lower(customername));

create index if not exists idx_v2_customer_rep_consigneename
    on public.v2_customer_consignee_sales_reps (lower(consigneename));

create index if not exists idx_v2_customer_rep_salesrepname
    on public.v2_customer_consignee_sales_reps (lower(salesrepname));

create index if not exists idx_v2_customer_rep_customer_consignee
    on public.v2_customer_consignee_sales_reps (lower(customername), lower(consigneename));

alter table public.v2_customer_consignee_sales_reps enable row level security;

drop policy if exists "Allow app read customer consignee sales reps" on public.v2_customer_consignee_sales_reps;
create policy "Allow app read customer consignee sales reps"
on public.v2_customer_consignee_sales_reps
for select
using (true);

drop policy if exists "Allow app write customer consignee sales reps" on public.v2_customer_consignee_sales_reps;
create policy "Allow app write customer consignee sales reps"
on public.v2_customer_consignee_sales_reps
for all
using (true)
with check (true);

grant select, insert, update, delete on public.v2_customer_consignee_sales_reps to anon, authenticated, service_role;

do $$
begin
    alter publication supabase_realtime add table public.v2_customer_consignee_sales_reps;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
