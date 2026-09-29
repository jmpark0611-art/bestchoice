-- AI 판단 보조(bc_*) 스키마.
-- 원격 DB에 마이그레이션 기록 없이 직접 적용되어 있던 것을 2026-09-29 카탈로그에서 역추출함.
-- 원격 schema_migrations에는 이 버전이 없음: 원격에 다시 적용하지 말고
-- `supabase migration repair --status applied 20260927110000`로 기록만 맞출 것.

-- =========================
-- 1. 테이블
-- =========================
create table public.bc_users (
  id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table public.bc_decisions (
  id uuid not null,
  user_id uuid not null,
  concern_text text not null,
  summary text,
  category text,
  status text default 'draft'::text not null,
  clarification_json jsonb,
  safety_mode text default 'normal'::text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone
);

create table public.bc_decision_answers (
  decision_id uuid not null,
  question_id text not null,
  question_text text not null,
  answer_json jsonb not null
);

create table public.bc_decision_results (
  decision_id uuid not null,
  result_json jsonb not null,
  model_version text not null,
  created_at timestamp with time zone default now() not null
);

create table public.bc_actual_choices (
  decision_id uuid not null,
  choice_type text not null,
  choice_note text default ''::text not null,
  chosen_at timestamp with time zone default now() not null
);

create table public.bc_analytics_events (
  id bigint generated always as identity not null,
  user_id uuid not null,
  decision_id uuid not null,
  event_name text not null,
  created_at timestamp with time zone default now() not null
);

create table public.bc_decision_write_limits (
  user_id uuid not null,
  day date not null,
  used integer not null
);

create table public.bc_decision_request_tombstones (
  id uuid not null,
  user_id uuid not null
);

create table public.bc_ai_requests (
  decision_id uuid not null,
  stage text not null,
  request_id uuid not null,
  input_hash text not null,
  state text default 'running'::text not null,
  output jsonb,
  created_at timestamp with time zone default now() not null
);

create table public.bc_ai_limits (
  day date not null,
  used integer not null
);

-- =========================
-- 2. 제약조건
-- =========================
alter table public.bc_users add constraint bc_users_pkey PRIMARY KEY (id);

alter table public.bc_decisions add constraint bc_decisions_pkey PRIMARY KEY (id);
alter table public.bc_decisions add constraint bc_decisions_category_check CHECK ((category = ANY (ARRAY['career'::text, 'money'::text, 'relationship'::text, 'growth'::text, 'health'::text, 'timing'::text, 'choice'::text, 'other'::text])));
alter table public.bc_decisions add constraint bc_decisions_concern_text_check CHECK (((char_length(btrim(concern_text)) >= 20) AND (char_length(btrim(concern_text)) <= 1000)));
alter table public.bc_decisions add constraint bc_decisions_safety_mode_check CHECK ((safety_mode = ANY (ARRAY['normal'::text, 'high_stakes'::text, 'crisis'::text])));
alter table public.bc_decisions add constraint bc_decisions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'clarifying'::text, 'analyzing'::text, 'completed'::text, 'failed'::text, 'crisis'::text])));
alter table public.bc_decisions add constraint bc_decisions_summary_check CHECK ((char_length(summary) <= 2000));

alter table public.bc_decision_answers add constraint bc_decision_answers_pkey PRIMARY KEY (decision_id, question_id);
alter table public.bc_decision_answers add constraint bc_decision_answers_answer_json_check CHECK ((octet_length((answer_json)::text) <= 8000));
alter table public.bc_decision_answers add constraint bc_decision_answers_question_id_check CHECK (((char_length(question_id) >= 1) AND (char_length(question_id) <= 100)));
alter table public.bc_decision_answers add constraint bc_decision_answers_question_text_check CHECK (((char_length(question_text) >= 1) AND (char_length(question_text) <= 2000)));

