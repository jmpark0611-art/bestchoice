import { createHash } from 'node:crypto';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const failure = () => ({ ok: false, code: 'PUBLISHED_CLIENT_CONFIGURATION_UNCONFIRMED' });
const publicOrigin = 'https://genie-web-rosy.vercel.app';
const projectId = 'njrtcxohbkfgrgwhlvua';

async function boundedText(response, limit, kind) {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes(kind)) throw new Error('SOURCE_UNAVAILABLE');
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('SOURCE_TOO_LARGE');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('SOURCE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Reads only the already-public HTML and directly referenced static JS of this
 * user's existing website. It never executes JS, opens the app, contacts Auth,
 * or sends any request to the backend. Accept a client key only when its exact
 * SHA-256 matches the previously confirmed project key in the reviewed profile.
 * The successful result contains public client configuration: never log it.
 */
export async function loadPublishedReleaseConfig({ profile, fetch: get = globalThis.fetch }) {
  try {
    if (!profile || profile.schemaVersion !== 1 || profile.publicAppUrl !== publicOrigin ||
        profile.supabaseProjectId !== projectId || profile.supabaseUrl !== `https://${projectId}.supabase.co` ||
        typeof profile.publishableKeySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(profile.publishableKeySha256)) return failure();
    const read = async (url, limit, kind) => {
      const response = await get(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: kind === 'html' ? 'text/html' : 'application/javascript,text/javascript' } });
      if (response.url && response.url !== url) throw new Error('SOURCE_REDIRECTED');
      return boundedText(response, limit, kind);
    };
    const html = await read(`${publicOrigin}/`, 1024 * 1024, 'html');
    const urls = new Set();
    // Only actual script src attributes and modulepreload href attributes. No
    // dynamic imports, arbitrary JS strings, source maps or alternate hosts.
    for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const text = tag[0];
      const script = /^<script\b/i.test(text);
      if (!script && !/\brel\s*=\s*['"]modulepreload['"]/i.test(text)) continue;
      const attribute = script ? /\bsrc\s*=\s*(['"])(.*?)\1/i : /\bhref\s*=\s*(['"])(.*?)\1/i;
      const match = text.match(attribute);
      if (!match) continue;
      const url = new URL(match[2], `${publicOrigin}/`);
      if (url.origin !== publicOrigin || url.search || url.hash || !/^\/assets\/[A-Za-z0-9_.-]+\.js$/.test(url.pathname)) throw new Error('UNEXPECTED_STATIC_ASSET');
      urls.add(url.href);
    }
    if (urls.size === 0 || urls.size > 8) return failure();
    const sources = [html];
    const sourceHashes = [];
    for (const url of urls) {
      const body = await read(url, 4 * 1024 * 1024, 'javascript');
      sources.push(body);
      sourceHashes.push({ path: new URL(url).pathname, sha256: digest(body) });
    }
    const found = new Set();
    for (const source of sources) {
      for (const [key] of source.matchAll(/sb_publishable_[A-Za-z0-9_-]{20,200}/g)) {
        if (digest(key) === profile.publishableKeySha256) found.add(key);
      }
    }
    if (found.size !== 1 || !sources.some(source => source.replaceAll('\\/', '/').includes(profile.supabaseUrl))) return failure();
    const env = {
      GENIE_ANDROID_APPLICATION_ID: profile.applicationId,
      GENIE_ANDROID_VERSION_CODE: String(profile.versionCode),
      GENIE_ANDROID_VERSION_NAME: profile.versionName,
      VITE_SUPABASE_URL: profile.supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: [...found][0],
      VITE_PUBLIC_APP_URL: profile.publicAppUrl,
    };
    const resolved = resolveAndroidReleaseConfig(env);
    if (!resolved.ok) return failure();
    return { ok: true, env, evidence: { status: 'published-client-config-fingerprint-matched',
      htmlSha256: digest(html), sourceHashes, publishableKeySha256: profile.publishableKeySha256,
      staticGetOnly: true, backendContacted: false } };
  } catch {
    // Never return response bodies, keys, URLs from exceptions, or raw errors.
    return failure();
  }
}
