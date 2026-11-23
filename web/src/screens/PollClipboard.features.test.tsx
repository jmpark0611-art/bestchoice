import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { Poll } from '../lib/api';
import { REFLECTION_STORAGE_KEY, saveDecisionReflection } from '../lib/decisionReflections';
import { PollScreen } from './PollScreen';
import { VoteScreen } from './VoteScreen';

const api = vi.hoisted(() => ({
  getMyPoll: vi.fn(), setDid: vi.fn(), sharePoll: vi.fn(),
  getSharedPoll: vi.fn(), vote: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const mine: Poll = {
  id: 'p1', a: '집에서 요리', b: '밖에서 식사', note: '중요한 기준: 비용 절약',
  isOwner: true, myVote: null, shareCode: 'first-code', did: null,
  createdAt: '2026-11-23T00:00:00Z', pick: 'a',
  reason: '오늘은 예산을 아껴봐요.', votes: { a: 2, b: 1 },
};

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function NextDecision() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/p/p2')}>다음 결정</button>;
}

function open(path = '/p/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NextDecision />
      <Routes>
        <Route path="/p/:id" element={<PollScreen />} />
        <Route path="/v/:code" element={<VoteScreen />} />
        <Route path="/history" element={<p>기록 페이지 도착</p>} />
        <Route path="/" element={<p>새 결정 페이지 도착</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.getSelection()?.removeAllRanges();
  api.getMyPoll.mockResolvedValue(mine);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('pending clipboard work across decision routes', () => {
  it.each(['resolve', 'reject'] as const)('ignores an old clipboard %s without changing the next result or selection', async outcome => {
    const copy = pending<void>();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(copy.promise);
    api.getMyPoll.mockImplementation(async (id: string) => id === 'p1'
      ? mine
      : { ...mine, id, a: '다음 선택', shareCode: 'next-code' });
    open();
    await user.click(await screen.findByRole('button', { name: '링크 복사' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/v/first-code`);
    await user.click(screen.getByRole('button', { name: '다음 결정' }));
    const currentResult = await screen.findByText('다음 선택!');
    expect(screen.getByText(`${window.location.origin}/v/next-code`)).toBeInTheDocument();

    // A late permission denial must not select the next decision's URL.
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(currentResult);
    selection.removeAllRanges();
    selection.addRange(range);
    const previousSelection = selection.toString();
    const selectContents = vi.spyOn(Range.prototype, 'selectNodeContents');
    await act(async () => {
      if (outcome === 'resolve') copy.resolve(undefined);
      else copy.reject(new DOMException('denied', 'NotAllowedError'));
    });

    expect(screen.getByText('다음 선택!')).toBeInTheDocument();
    expect(screen.queryByText('투표 링크를 복사했어요.')).not.toBeInTheDocument();
    expect(screen.queryByText('자동 복사가 차단됐어요. 선택된 링크를 직접 복사해 주세요.')).not.toBeInTheDocument();
    expect(selectContents).not.toHaveBeenCalled();
    expect(selection.toString()).toBe(previousSelection);
    expect(api.getMyPoll).toHaveBeenCalledTimes(2);
  });
});

describe('comparison and private reflection integration', () => {
  it('requires a confirmed choice, protects a draft until canceled, and freezes reflection during another save', async () => {
    const firstSave = pending<void>();
    const nextSave = pending<void>();
    api.setDid.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(nextSave.promise);
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole('region', { name: 'AI와 친구 의견 비교' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '선택하고 나니 어땠어요?' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '집에서 요리' }));
    expect(api.setDid).toHaveBeenCalledWith('p1', 'a');
    expect(screen.queryByRole('region', { name: '선택하고 나니 어땠어요?' })).not.toBeInTheDocument();
    await act(async () => firstSave.resolve(undefined));
    const reflection = await screen.findByRole('region', { name: '선택하고 나니 어땠어요?' });
    await user.click(within(reflection).getByRole('button', { name: /^만족$/ }));
    await user.type(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)'), '다음에도 기억할 내 메모');

    // Neither another choice, refresh, nor an in-screen link may discard the draft.
    await user.click(screen.getByRole('button', { name: '밖에서 식사' }));
    expect(api.setDid).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '집에서 요리' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/저장하지 않은 회고가 있어요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '새로 고침' }));
    expect(api.getMyPoll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('link', { name: '결정 기록 보기' }));
    await user.click(screen.getByRole('link', { name: '다른 것도 정하기' }));
    expect(screen.queryByText('기록 페이지 도착')).not.toBeInTheDocument();
    expect(screen.queryByText('새 결정 페이지 도착')).not.toBeInTheDocument();
    expect(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)')).toHaveValue('다음에도 기억할 내 메모');

    await user.click(within(reflection).getByRole('button', { name: '수정 취소' }));
    expect(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)')).toHaveValue('');
    expect(screen.queryByText(/저장하지 않은 회고가 있어요/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '밖에서 식사' }));
    expect(api.setDid).toHaveBeenLastCalledWith('p1', 'b');
    expect(within(reflection).getByRole('button', { name: /^만족$/ })).toBeDisabled();
    expect(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)')).toBeDisabled();
    expect(within(reflection).getByRole('button', { name: '회고 저장' })).toBeDisabled();
    fireEvent.submit(reflection.querySelector('form')!);
    expect(localStorage.getItem(REFLECTION_STORAGE_KEY)).toBeNull();

    await act(async () => nextSave.resolve(undefined));
    const nextReflection = screen.getByRole('region', { name: '선택하고 나니 어땠어요?' });
    expect(within(nextReflection).getByLabelText('나중에 떠올릴 한 줄 (선택)')).toHaveValue('');
    expect(within(nextReflection).getByRole('button', { name: /^만족$/ })).toBeEnabled();
    expect(within(nextReflection).getByText(/“밖에서 식사”을 선택한 뒤/)).toBeInTheDocument();
    expect(localStorage.getItem(REFLECTION_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('link', { name: '결정 기록 보기' }));
    expect(await screen.findByText('기록 페이지 도착')).toBeInTheDocument();
  });

  it.each([false, true])('does not let an earlier refresh replace a choice after editing starts (draft canceled: %s)', async cancelDraft => {
    const oldRefresh = pending<Poll>();
    api.getMyPoll.mockResolvedValueOnce({ ...mine, did: 'a' }).mockReturnValueOnce(oldRefresh.promise);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const user = userEvent.setup();
    open();
    const reflection = await screen.findByRole('region', { name: '선택하고 나니 어땠어요?' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.getMyPoll).toHaveBeenCalledTimes(2);
    await user.type(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)'), '새로 쓰는 회고');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.getMyPoll).toHaveBeenCalledTimes(2);
    if (cancelDraft) await user.click(within(reflection).getByRole('button', { name: '수정 취소' }));

    await act(async () => oldRefresh.resolve({ ...mine, did: 'b', votes: { a: 10, b: 11 } }));
    expect(screen.getByRole('button', { name: '집에서 요리' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '밖에서 식사' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(reflection).getByLabelText('나중에 떠올릴 한 줄 (선택)')).toHaveValue(cancelDraft ? '' : '새로 쓰는 회고');
    expect(screen.getByRole('img', { name: '집에서 요리 2표, 밖에서 식사 1표' })).toBeInTheDocument();
    expect(api.setDid).not.toHaveBeenCalled();
  });

  it('keeps reflection closed after an unconfirmed choice fails', async () => {
    api.setDid.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: '집에서 요리' }));
    await screen.findByText(/저장 여부를 새로 확인한 뒤/);
    expect(screen.queryByRole('region', { name: '선택하고 나니 어땠어요?' })).not.toBeInTheDocument();
    expect(api.setDid).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(REFLECTION_STORAGE_KEY)).toBeNull();
  });

  it('shows comparison only after a friend votes and never displays the owner reflection', async () => {
    expect(saveDecisionReflection({ pollId: 'p1', choice: 'a', rating: 'regret', note: '친구에게 공개하지 않을 회고' }).ok).toBe(true);
    // Deliberately keep result fields populated: the screen must enforce the vote gate.
    const visitor: Poll = { ...mine, isOwner: false, myVote: null, did: 'a' };
    api.getSharedPoll.mockResolvedValue(visitor);
    api.vote.mockResolvedValue({ ...visitor, myVote: 'b', votes: { a: 2, b: 2 } });
    const user = userEvent.setup();
    open('/v/first-code');
    const ballot = await screen.findByRole('button', { name: /밖에서 식사.*눌러서 투표/ });
    expect(screen.queryByRole('region', { name: 'AI와 친구 의견 비교' })).not.toBeInTheDocument();
    expect(screen.queryByText(mine.reason!)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '선택하고 나니 어땠어요?' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('친구에게 공개하지 않을 회고')).not.toBeInTheDocument();

    await user.click(ballot);
    expect(await screen.findByRole('region', { name: 'AI와 친구 의견 비교' })).toBeInTheDocument();
    expect(screen.getByText('현재 투표는 동점이에요.')).toBeInTheDocument();
    expect(screen.getByText(mine.reason!)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '선택하고 나니 어땠어요?' })).not.toBeInTheDocument();
    expect(screen.queryByText('친구에게 공개하지 않을 회고')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('친구에게 공개하지 않을 회고')).not.toBeInTheDocument();
    await waitFor(() => expect(api.vote).toHaveBeenCalledTimes(1));
    expect(api.vote).toHaveBeenCalledWith('first-code', 'b');
  });
});
