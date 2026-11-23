with expected_functions(signature,body_md5,body_characters,language,definer,auth_execute,result_type,arg_names) as (
values
('genie_reporting_private.submit_result_report(uuid,text,text,boolean,uuid,text)','0d8780a192c4ca52371a986cc50ef179',3716,'plpgsql',true,true,'jsonb',array['p_request_id','p_category','p_details','p_consent','p_poll_id','p_share_code']::text[]),
('public.vs_report_result(uuid,text,text,boolean,uuid,text)','c7cab5436a0a4f25b0ea19c1df641048',129,'sql',false,true,'jsonb',array['p_request_id','p_category','p_details','p_consent','p_poll_id','p_share_code']::text[]),
('genie_question_safety_private.submit_question_report(uuid,text,text,boolean,text)','dccf627560bb272c54821b7bf63252c1',3128,'plpgsql',true,true,'jsonb',array['p_request_id','p_category','p_details','p_consent','p_share_code']::text[]),
('genie_question_safety_private.set_author_block(text,boolean)','b6f6a5aba04e2abdc1e4343b36059e8e',1404,'plpgsql',true,true,'jsonb',array['p_share_code','p_blocked']::text[]),
('genie_question_safety_private.clear_author_blocks()','8ee43874b8de913e27bb596291d60c18',388,'plpgsql',true,true,'jsonb',array[]::text[]),
('genie_question_safety_private.assert_author_allowed(text)','88499582782cceef5a0583cdc0dcc6d4',818,'plpgsql',true,false,'void',array['p_code']::text[]),
('genie_question_safety_private.shared_poll_guarded(text)','b1f3661433654ba26d32b905007cbd10',122,'plpgsql',true,true,'jsonb',array['p_code']::text[]),
('genie_question_safety_private.vote_guarded(text,text)','e9f4c5d2ea1624856bbceabd228ea275',125,'plpgsql',true,true,'jsonb',array['p_code','p_choice']::text[]),
('public.vs_report_question(uuid,text,text,boolean,text)','1c72e2b35eea74098a3ed29cb1cbfc7d',120,'sql',false,true,'jsonb',array['p_request_id','p_category','p_details','p_consent','p_share_code']::text[]),
('public.vs_set_question_author_block(text,boolean)','49ef8a50dacf0ac8944bf2516ca8d7d7',80,'sql',false,true,'jsonb',array['p_share_code','p_blocked']::text[]),
('public.vs_clear_question_author_blocks()','92cbb0fc3e38eb8b11e74ddf290a0e31',61,'sql',false,true,'jsonb',array[]::text[]),
('public.vs_shared_poll_guarded(text)','3ff87dea2fa31bf4f0d9a34506c3db60',67,'sql',false,true,'jsonb',array['p_code']::text[]),
('public.vs_vote_guarded(text,text)','4efd5881788961efdd164af281209b89',69,'sql',false,true,'jsonb',array['p_code','p_choice']::text[])
),existing_functions(signature,body_md5,body_characters) as (
values
('public.vs_claim(uuid)','3e527d77cdd07e6e762c6b629f712dec',875),
('public.vs_poll_json(public.vs_polls,uuid)','2c2e689d88599f3103b52955ffdef59e',858),
('public.vs_my_poll(uuid)','d87800080660ccba2ea8aec692b25820',373),
('public.vs_share(uuid)','632772f742d01131f718d23d742c705f',683),
('public.vs_shared_poll(text)','5a9cbf86abff3e172d5bad3664fccd1e',380),
('public.vs_vote(text,text)','af4c5e177c35ad17289a30101ff09d9f',909),
('public.vs_set_did(uuid,text)','858627d6a0c120ed2fe7a4d1d8d428b1',414),
('public.vs_delete_poll(uuid)','62896e04aced60587a083faf82936aa7',202),
('public.vs_purge_expired()','ffabf01d1ef16f17ed9b1b19e343a4df',258)
),function_checks as (
select e.signature,p.oid is not null as present,pg_catalog.pg_get_userbyid(p.proowner) as owner,
pg_catalog.md5(p.prosrc) as body_md5,pg_catalog.char_length(p.prosrc) as body_characters,
l.lanname as language,p.prosecdef as security_definer,p.proconfig as config,
p.provolatile as volatility,p.proparallel as parallel,p.proisstrict as strict,
p.proleakproof as leakproof,p.proretset as returns_set,p.prokind as kind,
p.pronargdefaults as argument_defaults,p.proargnames as argument_names,
pg_catalog.oidvectortypes(p.proargtypes) as argument_types,pg_catalog.format_type(p.prorettype,null) as return_type,
case when p.oid is not null then pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') end as anon_execute,
case when p.oid is not null then pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_execute,
exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
'privilege',a.privilege_type,'grantable',a.is_grantable)
order by a.grantee,a.privilege_type) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb) as acl,
coalesce((select jsonb_agg(pg_catalog.pg_get_userbyid(a.grantee) order by a.grantee)
from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
where a.privilege_type='EXECUTE' and a.grantee not in(0,p.proowner)
and pg_catalog.pg_get_userbyid(a.grantee)<>'authenticated'),'[]'::jsonb) as additional_execute_grantees,
coalesce(p.oid is not null and pg_catalog.md5(p.prosrc)=e.body_md5 and pg_catalog.char_length(p.prosrc)=e.body_characters
and l.lanname=e.language and p.prosecdef=e.definer and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
and p.proconfig=array['search_path=""']::text[] and p.provolatile='v' and p.proparallel='u'
and not p.proisstrict and not p.proleakproof and not p.proretset and p.prokind='f' and p.pronargdefaults=0
and coalesce(p.proargnames,array[]::text[])=e.arg_names and pg_catalog.format_type(p.prorettype,null)=e.result_type
and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=e.auth_execute
and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
where a.grantee=0 and a.privilege_type='EXECUTE'),false) as expected_client_contract_matches
from expected_functions e left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
left join pg_catalog.pg_language l on l.oid=p.prolang
),tables_in_scope(name,is_new) as (
values
('genie_reporting_private.result_reports',true),
('genie_reporting_private.user_daily_limits',true),
('genie_reporting_private.daily_limits',true),
('genie_question_safety_private.question_reports',true),
('genie_question_safety_private.user_daily_limits',true),
('genie_question_safety_private.daily_limits',true),
('genie_question_safety_private.author_blocks',true),
('public.vs_polls',false),
('public.vs_votes',false),
('public.vs_user_limits',false),
('public.vs_daily_total',false)
),table_checks as (
select e.name,e.is_new,c.oid is not null as present,pg_catalog.pg_get_userbyid(c.relowner) as owner,
c.relkind as kind,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls,
coalesce((select jsonb_agg(jsonb_build_object('role',r.role,'privilege',v.privilege)
order by r.role,v.privilege) from (values('anon'),('authenticated')) r(role)
cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
where c.oid is not null and pg_catalog.has_table_privilege(r.role,c.oid,v.privilege)),'[]'::jsonb) as effective_client_privileges,
coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a),'[]'::jsonb) as acl,
coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,
'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) as columns,
coalesce((select jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,
'definition',pg_catalog.pg_get_constraintdef(k.oid,true),'validated',k.convalidated) order by k.conname)
from pg_catalog.pg_constraint k where k.conrelid=c.oid),'[]'::jsonb) as constraints,
coalesce((select jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_catalog.pg_get_indexdef(i.indexrelid),
'valid',i.indisvalid,'unique',i.indisunique,'primary',i.indisprimary) order by ic.relname)
from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),'[]'::jsonb) as indexes,
coalesce((select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
'roles',(select jsonb_agg(case when x=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x) end order by x) from unnest(p.polroles) x),
'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)
from pg_catalog.pg_policy p where p.polrelid=c.oid),'[]'::jsonb) as policies,
coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
'definition',pg_catalog.pg_get_triggerdef(t.oid,true)) order by t.tgname)
from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'[]'::jsonb) as custom_triggers,
coalesce((select jsonb_agg(jsonb_build_object('name',r.rulename,'definition',pg_catalog.pg_get_ruledef(r.oid,true)) order by r.rulename)
from pg_catalog.pg_rewrite r where r.ev_class=c.oid),'[]'::jsonb) as rules,
coalesce(c.oid is not null and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
and pg_catalog.pg_get_userbyid(c.relowner)='postgres'
and not pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
and not pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
and not exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where a.grantee=0)
and not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=c.oid),false) as new_table_client_contract_matches
from tables_in_scope e left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass(e.name)
),schema_checks as (
select e.name,n.oid is not null as present,pg_catalog.pg_get_userbyid(n.nspowner) as owner,
case when n.oid is not null then pg_catalog.has_schema_privilege('anon',n.oid,'USAGE') end as anon_usage,
case when n.oid is not null then pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE') end as authenticated_usage,
case when n.oid is not null then pg_catalog.has_schema_privilege('anon',n.oid,'CREATE') end as anon_create,
case when n.oid is not null then pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE') end as authenticated_create,
coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
from pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a),'[]'::jsonb) as acl,
coalesce(n.oid is not null and pg_catalog.pg_get_userbyid(n.nspowner)='postgres'
and not pg_catalog.has_schema_privilege('anon',n.oid,'USAGE,CREATE')
and pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE')
and not pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE')
and not exists(select 1 from pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a where a.grantee=0),false) as expected_client_contract_matches
from (values('genie_reporting_private'),('genie_question_safety_private')) e(name)
left join pg_catalog.pg_namespace n on n.nspname=e.name
),visible_api_settings as (
select 'current-session'::text as source,null::text as role,null::text as database,
current_setting('pgrst.db_schemas',true) as schemas
where current_setting('pgrst.db_schemas',true) is not null
union all
select 'pg_db_role_setting',case when s.setrole=0 then 'ALL' else pg_catalog.pg_get_userbyid(s.setrole) end,
case when s.setdatabase=0 then 'ALL' else d.datname end,substring(x from length('pgrst.db_schemas=')+1)
from pg_catalog.pg_db_role_setting s left join pg_catalog.pg_database d on d.oid=s.setdatabase
cross join lateral unnest(s.setconfig) x
where x like 'pgrst.db_schemas=%' and (s.setdatabase=0 or d.datname=current_database())
and (s.setrole=0 or pg_catalog.pg_get_userbyid(s.setrole) in('authenticator','anon','authenticated','postgres'))
)
select jsonb_build_object(
'metadataOnly',true,'applicationRowsRead',false,
'newFunctions',coalesce((select jsonb_agg(to_jsonb(f) order by signature) from function_checks f),'[]'::jsonb),
'newFunctionPresentCount',(select count(*) from function_checks where present),
'allNewFunctionClientContractsMatch',(select bool_and(expected_client_contract_matches) from function_checks),
'unexpectedNewScopeFunctions',coalesce((select jsonb_agg(n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' order by n.nspname,p.proname)
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname in('genie_reporting_private','genie_question_safety_private') or
(n.nspname='public' and p.proname in('vs_report_result','vs_report_question','vs_set_question_author_block','vs_clear_question_author_blocks','vs_shared_poll_guarded','vs_vote_guarded')))
and not exists(select 1 from expected_functions e where p.oid=pg_catalog.to_regprocedure(e.signature))),'[]'::jsonb),
'newTables',coalesce((select jsonb_agg(to_jsonb(t) order by name) from table_checks t where is_new),'[]'::jsonb),
'newTablePresentCount',(select count(*) from table_checks where is_new and present),
'allNewTableClientContractsMatch',(select bool_and(new_table_client_contract_matches) from table_checks where is_new),
'privateSchemas',(select jsonb_agg(to_jsonb(s) order by name) from schema_checks s),
'allPrivateSchemaClientContractsMatch',(select bool_and(expected_client_contract_matches) from schema_checks),
'existingVsFunctions',(select jsonb_agg(jsonb_build_object('signature',e.signature,'present',p.oid is not null,
'bodyMd5',pg_catalog.md5(p.prosrc),'bodyCharacters',pg_catalog.char_length(p.prosrc),
'bodyMatchesCanonical',coalesce(pg_catalog.md5(p.prosrc)=e.body_md5 and pg_catalog.char_length(p.prosrc)=e.body_characters,false),
'owner',pg_catalog.pg_get_userbyid(p.proowner)) order by e.signature)
from existing_functions e left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)),
'existingVsTables',(select jsonb_agg(to_jsonb(t)-'new_table_client_contract_matches' order by name) from table_checks t where not is_new),
'dataApiSchemasMetadata',jsonb_build_object('settings',coalesce((select jsonb_agg(to_jsonb(s) order by source,role,database) from visible_api_settings s),'[]'::jsonb),
'gatewayEffectiveSettingVerified',false,'absentSettingsMeanUnknown',true,
'privateSchemaNamedInVisibleSettings',(select bool_or(s.schemas ~ '(^|[,[:space:]"])(genie_reporting_private|genie_question_safety_private)([,[:space:]"]|$)') from visible_api_settings s))
) as catalog_verification;
