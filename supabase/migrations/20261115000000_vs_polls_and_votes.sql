-- A vs B 즉답 + 친구 투표 (2026-11-15, 단독 웹/앱 버전용. 기존 bc_* 흐름과 토스 미니앱에는 영향 없음)
-- 결론 생성은 Edge Function vs-decide가 service_role로 수행한다(vs_claim → OpenAI → vs_polls insert).
-- 친구는 익명 로그인 후 공유 코드로 조회·투표한다. 테이블 직접 쓰기는 모두 막고 RPC로만 바꾼다.

create table public.vs_polls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  option_a text not null check (char_length(option_a) between 1 and 20),
  option_b text not null check (char_length(option_b) between 1 and 20),
  note text check (note is null or char_length(note) between 1 and 60),
  pick text not null check (pick in ('a','b')),
  reason text not null check (char_length(reason) between 1 and 300),
  share_code text unique,
  did text check (did in ('a','b','none')),
  created_at timestamptz not null default now()
);
create index vs_polls_user_created_idx on public.vs_polls(user_id, created_at desc);

create table public.vs_votes (
  poll_id uuid not null references public.vs_polls(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('a','b')),
  created_at timestamptz not null default now(),
  primary key (poll_id, voter_id)
);
create index vs_votes_voter_idx on public.vs_votes(voter_id);

-- 하루 사용량: user_id가 있으면 사용자별, 전체 합계는 vs_daily_total
create table public.vs_user_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  primary key (user_id, day)
);
create table public.vs_daily_total (
  day date primary key,
  used integer not null default 0
);

alter table public.vs_polls enable row level security;
alter table public.vs_votes enable row level security;
alter table public.vs_user_limits enable row level security;
alter table public.vs_daily_total enable row level security;
revoke all on public.vs_polls, public.vs_votes, public.vs_user_limits, public.vs_daily_total from anon, authenticated;
grant select on public.vs_polls to authenticated;
create policy vs_polls_read_own on public.vs_polls for select to authenticated using (user_id = (select auth.uid()));

-- Edge Function 전용: OpenAI 호출 전에 한도를 차지한다. 사용자 하루 30건, 전체 하루 300건(비용 상한)
create function public.vs_claim(p_user uuid) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare
 v_day date := (now() at time zone 'UTC')::date;
 v_used integer;
begin
 if p_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 insert into public.vs_user_limits(user_id, day, used) values (p_user, v_day, 0) on conflict do nothing;
 insert into public.vs_daily_total(day, used) values (v_day, 0) on conflict do nothing;
 select used into v_used from public.vs_user_limits where user_id = p_user and day = v_day for update;
 if v_used >= 30 then raise exception 'VS_LIMIT' using errcode = 'P0001'; end if;
 select used into v_used from public.vs_daily_total where day = v_day for update;
 if v_used >= 300 then raise exception 'VS_BUSY' using errcode = 'P0001'; end if;
 update public.vs_user_limits set used = used + 1 where user_id = p_user and day = v_day;
 update public.vs_daily_total set used = used + 1 where day = v_day;
end $function$;

-- 표 수와 지니의 선택은 주인이거나 이미 투표한 사람에게만 보여준다(먼저 보고 따라 찍지 않게)
create function public.vs_poll_json(p_poll public.vs_polls, p_user uuid) returns jsonb
 language sql stable security definer set search_path to ''
as $function$
 with v as (
  select count(*) filter (where choice = 'a') as a, count(*) filter (where choice = 'b') as b,
         max(choice) filter (where voter_id = p_user) as mine
  from public.vs_votes where poll_id = (p_poll).id
 )
 select jsonb_build_object(
  'id', case when (p_poll).user_id = p_user then (p_poll).id end,
  'a', (p_poll).option_a, 'b', (p_poll).option_b, 'note', (p_poll).note,
  'isOwner', (p_poll).user_id = p_user,
  'myVote', v.mine,
  'shareCode', case when (p_poll).user_id = p_user then (p_poll).share_code end,
  'did', case when (p_poll).user_id = p_user then (p_poll).did end,
  'createdAt', (p_poll).created_at
 ) || case when (p_poll).user_id = p_user or v.mine is not null
   then jsonb_build_object('pick', (p_poll).pick, 'reason', (p_poll).reason, 'votes', jsonb_build_object('a', v.a, 'b', v.b))
   else '{}'::jsonb end
 from v
