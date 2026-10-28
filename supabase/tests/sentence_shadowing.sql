begin;
do $$
declare a public.analyses; r public.analysis_sentence_guides; v_before integer; v_after integer; v_count integer;
begin
 select * into a from public.analyses where status='ready' and feedback_json->>'improved_example' is not null limit 1;
 if not found then raise exception 'A ready coaching fixture is required'; end if;
 select coalesce((select call_count from speakloop_private.shadowing_daily_usage where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date),0) into v_before;
 -- Use an unused test index and roll back all changes.
 delete from public.analysis_sentence_guides where analysis_id=a.id and sentence_index in (10,11);
 update speakloop_private.shadowing_daily_usage set call_count=0 where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date;
 select * into r from public.reserve_sentence_guide(a.user_id,a.id,11,a.feedback_json->>'improved_example');
 if r.status<>'processing' or r.attempts<>1 then raise exception 'reservation failed'; end if;
 perform public.reserve_sentence_guide(a.user_id,a.id,11,a.feedback_json->>'improved_example');
 select call_count into v_after from speakloop_private.shadowing_daily_usage where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date;
 if v_after<>1 then raise exception 'duplicate consumed quota'; end if;
 update public.analysis_sentence_guides set worker_started_at=now() where analysis_id=a.id and sentence_index=11 and worker_started_at is null;
 update public.analysis_sentence_guides set worker_started_at=now() where analysis_id=a.id and sentence_index=11 and worker_started_at is null;
 get diagnostics v_count=row_count;
 if v_count<>0 then raise exception 'duplicate worker claimed'; end if;
 begin
  perform public.reserve_sentence_guide('00000000-0000-0000-0000-000000000099',a.id,11,a.feedback_json->>'improved_example');
  raise exception 'other owner accepted';
 exception when sqlstate 'PT404' then null; end;
 delete from public.analysis_sentence_guides where analysis_id=a.id and sentence_index=11;
 select call_count into v_after from speakloop_private.shadowing_daily_usage where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date;
 if v_after<>1 then raise exception 'deletion reset usage'; end if;
 update speakloop_private.shadowing_daily_usage set call_count=40 where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date;
 begin
  perform public.reserve_sentence_guide(a.user_id,a.id,10,a.feedback_json->>'improved_example');
  raise exception 'quota bypassed';
 exception when sqlstate 'PT429' then null; end;
 if has_function_privilege('authenticated','public.reserve_sentence_guide(uuid,uuid,integer,text)','EXECUTE') or has_function_privilege('anon','public.reserve_sentence_guide(uuid,uuid,integer,text)','EXECUTE') then raise exception 'client can reserve'; end if;
 if has_table_privilege('authenticated','public.analysis_sentence_guides','INSERT') then raise exception 'client can write'; end if;
 update speakloop_private.shadowing_daily_usage set call_count=0 where user_id=a.user_id and usage_day=(now() at time zone 'UTC')::date;
 perform public.reserve_sentence_guide(a.user_id,a.id,11,a.feedback_json->>'improved_example');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.analysis_sentence_guides) then raise exception 'RLS leaked sentence guide'; end if;
end $$;
reset role;
select 'shadowing reservation, worker, owner, RLS, quota, deletion checks passed' as result;
rollback;
