import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSmoke } from './android-native-smoke.mjs';
import { findExecutable } from './android-release-environment.mjs';

// Native command results are injected: no compilation, signing, or backend calls.
// The final regression runs only Python's ZIP guard against synthetic archives.
// No fixture executable is ever run.
const sourceWebRoot = fileURLToPath(new URL('..', import.meta.url));
const nativeTest = process.platform === 'linux' ? test : test.skip;

function put(root, relative, contents, executable = false) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
  if (executable) chmodSync(filename, 0o755);
  return filename;
}

function fixture(t, options = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-smoke-orchestration-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const webRoot = path.join(base, 'web');
  const javaHome = path.join(base, 'fixture-jdk');
  const toolDirectory = path.join(base, 'fixture-tools');
  const sdk = path.join(base, 'fixture-sdk');
  for (const tool of ['java', 'javac', 'jarsigner', 'keytool']) put(javaHome, `bin/${tool}`, 'INERT_MUST_NOT_EXECUTE\n', true);
  put(toolDirectory, 'python3', 'INERT_MUST_NOT_EXECUTE\n', true);
  put(sdk, 'platforms/android-36/android.jar', 'INERT_NOT_AN_ANDROID_PLATFORM\n');
  put(sdk, 'build-tools/35.0.0/aapt2', 'INERT_MUST_NOT_EXECUTE\n', true);
  const wrapperDirectory = path.join(webRoot, 'android/gradle/wrapper');
  mkdirSync(wrapperDirectory, { recursive: true });
  for (const filename of ['gradle-wrapper.jar', 'gradle-wrapper.properties']) {
    copyFileSync(path.join(sourceWebRoot, 'android/gradle/wrapper', filename), path.join(wrapperDirectory, filename));
  }
  const env = Object.freeze({
    JAVA_HOME: javaHome, PATH: toolDirectory, ANDROID_HOME: sdk,
    GRADLE_USER_HOME: path.join(base, 'isolated-gradle-cache'), HOME: path.join(base, 'isolated-home'),
    GITHUB_SHA: 'a'.repeat(40), OPENAI_API_KEY: 'UNRELATED_PRODUCTION_SENTINEL_9281',
  });
  const releaseRoot = path.join(webRoot, '.genie-release');
  const receiptPath = path.join(releaseRoot, 'native-smoke-result.json');
  const state = { calls: [], preparations: [], verifications: [], workspace: null, artifact: null, keyFile: null, keyDirectory: null, password: null };
  const prepare = async input => {
    state.preparations.push(input);
    if (options.prepareFailure) return { ok: false };
    state.workspace = mkdtempSync(path.join(releaseRoot, 'run-synthetic-'));
    put(state.workspace, 'android/gradlew', 'INERT_MUST_NOT_EXECUTE\n');
    put(state.workspace, 'android/app/src/main/assets/public/index.html', '<p>Synthetic orchestration fixture only</p>\n');
    state.artifact = path.join(state.workspace, 'android/app/build/outputs/bundle/release/app-release.aab');
    return { ok: true, workspace: state.workspace };
  };
  const run = async job => {
    state.calls.push(job);
    if (job.stage === 'java-version') return { status: 0, stdout: options.javaVersion ?? 'javac 21.0.9\n' };
    if (job.stage === 'temporary-key') {
      state.keyDirectory = job.cwd;
      state.keyFile = job.args[job.args.indexOf('-keystore') + 1];
      state.password = job.env.GENIE_NATIVE_SMOKE_PASSWORD;
      t.after(() => rmSync(job.cwd, { recursive: true, force: true }));
      // A partial key must be removed even when the injected command fails.
      put(job.cwd, path.basename(state.keyFile), 'INERT_NOT_A_SIGNING_KEY\n');
      if (options.throwStage === job.stage) throw new Error('INJECTED_PRIVATE_FAILURE_SENTINEL_9281');
      return { status: options.failStage === job.stage ? 3 : 0, stdout: '' };
    }
    if (job.stage === 'native-build') {
      // Partial and successful fake outputs are deliberately invalid as AABs.
      put(job.cwd, 'app/build/outputs/bundle/release/app-release.aab', 'INERT_NOT_AN_AAB_OR_SIGNATURE\n');
      if (options.throwStage === job.stage) throw new Error('INJECTED_PRIVATE_FAILURE_SENTINEL_9281');
      return { status: options.failStage === job.stage ? 7 : 0, stdout: '' };
    }
    if (job.stage === 'verify-signature') return { status: options.signatureStatus ?? 0, stdout: options.signatureText ?? 'jar verified.\n' };
    if (job.stage === 'verify-package') return { status: options.packageStatus ?? 0, stdout: options.packageText ?? 'AAB_ASSETS_MATCH\n' };
    assert.fail('Unexpected injected command stage.');
  };
  const verify = input => {
    state.verifications.push(input);
    return { ok: !options.proofFailure };
  };
  return { base, webRoot, env, releaseRoot, receiptPath, state, run, prepare, verify };
}

