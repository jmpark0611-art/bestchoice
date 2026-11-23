/** Actual HTTP checks for the unshipped report proposal in an owned disposable stack only. */
import { randomUUID } from 'node:crypto';
import { guard, assertBeforeVoteResponse, assertVoteResponse } from './verify-local-integration.mjs';

const ORIGIN = 'http://127.0.0.1:55321';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTES = new Set(['/auth/v1/signup', '/functions/v1/vs-decide', '/rest/v1/result_reports',
  ...['share', 'shared_poll', 'vote', 'delete_poll', 'report_result'].map(name => '/rest/v1/rpc/vs_' + name)]);
export const REPORT_CHECK_CODES = Object.freeze([
  'REPORT_QA_OWNERSHIP_REQUIRED', 'REPORT_QA_REQUEST_REFUSED', 'REPORT_QA_TRANSPORT_FAILED',
  'REPORT_QA_JSON_INVALID', 'REPORT_QA_RPC_NOT_READY', 'REPORT_QA_AUTH_FAILED',
  'REPORT_QA_SESSIONS_NOT_DISTINCT', 'REPORT_QA_DECISION_FAILED', 'REPORT_QA_SHARE_FAILED',
  'REPORT_QA_PREVOTE_VISIBILITY_FAILED', 'REPORT_QA_PREVOTE_DENIAL_FAILED',
  'REPORT_QA_FOREIGN_OWNER_DENIAL_FAILED', 'REPORT_QA_DIRECT_READ_DENIAL_FAILED',
  'REPORT_QA_DIRECT_WRITE_DENIAL_FAILED', 'REPORT_QA_AUDIT_SCOPE_INVALID',
  'REPORT_QA_AUDIT_INVALID', 'REPORT_QA_INITIAL_STATE_INVALID', 'REPORT_QA_RECEIPT_INVALID',
  'REPORT_QA_PARALLEL_REQUEST_FAILED', 'REPORT_QA_PARALLEL_RECEIPTS_DIFFER',
  'REPORT_QA_DUPLICATE_COUNT_OR_QUOTA', 'REPORT_QA_CONFLICT_DENIAL_FAILED',
  'REPORT_QA_CONSENT_DENIAL_FAILED', 'REPORT_QA_DENIAL_CHANGED_STATE',
  'REPORT_QA_VOTE_FAILED', 'REPORT_QA_VOTED_REPORT_FAILED', 'REPORT_QA_VOTED_COUNTS_INVALID',
  'REPORT_QA_DELETE_FAILED', 'REPORT_QA_CASCADE_OR_QUOTA_INVALID',
  'REPORT_QA_DELETED_REPORT_ACCESSIBLE',
]);
export const REPORT_HTTP_CHECKS = Object.freeze(['rpc-ready', 'signup', 'decision', 'share', 'pre-vote-read',
  'pre-vote-report', 'foreign-owner-report', 'direct-read', 'direct-write', 'parallel-owner-report',
  'payload-conflict', 'consent-denial', 'vote', 'voted-report', 'owner-delete', 'deleted-report', 'cleanup']);
const COUNT_KEYS = Object.freeze(['reportRows', 'ownerReports', 'voterReports', 'outsiderReports', 'requestRows',
  'ownerUsed', 'voterUsed', 'outsiderUsed', 'globalUsed']);
