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
 insert into public.practice_sessions(id,user_id,mode,interaction_type) values(s,u,'daily','recorded');
 insert into public.audio_uploads(id,session_id,user_id,idempotency_key,path,mime_type,size_bytes,duration_ms)
 values(a,s,u,gen_random_uuid(),u::text||'/'||s::text||'/test.m4a','audio/mp4',100,12000);
 insert into public.utterances(id,session_id,user_id,upload_id,transcript_raw,transcript_edited,stt_status)
 values(t,s,u,a,'I went to a cafe yesterday and ordered a coffee.','An edited version must never replace the original.','ready');
 select id,input_text into first_id,first_text from public.reserve_coaching(u,s,t,'s3-regression-test','test-model');
 select id into second_id from public.reserve_coaching(u,s,t,'s3-regression-test','test-model');
 if first_id<>second_id then raise exception 'Duplicate analysis reservation'; end if;
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
 perform set_config('speakloop.test_analysis',first_id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('speakloop.test_owner'),true);
do $$ begin
 if not exists(select 1 from public.analyses where id=current_setting('speakloop.test_analysis')::uuid) then raise exception 'Owner cannot read analysis'; end if;
 if has_function_privilege(current_user,'public.reserve_coaching(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'Client can execute provider reservation'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
do $$ begin
 if exists(select 1 from public.analyses where id=current_setting('speakloop.test_analysis')::uuid) then raise exception 'Other user can read analysis'; end if;
end $$;
rollback;
