import { withDeadline } from './deadline';
import { AppError, codeFromRpcMessage } from './errors';
import { ensureSession, getExistingSessionToken, getSupabase } from './supabase';

export type Side = 'a' | 'b';
export type Did = Side | 'none';

/** 표 수와 지니의 선택(pick, reason, votes)은 주인이거나 이미 투표한 사람에게만 온다 */
export type Poll = {
  id: string | null;
  a: string;
  b: string;
  note: string | null;
  isOwner: boolean;
  myVote: Side | null;
  shareCode: string | null;
  did: Did | null;
  createdAt: string;
  pick?: Side;
  reason?: string;
  votes?: { a: number; b: number };
};
export type PollSummary = { id: string; a: string; b: string; pick: Side; createdAt: string };

function rpcError(error: { message?: string } | null): never {
  throw new AppError(codeFromRpcMessage(error?.message));
}

async function session() {
  try {
    return await ensureSession();
  } catch {
    throw new AppError('NETWORK');
  }
}

/** 지니에게 물어본다. 위기 신호가 있으면 저장하지 않고 crisis를 돌려준다 */
export async function decide(input: { a: string; b: string; note: string }): Promise<{ kind: 'pick'; id: string } | { kind: 'crisis' }> {
  return withDeadline(async (signal) => {
    const token = await session();
    // Auth may finish after the deadline. Never send a late duplicate request.
    if (signal.aborted) throw new AppError('TIMEOUT');
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vs-decide`, {
        method: 'POST', signal,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new AppError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
    }
    const body = (await response.json().catch(() => ({}))) as { kind?: string; id?: string; error?: string };
    if (!response.ok) throw new AppError(body.error ?? 'AI_FAILED');
    if (body.kind === 'crisis') return { kind: 'crisis' } as const;
    if (body.kind === 'pick' && typeof body.id === 'string' && /^[A-Za-z0-9_-]+$/.test(body.id)) return { kind: 'pick', id: body.id } as const;
    throw new AppError('AI_FAILED');
  }, 30_000);
}

export async function getMyPoll(id: string): Promise<Poll> {
  return withDeadline(async (signal) => {
    await session();
    if (signal.aborted) throw new AppError('TIMEOUT');
    const { data, error } = await getSupabase().rpc('vs_my_poll', { p_id: id }).abortSignal(signal);
    if (error) rpcError(error);
    // A successful HTTP response is not necessarily a usable decision.
    // Never leave the result screen permanently spinning on null/partial data.
    if (!data || data.id !== id || data.isOwner !== true ||
        (data.pick !== 'a' && data.pick !== 'b') ||
        typeof data.a !== 'string' || typeof data.b !== 'string' || typeof data.reason !== 'string') {
      throw new AppError('RESULT_INVALID');
    }
    return data as Poll;
  }, 15_000);
}

/** Passive homepage history must never create a new anonymous account. */
export async function listMyPolls(limit = 3): Promise<PollSummary[]> {
  return withDeadline(async (signal) => {
    const token = await getExistingSessionToken();
    if (signal.aborted) throw new AppError('TIMEOUT');
    if (token === null) return [];
    const { data, error } = await getSupabase()
      .from('vs_polls')
      .select('id, option_a, option_b, pick, created_at')
      .order('created_at', { ascending: false })
      .limit(limit).abortSignal(signal);
    if (error) rpcError(error);
    return (data ?? []).map((r) => ({ id: r.id, a: r.option_a, b: r.option_b, pick: r.pick, createdAt: r.created_at }));
  }, 15_000);
}

/** Bound authentication and RPC together; never send a mutation after expired auth. */
async function boundedRpc(name: string, args: Record<string, unknown>, safetyRequired = false) {
  return withDeadline(async signal => {
    await session();
    if (signal.aborted) throw new AppError('TIMEOUT');
    const { data, error } = await getSupabase().rpc(name, args).abortSignal(signal);
    if (safetyRequired && (error?.code === 'PGRST202' || error?.code === '42883')) throw new AppError('SHARING_UNAVAILABLE');
    if (error) rpcError(error);
    return data;
  }, 15_000);
}

/** 공유 코드를 만든다(이미 있으면 같은 코드) */
export async function sharePoll(id: string): Promise<string> {
  const code = await boundedRpc('vs_share', { p_id: id });
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(code)) throw new AppError('RESULT_INVALID');
  return code;
}
function validateSharedPoll(data: unknown): Poll {
  if (!data || typeof data !== 'object') throw new AppError('RESULT_INVALID');
  const p = data as Poll;
  if (typeof p.a !== 'string' || typeof p.b !== 'string' || typeof p.isOwner !== 'boolean' ||
      (p.myVote !== null && p.myVote !== 'a' && p.myVote !== 'b') ||
      (p.isOwner && (typeof p.id !== 'string' || !p.id))) throw new AppError('RESULT_INVALID');
  if (p.isOwner || p.myVote) {
    if ((p.pick !== 'a' && p.pick !== 'b') || typeof p.reason !== 'string' || !p.votes ||
        !Number.isSafeInteger(p.votes.a) || p.votes.a < 0 ||
        !Number.isSafeInteger(p.votes.b) || p.votes.b < 0) throw new AppError('RESULT_INVALID');
  }
  return p;
}
export async function getSharedPoll(code: string): Promise<Poll> {
  return validateSharedPoll(await boundedRpc('vs_shared_poll_guarded', { p_code: code }, true));
}
export async function vote(code: string, choice: Side): Promise<Poll> {
  const result = validateSharedPoll(await boundedRpc('vs_vote_guarded', { p_code: code, p_choice: choice }, true));
  if (!result.myVote) throw new AppError('RESULT_INVALID');
  return result;
}

export async function setQuestionAuthorBlocked(code: string, blocked: boolean): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(code) || typeof blocked !== 'boolean') throw new AppError('INVALID_INPUT');
  const result = await boundedRpc('vs_set_question_author_block', { p_share_code: code, p_blocked: blocked }, true);
  if (!result || result.status !== (blocked ? 'blocked' : 'unblocked')) throw new AppError('RESULT_INVALID');
}

/** Clearing preferences while signed out must not create a new anonymous user. */
export async function clearQuestionAuthorBlocks(): Promise<void> {
  return withDeadline(async signal => {
    const token = await getExistingSessionToken();
    if (signal.aborted) throw new AppError('TIMEOUT');
    if (token === null) return;
    const { data, error } = await getSupabase().rpc('vs_clear_question_author_blocks').abortSignal(signal);
    if (error?.code === 'PGRST202' || error?.code === '42883') throw new AppError('SHARING_UNAVAILABLE');
    if (error) rpcError(error);
    if (!data || data.status !== 'cleared') throw new AppError('RESULT_INVALID');
  }, 15_000);
}
export async function setDid(id: string, did: Did): Promise<void> {
  await boundedRpc('vs_set_did', { p_id: id, p_did: did });
}


export type DecisionRecord = PollSummary & { did: Did | null };
export async function listDecisionHistory(offset = 0, limit = 30): Promise<DecisionRecord[]> {
  return withDeadline(async signal => {
    const token = await getExistingSessionToken();
    if (signal.aborted) throw new AppError('TIMEOUT');
    if (token === null) return [];
    const {data,error} = await getSupabase().from('vs_polls')
      .select('id, option_a, option_b, pick, did, created_at')
      .order('created_at', {ascending:false}).order('id', {ascending:false})
      .range(offset, offset + limit - 1)
      .setHeader('Authorization', `Bearer ${token}`).abortSignal(signal);
    if(signal.aborted) throw new AppError('TIMEOUT');
    if(error) rpcError(error);
    return (data ?? []).map(r => ({id:r.id,a:r.option_a,b:r.option_b,pick:r.pick,did:r.did,createdAt:r.created_at}));
  }, 15000);
}
export async function deleteDecision(id:string): Promise<void> {
  return withDeadline(async signal => {
    const token = await getExistingSessionToken();
    if(signal.aborted) throw new AppError('TIMEOUT');
    if(token === null) throw new AppError('AUTH_REQUIRED');
    const client = getSupabase();
    const authorization = `Bearer ${token}`;
    // SELECT RLS is owner-only; all three requests must keep the same captured token.
    const readOwned = () => client.from('vs_polls').select('id').eq('id', id)
      .setHeader('Authorization', authorization).abortSignal(signal);
    const before = await readOwned();
    if(signal.aborted) throw new AppError('TIMEOUT');
    if(before?.error) rpcError(before.error);
    if(!Array.isArray(before?.data)) throw new AppError('RESULT_INVALID');
    if(before.data.length === 0) throw new AppError('NOT_FOUND');
    if(before.data.length !== 1 || before.data[0]?.id !== id) throw new AppError('RESULT_INVALID');

    const deleted = await client.rpc('vs_delete_poll', {p_id:id})
      .setHeader('Authorization', authorization).abortSignal(signal);
    if(signal.aborted) throw new AppError('TIMEOUT');
    if(deleted?.error) rpcError(deleted.error);
    if(deleted?.data !== null) throw new AppError('RESULT_INVALID');

    // A void RPC has no affected-row receipt; verify this owner's final absence only.
    const after = await readOwned();
    if(signal.aborted) throw new AppError('TIMEOUT');
    if(after?.error) rpcError(after.error);
    if(!Array.isArray(after?.data) || after.data.length !== 0) throw new AppError('RESULT_INVALID');
  },15000);
}
