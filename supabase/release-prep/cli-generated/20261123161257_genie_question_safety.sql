-- CLI-generated migration; SQL copied from its reviewed additive release body.
-- Derives from supabase/proposals/vs-question-safety.sql at SHA-256 b1394b91284d6882238570afa28f2b8c8290652679cd63564ac81f651c855dba.
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
  -- Guarded methods delegate to these tested definitions; drift requires a new review.
  if exists (
    select 1 from (values

      ('public.vs_poll_json(public.vs_polls,uuid)', '2c2e689d88599f3103b52955ffdef59e', 858),
      ('public.vs_shared_poll(text)', '5a9cbf86abff3e172d5bad3664fccd1e', 380),
      ('public.vs_vote(text,text)', 'af4c5e177c35ad17289a30101ff09d9f', 909)
    ) as expected(signature, body_md5, body_characters)
    left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
    where p.oid is null or p.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype or
      not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false) or
      pg_catalog.md5(p.prosrc) <> expected.body_md5 or
      pg_catalog.char_length(p.prosrc) <> expected.body_characters
  ) then
    raise exception 'RELEASE_CANONICAL_SHARED_FUNCTIONS_REQUIRED';
  end if;
  if pg_catalog.to_regnamespace('genie_question_safety_private') is not null then
    raise exception 'RELEASE_NEW_SCHEMA_ALREADY_EXISTS';
  end if;
  -- Reject any same-name public overload, not just the intended exact signature.
  if exists (select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('vs_report_question', 'vs_set_question_author_block', 'vs_clear_question_author_blocks', 'vs_shared_poll_guarded', 'vs_vote_guarded')) then
    raise exception 'RELEASE_PUBLIC_RPC_NAME_COLLISION';
  end if;
end
$release_guard$;

-- CREATE without OR REPLACE prevents silently replacing an earlier deployment.
create schema genie_question_safety_private;
revoke all on schema genie_question_safety_private from public, anon, authenticated;
grant usage on schema genie_question_safety_private to authenticated;

create table genie_question_safety_private.question_reports (
  receipt_id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  poll_id uuid not null references public.vs_polls(id) on delete cascade,
  category text not null check (category in ('unsafe', 'incorrect', 'privacy', 'other')),
  details text not null check (char_length(details) <= 200 and octet_length(details) <= 800),
  consent_version text not null check (consent_version = 'question-report-v1'),
  received_at timestamptz not null default now(),
  unique (reporter_id, request_id)
);
create index question_reports_poll_idx on genie_question_safety_private.question_reports(poll_id);
create index question_reports_received_idx on genie_question_safety_private.question_reports(received_at);

create table genie_question_safety_private.user_daily_limits (
  reporter_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null check (used between 0 and 10),
  primary key (reporter_id, day)
);
create index question_user_limits_day_idx on genie_question_safety_private.user_daily_limits(day);
create table genie_question_safety_private.daily_limits (
  day date primary key,
  used integer not null check (used between 0 and 500)
);

create table genie_question_safety_private.author_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, author_id),
  check (blocker_id <> author_id)
);
create index question_author_blocks_author_idx on genie_question_safety_private.author_blocks(author_id);

alter table genie_question_safety_private.question_reports enable row level security;
alter table genie_question_safety_private.user_daily_limits enable row level security;
alter table genie_question_safety_private.daily_limits enable row level security;
alter table genie_question_safety_private.author_blocks enable row level security;
revoke all on genie_question_safety_private.question_reports,
  genie_question_safety_private.user_daily_limits, genie_question_safety_private.daily_limits,
  genie_question_safety_private.author_blocks from public, anon, authenticated;
-- No client table policy, direct read/write privilege, author-ID listing or report-listing API.

