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
export async function ensureSession(): Promise<string> {
  const sb = getSupabase();
  const { data, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw sessionError;
  if (data.session) return data.session.access_token;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.session) throw error ?? new Error('익명 로그인 실패');
  return signed.session.access_token;
}
