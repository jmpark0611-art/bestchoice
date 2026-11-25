import { sharePoll, getSharedPoll, vote, setDid, decide, getMyPoll, deleteDecision, listDecisionHistory, listMyPolls } from './api';
const sb = vi.hoisted(() => ({ ensureSession: vi.fn(), getExistingSessionToken: vi.fn(), getSupabase: vi.fn() }));
vi.mock('./supabase', () => sb);
const input = { a: '짜장면', b: '짬뽕', note: '' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sb.ensureSession.mockResolvedValue('test-token');
  sb.getExistingSessionToken.mockResolvedValue('existing-token');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('navigable result is returned unchanged', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ kind: 'pick', id: 'p1' }) } as unknown as Response);
  await expect(decide(input)).resolves.toEqual({ kind: 'pick', id: 'p1' });
});
it.each(['auth', 'fetch', 'body'])('bounds a hung %s phase at 30 seconds', async (phase) => {
  const never = new Promise<never>(() => {});
  if (phase === 'auth') sb.ensureSession.mockReturnValue(never);
  vi.mocked(fetch).mockReturnValue(phase === 'body' ? Promise.resolve({ ok: true, json: () => never } as unknown as Response) : never);
  const assertion = expect(decide(input)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(30_001);
  await assertion;
  if (phase !== 'auth') expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('does not POST if authentication completes after deadline', async () => {
  let resolve!: (value: string) => void;
  sb.ensureSession.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
  const assertion = expect(decide(input)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(30_001); await assertion;
  resolve('late-token'); await vi.advanceTimersByTimeAsync(1);
  expect(fetch).not.toHaveBeenCalled();
});
it('bounds a hung result lookup', async () => {
  const pending = new Promise<never>(() => {});
  const abortSignal = vi.fn((_signal: AbortSignal) => pending);
  sb.getSupabase.mockReturnValue({ rpc: () => Object.assign(pending, { abortSignal }) });
  const assertion = expect(getMyPoll('p1')).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15_001); await assertion;
  expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
});

it.each([null, {}, { id: 'p1', pick: 'a' }, { id: 'other', isOwner: true, pick: 'a', a: 'A', b: 'B', reason: 'why' }])('rejects unusable result instead of indefinite loading: %j', async (data) => {
  sb.getSupabase.mockReturnValue({ rpc: () => ({ abortSignal: () => Promise.resolve({ data, error: null }) }) });
  await expect(getMyPoll('p1')).rejects.toMatchObject({ code: 'RESULT_INVALID' });
});

it('does not issue late deletion after auth timeout',async()=>{
 let resolve!:(v:string)=>void;sb.getExistingSessionToken.mockReturnValue(new Promise<string>(r=>{resolve=r;}));
 const assertion=expect(deleteDecision('p1')).rejects.toMatchObject({code:'TIMEOUT'});
 await vi.advanceTimersByTimeAsync(15001);await assertion;resolve('late');await vi.advanceTimersByTimeAsync(1);expect(sb.getSupabase).not.toHaveBeenCalled();
 expect(sb.ensureSession).not.toHaveBeenCalled();
});
it('uses owner-scoped delete RPC once and propagates errors',async()=>{
 const rpc=vi.fn(()=>({abortSignal:()=>Promise.resolve({error:{message:'NOT_FOUND'}})}));sb.getSupabase.mockReturnValue({rpc});
 await expect(deleteDecision('p1')).rejects.toMatchObject({code:'NOT_FOUND'});expect(rpc).toHaveBeenCalledExactlyOnceWith('vs_delete_poll',{p_id:'p1'});
 expect(sb.ensureSession).not.toHaveBeenCalled();
});
it('maps history with pagination and actual choice',async()=>{
 const chain:any={};for(const name of ['select','order','range'])chain[name]=vi.fn(()=>chain);
 chain.abortSignal=vi.fn(async()=>({data:[{id:'p1',option_a:'A',option_b:'B',pick:'a',did:'b',created_at:'date'}],error:null}));
 sb.getSupabase.mockReturnValue({from:()=>chain});
 await expect(listDecisionHistory(30,30)).resolves.toEqual([{id:'p1',a:'A',b:'B',pick:'a',did:'b',createdAt:'date'}]);expect(chain.range).toHaveBeenCalledWith(30,59);
 expect(sb.ensureSession).not.toHaveBeenCalled();
});

describe('history and deletion existing sessions', () => {
  it('returns an empty history without a session and never creates an account or queries data', async () => {
    sb.getExistingSessionToken.mockResolvedValue(null);
    await expect(listDecisionHistory()).resolves.toEqual([]);
    expect(sb.ensureSession).not.toHaveBeenCalled();
    expect(sb.getSupabase).not.toHaveBeenCalled();
  });

  it('rejects deletion without a session before creating an account or sending an RPC', async () => {
    sb.getExistingSessionToken.mockResolvedValue(null);
    await expect(deleteDecision('p1')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(sb.ensureSession).not.toHaveBeenCalled();
    expect(sb.getSupabase).not.toHaveBeenCalled();
  });

  it.each([
    ['history', () => listDecisionHistory()],
    ['deletion', () => deleteDecision('p1')],
  ] as const)('propagates a %s session-read error without anonymous fallback or a data call', async (_name, call) => {
    const failure = new Error('existing session unavailable');
    sb.getExistingSessionToken.mockRejectedValue(failure);
    await expect(call()).rejects.toBe(failure);
    expect(sb.ensureSession).not.toHaveBeenCalled();
    expect(sb.getSupabase).not.toHaveBeenCalled();
  });

  it('does not query history when the existing session arrives after its deadline', async () => {
    let resolve!: (token: string) => void;
    sb.getExistingSessionToken.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const assertion = expect(listDecisionHistory()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    resolve('late-existing-token');
    await vi.advanceTimersByTimeAsync(1);
    expect(sb.ensureSession).not.toHaveBeenCalled();
    expect(sb.getSupabase).not.toHaveBeenCalled();
  });

  it('uses the existing session for a successful delete without anonymous fallback', async () => {
    const rpc = vi.fn(() => ({ abortSignal: async () => ({ error: null }) }));
    sb.getSupabase.mockReturnValue({ rpc });
    await expect(deleteDecision('p1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('vs_delete_poll', { p_id: 'p1' });
    expect(sb.ensureSession).not.toHaveBeenCalled();
  });
});

const boundedCalls = [
 ['shared',()=>getSharedPoll('code')], ['share',()=>sharePoll('p1')],
 ['vote',()=>vote('code','a')], ['record',()=>setDid('p1','a')],
] as const;
it.each(boundedCalls)('bounds hung %s RPC and aborts it',async(_name,call)=>{
 const abortSignal=vi.fn((_signal:AbortSignal)=>new Promise(()=>{}));
 const rpc=vi.fn(()=>({abortSignal}));sb.getSupabase.mockReturnValue({rpc});
 const assertion=expect(call()).rejects.toMatchObject({code:'TIMEOUT'});
 await vi.advanceTimersByTimeAsync(15001);await assertion;
 expect(rpc).toHaveBeenCalledTimes(1);expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
});
it.each(boundedCalls)('does not send late %s RPC after auth timeout',async(_name,call)=>{
 let resolve!:(token:string)=>void;sb.ensureSession.mockReturnValue(new Promise<string>(r=>{resolve=r;}));
 const assertion=expect(call()).rejects.toMatchObject({code:'TIMEOUT'});
 await vi.advanceTimersByTimeAsync(15001);await assertion;resolve('late');await vi.advanceTimersByTimeAsync(1);
 expect(sb.getSupabase).not.toHaveBeenCalled();
});

it.each([null, {}, {a:'A',b:'B',isOwner:false,myVote:'a'}, {a:'A',b:'B',isOwner:true,myVote:null}])('rejects malformed shared response %j',async(data)=>{
 sb.getSupabase.mockReturnValue({rpc:()=>({abortSignal:async()=>({data,error:null})})});
 await expect(getSharedPoll('code')).rejects.toMatchObject({code:'RESULT_INVALID'});
});
it('accepts hidden pre-vote data but rejects it as a completed vote',async()=>{
 const data={a:'A',b:'B',isOwner:false,myVote:null};
 sb.getSupabase.mockReturnValue({rpc:()=>({abortSignal:async()=>({data,error:null})})});
 await expect(getSharedPoll('code')).resolves.toEqual(data);
 await expect(vote('code','a')).rejects.toMatchObject({code:'RESULT_INVALID'});
});
it('keeps server first vote even if retry requested a different choice',async()=>{
 const data={a:'A',b:'B',isOwner:false,myVote:'b',pick:'a',reason:'why',votes:{a:0,b:1}};
 sb.getSupabase.mockReturnValue({rpc:()=>({abortSignal:async()=>({data,error:null})})});
 await expect(vote('code','a')).resolves.toEqual(data);
});

it.each([null, '', {}, 'bad/code', 'code?token=secret'])('does not produce a share link from malformed code %j',async(data)=>{
 sb.getSupabase.mockReturnValue({rpc:()=>({abortSignal:async()=>({data,error:null})})});
 await expect(sharePoll('p1')).rejects.toMatchObject({code:'RESULT_INVALID'});
});
it.each([{}, 123, '../other', 'p1?x=secret'])('rejects unsafe decision route ID %j',async(id)=>{
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({kind:'pick',id})} as unknown as Response);
 await expect(decide(input)).rejects.toMatchObject({code:'AI_FAILED'});
});

it('passive home history signed out: no account creation and no data query', async () => {
  sb.getExistingSessionToken.mockResolvedValue(null);
  await expect(listMyPolls()).resolves.toEqual([]);
  expect(sb.ensureSession).not.toHaveBeenCalled();
  expect(sb.getSupabase).not.toHaveBeenCalled();
});
it('passive home history signed in: returns the existing owner-scoped recent list', async () => {
  sb.getExistingSessionToken.mockResolvedValue('existing');
  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    abortSignal: vi.fn(async () => ({ data: [{ id:'p1', option_a:'A', option_b:'B', pick:'a', created_at:'day' }], error:null })),
  };
  const from = vi.fn(() => query);
  sb.getSupabase.mockReturnValue({ from });
  await expect(listMyPolls()).resolves.toEqual([{ id:'p1', a:'A', b:'B', pick:'a', createdAt:'day' }]);
  expect(sb.ensureSession).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledExactlyOnceWith('vs_polls');
  expect(query.limit).toHaveBeenCalledWith(3);
});
it('passive home history propagates auth or signed-in query errors without anonymous fallback', async () => {
  const failure = new Error('sdk read error');
  sb.getExistingSessionToken.mockRejectedValueOnce(failure).mockResolvedValueOnce('existing');
  await expect(listMyPolls()).rejects.toBe(failure);
  expect(sb.getSupabase).not.toHaveBeenCalled();
  const query = { select:vi.fn().mockReturnThis(), order:vi.fn().mockReturnThis(), limit:vi.fn().mockReturnThis(),
    abortSignal:vi.fn(async () => ({ data:null, error:{message:'connection failure'} })),
  };
  sb.getSupabase.mockReturnValue({ from:() => query });
  await expect(listMyPolls()).rejects.toMatchObject({ code:'NETWORK' });
  expect(sb.ensureSession).not.toHaveBeenCalled();
});
it('passive home history never dispatches a query on a late session', async () => {
  let resolve!: (token:string) => void;
  sb.getExistingSessionToken.mockReturnValueOnce(new Promise<string>(r => { resolve=r; }));
  const assertion=expect(listMyPolls()).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(15_001); await assertion;
  resolve('late'); await vi.advanceTimersByTimeAsync(1);
  expect(sb.getSupabase).not.toHaveBeenCalled();
  expect(sb.ensureSession).not.toHaveBeenCalled();
});
