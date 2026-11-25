import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoryScreen } from './HistoryScreen';
import * as sessions from '../lib/supabase';
import { readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';
import {
  readHomeDraft, readReflectionDraft, saveHomeDraft, saveReflectionDraft,
} from '../lib/decisionDrafts';

const sdk = vi.hoisted(() => ({
  createClient: vi.fn(), getSession: vi.fn(), signInAnonymously: vi.fn(),
  from: vi.fn(), rpc: vi.fn(),
}));

// Keep HistoryScreen, the API/session helpers and device-storage modules real.
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://genie-test.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fixture-publishable-key');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  sdk.createClient.mockReturnValue({
    auth: { getSession: sdk.getSession, signInAnonymously: sdk.signInAnonymously },
    from: sdk.from, rpc: sdk.rpc,
  });
  sdk.getSession.mockResolvedValue({ data: { session: { access_token: 'original-session' } }, error: null });
  // The old path could create a replacement user and receive a successful no-op delete.
  sdk.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'replacement-session' } }, error: null });
  sdk.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: null }) });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it('preserves history and local records when the session is lost before confirmed deletion', async () => {
  const reflection = saveDecisionReflection({ pollId: 'p1', choice: 'b', rating: 'satisfied', note: '저장한 회고' });
  const reflectionDraft = saveReflectionDraft({ pollId: 'p1', choice: 'b', rating: 'neutral', note: '작성 중인 회고' }, null);
  const homeDraft = saveHomeDraft({ a: '커피', b: '차', note: '다시 생각 중', criterion: 'cost', quickMode: false, sourceId: 'p1' }, null);
  expect(reflection.ok && reflectionDraft.ok && homeDraft.ok).toBe(true);

  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis(),
    abortSignal: vi.fn(async () => ({
      data: [{ id: 'p1', option_a: '커피', option_b: '차', pick: 'a', did: 'b', created_at: '2026-11-25T00:00:00Z' }],
      error: null,
    })),
  };
  sdk.from.mockReturnValue(query);
  const ensureSession = vi.spyOn(sessions, 'ensureSession');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

  render(<MemoryRouter><HistoryScreen /></MemoryRouter>);
  await screen.findByRole('link', { name: '커피 vs 차' });
  expect(screen.getByText('저장한 회고')).toBeInTheDocument();
  const deleteButton = screen.getByRole('button', { name: '커피 vs 차 삭제' });
  await waitFor(() => expect(deleteButton).toBeEnabled());

  sdk.getSession.mockResolvedValue({ data: { session: null }, error: null });
  fireEvent.click(deleteButton);
  await waitFor(() => expect(sdk.getSession).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

  expect(readDecisionReflection('p1', 'b')).toEqual(reflection);
  expect(readReflectionDraft('p1', 'b')).toEqual(reflectionDraft);
  expect(readHomeDraft()).toEqual(homeDraft);
  expect(screen.getByRole('link', { name: '커피 vs 차' })).toBeInTheDocument();
  expect(screen.getByText('저장한 회고')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('삭제 완료 여부를 확인하지 못했어요.');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(sdk.from).toHaveBeenCalledExactlyOnceWith('vs_polls');
  expect(sdk.rpc).not.toHaveBeenCalled();
  expect(sdk.signInAnonymously).not.toHaveBeenCalled();
  expect(ensureSession).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
