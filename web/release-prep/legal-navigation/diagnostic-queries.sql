-- PostgreSQL catalog/activity only. No application rows or raw activity query text.
with expected_schemas(name) as (values ('genie_reporting_private'),('genie_question_safety_private')),
expected_public_functions(name) as (values ('vs_report_result'),('vs_report_question'),('vs_set_question_author_block'),('vs_clear_question_author_blocks'),('vs_shared_poll_guarded'),('vs_vote_guarded')),
matching_activity as (
 select pid,state,query_start,xact_start,wait_event_type,wait_event,
 (coalesce(application_name,'')<>'') as application_name_present,
 (pg_catalog.lower(coalesce(application_name,'')) like '%mcp%') as application_name_mentions_mcp,
 (pg_catalog.lower(coalesce(application_name,'')) like '%pg-meta%' or pg_catalog.lower(coalesce(application_name,'')) like '%pgmeta%') as application_name_mentions_pgmeta,
 (pg_catalog.lower(ltrim(query)) like 'select%' or pg_catalog.lower(ltrim(query)) like 'with%') as starts_with_read_query
 from pg_catalog.pg_stat_activity
 where datname=pg_catalog.current_database() and pid<>pg_catalog.pg_backend_pid()
 and pg_catalog.lower(query) similar to '%(genie_reporting_private|genie_question_safety_private|genie_result_reporting|genie_question_safety|vs_report_result|vs_report_question|vs_set_question_author_block|vs_clear_question_author_blocks|vs_shared_poll_guarded|vs_vote_guarded)%'
), bounded_activity as (
 select pid,state,pg_catalog.round(extract(epoch from (pg_catalog.clock_timestamp()-query_start))::numeric,3) as query_age_seconds,
 (xact_start is not null) as transaction_open,wait_event_type,wait_event,application_name_present,application_name_mentions_mcp,application_name_mentions_pgmeta,starts_with_read_query,
 pg_catalog.pg_blocking_pids(pid) as blocking_pids,
 (select count(*) from pg_catalog.pg_locks l where l.pid=matching_activity.pid and not l.granted) as ungranted_lock_count
 from matching_activity order by query_start nulls last,pid limit 20
)
select pg_catalog.clock_timestamp() as checked_at_utc,
 (select jsonb_agg(jsonb_build_object('name',e.name,'exists',exists(select 1 from pg_catalog.pg_namespace n where n.nspname=e.name)) order by e.name) from expected_schemas e) as schemas,
 (select jsonb_agg(jsonb_build_object('name',e.name,'overload_count',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=e.name)) order by e.name) from expected_public_functions e) as public_functions,
 pg_catalog.current_setting('track_activities') as track_activities,
 pg_catalog.current_setting('track_activity_query_size') as query_text_capture_limit,
 pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE') as has_read_all_stats_role,
 (select count(*) from matching_activity) as matching_activity_count,
 (select count(*) from matching_activity where state='active') as matching_active_count,
 coalesce((select jsonb_agg(to_jsonb(a) order by query_age_seconds desc nulls last,pid) from bounded_activity a),'[]'::jsonb) as migration_like_activity;

-- ClickHouse, source postgres_logs; explicit UTC window 2026-11-24T16:06:00Z to 2026-11-24T16:40:00Z.
-- Key discovery returns field names and count only.
select arraySort(mapKeys(log_attributes)) as attribute_keys, count() as matching_log_count from logs where source = 'postgres_logs' group by attribute_keys limit 10;

-- Classification returns metadata and boolean indicators; no event_message text.
select severity_text, log_attributes['parsed.error_severity'] as postgres_severity,
 log_attributes['parsed.sql_state_code'] as sqlstate,
 log_attributes['parsed.backend_type'] as backend_type,
 match(lower(event_message),'genie_reporting_private|genie_question_safety_private|genie_result_reporting|genie_question_safety|vs_report_result|vs_report_question|vs_set_question_author_block|vs_clear_question_author_blocks|vs_shared_poll_guarded|vs_vote_guarded') as mentions_reviewed_migration,
 match(lower(event_message),'timeout|timed out') as mentions_timeout,
 match(lower(event_message),'canceling statement|cancelling statement|query canceled|query cancelled') as mentions_statement_cancel,
 match(lower(event_message),'connection reset|could not receive data from client|terminating connection|connection to client lost|unexpected eof|broken pipe') as mentions_connection_termination,
 count() as event_count, min(timestamp) as first_event_at, max(timestamp) as last_event_at
 from logs where source='postgres_logs'
 group by severity_text,postgres_severity,sqlstate,backend_type,mentions_reviewed_migration,mentions_timeout,mentions_statement_cancel,mentions_connection_termination
 order by first_event_at limit 25;

