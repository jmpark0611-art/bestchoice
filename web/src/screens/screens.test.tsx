import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { Poll } from '../lib/api';
import { AppError } from '../lib/errors';
import { HomeScreen } from './HomeScreen';
import { PollScreen } from './PollScreen';
import { VoteScreen } from './VoteScreen';

const api = vi.hoisted(() => ({
  decide: vi.fn(),
  listMyPolls: vi.fn(),
  getMyPoll: vi.fn(),
  sharePoll: vi.fn(),
  getSharedPoll: vi.fn(),
  vote: vi.fn(),
  setDid: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const base: Poll = { id: null, a: '짜장면', b: '짬뽕', note: null, isOwner: false, myVote: null, shareCode: null, did: null, createdAt: '2026-11-15T00:00:00Z' };
const mine: Poll = { ...base, id: 'p1', isOwner: true, pick: 'b', reason: '국물이 당기는 날이에요.', votes: { a: 0, b: 0 } };

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/p/:id" element={<PollScreen />} />
        <Route path="/v/:code" element={<VoteScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function acceptSharePolicy(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: '공유 콘텐츠 이용정책을 확인했고 동의해요.' }));
  await user.click(screen.getByRole('button', { name: '동의하고 공유하기' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listMyPolls.mockResolvedValue([]);
});

describe('HomeScreen', () => {
  it('최근 결정 조회 오류를 빈 기록과 구분하고 다시 불러온다', async () => {
    api.listMyPolls.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { id:'saved', a:'짜장면', b:'짬뽕', pick:'b', createdAt:'' },
    ]);
    const user = userEvent.setup();
    open('/');
    expect(await screen.findByRole('status')).toHaveTextContent('최근 결정을 불러오지 못했어요');
    await user.click(screen.getByRole('button', { name:'다시 불러오기' }));
    expect(await screen.findByRole('link', { name:'짜장면 vs 짬뽕 짬뽕' })).toHaveAttribute('href', '/p/saved');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('A와 B를 모두 적어야 물어볼 수 있고, 결론이 나오면 내 결정 화면으로 간다', async () => {
    api.decide.mockResolvedValue({ kind: 'pick', id: 'p1' });
    api.getMyPoll.mockResolvedValue(mine);
    const user = userEvent.setup();
    open('/');
    const cta = screen.getByRole('button', { name: '딱 정해줘' });
    expect(cta).toBeDisabled();
    await user.type(screen.getByLabelText('A'), ' 짜장면 ');
    expect(cta).toBeDisabled();
    await user.type(screen.getByLabelText('B'), '짬뽕');
    await user.type(screen.getByLabelText(/상황 한 줄/), '어제도 면');
    await user.click(cta);
    expect(api.decide).toHaveBeenCalledWith({ a: '짜장면', b: '짬뽕', note: '어제도 면' });
    expect(await screen.findByText('짬뽕!')).toBeInTheDocument();
    expect(screen.getByText('국물이 당기는 날이에요.')).toBeInTheDocument();
  });

  it('응답 시간 초과 뒤 입력과 최근 결정으로 복구하며 자동 재요청하지 않는다', async () => {
    api.decide.mockRejectedValue(new AppError('TIMEOUT'));
    api.listMyPolls.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'saved', a: '짜장면', b: '짬뽕', pick: 'b', createdAt: '' }]);
    const user = userEvent.setup();
    open('/');
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('최근 결정');
    expect(screen.getByLabelText('A')).toHaveValue('짜장면');
    expect(await screen.findByRole('link', { name: '짜장면 vs 짬뽕 짬뽕' })).toHaveAttribute('href', '/p/saved');
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('연속 클릭은 하나만 보내고 화면을 떠난 뒤 결과로 강제 이동하지 않는다', async () => {
    let finish!: (value: { kind: 'pick'; id: string }) => void;
    api.decide.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    const view = open('/');
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.dblClick(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(api.decide).toHaveBeenCalledTimes(1);
    view.unmount();
    finish({ kind: 'pick', id: 'late' });
    await Promise.resolve();
    expect(api.getMyPoll).not.toHaveBeenCalled();
  });

  it('같은 것을 두 번 적으면 서버에 묻지 않고 안내한다', async () => {
    const user = userEvent.setup();
    open('/');
    await user.type(screen.getByLabelText('A'), '치킨');
    await user.type(screen.getByLabelText('B'), '치킨');
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(screen.getByRole('alert')).toHaveTextContent('다르게');
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('예시를 누르면 채워지고, 위기 신호면 결론 대신 도움받을 곳을 보여준다', async () => {
    api.decide.mockResolvedValue({ kind: 'crisis' });
    const user = userEvent.setup();
    open('/');
    await user.click(screen.getByRole('button', { name: '이직한다 vs 남는다' }));
    expect(screen.getByLabelText('A')).toHaveValue('이직한다');
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(await screen.findByRole('link', { name: '109' })).toHaveAttribute('href', 'tel:109');
  });

  it('한도를 넘으면 이유를 알려주고 입력은 그대로 둔다', async () => {
    api.decide.mockRejectedValue(new AppError('VS_LIMIT'));
    const user = userEvent.setup();
    open('/');
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('내일');
    expect(screen.getByLabelText('A')).toHaveValue('짜장면');
  });
});

describe('PollScreen', () => {
  it('새 결정으로 이동한 뒤 도착한 이전 조회 결과를 무시한다', async () => {
    let finishOld!: (value: Poll) => void;
    api.getMyPoll.mockImplementation((id: string) => id === 'p1'
      ? new Promise<Poll>((resolve) => { finishOld = resolve; })
      : Promise.resolve({ ...mine, id: 'p2', a: '새 선택', pick: 'a' }));
    function Next() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/p/p2')}>다음 기록</button>;
    }
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/p/p1']}><Next /><Routes><Route path="/p/:id" element={<PollScreen />} /></Routes></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '다음 기록' }));
    expect(await screen.findByText('새 선택!')).toBeInTheDocument();
    await act(async () => finishOld(mine));
    expect(screen.getByText('새 선택!')).toBeInTheDocument();
    expect(screen.queryByText('짬뽕!')).not.toBeInTheDocument();
  });

  it('친구한테 물어보기를 누르면 투표 링크를 만들고, 실제 선택을 기록한다', async () => {
    api.getMyPoll.mockResolvedValue(mine);
    api.sharePoll.mockResolvedValue('abc123');
    api.setDid.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    open('/p/p1');
    await user.click(await screen.findByRole('button', { name: '친구한테 물어보기' }));
    expect(api.sharePoll).not.toHaveBeenCalled();
    await acceptSharePolicy(user);
    expect(api.sharePoll).toHaveBeenCalledWith('p1');
    expect(await screen.findByText(`${window.location.origin}/v/abc123`)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/v/abc123'));
    expect(screen.getByText('아직 투표가 없어요')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '짬뽕' }));
    expect(api.setDid).toHaveBeenCalledWith('p1', 'b');
    await waitFor(() => expect(screen.getByRole('button', { name: '짬뽕' })).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('VoteScreen', () => {
  it('투표 전에는 지니의 선택과 표 수를 숨기고, 투표하면 보여준다', async () => {
    api.getSharedPoll.mockResolvedValue({ ...base, note: '어제도 면 먹었어요' });
    api.vote.mockResolvedValue({ ...base, myVote: 'a', pick: 'b', reason: '국물이 당기는 날이에요.', votes: { a: 3, b: 6 } });
    const user = userEvent.setup();
    open('/v/abc123');
    expect(await screen.findByText(/어제도 면 먹었어요/)).toBeInTheDocument();
    expect(screen.queryByText('지니의 선택')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /짜장면/ }));
    expect(api.vote).toHaveBeenCalledWith('abc123', 'a');
    expect(await screen.findByText('지니의 선택')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '짜장면 3표, 짬뽕 6표' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '나도 결정 받기' })).toHaveAttribute('href', '/');
  });

  it('내가 만든 투표 링크를 열면 내 결정 화면으로 간다', async () => {
    api.getSharedPoll.mockResolvedValue({ ...mine, shareCode: 'abc123' });
    api.getMyPoll.mockResolvedValue({ ...mine, shareCode: 'abc123' });
    open('/v/abc123');
    expect(await screen.findByText('지니의 결론')).toBeInTheDocument();
  });

  it('없는 링크면 안내한다', async () => {
    api.getSharedPoll.mockRejectedValue(new AppError('NOT_FOUND'));
    open('/v/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('없는 투표');
  });
});


it('share cancellation preserves result and reads updated vote totals without creating a share',async()=>{
 api.getMyPoll.mockResolvedValue({...mine,shareCode:'code'});
 const share=vi.fn().mockRejectedValue(new DOMException('cancel','AbortError'));
 Object.defineProperty(navigator,'share',{value:share,configurable:true});
 const user=userEvent.setup();const view=open('/p/p1');await screen.findByText('짬뽕!');
 await user.click(screen.getByText('투표 링크 다시 보내기'));
 await acceptSharePolicy(user);
 await screen.findByText('공유를 취소했어요. 결과는 그대로예요.');
 await waitFor(()=>expect(api.getMyPoll).toHaveBeenCalledTimes(2));expect(api.sharePoll).not.toHaveBeenCalled();
 view.unmount();document.dispatchEvent(new Event('visibilitychange'));expect(api.getMyPoll).toHaveBeenCalledTimes(2);
 Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
});
it('actual choice is single-flight and a late save cannot replace the next result',async()=>{
 let finish!:()=>void;api.setDid.mockReturnValue(new Promise<void>(r=>{finish=r;}));
 api.getMyPoll.mockImplementation(async(id:string)=>({...mine,id,a:id==='p2'?'새 A':mine.a,b:id==='p2'?'새 B':mine.b}));
 function Next(){const navigate=useNavigate();return <button onClick={()=>navigate('/p/p2')}>다음 기록</button>;}
 const user=userEvent.setup();render(<MemoryRouter initialEntries={['/p/p1']}><Next/><Routes><Route path="/p/:id" element={<PollScreen/>}/></Routes></MemoryRouter>);
 await screen.findByText('짬뽕!');const choice=screen.getByRole('button',{name:'짜장면'});
 await user.click(choice);await user.click(choice);expect(api.setDid).toHaveBeenCalledTimes(1);
 await user.click(screen.getByText('다음 기록'));await screen.findByText('새 B!');
 await act(async()=>finish());expect(screen.getByText('새 B!')).toBeInTheDocument();expect(screen.getByRole('button',{name:'새 A'})).toBeEnabled();
});
it('a read started before actual choice cannot roll back the saved selection',async()=>{
 let finishRead!:(p:Poll)=>void;api.getMyPoll.mockResolvedValueOnce({...mine,shareCode:'code'}).mockImplementationOnce(()=>new Promise(r=>{finishRead=r;}));api.setDid.mockResolvedValue(undefined);
 const user=userEvent.setup();open('/p/p1');await screen.findByText('짬뽕!');
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await user.click(screen.getByRole('button',{name:'짜장면'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'짜장면'})).toHaveAttribute('aria-pressed','true'));
 await act(async()=>finishRead({...mine,shareCode:'code',did:null}));
 expect(screen.getByRole('button',{name:'짜장면'})).toHaveAttribute('aria-pressed','true');
});


it('native share waits, guards beforeunload and refresh, and only then reads updated votes', async () => {
  let finish!: () => void;
  const share = vi.fn(() => new Promise<void>(r => { finish = r; }));
  const prior = Object.getOwnPropertyDescriptor(navigator, 'share');
  Object.defineProperty(navigator, 'share', { value:share, configurable:true });
  try {
    api.getMyPoll.mockResolvedValueOnce({...mine,shareCode:'code'})
      .mockResolvedValueOnce({...mine,shareCode:'code',votes:{a:1,b:0}});
    const user = userEvent.setup();
    open('/p/p1');
    await user.click(await screen.findByRole('button',{name:'투표 링크 다시 보내기'}));
    await acceptSharePolicy(user);
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'새로 고침'})).toBeDisabled();
    const exit = new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.getMyPoll).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(await screen.findByText('친구 1명이 투표했어요')).toBeInTheDocument();
    expect(api.getMyPoll).toHaveBeenCalledTimes(2);
    const idleExit = new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(idleExit);
    expect(idleExit.defaultPrevented).toBe(false);
  } finally {
    if(prior) Object.defineProperty(navigator,'share',prior);
    else Reflect.deleteProperty(navigator,'share');
  }
});


