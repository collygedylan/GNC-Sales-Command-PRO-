-- @test-runtime: canonical
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(11);
create temp table v2314_source(source_identity text primary key, physical_row integer unique not null, itemcode text, locationcode text, lotcode text, suspend text, suspend_to text);
insert into v2314_source values
('87c2708dcce39882964e7e07b73303d708bed81a62fd1339d4ef78ea2101a45b',731,'003129.030.1','G.22.000','27.F1','SUSPEND','dc'),
('ab3ea497da3550f4cedf350c96f3252b15a2dad888da31635d013b733bcc6b21',751,'001667.030.1','0.00.111','27.F1','SUSPEND','dc'),
('e03b4a8c1122090f61770e7bb03e399c954bc189cb100c44291ccb0dbfaab6c0',1235,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('1906848cd4d54b4922b8628d29a1ea4f8c697cd7e6bac5700203ab6a0b1a44b8',2433,'001667.010.1','E.23.000','27.F1','SUSPEND','dc'),
('efab927724d9858e6a5632dc700ab1dbad57b6675e367a8aad042da4e5990e86',8268,'003129.020.1','E.07.000','27.F1','SUSPEND','dc'),
('97b60c703c42a110f98e5e2a2e1b0ca9ed7dbb7a5f3790bb55d3358cbf634367',25874,'009005.031.1','F.14.000','27.F1','SUSPEND','dc'),
('c59fe973f2e813761341d97ad0602bcabf14cd0f5ce1a240eb5381537f0e8f8a',25876,'008737.031.1','D.11.000','27.F1','SUSPEND','dc'),
('efd5c69b65478b214929afcd19e527f661c83d92472e9666667a313fa4f0956f',26273,'004502.010.1','F.19.000','27.F1','SUSPEND','dc'),
('35d9c5b5fa1bd042afe42dceee548061d5f774794e7e705562853fbbcf08d723',26814,'003129.030.1','G.22.000','27.F1','SUSPEND','dc'),
('9b6e8b82165e251b9afd580bcd0c351cb6bcd3b5d15dd2e04299ffefb8b19f6f',26884,'005693.011.1','B.04.000','27.F1','SUSPEND','dc'),
('4f24df6b55d979fd6f35d284f6bd86f0fc2e7876380ff2427684251dc817e72c',26885,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('5decd899d44079c9037a02f651b74af93f5638feab4c5622ddc6ec7faf198892',27385,'006009.031.1','0.00.111','27.F1','SUSPEND','dc'),
('36a9f9f5a7fa585bd2cb62f0b9449195576d62978188c49c5016215a4f20af94',27386,'006408.031.1','0.00.111','27.F1','SUSPEND','dc'),
('e4b2298fc345994806b6c5d2aecd55ee16036b7d8dc58b344f28c75e617aa32f',27404,'009373.031.1','F.14.000','27.F1','SUSPEND','dc'),
('3a566dbcdb75c348f34728d6546008ea0ea32c7d5c42452346b55d64d09321a3',27405,'004207.031.1','F.14.000','27.F1','SUSPEND','dc'),
('ef96cd45305eda2be2d28c1ebf5bf655d55e6476f8ec7991a38a56cc841f7c26',27425,'004733.020.1','F.19.000','27.F1','SUSPEND','dc'),
('1917f4e83f9e65a84bf6e181c17eccdc4692563d0f91ebc23db5b67a772982ee',29013,'003085.030.1','D.12.000','26.F1','SUSPEND','dc'),
('1a3ca3c5991f0882df3b3bbca5bc4e4ad9a2c46e26acb360905529975fcbcbd2',29124,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('8db4645d3d592da5695ea353afffd3a07f1f23ceb9461899b8f74642536076bb',29918,'004207.031.1','0.00.111','27.F1','SUSPEND','dc'),
('7ceda9d07c14eac5ccc7439a9b5924b46e150948fb83165e86a43f93ea150261',30834,'006009.031.1','0.00.111','27.F1','SUSPEND','dc'),
('5f1121bd145813a54edd26da8416e8e9cee80bfc2674722099786f6435752e3e',30875,'008737.051.1','0.00.111','27.F1','SUSPEND','dc'),
('00bbd30963462d0dfe44c40aeff3ed9c518f936e29a71fa7fb77c0959131f192',30876,'004207.031.1','0.00.111','27.F1','SUSPEND','dc'),
('8f4cb5ac095eeda56fca927567b69b1002455a867cd9eefb0a5cd25dfd4e1793',30877,'003129.050.1','0.00.111','27.F1','SUSPEND','dc'),
('56d1e469cb69bb86babc373f771d999bc116c2052d2c81d26ce72aca408b47d1',30881,'004104.030.1','H.06.000','27.F1','SUSPEND','dc'),
('de8e7b25ff2433372b390d1ac14201b84aa18b67134e7127029305d41274dc5b',30907,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('f9287fb9d5b1b47b8186a33370c543fa6dd92a98af834d7aa3e87ededae99b92',30926,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('817e3b3c5aa7fbc03943c92d8dcb37ce9e202cba314ae96ff409a8f54da77735',30928,'004450.010.1','0.00.111','27.F1','SUSPEND','dc'),
('84c0008c480add57098ddc5d2f19b441fd30272dd195d04484a721d1571d6b7a',30931,'001973.030.1','C.16.000','27.F1','SUSPEND','dc'),
('e09a3600bfb50de99134a17fb38dca0a8d379dc8561c42ce506e5c8ae40bed47',30934,'008344.031.1','C.15.000','27.F1','SUSPEND','dc'),
('7e0cd0102439ae9fc309c55152044bbe2c59d62be8af03dc607c607a51aed986',30951,'005693.011.1','B.04.000','27.F1','SUSPEND','dc'),
('51deb3978847b405c0101ed800db80e3fd542b7c8131ab971adf2c09052ae9c8',30952,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('7cdf8e9a21c10e915d3bcb6773b83aef41734ef594129e9924cfc86f98ba4a1a',30956,'003566.031.1','0.00.111','27.F1','SUSPEND','dc'),
('63a618dd5c116d5f782404926769884b80873db73bf7a1a43652050a74503705',31460,'009373.031.1','F.14.000','27.F1','SUSPEND','dc'),
('f3add118aea69996f43eb7803af2224523245535bc4c8814bca5689bd29e44d8',32466,'003085.030.1','D.12.000','26.F1','SUSPEND','dc'),
('017f1f62045ffd0963d996490d150217f273a45fff80ec30452f446344339470',32503,'004380.010.1','C.09.000','27.F1','SUSPEND','dc'),
('f665313e58ef3d9e72a5b4afb77527aefa77c5f3e29421b5f24c9a85d946bdf3',32599,'006489.021.1','G.24.000','27.F1','SUSPEND','dc'),
('262f844b2c1645b3030dd836259e4db17e2a36bfa803668fbd81534d845aa2aa',32867,'001668.030.1','D.26.000','27.F1','SUSPEND','dc');
select is((select count(*)::integer from v2314_source),37,'37 flagged DC physical source rows are fixture-backed');
select is((select count(distinct source_identity)::integer from v2314_source),37,'physical rows retain distinct Code.gs identity digests');
select is((select count(distinct physical_row)::integer from v2314_source),37,'each imported candidate maps to one physical source line');
select is((select count(*)::integer from v2314_source where suspend_tag_private.eligible(suspend,suspend_to)),37,'existing backend eligibility exposes all 37 flagged DC rows');
select is((select count(*)::integer from v2314_source where suspend_tag_private.eligible(null,suspend_to)),0,'blank Suspend flags remain ineligible');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('11111111-1111-4111-8111-111111111111','suspend-fixture@example.invalid','{}','{}');
insert into public.profiles(id,username,role,must_change_password) values ('11111111-1111-4111-8111-111111111111','dylan_collyge','Admin',false);
insert into auth.sessions(id,user_id,not_after) values ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',now()+interval '1 day');
insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to,itemcode,locationcode,lotcode,holdstopcode,dock_photo_link,match)
select source_identity,'2026-10-20T13:00:00Z'::timestamptz,suspend,suspend_to,itemcode,locationcode,lotcode,'S','fixture-photo','100'
from v2314_source;
select is((select count(*)::integer from public.ph_soc_master where suspend_tag_private.eligible(suspend,suspend_to) and date_completed is null),37,'all 37 distinct physical tagged source rows persist as separate cards');
select set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','session_id','11111111-1111-4111-8111-111111111111','role','authenticated','iss','https://kzrnyjsosryejjejliii.supabase.co/auth/v1','exp',extract(epoch from now())+3600)::text,true);
set local role authenticated;
select ok((public.complete_suspend_tag_v1('87c2708dcce39882964e7e07b73303d708bed81a62fd1339d4ef78ea2101a45b','2026-10-20T13:00:00Z'::timestamptz,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'ok')::boolean,'Done uses the authenticated completion RPC for exactly one physical row');
reset role;
select is((select count(*)::integer from public.ph_soc_master where suspend_tag_private.eligible(suspend,suspend_to) and date_completed is not null),1,'Done marks exactly its source identity completed');
select is((select count(*)::integer from public.ph_soc_master where suspend_tag_private.eligible(suspend,suspend_to) and date_completed is null),36,'the other 36 source rows remain independently pending');
create temp table v2314_completion_witness as select unique_id,date_completed from public.ph_soc_master where unique_id='87c2708dcce39882964e7e07b73303d708bed81a62fd1339d4ef78ea2101a45b';
insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to,itemcode,locationcode,lotcode)
select source_identity,'2026-10-20T13:00:00Z'::timestamptz,suspend,suspend_to,itemcode,locationcode,lotcode from v2314_source
on conflict(unique_id) do update set suspend=excluded.suspend,suspend_to=excluded.suspend_to,itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode;
select is((select count(*)::integer from public.ph_soc_master where suspend_tag_private.eligible(suspend,suspend_to)),37,'replayed source snapshot creates no duplicate physical rows');
select is((select s.date_completed=w.date_completed from public.ph_soc_master s join v2314_completion_witness w using(unique_id)),true,'source replay omitting app-owned date_completed preserves completion');
select * from finish();
rollback;

