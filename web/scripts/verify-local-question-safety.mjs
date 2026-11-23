/** New question reporting and personal author blocking, only in an owned disposable stack. */
import { randomUUID } from 'node:crypto';
import { guard, assertBeforeVoteResponse, assertVoteResponse } from './verify-local-integration.mjs';

const ORIGIN = 'http://127.0.0.1:55321';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPCS = ['share', 'delete_poll', 'report_question', 'set_question_author_block',
  'clear_question_author_blocks', 'shared_poll_guarded', 'vote_guarded'];
const ROUTES = new Set(['/auth/v1/signup', '/functions/v1/vs-decide', '/rest/v1/question_reports',
  ...RPCS.map(name => '/rest/v1/rpc/vs_' + name)]);
export const QUESTION_CHECK_CODES = Object.freeze([
  'QUESTION_QA_OWNERSHIP_REQUIRED', 'QUESTION_QA_REQUEST_REFUSED', 'QUESTION_QA_TRANSPORT_FAILED',
  'QUESTION_QA_JSON_INVALID', 'QUESTION_QA_RPC_NOT_READY', 'QUESTION_QA_AUTH_FAILED',
  'QUESTION_QA_SESSIONS_NOT_DISTINCT', 'QUESTION_QA_DECISION_FAILED', 'QUESTION_QA_SHARE_FAILED',
  'QUESTION_QA_PREVOTE_PRIVACY_FAILED', 'QUESTION_QA_OWNER_REPORT_DENIAL_FAILED',
  'QUESTION_QA_UNKNOWN_REPORT_DENIAL_FAILED', 'QUESTION_QA_DIRECT_READ_DENIAL_FAILED',
  'QUESTION_QA_DIRECT_WRITE_DENIAL_FAILED', 'QUESTION_QA_AUDIT_SCOPE_INVALID',
  'QUESTION_QA_AUDIT_INVALID', 'QUESTION_QA_STATE_MISMATCH', 'QUESTION_QA_RECEIPT_INVALID',
  'QUESTION_QA_PARALLEL_REQUEST_FAILED', 'QUESTION_QA_PARALLEL_RECEIPTS_DIFFER',
  'QUESTION_QA_DUPLICATE_COUNT_OR_QUOTA', 'QUESTION_QA_CONFLICT_DENIAL_FAILED',
  'QUESTION_QA_CONSENT_DENIAL_FAILED', 'QUESTION_QA_DENIAL_CHANGED_STATE',
  'QUESTION_QA_SELF_BLOCK_DENIAL_FAILED', 'QUESTION_QA_BLOCK_RESPONSE_INVALID',
  'QUESTION_QA_BLOCKED_READ_ALLOWED', 'QUESTION_QA_BLOCKED_VOTE_ALLOWED',
  'QUESTION_QA_VOTE_FAILED', 'QUESTION_QA_REPORT_FAILED', 'QUESTION_QA_REPORT_LIMIT_FAILED',
  'QUESTION_QA_DELETE_FAILED', 'QUESTION_QA_CASCADE_OR_QUOTA_INVALID',
  'QUESTION_QA_DELETED_REPORT_ACCESSIBLE', 'QUESTION_QA_CLEAR_SCOPE_FAILED',
]);
export const QUESTION_HTTP_CHECKS = Object.freeze(['rpc-ready', 'signup', 'decision', 'share', 'pre-vote-read',
  'owner-report', 'unknown-report', 'direct-read', 'direct-write', 'parallel-question-report',
  'payload-conflict', 'consent-denial', 'self-block', 'block', 'blocked-read', 'blocked-vote',
  'other-user-read', 'unblock', 'vote', 'voted-report', 'quota-fill', 'quota-limit',
  'owner-delete', 'deleted-report', 'clear-blocks', 'after-clear-read', 'cleanup']);
const COUNT_KEYS = Object.freeze(['reportRows', 'requestRows', 'ownerUsed', 'viewerUsed', 'otherViewerUsed',
  'globalUsed', 'viewerBlocks', 'otherViewerBlocks', 'viewerVotes', 'otherViewerVotes']);
