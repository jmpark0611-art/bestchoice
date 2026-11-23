import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { loadPublishedReleaseConfig } from './android-public-config.mjs';

// Every HTTP response is injected. These tests never contact the real website.
const key = 'sb_publishable_SYNTHETIC_PUBLIC_KEY_92817364';
const profile = { schemaVersion: 1, publicAppUrl: 'https://genie-web-rosy.vercel.app',
  supabaseProjectId: 'njrtcxohbkfgrgwhlvua', supabaseUrl: 'https://njrtcxohbkfgrgwhlvua.supabase.co',
  applicationId: 'com.jmpark0611.genie', versionCode: 1, versionName: '1.0.0',
  publishableKeySha256: createHash('sha256').update(key).digest('hex') };
function transport({ html = '<script type="module" src="/assets/index-fixture.js"></script>', script = `${profile.supabaseUrl} ${key}`, fail = false } = {}) {
  const calls = [];
  return { calls, get: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).origin, profile.publicAppUrl);
    if (fail) throw new Error(`DO_NOT_LOG_${key}`);
    return new Response(url.endsWith('/') ? html : script, { headers: { 'content-type': url.endsWith('/') ? 'text/html' : 'application/javascript' } });
  } };
}

test('published public client configuration is accepted only with the previously confirmed fingerprint', async () => {
  const f = transport(); const result = await loadPublishedReleaseConfig({ profile, fetch: f.get });
  assert.equal(result.ok, true); assert.equal(result.env.VITE_SUPABASE_PUBLISHABLE_KEY, key);
  assert.equal(result.evidence.backendContacted, false); assert.equal(f.calls.length, 2);
  assert.equal(JSON.stringify(result.evidence).includes(key), false);
});
test('different client keys, wrong backend origins, and transport failures return only a fixed error', async () => {
  for (const options of [{ script: `${profile.supabaseUrl} sb_publishable_DIFFERENT_PUBLIC_KEY_92817364` }, { script: key }, { fail: true }]) {
    const f = transport(options); const result = await loadPublishedReleaseConfig({ profile, fetch: f.get });
    assert.deepEqual(result, { ok: false, code: 'PUBLISHED_CLIENT_CONFIGURATION_UNCONFIRMED' });
  }
});
test('a page cannot redirect client configuration retrieval to another host or an API endpoint', async () => {
  for (const src of ['https://elsewhere.invalid/key.js', '/auth/v1/signup', '/assets/file.js?config=1', '//elsewhere.invalid/assets/file.js']) {
    const f = transport({ html: `<script src="${src}"></script>` });
    assert.equal((await loadPublishedReleaseConfig({ profile, fetch: f.get })).ok, false);
    assert.equal(f.calls.length, 1);
  }
});
test('unapproved profiles are refused before any network request and success bodies cannot be unbounded', async () => {
  const f = transport();
  assert.equal((await loadPublishedReleaseConfig({ profile: { ...profile, publicAppUrl: 'https://elsewhere.invalid' }, fetch: f.get })).ok, false);
  assert.equal(f.calls.length, 0);
  const large = transport({ html: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal((await loadPublishedReleaseConfig({ profile, fetch: large.get })).ok, false);
});