it('clipboard permission denial keeps the share URL visible for manual copying', async () => {
  api.getMyPoll.mockResolvedValue({ ...mine, shareCode: 'manual-code' });
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  open('/p/p1');
  await screen.findByText('짬뽕!');
  await user.click(screen.getByRole('button', { name: '링크 복사' }));
  expect(copy).toHaveBeenCalled();
  expect(await screen.findByRole('status')).toHaveTextContent('직접 복사');
  expect(screen.getByText(`${window.location.origin}/v/manual-code`)).toBeInTheDocument();
});

it('share request is single-flight and refresh stays disabled while server write is pending', async () => {
  let finish!: (code: string) => void;
  api.getMyPoll.mockResolvedValue(mine);
  api.sharePoll.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  const user = userEvent.setup();
  open('/p/p1');
  const shareButton = await screen.findByRole('button', { name: '친구한테 물어보기' });
  await user.dblClick(shareButton);
  expect(api.sharePoll).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: '공유 콘텐츠 이용정책을 확인했고 동의해요.' }));
  await user.dblClick(screen.getByRole('button', { name: '동의하고 공유하기' }));
  expect(api.sharePoll).toHaveBeenCalledTimes(1);
  expect(shareButton).toBeDisabled();
  await act(async () => finish('pending-code'));
  expect(await screen.findByText(`${window.location.origin}/v/pending-code`)).toBeInTheDocument();
  expect(api.sharePoll).toHaveBeenCalledTimes(1);
});
