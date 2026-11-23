import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Poll } from '../lib/api';
import { readHomeDraft } from '../lib/decisionDrafts';
import { AppError } from '../lib/errors';
import { HomeScreen } from './HomeScreen';
import { PollScreen } from './PollScreen';
import { VoteScreen } from './VoteScreen';

const api = vi.hoisted(() => ({ getMyPoll: vi.fn(), getSharedPoll: vi.fn(), vote: vi.fn(),
  setDid: vi.fn(), sharePoll: vi.fn(), decide: vi.fn(), listMyPolls: vi.fn() }));
const reporting = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/decisionReports', async () => ({
  ...await vi.importActual<typeof import('../lib/decisionReports')>('../lib/decisionReports'),
  submitDecisionReport: reporting.submit,
}));

const id = '12121212-1212-4121-8121-121212121212';
const mine: Poll = { id, a: '걷기', b: '버스', note: '중요한 기준: 시간 절약\n약속이 있어요', isOwner: true,
  myVote: null, shareCode: 'share-test', did: 'a', pick: 'b', reason: '시간을 아낄 수 있어요.',
  createdAt: '2026-11-23T00:00:00Z', votes: { a: 0, b: 0 } };
const beforeVote: Poll = { id: null, a: mine.a, b: mine.b, note: mine.note, isOwner: false, myVote: null,
  shareCode: 'share-test', did: null, createdAt: mine.createdAt };

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<HomeScreen />} />
    <Route path="/p/:id" element={<PollScreen />} />
    <Route path="/v/:code" element={<VoteScreen />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getMyPoll.mockResolvedValue(mine);
  api.getSharedPoll.mockResolvedValue(beforeVote);
  api.listMyPolls.mockResolvedValue([]);
  reporting.submit.mockImplementation(async (submission) => ({ status: 'received',
    receiptId: '34343434-3434-4343-8343-343434343434', requestId: submission.requestId, receivedAt: new Date().toISOString() }));
});

async function sendVisibleReport() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
  await user.click(screen.getByRole('radio', { name: '사실과 맞지 않아요' }));
  await user.type(screen.getByLabelText('어떤 문제였나요? (선택)'), '설명에 오류가 있어요');
  await user.click(screen.getByRole('button', { name: '보낼 내용 확인' }));
  expect(reporting.submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: '위 내용을 확인했고 신고 전송에 동의해요.' }));
  await user.click(screen.getByRole('button', { name: '신고 보내기' }));
  return user;
}

async function submitVisibleReport() {
  await sendVisibleReport();
  expect(await screen.findByText('신고가 서버에 접수됐어요.')).toBeInTheDocument();
}

it('links an owned decision to editable original conditions without automatically requesting a new result', async () => {
  const user = userEvent.setup();
  open(`/p/${id}`);
  await user.click(await screen.findByRole('link', { name: '조건을 고쳐 다시 비교' }));
  expect(screen.getByLabelText('A')).toHaveValue('걷기');
  expect(screen.getByLabelText('B')).toHaveValue('버스');
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('약속이 있어요');
  expect(screen.getByRole('radio', { name: '시간 절약' })).toBeChecked();
  expect(screen.getByRole('link', { name: '기존 결정 보기' })).toHaveAttribute('href', `/p/${id}`);
  expect(api.decide).not.toHaveBeenCalled();
  expect(api.setDid).not.toHaveBeenCalled();
  expect(api.sharePoll).not.toHaveBeenCalled();
  expect(readHomeDraft()).toEqual({ ok: true, value: null });
});

it('uses the owner target and requires preview plus consent before sending', async () => {
  open(`/p/${id}`);
  await screen.findByRole('button', { name: 'AI 답변 신고' });
  expect(reporting.submit).not.toHaveBeenCalled();
  await submitVisibleReport();
  expect(reporting.submit).toHaveBeenCalledExactlyOnceWith({
    target: { kind: 'owner', pollId: id }, category: 'incorrect', details: '설명에 오류가 있어요',
    consented: true, requestId: expect.any(String),
  });
});

