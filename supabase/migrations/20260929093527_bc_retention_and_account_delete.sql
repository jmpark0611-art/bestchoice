-- 개인정보 보관기간(2개월)과 앱 내 계정 삭제 (2026-09-29 사용자 결정)
-- 1) bc_delete_account(): 본인 익명 계정 즉시 삭제. auth.users 삭제 → bc_users/profiles 이하 전부 cascade
-- 2) bc_purge_expired(): 매일 실행
--    - 작성 후 2개월 지난 결정(답변·결과·실제 선택·이벤트·AI 요청 cascade)
--    - 2개월 지난 삭제 흔적(tombstone)
--    - 7일 지난 일일 한도 카운터

-- tombstone에 생성 시각 추가 (기존 행은 적용 시각 기준)
alter table public.bc_decision_request_tombstones
  add column created_at timestamp with time zone not null default now();

CREATE OR REPLACE FUNCTION public.bc_delete_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 delete from auth.users where id = v_user;
end $function$;

revoke execute on function public.bc_delete_account() from public, anon;
grant execute on function public.bc_delete_account() to authenticated;

CREATE OR REPLACE FUNCTION public.bc_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_decisions integer; v_tombstones integer;
begin
 delete from public.bc_decisions where created_at < now() - interval '2 months';
 get diagnostics v_decisions = row_count;
 delete from public.bc_decision_request_tombstones where created_at < now() - interval '2 months';
 get diagnostics v_tombstones = row_count;
 delete from public.bc_decision_write_limits where day < (now() at time zone 'utc')::date - 7;
 delete from public.bc_ai_user_limits where day < (now() at time zone 'utc')::date - 7;
 delete from public.bc_ai_limits where day < (now() at time zone 'utc')::date - 7;
 return jsonb_build_object('decisions', v_decisions, 'tombstones', v_tombstones);
end $function$;

revoke execute on function public.bc_purge_expired() from public, anon, authenticated;
grant execute on function public.bc_purge_expired() to service_role;

-- 매일 03:00 KST(18:00 UTC) 실행
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('bc-purge-expired', '0 18 * * *', 'select public.bc_purge_expired()');
