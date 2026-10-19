-- Disposable canonical replay fixture only; all identities and mailboxes are synthetic.
do $$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.profiles where lower(username) in
       ('dan_mccuistion','dylan_collyge','megan_kelly','jd_jones')) then
    raise exception 'V2311_SYNTHETIC_RECIPIENT_FIXTURE_PRECONDITION_FAILED';
  end if;
end;
$$;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a9110000-0000-4000-8000-000000000001','authenticated','authenticated','dan_mccuistion@fixture.invalid','',now(),'{}','{}',now(),now()),
 ('a9110000-0000-4000-8000-000000000002','authenticated','authenticated','dylan_collyge@fixture.invalid','',now(),'{}','{}',now(),now()),
 ('a9110000-0000-4000-8000-000000000003','authenticated','authenticated','megan_kelly@fixture.invalid','',now(),'{}','{}',now(),now()),
 ('a9110000-0000-4000-8000-000000000004','authenticated','authenticated','jd_jones@fixture.invalid','',now(),'{}','{}',now(),now());

insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('a9110000-0000-4000-8000-000000000001','dan_mccuistion','Synthetic Dan','Admin',false),
 ('a9110000-0000-4000-8000-000000000002','dylan_collyge','Synthetic Dylan','Admin',false),
 ('a9110000-0000-4000-8000-000000000003','megan_kelly','Synthetic Megan','Admin',false),
 ('a9110000-0000-4000-8000-000000000004','jd_jones','Synthetic JD','USER',false);