const invoke = (f, overrides = {}) => runNativeSmoke({ webRoot: f.webRoot, env: f.env,
  allowDownloads: true, run: f.run, prepare: f.prepare, verify: f.verify, ...overrides });
function assertCleanFailure(f, result, code) {
  assert.deepEqual(result, { ok: false, code });
  assert.equal(existsSync(f.receiptPath), false);
  if (f.state.workspace) assert.equal(existsSync(f.state.workspace), false);
  if (f.state.keyFile) assert.equal(existsSync(f.state.keyFile), false);
  if (f.state.keyDirectory) assert.equal(existsSync(f.state.keyDirectory), false);
  if (f.state.artifact) assert.equal(existsSync(f.state.artifact), false);
}

test('download authorization is required before checking tools, creating output, or invoking commands', async t => {
  const f = fixture(t);
  const result = await invoke(f, { allowDownloads: false });
  assertCleanFailure(f, result, 'EXPLICIT_DEPENDENCY_DOWNLOAD_OPT_IN_REQUIRED');
  assert.equal(existsSync(f.releaseRoot), false);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.preparations.length, 0);
});

nativeTest('inherited release/public variables are refused before any command or workspace is created', async t => {
  for (const field of ['GENIE_ANDROID_APPLICATION_ID', 'GENIE_ANDROID_KEYSTORE_PASSWORD', 'VITE_SUPABASE_URL', 'VITE_UNEXPECTED_CONFIG']) {
    const f = fixture(t);
    const result = await invoke(f, { env: { ...f.env, [field]: 'PRIVATE_PARENT_ENV_SENTINEL_9281' } });
    assertCleanFailure(f, result, 'REMOVE_REAL_RELEASE_INPUTS_FROM_SYNTHETIC_CHECK');
    assert.equal(JSON.stringify(result).includes('PRIVATE_PARENT_ENV_SENTINEL'), false);
    assert.equal(existsSync(f.releaseRoot), false);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.preparations.length, 0);
  }
});

nativeTest('an older compiler stops before preparing Android or generating a key', async t => {
  const f = fixture(t, { javaVersion: 'javac 17.0.13\n' });
  assertCleanFailure(f, await invoke(f), 'JAVA_21_COMPILER_REQUIRED');
  assert.deepEqual(f.state.calls.map(job => job.stage), ['java-version']);
  assert.equal(f.state.preparations.length, 0);
});

nativeTest('a previous receipt blocks a new run and is never reused as a success result', async t => {
  const f = fixture(t);
  const previous = '{"status":"OLD_RECEIPT_MUST_NOT_BE_REPORTED_AS_NEW"}\n';
  put(f.releaseRoot, 'native-smoke-result.json', previous);
  const result = await invoke(f);
  assert.deepEqual(result, { ok: false, code: 'PREVIOUS_NATIVE_CHECK_RECEIPT_EXISTS' });
  assert.equal(readFileSync(f.receiptPath, 'utf8'), previous);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.preparations.length, 0);
});