const must = (okay, code) => { if (!okay) throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Only validated synthetic identifiers enter stdin SQL. Returned values are counts, never row contents. */
export function questionSafetyAuditSql(scope) {
  const fields = ['pollId', 'otherPollId', 'ownerId', 'viewerId', 'otherViewerId', 'requestId'];
  must(record(scope) && fields.every(key => UUID.test(scope[key] ?? '')) &&
    new Set([scope.ownerId, scope.viewerId, scope.otherViewerId]).size === 3 && scope.pollId !== scope.otherPollId,
  'QUESTION_QA_AUDIT_SCOPE_INVALID');
  const q = name => "'" + scope[name] + "'::uuid";
  const polls = '(' + q('pollId') + ',' + q('otherPollId') + ')';
  const quota = name => `(select coalesce(sum(used),0) from genie_question_safety_private.user_daily_limits
    where reporter_id = ${q(name)} and day = (now() at time zone 'UTC')::date)`;
  const blocks = name => `(select count(*) from genie_question_safety_private.author_blocks where blocker_id = ${q(name)})`;
  const votes = name => `(select count(*) from public.vs_votes where poll_id in ${polls} and voter_id = ${q(name)})`;
  return `select json_build_object(
    'reportRows', (select count(*) from genie_question_safety_private.question_reports where poll_id in ${polls}),
    'requestRows', (select count(*) from genie_question_safety_private.question_reports
      where reporter_id = ${q('viewerId')} and request_id = ${q('requestId')}),
    'ownerUsed', ${quota('ownerId')}, 'viewerUsed', ${quota('viewerId')}, 'otherViewerUsed', ${quota('otherViewerId')},
    'globalUsed', (select coalesce(sum(used),0) from genie_question_safety_private.daily_limits
      where day = (now() at time zone 'UTC')::date),
    'viewerBlocks', ${blocks('viewerId')}, 'otherViewerBlocks', ${blocks('otherViewerId')},
    'viewerVotes', ${votes('viewerId')}, 'otherViewerVotes', ${votes('otherViewerId')});\n`;
}

/** Actual database role denial is distinct from an unexposed HTTP schema. No mutation survives this transaction. */
export const QUESTION_ROLE_CHECK_SQL = `begin;
do $guard$
declare t text; f text;
begin
  foreach t in array array['question_reports','user_daily_limits','daily_limits','author_blocks'] loop
    if has_table_privilege('anon', 'genie_question_safety_private.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
       has_table_privilege('authenticated', 'genie_question_safety_private.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'QUESTION_ROLE_CONFIGURATION_INVALID';
    end if;
  end loop;
  foreach f in array array['vs_report_question(uuid,text,text,boolean,text)', 'vs_set_question_author_block(text,boolean)',
    'vs_clear_question_author_blocks()', 'vs_shared_poll_guarded(text)', 'vs_vote_guarded(text,text)'] loop
    if has_function_privilege('anon', 'public.' || f, 'EXECUTE') or
       not has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') then
      raise exception 'QUESTION_ROLE_CONFIGURATION_INVALID';
    end if;
  end loop;
  if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='genie_question_safety_private' and c.relkind='r' and c.relrowsecurity) <> 4 or
     exists(select 1 from pg_catalog.pg_policies where schemaname='genie_question_safety_private') or
     (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='genie_question_safety_private' and p.prosecdef and p.proconfig @> array['search_path=""']) <> 6 or
     exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace,
       lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       where n.nspname='genie_question_safety_private' and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'QUESTION_ROLE_CONFIGURATION_INVALID';
  end if;
end $guard$;
set local role authenticated;
do $checks$
declare t text;
begin
  foreach t in array array['question_reports','user_daily_limits','daily_limits','author_blocks'] loop
    begin
      execute format('select 1 from genie_question_safety_private.%I', t);
      raise exception 'QUESTION_DIRECT_READ_ALLOWED';
    exception when insufficient_privilege then null; end;
    begin
      execute format('insert into genie_question_safety_private.%I default values', t);
      raise exception 'QUESTION_DIRECT_INSERT_ALLOWED';
    exception when insufficient_privilege then null; end;
  end loop;
end $checks$;
reset role;
select 'QUESTION_ROLE_CHECKS_PASSED';
rollback;
`;

function receipt(value, requestId) {
  must(record(value) && Object.keys(value).sort().join(',') === 'receiptId,receivedAt,requestId,status' &&
    value.status === 'received' && UUID.test(value.receiptId ?? '') && value.requestId === requestId &&
    typeof value.receivedAt === 'string' && Number.isFinite(Date.parse(value.receivedAt)), 'QUESTION_QA_RECEIPT_INVALID');
  return value;
}
function blockStatus(value, status) {
  must(record(value) && Object.keys(value).length === 1 && value.status === status, 'QUESTION_QA_BLOCK_RESPONSE_INVALID');
}
function beforeVote(value) {
  try {
    assertBeforeVoteResponse(value);
    must(Object.keys(value).every(key => ['id','a','b','note','isOwner','myVote','shareCode','did','createdAt'].includes(key)),
      'QUESTION_QA_PREVOTE_PRIVACY_FAILED');
  } catch { throw new Error('QUESTION_QA_PREVOTE_PRIVACY_FAILED'); }
}

/** The caller must prove nonce/container/network ownership before every HTTP request and privileged count read. */
export async function verifyLocalQuestionSafety(env, mode, {
  send = fetch, verifyOwnership, inspectState, observe = () => {},
} = {}) {
  const key = guard(env, mode);
  must(typeof verifyOwnership === 'function' && typeof inspectState === 'function', 'QUESTION_QA_OWNERSHIP_REQUIRED');
  await verifyOwnership();
  let number = 0;
  const req = async (check, route, body, token, method = 'POST', privateProfile = false) => {
    must(QUESTION_HTTP_CHECKS.includes(check) && ROUTES.has(route) &&
      (method === 'POST' || (method === 'GET' && route === '/rest/v1/question_reports')) &&
      privateProfile === (route === '/rest/v1/question_reports'), 'QUESTION_QA_REQUEST_REFUSED');
    await verifyOwnership();
    const entry = { number: ++number, check, method, route, status: null };
    let result;
    try {
      result = await send(new URL(route, ORIGIN), { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: key, Authorization: 'Bearer ' + (token ?? key), 'Content-Type': 'application/json',
          ...(privateProfile ? { [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: 'genie_question_safety_private' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      entry.status = Number.isInteger(result.status) ? result.status : null; observe(entry);
    } catch { observe({ ...entry, transportFailed: true }); throw new Error('QUESTION_QA_TRANSPORT_FAILED'); }
    await verifyOwnership();
    return result;
  };
  const json = async response => { try { return await response.json(); } catch { throw new Error('QUESTION_QA_JSON_INVALID'); } };
  const success = async (response, code) => { must(response.status === 200, code); return json(response); };
  const denied = async (response, status, code, message, failure) => {
    must(response.status === status, failure); const value = await json(response);
    must(record(value) && value.code === code && (message === undefined || value.message === message), failure);
  };
  const rpc = (name, body, token, check) => req(check, '/rest/v1/rpc/vs_' + name, body, token);
  const report = (requestId, shareCode, overrides = {}) => ({ p_request_id: requestId, p_category: 'unsafe',
    p_details: 'Synthetic local question report.', p_consent: true, p_share_code: shareCode, ...overrides });

  // Anonymous permission denial proves all five new RPC signatures reached PostgREST.
  const readyInputs = { report_question: report(randomUUID(), 'synthetic-ready'),
    set_question_author_block: { p_share_code: 'synthetic-ready', p_blocked: true }, clear_question_author_blocks: {},
    shared_poll_guarded: { p_code: 'synthetic-ready' }, vote_guarded: { p_code: 'synthetic-ready', p_choice: 'a' } };
  for (const [name, body] of Object.entries(readyInputs)) {
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      const response = await rpc(name, body, undefined, 'rpc-ready'), value = await json(response);
      ready = response.status === 401 && value?.code === '42501';
      if (!ready) { must(response.status === 404 && value?.code === 'PGRST202', 'QUESTION_QA_RPC_NOT_READY'); await delay(100); }
    }
    must(ready, 'QUESTION_QA_RPC_NOT_READY');
  }

  let ownerToken;
  const ownedPolls = new Set();
  try {
    const users = [];
    for (let i = 0; i < 3; i++) users.push(await success(await req('signup', '/auth/v1/signup', { data: {} }), 'QUESTION_QA_AUTH_FAILED'));
    must(users.every(user => user.user?.is_anonymous === true && UUID.test(user.user?.id ?? '') &&
      typeof user.access_token === 'string' && user.access_token.length > 0) &&
      new Set(users.map(user => user.user.id)).size === 3 && new Set(users.map(user => user.access_token)).size === 3,
    'QUESTION_QA_SESSIONS_NOT_DISTINCT');
    const [owner, viewer, other] = users;
    ownerToken = owner.access_token;
    const polls = [];
    for (let i = 0; i < 2; i++) {
      const marker = 'QA ' + randomUUID().slice(0, 8);
      const decision = await success(await req('decision', '/functions/v1/vs-decide',
        { a: marker + ' A', b: marker + ' B', note: '' }, ownerToken), 'QUESTION_QA_DECISION_FAILED');
      must(decision.kind === 'pick' && UUID.test(decision.id ?? '') && !ownedPolls.has(decision.id), 'QUESTION_QA_DECISION_FAILED');
      ownedPolls.add(decision.id);
      const code = await success(await rpc('share', { p_id: decision.id }, ownerToken, 'share'), 'QUESTION_QA_SHARE_FAILED');
      must(typeof code === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(code), 'QUESTION_QA_SHARE_FAILED');
      polls.push({ id: decision.id, code });
    }
    must(polls[0].code !== polls[1].code, 'QUESTION_QA_SHARE_FAILED');
    const [poll, otherPoll] = polls;
    const requestId = randomUUID(), payload = report(requestId, poll.code);
    const scope = { pollId: poll.id, otherPollId: otherPoll.id, ownerId: owner.user.id,
      viewerId: viewer.user.id, otherViewerId: other.user.id, requestId };
    questionSafetyAuditSql(scope);
    let wanted = Object.fromEntries(COUNT_KEYS.map(key => [key, 0]));
    const audit = async (changes = {}, code = 'QUESTION_QA_STATE_MISMATCH') => {
      wanted = { ...wanted, ...changes }; await verifyOwnership(); const state = await inspectState(scope);
      must(record(state) && COUNT_KEYS.every(key => Number.isSafeInteger(state[key]) && state[key] >= 0), 'QUESTION_QA_AUDIT_INVALID');
      must(COUNT_KEYS.every(key => state[key] === wanted[key]), code);
    };
    const read = async (code, token, check = 'pre-vote-read') => success(await rpc('shared_poll_guarded',
      { p_code: code }, token, check), 'QUESTION_QA_PREVOTE_PRIVACY_FAILED');
    const setBlock = async (code, token, blocked, check = blocked ? 'block' : 'unblock') => blockStatus(await success(
      await rpc('set_question_author_block', { p_share_code: code, p_blocked: blocked }, token, check),
      'QUESTION_QA_BLOCK_RESPONSE_INVALID'), blocked ? 'blocked' : 'unblocked');
    const clear = async token => blockStatus(await success(await rpc('clear_question_author_blocks', {}, token,
      'clear-blocks'), 'QUESTION_QA_CLEAR_SCOPE_FAILED'), 'cleared');
    const blocked = async (code, token) => {
      await denied(await rpc('shared_poll_guarded', { p_code: code }, token, 'blocked-read'),
        403, '42501', 'AUTHOR_BLOCKED', 'QUESTION_QA_BLOCKED_READ_ALLOWED');
      await denied(await rpc('vote_guarded', { p_code: code, p_choice: 'a' }, token, 'blocked-vote'),
        403, '42501', 'AUTHOR_BLOCKED', 'QUESTION_QA_BLOCKED_VOTE_ALLOWED');
    };
    beforeVote(await read(poll.code, viewer.access_token));
    await denied(await rpc('report_question', payload, ownerToken, 'owner-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'QUESTION_QA_OWNER_REPORT_DENIAL_FAILED');
    await denied(await rpc('report_question', report(randomUUID(), 'missing-' + randomUUID()), viewer.access_token, 'unknown-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'QUESTION_QA_UNKNOWN_REPORT_DENIAL_FAILED');
    await denied(await req('direct-read', '/rest/v1/question_reports', undefined, viewer.access_token, 'GET', true),
      406, 'PGRST106', undefined, 'QUESTION_QA_DIRECT_READ_DENIAL_FAILED');
    await denied(await req('direct-write', '/rest/v1/question_reports', {}, viewer.access_token, 'POST', true),
      406, 'PGRST106', undefined, 'QUESTION_QA_DIRECT_WRITE_DENIAL_FAILED');
    await audit();

    const outcomes = await Promise.allSettled([1, 2].map(async () => receipt(await success(
      await rpc('report_question', payload, viewer.access_token, 'parallel-question-report'),
      'QUESTION_QA_PARALLEL_REQUEST_FAILED'), requestId)));
    const failed = outcomes.find(result => result.status === 'rejected');
    if (failed) throw new Error(QUESTION_CHECK_CODES.includes(failed.reason?.message)
      ? failed.reason.message : 'QUESTION_QA_PARALLEL_REQUEST_FAILED');
    const receipts = outcomes.map(result => result.value);
    must(['status','receiptId','requestId','receivedAt'].every(key => receipts[0][key] === receipts[1][key]),
      'QUESTION_QA_PARALLEL_RECEIPTS_DIFFER');
    await audit({ reportRows: 1, requestRows: 1, viewerUsed: 1, globalUsed: 1 }, 'QUESTION_QA_DUPLICATE_COUNT_OR_QUOTA');
    beforeVote(await read(poll.code, viewer.access_token));
    await denied(await rpc('report_question', { ...payload, p_details: 'Changed synthetic question details.' }, viewer.access_token,
      'payload-conflict'), 400, '22023', 'REPORT_REQUEST_CONFLICT', 'QUESTION_QA_CONFLICT_DENIAL_FAILED');
    await denied(await rpc('report_question', { ...payload, p_consent: false }, viewer.access_token, 'consent-denial'),
      400, '22023', 'REPORT_INVALID', 'QUESTION_QA_CONSENT_DENIAL_FAILED');
    await audit({}, 'QUESTION_QA_DENIAL_CHANGED_STATE');
    await denied(await rpc('set_question_author_block', { p_share_code: poll.code, p_blocked: true }, ownerToken, 'self-block'),
      403, '42501', 'BLOCK_SELF_NOT_ALLOWED', 'QUESTION_QA_SELF_BLOCK_DENIAL_FAILED');
    await setBlock(poll.code, viewer.access_token, true);
    await setBlock(poll.code, viewer.access_token, true);
    await blocked(poll.code, viewer.access_token); await blocked(otherPoll.code, viewer.access_token);
    beforeVote(await read(poll.code, other.access_token, 'other-user-read'));
    await audit({ viewerBlocks: 1 });
    await setBlock(poll.code, viewer.access_token, false); await setBlock(poll.code, viewer.access_token, false);
    beforeVote(await read(poll.code, viewer.access_token));
    try { assertVoteResponse(await success(await rpc('vote_guarded', { p_code: poll.code, p_choice: 'a' },
      viewer.access_token, 'vote'), 'QUESTION_QA_VOTE_FAILED')); } catch { throw new Error('QUESTION_QA_VOTE_FAILED'); }
    const votedRequest = randomUUID();
    receipt(await success(await rpc('report_question', report(votedRequest, poll.code), viewer.access_token,
      'voted-report'), 'QUESTION_QA_REPORT_FAILED'), votedRequest);
    await audit({ viewerBlocks: 0, viewerVotes: 1, reportRows: 2, viewerUsed: 2, globalUsed: 2 });
    for (let i = 2; i < 10; i++) {
      const id = randomUUID(); receipt(await success(await rpc('report_question', report(id, poll.code),
        viewer.access_token, 'quota-fill'), 'QUESTION_QA_REPORT_FAILED'), id);
    }
    await denied(await rpc('report_question', report(randomUUID(), poll.code), viewer.access_token, 'quota-limit'),
      400, 'P0001', 'REPORT_LIMIT', 'QUESTION_QA_REPORT_LIMIT_FAILED');
    // Idempotent retries still work when the daily quota has been reached.
    const retried = receipt(await success(await rpc('report_question', payload, viewer.access_token,
      'voted-report'), 'QUESTION_QA_REPORT_FAILED'), requestId);
    must(['status','receiptId','requestId','receivedAt'].every(key => retried[key] === receipts[0][key]),
      'QUESTION_QA_PARALLEL_RECEIPTS_DIFFER');
    await audit({ reportRows: 10, viewerUsed: 10, globalUsed: 10 });
    await setBlock(poll.code, viewer.access_token, true); await setBlock(otherPoll.code, other.access_token, true);
    must((await rpc('delete_poll', { p_id: poll.id }, ownerToken, 'owner-delete')).ok, 'QUESTION_QA_DELETE_FAILED');
    ownedPolls.delete(poll.id);
    await audit({ reportRows: 0, requestRows: 0, viewerVotes: 0, viewerBlocks: 1, otherViewerBlocks: 1 },
      'QUESTION_QA_CASCADE_OR_QUOTA_INVALID');
    await denied(await rpc('report_question', payload, viewer.access_token, 'deleted-report'),
      403, '42501', 'REPORT_NOT_ALLOWED', 'QUESTION_QA_DELETED_REPORT_ACCESSIBLE');
    await blocked(otherPoll.code, viewer.access_token);
    await clear(viewer.access_token); await clear(viewer.access_token);
    await audit({ viewerBlocks: 0 }, 'QUESTION_QA_CLEAR_SCOPE_FAILED');
    beforeVote(await read(otherPoll.code, viewer.access_token, 'after-clear-read'));
    await blocked(otherPoll.code, other.access_token);
    await clear(other.access_token); beforeVote(await read(otherPoll.code, other.access_token, 'after-clear-read'));
    must((await rpc('delete_poll', { p_id: otherPoll.id }, ownerToken, 'owner-delete')).ok, 'QUESTION_QA_DELETE_FAILED');
    ownedPolls.delete(otherPoll.id); await audit({ otherViewerBlocks: 0 }); await verifyOwnership();
    return { actualHttp: true, syntheticSessions: 3, syntheticPolls: 2, anonymousNewRpcsDenied: 5,
      preVoteQuestionReportReceived: true, hiddenAiResultRemainsHiddenAfterReport: true,
      ownerAndUnknownLinkDenied: true, directHttpPrivateSchemaDenied: true, parallelHttpRequests: 2,
      identicalServerReceipts: true, rowsAndUserAndGlobalQuotaAfterParallel: 1,
      consentAndChangedPayloadDenied: true, postVoteQuestionReportReceived: true,
      userDailyLimitVerified: 10, idempotentRetryAtLimitVerified: true,
      authorBlockIdempotent: true, otherAuthorLinksBlocked: true, blockedVoteDidNotWrite: true,
      otherUserUnaffected: true, selfBlockDenied: true, sameLinkUnblockVerified: true,
      sourceDeletionCascadesReportsOnly: true, quotaRetainedAfterSourceDeletion: true,
      authorBlockSurvivesSourceDeletion: true, clearAllOwnBlocksAfterLinkDeletion: true,
      clearAllLeavesOtherUsersBlocks: true, allDatabaseSchedulesClaimed: false,
      legacyRpcsChanged: false, legacyClientsCanBypassPreference: true,
      globalQuotaBoundaryHttpTested: false, blockCapBoundaryHttpTested: false };
  } finally {
    for (const id of ownedPolls) {
      try { await rpc('delete_poll', { p_id: id }, ownerToken, 'cleanup'); } catch {}
    }
    // Best effort on failure; the runtime must always remove this run's entire owned volume.
  }
}
