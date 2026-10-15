-- 수익화: 하루 무료 고민 3건 + 보상형 광고 시청 시 1건씩 추가 (2026-10-15 사용자 결정)
-- ⚠️ 광고 UI가 들어간 앱 버전이 출시되기 직전에 적용할 것.
--    먼저 적용하면 광고 UI가 없는 기존 버전 사용자는 3건 이후 FREE_LIMIT로 막힌다.
--
-- 규칙
-- - 고민 등록(bc_create_decision) 1건 = 무료 1건 소진. 하루 무료 3건(UTC 기준 날짜)
-- - 무료를 다 쓰면 FREE_LIMIT. 광고 시청 보상(bc_grant_ad_bonus)으로 하루 최대 5건까지 추가
-- - 광고 보상은 클라이언트 신고 기반이라 서버 검증 불가 → 하루 5건 상한 + 30초 간격으로 남용 억제
-- - AI 호출 사용자 한도는 고민 수 상한(3+5=8건 × 2단계)에 재시도 여유를 더해 20회로 상향

alter table public.bc_decision_write_limits
  drop constraint if exists bc_decision_write_limits_used_check;
update public.bc_decision_write_limits set used = least(used, 8);
alter table public.bc_decision_write_limits
  add column bonus integer not null default 0,
  add column last_bonus_at timestamp with time zone,
  add constraint bc_decision_write_limits_used_check check (used >= 0 and used <= 8),
  add constraint bc_decision_write_limits_bonus_check check (bonus >= 0 and bonus <= 5);

CREATE OR REPLACE FUNCTION public.bc_quota_state(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'freeLimit', 3,
    'used', coalesce(l.used, 0),
    'bonus', coalesce(l.bonus, 0),
    'remaining', greatest(0, 3 + coalesce(l.bonus, 0) - coalesce(l.used, 0)),
    'canEarnBonus', coalesce(l.bonus, 0) < 5
  )
  from (select 1) one
  left join public.bc_decision_write_limits l
    on l.user_id = p_user and l.day = (now() at time zone 'UTC')::date;
$function$;

revoke execute on function public.bc_quota_state(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bc_get_quota()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 return public.bc_quota_state(v_user);
end $function$;

revoke execute on function public.bc_get_quota() from public, anon;
grant execute on function public.bc_get_quota() to authenticated;

CREATE OR REPLACE FUNCTION public.bc_grant_ad_bonus()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid := auth.uid();
 v_day date := (now() at time zone 'UTC')::date;
 v_row public.bc_decision_write_limits%rowtype;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 insert into public.bc_users(id) values (v_user) on conflict do nothing;
 insert into public.bc_decision_write_limits(user_id, day, used) values (v_user, v_day, 0) on conflict do nothing;
 select * into v_row from public.bc_decision_write_limits where user_id = v_user and day = v_day for update;
 if v_row.bonus >= 5 then raise exception 'AD_BONUS_LIMIT' using errcode = 'P0001'; end if;
 if v_row.last_bonus_at is not null and v_row.last_bonus_at > now() - interval '30 seconds' then
  raise exception 'AD_BONUS_TOO_SOON' using errcode = 'P0001';
 end if;
 update public.bc_decision_write_limits
  set bonus = bonus + 1, last_bonus_at = now()
  where user_id = v_user and day = v_day;
 return public.bc_quota_state(v_user);
end $function$;

revoke execute on function public.bc_grant_ad_bonus() from public, anon;
grant execute on function public.bc_grant_ad_bonus() to authenticated;

-- 고민 등록: 하루 20건 → 무료 3건 + 광고 보너스
CREATE OR REPLACE FUNCTION public.bc_create_decision(p_id uuid, p_concern text)
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
 if v_row.used >= 3 + v_row.bonus then raise exception 'FREE_LIMIT' using errcode = 'P0001'; end if;
 update public.bc_decision_write_limits set used = used + 1 where user_id = v_user and day = v_day;
 insert into public.bc_decisions(id, user_id, concern_text) values (p_id, v_user, btrim(p_concern));
 insert into public.bc_analytics_events(user_id, decision_id, event_name) values(v_user, p_id, 'decision_submitted');
 return p_id;
end $function$;

-- 사용자별 AI 호출 한도 10 → 20 (고민 최대 8건 × 2단계 + 재시도 여유)
DO $do$
declare v_def text;
begin
 select pg_get_functiondef('public.bc_claim_ai(uuid, uuid, text, uuid, text)'::regprocedure) into v_def;
 -- 전체 한도(bc_ai_limits.used<100)는 건드리지 않도록 사용자 한도 구문만 정확히 교체
 if position('bc_ai_user_limits.used<10 ' in v_def) = 0 then raise exception 'bc_claim_ai 정의가 예상과 다릅니다'; end if;
 execute replace(v_def, 'bc_ai_user_limits.used<10 ', 'bc_ai_user_limits.used<20 ');
end $do$;
