-- Run after the S1 migration in a disposable PostgreSQL database with auth.uid().
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.practice_sessions(id, user_id, mode, interaction_type)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'opic', 'recorded');
insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000001');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
begin
  if exists(select 1 from public.practice_sessions where id = '10000000-0000-0000-0000-000000000001') then
    raise exception 'B can read A session';
  end if;
  if exists(select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'B can read A profile';
  end if;
  update public.practice_sessions set status = 'ready' where id = '10000000-0000-0000-0000-000000000001';
  if found then raise exception 'B can update A session'; end if;
  delete from public.practice_sessions where id = '10000000-0000-0000-0000-000000000001';
  if found then raise exception 'B can delete A session'; end if;
  begin
    insert into public.practice_sessions(user_id, mode, interaction_type)
    values ('00000000-0000-0000-0000-000000000001', 'daily', 'recorded');
    raise exception 'B can insert A session';
  exception when insufficient_privilege then null;
  end;
end $$;
