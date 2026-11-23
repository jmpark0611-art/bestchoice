import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { inventory, sourceSnapshot, verifyAndroidRelease, writeReleaseManifest } from './android-release-manifest.mjs';

// These fixtures exercise local file proofs only. No command, SDK, or backend is invoked.
const env = Object.freeze({
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie',
  GENIE_ANDROID_VERSION_CODE: '12',
  GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
  VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
});
const resolved = resolveAndroidReleaseConfig(env);
assert.equal(resolved.ok, true);
const config = resolved.config;

function put(root, relative, content) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
  return filename;
}

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-release-proof-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const webRoot = path.join(base, 'source');
  const workspace = path.join(base, 'prepared');
  const androidDir = path.join(workspace, 'android');
  const assetDir = path.join(androidDir, 'app/src/main/assets');
  const manifestPath = path.join(androidDir, 'genie-release-manifest.json');
  for (const [name, content] of Object.entries({
    'package.json': JSON.stringify({ name: 'synthetic-release-proof', private: true, type: 'module' }),
    'package-lock.json': JSON.stringify({ name: 'synthetic-release-proof', lockfileVersion: 3, packages: {} }),
    'vite.config.ts': 'export default {};\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src'] }),
    'capacitor.config.ts': "export default {appId:'dev.local.genie.preview',appName:'결정해지니 Preview',webDir:'dist'};\n",
    'index.html': '<!doctype html><div id="root"></div><script type="module" src="/src/main.ts"></script>\n',
    'src/main.ts': 'export const fixture = "source-before-build";\n',
    'scripts/verify-android-release.mjs': 'export const fixtureVerifier = "before-build";\n',
    'public/robots.txt': 'User-agent: *\nDisallow:\n',
    'android/build.gradle': '// synthetic native input; never compiled\n',
    'android/app/build.gradle': '// synthetic app input; never compiled\n',
    'android/app/src/main/AndroidManifest.xml': '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:allowBackup="false" /></manifest>\n',
    'android/app/src/main/res/values/strings.xml': '<resources><string name="app_name">결정해지니 Preview</string></resources>\n',
  })) put(webRoot, name, content);
  mkdirSync(workspace, { recursive: true });
  cpSync(path.join(webRoot, 'android'), androidDir, { recursive: true });
  cpSync(path.join(webRoot, 'scripts'), path.join(workspace, 'scripts'), { recursive: true });
  put(assetDir, 'capacitor.config.json', JSON.stringify({ appId: config.applicationId, appName: config.appName, webDir: 'web' }));
  put(assetDir, 'capacitor.plugins.json', '[]\n');
  put(assetDir, 'public/index.html', '<!doctype html><div id="root"></div><script type="module" src="./assets/app.js"></script>\n');
  put(assetDir, 'public/assets/app.js', `globalThis.fixturePublicConfig = ${JSON.stringify({
    supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey, publicAppUrl: config.publicAppUrl,
  })};\n`);
  return { base, webRoot, workspace, androidDir, assetDir, manifestPath, config, initialSources: sourceSnapshot(webRoot) };
}

