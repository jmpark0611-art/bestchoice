import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAndroidReleaseConfigErrors, resolveAndroidReleaseConfig } from './android-release-config.mjs';

// Syntax fixtures only: no endpoint is contacted and no identifiers are assigned to a real app.
const valid = Object.freeze({
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie',
  GENIE_ANDROID_VERSION_CODE: '12',
  GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
  VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
});
const jwt = (role, header = { alg: 'HS256', typ: 'JWT' }) => [
  Buffer.from(JSON.stringify(header)).toString('base64url'),
  Buffer.from(JSON.stringify({ role, iss: 'supabase', ref: 'fixture' })).toString('base64url'),
  Buffer.from('synthetic-signature-not-verified').toString('base64url'),
].join('.');
const invalid = (field, input, code) => {
  const result = resolveAndroidReleaseConfig({ ...valid, [field]: input });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.field === field && error.code === code));
  assert.equal('config' in result, false);
  return result;
};

test('uses only explicit inputs, fixes the release name, normalizes origins, and never mutates input', () => {
  const env = Object.freeze({ ...valid, VITE_SUPABASE_URL: 'https://FixtureProject.supabase.co:443/',
    VITE_PUBLIC_APP_URL: 'https://Genie.synthfixture.com/' });
  const result = resolveAndroidReleaseConfig(env);
  assert.deepEqual(result, { ok: true, config: {
    applicationId: valid.GENIE_ANDROID_APPLICATION_ID, appName: '결정해지니', versionCode: 12, versionName: '1.2.0',
    supabaseUrl: 'https://fixtureproject.supabase.co', publishableKey: valid.VITE_SUPABASE_PUBLISHABLE_KEY,
    publicAppUrl: 'https://genie.synthfixture.com',
  } });
  assert.equal(env.VITE_SUPABASE_URL, 'https://FixtureProject.supabase.co:443/');
});

test('reports the six missing fields once without filling anything from the process or a sample env file', () => {
  const result = resolveAndroidReleaseConfig({});
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(error => error.field).sort(), Object.keys(valid).sort());
  assert.ok(result.errors.every(error => error.code === 'MISSING'));
  assert.equal('config' in result, false);
});

test('does not invoke getters or inherit required values', () => {
  let invoked = false;
  const env = Object.create(valid);
  Object.defineProperty(env, 'GENIE_ANDROID_APPLICATION_ID', { enumerable: true, get() { invoked = true; throw new Error('secret'); } });
  const result = resolveAndroidReleaseConfig(env);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 6);
  assert.equal(invoked, false);
  for (const value of [null, undefined, [], 'environment']) assert.equal(resolveAndroidReleaseConfig(value).ok, false);
});

test('rejects preview, placeholder, malformed, and nonlowercase Android identifiers', () => {
  for (const value of [
    'dev.local.genie.preview', 'dev.local.genie', 'dev.local', 'com.example.genie', 'com.test.genie',
    'kr.fixture.preview', 'kr.fixture.debug', 'kr.fixture.demo', 'kr.fixture.staging', 'kr.localhost.app',
    'single', 'kr.Fixture.genie', '1kr.fixture.app', 'kr..app', 'kr.fixture.bad-name', 'kr.fixture.app\n',
  ]) invalid('GENIE_ANDROID_APPLICATION_ID', value, 'INVALID_APPLICATION_ID');
  assert.equal(resolveAndroidReleaseConfig({ ...valid, GENIE_ANDROID_APPLICATION_ID: 'kr.fixture_app' }).ok, true);
});

test('keeps version-code boundaries exact and rejects coercion, decimals, exponents, whitespace, and zero', () => {
  assert.equal(resolveAndroidReleaseConfig({ ...valid, GENIE_ANDROID_VERSION_CODE: '1' }).config.versionCode, 1);
  assert.equal(resolveAndroidReleaseConfig({ ...valid, GENIE_ANDROID_VERSION_CODE: '2100000000' }).config.versionCode, 2100000000);
  for (const value of ['0', '-1', '+1', '01', '1.0', '1e2', ' 1', '1 ', '1\n', '2100000001', '99999999999', 1]) {
    invalid('GENIE_ANDROID_VERSION_CODE', value, 'INVALID_VERSION_CODE');
  }
});

test('requires bounded printable version names and rejects test/preview labels and all whitespace', () => {
  assert.equal(resolveAndroidReleaseConfig({ ...valid, GENIE_ANDROID_VERSION_NAME: '1.2.0+7' }).ok, true);
  assert.equal(resolveAndroidReleaseConfig({ ...valid, GENIE_ANDROID_VERSION_NAME: '1'.repeat(40) }).ok, true);
  for (const value of ['1'.repeat(41), '1.0 Preview', '1.0-preview', '1.0-TEST', '1.0\n', '1\t2', '1.0\u0000', '버전1', 1]) {
    invalid('GENIE_ANDROID_VERSION_NAME', value, 'INVALID_VERSION_NAME');
  }
});