const must = (okay, code) => { if (!okay) throw new Error(code); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** UUID-only substitutions, delivered over psql stdin; this statement only returns counts. */
export function reportingAuditSql(scope) {
  const fields = ['pollId', 'ownerId', 'voterId', 'outsiderId', 'requestId'];
  must(record(scope) && fields.every(key => UUID.test(scope[key] ?? '')) &&
    new Set([scope.ownerId, scope.voterId, scope.outsiderId]).size === 3, 'REPORT_QA_AUDIT_SCOPE_INVALID');
  const quoted = key => "'" + scope[key] + "'::uuid";
  const rows = reporter => `(select count(*) from genie_reporting_private.result_reports
    where poll_id = ${quoted('pollId')}${reporter ? ' and reporter_id = ' + quoted(reporter) : ''})`;
  const quota = reporter => `(select coalesce(sum(used),0) from genie_reporting_private.user_daily_limits
    where reporter_id = ${quoted(reporter)} and day = (now() at time zone 'UTC')::date)`;
  return `select json_build_object(
    'reportRows', ${rows()}, 'ownerReports', ${rows('ownerId')},
    'voterReports', ${rows('voterId')}, 'outsiderReports', ${rows('outsiderId')},
    'requestRows', (select count(*) from genie_reporting_private.result_reports
      where reporter_id = ${quoted('ownerId')} and request_id = ${quoted('requestId')}),
    'ownerUsed', ${quota('ownerId')}, 'voterUsed', ${quota('voterId')}, 'outsiderUsed', ${quota('outsiderId')},
    'globalUsed', (select coalesce(sum(used),0) from genie_reporting_private.daily_limits
      where day = (now() at time zone 'UTC')::date));\n`;
}

/** Distinguish inaccessible HTTP schema from actual PostgreSQL role permissions. All role probes roll back. */
export const REPORT_ROLE_CHECK_SQL = `begin;
do $guard$
begin
  if has_table_privilege('anon', 'genie_reporting_private.result_reports', 'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated', 'genie_reporting_private.result_reports', 'SELECT,INSERT,UPDATE,DELETE') or
     has_function_privilege('anon', 'public.vs_report_result(uuid,text,text,boolean,uuid,text)', 'EXECUTE') or
     not has_function_privilege('authenticated', 'public.vs_report_result(uuid,text,text,boolean,uuid,text)', 'EXECUTE') or
     (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'genie_reporting_private' and c.relname in ('result_reports','user_daily_limits','daily_limits')
         and c.relrowsecurity) <> 3 then
    raise exception 'REPORT_ROLE_CONFIGURATION_INVALID';
  end if;
end $guard$;
set local role authenticated;
do $checks$
begin
  begin
    perform 1 from genie_reporting_private.result_reports;
    raise exception 'REPORT_DIRECT_READ_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    insert into genie_reporting_private.result_reports default values;
    raise exception 'REPORT_DIRECT_INSERT_ALLOWED';
  exception when insufficient_privilege then null; end;
end $checks$;
reset role;
select 'REPORT_ROLE_CHECKS_PASSED';
rollback;
`;

function assertReceipt(value, requestId) {
  must(record(value) && value.status === 'received' && UUID.test(value.receiptId ?? '') &&
    value.requestId === requestId && typeof value.receivedAt === 'string' && Number.isFinite(Date.parse(value.receivedAt)),
  'REPORT_QA_RECEIPT_INVALID');
  return value;
}
function assertCounts(value, owner, voter, code) {
  must(record(value) && COUNT_KEYS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0), 'REPORT_QA_AUDIT_INVALID');
  const wanted = { reportRows: owner + voter, ownerReports: owner, voterReports: voter, outsiderReports: 0,
    requestRows: owner, ownerUsed: owner, voterUsed: voter, outsiderUsed: 0, globalUsed: owner + voter };
  must(COUNT_KEYS.every(key => value[key] === wanted[key]), code);
}

