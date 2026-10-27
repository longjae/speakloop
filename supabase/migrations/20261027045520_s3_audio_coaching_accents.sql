alter table public.analyses drop constraint analyses_input_source_check;
alter table public.analyses add constraint analyses_input_source_check check(input_source in ('original','audio_original'));
alter table public.analyses
 add column accent text not null default 'en-US' check(accent in ('en-US','en-GB')),
 add column audio_checksum text check(audio_checksum ~ '^[0-9a-f]{64}$'),
 add column audio_duration_ms integer check(audio_duration_ms between 1000 and 120000);

create function public.reserve_audio_coaching(p_user uuid, p_session uuid, p_utterance uuid, p_rubric text, p_model text, p_accent text)
returns setof public.analyses language plpgsql security invoker set search_path = '' as $$
declare v_existing public.analyses; v_text text; v_mode text; v_duration integer; v_checksum text;
begin
 if p_accent not in ('en-US','en-GB') or p_rubric <> 's3-audio-v1:'||p_accent then raise sqlstate 'PT422' using message='지원하지 않는 발음 기준입니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
 select u.transcript_raw,s.mode,a.duration_ms,a.checksum into v_text,v_mode,v_duration,v_checksum
 from public.utterances u join public.practice_sessions s on s.id=u.session_id
 join public.audio_uploads a on a.id=u.upload_id
 where u.id=p_utterance and u.session_id=p_session and u.user_id=p_user and s.user_id=p_user and u.stt_status='ready';
 if not found then raise sqlstate 'PT404' using message='분석할 원본 전사를 찾을 수 없습니다.'; end if;
 if v_checksum is null then raise sqlstate 'PT422' using message='전사한 녹음을 확인할 수 없습니다.'; end if;
 if length(v_text)>12000 or array_length(regexp_split_to_array(trim(v_text),'\s+'),1)<8 or v_duration<3000 then
 raise sqlstate 'PT422' using message='분석할 내용이 짧습니다. 8단어 이상으로 다시 말해 주세요.'; end if;
 select * into v_existing from public.analyses where utterance_id=p_utterance and rubric_version=p_rubric;
 if found then
   if v_existing.status='ready' or (v_existing.status='processing' and v_existing.updated_at > now()-interval '3 minutes') then
     return next v_existing; return;
   end if;
   if v_existing.attempt_count>=3 then raise sqlstate 'PT429' using message='재시도 한도에 도달했습니다. 새 녹음으로 연습해 주세요.'; end if;
 end if;
 insert into speakloop_private.coaching_daily_usage(user_id,usage_day,call_count)
 values(p_user,(now() at time zone 'UTC')::date,0) on conflict do nothing;
 update speakloop_private.coaching_daily_usage set call_count=call_count+1
 where user_id=p_user and usage_day=(now() at time zone 'UTC')::date and call_count<20;
 if not found then raise sqlstate 'PT429' using message='오늘의 코칭 한도에 도달했습니다.'; end if;
 if v_existing.id is not null then
   return query update public.analyses set status='processing',error_code=null,worker_started_at=null,model=p_model,attempt_count=attempt_count+1,updated_at=now() where id=v_existing.id returning *;
 else
   return query insert into public.analyses(session_id,utterance_id,user_id,rubric_version,input_text,mode,model,input_source,accent,audio_checksum,audio_duration_ms)
    values(p_session,p_utterance,p_user,p_rubric,v_text,v_mode,p_model,'audio_original',p_accent,v_checksum,v_duration) returning *;
 end if;
end $$;

revoke all on function public.reserve_audio_coaching(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_audio_coaching(uuid,uuid,uuid,text,text,text) to service_role;