nativeTest('failed native commands clean partial keys/AABs and cannot fall back to an old source-tree AAB', async t => {
  for (const options of [
    { failStage: 'temporary-key', expected: 'TEMPORARY_SIGNING_KEY_FAILED' },
    { failStage: 'native-build', expected: 'ANDROID_NATIVE_COMPILATION_FAILED' },
    { throwStage: 'native-build', expected: 'NATIVE_CHECK_INCOMPLETE' },
  ]) {
    const f = fixture(t, options);
    const oldAab = put(f.webRoot, 'android/app/build/outputs/bundle/release/app-release.aab', 'OLD_SOURCE_AAB_MUST_STAY_UNTOUCHED\n');
    const result = await invoke(f);
    assertCleanFailure(f, result, options.expected);
    assert.equal(JSON.stringify(result).includes('PRIVATE_FAILURE_SENTINEL'), false);
    assert.equal(readFileSync(oldAab, 'utf8'), 'OLD_SOURCE_AAB_MUST_STAY_UNTOUCHED\n');
    assert.deepEqual(readdirSync(f.releaseRoot), []);
    assert.equal(f.state.verifications.length, 0);
  }
});

nativeTest('injected success emits only an explicitly non-release receipt after deleting the key and fake AAB', async t => {
  const f = fixture(t);
  const result = await invoke(f);
  assert.equal(result.ok, true);
  assert.equal(result.receiptPath, f.receiptPath);
  const receiptText = readFileSync(f.receiptPath, 'utf8');
  const receipt = JSON.parse(receiptText);
  assert.deepEqual(receipt, result.receipt);
  assert.equal(receipt.status, 'native-check-passed-not-a-release');
  assert.equal(receipt.syntheticConfigurationOnly, true);
  assert.equal(receipt.generatedKeyAndAabDeleted, true);
  for (const field of ['backendContacted', 'appOrDeviceLaunched', 'storeSubmission', 'productionSigningKeyUsed', 'finalBinaryManifestIdentityVerified']) assert.equal(receipt[field], false);
  assert.equal(receipt.configuredApplicationId, 'kr.synthfixture.genie');
  assert.equal(receipt.sourceCommit, f.env.GITHUB_SHA);
  assert.match(receipt.aabSha256, /^[a-f0-9]{64}$/);
  assert.equal(statSync(f.receiptPath).mode & 0o777, 0o600);
  assert.equal(existsSync(f.state.workspace), false);
  assert.equal(existsSync(f.state.keyDirectory), false);
  assert.equal(existsSync(f.state.keyFile), false);
  assert.equal(existsSync(f.state.artifact), false);
  assert.deepEqual(readdirSync(f.releaseRoot), ['native-smoke-result.json']);
  assert.deepEqual(f.state.calls.map(job => job.stage), ['java-version', 'temporary-key', 'native-build', 'verify-signature', 'verify-package']);
  assert.equal(f.state.verifications.length, 1);
  assert.equal(f.state.preparations[0].command, 'prepare');
  for (const child of [...f.state.calls, ...f.state.preparations, ...f.state.verifications]) {
    assert.equal('OPENAI_API_KEY' in child.env, false);
    assert.equal(JSON.stringify(child.args ?? []).includes(f.state.password), false);
    if (!['temporary-key', 'native-build'].includes(child.stage)) {
      assert.equal('GENIE_NATIVE_SMOKE_PASSWORD' in child.env, false);
      assert.equal('GENIE_ANDROID_KEYSTORE_PASSWORD' in child.env, false);
    }
  }
  assert.equal(receiptText.includes(f.state.password), false);
  assert.equal(receiptText.includes(f.state.keyFile), false);
  assert.equal(receiptText.includes(f.env.OPENAI_API_KEY), false);
});

nativeTest('a zero exit code with unsigned or partially unsigned content cannot produce a receipt', async t => {
  for (const signatureText of ['jar is unsigned.\n', 'jar verified.\nThis jar contains unsigned entries.\n']) {
    const f = fixture(t, { signatureText });
    assertCleanFailure(f, await invoke(f), 'AAB_SIGNATURE_UNCONFIRMED');
    assert.equal(f.state.calls.some(job => job.stage === 'verify-package'), false);
    assert.equal(f.state.verifications.length, 0);
  }
});

