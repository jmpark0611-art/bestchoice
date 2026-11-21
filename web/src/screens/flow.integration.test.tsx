import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// Real React router, api.ts and Supabase SDK; only the network is replaced.
const poll = { id: '11111111-1111-4111-8111-111111111111', a: '짜장면', b: '짬뽕', pick: 'b', reason: '국물이 좋아요', isOwner: true, votes: { a: 0, b: 0 } };
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://genie-test.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('fresh home stays signed out; explicit decision signs in once; returning home reads history', async () => {
  const calls: string[] = [];
  let finishAuth!: () => void;
  const authGate = new Promise<void>((resolve) => { finishAuth = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    let body: unknown;
    if (url.includes('/auth/v1/signup')) body = { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'test-user', aud: 'authenticated', role: 'authenticated', is_anonymous: true } };
    else if (url.includes('/functions/v1/vs-decide')) body = { kind: 'pick', id: poll.id };
    else if (url.includes('/rest/v1/rpc/vs_my_poll')) body = poll;
    else if (url.includes('/rest/v1/vs_polls')) body = [{ id:poll.id, option_a:poll.a, option_b:poll.b, pick:poll.pick, created_at:'2026-11-19' }];
    else throw Error(`Unexpected request: ${url}`);
    if (url.includes('/auth/v1/signup')) await authGate;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const user = userEvent.setup();
  render(<StrictMode><MemoryRouter><App /></MemoryRouter></StrictMode>);
  await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
  expect(calls).toEqual([]);
  await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
  await waitFor(() => expect(calls.filter(x => x.includes('/auth/v1/signup'))).toHaveLength(1));
  expect(calls.some(x => x.includes('/functions/v1/vs-decide'))).toBe(false);
  finishAuth();
  expect(await screen.findByText('짬뽕!')).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name:'다른 것도 정하기' }));
  expect(await screen.findByRole('link', { name:'짜장면 vs 짬뽕 짬뽕' })).toHaveAttribute('href', '/p/'+poll.id);
  expect(calls.filter(x => x.includes('/rest/v1/vs_polls')).length).toBeGreaterThan(0);
  expect(calls.filter(x => x.includes('/auth/v1/signup'))).toHaveLength(1);
  expect(calls.filter(x => x.includes('/functions/v1/vs-decide'))).toHaveLength(1);
});
