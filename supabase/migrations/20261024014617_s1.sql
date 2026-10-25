create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('opic', 'daily')),
  scenario_id uuid,
  interaction_type text not null check (interaction_type in ('recorded', 'turn')),
  status text not null default 'created' check (status in ('created', 'recording', 'processing', 'ready', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index practice_sessions_owner_created_idx on public.practice_sessions(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.practice_sessions enable row level security;
revoke all on public.profiles, public.practice_sessions from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.practice_sessions to authenticated;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy sessions_select on public.practice_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_insert on public.practice_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy sessions_update on public.practice_sessions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sessions_delete on public.practice_sessions for delete to authenticated using (user_id = (select auth.uid()));
