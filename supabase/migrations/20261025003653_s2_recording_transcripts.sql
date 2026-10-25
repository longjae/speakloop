create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('opic', 'daily')),
  level text not null check (level in ('beginner', 'intermediate')),
  title text not null,
  prompt text not null,
  goals text[] not null default '{}',
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index scenarios_active_mode_level_idx on public.scenarios (mode, level, title) where active;

insert into public.scenarios (id, mode, level, title, prompt, goals) values
  ('d24b1e46-7f44-4677-bd03-1a9cc6a609d1', 'opic', 'beginner', '자기소개', 'Please introduce yourself and describe what you do on a typical day.', array['자기소개하기', '일과 설명하기']),
  ('be4d3ee0-fce7-4f0b-893e-a7605962d77a', 'opic', 'intermediate', '기억에 남는 여행', 'Tell me about a memorable trip. Where did you go, and what happened?', array['과거 경험 설명하기', '느낌 표현하기']),
  ('0aa810fb-f297-4b02-9550-2ce9055ddbe4', 'daily', 'beginner', '카페에서 주문하기', 'You are at a cafe. Order a drink and ask one question about the menu.', array['정중하게 주문하기', '질문하기']),
  ('5fe3bc6d-99c9-4643-9c5c-223f9cbced0d', 'daily', 'intermediate', '일정 변경 요청', 'You need to reschedule a meeting. Explain why and suggest a new time.', array['상황 설명하기', '대안 제안하기']);

alter table public.practice_sessions
  add constraint practice_sessions_scenario_id_fkey foreign key (scenario_id) references public.scenarios(id),
  add column scenario_version integer;

create table public.audio_uploads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  path text not null unique,
  mime_type text not null check (mime_type = 'audio/mp4'),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  duration_ms integer not null check (duration_ms between 1000 and 120000),
  checksum text check (checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index audio_uploads_session_idx on public.audio_uploads (session_id, created_at desc);

create table public.utterances (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id uuid not null unique references public.audio_uploads(id) on delete cascade,
  turn_index integer not null default 0 check (turn_index >= 0),
  transcript_raw text,
  transcript_edited text,
  stt_status text not null default 'pending' check (stt_status in ('pending', 'processing', 'ready', 'empty', 'failed', 'unavailable')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index utterances_session_idx on public.utterances (session_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 10485760, array['audio/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.scenarios enable row level security;
alter table public.audio_uploads enable row level security;
alter table public.utterances enable row level security;
revoke all on public.scenarios, public.audio_uploads, public.utterances from anon, authenticated;
grant select on public.scenarios to authenticated;
grant select, insert on public.audio_uploads to authenticated;
grant select on public.utterances to authenticated;

create policy scenarios_read on public.scenarios for select to authenticated using (active);
create policy audio_uploads_read on public.audio_uploads for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.practice_sessions s where s.id = session_id and s.user_id = (select auth.uid())));
create policy audio_uploads_insert on public.audio_uploads for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.practice_sessions s where s.id = session_id and s.user_id = (select auth.uid())));
create policy utterances_read on public.utterances for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.practice_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

create policy recordings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and exists (
    select 1 from public.audio_uploads a
    where a.path = name and a.user_id = (select auth.uid())
      and a.session_id::text = (storage.foldername(name))[2]
      and a.user_id::text = (storage.foldername(name))[1]
  ));
create policy recordings_read on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy recordings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
