begin;
do $$
declare u uuid; s uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); us public.analyses; gb public.analyses; duplicate_us public.analyses;
begin
 select id into u from auth.users limit 1;
 if u is null then raise exception 'Requires one test auth user'; end if;
 insert into speakloop_private.coaching_daily_usage values(u,(now() at time zone 'UTC')::date,0) on conflict(user_id,usage_day) do update set call_count=0;
 insert into public.practice_sessions(id,user_id,mode,interaction_type) values(s,u,'daily','recorded');
 insert into public.audio_uploads(id,session_id,user_id,idempotency_key,path,mime_type,size_bytes,duration_ms,checksum)
 values(a,s,u,gen_random_uuid(),u::text||'/'||s::text||'/test.m4a','audio/mp4',100,12000,repeat('a',64));
 insert into public.utterances(id,session_id,user_id,upload_id,transcript_raw,transcript_edited,stt_status)
 values(t,s,u,a,'I went to a cafe yesterday and ordered a coffee.','A rewritten answer must not replace the original.','ready');
 select * into us from public.reserve_audio_coaching(u,s,t,'s3-audio-v1:en-US','test-model','en-US');
 select * into gb from public.reserve_audio_coaching(u,s,t,'s3-audio-v1:en-GB','test-model','en-GB');
 select * into duplicate_us from public.reserve_audio_coaching(u,s,t,'s3-audio-v1:en-US','test-model','en-US');
 if us.id=gb.id or us.id<>duplicate_us.id then raise exception 'Accent cache isolation failed'; end if;
 if gb.accent<>'en-GB' or gb.input_source<>'audio_original' or gb.audio_checksum<>repeat('a',64) or gb.audio_duration_ms<>12000 then raise exception 'Audio snapshot incomplete'; end if;
 if gb.input_text<>'I went to a cafe yesterday and ordered a coffee.' then raise exception 'Edited text used'; end if;
 if (select call_count from speakloop_private.coaching_daily_usage where user_id=u and usage_day=(now() at time zone 'UTC')::date)<>2 then raise exception 'Duplicate charged daily quota'; end if;
 begin
   perform public.reserve_audio_coaching(gen_random_uuid(),s,t,'s3-audio-v1:en-US','test-model','en-US');
   raise exception 'Cross-user recording access allowed';
 exception when sqlstate 'PT404' then null; end;
 begin
   perform public.reserve_audio_coaching(u,s,t,'s3-audio-v1:invalid','test-model','invalid');
   raise exception 'Invalid accent accepted';
 exception when sqlstate 'PT422' then null; end;
 if has_function_privilege('authenticated','public.reserve_audio_coaching(uuid,uuid,uuid,text,text,text)','EXECUTE') then raise exception 'Client can reserve audio analysis'; end if;
end $$;
rollback;
