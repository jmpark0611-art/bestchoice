import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter } from 'react-router-dom';
import { HistoryScreen } from './HistoryScreen';
import { getSupabase } from '../lib/supabase';
import { readDecisionReflection, saveDecisionReflection } from '../lib/decisionReflections';
import {
  readHomeDraft, readReflectionDraft, saveHomeDraft, saveReflectionDraft,
} from '../lib/decisionDrafts';

const OWNER = 'fixture-owner-a';
const OTHER = 'fixture-owner-b';
const poll = { id: 'p1', option_a: '커피', option_b: '차', pick: 'a', did: 'b', created_at: '2026-11-25T00:00:00Z' };
type RequestRecord = { method: string; url: URL; authorization: string | null; signal: AbortSignal | null | undefined };

// Exercise the installed SDK, its request builders and fetchWithAuth unchanged.
// Only the auth-session source and HTTP transport are synthetic; no server is contacted.
const transport = vi.fn<typeof fetch>();
let currentToken: string;
let exists: boolean;
let requests: RequestRecord[];
let unexpectedRequests: string[];
let probeCount: number;
let noOpDelete: boolean;
let onProbe: ((number: number) => Response | Promise<Response> | undefined) | undefined;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function session(token: string): Session {
  return {
    access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600,
    user: { id: token, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-25T00:00:00Z' },
  };
}

beforeEach(async () => {
  vi.useRealTimers();
  window.localStorage.clear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://genie-test.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fixture-publishable-key');
  vi.stubGlobal('fetch', transport);
  currentToken = OWNER;
  exists = true;
  requests = [];
  unexpectedRequests = [];
  probeCount = 0;
  noOpDelete = false;
  onProbe = undefined;
  transport.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const authorization = new Headers(init?.headers).get('Authorization');
    requests.push({ method, url, authorization, signal: init?.signal });
    const owned = authorization === `Bearer ${OWNER}`;
    if (url.origin === 'https://genie-test.invalid' && method === 'GET' && url.pathname === '/rest/v1/vs_polls') {
      if (url.searchParams.get('select') === 'id') {
        expect(url.searchParams.get('id')).toBe('eq.p1');
        probeCount++;
        const override = onProbe?.(probeCount);
        if (override !== undefined) return override;
        return json(owned && exists ? [{ id: poll.id }] : []);
      }
      return json(owned && exists ? [poll] : []);
    }
    if (url.origin === 'https://genie-test.invalid' && method === 'POST' && url.pathname === '/rest/v1/rpc/vs_delete_poll') {
      expect(JSON.parse(String(init?.body))).toEqual({ p_id: poll.id });
      if (owned && !noOpDelete) exists = false;
      // The existing SQL returns void even when the caller deleted zero rows.
      return new Response(null, { status: 204 });
    }
    unexpectedRequests.push(`${method} ${url.origin}${url.pathname}`);
    throw new Error('Unexpected fixture request');
  });
  const client = getSupabase();
  await client.auth.initialize();
  await client.auth.stopAutoRefresh();
  vi.spyOn(client.auth, 'getSession').mockImplementation(async () => ({ data: { session: session(currentToken) }, error: null }));
  vi.spyOn(client.auth, 'signInAnonymously');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  expect(getSupabase().auth.signInAnonymously).not.toHaveBeenCalled();
  expect(unexpectedRequests).toEqual([]);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

async function showSavedHistory() {
  const saved = {
    reflection: saveDecisionReflection({ pollId: poll.id, choice: 'b', rating: 'satisfied', note: '저장한 회고' }),
    reflectionDraft: saveReflectionDraft({ pollId: poll.id, choice: 'b', rating: 'neutral', note: '작성 중인 회고' }, null),
    homeDraft: saveHomeDraft({ a: '커피', b: '차', note: '다시 생각 중', criterion: 'cost', quickMode: false, sourceId: poll.id }, null),
  };
  expect(Object.values(saved).every(value => value.ok)).toBe(true);
  render(<MemoryRouter><HistoryScreen /></MemoryRouter>);
  await screen.findByRole('link', { name: '커피 vs 차' });
  const button = screen.getByRole('button', { name: '커피 vs 차 삭제' });
  await waitFor(() => expect(button).toBeEnabled());
  return { saved, button };
}

function expectLocalRecords(saved: Awaited<ReturnType<typeof showSavedHistory>>['saved']) {
  expect(readDecisionReflection(poll.id, 'b')).toEqual(saved.reflection);
  expect(readReflectionDraft(poll.id, 'b')).toEqual(saved.reflectionDraft);
  expect(readHomeDraft()).toEqual(saved.homeDraft);
  expect(screen.getByRole('link', { name: '커피 vs 차' })).toBeInTheDocument();
  expect(screen.getByText('저장한 회고')).toBeInTheDocument();
}

const mutations = () => requests.filter(request => request.method === 'POST');
const probes = () => requests.filter(request => request.url.searchParams.get('select') === 'id');

it('preserves stale owner history and device records after switching to a different valid session', async () => {
  const { saved, button } = await showSavedHistory();
  currentToken = OTHER;
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expectLocalRecords(saved);
  expect(screen.getByRole('alert')).toHaveTextContent('삭제 완료 여부를 확인하지 못했어요.');
  expect(mutations()).toHaveLength(0);
  expect(probes()).toHaveLength(1);
  expect(probes()[0].authorization).toBe(`Bearer ${OTHER}`);
  expect(exists).toBe(true);
});

it('keeps the captured owner on both reads and deletion when the SDK session changes mid-operation', async () => {
  const { button } = await showSavedHistory();
  onProbe = number => { if (number === 1) currentToken = OTHER; return undefined; };
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('link', { name: '커피 vs 차' })).not.toBeInTheDocument());
  expect(currentToken).toBe(OTHER);
  expect(requests.slice(1).map(request => request.authorization)).toEqual(Array(3).fill(`Bearer ${OWNER}`));
  expect(mutations()).toHaveLength(1);
  expect(probes()).toHaveLength(2);
  expect(exists).toBe(false);
  expect(readDecisionReflection(poll.id, 'b')).toEqual({ ok: true, value: null });
  expect(readReflectionDraft(poll.id, 'b')).toEqual({ ok: true, value: null });
  expect(readHomeDraft()).toEqual({ ok: true, value: null });
});

