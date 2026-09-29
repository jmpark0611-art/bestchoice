-- =========================
-- 1. profiles (auth.users 1:1)
-- =========================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  toss_user_key text unique,
  nickname text check (char_length(nickname) <= 20),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================
-- 2. decisions
-- =========================
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  mode text not null default 'random' check (mode in ('random', 'vote', 'ai')),
  status text not null default 'open' check (status in ('open', 'closed')),
  result_option_id uuid,
  ai_reason text,
  share_code text unique,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index decisions_owner_id_idx on public.decisions(owner_id);

-- =========================
-- 3. options
-- =========================
create table public.options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 50),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, decision_id)
);
create index options_decision_id_idx on public.options(decision_id);

-- 결과 선택지는 반드시 같은 고민의 선택지여야 함
alter table public.decisions
  add constraint decisions_result_option_fk
  foreign key (result_option_id, id)
  references public.options(id, decision_id)
  on delete set null (result_option_id);

-- =========================
-- 4. votes (고민당 1인 1표)
-- =========================
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  option_id uuid not null,
  voter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (decision_id, voter_id),
  foreign key (option_id, decision_id) references public.options(id, decision_id) on delete cascade
);
create index votes_option_id_idx on public.votes(option_id);
create index votes_voter_id_idx on public.votes(voter_id);

-- =========================
-- 5. RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.decisions enable row level security;
alter table public.options enable row level security;
alter table public.votes enable row level security;

-- profiles: 본인만 조회, 닉네임만 수정 가능 (토스 키는 서버만 기록)
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nickname) on public.profiles to authenticated;

-- decisions: 본인 것만 CRUD, 공유코드/AI이유는 직접 못 씀
create policy decisions_owner_all on public.decisions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke insert, update on public.decisions from anon, authenticated;
grant insert (title, mode) on public.decisions to authenticated;
grant update (title, mode, status, result_option_id, closed_at) on public.decisions to authenticated;

-- options: 고민 주인만 CRUD
create policy options_owner_all on public.options
  for all to authenticated
  using (exists (select 1 from public.decisions d
                 where d.id = decision_id and d.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.decisions d
                      where d.id = decision_id and d.owner_id = (select auth.uid())));

-- votes: 본인 표 또는 내 고민의 표만 조회, 쓰기는 cast_vote 함수로만
create policy votes_select on public.votes
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or exists (select 1 from public.decisions d
               where d.id = decision_id and d.owner_id = (select auth.uid()))
  );
revoke insert, update, delete on public.votes from anon, authenticated;

-- =========================
-- 6. 공유/투표 함수
-- =========================

-- 투표 링크 생성: 토스 로그인 연결된 사용자만
create or replace function public.create_share_code(p_decision_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not exists (select 1 from public.profiles
                 where id = auth.uid() and toss_user_key is not null) then
    raise exception 'TOSS_LOGIN_REQUIRED';
  end if;

  select share_code into v_code
  from public.decisions
  where id = p_decision_id and owner_id = auth.uid();

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_code is null then
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    update public.decisions
      set share_code = v_code, mode = 'vote'
      where id = p_decision_id;
  end if;

  return v_code;
end;
$$;

-- 공유 코드로 고민 조회 (선택지 + 득표수 + 내 표)
create or replace function public.get_shared_decision(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'status', d.status,
    'result_option_id', d.result_option_id,
    'my_vote', (select v.option_id from public.votes v
                where v.decision_id = d.id and v.voter_id = auth.uid()),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'label', o.label,
               'votes', (select count(*) from public.votes v where v.option_id = o.id)
             ) order by o.position)
      from public.options o
      where o.decision_id = d.id
    ), '[]'::jsonb)
  )
  from public.decisions d
  where d.share_code = p_code;
$$;

-- 투표 (익명 사용자도 가능, 다시 누르면 표 변경)
create or replace function public.cast_vote(p_code text, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into v_decision_id
  from public.decisions
  where share_code = p_code and status = 'open';

  if v_decision_id is null then
    raise exception 'NOT_FOUND_OR_CLOSED';
  end if;

  insert into public.votes (decision_id, option_id, voter_id)
  values (v_decision_id, p_option_id, auth.uid())
  on conflict (decision_id, voter_id)
  do update set option_id = excluded.option_id, created_at = now();
end;
$$;

-- 함수 실행 권한 정리
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_share_code(uuid) from public, anon;
revoke execute on function public.get_shared_decision(text) from public, anon;
revoke execute on function public.cast_vote(text, uuid) from public, anon;
grant execute on function public.create_share_code(uuid) to authenticated;
grant execute on function public.get_shared_decision(text) to authenticated;
grant execute on function public.cast_vote(text, uuid) to authenticated;