it('offers result reporting only after a friend has voted and sends only the share target', async () => {
  const user = userEvent.setup();
  open('/v/share-test');
  await screen.findByRole('button', { name: /걷기 눌러서 투표/ });
  expect(screen.queryByRole('button', { name: 'AI 답변 신고' })).not.toBeInTheDocument();
  expect(screen.queryByText(mine.reason!)).not.toBeInTheDocument();
  api.vote.mockResolvedValue({ ...beforeVote, myVote: 'a', pick: 'b', reason: mine.reason, votes: { a: 1, b: 0 } });
  await user.click(screen.getByRole('button', { name: /걷기 눌러서 투표/ }));
  await screen.findByRole('button', { name: 'AI 답변 신고' });
  await submitVisibleReport();
  expect(reporting.submit).toHaveBeenCalledExactlyOnceWith({
    target: { kind: 'voter', shareCode: 'share-test' }, category: 'incorrect', details: '설명에 오류가 있어요',
    consented: true, requestId: expect.any(String),
  });
});

it('keeps the original reflection save guard on the new reconsideration link', async () => {
  open(`/p/${id}`);
  await screen.findByRole('link', { name: '조건을 고쳐 다시 비교' });
  fireEvent.change(screen.getByLabelText(/나중에 떠올릴 한 줄/), { target: { value: '아직 저장 전' } });
  fireEvent.click(screen.getByRole('link', { name: '조건을 고쳐 다시 비교' }));
  expect(screen.getByText(/저장하지 않은 회고가 있어요/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '조건을 고쳐 다시 비교해요' })).not.toBeInTheDocument();
  expect(api.decide).not.toHaveBeenCalled();
});

it('preserves the same request across blocked owner refresh, timeout, collapse, and explicit retry', async () => {
  let fail!: (error: Error) => void;
  reporting.submit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  open(`/p/${id}`);
  await screen.findByRole('button', { name: 'AI 답변 신고' });
  const user = await sendVisibleReport();
  const firstRequest = reporting.submit.mock.calls[0][0];
  await user.click(screen.getByRole('button', { name: '새로 고침' }));
  expect(api.getMyPoll).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/신고 접수 확인이 끝나지 않았어요/)).toBeInTheDocument();
  const exit = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(exit);
  expect(exit.defaultPrevented).toBe(true);
  await act(async () => fail(new AppError('TIMEOUT')));
  expect(await screen.findByText(/응답이 늦어 접수 여부를 확인하지 못했어요/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '신고 닫기' }));
  await user.click(screen.getByRole('link', { name: '조건을 고쳐 다시 비교' }));
  expect(screen.queryByLabelText('A')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
  await user.click(screen.getByRole('button', { name: '같은 신고 다시 보내기' }));
  expect(await screen.findByText('신고가 서버에 접수됐어요.')).toBeInTheDocument();
  expect(reporting.submit).toHaveBeenCalledTimes(2);
  expect(reporting.submit.mock.calls[1][0]).toEqual(firstRequest);
  await user.click(screen.getByRole('button', { name: '새로 고침' }));
  await waitFor(() => expect(api.getMyPoll).toHaveBeenCalledTimes(2));
});

it('guards both voter navigation links until the uncertain report is explicitly acknowledged', async () => {
  api.getSharedPoll.mockResolvedValue({ ...beforeVote, myVote: 'a', pick: 'b', reason: mine.reason, votes: { a: 1, b: 0 } });
  reporting.submit.mockRejectedValueOnce(new AppError('TIMEOUT'));
  open('/v/share-test');
  await screen.findByRole('button', { name: 'AI 답변 신고' });
  const user = await sendVisibleReport();
  await screen.findByText(/응답이 늦어 접수 여부를 확인하지 못했어요/);
  await user.click(screen.getByRole('link', { name: /결정해지니/ }));
  expect(screen.queryByLabelText('A')).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: '나도 결정 받기' }));
  expect(screen.getByText(/신고 접수 확인이 끝나지 않았어요/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '접수 확인 없이 나가기 허용' }));
  await user.click(screen.getByRole('button', { name: '확인 없이 나갈게요' }));
  await user.click(screen.getByRole('link', { name: /결정해지니/ }));
  expect(screen.getByLabelText('A')).toBeInTheDocument();
  expect(reporting.submit).toHaveBeenCalledTimes(1);
});
