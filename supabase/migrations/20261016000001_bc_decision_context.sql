-- 사용자가 고른 분야·시급도를 저장해 AI 분석에 반영 (2026-10-16, 토스 노출 정책 UX 원칙 대응)
-- 이전에는 앱이 분야·시급도를 필수로 받으면서 서버로 보내지 않아 결과에 반영되지 않았다.
-- 20261016144810(무료 한도·광고 보너스) 다음에 적용. 적용 후 decision-ai Edge Function 새 버전 배포(새 컬럼을 읽음).

alter table public.bc_decisions
  add column user_category text,
  add column urgency text,
  add constraint bc_decisions_user_category_check
    check (user_category is null or user_category in ('career','money','relationship','growth','other')),
  add constraint bc_decisions_urgency_check
    check (urgency is null or urgency in ('today','week','relaxed'));

-- 인자 2개 버전을 남기면 PostgREST 호출이 모호해지므로 삭제 후 기본값 있는 4개 인자 버전으로 교체.
-- 기존 앱(인자 2개 호출)은 기본값으로 그대로 동작한다.
drop function if exists public.bc_create_decision(uuid, text);

CREATE OR REPLACE FUNCTION public.bc_create_decision(
  p_id uuid,
  p_concern text,
  p_category text DEFAULT NULL,
  p_urgency text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid := auth.uid();
 v_existing public.bc_decisions%rowtype;
 v_day date := (now() at time zone 'UTC')::date;
 v_row public.bc_decision_write_limits%rowtype;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 if p_id is null or p_concern is null or char_length(btrim(p_concern)) not between 20 and 1000 then
  raise exception 'INVALID_INPUT' using errcode = '22023';
 end if;
 if p_category is not null and p_category not in ('career','money','relationship','growth','other') then
  raise exception 'INVALID_INPUT' using errcode = '22023';
 end if;
 if p_urgency is not null and p_urgency not in ('today','week','relaxed') then
  raise exception 'INVALID_INPUT' using errcode = '22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 if exists(select 1 from public.bc_decision_request_tombstones where id = p_id) then raise exception 'REQUEST_CONFLICT' using errcode = '22023'; end if;
 select * into v_existing from public.bc_decisions where id = p_id;
 if found then
  if v_existing.user_id <> v_user or v_existing.concern_text <> btrim(p_concern) then
   raise exception 'REQUEST_CONFLICT' using errcode = '22023';
  end if;
  return p_id;
 end if;
 insert into public.bc_users(id) values (v_user) on conflict do nothing;
 insert into public.bc_decision_write_limits(user_id, day, used) values(v_user, v_day, 0) on conflict do nothing;
 select * into v_row from public.bc_decision_write_limits where user_id = v_user and day = v_day for update;
 if v_row.used >= (select free_daily_limit from public.bc_app_settings where id = 1) + v_row.bonus then
  raise exception 'FREE_LIMIT' using errcode = 'P0001';
 end if;
 update public.bc_decision_write_limits set used = used + 1 where user_id = v_user and day = v_day;
 insert into public.bc_decisions(id, user_id, concern_text, user_category, urgency)
  values (p_id, v_user, btrim(p_concern), p_category, p_urgency);
 insert into public.bc_analytics_events(user_id, decision_id, event_name) values(v_user, p_id, 'decision_submitted');
 return p_id;
end $function$;

revoke execute on function public.bc_create_decision(uuid, text, text, text) from public, anon;
grant execute on function public.bc_create_decision(uuid, text, text, text) to authenticated;
