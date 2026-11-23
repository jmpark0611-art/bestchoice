import { clearQuestionAuthorBlocks, getSharedPoll, setQuestionAuthorBlocked, vote } from './api';

const sb = vi.hoisted(() => ({ ensureSession: vi.fn(), getExistingSessionToken: vi.fn(), getSupabase: vi.fn() }));
vi.mock('./supabase', () => sb);
const poll = { a: '요리', b: '외식', note: null, isOwner: false, myVote: null, shareCode: 'safe-code' };
const rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();sb.ensureSession.mockResolvedValue('existing');sb.getExistingSessionToken.mockResolvedValue('existing');
  sb.getSupabase.mockReturnValue({ rpc });
});
afterEach(() => { vi.useRealTimers();vi.restoreAllMocks(); });
const respond = (data: unknown, error: unknown = null) => rpc.mockReturnValue({ abortSignal: async () => ({ data, error }) });

it('uses guarded read and vote without an unguarded retry', async () => {
  respond(poll);
  await expect(getSharedPoll('safe-code')).resolves.toEqual(poll);
  expect(rpc).toHaveBeenLastCalledWith('vs_shared_poll_guarded', { p_code: 'safe-code' });
  respond(null, { code: '42501', message: 'AUTHOR_BLOCKED' });
  await expect(vote('safe-code', 'a')).rejects.toMatchObject({ code: 'AUTHOR_BLOCKED' });
  expect(rpc).toHaveBeenLastCalledWith('vs_vote_guarded', { p_code: 'safe-code', p_choice: 'a' });
  expect(rpc).toHaveBeenCalledTimes(2);
});

it.each(['PGRST202', '42883'])('fails closed when the sharing protection RPC is unavailable (%s)', async code => {
  respond(null, { code, message: 'missing' });
  await expect(getSharedPoll('safe-code')).rejects.toMatchObject({ code: 'SHARING_UNAVAILABLE' });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('vs_shared_poll_guarded', { p_code: 'safe-code' });
});

it('accepts only a server-confirmed requested block state', async () => {
  respond({ status: 'blocked' });
  await expect(setQuestionAuthorBlocked('safe-code', true)).resolves.toBeUndefined();
  expect(rpc).toHaveBeenLastCalledWith('vs_set_question_author_block', { p_share_code: 'safe-code', p_blocked: true });
  await expect(setQuestionAuthorBlocked('safe-code', false)).rejects.toMatchObject({ code: 'RESULT_INVALID' });
  respond({ status: 'unblocked' });
  await expect(setQuestionAuthorBlocked('safe-code', false)).resolves.toBeUndefined();
  const calls = rpc.mock.calls.length;
  await expect(setQuestionAuthorBlocked('../bad', true)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(rpc).toHaveBeenCalledTimes(calls);
});

it('clears only an existing session and requires a confirmed clear receipt', async () => {
  sb.getExistingSessionToken.mockResolvedValueOnce(null);
  await expect(clearQuestionAuthorBlocks()).resolves.toBeUndefined();
  expect(sb.ensureSession).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
  respond({ status: 'wrong' });
  await expect(clearQuestionAuthorBlocks()).rejects.toMatchObject({ code: 'RESULT_INVALID' });
  respond({ status: 'cleared' });
  await expect(clearQuestionAuthorBlocks()).resolves.toBeUndefined();
  expect(rpc).toHaveBeenLastCalledWith('vs_clear_question_author_blocks');
  expect(sb.ensureSession).not.toHaveBeenCalled();
});

it('does not send a block after authentication exceeded its deadline', async () => {
  vi.useFakeTimers();let finish!: (token: string) => void;
  sb.ensureSession.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
  const request = expect(setQuestionAuthorBlocked('safe-code', true)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15_001);await request;
  finish('late');await vi.advanceTimersByTimeAsync(1);
  expect(rpc).not.toHaveBeenCalled();
});
