-- REVIEWED ADDITIVE RELEASE BODY; not a CLI-generated migration filename.
-- Derives from supabase/proposals/vs-report-result.sql at SHA-256 c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c.
-- Original proposal unchanged; only release preamble and outer transaction control differ.
-- The migration runner must own the transaction for both DDL and migration history.
-- Apply only through the parent's explicitly approved operational migration process.
-- Existing VS tables/functions, vs-decide, cron and application rows are not altered here.

do $release_guard$
begin
  -- Catalog-only prerequisites. Do not read application rows or change existing objects.
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') or
     not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    raise exception 'RELEASE_REQUIRED_ROLES_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure('auth.uid()')
      and prorettype = 'pg_catalog.uuid'::pg_catalog.regtype and prokind = 'f') then
    raise exception 'RELEASE_AUTH_UID_CONTRACT_REQUIRED';
  end if;
  if exists (
    select 1 from (values
      ('auth.users', 'id', 'pg_catalog.uuid'),
      ('public.vs_polls', 'id', 'pg_catalog.uuid'),
      ('public.vs_polls', 'user_id', 'pg_catalog.uuid'),
      ('public.vs_polls', 'share_code', 'pg_catalog.text'),
      ('public.vs_votes', 'poll_id', 'pg_catalog.uuid'),
      ('public.vs_votes', 'voter_id', 'pg_catalog.uuid')
    ) as expected(relation_name, column_name, type_name)
    left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass(expected.relation_name)
    left join pg_catalog.pg_attribute a on a.attrelid = c.oid
      and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    where c.oid is null or c.relkind <> 'r' or a.attnum is null or
      a.atttypid <> pg_catalog.to_regtype(expected.type_name)
  ) then
    raise exception 'RELEASE_VS_COLUMN_CONTRACT_REQUIRED';
  end if;
  if exists (select 1 from pg_catalog.pg_class
    where oid in (pg_catalog.to_regclass('public.vs_polls'), pg_catalog.to_regclass('public.vs_votes'))
      and not relrowsecurity) then
    raise exception 'RELEASE_EXISTING_VS_RLS_REQUIRED';
  end if;
  if pg_catalog.to_regnamespace('genie_reporting_private') is not null then
    raise exception 'RELEASE_NEW_SCHEMA_ALREADY_EXISTS';
  end if;
  -- Reject any same-name public overload, not just the intended exact signature.
  if exists (select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('vs_report_result')) then
    raise exception 'RELEASE_PUBLIC_RPC_NAME_COLLISION';
  end if;
end
$release_guard$;

-- A new non-exposed schema keeps reports and the privileged implementation out of public.
-- CREATE (not CREATE OR REPLACE / IF NOT EXISTS) prevents silently modifying prior objects.
create schema genie_reporting_private;
revoke all on schema genie_reporting_private from public, anon, authenticated;
grant usage on schema genie_reporting_private to authenticated;

create table genie_reporting_private.result_reports (
  receipt_id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  poll_id uuid not null references public.vs_polls(id) on delete cascade,
  category text not null check (category in ('unsafe', 'incorrect', 'privacy', 'other')),
  details text not null check (char_length(details) <= 200 and octet_length(details) <= 800),
  consent_version text not null check (consent_version = 'report-v1'),
  received_at timestamptz not null default now(),
  unique (reporter_id, request_id)
);
create index result_reports_poll_idx on genie_reporting_private.result_reports(poll_id);
create index result_reports_received_idx on genie_reporting_private.result_reports(received_at);

create table genie_reporting_private.user_daily_limits (
  reporter_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null check (used between 0 and 10),
  primary key (reporter_id, day)
);
create index report_user_limits_day_idx on genie_reporting_private.user_daily_limits(day);
create table genie_reporting_private.daily_limits (
  day date primary key,
  used integer not null check (used between 0 and 500)
);

alter table genie_reporting_private.result_reports enable row level security;
alter table genie_reporting_private.user_daily_limits enable row level security;
alter table genie_reporting_private.daily_limits enable row level security;
revoke all on genie_reporting_private.result_reports,
  genie_reporting_private.user_daily_limits, genie_reporting_private.daily_limits
  from public, anon, authenticated;
-- Deliberately no client table policies, reads, inserts or report-listing RPC.

