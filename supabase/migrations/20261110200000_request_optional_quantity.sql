begin;

do $patch$
declare
  definition text := pg_get_functiondef('sales_private.require_active_customer_mapping_for_request_v1()'::regprocedure);
  previous_validation constant text := $old$   IF (CASE WHEN replace(coalesce(new.req_qty,''),',','') ~ '^[0-9]+([.][0-9]+)?$' THEN replace(new.req_qty,',','')::numeric ELSE 0 END) <= 0 THEN RAISE EXCEPTION 'REQUEST_QUANTITY_REQUIRED' USING ERRCODE='22023'; END IF;
   new.desired_spec:=coalesce(nullif(btrim(new.desired_spec),''),nullif(nullif(btrim(new.spec),''),'-'),'N/A');$old$;
  optional_validation constant text := $new$   -- v3.0.62 optional Request quantity
   new.req_qty := nullif(btrim(new.req_qty),'');
   IF new.req_qty IS NOT NULL THEN
    IF replace(new.req_qty,',','') !~ '^[0-9]+([.][0-9]+)?$' THEN
     RAISE EXCEPTION 'REQUEST_QUANTITY_INVALID' USING ERRCODE='22023';
    END IF;
    IF replace(new.req_qty,',','')::numeric = 0 THEN new.req_qty := NULL; END IF;
   END IF;
   new.desired_spec := coalesce(nullif(btrim(new.desired_spec),''),'N/A');$new$;
  previous_rep constant text := $old$    select c.* into owner_row from sales_private.customer_rep_catalog_v23102() c
      where c.salesrepid=selected_id and (nullif(btrim(requested_identity),'') is null or sales_private.rep_identity_key_v2394(requested_identity) in (c.salesrep_canonical_key,sales_private.rep_identity_key_v2394(c.salesrepname),sales_private.rep_identity_key_v2394(c.salesrep_username),sales_private.rep_identity_key_v2394(c.salesrepid))) limit 1;
    if owner_row.salesrepid is null then raise exception 'REQUEST_CUSTOMER_MAPPING_REQUIRED' using errcode='22023'; end if;$old$;
  na_rep constant text := $new$    -- Resolve a cold picker by canonical rep identity when it has no source ID yet.
    with matching_rep as materialized (
      select c.* from sales_private.customer_rep_catalog_v23102() c
      where (selected_id is null or c.salesrepid=selected_id)
        and (requested_identity is null and selected_id is not null
          or sales_private.rep_identity_key_v2394(requested_identity) in (
            c.salesrep_canonical_key,sales_private.rep_identity_key_v2394(c.salesrepname),
            sales_private.rep_identity_key_v2394(c.salesrep_username),sales_private.rep_identity_key_v2394(c.salesrepid)))
    )
    select m.* into owner_row from matching_rep m
    where (select count(distinct salesrep_canonical_key) from matching_rep)=1
    order by m.salesrepid limit 1;
    if owner_row.salesrepid is null then raise exception 'REQUEST_SALES_REP_INVALID' using errcode='22023'; end if;$new$;
begin
  if position('-- v3.0.62 optional Request quantity' in definition)>0 then
    if position(na_rep in definition)=0 or position(optional_validation in definition)=0 then
      raise exception 'REQUEST_OPTIONAL_QUANTITY_CONTRACT_MISMATCH';
    end if;
    return;
  end if;
  if position(previous_validation in definition)=0 or position(previous_rep in definition)=0 then
    raise exception 'REQUEST_OPTIONAL_QUANTITY_ANCHOR_MISSING';
  end if;
  execute replace(replace(definition,previous_validation,optional_validation),previous_rep,na_rep);
end
$patch$;

commit;
