import { Capacitor } from '@capacitor/core';
export function publicShareOrigin(): string | null {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  if (!configured) return Capacitor.isNativePlatform() ? null : window.location.origin;
  try {
    const u = new URL(configured);
    if(u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash ||
      /(^localhost$|\.localhost$|\.invalid$|\.local$|^\[|^\d+\.)/.test(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}
export function voteUrl(code:string) {
  const origin = publicShareOrigin();
  return origin ? `${origin}/v/${encodeURIComponent(code)}` : null;
}
