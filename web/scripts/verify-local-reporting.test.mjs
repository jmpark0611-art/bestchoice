import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyLocalReporting, reportingAuditSql } from './verify-local-reporting.mjs';

const origin = 'http://127.0.0.1:55321';
const env = () => ({ GENIE_SUPABASE_URL: origin, GENIE_CONFIRM: 'isolated-genie-synthetic-only',
  GENIE_SUPABASE_PUBLIC_KEY: 'sb_publishable_synthetic' });
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'];
const pollId = '44444444-4444-4444-8444-444444444444';
const shareCode = 'synthetic-share';
const tokens = ['private-owner-token', 'private-voter-token', 'private-outsider-token'];
const json = (value, status = 200) => Response.json(value, { status });
const denied = (message, status = 403, code = '42501') => json({ code, message }, status);

function fixture(fault = {}) {
  const requests = [], observed = [], reports = new Map();
  const state = { signups: 0, exists: false, voted: false, ownershipChecks: 0, cleanup: false,
    ownerUsed: 0, voterUsed: 0, globalUsed: 0, parallelStarted: 0, parallelActive: 0, maxParallel: 0 };
  let openParallel, notifyParallel;
  const parallel = new Promise(resolve => { openParallel = resolve; });
  const parallelStarted = new Promise(resolve => { notifyParallel = resolve; });
  const send = async (url, options) => {
    assert.equal(url.origin, origin); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    const token = options.headers.Authorization.slice(7);
    const reporter = tokens.indexOf(token);
    const route = url.pathname;
    requests.push({ route, method: options.method });
    if (route === '/auth/v1/signup') {
      const at = state.signups++;
      return json({ user: { id: ids[at], is_anonymous: true }, access_token: tokens[at] });
    }
    if (route === '/functions/v1/vs-decide') {
      assert.equal(reporter, 0); assert.match(body.a, /^QA [0-9a-f]{8} A$/); assert.equal(body.note, '');
      state.exists = true; return json({ kind: 'pick', id: pollId });
    }
    if (route === '/rest/v1/result_reports') {
      assert.equal(options.headers[options.method === 'GET' ? 'Accept-Profile' : 'Content-Profile'], 'genie_reporting_private');
      return denied('Private schema is not exposed', 406, 'PGRST106');
    }
    if (route === '/rest/v1/rpc/vs_share') return json(shareCode);
    if (route === '/rest/v1/rpc/vs_shared_poll') return json({ id: null, shareCode: null,
      a: 'A', b: 'B', isOwner: false, myVote: null });
    if (route === '/rest/v1/rpc/vs_vote') {
      state.voted = true;
      return json({ id: null, shareCode: null, a: 'A', b: 'B', isOwner: false, myVote: 'a',
        pick: 'a', reason: 'Synthetic.', votes: { a: 1, b: 0 } });
    }
    if (route === '/rest/v1/rpc/vs_delete_poll') {
      state.cleanup = true; state.exists = false; if (!fault.missingCascade) reports.clear();
      if (fault.refundQuota) { state.ownerUsed = 0; state.voterUsed = 0; state.globalUsed = 0; }
      return new Response(null, { status: 204 });
    }
    assert.equal(route, '/rest/v1/rpc/vs_report_result');
    if (reporter < 0) return denied('Permission denied', 401);
    if (!body.p_consent) return denied('REPORT_INVALID', 400, '22023');
    if (!state.exists || (body.p_poll_id !== null ? reporter !== 0 : reporter !== 1 || !state.voted)) {
      return denied('REPORT_NOT_ALLOWED');
    }
    const key = reporter + ':' + body.p_request_id;
    if (reporter === 0 && state.parallelStarted < 2) {
      const at = ++state.parallelStarted;
      state.parallelActive++; state.maxParallel = Math.max(state.maxParallel, state.parallelActive);
      if (at === 2) { openParallel(); notifyParallel(); }
      await parallel;
      if (at === 1 && fault.firstParallelFails) { state.parallelActive--; return json({}, 503); }
      if (at === 2 && fault.secondGate) await fault.secondGate;
      state.parallelActive--;
    }
    const previous = reports.get(key);
    if (previous) {
      if (previous.details !== body.p_details) return denied('REPORT_REQUEST_CONFLICT', 400, '22023');
      if (fault.doubleQuota) { state.ownerUsed++; state.globalUsed++; }
      return json(previous.receipt);
    }
    const receipt = { status: 'received', receiptId: randomUUID(), requestId: body.p_request_id,
      receivedAt: '2026-11-23T11:30:00.000Z' };
    reports.set(key, { reporter, details: body.p_details, receipt });
    if (reporter === 0) state.ownerUsed++; else state.voterUsed++;
    state.globalUsed++;
    return json(receipt);
  };
  const options = {
    send, observe: entry => observed.push(entry),
    verifyOwnership: async () => { state.ownershipChecks++; if (fault.ownership) throw new Error('OWNERSHIP_UNCONFIRMED'); },
    inspectState: async scope => {
      assert.deepEqual([scope.ownerId, scope.voterId, scope.outsiderId], ids);
      assert.equal(scope.pollId, pollId);
      const values = [...reports.values()];
      return { reportRows: values.length, ownerReports: values.filter(value => value.reporter === 0).length,
        voterReports: values.filter(value => value.reporter === 1).length, outsiderReports: 0,
        requestRows: Number(reports.has('0:' + scope.requestId)), ownerUsed: state.ownerUsed,
        voterUsed: state.voterUsed, outsiderUsed: 0, globalUsed: state.globalUsed };
    },
  };
  return { state, requests, observed, options, reports, parallelStarted,
    run: () => verifyLocalReporting(env(), '--run', options) };
}

