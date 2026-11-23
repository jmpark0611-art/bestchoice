import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Poll } from '../lib/api';
import type { ReportReceipt, ReportSubmission } from '../lib/decisionReports';
import { AppError } from '../lib/errors';
import { VoteScreen } from './VoteScreen';

const api = vi.hoisted(() => ({ getSharedPoll: vi.fn(), vote: vi.fn(), setQuestionAuthorBlocked: vi.fn() }));
const submit = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => api);
vi.mock('../lib/decisionReports', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/decisionReports')>(), submitDecisionReport: submit,
}));

const base: Poll = {
  id: null, a: '질문 선택 A', b: '질문 선택 B', note: '공유된 상황', isOwner: false,
  myVote: null, shareCode: null, did: null, createdAt: '2026-11-23T00:00:00Z',
  // Even a malformed backend response must not reveal these fields before voting.
  pick: 'a', reason: '투표 전 숨겨야 할 AI 이유', votes: { a: 9, b: 2 },
};
const receipt: ReportReceipt = {
  status: 'received', receiptId: '00000000-0000-4000-8000-000000000003',
  requestId: '00000000-0000-4000-8000-000000000001', receivedAt: '2026-11-23T09:00:00Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function RouteProbe() {
  const location = useLocation(), navigate = useNavigate();
  return <>
    <output data-testid="route">{location.pathname}</output>
    <button onClick={() => navigate('/v/second')}>테스트 경로 변경</button>
  </>;
}
function mount() {
  return render(<MemoryRouter initialEntries={['/v/first']}>
    <RouteProbe />
    <Routes>
      <Route path="/v/:code" element={<VoteScreen />} />
      <Route path="/" element={<p>홈 화면</p>} />
      <Route path="/about" element={<p>안내 화면</p>} />
    </Routes>
  </MemoryRouter>);
}
async function sendReport(user: ReturnType<typeof userEvent.setup>, kind: 'question' | 'ai') {
  const panel = within(screen.getByRole('region', {
    name: kind === 'question' ? '이 질문에 문제가 있나요?' : 'AI 답변에 문제가 있나요?',
  }));
  await user.click(panel.getByRole('button', { name: kind === 'question' ? '질문 신고' : 'AI 답변 신고' }));
  await user.click(panel.getByRole('radio', { name: '다른 문제가 있어요' }));
  await user.click(panel.getByRole('button', { name: '보낼 내용 확인' }));
  await user.click(panel.getByRole('checkbox'));
  await user.click(panel.getByRole('button', { name: '신고 보내기' }));
  return panel;
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  submit.mockReset();
  api.getSharedPoll.mockResolvedValue(base);
  api.setQuestionAuthorBlocked.mockResolvedValue(undefined);
  submit.mockImplementation(async (input: ReportSubmission) => ({ ...receipt, requestId: input.requestId }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('shared question reporting and author block guards', () => {
  it('allows a pre-vote question report without exposing or submitting hidden AI fields', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: '질문 신고' });
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
    expect(screen.queryByText('지니의 선택')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await sendReport(user, 'question');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      target: { kind: 'question', shareCode: 'first' }, requestId: expect.any(String),
      category: 'other', details: '', consented: true,
    });
    expect(api.vote).not.toHaveBeenCalled();
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
    expect(screen.queryByText(/대상 AI 선택:/)).not.toBeInTheDocument();
    expect(await screen.findByText('신고가 서버에 접수됐어요.')).toBeInTheDocument();
  });

  it('keeps vote, refresh, block and in-screen links locked until an uncertain question receipt is resolved', async () => {
    const pending = deferred<ReportReceipt>();
    submit.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: '질문 신고' });
    const panel = await sendReport(user, 'question');
    expect(screen.getByRole('button', { name: /질문 선택 A.*눌러서 투표/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이 작성자 차단' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: /결정해지니/ }));
    expect(screen.getByTestId('route')).toHaveTextContent('/v/first');
    const exiting = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(exiting);
    expect(exiting.defaultPrevented).toBe(true);
    expect(api.getSharedPoll).toHaveBeenCalledTimes(1);
    expect(api.vote).not.toHaveBeenCalled();
    expect(api.setQuestionAuthorBlocked).not.toHaveBeenCalled();
    await act(async () => { pending.reject(new AppError('TIMEOUT')); });
    expect(panel.getByRole('alert')).toHaveTextContent('접수 여부를 확인하지 못했어요');
    await user.click(panel.getByRole('button', { name: '신고 닫기' }));
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeDisabled();
    await user.click(panel.getByRole('button', { name: '질문 신고' }));
    await user.click(panel.getByRole('button', { name: '같은 신고 다시 보내기' }));
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
    expect(await panel.findByText('신고가 서버에 접수됐어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeEnabled();
    await user.click(screen.getByRole('link', { name: /결정해지니/ }));
    expect(screen.getByText('홈 화면')).toBeInTheDocument();
  });

  it('does not unlock a pending question when a separate AI report completes', async () => {
    api.getSharedPoll.mockResolvedValue({ ...base, myVote: 'a' });
    const question = deferred<ReportReceipt>(), ai = deferred<ReportReceipt>();
    submit.mockImplementation((input: ReportSubmission) => input.target.kind === 'question' ? question.promise : ai.promise);
    const user = userEvent.setup();
    mount();
    await screen.findByText('지니의 선택');
    const questionPanel = await sendReport(user, 'question');
    await sendReport(user, 'ai');
    await act(async () => { ai.resolve({ ...receipt, requestId: submit.mock.calls[1][0].requestId }); });
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이 작성자 차단' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: '나도 결정 받기' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/v/first');
    await act(async () => { question.reject(new AppError('TIMEOUT')); });
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeDisabled();
    await user.click(questionPanel.getByRole('button', { name: '접수 확인 없이 나가기 허용' }));
    await user.click(questionPanel.getByRole('button', { name: '확인 없이 나갈게요' }));
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeEnabled();
    const exiting = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(exiting);
    expect(exiting.defaultPrevented).toBe(false);
  });

  it('confirms blocking, hides content during writes, and reloads only after confirmed unblock', async () => {
    const block = deferred<void>(), unblock = deferred<void>();
    api.setQuestionAuthorBlocked.mockReturnValueOnce(block.promise).mockReturnValueOnce(unblock.promise);
    api.getSharedPoll.mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, a: '해제 후 새 질문' });
    vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    mount();
    const blockButton = await screen.findByRole('button', { name: '이 작성자 차단' });
    await user.click(blockButton);
    expect(api.setQuestionAuthorBlocked).not.toHaveBeenCalled();
    await user.click(blockButton);
    expect(api.setQuestionAuthorBlocked).toHaveBeenCalledExactlyOnceWith('first', true);
    expect(screen.queryByText(base.note!)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '질문 신고' })).not.toBeInTheDocument();
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
    await act(async () => { block.resolve(undefined); });
    const unblockButton = await screen.findByRole('button', { name: '차단 해제하고 보기' });
    fireEvent.click(unblockButton); fireEvent.click(unblockButton);
    expect(api.setQuestionAuthorBlocked).toHaveBeenCalledTimes(2);
    expect(api.setQuestionAuthorBlocked).toHaveBeenLastCalledWith('first', false);
    expect(api.getSharedPoll).toHaveBeenCalledTimes(1);
    await act(async () => { unblock.resolve(undefined); });
    expect(await screen.findByRole('button', { name: /해제 후 새 질문.*눌러서 투표/ })).toBeInTheDocument();
    expect(api.getSharedPoll).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
  });

  it('keeps content hidden after an uncertain block and offers read-only state recovery', async () => {
    api.setQuestionAuthorBlocked.mockRejectedValue(new AppError('TIMEOUT'));
    api.getSharedPoll.mockResolvedValueOnce(base).mockRejectedValueOnce(new AppError('AUTHOR_BLOCKED'));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: '이 작성자 차단' }));
    expect(await screen.findByText('차단 상태를 확인하지 못했어요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '질문 신고' })).not.toBeInTheDocument();
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
    expect(api.setQuestionAuthorBlocked).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '차단 상태 다시 확인' }));
    expect(await screen.findByText('차단한 작성자의 질문이에요.')).toBeInTheDocument();
    expect(api.getSharedPoll).toHaveBeenCalledTimes(2);
    expect(api.setQuestionAuthorBlocked).toHaveBeenCalledTimes(1);
  });

  it('ignores a late unblock result after navigation to another share code', async () => {
    api.getSharedPoll.mockRejectedValueOnce(new AppError('AUTHOR_BLOCKED')).mockResolvedValueOnce({ ...base, a: '다른 작성자의 질문' });
    const unblock = deferred<void>();
    api.setQuestionAuthorBlocked.mockReturnValue(unblock.promise);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: '차단 해제하고 보기' }));
    await user.click(screen.getByRole('button', { name: '테스트 경로 변경' }));
    await screen.findByRole('button', { name: /다른 작성자의 질문.*눌러서 투표/ });
    await act(async () => { unblock.resolve(undefined); });
    expect(screen.getByTestId('route')).toHaveTextContent('/v/second');
    expect(api.getSharedPoll).toHaveBeenCalledTimes(2);
    expect(api.getSharedPoll).toHaveBeenLastCalledWith('second');
    expect(screen.getByRole('button', { name: /다른 작성자의 질문.*눌러서 투표/ })).toBeInTheDocument();
    expect(screen.queryByText('차단한 작성자의 질문이에요.')).not.toBeInTheDocument();
  });

  it('hides an already loaded question when the guarded vote reports a new block', async () => {
    api.vote.mockRejectedValue(new AppError('AUTHOR_BLOCKED'));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /질문 선택 A.*눌러서 투표/ }));
    expect(await screen.findByText('차단한 작성자의 질문이에요.')).toBeInTheDocument();
    expect(screen.queryByText(base.reason!)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '질문 신고' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
