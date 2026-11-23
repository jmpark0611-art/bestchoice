import { fireEvent, render, screen } from '@testing-library/react';
import { DecisionReflection } from './DecisionReflection';
import {
  DECISION_DRAFT_STORAGE_KEY, deleteReflectionDraft, readReflectionDraft, saveReflectionDraft, setDraftAutosaveEnabled,
  type DraftResult,
} from '../lib/decisionDrafts';
import { REFLECTION_STORAGE_KEY, readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';

const props = { pollId: 'poll-1', choice: 'a' as const, choiceLabel: '커피' };
const noteLabel = '나중에 떠올릴 한 줄 (선택)';
const draft = { pollId: 'poll-1', choice: 'a' as const, rating: 'regret' as const, note: '내가 작성 중이던 비공개 회고' };

function value<T>(result: DraftResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

it('keeps private draft contents out of the form until explicit restoration and does not save it permanently', () => {
  const savedDraft = value(saveReflectionDraft(draft, null));
  render(<DecisionReflection {...props} />);
  expect(screen.getByRole('region', { name: '회고 임시저장 확인' })).toBeInTheDocument();
  expect(screen.queryByText(draft.note)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(draft.note)).not.toBeInTheDocument();
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(screen.getByLabelText(noteLabel)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 불러오기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue(draft.note);
  expect(screen.getByLabelText(noteLabel)).not.toBeDisabled();
  expect(screen.getByRole('button', { name: '아쉬움' })).toHaveAttribute('aria-pressed', 'true');
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: savedDraft });
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
});

it('discards only the selected draft while preserving the permanent reflection and the other choice draft', () => {
  saveDecisionReflection({ ...draft, rating: 'satisfied', note: '이미 저장한 회고' });
  value(saveReflectionDraft(draft, null));
  const other = value(saveReflectionDraft({ ...draft, choice: 'b' }, null));
  render(<DecisionReflection {...props} />);
  expect(screen.getByLabelText(noteLabel)).toHaveValue('이미 저장한 회고');
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 버리기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('이미 저장한 회고');
  expect(screen.getByLabelText(noteLabel)).not.toBeDisabled();
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'b')).toEqual({ ok: true, value: other });
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '이미 저장한 회고' } });
});

it('autosaves edits from events and offers restoration after leaving and returning', () => {
  const first = render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '아직 만족도는 고르지 않았어요  ' } });
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: { rating: null, note: '아직 만족도는 고르지 않았어요  ' } });
  first.unmount();
  render(<DecisionReflection {...props} />);
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 불러오기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('아직 만족도는 고르지 않았어요  ');
  expect(screen.getByRole('button', { name: '회고 저장' })).toBeDisabled();
});

it('clears the matching draft after a successful permanent save', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '만족스러웠어요' } });
  expect(value(readReflectionDraft('poll-1', 'a'))?.note).toBe('만족스러웠어요');
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('status')).toHaveTextContent('이 기기에 회고를 저장했어요.');
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { rating: 'satisfied', note: '만족스러웠어요' } });
});

it('keeps both the editable text and its draft when the permanent save fails', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '보통' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '안전하게 남아야 할 메모' } });
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, raw) {
    if (key === REFLECTION_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
    originalSet.call(this, key, raw);
  });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('alert')).toHaveTextContent('저장 공간이 부족해요');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText(noteLabel)).toHaveValue('안전하게 남아야 할 메모');
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '안전하게 남아야 할 메모' } });
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
});

it('reports a successful permanent save and a failed draft cleanup separately', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '저장은 완료한 메모' } });
  const originalRemove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === DECISION_DRAFT_STORAGE_KEY) throw new DOMException('blocked', 'SecurityError');
    originalRemove.call(this, key);
  });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('status')).toHaveTextContent('이 기기에 회고를 저장했어요.');
  expect(screen.getByRole('alert')).toHaveTextContent('회고는 저장했지만 임시저장을 지우지 못했어요');
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '저장은 완료한 메모' } });
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '저장은 완료한 메모' } });
});