nativeTest('failed packaged-asset checks, including success without the match marker, clean up without a receipt', async t => {
  for (const options of [{ packageStatus: 1 }, { packageText: 'No asset match was established.\n' }]) {
    const f = fixture(t, options);
    assertCleanFailure(f, await invoke(f), 'AAB_PACKAGED_ASSETS_MISMATCH');
    assert.equal(f.state.verifications.length, 0);
  }
});

nativeTest('source/proof drift after the injected native build invalidates the result and deletes temporary artifacts', async t => {
  const f = fixture(t, { proofFailure: true });
  assertCleanFailure(f, await invoke(f), 'SOURCE_OR_ASSETS_CHANGED_DURING_NATIVE_BUILD');
  assert.equal(f.state.verifications.length, 1);
});

nativeTest('the actual Python ZIP guard accepts exact assets and rejects extra files or changed required bytes', async t => {
  const f = fixture(t);
  assert.equal((await invoke(f)).ok, true);
  const job = f.state.calls.find(call => call.stage === 'verify-package');
  assert.equal(job.args[0], '-c');
  const program = job.args[1];
  const python = findExecutable('python3', process.env);
  assert.ok(python, 'The focused ZIP regression requires an existing local Python interpreter.');
  const assets = path.join(f.base, 'zip-fixture-assets');
  put(assets, 'public/index.html', '<!doctype html><p>Synthetic ZIP fixture</p>\n');
  put(assets, 'public/assets/app.js', 'globalThis.syntheticZipFixture = true;\n');
  put(assets, 'capacitor.config.json', '{"appId":"kr.synthfixture.genie","webDir":"web"}\n');
  const archives = path.join(f.base, 'zip-fixture-archives');
  mkdirSync(archives);
  const runPython = args => spawnSync(python, ['-I', '-c', ...args], {
    cwd: f.base, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
    shell: false, encoding: 'utf8', timeout: 5000,
  });
  const setup = runPython([
    'import pathlib,sys,zipfile\n' +
    'root,output=map(pathlib.Path,sys.argv[1:])\n' +
    'for kind in ("exact","extra","changed","missing"):\n' +
    ' with zipfile.ZipFile(output/(kind+".zip"),"w") as z:\n' +
    '  z.writestr("base/manifest/AndroidManifest.xml",b"INERT_NOT_A_BINARY_MANIFEST")\n' +
    '  z.writestr("base/dex/classes.dex",b"INERT_NOT_DEX_BYTECODE")\n' +
    '  z.writestr("base/assets/public/",b"")\n' +
    '  for p in sorted(root.rglob("*")):\n' +
    '   if p.is_file():\n' +
    '    relative=p.relative_to(root).as_posix()\n' +
    '    if kind=="missing" and relative=="public/index.html": continue\n' +
    '    data=p.read_bytes()\n' +
    '    if kind=="changed" and relative=="public/index.html": data+=b"CHANGED_BYTES"\n' +
    '    z.writestr("base/assets/"+relative,data)\n' +
    '  if kind=="extra": z.writestr("base/assets/public/unexpected.js",b"UNEXPECTED_ASSET")\n',
    assets, archives,
  ]);
  assert.equal(setup.status, 0, setup.stderr);
  for (const kind of ['exact', 'extra', 'changed', 'missing']) {
    const checked = runPython([program, path.join(archives, `${kind}.zip`), assets]);
    if (kind === 'exact') {
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /^AAB_ASSETS_MATCH\s*$/);
    } else {
      assert.notEqual(checked.status, 0);
      const diagnostic = JSON.parse(checked.stdout.trim().replace(/^AAB_PACKAGE_DIAGNOSTICS /, ''));
      assert.deepEqual(diagnostic.missing, kind === 'missing' ? ['base/assets/public/index.html'] : []);
      assert.deepEqual(diagnostic.unexpected, kind === 'extra' ? ['base/assets/public/unexpected.js'] : []);
      assert.deepEqual(diagnostic.changed, kind === 'changed' ? ['base/assets/public/index.html'] : []);
      if (kind === 'extra') assert.match(diagnostic.unexpectedSha256['base/assets/public/unexpected.js'], /^[a-f0-9]{64}$/);
      assert.equal(checked.stdout.includes('AAB_ASSETS_MATCH'), false);
    }
  }
});
