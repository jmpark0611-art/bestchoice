const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('VITE_SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key'); });
afterEach(() => vi.unstubAllEnvs());
it('concurrent initial loads share one anonymous identity', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'same' } }, error: null });
  const { ensureSession } = await import('./supabase');
  expect(await Promise.all([ensureSession(), ensureSession()])).toEqual(['same', 'same']);
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
});
it('failed auth can be retried', async () => {
  auth.getSession.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { session: { access_token: 'ok' } }, error: null });
  const { ensureSession } = await import('./supabase');
  await expect(ensureSession()).rejects.toThrow('offline');
  await expect(ensureSession()).resolves.toBe('ok');
});

it('read-only session check creates nothing, and a later explicit action can still sign in once', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data:{ session:{ access_token:'new' } }, error:null });
  const { getExistingSessionToken, ensureSession } = await import('./supabase');
  expect(await getExistingSessionToken()).toBeNull();
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
  await expect(ensureSession()).resolves.toBe('new');
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
});
it('existing anonymous session is returned without creating an account', async () => {
  auth.getSession.mockResolvedValue({ data:{ session:{ access_token:'old', user:{ is_anonymous:true } } }, error:null });
  const { getExistingSessionToken, ensureSession } = await import('./supabase');
  await expect(getExistingSessionToken()).resolves.toBe('old');
  await expect(ensureSession()).resolves.toBe('old');
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
});
