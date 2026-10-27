-- Run on a test database or in the same rollback transaction as shown.
begin;
do $$
declare
 u uuid; s uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 first_id uuid; second_id uuid; first_text text;
begin
 select id into u from auth.users limit 1;
 if u is null then raise exception 'Requires one existing test auth user'; end if;
 perform set_config('speakloop.test_owner',u::text,true);
 -- Keep test reservations independent of real daily usage; rolled back below.
 insert into speakloop_private.coaching_daily_usage values(u,(now() at time zone 'UTC')::date,0) on conflict(user_id,usage_day) do update set call_count=0;
 insert into public.practice_sessions(id,user_id,mode,interaction_type) values(s,u,'daily','recorded');
 insert into public.audio_uploads(id,session_id,user_id,idempotency_key,path,mime_type,size_bytes,duration_ms)
 values(a,s,u,gen_random_uuid(),u::text||'/'||s::text||'/test.m4a','audio/mp4',100,12000);
 insert into public.utterances(id,session_id,user_id,upload_id,transcript_raw,transcript_edited,stt_status)
 values(t,s,u,a,'I went to a cafe yesterday and ordered a coffee.','An edited version must never replace the original.','ready');
 select id,input_text into first_id,first_text from public.reserve_coaching(u,s,t,'s3-regression-test','test-model');
 select id into second_id from public.reserve_coaching(u,s,t,'s3-regression-test','test-model');
 if first_id<>second_id then raise exception 'Duplicate analysis reservation'; end if;
 if (select call_count from speakloop_private.coaching_daily_usage where user_id=u and usage_day=(now() at time zone 'UTC')::date)<>1 then raise exception 'Duplicate consumed daily usage'; end if;
 if first_text<>'I went to a cafe yesterday and ordered a coffee.' then raise exception 'Original input changed'; end if;
 begin
   perform public.reserve_coaching(gen_random_uuid(),s,t,'s3-regression-test','test-model');
   raise exception 'Cross-user access unexpectedly allowed';
 exception when sqlstate 'PT404' then null; end;
 update public.utterances set transcript_raw='Too short' where id=t;
 begin
   perform public.reserve_coaching(u,s,t,'short-test','test-model');
   raise exception 'Short transcript unexpectedly accepted';
 exception when sqlstate 'PT422' then null; end;
 update public.utterances set transcript_raw='I went to a cafe yesterday and ordered a coffee.' where id=t;
 delete from public.analyses where id=first_id;
 select id into first_id from public.reserve_coaching(u,s,t,'s3-regression-test','test-model');
 if (select call_count from speakloop_private.coaching_daily_usage where user_id=u and usage_day=(now() at time zone 'UTC')::date)<>2 then raise exception 'Deletion reset daily usage'; end if;
 update speakloop_private.coaching_daily_usage set call_count=20 where user_id=u and usage_day=(now() at time zone 'UTC')::date;
 begin
   perform public.reserve_coaching(u,s,t,'over-limit-test','test-model');
   raise exception 'Daily quota unexpectedly bypassed';
 exception when sqlstate 'PT429' then null; end;
 perform set_config('speakloop.test_analysis',first_id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('speakloop.test_owner'),true);
do $$ begin
 if not exists(select 1 from public.analyses where id=current_setting('speakloop.test_analysis')::uuid) then raise exception 'Owner cannot read analysis'; end if;
 if has_schema_privilege(current_user,'speakloop_private','USAGE') then raise exception 'Client can access cost counters'; end if;
 if has_function_privilege(current_user,'public.reserve_coaching(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'Client can execute provider reservation'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
do $$ begin
 if exists(select 1 from public.analyses where id=current_setting('speakloop.test_analysis')::uuid) then raise exception 'Other user can read analysis'; end if;
end $$;
rollback;
