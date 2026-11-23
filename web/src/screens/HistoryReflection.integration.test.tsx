import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoryScreen } from './HistoryScreen';
import { AboutScreen } from './AboutScreen';
import { deleteDecision, listDecisionHistory, type DecisionRecord } from '../lib/api';
import {
  REFLECTION_STORAGE_KEY, readDecisionReflection, readDecisionReflections, saveDecisionReflection,
} from '../lib/decisionReflections';
import { getDefaultCriterion, saveDefaultCriterion } from '../lib/decisionPreferences';

vi.mock('../lib/api', () => ({ listDecisionHistory: vi.fn(), deleteDecision: vi.fn() }));

const first: DecisionRecord = {
  id: 'poll-1', a: '커피', b: '차', pick: 'a', did: 'b', createdAt: '2026-11-22T00:00:00Z',
};
const second: DecisionRecord = {
  id: 'poll-2', a: '버스', b: '지하철', pick: 'b', did: 'a', createdAt: '2026-11-22T00:00:00Z',
};
const mountHistory = () => render(<MemoryRouter><HistoryScreen /></MemoryRouter>);
const mountAbout = () => render(<MemoryRouter><AboutScreen /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(listDecisionHistory).mockResolvedValue([first]);
  vi.mocked(deleteDecision).mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); });

it('shows and filters the reflection for the current actual choice, keeping earlier-choice notes hidden', async () => {
  const unwritten: DecisionRecord = { ...second, id: 'poll-3', a: '집밥', b: '외식' };
  const pending: DecisionRecord = { ...second, id: 'poll-4', a: '산책', b: '휴식', did: 'none' };
  vi.mocked(listDecisionHistory).mockResolvedValue([first, second, unwritten, pending]);
  saveDecisionReflection({ pollId: first.id, choice: 'a', rating: 'satisfied', note: '이전 선택의 메모' });
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'regret', note: '현재 선택의 메모' });
  saveDecisionReflection({ pollId: second.id, choice: 'a', rating: 'neutral', note: '버스 이용 메모' });
  saveDecisionReflection({ pollId: pending.id, choice: 'a', rating: 'satisfied', note: '고민 중으로 바꾸기 전의 메모' });

  mountHistory();
  await screen.findByText('현재 선택의 메모');
  expect(screen.queryByText('이전 선택의 메모')).not.toBeInTheDocument();
  expect(screen.queryByText('고민 중으로 바꾸기 전의 메모')).not.toBeInTheDocument();

  const filter = screen.getByLabelText('회고 필터');
  fireEvent.change(filter, { target: { value: 'satisfied' } });
  expect(screen.getByText('표시할 기록이 없어요.')).toBeInTheDocument();
  fireEvent.change(filter, { target: { value: 'regret' } });
  expect(screen.getByRole('link', { name: '커피 vs 차' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '버스 vs 지하철' })).not.toBeInTheDocument();
  fireEvent.change(filter, { target: { value: 'neutral' } });
  expect(screen.getByRole('link', { name: '버스 vs 지하철' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '커피 vs 차' })).not.toBeInTheDocument();
  fireEvent.change(filter, { target: { value: 'unwritten' } });
  expect(screen.getByRole('link', { name: '집밥 vs 외식' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '산책 vs 휴식' })).not.toBeInTheDocument();
});

it('waits for confirmation and server success before removing both local choices, preserving other records', async () => {
  vi.mocked(listDecisionHistory).mockResolvedValue([first, second]);
  saveDecisionReflection({ pollId: first.id, choice: 'a', rating: 'satisfied', note: 'A 회고' });
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'neutral', note: 'B 회고' });
  saveDecisionReflection({ pollId: second.id, choice: 'a', rating: 'regret', note: '다른 결정의 회고' });
  let finish!: () => void;
  vi.mocked(deleteDecision).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  mountHistory();
  await screen.findByText('B 회고');
  const remove = screen.getByRole('button', { name: '커피 vs 차 삭제' });
  fireEvent.click(remove);
  expect(deleteDecision).not.toHaveBeenCalled();
  expect(readDecisionReflection(first.id, 'a')).toMatchObject({ ok: true, value: { note: 'A 회고' } });

  confirm.mockReturnValue(true);
  fireEvent.click(remove);
  expect(deleteDecision).toHaveBeenCalledWith(first.id);
  expect(readDecisionReflection(first.id, 'b')).toMatchObject({ ok: true, value: { note: 'B 회고' } });
  await act(async () => { finish(); });
  await waitFor(() => expect(screen.queryByRole('link', { name: '커피 vs 차' })).not.toBeInTheDocument());
  expect(readDecisionReflection(first.id, 'a')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection(first.id, 'b')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection(second.id, 'a')).toMatchObject({ ok: true, value: { note: '다른 결정의 회고' } });
});

