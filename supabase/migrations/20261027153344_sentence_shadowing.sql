-- Server-managed sentence audio; learner recordings remain on device.
create table public.analysis_sentence_guides (
 analysis_id uuid not null references public.analyses(id) on delete cascade,
 sentence_index integer not null check(sentence_index between 0 and 11),
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references public.practice_sessions(id) on delete cascade,
 input_text text not null check(length(input_text) between 1 and 2000),
 status text not null default 'processing' check(status in ('processing','ready','failed')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 audio_path text,
 worker_started_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(analysis_id,sentence_index)
);
create index sentence_guides_session_idx on public.analysis_sentence_guides(session_id);
create index sentence_guides_owner_idx on public.analysis_sentence_guides(user_id);
alter table public.analysis_sentence_guides enable row level security;
revoke all on public.analysis_sentence_guides from public,anon,authenticated;
grant select on public.analysis_sentence_guides to authenticated;
grant all on public.analysis_sentence_guides to service_role;
create policy sentence_guides_read on public.analysis_sentence_guides for select to authenticated
using(user_id=(select auth.uid()) and exists(select 1 from public.analyses a where a.id=analysis_id and a.user_id=(select auth.uid())));

create table speakloop_private.shadowing_daily_usage(
 user_id uuid not null references auth.users(id) on delete cascade,
 usage_day date not null,
 call_count integer not null default 0 check(call_count between 0 and 40),
 primary key(user_id,usage_day)
);
alter table speakloop_private.shadowing_daily_usage enable row level security;
revoke all on speakloop_private.shadowing_daily_usage from public,anon,authenticated;
grant select,insert,update on speakloop_private.shadowing_daily_usage to service_role;

create function public.reserve_sentence_guide(p_user uuid,p_analysis uuid,p_index integer,p_text text)
returns setof public.analysis_sentence_guides language plpgsql security invoker set search_path='' as $$
declare v_analysis public.analyses; v_existing public.analysis_sentence_guides; v_usage integer; v_day date := (now() at time zone 'UTC')::date;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':shadowing',0));
 select * into v_analysis from public.analyses where id=p_analysis and user_id=p_user and status='ready';
 if not found then raise sqlstate 'PT404' using message='따라할 예문을 찾을 수 없습니다.'; end if;
 if p_index is null or p_index<0 or p_index>11 or p_text is null or length(p_text)<1 or length(p_text)>2000 or coalesce(position(p_text in (v_analysis.feedback_json->>'improved_example')),0)=0 then
   raise sqlstate 'PT422' using message='연습할 문장을 확인해 주세요.';
 end if;
 select * into v_existing from public.analysis_sentence_guides where analysis_id=p_analysis and sentence_index=p_index;
 if found then
   if v_existing.input_text<>p_text then raise sqlstate 'PT409' using message='예문 정보가 바뀌었습니다.'; end if;
   if v_existing.status='ready' or (v_existing.status='processing' and v_existing.updated_at>now()-interval '3 minutes') then return next v_existing; return; end if;
   if v_existing.attempts>=3 then raise sqlstate 'PT429' using message='이 문장의 음성 재시도 한도에 도달했습니다.'; end if;
 end if;
 insert into speakloop_private.shadowing_daily_usage(user_id,usage_day) values(p_user,v_day) on conflict do nothing;
 select call_count into v_usage from speakloop_private.shadowing_daily_usage where user_id=p_user and usage_day=v_day;
 if v_usage>=40 then raise sqlstate 'PT429' using message='오늘의 문장 음성 생성 한도에 도달했습니다.'; end if;
 update speakloop_private.shadowing_daily_usage set call_count=call_count+1 where user_id=p_user and usage_day=v_day;
 if v_existing.analysis_id is not null then
   return query update public.analysis_sentence_guides set status='processing',attempts=attempts+1,worker_started_at=null,updated_at=now() where analysis_id=p_analysis and sentence_index=p_index returning *;
 else
   return query insert into public.analysis_sentence_guides(analysis_id,sentence_index,user_id,session_id,input_text)
     values(p_analysis,p_index,p_user,v_analysis.session_id,p_text) returning *;
 end if;
end $$;
revoke all on function public.reserve_sentence_guide(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_sentence_guide(uuid,uuid,integer,text) to service_role;