create function genie_question_safety_private.submit_question_report(
  p_request_id uuid, p_category text, p_details text, p_consent boolean, p_share_code text
) returns jsonb
language plpgsql security definer set search_path = ''
as $report$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'UTC')::date;
  v_poll_id uuid;
  v_report genie_question_safety_private.question_reports%rowtype;
  v_details text := btrim(coalesce(p_details, ''));
  v_used integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or p_consent is distinct from true or p_category is null or
    p_category not in ('unsafe', 'incorrect', 'privacy', 'other') or
    char_length(v_details) > 200 or octet_length(v_details) > 800 or
    p_share_code is null or p_share_code !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'REPORT_INVALID' using errcode = '22023';
  end if;
  -- The shared question is already visible before voting. Never return its hidden AI result.
  select p.id into v_poll_id from public.vs_polls p
    where p.share_code = p_share_code and p.user_id <> v_user for key share;
  if not found then raise exception 'REPORT_NOT_ALLOWED' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('genie-question-report:' || v_user::text, 0));
  select * into v_report from genie_question_safety_private.question_reports
    where reporter_id = v_user and request_id = p_request_id;
  if found then
    if v_report.poll_id <> v_poll_id or v_report.category <> p_category or v_report.details <> v_details then
      raise exception 'REPORT_REQUEST_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'received', 'receiptId', v_report.receipt_id,
      'requestId', v_report.request_id, 'receivedAt', v_report.received_at);
  end if;

  insert into genie_question_safety_private.user_daily_limits(reporter_id, day, used)
    values (v_user, v_day, 0) on conflict do nothing;
  insert into genie_question_safety_private.daily_limits(day, used)
    values (v_day, 0) on conflict do nothing;
  select used into v_used from genie_question_safety_private.user_daily_limits
    where reporter_id = v_user and day = v_day for update;
  if v_used >= 10 then raise exception 'REPORT_LIMIT' using errcode = 'P0001'; end if;
  select used into v_used from genie_question_safety_private.daily_limits where day = v_day for update;
  if v_used >= 500 then raise exception 'REPORT_BUSY' using errcode = 'P0001'; end if;

  insert into genie_question_safety_private.question_reports(request_id, reporter_id, poll_id, category, details, consent_version)
    values (p_request_id, v_user, v_poll_id, p_category, v_details, 'question-report-v1') returning * into v_report;
  update genie_question_safety_private.user_daily_limits set used = used + 1
    where reporter_id = v_user and day = v_day;
  update genie_question_safety_private.daily_limits set used = used + 1 where day = v_day;
  delete from genie_question_safety_private.user_daily_limits where day < v_day - 7;
  delete from genie_question_safety_private.daily_limits where day < v_day - 7;
  return jsonb_build_object('status', 'received', 'receiptId', v_report.receipt_id,
    'requestId', v_report.request_id, 'receivedAt', v_report.received_at);
end
$report$;

create function genie_question_safety_private.set_author_block(p_share_code text, p_blocked boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $block$
declare v_user uuid := auth.uid(); v_author uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_blocked is null or p_share_code is null or p_share_code !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'BLOCK_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('genie-question-block:' || v_user::text, 0));
  select user_id into v_author from public.vs_polls where share_code = p_share_code;
  if not found then raise exception 'BLOCK_NOT_ALLOWED' using errcode = '42501'; end if;
  if v_author = v_user then raise exception 'BLOCK_SELF_NOT_ALLOWED' using errcode = '42501'; end if;
  if p_blocked then
    if not exists (select 1 from genie_question_safety_private.author_blocks where blocker_id = v_user and author_id = v_author) then
      if (select count(*) from genie_question_safety_private.author_blocks where blocker_id = v_user) >= 200 then
        raise exception 'BLOCK_LIMIT' using errcode = 'P0001';
      end if;
      insert into genie_question_safety_private.author_blocks(blocker_id, author_id) values (v_user, v_author);
    end if;
    return jsonb_build_object('status', 'blocked');
  end if;
  delete from genie_question_safety_private.author_blocks where blocker_id = v_user and author_id = v_author;
  return jsonb_build_object('status', 'unblocked');
end
$block$;

create function genie_question_safety_private.clear_author_blocks()
returns jsonb language plpgsql security definer set search_path = ''
as $clear$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('genie-question-block:' || v_user::text, 0));
  delete from genie_question_safety_private.author_blocks where blocker_id = v_user;
  return jsonb_build_object('status', 'cleared');
end
$clear$;

