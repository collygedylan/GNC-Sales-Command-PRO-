begin;

create or replace function private.normalize_escaped_display_text_v1(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select case
    when strpos(p_value,E'\\')=0 then p_value
    else regexp_replace(p_value,$regex$\\+(['"])$regex$,$replacement$\1$replacement$,'g')
  end
$function$;

revoke all on function private.normalize_escaped_display_text_v1(text) from public,anon,authenticated,service_role;

create or replace function private.normalize_ph_master_inventory_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.pic_note:=private.normalize_escaped_display_text_v1(new.pic_note);
  new.sales_note:=private.normalize_escaped_display_text_v1(new.sales_note);
  new.av_note:=private.normalize_escaped_display_text_v1(new.av_note);
  new.dock_note:=private.normalize_escaped_display_text_v1(new.dock_note);
  new.flyer_notes:=private.normalize_escaped_display_text_v1(new.flyer_notes);
  new.holdstopreason:=private.normalize_escaped_display_text_v1(new.holdstopreason);
  new.locationnote:=private.normalize_escaped_display_text_v1(new.locationnote);
  new.salesnote:=private.normalize_escaped_display_text_v1(new.salesnote);
  new.inventorynote:=private.normalize_escaped_display_text_v1(new.inventorynote);
  new.customername:=private.normalize_escaped_display_text_v1(new.customername);
  new.consigneename:=private.normalize_escaped_display_text_v1(new.consigneename);
  new.picknote:=private.normalize_escaped_display_text_v1(new.picknote);
  new.internalinvnote:=private.normalize_escaped_display_text_v1(new.internalinvnote);
  new.tagdeptnote:=private.normalize_escaped_display_text_v1(new.tagdeptnote);
  return new;
end
$function$;

create or replace function private.normalize_ph_active_request_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.req_customer:=private.normalize_escaped_display_text_v1(new.req_customer);
  new.req_pic_note:=private.normalize_escaped_display_text_v1(new.req_pic_note);
  new.req_sales_note:=private.normalize_escaped_display_text_v1(new.req_sales_note);
  new.req_comments:=private.normalize_escaped_display_text_v1(new.req_comments);
  new.av_note:=private.normalize_escaped_display_text_v1(new.av_note);
  new.request_note:=private.normalize_escaped_display_text_v1(new.request_note);
  new.customername:=private.normalize_escaped_display_text_v1(new.customername);
  new.consigneename:=private.normalize_escaped_display_text_v1(new.consigneename);
  return new;
end
$function$;

create or replace function private.normalize_ph_request_history_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.req_customer:=private.normalize_escaped_display_text_v1(new.req_customer);
  new.request_customer:=private.normalize_escaped_display_text_v1(new.request_customer);
  new.req_pic_note:=private.normalize_escaped_display_text_v1(new.req_pic_note);
  new.req_comments:=private.normalize_escaped_display_text_v1(new.req_comments);
  new.av_note:=private.normalize_escaped_display_text_v1(new.av_note);
  new.customername:=private.normalize_escaped_display_text_v1(new.customername);
  new.consigneename:=private.normalize_escaped_display_text_v1(new.consigneename);
  return new;
end
$function$;

create or replace function private.normalize_ph_soc_master_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.dock_note:=private.normalize_escaped_display_text_v1(new.dock_note);
  new.customername:=private.normalize_escaped_display_text_v1(new.customername);
  new.consigneename:=private.normalize_escaped_display_text_v1(new.consigneename);
  new.holdstopreason:=private.normalize_escaped_display_text_v1(new.holdstopreason);
  new.salesnote:=private.normalize_escaped_display_text_v1(new.salesnote);
  new.picknote:=private.normalize_escaped_display_text_v1(new.picknote);
  new.internalinvnote:=private.normalize_escaped_display_text_v1(new.internalinvnote);
  new.tagdeptnote:=private.normalize_escaped_display_text_v1(new.tagdeptnote);
  new.pic_note:=private.normalize_escaped_display_text_v1(new.pic_note);
  new.sales_note:=private.normalize_escaped_display_text_v1(new.sales_note);
  new.av_note:=private.normalize_escaped_display_text_v1(new.av_note);
  new.flyer_notes:=private.normalize_escaped_display_text_v1(new.flyer_notes);
  return new;
end
$function$;

create or replace function private.normalize_ph_reserves_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.pic_note:=private.normalize_escaped_display_text_v1(new.pic_note);
  new.sales_note:=private.normalize_escaped_display_text_v1(new.sales_note);
  new.av_note:=private.normalize_escaped_display_text_v1(new.av_note);
  new.dock_note:=private.normalize_escaped_display_text_v1(new.dock_note);
  new.flyer_notes:=private.normalize_escaped_display_text_v1(new.flyer_notes);
  new.customername:=private.normalize_escaped_display_text_v1(new.customername);
  new.consigneename:=private.normalize_escaped_display_text_v1(new.consigneename);
  new.holdstopreason:=private.normalize_escaped_display_text_v1(new.holdstopreason);
  new.salesnote:=private.normalize_escaped_display_text_v1(new.salesnote);
  new.picknote:=private.normalize_escaped_display_text_v1(new.picknote);
  new.internalinvnote:=private.normalize_escaped_display_text_v1(new.internalinvnote);
  new.tagdeptnote:=private.normalize_escaped_display_text_v1(new.tagdeptnote);
  return new;
end
$function$;

create or replace function private.normalize_ph_cav_import_escaped_text_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.commonname:=private.normalize_escaped_display_text_v1(new.commonname);
  new.product_description:=private.normalize_escaped_display_text_v1(new.product_description);
  new.holdstopreason:=private.normalize_escaped_display_text_v1(new.holdstopreason);
  new.hold_reason:=private.normalize_escaped_display_text_v1(new.hold_reason);
  return new;
end
$function$;

revoke all on function private.normalize_ph_master_inventory_escaped_text_v1() from public,anon,authenticated,service_role;
revoke all on function private.normalize_ph_active_request_escaped_text_v1() from public,anon,authenticated,service_role;
revoke all on function private.normalize_ph_request_history_escaped_text_v1() from public,anon,authenticated,service_role;
revoke all on function private.normalize_ph_soc_master_escaped_text_v1() from public,anon,authenticated,service_role;
revoke all on function private.normalize_ph_reserves_escaped_text_v1() from public,anon,authenticated,service_role;
revoke all on function private.normalize_ph_cav_import_escaped_text_v1() from public,anon,authenticated,service_role;

drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_master_inventory;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_master_inventory
for each row execute function private.normalize_ph_master_inventory_escaped_text_v1();
drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_active_request;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_active_request
for each row execute function private.normalize_ph_active_request_escaped_text_v1();
drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_request_history;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_request_history
for each row execute function private.normalize_ph_request_history_escaped_text_v1();
drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_soc_master;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_soc_master
for each row execute function private.normalize_ph_soc_master_escaped_text_v1();
drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_reserves;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_reserves
for each row execute function private.normalize_ph_reserves_escaped_text_v1();
drop trigger if exists a000_normalize_escaped_display_text_v1 on public.ph_cav_import;
create trigger a000_normalize_escaped_display_text_v1 before insert or update on public.ph_cav_import
for each row execute function private.normalize_ph_cav_import_escaped_text_v1();

do $cleanup$
begin
  if exists(select 1 from public.ph_master_inventory where concat_ws(E'\x1f',commonname,pic_note,sales_note,av_note,dock_note,flyer_notes,holdstopreason,locationnote,salesnote,inventorynote,customername,consigneename,picknote,internalinvnote,tagdeptnote) ~ $regex$\\+(['"])$regex$) then
    update public.ph_master_inventory set
      commonname=private.normalize_escaped_display_text_v1(commonname),pic_note=private.normalize_escaped_display_text_v1(pic_note),
      sales_note=private.normalize_escaped_display_text_v1(sales_note),av_note=private.normalize_escaped_display_text_v1(av_note),
      dock_note=private.normalize_escaped_display_text_v1(dock_note),flyer_notes=private.normalize_escaped_display_text_v1(flyer_notes),
      holdstopreason=private.normalize_escaped_display_text_v1(holdstopreason),locationnote=private.normalize_escaped_display_text_v1(locationnote),
      salesnote=private.normalize_escaped_display_text_v1(salesnote),inventorynote=private.normalize_escaped_display_text_v1(inventorynote),
      customername=private.normalize_escaped_display_text_v1(customername),consigneename=private.normalize_escaped_display_text_v1(consigneename),
      picknote=private.normalize_escaped_display_text_v1(picknote),internalinvnote=private.normalize_escaped_display_text_v1(internalinvnote),
      tagdeptnote=private.normalize_escaped_display_text_v1(tagdeptnote)
    where concat_ws(E'\x1f',commonname,pic_note,sales_note,av_note,dock_note,flyer_notes,holdstopreason,locationnote,salesnote,inventorynote,customername,consigneename,picknote,internalinvnote,tagdeptnote) ~ $regex$\\+(['"])$regex$;
  end if;

  if exists(select 1 from public.ph_active_request where concat_ws(E'\x1f',commonname,req_customer,req_pic_note,req_sales_note,req_comments,av_note,request_note,customername,consigneename) ~ $regex$\\+(['"])$regex$) then
    update public.ph_active_request set
      commonname=private.normalize_escaped_display_text_v1(commonname),req_customer=private.normalize_escaped_display_text_v1(req_customer),
      req_pic_note=private.normalize_escaped_display_text_v1(req_pic_note),req_sales_note=private.normalize_escaped_display_text_v1(req_sales_note),
      req_comments=private.normalize_escaped_display_text_v1(req_comments),av_note=private.normalize_escaped_display_text_v1(av_note),
      request_note=private.normalize_escaped_display_text_v1(request_note),customername=private.normalize_escaped_display_text_v1(customername),
      consigneename=private.normalize_escaped_display_text_v1(consigneename)
    where concat_ws(E'\x1f',commonname,req_customer,req_pic_note,req_sales_note,req_comments,av_note,request_note,customername,consigneename) ~ $regex$\\+(['"])$regex$;
  end if;

  if exists(select 1 from public.ph_request_history where concat_ws(E'\x1f',commonname,req_customer,request_customer,req_pic_note,req_comments,av_note,customername,consigneename) ~ $regex$\\+(['"])$regex$) then
    update public.ph_request_history set
      commonname=private.normalize_escaped_display_text_v1(commonname),req_customer=private.normalize_escaped_display_text_v1(req_customer),
      request_customer=private.normalize_escaped_display_text_v1(request_customer),req_pic_note=private.normalize_escaped_display_text_v1(req_pic_note),
      req_comments=private.normalize_escaped_display_text_v1(req_comments),av_note=private.normalize_escaped_display_text_v1(av_note),
      customername=private.normalize_escaped_display_text_v1(customername),consigneename=private.normalize_escaped_display_text_v1(consigneename)
    where concat_ws(E'\x1f',commonname,req_customer,request_customer,req_pic_note,req_comments,av_note,customername,consigneename) ~ $regex$\\+(['"])$regex$;
  end if;

  if exists(select 1 from public.ph_soc_master where concat_ws(E'\x1f',commonname,dock_note,customername,consigneename,holdstopreason,salesnote,picknote,internalinvnote,tagdeptnote,pic_note,sales_note,av_note,flyer_notes) ~ $regex$\\+(['"])$regex$) then
    update public.ph_soc_master set
      commonname=private.normalize_escaped_display_text_v1(commonname),dock_note=private.normalize_escaped_display_text_v1(dock_note),
      customername=private.normalize_escaped_display_text_v1(customername),consigneename=private.normalize_escaped_display_text_v1(consigneename),
      holdstopreason=private.normalize_escaped_display_text_v1(holdstopreason),salesnote=private.normalize_escaped_display_text_v1(salesnote),
      picknote=private.normalize_escaped_display_text_v1(picknote),internalinvnote=private.normalize_escaped_display_text_v1(internalinvnote),
      tagdeptnote=private.normalize_escaped_display_text_v1(tagdeptnote),pic_note=private.normalize_escaped_display_text_v1(pic_note),
      sales_note=private.normalize_escaped_display_text_v1(sales_note),av_note=private.normalize_escaped_display_text_v1(av_note),
      flyer_notes=private.normalize_escaped_display_text_v1(flyer_notes)
    where concat_ws(E'\x1f',commonname,dock_note,customername,consigneename,holdstopreason,salesnote,picknote,internalinvnote,tagdeptnote,pic_note,sales_note,av_note,flyer_notes) ~ $regex$\\+(['"])$regex$;
  end if;

  if exists(select 1 from public.ph_reserves where concat_ws(E'\x1f',commonname,pic_note,sales_note,av_note,dock_note,flyer_notes,customername,consigneename,holdstopreason,salesnote,picknote,internalinvnote,tagdeptnote) ~ $regex$\\+(['"])$regex$) then
    update public.ph_reserves set
      commonname=private.normalize_escaped_display_text_v1(commonname),pic_note=private.normalize_escaped_display_text_v1(pic_note),
      sales_note=private.normalize_escaped_display_text_v1(sales_note),av_note=private.normalize_escaped_display_text_v1(av_note),
      dock_note=private.normalize_escaped_display_text_v1(dock_note),flyer_notes=private.normalize_escaped_display_text_v1(flyer_notes),
      customername=private.normalize_escaped_display_text_v1(customername),consigneename=private.normalize_escaped_display_text_v1(consigneename),
      holdstopreason=private.normalize_escaped_display_text_v1(holdstopreason),salesnote=private.normalize_escaped_display_text_v1(salesnote),
      picknote=private.normalize_escaped_display_text_v1(picknote),internalinvnote=private.normalize_escaped_display_text_v1(internalinvnote),
      tagdeptnote=private.normalize_escaped_display_text_v1(tagdeptnote)
    where concat_ws(E'\x1f',commonname,pic_note,sales_note,av_note,dock_note,flyer_notes,customername,consigneename,holdstopreason,salesnote,picknote,internalinvnote,tagdeptnote) ~ $regex$\\+(['"])$regex$;
  end if;

  if exists(select 1 from public.ph_cav_import where concat_ws(E'\x1f',commonname,product_description,holdstopreason,hold_reason) ~ $regex$\\+(['"])$regex$) then
    update public.ph_cav_import set
      commonname=private.normalize_escaped_display_text_v1(commonname),product_description=private.normalize_escaped_display_text_v1(product_description),
      holdstopreason=private.normalize_escaped_display_text_v1(holdstopreason),hold_reason=private.normalize_escaped_display_text_v1(hold_reason)
    where concat_ws(E'\x1f',commonname,product_description,holdstopreason,hold_reason) ~ $regex$\\+(['"])$regex$;
  end if;
end
$cleanup$;

do $verify$
begin
  if private.normalize_escaped_display_text_v1($input$Alexander\'s Great Siberian Bugloss$input$) <> $output$Alexander's Great Siberian Bugloss$output$
     or private.normalize_escaped_display_text_v1($input$Alice \\'N Wonderland Dwarf Oakleaf Hydrangea$input$) <> $output$Alice 'N Wonderland Dwarf Oakleaf Hydrangea$output$
     or private.normalize_escaped_display_text_v1($input$Endless Summer® Twist N\\\' Shout® Hydrangea$input$) <> $output$Endless Summer® Twist N' Shout® Hydrangea$output$
     or private.normalize_escaped_display_text_v1($input$Quoted \"note\"$input$) <> $output$Quoted "note"$output$ then
    raise exception using errcode='23514',message='ESCAPED_DISPLAY_TEXT_HELPER_INVALID';
  end if;
  if exists(select 1 from public.ph_master_inventory where commonname ~ $regex$\\+(['"])$regex$)
     or exists(select 1 from public.ph_active_request where commonname ~ $regex$\\+(['"])$regex$)
     or exists(select 1 from public.ph_request_history where commonname ~ $regex$\\+(['"])$regex$) then
    raise exception using errcode='23514',message='ESCAPED_COMMONNAME_CLEANUP_INCOMPLETE';
  end if;
end
$verify$;

notify pgrst,'reload schema';

commit;
