create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  utterance_id uuid not null references public.utterances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rubric_version text not null,
  input_source text not null default 'original' check (input_source = 'original'),
  input_text text not null check (length(input_text) between 1 and 12000),
  mode text not null check (mode in ('opic','daily')),
  model text not null,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  feedback_json jsonb,
  error_code text,
  worker_started_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  audio_status text not null default 'none' check (audio_status in ('none','processing','ready','failed')),
  audio_path text,
  audio_attempts integer not null default 0 check (audio_attempts between 0 and 3),
  audio_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (utterance_id, rubric_version)
);
create index analyses_owner_created_idx on public.analyses(user_id, created_at desc);
create index analyses_session_idx on public.analyses(session_id, created_at desc);
alter table public.analyses enable row level security;
revoke all on public.analyses from anon, authenticated;
grant select on public.analyses to authenticated;
grant all on public.analyses to service_role;
create policy analyses_read on public.analyses for select to authenticated using (
 user_id = (select auth.uid()) and exists (
 select 1 from public.practice_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);

-- Serializes reservations per learner: duplicate taps return the same result,
-- failed jobs can retry, and concurrent calls cannot bypass the cost limit.
create function public.reserve_coaching(p_user uuid, p_session uuid, p_utterance uuid, p_rubric text, p_model text)
returns setof public.analyses language plpgsql security invoker set search_path = '' as $$
declare v_existing public.analyses; v_text text; v_mode text; v_duration integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
 select u.transcript_raw,s.mode,a.duration_ms into v_text,v_mode,v_duration
 from public.utterances u join public.practice_sessions s on s.id=u.session_id
 join public.audio_uploads a on a.id=u.upload_id
 where u.id=p_utterance and u.session_id=p_session and u.user_id=p_user and s.user_id=p_user and u.stt_status='ready';
 if not found then raise sqlstate 'PT404' using message='분석할 원본 전사를 찾을 수 없습니다.'; end if;
 if length(v_text)>12000 or array_length(regexp_split_to_array(trim(v_text),'\s+'),1)<8 or v_duration<3000 then
 raise sqlstate 'PT422' using message='분석할 내용이 짧습니다. 8단어 이상으로 다시 말해 주세요.'; end if;
 select * into v_existing from public.analyses where utterance_id=p_utterance and rubric_version=p_rubric;
 if found then
   if v_existing.status='ready' or (v_existing.status='processing' and v_existing.updated_at > now()-interval '3 minutes') then
     return next v_existing; return;
   end if;
   if v_existing.attempt_count>=3 then raise sqlstate 'PT429' using message='재시도 한도에 도달했습니다. 새 녹음으로 연습해 주세요.'; end if;
 end if;
 if (select coalesce(sum(attempt_count),0) from public.analyses where user_id=p_user and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= 20 then
 raise sqlstate 'PT429' using message='오늘의 코칭 한도에 도달했습니다.'; end if;
 if v_existing.id is not null then
   return query update public.analyses set status='processing',error_code=null,worker_started_at=null,attempt_count=attempt_count+1,updated_at=now() where id=v_existing.id returning *;
 else
   return query insert into public.analyses(session_id,utterance_id,user_id,rubric_version,input_text,mode,model)
    values(p_session,p_utterance,p_user,p_rubric,v_text,v_mode,p_model) returning *;
 end if;
end $$;
revoke all on function public.reserve_coaching(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_coaching(uuid,uuid,uuid,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('audio-guides','audio-guides',false,20971520,array['audio/wav']);
-- Client access is exclusively through short-lived URLs minted by the API.