const seal = f => writeReleaseManifest(f);
const verify = (f, values = env) => verifyAndroidRelease({ androidDir: f.androidDir, env: values });
function rejected(result, code) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === code), `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  assert.equal('manifestPath' in result, false);
}

test('a fresh source-linked proof verifies and records integrity without claiming a native build or storing the key', t => {
  const f = fixture(t);
  assert.equal(seal(f), f.manifestPath);
  assert.deepEqual(verify(f), { ok: true, manifestPath: f.manifestPath });
  const raw = readFileSync(f.manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.status, 'prepared-not-native-validated');
  assert.equal(raw.includes(config.publishableKey), false);
  assert.match(manifest.publicConfig.publishableKeySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.sourceFiles, f.initialSources);
  assert.ok(manifest.sourceFiles.some(entry => entry.path === 'index.html'));
  assert.ok(manifest.nativeFiles.some(entry => entry.path === 'app/src/main/AndroidManifest.xml'));
  assert.equal(lstatSync(f.manifestPath).mode & 0o777, 0o600);
});

test('proofs cannot be reused with a different app, version, backend, public key, or public web origin', t => {
  const f = fixture(t);
  seal(f);
  const changes = {
    GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.other',
    GENIE_ANDROID_VERSION_CODE: '13',
    GENIE_ANDROID_VERSION_NAME: '1.2.1',
    VITE_SUPABASE_URL: 'https://otherfixture.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_9Ju4Wd8Mr0Vk3Xp2Ct7Lq5Na1Be6Zy',
    VITE_PUBLIC_APP_URL: 'https://other.synthfixture.com',
  };
  for (const [field, value] of Object.entries(changes)) rejected(verify(f, { ...env, [field]: value }), 'RELEASE_CONFIG_MISMATCH');
  rejected(verify(f, {}), 'MISSING');
});

test('changing source code or the Vite HTML entry invalidates an otherwise untouched prepared copy', t => {
  const f = fixture(t);
  seal(f);
  for (const relative of ['src/main.ts', 'index.html']) {
    const filename = path.join(f.webRoot, relative);
    const original = readFileSync(filename);
    writeFileSync(filename, Buffer.concat([original, Buffer.from('\n<!-- changed after preparation -->\n')]));
    rejected(verify(f), 'RELEASE_SOURCE_CHANGED');
    writeFileSync(filename, original);
    assert.equal(verify(f).ok, true);
  }
});

test('missing, added, and changed web assets invalidate the recorded bundle', t => {
  const mutations = [
    f => rmSync(path.join(f.assetDir, 'public/assets/app.js')),
    f => put(f.assetDir, 'public/assets/unexpected.js', 'globalThis.unexpected = true;\n'),
    f => put(f.assetDir, 'public/index.html', '<!doctype html><p>changed</p>\n'),
  ];
  for (const mutate of mutations) {
    const f = fixture(t);
    seal(f);
    mutate(f);
    rejected(verify(f), 'RELEASE_FILES_CHANGED');
  }
});

test('native XML and the staged verifier cannot change after a proof is written', t => {
  for (const [relative, contents] of [
    ['android/app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>\n'],
    ['scripts/verify-android-release.mjs', 'export const bypass = true;\n'],
  ]) {
    const f = fixture(t);
    seal(f);
    put(f.workspace, relative, contents);
    rejected(verify(f), 'RELEASE_FILES_CHANGED');
  }
});

test('a freshly recorded runtime config still must have the release identity and no remote-server override', t => {
  for (const runtime of [
    { appId: 'dev.local.genie.preview', appName: config.appName, webDir: 'web' },
    { appId: config.applicationId, appName: config.appName, webDir: 'web', server: { url: 'https://other.synthfixture.com' } },
  ]) {
    const f = fixture(t);
    put(f.assetDir, 'capacitor.config.json', JSON.stringify(runtime));
    seal(f);
    rejected(verify(f), 'RELEASE_RUNTIME_CONFIG');
  }
});

test('freshly recorded assets need the HTML entry, plugin manifest, and all three embedded public settings', t => {
  for (const relative of ['public/index.html', 'capacitor.plugins.json']) {
    const f = fixture(t);
    rmSync(path.join(f.assetDir, relative));
    seal(f);
    rejected(verify(f), 'RELEASE_ASSETS_MISSING');
  }
  for (const omitted of [config.supabaseUrl, config.publishableKey, config.publicAppUrl]) {
    const f = fixture(t);
    const filename = path.join(f.assetDir, 'public/assets/app.js');
    writeFileSync(filename, readFileSync(filename, 'utf8').replace(omitted, 'absent-setting'));
    seal(f);
    rejected(verify(f), 'RELEASE_CONFIG_NOT_EMBEDDED');
  }
});

test('preview endpoints, preview keys, and obvious private credentials cannot be blessed by a fresh inventory', t => {
  for (const marker of [
    'https://genie-test.invalid', 'test-publishable',
    'sb_secret_SYNTHETIC_PRIVATE_VALUE_1234567890', 'sk-proj-SYNTHETIC_PRIVATE_VALUE_1234567890',
    'sk_live_SYNTHETIC_PRIVATE_VALUE_1234567890', 'sk_test_SYNTHETIC_PRIVATE_VALUE_1234567890',
    'sk-SYNTHETIC_PRIVATE_VALUE_1234567890',
  ]) {
    const f = fixture(t);
    put(f.assetDir, 'public/assets/unsafe.js', `globalThis.syntheticUnsafeFixture = ${JSON.stringify(marker)};\n`);
    seal(f);
    const result = verify(f);
    rejected(result, 'RELEASE_UNSAFE_ASSET');
    assert.equal(JSON.stringify(result).includes(marker), false);
  }
});

test('inventories reject symbolic links instead of following source or asset files outside the fixture', t => {
  const f = fixture(t);
  const outside = put(f.base, 'outside.js', 'export const outside = true;\n');
  symlinkSync(outside, path.join(f.webRoot, 'src/external.ts'));
  assert.throws(() => sourceSnapshot(f.webRoot), /SYMLINK_NOT_ALLOWED/);
  rmSync(path.join(f.webRoot, 'src/external.ts'));
  seal(f);
  const asset = path.join(f.assetDir, 'public/assets/app.js');
  const copiedAsset = put(f.base, 'outside-asset.js', readFileSync(asset));
  rmSync(asset);
  symlinkSync(copiedAsset, asset);
  rejected(verify(f), 'RELEASE_PROOF_UNREADABLE');
  assert.throws(() => inventory(f.assetDir), /SYMLINK_NOT_ALLOWED/);
});

test('an external manifest symlink is rejected even if its bytes and recorded hashes match', t => {
  const f = fixture(t);
  seal(f);
  const outside = put(f.base, 'outside-manifest.json', readFileSync(f.manifestPath));
  rmSync(f.manifestPath);
  symlinkSync(outside, f.manifestPath);
  rejected(verify(f), 'RELEASE_PROOF_UNREADABLE');
});

test('failed source snapshots or a source change during preparation cannot create a successful proof', t => {
  const f = fixture(t);
  put(f.webRoot, 'src/main.ts', 'export const changedDuringBuild = true;\n');
  assert.throws(() => seal(f), /SOURCE_CHANGED_DURING_BUILD/);
  assert.equal(existsSync(f.manifestPath), false);
  rejected(verify(f), 'RELEASE_PROOF_UNREADABLE');
  rmSync(path.join(f.webRoot, 'package-lock.json'));
  assert.throws(() => sourceSnapshot(f.webRoot));
  assert.throws(() => seal(f));
  assert.equal(existsSync(f.manifestPath), false);
});

test('missing or malformed manifests fail closed, and preparing twice cannot overwrite an existing proof', t => {
  const f = fixture(t);
  rejected(verify(f), 'RELEASE_PROOF_UNREADABLE');
  seal(f);
  const original = readFileSync(f.manifestPath, 'utf8');
  assert.throws(() => seal(f), error => error.code === 'EEXIST');
  assert.equal(readFileSync(f.manifestPath, 'utf8'), original);
  writeFileSync(f.manifestPath, '{"incomplete":');
  rejected(verify(f), 'RELEASE_PROOF_UNREADABLE');
});