it('retains local records when the void RPC succeeds but the owned row still exists', async () => {
  const { saved, button } = await showSavedHistory();
  noOpDelete = true;
  fireEvent.click(button);
  await screen.findByRole('alert');
  expectLocalRecords(saved);
  expect(mutations()).toHaveLength(1);
  expect(probes()).toHaveLength(2);
  expect(exists).toBe(true);
});

it.each([
  ['HTTP error', () => json({ message: 'AUTH_REQUIRED', code: '42501' }, 403)],
  ['null body', () => json(null)],
  ['object body', () => json({})],
  ['invalid JSON', () => new Response('{', { status: 200 })],
] as const)('retains device records after deletion when the final read has %s', async (_label, response) => {
  const { saved, button } = await showSavedHistory();
  onProbe = number => number === 2 ? response() : undefined;
  fireEvent.click(button);
  await screen.findByRole('alert');
  expectLocalRecords(saved);
  expect(mutations()).toHaveLength(1);
  expect(probes()).toHaveLength(2);
  expect(exists).toBe(false);
});

it.each(['before deletion', 'after deletion'] as const)('retains device records on a timed-out read %s and ignores its late response', async phase => {
  const { saved, button } = await showSavedHistory();
  let finishRead: ((response: Response) => void) | undefined;
  const targetProbe = phase === 'before deletion' ? 1 : 2;
  onProbe = number => number === targetProbe ? new Promise<Response>(resolve => { finishRead = resolve; }) : undefined;
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(finishRead).toBeTypeOf('function');
  await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
  expectLocalRecords(saved);
  expect(screen.getByRole('alert')).toHaveTextContent('삭제 완료 여부를 확인하지 못했어요.');
  expect(probes().at(-1)?.signal?.aborted).toBe(true);
  expect(mutations()).toHaveLength(phase === 'before deletion' ? 0 : 1);
  await act(async () => {
    finishRead!(json(phase === 'before deletion' ? [{ id: poll.id }] : []));
    await vi.advanceTimersByTimeAsync(1);
  });
  expectLocalRecords(saved);
  expect(mutations()).toHaveLength(phase === 'before deletion' ? 0 : 1);
  expect(probes()).toHaveLength(targetProbe);
});
