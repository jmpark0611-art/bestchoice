-- 1) AI 실패 후 재시도 허용
--    - 실패(failed)한 단계, 또는 2분 넘게 running에 머문 단계(함수 강제 종료 등)는 다시 claim 가능
--    - 재시도 시 요청 행을 새 request_id/hash로 초기화하고 결정 상태를 해당 단계로 되돌림
-- 2) 사용자별 AI 일일 한도 추가 (전체 한도 100회는 비용 상한으로 유지)
--    - 사용자당 하루 10회(= 확인 질문+분석 5건). 재시도도 1회로 셈
--    - 초과 시 'AI_LIMIT_USER' 예외. decision-ai는 'AI_LIMIT' 포함 여부로 매핑하므로 클라이언트에는 AI_LIMIT로 전달됨

create table public.bc_ai_user_limits (
  user_id uuid not null references public.bc_users(id) on delete cascade,
  day date not null,
  used integer not null check (used >= 0),
  primary key (user_id, day)
);
alter table public.bc_ai_user_limits enable row level security;
revoke all on public.bc_ai_user_limits from anon, authenticated;
grant select, insert, update, delete on public.bc_ai_user_limits to service_role;

CREATE OR REPLACE FUNCTION public.bc_claim_ai(p_user uuid, p_id uuid, p_stage text, p_request uuid, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d public.bc_decisions;
 r public.bc_ai_requests;
 v_day date := (now() at time zone 'utc')::date;
 v_retry boolean := false;
 n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into d from public.bc_decisions where id=p_id and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_stage not in ('clarify','analyze') then raise exception 'INVALID_STAGE'; end if;

 select * into r from public.bc_ai_requests where decision_id=p_id and stage=p_stage for update;
 if found then
  if r.state='failed' or (r.state='running' and r.created_at < now() - interval '2 minutes') then
   v_retry := true;
  else
   if r.input_hash<>p_hash then raise exception 'INPUT_CONFLICT'; end if;
   return jsonb_build_object('state',r.state,'output',r.output);
  end if;
 end if;

 if v_retry then
  -- 이전 시도가 남긴 상태(failed/analyzing)는 이 단계를 다시 시작할 수 있는 상태로 간주
  if d.status not in ('failed','analyzing', case when p_stage='clarify' then 'draft' else 'clarifying' end) then
   raise exception 'INVALID_STAGE';
  end if;
  if p_stage='analyze' and d.clarification_json is null then raise exception 'INVALID_STAGE'; end if;
 elsif (p_stage='clarify' and d.status<>'draft') or (p_stage='analyze' and d.status<>'clarifying') then
  raise exception 'INVALID_STAGE';
 end if;

 -- 사용자별 한도 → 전체 한도 순. 하나라도 초과하면 예외로 트랜잭션 전체 롤백
 insert into public.bc_ai_user_limits(user_id,day,used) values (p_user,v_day,1)
 on conflict(user_id,day) do update set used=public.bc_ai_user_limits.used+1
  where public.bc_ai_user_limits.used<10 returning used into n;
 if n is null then raise exception 'AI_LIMIT_USER'; end if;
 n := null;
 insert into public.bc_ai_limits values (v_day,1)
 on conflict(day) do update set used=public.bc_ai_limits.used+1 where public.bc_ai_limits.used<100 returning used into n;
 if n is null then raise exception 'AI_LIMIT'; end if;

 if v_retry then
  update public.bc_ai_requests
   set request_id=p_request, input_hash=p_hash, state='running', output=null, created_at=now()
   where decision_id=p_id and stage=p_stage;
 else
  insert into public.bc_ai_requests(decision_id,stage,request_id,input_hash) values(p_id,p_stage,p_request,p_hash);
 end if;
 update public.bc_decisions
  set status = case when p_stage='analyze' then 'analyzing' else 'draft' end
  where id=p_id;
 return jsonb_build_object('state','claimed');
end $function$;

revoke execute on function public.bc_claim_ai(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.bc_claim_ai(uuid, uuid, text, uuid, text) to service_role;