/** No runtime side effects on import. Caller must verify its DB/network ownership before every audit. */
export async function verifyLocalReporting(env, mode, {
  send = fetch, verifyOwnership, inspectState, observe = () => {},
} = {}) {
  const key = guard(env, mode);
  must(typeof verifyOwnership === 'function' && typeof inspectState === 'function', 'REPORT_QA_OWNERSHIP_REQUIRED');
  await verifyOwnership();
  let number = 0;
  const req = async (check, route, body, token, method = 'POST', privateProfile = false) => {
    must(REPORT_HTTP_CHECKS.includes(check) && ROUTES.has(route) &&
      (method === 'POST' || (method === 'GET' && route === '/rest/v1/result_reports')) &&
      privateProfile === (route === '/rest/v1/result_reports'), 'REPORT_QA_REQUEST_REFUSED');
    const entry = { number: ++number, check, method, route, status: null };
    try {
      const result = await send(new URL(route, ORIGIN), { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: key, Authorization: 'Bearer ' + (token ?? key), 'Content-Type': 'application/json',
          ...(privateProfile ? { [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: 'genie_reporting_private' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      entry.status = Number.isInteger(result.status) ? result.status : null; observe(entry);
      return result;
    } catch { observe({ ...entry, transportFailed: true }); throw new Error('REPORT_QA_TRANSPORT_FAILED'); }
  };
  const json = async response => {
    try { return await response.json(); } catch { throw new Error('REPORT_QA_JSON_INVALID'); }
  };
  const success = async (response, code) => { must(response.status === 200, code); return json(response); };
  const denied = async (response, status, code, message, failure) => {
    must(response.status === status, failure);
    const value = await json(response);
    must(record(value) && value.code === code && (message === undefined || value.message === message), failure);
  };
  const report = (requestId, pollId, shareCode, overrides = {}) => ({ p_request_id: requestId,
    p_category: 'incorrect', p_details: 'Synthetic local reporting check.', p_consent: true,
    p_poll_id: pollId, p_share_code: shareCode, ...overrides });
  const rpc = (name, body, token, check) => req(check, '/rest/v1/rpc/vs_' + name, body, token);

  // NOTIFY can finish before PostgREST's schema reload. Only its precise missing-
  // function response is retried; no users or records exist yet.
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    const response = await rpc('report_result', report(randomUUID(), null, null), undefined, 'rpc-ready');
    const value = await json(response);
    ready = response.status === 401 && value?.code === '42501';
    if (!ready) {
      must(response.status === 404 && value?.code === 'PGRST202', 'REPORT_QA_RPC_NOT_READY');
      await delay(100);
    }
  }
  must(ready, 'REPORT_QA_RPC_NOT_READY');

  let pollId, ownerToken, deleted = false;
  try {
    const users = [];
    for (let i = 0; i < 3; i++) users.push(await success(await req('signup', '/auth/v1/signup', { data: {} }), 'REPORT_QA_AUTH_FAILED'));
    must(users.every(value => value.user?.is_anonymous === true && UUID.test(value.user?.id ?? '') &&
      typeof value.access_token === 'string' && value.access_token.length > 0) &&
      new Set(users.map(value => value.user.id)).size === 3 && new Set(users.map(value => value.access_token)).size === 3,
    'REPORT_QA_SESSIONS_NOT_DISTINCT');
    const [owner, voter, outsider] = users;
    ownerToken = owner.access_token;
    const marker = 'QA ' + randomUUID().slice(0, 8);
    const decision = await success(await req('decision', '/functions/v1/vs-decide',
      { a: marker + ' A', b: marker + ' B', note: '' }, ownerToken), 'REPORT_QA_DECISION_FAILED');
    must(decision.kind === 'pick' && UUID.test(decision.id ?? ''), 'REPORT_QA_DECISION_FAILED');
    pollId = decision.id;
    const shareCode = await success(await rpc('share', { p_id: pollId }, ownerToken, 'share'), 'REPORT_QA_SHARE_FAILED');
    must(typeof shareCode === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(shareCode), 'REPORT_QA_SHARE_FAILED');
    try { assertBeforeVoteResponse(await success(await rpc('shared_poll', { p_code: shareCode }, voter.access_token,
      'pre-vote-read'), 'REPORT_QA_PREVOTE_VISIBILITY_FAILED')); } catch { throw new Error('REPORT_QA_PREVOTE_VISIBILITY_FAILED'); }
    await denied(await rpc('report_result', report(randomUUID(), null, shareCode), voter.access_token, 'pre-vote-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'REPORT_QA_PREVOTE_DENIAL_FAILED');
    await denied(await rpc('report_result', report(randomUUID(), pollId, null), outsider.access_token, 'foreign-owner-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'REPORT_QA_FOREIGN_OWNER_DENIAL_FAILED');
    await denied(await req('direct-read', '/rest/v1/result_reports', undefined, ownerToken, 'GET', true),
      406, 'PGRST106', undefined, 'REPORT_QA_DIRECT_READ_DENIAL_FAILED');
    await denied(await req('direct-write', '/rest/v1/result_reports', {}, ownerToken, 'POST', true),
      406, 'PGRST106', undefined, 'REPORT_QA_DIRECT_WRITE_DENIAL_FAILED');

    const requestId = randomUUID();
    const scope = { pollId, ownerId: owner.user.id, voterId: voter.user.id, outsiderId: outsider.user.id, requestId };
    reportingAuditSql(scope); // Validate before exposing the scope to the privileged read-only callback.
    const audit = async () => { await verifyOwnership(); return inspectState(scope); };
    assertCounts(await audit(), 0, 0, 'REPORT_QA_INITIAL_STATE_INVALID');

    const ownerPayload = report(requestId, pollId, null);
    // Two HTTP requests are dispatched before awaiting either. This exercises
    // actual parallel clients, without claiming all possible database schedules.
    const outcomes = await Promise.allSettled([1, 2].map(async () => assertReceipt(await success(
      await rpc('report_result', ownerPayload, ownerToken, 'parallel-owner-report'),
      'REPORT_QA_PARALLEL_REQUEST_FAILED'), requestId)));
    const failed = outcomes.find(result => result.status === 'rejected');
    if (failed) throw new Error(REPORT_CHECK_CODES.includes(failed.reason?.message)
      ? failed.reason.message : 'REPORT_QA_PARALLEL_REQUEST_FAILED');
    const receipts = outcomes.map(result => result.value);
    must(['status', 'receiptId', 'requestId', 'receivedAt'].every(key => receipts[0][key] === receipts[1][key]),
      'REPORT_QA_PARALLEL_RECEIPTS_DIFFER');
    assertCounts(await audit(), 1, 0, 'REPORT_QA_DUPLICATE_COUNT_OR_QUOTA');

    await denied(await rpc('report_result', { ...ownerPayload, p_details: 'Changed synthetic details.' }, ownerToken, 'payload-conflict'),
      400, '22023', 'REPORT_REQUEST_CONFLICT', 'REPORT_QA_CONFLICT_DENIAL_FAILED');
    await denied(await rpc('report_result', { ...ownerPayload, p_consent: false }, ownerToken, 'consent-denial'),
      400, '22023', 'REPORT_INVALID', 'REPORT_QA_CONSENT_DENIAL_FAILED');
    assertCounts(await audit(), 1, 0, 'REPORT_QA_DENIAL_CHANGED_STATE');

    try { assertVoteResponse(await success(await rpc('vote', { p_code: shareCode, p_choice: 'a' }, voter.access_token,
      'vote'), 'REPORT_QA_VOTE_FAILED')); } catch { throw new Error('REPORT_QA_VOTE_FAILED'); }
    const voterRequest = randomUUID();
    assertReceipt(await success(await rpc('report_result', report(voterRequest, null, shareCode), voter.access_token,
      'voted-report'), 'REPORT_QA_VOTED_REPORT_FAILED'), voterRequest);
    assertCounts(await audit(), 1, 1, 'REPORT_QA_VOTED_COUNTS_INVALID');

    must((await rpc('delete_poll', { p_id: pollId }, ownerToken, 'owner-delete')).ok, 'REPORT_QA_DELETE_FAILED');
    const after = await audit();
    must(record(after) && COUNT_KEYS.every(key => Number.isSafeInteger(after[key]) && after[key] >= 0), 'REPORT_QA_AUDIT_INVALID');
    must(after.reportRows === 0 && after.ownerReports === 0 && after.voterReports === 0 && after.outsiderReports === 0 &&
      after.requestRows === 0 && after.ownerUsed === 1 && after.voterUsed === 1 && after.outsiderUsed === 0 && after.globalUsed === 2,
    'REPORT_QA_CASCADE_OR_QUOTA_INVALID');
    await denied(await rpc('report_result', ownerPayload, ownerToken, 'deleted-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'REPORT_QA_DELETED_REPORT_ACCESSIBLE');
    await verifyOwnership();
    deleted = true;
    return { actualHttp: true, syntheticSessions: 3, anonymousRpcDenied: true, preVoteAndForeignOwnerDenied: true,
      directHttpPrivateSchemaDenied: true, ownerAndVotedGuestReceipts: true,
      parallelHttpRequests: 2, identicalServerReceipts: true, ownerRowsAfterParallel: 1,
      ownerQuotaAfterParallel: 1, globalQuotaAfterParallel: 1, changedPayloadAndMissingConsentDenied: true,
      rowsAfterSourceDeletion: 0, quotasRetainedAfterDeletion: true, allDatabaseSchedulesClaimed: false };
  } finally {
    if (pollId && ownerToken && !deleted) {
      try { await verifyOwnership(); await rpc('delete_poll', { p_id: pollId }, ownerToken, 'cleanup'); } catch {}
      // The runtime must discard its owned volume even when this request is uncertain.
    }
  }
}
