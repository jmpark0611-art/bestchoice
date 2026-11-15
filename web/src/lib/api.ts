import { AppError, codeFromRpcMessage } from './errors';
import { ensureSession, getSupabase } from './supabase';

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
  const token = await session();
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vs-decide`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AppError('NETWORK');
  }
  const body = (await response.json().catch(() => ({}))) as { kind?: string; id?: string; error?: string };
  if (!response.ok) throw new AppError(body.error ?? 'AI_FAILED');
  if (body.kind === 'crisis') return { kind: 'crisis' };
  if (body.kind === 'pick' && body.id) return { kind: 'pick', id: body.id };
  throw new AppError('AI_FAILED');
}

export async function getMyPoll(id: string): Promise<Poll> {
  await session();
  const { data, error } = await getSupabase().rpc('vs_my_poll', { p_id: id });
  if (error) rpcError(error);
  return data as Poll;
}

export async function listMyPolls(limit = 3): Promise<PollSummary[]> {
  await session();
  const { data, error } = await getSupabase()
    .from('vs_polls')
    .select('id, option_a, option_b, pick, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) rpcError(error);
  return (data ?? []).map((r) => ({ id: r.id, a: r.option_a, b: r.option_b, pick: r.pick, createdAt: r.created_at }));
}

/** 공유 코드를 만든다(이미 있으면 같은 코드) */
export async function sharePoll(id: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('vs_share', { p_id: id });
  if (error) rpcError(error);
  return data as string;
}

export async function getSharedPoll(code: string): Promise<Poll> {
  await session();
  const { data, error } = await getSupabase().rpc('vs_shared_poll', { p_code: code });
  if (error) rpcError(error);
  return data as Poll;
}

export async function vote(code: string, choice: Side): Promise<Poll> {
  const { data, error } = await getSupabase().rpc('vs_vote', { p_code: code, p_choice: choice });
  if (error) rpcError(error);
  return data as Poll;
}

export async function setDid(id: string, did: Did): Promise<void> {
  const { error } = await getSupabase().rpc('vs_set_did', { p_id: id, p_did: did });
  if (error) rpcError(error);
}
