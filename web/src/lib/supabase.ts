import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY가 설정되지 않았어요.');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

/** 세션이 없으면 익명 로그인. 투표하러 온 친구도 가입 없이 이 방식으로 한 표를 가진다 */
export async function getExistingSessionToken(): Promise<string | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

async function loadSession(): Promise<string> {
  const existing = await getExistingSessionToken();
  if (existing !== null) return existing;
  const { data: signed, error } = await getSupabase().auth.signInAnonymously();
  if (error || !signed.session) throw error ?? new Error('익명 로그인 실패');
  return signed.session.access_token;
}


// Concurrent operations that need authentication share one anonymous login.
let pendingSession: Promise<string> | null = null;
export function ensureSession(): Promise<string> {
  if (!pendingSession) {
    pendingSession = loadSession().finally(() => { pendingSession = null; });
  }
  return pendingSession;
}
