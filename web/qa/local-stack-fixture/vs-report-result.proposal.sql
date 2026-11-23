-- LOCAL PROPOSAL ONLY. Not a migration and not deployed to any Supabase project.
-- Local PostgreSQL WASM verification is recorded in the accompanying README; no real Auth/PostgREST validation.
-- Review against the actual isolated database, then generate a migration with the installed CLI.
-- Do not overwrite any existing vs_* migration or vs-decide function.
-- For deliberate use in a disposable LOCAL database only, set in the same session:
--   set genie.allow_local_reporting_proposal = 'on';
begin;

do $guard$
begin
  if current_setting('genie.allow_local_reporting_proposal', true) is distinct from 'on' then
    raise exception 'LOCAL_PROPOSAL_REQUIRES_EXPLICIT_SESSION_OPT_IN';
  end if;
  if to_regclass('public.vs_polls') is null or to_regclass('public.vs_votes') is null then
    raise exception 'EXISTING_VS_SCHEMA_REQUIRED';
  end if;
end
$guard$;

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

commit;