create function genie_reporting_private.submit_result_report(
  p_request_id uuid,
  p_category text,
  p_details text,
  p_consent boolean,
  p_poll_id uuid,
  p_share_code text
) returns jsonb
language plpgsql security definer set search_path = ''
as $report$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'UTC')::date;
  v_poll public.vs_polls%rowtype;
  v_report genie_reporting_private.result_reports%rowtype;
  v_details text := btrim(coalesce(p_details, ''));
  v_used integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or p_consent is distinct from true or p_category is null or
    p_category not in ('unsafe', 'incorrect', 'privacy', 'other') or
    char_length(v_details) > 200 or octet_length(v_details) > 800 or
    (p_poll_id is null and p_share_code is null) or
    (p_poll_id is not null and p_share_code is not null) or
    (p_share_code is not null and p_share_code !~ '^[A-Za-z0-9_-]{1,128}$') then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;

  if p_poll_id is not null then
    select p.* into v_poll from public.vs_polls p
      where p.id = p_poll_id and p.user_id = v_user for key share;
  else
    -- Knowing a link alone is not permission to report the still-hidden AI result.
    select p.* into v_poll from public.vs_polls p
      where p.share_code = p_share_code
        and exists (select 1 from public.vs_votes v where v.poll_id = p.id and v.voter_id = v_user)
      for key share;
  end if;
  if not found then raise exception 'REPORT_NOT_ALLOWED' using errcode = '42501'; end if;

  -- Serialize a reporter's submissions so parallel retries cannot consume two quota slots.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('genie-result-report:' || v_user::text, 0));
  select * into v_report from genie_reporting_private.result_reports
    where reporter_id = v_user and request_id = p_request_id;
  if found then
    if v_report.poll_id <> v_poll.id or v_report.category <> p_category or v_report.details <> v_details then
      raise exception 'REPORT_REQUEST_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'received', 'receiptId', v_report.receipt_id,
      'requestId', v_report.request_id, 'receivedAt', v_report.received_at);
  end if;

  insert into genie_reporting_private.user_daily_limits(reporter_id, day, used)
    values (v_user, v_day, 0) on conflict do nothing;
  insert into genie_reporting_private.daily_limits(day, used)
    values (v_day, 0) on conflict do nothing;
  select used into v_used from genie_reporting_private.user_daily_limits
    where reporter_id = v_user and day = v_day for update;
  if v_used >= 10 then raise exception 'REPORT_LIMIT' using errcode = 'P0001'; end if;
  select used into v_used from genie_reporting_private.daily_limits
    where day = v_day for update;
  if v_used >= 500 then raise exception 'REPORT_BUSY' using errcode = 'P0001'; end if;

  insert into genie_reporting_private.result_reports(request_id, reporter_id, poll_id, category, details, consent_version)
    values (p_request_id, v_user, v_poll.id, p_category, v_details, 'report-v1') returning * into v_report;
  update genie_reporting_private.user_daily_limits set used = used + 1
    where reporter_id = v_user and day = v_day;
  update genie_reporting_private.daily_limits set used = used + 1 where day = v_day;

  -- No remote scheduler change: old counters are pruned only during successful submissions.
  delete from genie_reporting_private.user_daily_limits where day < v_day - 7;
  delete from genie_reporting_private.daily_limits where day < v_day - 7;
  -- Reports disappear with their source poll/account; no duplicate AI text or personal history is stored.
  return jsonb_build_object('status', 'received', 'receiptId', v_report.receipt_id,
    'requestId', v_report.request_id, 'receivedAt', v_report.received_at);
end
$report$;

revoke all on function genie_reporting_private.submit_result_report(uuid, text, text, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function genie_reporting_private.submit_result_report(uuid, text, text, boolean, uuid, text)
  to authenticated;

-- Only this small invoker wrapper is in the Data API schema. The definer checks auth.uid()
-- and poll ownership / completed vote even if called directly by an authenticated DB role.
create function public.vs_report_result(
  p_request_id uuid, p_category text, p_details text, p_consent boolean, p_poll_id uuid, p_share_code text
) returns jsonb
language sql security invoker set search_path = ''
as $wrapper$
  select genie_reporting_private.submit_result_report(p_request_id, p_category, p_details, p_consent, p_poll_id, p_share_code);
$wrapper$;
revoke all on function public.vs_report_result(uuid, text, text, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.vs_report_result(uuid, text, text, boolean, uuid, text) to authenticated;