alter table public.bc_decision_results add constraint bc_decision_results_pkey PRIMARY KEY (decision_id);
alter table public.bc_decision_results add constraint bc_decision_results_result_json_check CHECK (((jsonb_typeof(result_json) = 'object'::text) AND (octet_length((result_json)::text) <= 60000)));

alter table public.bc_actual_choices add constraint bc_actual_choices_pkey PRIMARY KEY (decision_id);
alter table public.bc_actual_choices add constraint bc_actual_choices_choice_note_check CHECK ((char_length(choice_note) <= 300));
alter table public.bc_actual_choices add constraint bc_actual_choices_choice_type_check CHECK ((choice_type = ANY (ARRAY['followed'::text, 'other'::text, 'undecided'::text])));

alter table public.bc_analytics_events add constraint bc_analytics_events_pkey PRIMARY KEY (id);
alter table public.bc_analytics_events add constraint bc_analytics_events_event_name_check CHECK ((event_name = ANY (ARRAY['decision_submitted'::text, 'actual_choice_saved'::text])));

alter table public.bc_decision_write_limits add constraint bc_decision_write_limits_pkey PRIMARY KEY (user_id, day);
alter table public.bc_decision_write_limits add constraint bc_decision_write_limits_used_check CHECK (((used >= 0) AND (used <= 20)));

alter table public.bc_decision_request_tombstones add constraint bc_decision_request_tombstones_pkey PRIMARY KEY (id);

alter table public.bc_ai_requests add constraint bc_ai_requests_pkey PRIMARY KEY (decision_id, stage);
alter table public.bc_ai_requests add constraint bc_ai_requests_stage_check CHECK ((stage = ANY (ARRAY['clarify'::text, 'analyze'::text])));
alter table public.bc_ai_requests add constraint bc_ai_requests_state_check CHECK ((state = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text])));

alter table public.bc_ai_limits add constraint bc_ai_limits_pkey PRIMARY KEY (day);

-- 외래키 (모두 on delete cascade)
alter table public.bc_users add constraint bc_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.bc_decisions add constraint bc_decisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bc_users(id) ON DELETE CASCADE;
alter table public.bc_decision_answers add constraint bc_decision_answers_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bc_decisions(id) ON DELETE CASCADE;
alter table public.bc_decision_results add constraint bc_decision_results_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bc_decisions(id) ON DELETE CASCADE;
alter table public.bc_actual_choices add constraint bc_actual_choices_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bc_decisions(id) ON DELETE CASCADE;
alter table public.bc_analytics_events add constraint bc_analytics_events_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bc_decisions(id) ON DELETE CASCADE;
alter table public.bc_analytics_events add constraint bc_analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bc_users(id) ON DELETE CASCADE;
alter table public.bc_decision_write_limits add constraint bc_decision_write_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bc_users(id) ON DELETE CASCADE;
alter table public.bc_decision_request_tombstones add constraint bc_decision_request_tombstones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bc_users(id) ON DELETE CASCADE;
alter table public.bc_ai_requests add constraint bc_ai_requests_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bc_decisions(id) ON DELETE CASCADE;

CREATE INDEX bc_decisions_owner_created ON public.bc_decisions USING btree (user_id, created_at DESC, id DESC);

-- =========================
-- 3. RLS: 본인 데이터 읽기만 허용, 쓰기는 RPC/서버 전용
-- =========================
alter table public.bc_users enable row level security;
alter table public.bc_decisions enable row level security;
alter table public.bc_decision_answers enable row level security;
alter table public.bc_decision_results enable row level security;
alter table public.bc_actual_choices enable row level security;
alter table public.bc_analytics_events enable row level security;
alter table public.bc_decision_write_limits enable row level security;
alter table public.bc_decision_request_tombstones enable row level security;
alter table public.bc_ai_requests enable row level security;
alter table public.bc_ai_limits enable row level security;

create policy users_read_self on public.bc_users as PERMISSIVE for SELECT to authenticated
  using ((( SELECT auth.uid() AS uid) = id));