create function genie_question_safety_private.assert_author_allowed(p_code text)
returns void language plpgsql security definer set search_path = ''
as $access$
declare v_user uuid := auth.uid(); v_author uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('genie-question-block:' || v_user::text, 0));
  -- No early row lock: vs_vote owns its original FOR UPDATE lock. Taking KEY SHARE
  -- here then upgrading in two parallel votes would introduce a lock-upgrade deadlock.
  select user_id into v_author from public.vs_polls where share_code = p_code;
  if not found or p_code is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from genie_question_safety_private.author_blocks where blocker_id = v_user and author_id = v_author) then
    raise exception 'AUTHOR_BLOCKED' using errcode = '42501';
  end if;
end
$access$;

create function genie_question_safety_private.shared_poll_guarded(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $read$
begin
  perform genie_question_safety_private.assert_author_allowed(p_code);
  return public.vs_shared_poll(p_code);
end
$read$;

create function genie_question_safety_private.vote_guarded(p_code text, p_choice text)
returns jsonb language plpgsql security definer set search_path = ''
as $vote$
begin
  perform genie_question_safety_private.assert_author_allowed(p_code);
  return public.vs_vote(p_code, p_choice);
end
$vote$;

revoke all on function genie_question_safety_private.submit_question_report(uuid,text,text,boolean,text),
  genie_question_safety_private.set_author_block(text,boolean), genie_question_safety_private.clear_author_blocks(),
  genie_question_safety_private.assert_author_allowed(text), genie_question_safety_private.shared_poll_guarded(text),
  genie_question_safety_private.vote_guarded(text,text) from public, anon, authenticated;
grant execute on function genie_question_safety_private.submit_question_report(uuid,text,text,boolean,text),
  genie_question_safety_private.set_author_block(text,boolean), genie_question_safety_private.clear_author_blocks(),
  genie_question_safety_private.shared_poll_guarded(text), genie_question_safety_private.vote_guarded(text,text) to authenticated;

create function public.vs_report_question(p_request_id uuid, p_category text, p_details text, p_consent boolean, p_share_code text)
returns jsonb language sql security invoker set search_path = ''
as $wrapper$ select genie_question_safety_private.submit_question_report(p_request_id,p_category,p_details,p_consent,p_share_code); $wrapper$;
create function public.vs_set_question_author_block(p_share_code text, p_blocked boolean)
returns jsonb language sql security invoker set search_path = ''
as $wrapper$ select genie_question_safety_private.set_author_block(p_share_code,p_blocked); $wrapper$;
create function public.vs_clear_question_author_blocks()
returns jsonb language sql security invoker set search_path = ''
as $wrapper$ select genie_question_safety_private.clear_author_blocks(); $wrapper$;
create function public.vs_shared_poll_guarded(p_code text)
returns jsonb language sql security invoker set search_path = ''
as $wrapper$ select genie_question_safety_private.shared_poll_guarded(p_code); $wrapper$;
create function public.vs_vote_guarded(p_code text, p_choice text)
returns jsonb language sql security invoker set search_path = ''
as $wrapper$ select genie_question_safety_private.vote_guarded(p_code,p_choice); $wrapper$;
revoke all on function public.vs_report_question(uuid,text,text,boolean,text),
  public.vs_set_question_author_block(text,boolean), public.vs_clear_question_author_blocks(),
  public.vs_shared_poll_guarded(text), public.vs_vote_guarded(text,text) from public, anon, authenticated;
grant execute on function public.vs_report_question(uuid,text,text,boolean,text),
  public.vs_set_question_author_block(text,boolean), public.vs_clear_question_author_blocks(),
  public.vs_shared_poll_guarded(text), public.vs_vote_guarded(text,text) to authenticated;

-- Legacy vs_shared_poll/vs_vote stay untouched. This is a preference enforced by
-- the new client route, not a replacement for author data-access permissions.
-- Source-poll deletion cascades reports, never quotas or author blocks. The clear
-- RPC allows recovery even after a link disappears. Auth-user deletion cascades
-- that user's reports/quota/blocks; the global quota is deliberately retained.
