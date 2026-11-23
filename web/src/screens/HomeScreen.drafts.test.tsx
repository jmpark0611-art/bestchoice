import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Poll } from '../lib/api';
import { AppError } from '../lib/errors';
import {
  deleteHomeDraft, readHomeDraft, readReflectionDraft, saveHomeDraft, saveReflectionDraft, setDraftAutosaveEnabled,
  type DraftResult, type HomeDraftInput,
} from '../lib/decisionDrafts';
import { getDefaultCriterion, saveDefaultCriterion } from '../lib/decisionPreferences';
import { readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';
import { buildReconsideration, makeReconsiderState } from '../lib/decisionReconsider';
import { HomeScreen } from './HomeScreen';

const api = vi.hoisted(() => ({ decide: vi.fn(), listMyPolls: vi.fn() }));
vi.mock('../lib/api', () => api);

const draft: HomeDraftInput = {
  a: '  커피', b: '차  ', note: '  공개 전에 확인할 상황  ',
  criterion: 'time', quickMode: true, sourceId: 'source-original',
};
const original: Poll = {
  id: 'original-decision', a: '산책한다', b: '집에서 쉰다', note: '중요한 기준: 내 만족\n날씨가 좋아요',
  isOwner: true, myVote: null, shareCode: 'keep-votes', did: 'b', createdAt: '2026-11-23T00:00:00Z',
  pick: 'a', reason: '기존 이유는 바꾸지 않아요', votes: { a: 2, b: 3 },
};

function value<T>(result: DraftResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function ResultPage() {
  const { id } = useParams();
  const location = useLocation();
  return <><h1>새 결정 결과 {id}</h1>{location.state?.draftCleanupFailed && <p>초안 정리 확인 필요</p>}</>;
}

function HistoryPage() {
  const navigate = useNavigate();
  return <><h1>결정 기록 페이지</h1><button onClick={() => navigate(-1)}>시스템 뒤로가기</button></>;
}

function openHome(state: unknown = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/p/:id" element={<ResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillDecision(note = '지금 입력 중인 상황') {
  fireEvent.change(screen.getByLabelText('A'), { target: { value: '커피' } });
  fireEvent.change(screen.getByLabelText('B'), { target: { value: '차' } });
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: note } });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.listMyPolls.mockResolvedValue([]);
  api.decide.mockResolvedValue({ kind: 'pick', id: 'new-decision' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('hides a private draft until explicit restoration, then restores raw text, quick mode, criterion, and source', async () => {
  value(saveHomeDraft(draft, null));
  const user = userEvent.setup();
  openHome();
  expect(screen.getByRole('region', { name: '이전 결정 초안' })).toBeInTheDocument();
  expect(screen.queryByLabelText('A')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(draft.note)).not.toBeInTheDocument();
  expect(screen.queryByText(draft.note.trim())).not.toBeInTheDocument();
  expect(api.decide).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
  expect(screen.getByLabelText('A')).toHaveValue(draft.a);
  expect(screen.getByLabelText('B')).toHaveValue(draft.b);
  expect(screen.getByRole('button', { name: /^빠른 결정$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('radio', { name: '시간 절약' })).toBeChecked();
  expect(screen.queryByLabelText(/상황 한 줄/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '기존 결정 보기' })).toHaveAttribute('href', '/p/source-original');
  await user.click(screen.getByRole('button', { name: /^빠른 결정$/ }));
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue(draft.note);
  expect(api.decide).not.toHaveBeenCalled();
});

it('discards only the Home draft while preserving preferences, reflections, other drafts, and unrelated storage', async () => {
  value(saveHomeDraft(draft, null));
  value(saveReflectionDraft({ pollId: 'other-poll', choice: 'b', rating: null, note: '따로 쓰던 회고' }, null));
  expect(saveDecisionReflection({ pollId: 'saved-poll', choice: 'a', rating: 'satisfied', note: '저장된 회고' }).ok).toBe(true);
  expect(saveDefaultCriterion('ease').ok).toBe(true);
  localStorage.setItem('unrelated-value', 'keep');
  const user = userEvent.setup();
  openHome();
  await user.click(screen.getByRole('button', { name: '초안 버리고 새로 쓰기' }));
  expect(screen.getByLabelText('A')).toHaveValue('');
  expect(screen.getByRole('radio', { name: '편리함' })).toBeChecked();
  expect(value(readHomeDraft())).toBeNull();
  expect(value(readReflectionDraft('other-poll', 'b'))?.note).toBe('따로 쓰던 회고');
  expect(readDecisionReflection('saved-poll', 'a')).toMatchObject({ ok: true, value: { note: '저장된 회고' } });
  expect(getDefaultCriterion()).toEqual({ criterion: 'ease', status: 'saved' });
  expect(localStorage.getItem('unrelated-value')).toBe('keep');
  expect(api.decide).not.toHaveBeenCalled();
});

it('does not overwrite an existing draft when reconsideration arrives and only loads it after the user discards the old draft', async () => {
  const saved = value(saveHomeDraft(draft, null));
  const state = makeReconsiderState(buildReconsideration(original)!);
  const user = userEvent.setup();
  openHome(state);
  expect(screen.getByRole('region', { name: '이전 결정 초안' })).toBeInTheDocument();
  expect(value(readHomeDraft())).toEqual(saved);
  expect(screen.queryByDisplayValue(original.a)).not.toBeInTheDocument();
  expect(api.decide).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '초안 버리고 새로 쓰기' }));
  expect(screen.getByLabelText('A')).toHaveValue(original.a);
  expect(screen.getByLabelText('B')).toHaveValue(original.b);
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('날씨가 좋아요');
  expect(screen.getByRole('radio', { name: '내 만족' })).toBeChecked();
  expect(screen.getByRole('link', { name: '기존 결정 보기' })).toHaveAttribute('href', '/p/original-decision');
  expect(api.decide).not.toHaveBeenCalled();
});

