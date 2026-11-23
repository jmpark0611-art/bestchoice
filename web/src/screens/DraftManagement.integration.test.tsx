import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutScreen } from './AboutScreen';
import { HistoryScreen } from './HistoryScreen';
import { deleteDecision, listDecisionHistory, type DecisionRecord } from '../lib/api';
import {
  DECISION_DRAFT_STORAGE_KEY, getDraftAutosaveEnabled, readHomeDraft, readReflectionDraft,
  saveHomeDraft, saveReflectionDraft,
} from '../lib/decisionDrafts';
import { readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';
import { getDefaultCriterion, saveDefaultCriterion } from '../lib/decisionPreferences';

vi.mock('../lib/api', () => ({ listDecisionHistory: vi.fn(), deleteDecision: vi.fn() }));
const row: DecisionRecord = { id: 'draft-poll', a: '버스', b: '걷기', pick: 'a', did: 'b', createdAt: '2026-11-23T00:00:00Z' };
const home = { a: '버스', b: '걷기', note: '비가 와요', criterion: 'time' as const, quickMode: false, sourceId: row.id };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(listDecisionHistory).mockResolvedValue([row]);
  vi.mocked(deleteDecision).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

function seed() {
  saveHomeDraft(home, null);
  saveReflectionDraft({ pollId: row.id, choice: 'a', rating: null, note: 'A 초안' }, null);
  saveReflectionDraft({ pollId: row.id, choice: 'b', rating: 'neutral', note: 'B 초안' }, null);
  saveDecisionReflection({ pollId: row.id, choice: 'b', rating: 'satisfied', note: '저장한 회고' });
  saveDefaultCriterion('cost');
}

it('turns autosave off only after confirmation, removes drafts, and preserves saved data', () => {
  seed();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MemoryRouter><AboutScreen /></MemoryRouter>);
  const toggle = screen.getByRole('checkbox', { name: '초안 자동 저장' });
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
  confirm.mockReturnValue(true);
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(getDraftAutosaveEnabled()).toEqual({ ok: true, value: false });
  expect(readHomeDraft()).toEqual({ ok: true, value: null });
  expect(readReflectionDraft(row.id, 'a')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection(row.id, 'b')).toMatchObject({ ok: true, value: { note: '저장한 회고' } });
  expect(getDefaultCriterion()).toMatchObject({ criterion: 'cost', status: 'saved' });
  fireEvent.click(toggle);
  expect(getDraftAutosaveEnabled()).toEqual({ ok: true, value: true });
  expect(readHomeDraft()).toEqual({ ok: true, value: null });
});

it('clears saved reflections and reflection drafts without deleting the current decision draft', () => {
  seed();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<MemoryRouter><AboutScreen /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '이 기기의 회고 모두 지우기' }));
  expect(screen.getByRole('status')).toHaveTextContent('회고와 회고 초안을 모두 지웠어요');
  expect(readReflectionDraft(row.id, 'a')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft(row.id, 'b')).toEqual({ ok: true, value: null });
  expect(readDecisionReflection(row.id, 'b')).toEqual({ ok: true, value: null });
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
});

it('does not claim opt-out or deletion when the storage write silently fails', () => {
  seed();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<MemoryRouter><AboutScreen /></MemoryRouter>);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('checkbox', { name: '초안 자동 저장' }));
  expect(screen.getByRole('checkbox', { name: '초안 자동 저장' })).toBeChecked();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
});

it('keeps drafts until server-confirmed deletion, including cleanup after the history screen unmounts', async () => {
  seed();
  saveReflectionDraft({ pollId: 'other-poll', choice: 'a', rating: null, note: '다른 초안' }, null);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: () => void;
  vi.mocked(deleteDecision).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<MemoryRouter><HistoryScreen /></MemoryRouter>);
  await screen.findByRole('link', { name: '버스 vs 걷기' });
  fireEvent.click(screen.getByRole('button', { name: '버스 vs 걷기 삭제' }));
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
  view.unmount();
  await act(async () => finish());
  expect(readHomeDraft()).toEqual({ ok: true, value: null });
  expect(readReflectionDraft(row.id, 'a')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft(row.id, 'b')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('other-poll', 'a')).toMatchObject({ ok: true, value: { note: '다른 초안' } });
});

it('preserves drafts when server deletion is uncertain and reports partial local cleanup accurately', async () => {
  seed();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(deleteDecision).mockRejectedValueOnce(new Error('timeout'));
  render(<MemoryRouter><HistoryScreen /></MemoryRouter>);
  await screen.findByRole('link', { name: '버스 vs 걷기' });
  fireEvent.click(screen.getByRole('button', { name: '버스 vs 걷기 삭제' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('삭제 완료 여부를 확인하지 못했어요');
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
    if (key === DECISION_DRAFT_STORAGE_KEY) throw new DOMException('blocked', 'SecurityError');
    remove.call(this, key);
  });
  fireEvent.click(screen.getByRole('button', { name: '버스 vs 걷기 삭제' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: '버스 vs 걷기' })).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toHaveTextContent('관련 초안 삭제를 확인하지 못했어요');
  expect(readHomeDraft()).toMatchObject({ ok: true, value: home });
  expect(readDecisionReflection(row.id, 'b')).toEqual({ ok: true, value: null });
});
