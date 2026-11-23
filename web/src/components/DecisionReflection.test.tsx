import { fireEvent, render, screen } from '@testing-library/react';
import { DecisionReflection } from './DecisionReflection';
import { readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';

const props = { pollId: 'poll-1', choice: 'a' as const, choiceLabel: '커피' };
const noteLabel = '나중에 떠올릴 한 줄 (선택)';

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

it('only saves on explicit submit and restores the saved satisfaction after remounting', () => {
  const first = render(<DecisionReflection {...props} />);
  expect(screen.getByRole('button', { name: '회고 저장' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '  오후에도 괜찮았어요  ' } });
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('status')).toHaveTextContent('이 기기에 회고를 저장했어요.');
  first.unmount();
  render(<DecisionReflection {...props} />);
  expect(screen.getByRole('button', { name: '만족' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText(noteLabel)).toHaveValue('오후에도 괜찮았어요');
});

it('preserves the unsaved draft and never says saved when storage is full', () => {
  render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '아쉬움' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '다음에는 차를 마실래요' } });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('alert')).toHaveTextContent('저장 공간이 부족해요');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText(noteLabel)).toHaveValue('다음에는 차를 마실래요');
  expect(screen.getByRole('button', { name: '아쉬움' })).toHaveAttribute('aria-pressed', 'true');
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('status')).toHaveTextContent('이 기기에 회고를 저장했어요.');
});

it('discards the old unsaved editor when the route or actual choice changes', () => {
  const view = render(<DecisionReflection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '이전 결정의 메모' } });
  view.rerender(<DecisionReflection pollId="poll-2" choice="a" choiceLabel="버스" />);
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(screen.getByRole('button', { name: '회고 저장' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '보통' }));
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  view.rerender(<DecisionReflection pollId="poll-2" choice="b" choiceLabel="지하철" />);
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(screen.getByRole('button', { name: '보통' })).toHaveAttribute('aria-pressed', 'false');
  expect(readDecisionReflection('poll-1', 'a')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection('poll-2', 'a')).toMatchObject({ ok: true, value: { rating: 'neutral', note: '' } });
});

it('keeps the saved reflection visible when deletion fails, then deletes only this choice on success', () => {
  saveDecisionReflection({ ...props, rating: 'satisfied', note: '좋았어요' });
  saveDecisionReflection({ pollId: 'poll-1', choice: 'b', rating: 'neutral', note: '다른 선택' });
  render(<DecisionReflection {...props} />);
  const remove = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  fireEvent.click(screen.getByRole('button', { name: '회고 삭제' }));
  expect(screen.getByRole('alert')).toHaveTextContent('접근할 수 없어요');
  expect(screen.getByLabelText(noteLabel)).toHaveValue('좋았어요');
  remove.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '회고 삭제' }));
  expect(screen.getByRole('status')).toHaveTextContent('회고를 지웠어요');
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(readDecisionReflection('poll-1', 'b')).toMatchObject({ ok: true, value: { note: '다른 선택' } });
});

it('does not enable editing while the actual choice is being changed', () => {
  render(<DecisionReflection {...props} disabled />);
  expect(screen.getByRole('button', { name: '만족' })).toBeDisabled();
  expect(screen.getByLabelText(noteLabel)).toBeDisabled();
  expect(screen.getByRole('button', { name: '회고 저장' })).toBeDisabled();
});

it('warns about a browser refresh only while the editor has unsaved changes', () => {
  const view = render(<DecisionReflection {...props} />);
  const before = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '만족' }));
  const dirty = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  view.unmount();
});

it('reports dirty changes and restores the saved reflection when editing is cancelled', () => {
  saveDecisionReflection({ pollId: 'poll-1', choice: 'a', rating: 'satisfied', note: '처음 저장한 메모' });
  const onDirtyChange = vi.fn();
  const view = render(<DecisionReflection {...props} onDirtyChange={onDirtyChange} />);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: '수정 취소' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '아쉬움' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '아직 저장하지 않은 변경' } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('처음 저장한 메모');
  expect(screen.getByRole('button', { name: '만족' })).toHaveAttribute('aria-pressed', 'true');
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: '수정 취소' })).not.toBeInTheDocument();
  expect(readDecisionReflection('poll-1', 'a')).toMatchObject({ ok: true, value: { rating: 'satisfied', note: '처음 저장한 메모' } });
  fireEvent.click(screen.getByRole('button', { name: '보통' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('cancels a failed new draft without writing and keeps storage-read errors visible', () => {
  const onDirtyChange = vi.fn();
  render(<DecisionReflection {...props} onDirtyChange={onDirtyChange} />);
  fireEvent.click(screen.getByRole('button', { name: '보통' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '취소할 메모' } });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  fireEvent.click(screen.getByRole('button', { name: '회고 저장' }));
  expect(screen.getByRole('alert')).toHaveTextContent('저장 공간이 부족해요');
  write.mockRestore();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByLabelText(noteLabel)).toHaveValue('');
  expect(screen.getByRole('button', { name: '회고 저장' })).toBeDisabled();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('alert')).toHaveTextContent('접근할 수 없어요');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