$function$;

create function public.vs_my_poll(p_id uuid) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_poll public.vs_polls%rowtype;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 select * into v_poll from public.vs_polls where id = p_id and user_id = v_user;
 if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
 return public.vs_poll_json(v_poll, v_user);
end $function$;

create function public.vs_share(p_id uuid) returns text
 language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_code text;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 select share_code into v_code from public.vs_polls where id = p_id and user_id = v_user for update;
 if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
 if v_code is not null then return v_code; end if;
 for i in 1..5 loop
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  begin
   update public.vs_polls set share_code = v_code where id = p_id;
   return v_code;
  exception when unique_violation then null;
  end;
 end loop;
 raise exception 'SHARE_FAILED' using errcode = 'P0001';
end $function$;

create function public.vs_shared_poll(p_code text) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_poll public.vs_polls%rowtype;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 select * into v_poll from public.vs_polls where share_code = p_code;
 if not found or p_code is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
 return public.vs_poll_json(v_poll, v_user);
end $function$;

create function public.vs_vote(p_code text, p_choice text) returns jsonb
 language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_poll public.vs_polls%rowtype;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 if p_choice is null or p_choice not in ('a','b') then raise exception 'INVALID_INPUT' using errcode = '22023'; end if;
 select * into v_poll from public.vs_polls where share_code = p_code for update;
 if not found or p_code is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
 if v_poll.user_id = v_user then raise exception 'OWNER_CANNOT_VOTE' using errcode = 'P0001'; end if;
 if (select count(*) from public.vs_votes where poll_id = v_poll.id) >= 500 then
  raise exception 'VOTE_CLOSED' using errcode = 'P0001';
 end if;
 -- 한 사람 한 표. 다시 눌러도 처음 표가 유지된다
 insert into public.vs_votes(poll_id, voter_id, choice) values (v_poll.id, v_user, p_choice) on conflict do nothing;
 return public.vs_poll_json(v_poll, v_user);
end $function$;

create function public.vs_set_did(p_id uuid, p_did text) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 if p_did is null or p_did not in ('a','b','none') then raise exception 'INVALID_INPUT' using errcode = '22023'; end if;
 update public.vs_polls set did = p_did where id = p_id and user_id = v_user;
 if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end $function$;

create function public.vs_delete_poll(p_id uuid) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 delete from public.vs_polls where id = p_id and user_id = v_user;
end $function$;

-- 기존 정책과 같은 보관 기간: 작성 후 2개월 지나면 삭제. 한도 기록은 7일
create function public.vs_purge_expired() returns void
 language plpgsql security definer set search_path to ''
as $function$
begin
 delete from public.vs_polls where created_at < now() - interval '2 months';
 delete from public.vs_user_limits where day < (now() at time zone 'UTC')::date - 7;
 delete from public.vs_daily_total where day < (now() at time zone 'UTC')::date - 7;
end $function$;

revoke execute on function public.vs_claim(uuid), public.vs_poll_json(public.vs_polls, uuid), public.vs_purge_expired() from public, anon, authenticated;
grant execute on function public.vs_claim(uuid) to service_role;
revoke execute on function public.vs_my_poll(uuid), public.vs_share(uuid), public.vs_shared_poll(text), public.vs_vote(text, text),
  public.vs_set_did(uuid, text), public.vs_delete_poll(uuid) from public, anon;
grant execute on function public.vs_my_poll(uuid), public.vs_share(uuid), public.vs_shared_poll(text), public.vs_vote(text, text),
  public.vs_set_did(uuid, text), public.vs_delete_poll(uuid) to authenticated;

do $$
begin
 if exists (select 1 from pg_extension where extname = 'pg_cron') then
  perform cron.schedule('vs-purge-expired', '10 18 * * *', 'select public.vs_purge_expired()'); -- 매일 03:10 KST
 end if;
end $$;
