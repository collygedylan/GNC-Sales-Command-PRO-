export const requestOptionalQuantityMigrationName = '20261110200000_request_optional_quantity.sql';

export function requestCreateMigrationContract(name) {
    if (name !== requestOptionalQuantityMigrationName) return null;
    return `select exists(
        select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
        where t.tgrelid='public.ph_requests_pending'::regclass
          and t.tgname='require_active_customer_mapping_for_request_v1' and t.tgenabled='O'
          and p.oid='sales_private.require_active_customer_mapping_for_request_v1()'::regprocedure
          and position('-- v3.0.62 optional Request quantity' in p.prosrc)>0
          and position('REQUEST_QUANTITY_REQUIRED' in p.prosrc)=0
          and position('REQUEST_SALES_REP_INVALID' in p.prosrc)>0
          and position('request_mapping_rep_allowed_v1' in p.prosrc)>0
    ) as installed`;
}
