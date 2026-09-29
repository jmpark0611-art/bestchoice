drop index if exists public.votes_option_id_idx;
create index votes_option_id_decision_id_idx on public.votes(option_id, decision_id);
create index decisions_result_option_idx on public.decisions(result_option_id, id);