test('reporting verifier requires the exact opt-in origin and proven ownership before any request', async () => {
  const f = fixture();
  await assert.rejects(verifyLocalReporting({ ...env(), GENIE_SUPABASE_URL: 'https://hosted.invalid' }, '--run', f.options));
  assert.equal(f.state.ownershipChecks, 0); assert.equal(f.requests.length, 0);
  const deniedOwner = fixture({ ownership: true });
  await assert.rejects(deniedOwner.run(), /OWNERSHIP_UNCONFIRMED/);
  assert.equal(deniedOwner.requests.length, 0);
  await assert.rejects(verifyLocalReporting(env(), '--run', { send: f.options.send }), /OWNERSHIP_REQUIRED/);
});

test('reporting flow dispatches two independent requests together and checks receipts, quotas, privacy and cascade', async () => {
  const f = fixture();
  const proof = await f.run();
  assert.equal(f.state.signups, 3); assert.equal(f.state.maxParallel, 2);
  assert.equal(proof.parallelHttpRequests, 2); assert.equal(proof.identicalServerReceipts, true);
  assert.equal(proof.ownerRowsAfterParallel, 1); assert.equal(proof.ownerQuotaAfterParallel, 1);
  assert.equal(proof.globalQuotaAfterParallel, 1); assert.equal(proof.rowsAfterSourceDeletion, 0);
  assert.equal(proof.quotasRetainedAfterDeletion, true); assert.equal(proof.allDatabaseSchedulesClaimed, false);
  assert.equal(f.reports.size, 0); assert.equal(f.state.globalUsed, 2);
  assert.ok(f.state.ownershipChecks >= 7);
  const publicOutput = JSON.stringify({ proof, observed: f.observed });
  for (const secret of [...ids, pollId, shareCode, ...tokens, 'Synthetic local reporting check.']) {
    assert.equal(publicOutput.includes(secret), false);
  }
});

test('reporting flow refuses duplicate quota use even when the server returns the same receipt', async () => {
  const f = fixture({ doubleQuota: true });
  await assert.rejects(f.run(), /REPORT_QA_DUPLICATE_COUNT_OR_QUOTA/);
  assert.equal(f.state.cleanup, true);
});

test('failed parallel report waits for the other dispatched request before best-effort cleanup', async () => {
  let release;
  const secondGate = new Promise(resolve => { release = resolve; });
  const f = fixture({ firstParallelFails: true, secondGate });
  const pending = f.run();
  await f.parallelStarted;
  assert.equal(f.state.cleanup, false);
  release();
  await assert.rejects(pending, /REPORT_QA_PARALLEL_REQUEST_FAILED/);
  assert.equal(f.state.cleanup, true); assert.equal(f.reports.size, 0);
});

test('source deletion must remove reports while retaining both user and global quotas', async () => {
  for (const fault of [{ missingCascade: true }, { refundQuota: true }]) {
    const f = fixture(fault);
    await assert.rejects(f.run(), /REPORT_QA_CASCADE_OR_QUOTA_INVALID/);
  }
});

test('privileged report audit refuses arbitrary identifiers and returns a count-only scoped query', () => {
  const scope = { pollId, ownerId: ids[0], voterId: ids[1], outsiderId: ids[2], requestId: randomUUID() };
  const sql = reportingAuditSql(scope);
  assert.match(sql, /^select json_build_object\(/);
  assert.equal(/\b(?:insert|update|delete|drop|alter|grant)\b/i.test(sql), false);
  for (const key of Object.keys(scope)) assert.throws(() => reportingAuditSql({ ...scope, [key]: "'; delete from auth.users;--" }), /SCOPE_INVALID/);
  assert.throws(() => reportingAuditSql({ ...scope, outsiderId: scope.ownerId }), /SCOPE_INVALID/);
});
