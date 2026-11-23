import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUNDLETOOL_PIN, candidateArchiveProgram, candidateToolEnvironment, prepareAndroidCandidateApk,
  validateCandidateReceipt, verifyPinnedBundletool } from './android-candidate-device-prep.mjs';
import { findExecutable } from './android-release-environment.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const expected = 'a'.repeat(64);
const receipt = () => ({ schemaVersion: 1, status: 'signed-awaiting-device-and-store-review',
  sha256: expected, sourceCommit: 'b'.repeat(40), signerCertificateSha256: 'c'.repeat(64),
  signatureVerified: true, payloadUnchanged: true, binaryManifestIdentityPreserved: true,
  applicationId: 'test.genie.localqa', versionCode: 1, versionName: '1.0.0' });
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'genie-candidate-prep-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const python = findExecutable('python3', process.env);
  assert.ok(python, 'An existing Python is used only for tiny synthetic ZIPs; nothing is installed.');
  const zip = (filename, entries) => {
    const result = spawnSync(python, ['-I', '-c',
      'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n,v in json.loads(sys.argv[2]):z.writestr(n,v)\n',
      filename, JSON.stringify(entries)], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
  };
  const archive = (...args) => spawnSync(python, ['-I', '-c', candidateArchiveProgram, ...args],
    { encoding: 'utf8', timeout: 5000 });
  return { root, zip, archive };
}

test('receipt binds the independent AAB digest and returns only narrow public identity fields', () => {
  const value = receipt();
  assert.deepEqual(validateCandidateReceipt({ sha256: expected, originalLocalSigningReceipt: value,
    unrelatedPrivateText: 'DO_NOT_RETURN' }, expected), {
    sha256: expected, signerCertificateSha256: 'c'.repeat(64), sourceCommit: 'b'.repeat(40),
    applicationId: 'test.genie.localqa', versionCode: '1', versionName: '1.0.0' });
  for (const change of [{ sha256: 'd'.repeat(64) }, { signatureVerified: false }, { payloadUnchanged: false },
    { binaryManifestIdentityPreserved: false }, { applicationId: 'invalid/../package' }, { versionCode: 0 },
    { sourceCommit: 'unknown' }, { signerCertificateSha256: '' }]) {
    assert.throws(() => validateCandidateReceipt({ ...value, ...change }, expected));
  }
  assert.throws(() => validateCandidateReceipt({ sha256: 'd'.repeat(64), originalLocalSigningReceipt: value }, expected));
});

test('tool children receive no inherited key, backend, proxy or Java injection configuration', () => {
  const result = candidateToolEnvironment({ PATH: '/safe/tools', HOME: '/old/home', JAVA_HOME: '/old/jdk',
    JAVA_TOOL_OPTIONS: '-javaagent:secret', JDK_JAVA_OPTIONS: 'secret', _JAVA_OPTIONS: 'secret',
    HTTP_PROXY: 'https://secret.invalid', HTTPS_PROXY: 'https://secret.invalid', NODE_OPTIONS: 'secret',
    VITE_SUPABASE_URL: 'https://secret.invalid', GENIE_ANDROID_KEYSTORE_PASSWORD: 'secret',
    GENIE_ANDROID_KEYSTORE_PATH: '/private/key', GENIE_ANDROID_KEY_PASSWORD: 'secret', AWS_SECRET_ACCESS_KEY: 'secret' },
  '/owned/home', '/owned/tmp');
  assert.deepEqual(result, { HOME: '/owned/home', TMPDIR: '/owned/tmp', TMP: '/owned/tmp', TEMP: '/owned/tmp',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PATH: '/safe/tools' });
});

test('existing outputs, linked outputs, wrong AAB and absent pinned tool stop before any command', async t => {
  const { root } = fixture(t);
  const candidatePath = path.join(root, "candidate 'quoted' $(literal).aab");
  writeFileSync(candidatePath, 'SYNTHETIC_AAB_ONLY');
  const actualHash = hash(readFileSync(candidatePath));
  const verificationPath = path.join(root, 'verification.json');
  writeFileSync(verificationPath, JSON.stringify({ ...receipt(), sha256: actualHash }));
  const outputDir = path.join(root, 'output');
  let calls = 0;
  const options = { candidatePath, verificationPath, expectedSha256: actualHash, outputDir,
    bundletoolPath: path.join(root, 'missing.jar'), run: () => { calls++; throw new Error('UNEXPECTED_COMMAND'); } };
  mkdirSync(outputDir);
  writeFileSync(path.join(outputDir, 'existing.txt'), 'KEEP');
  assert.equal((await prepareAndroidCandidateApk(options)).code, 'FRESH_PRIVATE_OUTPUT_REQUIRED');
  assert.equal(readFileSync(path.join(outputDir, 'existing.txt'), 'utf8'), 'KEEP');
  symlinkSync(outputDir, path.join(root, 'linked-output'));
  assert.equal((await prepareAndroidCandidateApk({ ...options, outputDir: path.join(root, 'linked-output') })).code, 'FRESH_PRIVATE_OUTPUT_REQUIRED');
  options.outputDir = path.join(root, 'new-output');
  assert.equal((await prepareAndroidCandidateApk({ ...options, expectedSha256: expected })).code, 'CANDIDATE_HASH_MISMATCH');
  assert.equal((await prepareAndroidCandidateApk(options)).code, 'EXACT_OFFICIAL_BUNDLETOOL_REQUIRED');
  assert.equal(calls, 0);
  assert.equal(existsSync(options.outputDir), false);
  assert.equal(readdirSync(root).some(name => name.startsWith('.genie-candidate-qa-')), false);
  assert.equal(hash(readFileSync(candidatePath)), actualHash);
});