it('keeps local reflections and the visible record when server deletion times out', async () => {
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'regret', note: '서버 응답 전에는 보존' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(deleteDecision).mockRejectedValue(new Error('TIMEOUT'));
  mountHistory();
  await screen.findByText('서버 응답 전에는 보존');
  fireEvent.click(screen.getByRole('button', { name: '커피 vs 차 삭제' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('삭제 완료 여부를 확인하지 못했어요');
  expect(screen.getByRole('link', { name: '커피 vs 차' })).toBeInTheDocument();
  expect(readDecisionReflection(first.id, 'b')).toMatchObject({ ok: true, value: { note: '서버 응답 전에는 보존' } });
});

it('explains partial cleanup when server deletion succeeds but local deletion is blocked', async () => {
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'neutral', note: '기기에 남은 회고' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mountHistory();
  await screen.findByText('기기에 남은 회고');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  fireEvent.click(screen.getByRole('button', { name: '커피 vs 차 삭제' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('결정과 친구 투표는 삭제했지만 이 기기의 회고 또는 관련 초안 삭제를 확인하지 못했어요');
  expect(screen.queryByRole('link', { name: '커피 vs 차' })).not.toBeInTheDocument();
  expect(readDecisionReflection(first.id, 'b')).toMatchObject({ ok: true, value: { note: '기기에 남은 회고' } });
});

it('finishes local cleanup after an already-confirmed server deletion resolves following unmount', async () => {
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'satisfied', note: '삭제 대상' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: () => void;
  vi.mocked(deleteDecision).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = mountHistory();
  await screen.findByText('삭제 대상');
  fireEvent.click(screen.getByRole('button', { name: '커피 vs 차 삭제' }));
  view.unmount();
  expect(readDecisionReflection(first.id, 'b')).toMatchObject({ ok: true, value: { note: '삭제 대상' } });
  await act(async () => { finish(); });
  expect(readDecisionReflection(first.id, 'b')).toEqual({ ok: true, value: null });
});

it('still shows decision history and disables the local reflection filter when storage cannot be read', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  mountHistory();
  await screen.findByRole('link', { name: '커피 vs 차' });
  expect(screen.getByRole('alert')).toHaveTextContent('결정 기록은 계속 볼 수 있어요');
  expect(screen.getByLabelText('회고 필터')).toBeDisabled();
});

it('clears all reflections from About only after confirmation, leaving preferences and unrelated storage untouched', () => {
  saveDecisionReflection({ pollId: first.id, choice: 'a', rating: 'satisfied', note: '첫 번째 회고' });
  saveDecisionReflection({ pollId: second.id, choice: 'b', rating: 'regret', note: '두 번째 회고' });
  saveDefaultCriterion('cost');
  window.localStorage.setItem('unrelated-app-record', 'preserve-this');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  mountAbout();
  const clear = screen.getByRole('button', { name: '이 기기의 회고 모두 지우기' });
  fireEvent.click(clear);
  const remaining = readDecisionReflections();
  expect(remaining.ok && remaining.value.length).toBe(2);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(clear);
  expect(screen.getByRole('status')).toHaveTextContent('이 기기의 회고와 회고 초안을 모두 지웠어요.');
  expect(window.localStorage.getItem(REFLECTION_STORAGE_KEY)).toBeNull();
  expect(getDefaultCriterion()).toEqual({ criterion: 'cost', status: 'saved' });
  expect(window.localStorage.getItem('unrelated-app-record')).toBe('preserve-this');
});

it('does not report an About reset as successful when the storage remove operation silently fails', () => {
  saveDecisionReflection({ pollId: first.id, choice: 'b', rating: 'neutral', note: '지워지지 않은 회고' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  mountAbout();
  fireEvent.click(screen.getByRole('button', { name: '이 기기의 회고 모두 지우기' }));
  expect(screen.getByRole('alert')).toHaveTextContent('접근할 수 없어요');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(readDecisionReflection(first.id, 'b')).toMatchObject({ ok: true, value: { note: '지워지지 않은 회고' } });
});
