import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runUnsignedExport, unsignedBuildFailureDiagnostic } from './android-unsigned-export.mjs';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { digest, sourceSnapshot, writeReleaseManifest, verifyAndroidRelease } from './android-release-manifest.mjs';

// All native commands are injected. Inert files are not executed, and the fake
// AAB/identity receipt is not evidence of compilation, protobuf parsing or signing.
const nativeTest = process.platform === 'linux' ? test : test.skip;
const sourceWebRoot = fileURLToPath(new URL('..', import.meta.url));
const publicEnv = Object.freeze({
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie', GENIE_ANDROID_VERSION_CODE: '12', GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co', VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
});
function put(root, relative, contents, executable = false) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
  if (executable) chmodSync(filename, 0o755);
  return filename;
}
function fixture(t, options = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-unsigned-orchestration-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const webRoot = path.join(base, 'web');
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'capacitor.config.ts']) put(webRoot, name, '{}\n');
  const sourceFile = put(webRoot, 'src/inert.ts', '// Synthetic source only.\n');
  put(webRoot, 'scripts/inert.mjs', '// Never executed.\n');
  put(webRoot, 'android/gradlew', 'INERT_MUST_NOT_EXECUTE\n');
  put(webRoot, 'android/app/src/main/AndroidManifest.xml', '<manifest/>\n');
  for (const name of ['gradle-wrapper.jar', 'gradle-wrapper.properties']) {
    const target = path.join(webRoot, 'android/gradle/wrapper', name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(sourceWebRoot, 'android/gradle/wrapper', name), target);
  }
  const nativeBridge = put(webRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'SYNTHETIC_BRIDGE\n');
  const javaHome = path.join(base, 'fixture-jdk');
  for (const name of ['java', 'javac', 'jarsigner']) put(javaHome, `bin/${name}`, 'INERT_MUST_NOT_EXECUTE\n', true);
  const toolDir = path.join(base, 'fixture-tools');
  put(toolDir, 'python3', 'INERT_MUST_NOT_EXECUTE\n', true);
  const sdk = path.join(base, 'fixture-sdk');
  put(sdk, 'platforms/android-36/android.jar', 'INERT_NOT_A_PLATFORM\n');
  put(sdk, 'build-tools/35.0.0/aapt2', 'INERT_MUST_NOT_EXECUTE\n', true);
  const env = Object.freeze({ ...publicEnv, JAVA_HOME: javaHome, PATH: toolDir, ANDROID_HOME: sdk,
    HOME: path.join(base, 'isolated-home'), GRADLE_USER_HOME: path.join(base, 'isolated-cache'),
    GITHUB_REPOSITORY: 'synthetic/fixture', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/isolated-unsigned',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', OPENAI_API_KEY: 'PRIVATE_UNRELATED_SENTINEL_9281' });
  const exportDir = path.join(base, 'selected-export');
  const state = { calls: [], preparations: [], verifications: [], logs: [], workspace: null };
  const prepare = async input => {
    state.preparations.push(input);
    if (options.prepareFailure) return { ok: false };
    const config = resolveAndroidReleaseConfig(input.env).config;
    const initialSources = sourceSnapshot(webRoot);
    state.workspace = mkdtempSync(path.join(webRoot, '.genie-release/run-synthetic-'));
    cpSync(path.join(webRoot, 'android'), path.join(state.workspace, 'android'), { recursive: true });
    put(state.workspace, 'scripts/verify-android-release.mjs', '// Inert verifier inventory.\n');
    const assets = 'android/app/src/main/assets';
    put(state.workspace, `${assets}/public/index.html`, '<p>Synthetic web fixture</p>\n');
    put(state.workspace, `${assets}/public/assets/app.js`, JSON.stringify([config.supabaseUrl, config.publishableKey, config.publicAppUrl]));
    put(state.workspace, `${assets}/capacitor.config.json`, JSON.stringify({ appId: config.applicationId, appName: config.appName, webDir: 'web' }));
    put(state.workspace, `${assets}/capacitor.plugins.json`, '[]');
    writeReleaseManifest({ webRoot, workspace: state.workspace, config, initialSources });
    return { ok: true, workspace: state.workspace };
  };
  const run = async job => {
    state.calls.push(job);
    assert.equal(job.capture, true);
    if (options.throwStage === job.stage) throw new Error(`PRIVATE_CHILD_FAILURE ${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY}`);
    if (job.stage === 'java-version') return { status: 0, stdout: options.javaVersion ?? 'javac 21.0.9\n' };
    if (job.stage === 'native-build') {
      assert.ok(job.args.includes('-PgenieUnsignedExport=true'));
      assert.ok(job.args.includes('verifyGenieBundleIdentity'));
      const artifact = put(job.cwd, 'app/build/outputs/bundle/release/app-release.aab', 'SYNTHETIC_NOT_A_VALID_ANDROID_BUNDLE\n');
      if (!options.missingIdentity) put(job.cwd, 'app/build/outputs/bundle/release/genie-bundle-identity.json', JSON.stringify({
        schemaVersion: 1, status: 'verified-final-aab-manifest-identity', file: 'app/build/outputs/bundle/release/app-release.aab',
        manifestEntry: 'base/manifest/AndroidManifest.xml', applicationId: options.wrongIdentity ? 'kr.synthfixture.other' : publicEnv.GENIE_ANDROID_APPLICATION_ID,
        versionCode: 12, versionName: '1.2.0', sha256: digest(readFileSync(artifact)), manifestSha256: digest('INERT_NOT_PROTOBUF'),
        releaseManifestSha256: digest(readFileSync(path.join(job.cwd, 'genie-release-manifest.json'))),
      }));
      if (options.sourceDrift) writeFileSync(sourceFile, '// Changed while compiling.\n');
      if (options.bridgeDrift) writeFileSync(nativeBridge, 'CHANGED_BRIDGE\n');
      return { status: options.nativeFailure ? 1 : 0,
        stdout: options.nativeStdout ?? `CHILD_OUTPUT_MUST_NOT_BE_LOGGED ${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        stderr: options.nativeStderr ?? '' };
    }
    if (job.stage === 'verify-unsigned') return { status: options.unsignedStatus ?? 0, stdout: options.unsignedText ?? 'jar is unsigned.\n' };
    if (job.stage === 'verify-package') {
      assert.equal(JSON.parse(job.args[5]).requireUnsigned, true);
      if (options.bundleDrift) writeFileSync(path.join(job.cwd, 'app/build/outputs/bundle/release/app-release.aab'), 'CHANGED_AFTER_IDENTITY_CHECK');
      return { status: options.assetFailure ? 1 : 0, stdout: options.assetMarker ?? 'AAB_ASSETS_MATCH\n' };
    }
    assert.fail(`Unexpected fixture stage: ${job.stage}`);
  };
  const verify = input => { state.verifications.push(input); return verifyAndroidRelease(input); };
  return { base, webRoot, env, exportDir, sourceFile, nativeBridge, sdk, state, run, prepare, verify };
}
const invoke = (f, changes = {}) => runUnsignedExport({ webRoot: f.webRoot, env: f.env, exportDir: f.exportDir,
  allowDownloads: true, run: f.run, prepare: f.prepare, verify: f.verify, log: value => f.state.logs.push(value), ...changes });
function rejected(f, result, code) {
  assert.deepEqual(result, { ok: false, code });
  assert.equal(existsSync(f.exportDir), false);
  if (f.state.workspace) assert.equal(existsSync(f.state.workspace), false);
  assert.equal(JSON.stringify({ result, logs: f.state.logs }).includes(publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY), false);
}

nativeTest('explicit download opt-in and absence of every signing input are required before work starts', async t => {
  for (const allowDownloads of [false, 'true']) {
    const f = fixture(t);
    rejected(f, await invoke(f, { allowDownloads }), 'EXPLICIT_DEPENDENCY_DOWNLOAD_OPT_IN_REQUIRED');
    assert.equal(f.state.calls.length, 0);
  }
  for (const field of ['GENIE_ANDROID_KEYSTORE_PATH', 'GENIE_ANDROID_KEYSTORE_PASSWORD', 'GENIE_ANDROID_KEY_ALIAS', 'GENIE_ANDROID_KEY_PASSWORD']) {
    const f = fixture(t);
    rejected(f, await invoke(f, { env: { ...f.env, [field]: '' } }), 'REMOVE_SIGNING_INPUTS_FROM_UNSIGNED_EXPORT');
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.preparations.length, 0);
  }
});

nativeTest('synthetic success retains exactly four files, binds their hashes, and removes the temporary workspace', async t => {
  const f = fixture(t);
  const result = await invoke(f);
  assert.equal(result.ok, true);
  assert.equal(existsSync(f.state.workspace), false);
  const files = readdirSync(f.exportDir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => path.relative(f.exportDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
  assert.deepEqual(files, ['android/app/build/outputs/bundle/release/app-release.aab',
    'android/app/build/outputs/bundle/release/genie-bundle-identity.json', 'android/genie-release-manifest.json', 'unsigned-export.json'].sort());
  assert.equal(result.receipt.status, 'unsigned-export-awaiting-local-signing');
  assert.equal(result.receipt.unsignedAabSha256, digest(readFileSync(result.artifactPath)));
  assert.equal(result.receipt.releaseManifestSha256, digest(readFileSync(path.join(f.exportDir, 'android/genie-release-manifest.json'))));
  for (const field of ['artifactUploaded', 'productionSigningKeyUsed', 'backendContacted', 'storeSubmission']) assert.equal(result.receipt[field], false);
  assert.equal(result.receipt.sourceSnapshotVerified, true);
  assert.equal(f.state.verifications.length, 2);
  for (const call of f.state.calls) {
    assert.equal(Object.hasOwn(call.env, 'OPENAI_API_KEY'), false);
    assert.equal(Object.keys(call.env).some(key => /KEYSTORE|KEY_ALIAS|KEY_PASSWORD/.test(key)), false);
    assert.equal(call.args.includes('-keystore'), false);
  }
  assert.equal(JSON.stringify({ receipt: result.receipt, logs: f.state.logs }).includes(publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY), false);
});

nativeTest('an existing selected output remains untouched and missing public/provenance input cannot start a build', async t => {
  const f = fixture(t);
  put(f.exportDir, 'existing.txt', 'KEEP_EXISTING_EXPORT');
  assert.deepEqual(await invoke(f), { ok: false, code: 'FRESH_EXPORT_DIRECTORY_REQUIRED' });
  assert.equal(readFileSync(path.join(f.exportDir, 'existing.txt'), 'utf8'), 'KEEP_EXISTING_EXPORT');
  assert.equal(f.state.calls.length, 0);
  for (const change of [{ VITE_SUPABASE_PUBLISHABLE_KEY: undefined }, { GITHUB_SHA: 'not-a-commit' }]) {
    const g = fixture(t);
    rejected(g, await invoke(g, { env: { ...g.env, ...change } }),
      Object.hasOwn(change, 'GITHUB_SHA') ? 'CI_SOURCE_CONTEXT_REQUIRED' : 'PUBLIC_RELEASE_CONFIGURATION_REQUIRED');
    assert.equal(g.state.calls.length, 0);
  }
});

nativeTest('native failure and thrown child output leave no export or raw child diagnostics', async t => {
  for (const [options, code] of [[{ nativeFailure: true }, 'ANDROID_UNSIGNED_COMPILATION_FAILED'],
    [{ throwStage: 'native-build' }, 'UNSIGNED_EXPORT_INCOMPLETE']]) {
    const f = fixture(t, options);
    rejected(f, await invoke(f), code);
  }
});

test('failure diagnostics retain useful Gradle task and dependency facts without raw key, URL or error text', () => {
  const diagnostic = unsignedBuildFailureDiagnostic({ status: 1,
    stdout: '\x1b[31m> Task :app:checkReleaseAarMetadata FAILED\x1b[0m\n',
    stderr: `Build file '/private/work/genie-release.gradle' line: 117\n` +
      `Execution failed for task ':app:checkReleaseAarMetadata'.\n` +
      `Could not resolve com.android.tools.build:gradle:8.13.0.\n` +
      `Could not GET 'https://dl.google.com/dl/android/maven2/path?key=${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY}'.\n` +
      'Received status code 429 from server: PRIVATE_ERROR_TEXT\n' +
      'OPENAI_API_KEY=sk-proj-PRIVATE_NEVER_LOG\n' });
  assert.deepEqual(diagnostic.failedTasks, [':app:checkReleaseAarMetadata']);
  assert.equal(diagnostic.lastTask, ':app:checkReleaseAarMetadata');
  assert.deepEqual(diagnostic.reasonCodes, ['DEPENDENCY_RESOLUTION_FAILED']);
  assert.deepEqual(diagnostic.dependencyCoordinates, ['com.android.tools.build:gradle:8.13.0']);
  assert.deepEqual(diagnostic.repositoryHosts, ['dl.google.com']);
  assert.deepEqual(diagnostic.httpStatuses, [429]);
  assert.deepEqual(diagnostic.locations, [{ file: 'genie-release.gradle', line: 117 }]);
  for (const forbidden of [publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY, 'PRIVATE_', 'https://', '/private/', 'OPENAI_API_KEY']) {
    assert.equal(JSON.stringify(diagnostic).includes(forbidden), false);
  }
  assert.equal(diagnostic.rawOutputIncluded, false);
});

test('failure diagnostics bound scanned/output data and reject secret-shaped or arbitrary metadata', () => {
  const diagnostic = unsignedBuildFailureDiagnostic({ status: 1, signal: 'SIGKILL', errorCode: 'ENOBUFS',
    stdout: 'discarded unknown output\n'.repeat(10_000) +
      `> Task :app:${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY} FAILED\n` +
      'com.android:sb_secret_UNRELATED_TOKEN:1.0\n' +
      'com.android.' + 'a'.repeat(500) + ':artifact:1.0\n' +
      Array.from({ length: 40 }, (_, i) => `> Task :app:compileFixture${i} FAILED\nandroidx.core:core:1.${i}.0\n`).join(''),
    stderr: `Gradle build daemon disappeared unexpectedly.\n${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY}` });
  assert.equal(diagnostic.scanTruncated, true);
  assert.equal(diagnostic.signal, 'SIGKILL');
  assert.equal(diagnostic.spawnErrorCode, 'ENOBUFS');
  assert.deepEqual(diagnostic.reasonCodes, ['GRADLE_DAEMON_DISAPPEARED']);
  assert.equal(diagnostic.failedTasks.length, 4);
  assert.equal(diagnostic.dependencyCoordinates.length, 6);
  assert.equal(diagnostic.lastTask, ':app:compileFixture39');
  assert.ok(JSON.stringify(diagnostic).length < 4096);
  assert.equal(/sb_publishable_|sb_secret_|UNRELATED_TOKEN|discarded unknown/.test(JSON.stringify(diagnostic)), false);
  const unknown = unsignedBuildFailureDiagnostic({ status: 'PRIVATE', signal: 'PRIVATE', errorCode: 'PRIVATE', stderr: 'PRIVATE exception' });
  assert.equal(unknown.exitCode, null); assert.equal(unknown.signal, null); assert.equal(unknown.spawnErrorCode, null);
  assert.deepEqual(unknown.reasonCodes, ['UNCLASSIFIED_NATIVE_FAILURE']);
  assert.equal(JSON.stringify(unknown).includes('PRIVATE'), false);
});

nativeTest('native failure emits only the bounded diagnostic and still cleans every candidate output', async t => {
  const f = fixture(t, { nativeFailure: true, nativeStdout: '> Task :app:bundleRelease FAILED\n',
    nativeStderr: `java.net.SocketTimeoutException: Read timed out ${publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY}` });
  rejected(f, await invoke(f), 'ANDROID_UNSIGNED_COMPILATION_FAILED');
  const messages = f.state.logs.filter(value => value.startsWith('GENIE_UNSIGNED_GRADLE_FAILURE '));
  assert.equal(messages.length, 1);
  const diagnostic = JSON.parse(messages[0].slice('GENIE_UNSIGNED_GRADLE_FAILURE '.length));
  assert.deepEqual(diagnostic.reasonCodes, ['NETWORK_TIMEOUT']);
  assert.deepEqual(diagnostic.failedTasks, [':app:bundleRelease']);
  assert.equal(diagnostic.rawOutputIncluded, false);
  assert.equal(f.state.calls.some(job => job.stage === 'verify-unsigned'), false);
});

nativeTest('a signed or ambiguous jarsigner result is never exported as unsigned', async t => {
  for (const options of [{ unsignedText: 'jar verified.\n' }, { unsignedText: 'jar is unsigned.\njar verified.\n' },
    { unsignedText: '' }, { unsignedStatus: 1 }]) {
    const f = fixture(t, options);
    rejected(f, await invoke(f), 'AAB_UNSIGNED_STATE_UNCONFIRMED');
    assert.equal(f.state.calls.some(job => job.stage === 'verify-package'), false);
  }
});

nativeTest('missing or mismatched binary identity evidence blocks export after native success', async t => {
  for (const options of [{ missingIdentity: true }, { wrongIdentity: true }]) {
    const f = fixture(t, options);
    rejected(f, await invoke(f), 'AAB_FINAL_MANIFEST_IDENTITY_UNCONFIRMED');
  }
});

nativeTest('packaged-asset failure or absence of the success marker prevents export', async t => {
  for (const options of [{ assetFailure: true }, { assetMarker: 'No comparison succeeded.\n' }]) {
    const f = fixture(t, options);
    rejected(f, await invoke(f), 'AAB_PACKAGED_ASSETS_OR_UNSIGNED_METADATA_MISMATCH');
  }
});

nativeTest('source, library bridge and post-identity AAB drift each prevent export', async t => {
  for (const [options, code] of [[{ sourceDrift: true }, 'SOURCE_OR_ASSETS_CHANGED_DURING_NATIVE_BUILD'],
    [{ bridgeDrift: true }, 'CAPACITOR_NATIVE_BRIDGE_CHANGED_DURING_BUILD'],
    [{ bundleDrift: true }, 'AAB_OR_IDENTITY_CHANGED_DURING_VERIFICATION']]) {
    const f = fixture(t, options);
    rejected(f, await invoke(f), code);
  }
});

nativeTest('missing native prerequisites and failed preparation cannot produce a completion record', async t => {
  const missing = fixture(t);
  rmSync(path.join(missing.sdk, 'platforms/android-36/android.jar'));
  rejected(missing, await invoke(missing), 'EXISTING_ANDROID_36_AND_BUILD_TOOLS_35_REQUIRED');
  const older = fixture(t, { javaVersion: 'javac 17.0.13\n' });
  rejected(older, await invoke(older), 'JAVA_21_COMPILER_REQUIRED');
  const failedPrepare = fixture(t, { prepareFailure: true });
  rejected(failedPrepare, await invoke(failedPrepare), 'FRESH_ANDROID_PREPARATION_FAILED');
});