it('prefills a new reconsideration without submitting, then creates a new decision only on explicit click', async () => {
  const frozen = Object.freeze({ ...original, votes: Object.freeze({ a: 2, b: 3 }) });
  const before = JSON.stringify(frozen);
  const user = userEvent.setup();
  openHome(makeReconsiderState(buildReconsideration(frozen)!));
  expect(screen.getByRole('region', { name: '조건을 바꿔 다시 비교' })).toBeInTheDocument();
  expect(screen.getByLabelText('A')).toHaveValue(frozen.a);
  expect(screen.getByRole('button', { name: /^빠른 결정$/ })).toHaveAttribute('aria-pressed', 'false');
  expect(api.decide).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '비가 오기 시작했어요' } });
  expect(value(readHomeDraft())).toMatchObject({ sourceId: frozen.id, note: '비가 오기 시작했어요' });
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  expect(api.decide).toHaveBeenCalledExactlyOnceWith({
    a: frozen.a, b: frozen.b, note: '중요한 기준: 내 만족\n비가 오기 시작했어요',
  });
  expect(await screen.findByRole('heading', { name: '새 결정 결과 new-decision' })).toBeInTheDocument();
  expect(JSON.stringify(frozen)).toBe(before);
  expect(value(readHomeDraft())).toBeNull();
});

it('removes the submitted draft after success while keeping another local reflection draft', async () => {
  value(saveReflectionDraft({ pollId: 'other-poll', choice: 'a', rating: null, note: '회고 입력 중' }, null));
  const user = userEvent.setup();
  openHome();
  fillDecision();
  expect(value(readHomeDraft())).toMatchObject({ a: '커피', b: '차', note: '지금 입력 중인 상황' });
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  await screen.findByRole('heading', { name: '새 결정 결과 new-decision' });
  expect(value(readHomeDraft())).toBeNull();
  expect(value(readReflectionDraft('other-poll', 'a'))?.note).toBe('회고 입력 중');
  expect(api.decide).toHaveBeenCalledTimes(1);
});

it('keeps the draft and entered text after request failure without retrying automatically', async () => {
  api.decide.mockRejectedValue(new AppError('TIMEOUT'));
  const user = userEvent.setup();
  const first = openHome();
  fillDecision('실패해도 남아야 할 내용');
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('최근 결정');
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('실패해도 남아야 할 내용');
  expect(value(readHomeDraft())?.note).toBe('실패해도 남아야 할 내용');
  first.unmount();
  openHome();
  expect(screen.getByRole('region', { name: '이전 결정 초안' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('실패해도 남아야 할 내용');
  expect(api.decide).toHaveBeenCalledTimes(1);
});

it('reports unavailable storage honestly but still allows an explicit decision request', async () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
  const user = userEvent.setup();
  openHome();
  expect(screen.getByRole('alert')).toHaveTextContent('임시저장했는지 확인하지 못했어요');
  fillDecision('현재 화면의 입력');
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('현재 화면의 입력');
  expect(screen.queryByText('입력한 내용을 이 기기의 초안으로 보관했어요.')).not.toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '커피', b: '차', note: '현재 화면의 입력' });
  expect(await screen.findByRole('heading', { name: '새 결정 결과 new-decision' })).toBeInTheDocument();
  expect(screen.getByText('초안 정리 확인 필요')).toBeInTheDocument();
});

it('pauses autosave on a stale-tab conflict and preserves both the current input and the newer stored draft', async () => {
  await act(async () => { openHome(); });
  fillDecision('첫 화면의 입력');
  const first = value(readHomeDraft())!;
  const fromOtherTab = value(saveHomeDraft({ ...first, note: '다른 탭의 최신 입력' }, first.revision));
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '지금 화면에서 더 적은 내용' } });
  expect(screen.getByRole('alert')).toHaveTextContent('다른 화면에서 임시저장이 바뀌었어요');
  expect(screen.getByRole('alert')).toHaveTextContent('초안 자동 저장을 멈췄으니');
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('지금 화면에서 더 적은 내용');
  expect(value(readHomeDraft())).toEqual(fromOtherTab);
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '멈춘 뒤에도 이 화면은 편집 가능' } });
  expect(value(readHomeDraft())).toEqual(fromOtherTab);
  expect(api.decide).not.toHaveBeenCalled();
});