create policy decisions_read_self on public.bc_decisions as PERMISSIVE for SELECT to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy answers_read_self on public.bc_decision_answers as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1 FROM public.bc_decisions d
    WHERE ((d.id = bc_decision_answers.decision_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));
create policy results_read_self on public.bc_decision_results as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1 FROM public.bc_decisions d
    WHERE ((d.id = bc_decision_results.decision_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));
create policy choices_read_self on public.bc_actual_choices as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1 FROM public.bc_decisions d
    WHERE ((d.id = bc_actual_choices.decision_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));

revoke all on public.bc_users, public.bc_decisions, public.bc_decision_answers, public.bc_decision_results,
  public.bc_actual_choices, public.bc_analytics_events, public.bc_decision_write_limits,
  public.bc_decision_request_tombstones, public.bc_ai_requests, public.bc_ai_limits from anon, authenticated;
grant select on public.bc_users, public.bc_decisions, public.bc_decision_answers,
  public.bc_decision_results, public.bc_actual_choices to authenticated;

-- =========================
-- 4. 클라이언트 RPC (authenticated)
-- =========================
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
 v_used integer;
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
 select used into v_used from public.bc_decision_write_limits where user_id = v_user and day = v_day;
 if v_used >= 20 then raise exception 'DAILY_LIMIT' using errcode = 'P0001'; end if;
 update public.bc_decision_write_limits set used = used + 1 where user_id = v_user and day = v_day;
 insert into public.bc_decisions(id, user_id, concern_text) values (p_id, v_user, btrim(p_concern));
 insert into public.bc_analytics_events(user_id, decision_id, event_name) values(v_user, p_id, 'decision_submitted');
 return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.bc_delete_decision(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_count integer;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 insert into public.bc_decision_request_tombstones(id,user_id) select id,user_id from public.bc_decisions where id = p_id and user_id = v_user on conflict do nothing;
 delete from public.bc_decisions where id = p_id and user_id = v_user;
 get diagnostics v_count = row_count;
 return v_count > 0;
end $function$;

CREATE OR REPLACE FUNCTION public.bc_delete_my_decisions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_count integer;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 insert into public.bc_decision_request_tombstones(id,user_id) select id,user_id from public.bc_decisions where user_id = v_user on conflict do nothing;
 delete from public.bc_decisions where user_id = v_user;
 get diagnostics v_count = row_count;
 return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.bc_save_actual_choice(p_decision_id uuid, p_choice_type text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_status text;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
 if p_choice_type is null or p_choice_type not in ('followed','other','undecided') or p_note is null or char_length(btrim(p_note)) > 300 then
  raise exception 'INVALID_INPUT' using errcode = '22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 select status into v_status from public.bc_decisions where id = p_decision_id and user_id = v_user for update;
 if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
 if v_status <> 'completed' or not exists(select 1 from public.bc_decision_results where decision_id = p_decision_id) then
  raise exception 'RESULT_REQUIRED' using errcode = '22023';
 end if;
 insert into public.bc_actual_choices(decision_id, choice_type, choice_note)
 values(p_decision_id, p_choice_type, btrim(p_note))
 on conflict(decision_id) do update set choice_type = excluded.choice_type, choice_note = excluded.choice_note, chosen_at = now();
 -- One event per decision; updates must not inflate the primary conversion metric.
 insert into public.bc_analytics_events(user_id, decision_id, event_name)
 select v_user, p_decision_id, 'actual_choice_saved'
 where not exists(select 1 from public.bc_analytics_events where decision_id = p_decision_id and event_name = 'actual_choice_saved');
end $function$;

-- =========================
-- 5. 서버 전용 RPC (service_role, decision-ai Edge Function에서만 호출)
-- =========================
CREATE OR REPLACE FUNCTION public.bc_claim_ai(p_user uuid, p_id uuid, p_stage text, p_request uuid, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.bc_decisions; r public.bc_ai_requests; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into d from public.bc_decisions where id=p_id and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_stage not in ('clarify','analyze') then raise exception 'INVALID_STAGE'; end if;
 select * into r from public.bc_ai_requests where decision_id=p_id and stage=p_stage;
 if found then
  if r.input_hash<>p_hash then raise exception 'INPUT_CONFLICT'; end if;
  return jsonb_build_object('state',r.state,'output',r.output);
 end if;
 if (p_stage='clarify' and d.status<>'draft') or (p_stage='analyze' and d.status<>'clarifying') then raise exception 'INVALID_STAGE'; end if;
 insert into public.bc_ai_limits values ((now() at time zone 'utc')::date,1)
 on conflict(day) do update set used=public.bc_ai_limits.used+1 where public.bc_ai_limits.used<100 returning used into n;
 if n is null then raise exception 'AI_LIMIT'; end if;
 insert into public.bc_ai_requests(decision_id,stage,request_id,input_hash) values(p_id,p_stage,p_request,p_hash);
 if p_stage='analyze' then update public.bc_decisions set status='analyzing' where id=p_id; end if;
 return jsonb_build_object('state','claimed');
end $function$;

CREATE OR REPLACE FUNCTION public.bc_finish_ai(p_user uuid, p_id uuid, p_stage text, p_request uuid, p_output jsonb, p_answers jsonb, p_model text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.bc_decisions; a jsonb; q jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into d from public.bc_decisions where id=p_id and user_id=p_user for update;
 if not found then return false; end if;
 perform 1 from public.bc_ai_requests where decision_id=p_id and stage=p_stage and request_id=p_request and state='running' for update;
 if not found then return false; end if;
 if p_output is null then
  update public.bc_ai_requests set state='failed' where decision_id=p_id and stage=p_stage;
  update public.bc_decisions set status='failed' where id=p_id;
  return true;
 end if;
 if p_output->>'kind'='crisis' then
  update public.bc_decisions set status='crisis',safety_mode='crisis' where id=p_id;
 elsif p_stage='clarify' and p_output->>'kind'='clarification' then
  update public.bc_decisions set status='clarifying',clarification_json=p_output->'clarification',summary=p_output->'clarification'->>'summary',category=p_output->'clarification'->>'category',safety_mode=p_output->>'safetyMode' where id=p_id;
 elsif p_stage='analyze' and p_output->>'kind'='analysis' then
  insert into public.bc_decision_results(decision_id,result_json,model_version) values(p_id,p_output->'analysis',p_model);
  for a in select value from jsonb_array_elements(p_answers) loop
   select value into q from jsonb_array_elements(d.clarification_json->'questions') where value->>'id'=a->>'questionId';
   insert into public.bc_decision_answers values(p_id,a->>'questionId',q->>'text',a->'value');
  end loop;
  update public.bc_decisions set status='completed',completed_at=now(),safety_mode=p_output->>'safetyMode' where id=p_id;
 else raise exception 'INVALID_OUTPUT'; end if;
 update public.bc_ai_requests set state='done',output=p_output where decision_id=p_id and stage=p_stage;
 return true;
end $function$;

-- =========================
-- 6. 함수 실행 권한
-- =========================
revoke execute on function public.bc_create_decision(uuid, text) from public, anon;
revoke execute on function public.bc_delete_decision(uuid) from public, anon;
revoke execute on function public.bc_delete_my_decisions() from public, anon;
revoke execute on function public.bc_save_actual_choice(uuid, text, text) from public, anon;
grant execute on function public.bc_create_decision(uuid, text) to authenticated;
grant execute on function public.bc_delete_decision(uuid) to authenticated;
grant execute on function public.bc_delete_my_decisions() to authenticated;
grant execute on function public.bc_save_actual_choice(uuid, text, text) to authenticated;

revoke execute on function public.bc_claim_ai(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.bc_finish_ai(uuid, uuid, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.bc_claim_ai(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.bc_finish_ai(uuid, uuid, text, uuid, jsonb, jsonb, text) to service_role;