test('a same-size substituted JAR or a symlink never satisfies the official tool pin', t => {
  const { root } = fixture(t);
  const jar = path.join(root, 'tool.jar');
  writeFileSync(jar, 'NOT_THE_OFFICIAL_TOOL');
  truncateSync(jar, BUNDLETOOL_PIN.sizeBytes);
  assert.equal(verifyPinnedBundletool(jar), false);
  symlinkSync(jar, path.join(root, 'linked.jar'));
  assert.equal(verifyPinnedBundletool(path.join(root, 'linked.jar')), false);
  assert.equal(BUNDLETOOL_PIN.sha256, 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29');
});

test('APK extraction accepts only the fixed universal APK and rejects extras, duplicates and existing output', t => {
  const { root, zip, archive } = fixture(t);
  const apks = path.join(root, 'input.apks');
  const output = path.join(root, "output 'quoted' $(literal).apk");
  const valid = [['universal.apk', 'SYNTHETIC_APK'], ['toc.pb', 'SYNTHETIC_TOC']];
  for (const entries of [[...valid, ['extra.txt', 'EXTRA']], [...valid, ['universal.apk', 'DUPLICATE']],
    [...valid, ['../escape', 'ESCAPE']], valid.filter(([name]) => name !== 'toc.pb')]) {
    zip(apks, entries);
    assert.notEqual(archive('extract', apks, output).status, 0);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(path.join(root, '..', 'escape')), false);
  }
  zip(apks, valid);
  assert.equal(archive('extract', apks, output).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'SYNTHETIC_APK');
  assert.notEqual(archive('extract', apks, output).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'SYNTHETIC_APK');
});

test('candidate payload comparison detects a changed byte, extra dex, and omitted feature modules', t => {
  const { root, zip, archive } = fixture(t);
  const aab = path.join(root, 'candidate.aab');
  const apk = path.join(root, 'candidate.apk');
  const source = [['base/manifest/AndroidManifest.xml', 'SYNTHETIC_PROTOBUF'],
    ['base/assets/public/index.html', 'SAME_PUBLIC_CONFIG_AND_CONTENT'],
    ['base/dex/classes.dex', 'DEX_ONE'], ['base/dex/classes10.dex', 'DEX_TEN'],
    ['base/lib/arm64-v8a/libtest.so', 'NATIVE_BYTES']];
  const target = [['AndroidManifest.xml', 'SYNTHETIC_BINARY_XML'], ['resources.arsc', 'SYNTHETIC_RESOURCES'],
    ['assets/public/index.html', 'SAME_PUBLIC_CONFIG_AND_CONTENT'], ['classes.dex', 'DEX_ONE'],
    ['classes10.dex', 'DEX_TEN'], ['lib/arm64-v8a/libtest.so', 'NATIVE_BYTES']];
  zip(aab, source); zip(apk, target);
  const good = archive('compare', aab, apk);
  assert.equal(good.status, 0, good.stdout);
  assert.deepEqual(JSON.parse(good.stdout), { payloadMatch: true, assets: 1, dex: 2, nativeLibraries: 1, baselineProfiles: 0 });
  zip(apk, target.map(([n, v]) => [n, n === 'assets/public/index.html' ? v + 'CHANGED' : v]));
  assert.notEqual(archive('compare', aab, apk).status, 0);
  zip(apk, [...target, ['classes2.dex', 'EXTRA_DEX']]);
  assert.notEqual(archive('compare', aab, apk).status, 0);
  zip(apk, target); zip(aab, [...source, ['feature/manifest/AndroidManifest.xml', 'OMITTED_FEATURE']]);
  assert.notEqual(archive('compare', aab, apk).status, 0);
});

test('only exact original baseline profiles may be copied into APK assets/dexopt', t => {
  const { root, zip, archive } = fixture(t);
  const aab = path.join(root, 'profiles.aab');
  const apk = path.join(root, 'profiles.apk');
  const source = [['base/manifest/AndroidManifest.xml', 'PROTO'], ['base/assets/public/index.html', 'WEB'],
    ['base/dex/classes.dex', 'DEX'], ['BUNDLE-METADATA/com.android.tools.build.profiles/baseline.prof', 'PROFILE'],
    ['BUNDLE-METADATA/com.android.tools.build.profiles/baseline.profm', 'METADATA']];
  const target = [['AndroidManifest.xml', 'AXML'], ['resources.arsc', 'RES'], ['assets/public/index.html', 'WEB'],
    ['classes.dex', 'DEX'], ['assets/dexopt/baseline.prof', 'PROFILE'], ['assets/dexopt/baseline.profm', 'METADATA']];
  zip(aab, source); zip(apk, target);
  const good = archive('compare', aab, apk);
  assert.equal(good.status, 0, good.stdout);
  assert.equal(JSON.parse(good.stdout).baselineProfiles, 2);
  zip(apk, target.map(([name, value]) => [name, name === 'assets/dexopt/baseline.prof' ? 'TAMPERED' : value]));
  assert.notEqual(archive('compare', aab, apk).status, 0);
  zip(apk, [...target, ['assets/dexopt/extra.prof', 'EXTRA']]);
  assert.notEqual(archive('compare', aab, apk).status, 0);
});
