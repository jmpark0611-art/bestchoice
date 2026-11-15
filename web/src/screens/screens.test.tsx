import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

beforeEach(() => {
  vi.clearAllMocks();
  api.listMyPolls.mockResolvedValue([]);
});

describe('HomeScreen', () => {
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
  it('친구한테 물어보기를 누르면 투표 링크를 만들고, 실제 선택을 기록한다', async () => {
    api.getMyPoll.mockResolvedValue(mine);
    api.sharePoll.mockResolvedValue('abc123');
    api.setDid.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    open('/p/p1');
    await user.click(await screen.findByRole('button', { name: '친구한테 물어보기' }));
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