it('preserves typed text on a stale-tab conflict and asks before restoring the newer draft', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '첫 입력' } });
  const current = value(readReflectionDraft('poll-1', 'a'))!;
  const newer = value(saveReflectionDraft({ ...draft, note: '다른 탭의 최신 메모' }, current.revision));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '현재 화면에서 이어 쓴 메모' } });
  expect(screen.getByLabelText(noteLabel)).toHaveValue('현재 화면에서 이어 쓴 메모');
  expect(screen.getByRole('alert')).toHaveTextContent('다른 화면에서 임시저장이 바뀌었어요');
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: newer });
  fireEvent.click(screen.getByRole('button', { name: '임시저장 다시 확인' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('현재 화면에서 이어 쓴 메모');
  expect(screen.queryByDisplayValue('다른 탭의 최신 메모')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 불러오기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('다른 탭의 최신 메모');
});

it('does not replace the form or discard the stored draft when restoration cannot read storage', () => {
  value(saveReflectionDraft(draft, null));
  render(<DecisionReflection {...props} />);
  const originalGet = Storage.prototype.getItem;
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === DECISION_DRAFT_STORAGE_KEY) throw new DOMException('blocked', 'SecurityError');
    return originalGet.call(this, key);
  });
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 불러오기' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(screen.getByRole('region', { name: '회고 임시저장 확인' })).toBeInTheDocument();
  get.mockRestore();
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: draft });
});

it('respects autosave opt-out while keeping an explicit permanent save available', () => {
  value(setDraftAutosaveEnabled(false));
  render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '직접 저장할 회고' } });
  expect(screen.getByText(/자동 임시저장이 꺼져 있어요/)).toBeInTheDocument();
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: null });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '직접 저장할 회고' } });
});

it('cancels edits and removes the matching draft without changing the permanent reflection', () => {
  saveDecisionReflection({ ...draft, rating: 'satisfied', note: '이미 저장한 회고' });
  const other = value(saveReflectionDraft({ ...draft, choice: 'b' }, null));
  render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '취소할 수정' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('이미 저장한 회고');
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'b')).toEqual({ ok: true, value: other });
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { note: '이미 저장한 회고' } });
});

it('preserves both the current edit and another tab draft if cancellation encounters a conflict', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '현재 수정 내용' } });
  const current = value(readReflectionDraft('poll-1', 'a'))!;
  const newer = value(saveReflectionDraft({ ...draft, note: '다른 탭 수정 내용' }, current.revision));
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByRole('alert')).toHaveTextContent('다른 화면에서 임시저장이 바뀌었어요');
  expect(screen.getByLabelText(noteLabel)).toHaveValue('현재 수정 내용');
  expect(readReflectionDraft('poll-1', 'a')).toEqual({ ok: true, value: newer });
});

it('immediately preserves the current typed draft after explicitly discarding a conflicting draft', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '첫 입력' } });
  const first = value(readReflectionDraft('poll-1', 'a'))!;
  value(saveReflectionDraft({ ...draft, note: '다른 탭 내용' }, first.revision));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '현재 화면에 남길 내용' } });
  fireEvent.click(screen.getByRole('button', { name: '임시저장 다시 확인' }));
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 버리기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('현재 화면에 남길 내용');
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: { rating: null, note: '현재 화면에 남길 내용' } });
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
});

it('immediately preserves the current edit if a conflicting draft disappears before explicit restoration', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '첫 입력' } });
  const first = value(readReflectionDraft('poll-1', 'a'))!;
  const newer = value(saveReflectionDraft({ ...draft, note: '다른 탭 내용' }, first.revision));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '잃지 않을 현재 입력' } });
  fireEvent.click(screen.getByRole('button', { name: '임시저장 다시 확인' }));
  value(deleteReflectionDraft('poll-1', 'a', newer.revision));
  fireEvent.click(screen.getByRole('button', { name: '임시 회고 불러오기' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('잃지 않을 현재 입력');
  expect(readReflectionDraft('poll-1', 'a')).toMatchObject({ ok: true, value: { rating: null, note: '잃지 않을 현재 입력' } });
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
});