test('accepts a real-shaped custom backend host instead of requiring a Supabase-owned suffix', () => {
  assert.equal(resolveAndroidReleaseConfig({ ...valid, VITE_SUPABASE_URL: 'https://backend.synthfixture.com' }).ok, true);
});

test('rejects non-HTTPS, credentials, paths, query/hash, non443 ports, and parser-normalized tricks on both origins', () => {
  for (const field of ['VITE_SUPABASE_URL', 'VITE_PUBLIC_APP_URL']) {
    for (const value of [
      'http://genie.synthfixture.com', 'https://user:secret@genie.synthfixture.com', 'https://genie.synthfixture.com/path',
      'https://genie.synthfixture.com/.', 'https://genie.synthfixture.com/%2e', 'https://genie.synthfixture.com?token=secret',
      'https://genie.synthfixture.com?', 'https://genie.synthfixture.com#', 'https://genie.synthfixture.com:8443',
      ' https://genie.synthfixture.com', 'https://genie.\nsynthfixture.com', 'https://genie.synthfixture.com\\',
      'https://genie.synthfixture.com.', 'https://bad_host.synthfixture.com',
    ]) invalid(field, value, 'INVALID_HTTPS_ORIGIN');
  }
});

test('rejects IP literals/aliases, local/internal hosts, and reserved example/test domains', () => {
  for (const host of [
    '127.0.0.1', '10.1.2.3', '8.8.8.8', '[::1]', '[2606:4700:4700::1111]', '2130706433', '127.1', '0x7f000001',
    'localhost', 'localhost.localdomain', 'genie.local', 'genie.internal', 'genie.home.arpa', 'genie.lan',
    'genie.invalid', 'genie.test', 'genie.example', 'example.com', 'genie.example.org', 'api.example.net', 'singlehost',
  ]) invalid('VITE_PUBLIC_APP_URL', `https://${host}`, 'INVALID_HTTPS_ORIGIN');
});

test('accepts plausible publishable keys but rejects placeholders, short values, and private keys', () => {
  for (const value of [
    'sb_publishable_xxx', 'sb_publishable_' + 'x'.repeat(30), 'sb_publishable_test_not_a_real_public_key_1234',
    'sb_publishable_placeholder_12345678901234567890', 'sb_publishable_short',
    'sb_secret_do_not_expose_private_credential', 'sk_live_do_not_expose_private_credential',
    'eyJhbGciOiJIUzI1NiJ9.invalid.signature', valid.VITE_SUPABASE_PUBLISHABLE_KEY + '\n',
  ]) invalid('VITE_SUPABASE_PUBLISHABLE_KEY', value, 'INVALID_PUBLISHABLE_KEY');
});

test('rejects legacy JWTs including anon, service_role, and unsigned tokens', () => {
  for (const value of [jwt('anon'), jwt('service_role'), jwt('authenticated'), jwt(undefined), jwt('anon', { alg: 'none' }), 'x.y.z']) {
    invalid('VITE_SUPABASE_PUBLISHABLE_KEY', value, 'INVALID_PUBLISHABLE_KEY');
  }
});

test('rejects every unexpected VITE variable, even blank or apparently harmless ones', () => {
  for (const field of ['VITE_OPENAI_API_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_RELEASE_LABEL', 'VITE_MODE']) {
    const result = resolveAndroidReleaseConfig({ ...valid, [field]: '' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.field === 'VITE_*' && error.code === 'UNEXPECTED_PUBLIC_VARIABLE'));
  }
  assert.equal(resolveAndroidReleaseConfig({ ...valid, OPENAI_API_KEY: 'sk_private_nonpublic_environment', NODE_ENV: 'production' }).ok, true);
});

test('private credential markers in any public variable fail with diagnostics that never echo supplied values', () => {
  const privateValue = 'sb_secret_UNIQUE_PRIVATE_SENTINEL_7391';
  const result = resolveAndroidReleaseConfig({
    ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: privateValue,
    VITE_UNIQUE_PRIVATE_NAME_7391: 'sk_live_SECOND_PRIVATE_SENTINEL', VITE_NOTE: 'service_role',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'PUBLIC_SECRET'));
  const diagnostic = JSON.stringify(result) + describeAndroidReleaseConfigErrors(result.errors).join('\n');
  for (const sentinel of [privateValue, 'UNIQUE_PRIVATE', 'SECOND_PRIVATE', valid.VITE_SUPABASE_URL, valid.VITE_PUBLIC_APP_URL]) {
    assert.equal(diagnostic.includes(sentinel), false);
  }
});

test('the diagnostic formatter ignores untrusted messages, codes, and field names', () => {
  const output = describeAndroidReleaseConfigErrors([{ field: 'secret-value', code: 'unknown-secret', message: 'private-key' },
    { field: 'VITE_SUPABASE_URL', code: 'INVALID_HTTPS_ORIGIN', message: 'https://user:private-password@host.invalid' }]).join('\n');
  assert.equal(/secret-value|unknown-secret|private-key|private-password/.test(output), false);
  assert.match(output, /VITE_SUPABASE_URL: Use a public HTTPS origin/);
});