it('recovers an incomplete draft after in-app navigation and browser-history back', async () => {
  const user = userEvent.setup();
  openHome();
  fireEvent.change(screen.getByLabelText('A'), { target: { value: '아직 한 쪽만' } });
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '  이어서 쓸 상황  ' } });
  await user.click(screen.getByRole('link', { name: '결정 기록 전체 보기' }));
  expect(await screen.findByRole('heading', { name: '결정 기록 페이지' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '시스템 뒤로가기' }));
  expect(await screen.findByRole('region', { name: '이전 결정 초안' })).toBeInTheDocument();
  expect(screen.queryByLabelText('A')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
  expect(screen.getByLabelText('A')).toHaveValue('아직 한 쪽만');
  expect(screen.getByLabelText('B')).toHaveValue('');
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('  이어서 쓸 상황  ');
  expect(api.decide).not.toHaveBeenCalled();
});

it('immediately persists the kept current input after the user discards a conflicting stored draft', async () => {
  const user = userEvent.setup();
  await act(async () => { openHome(); });
  fillDecision('처음 보관한 내용');
  const first = value(readHomeDraft())!;
  value(saveHomeDraft({ ...first, note: '다른 화면의 새 초안' }, first.revision));
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '  지금 화면에서 계속 쓴 내용  ' } });
  expect(screen.getByRole('alert')).toHaveTextContent('다른 화면에서 임시저장이 바뀌었어요');
  await user.click(screen.getByRole('button', { name: '기기 초안 다시 확인' }));
  expect(screen.getByRole('region', { name: '이전 결정 초안' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '기기 초안 버리고 현재 입력 유지' }));

  // No additional edit should be required to make the retained form recoverable.
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('  지금 화면에서 계속 쓴 내용  ');
  expect(value(readHomeDraft())).toMatchObject({ a: '커피', b: '차', note: '  지금 화면에서 계속 쓴 내용  ' });
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(false);
  expect(api.decide).not.toHaveBeenCalled();
});

it('immediately recovers the current input after a stored draft was removed externally', async () => {
  const user = userEvent.setup();
  await act(async () => { openHome(); });
  fillDecision('외부 삭제 전 내용');
  const first = value(readHomeDraft())!;
  value(deleteHomeDraft(first.revision));
  fireEvent.change(screen.getByLabelText(/상황 한 줄/), { target: { value: '삭제 이후 화면에서 이어 쓴 내용' } });
  expect(screen.getByRole('alert')).toHaveTextContent('다른 화면에서 임시저장이 바뀌었어요');
  expect(value(readHomeDraft())).toBeNull();
  await user.click(screen.getByRole('button', { name: '기기 초안 다시 확인' }));

  expect(screen.queryByRole('region', { name: '이전 결정 초안' })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('삭제 이후 화면에서 이어 쓴 내용');
  expect(value(readHomeDraft())).toMatchObject({ a: '커피', b: '차', note: '삭제 이후 화면에서 이어 쓴 내용' });
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(false);
  expect(api.decide).not.toHaveBeenCalled();
});

it('requires another explicit choice if a pending draft was changed elsewhere before restoration', async () => {
  const first = value(saveHomeDraft(draft, null));
  const user = userEvent.setup();
  openHome();
  const latest = value(saveHomeDraft({ ...draft, a: '다른 탭의 A' }, first.revision));
  await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
  expect(screen.getByRole('alert')).toHaveTextContent('초안이 다른 화면에서 바뀌었거나');
  expect(screen.queryByLabelText('A')).not.toBeInTheDocument();
  expect(value(readHomeDraft())).toEqual(latest);
  await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
  expect(screen.getByLabelText('A')).toHaveValue('다른 탭의 A');
  expect(api.decide).not.toHaveBeenCalled();
});

it('respects autosave opt-out and warns before leaving while retaining explicit submission', async () => {
  value(setDraftAutosaveEnabled(false));
  const user = userEvent.setup();
  openHome();
  expect(screen.getByText('초안 자동 저장이 꺼져 있어요.')).toBeInTheDocument();
  fillDecision('저장하지 않기로 한 상황');
  expect(value(readHomeDraft())).toBeNull();
  const unload = new Event('beforeunload', { cancelable: true });
  act(() => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  await waitFor(() => expect(api.decide).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('heading', { name: '새 결정 결과 new-decision' })).toBeInTheDocument();
  expect(value(readHomeDraft())).toBeNull();
});
