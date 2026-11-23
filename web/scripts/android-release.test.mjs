import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAndroidRelease } from './android-release.mjs';

const sourceWebRoot = fileURLToPath(new URL('..', import.meta.url));
// Syntax-only fixtures. Tests inject every command and never contact these hosts.
const validEnv = Object.freeze({
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie',
  GENIE_ANDROID_VERSION_CODE: '12',
  GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
  VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
});
const signingFields = [
  'GENIE_ANDROID_KEYSTORE_PATH', 'GENIE_ANDROID_KEYSTORE_PASSWORD',
  'GENIE_ANDROID_KEY_ALIAS', 'GENIE_ANDROID_KEY_PASSWORD',
];
const nativeReady = async ({ webRoot }) => ({ ok: true, errors: [],
  gradleExecutable: path.join(webRoot, '.synthetic-native-tools', 'gradle'),
  jarsignerExecutable: path.join(webRoot, '.synthetic-native-tools', 'jarsigner'),
  javacExecutable: path.join(webRoot, '.synthetic-native-tools', 'javac'),
});

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'genie-release-orchestration-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

async function fixture(t) {
  const base = await temporaryRoot(t);
  const webRoot = path.join(base, 'web');
  await mkdir(webRoot, { recursive: true });
  for (const entry of ['src', 'scripts', 'android', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'capacitor.config.ts']) {
    await cp(path.join(sourceWebRoot, entry), path.join(webRoot, entry), {
      recursive: true,
      filter: source => !['node_modules', '.gradle', 'build', 'local.properties', '.genie-release'].includes(path.basename(source)),
    });
  }
  // Inert regular files satisfy dependency preflight. The injected runner never executes them.
  for (const binary of ['typescript/bin/tsc', '@capacitor/cli/bin/capacitor']) {
    const target = path.join(webRoot, 'node_modules', binary);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "throw new Error('INERT_TEST_FIXTURE_MUST_NOT_EXECUTE');\n");
  }
  await mkdir(path.join(webRoot, '.synthetic-native-tools'));
  for (const tool of ['gradle', 'jarsigner', 'javac']) {
    await writeFile(path.join(webRoot, '.synthetic-native-tools', tool), 'INERT_NATIVE_FIXTURE_MUST_NOT_EXECUTE\n');
  }
  await mkdir(path.join(webRoot, 'ios'), { recursive: true });
  await writeFile(path.join(webRoot, 'ios', 'untouched.txt'), 'do not prepare iOS here');
  return webRoot;
}

function fakeCommands({ failStage, omitBuildOutput = false, failBundle = false, createSyntheticBundle = false,
  signatureText = 'jar verified.', tamperSync = false, nonemptyShim = false, unexpectedExtra = false, missingShim = false, throwStage } = {}) {
  const calls = [];
  const run = async job => {
    calls.push({ ...job, args: [...job.args], env: { ...job.env } });
    if (job.stage === throwStage) throw new Error('RUNNER_PRIVATE_SENTINEL_8712');
    if (job.stage === failStage) return { status: 19 };
    if (job.stage === 'typecheck') return { status: 0 };
    if (job.stage === 'web-build') {
      if (!omitBuildOutput) {
        const outDir = job.args.at(-1);
        assert.ok(path.isAbsolute(outDir), 'fake build expects an explicit isolated output directory');
        await mkdir(path.join(outDir, 'assets'), { recursive: true });
        await writeFile(path.join(outDir, 'index.html'), '<!doctype html><html><head><script type="module" src="./assets/app.js"></script></head><body>결정해지니</body></html>');
        await writeFile(path.join(outDir, 'assets', 'app.js'), `globalThis.__GENIE_SYNTHETIC_ENV__=${JSON.stringify([
          job.env.VITE_SUPABASE_URL, job.env.VITE_SUPABASE_PUBLISHABLE_KEY, job.env.VITE_PUBLIC_APP_URL,
        ])};`);
      }
      return { status: 0 };
    }
    if (job.stage === 'sync') {
      const assets = path.join(job.cwd, 'android', 'app', 'src', 'main', 'assets');
      await mkdir(assets, { recursive: true });
      await rm(path.join(assets, 'public'), { recursive: true, force: true });
      await cp(path.join(job.cwd, 'web'), path.join(assets, 'public'), { recursive: true });
      await writeFile(path.join(assets, 'public', 'cordova.js'), nonemptyShim ? 'unexpected generated code' : '');
      if (!missingShim) await writeFile(path.join(assets, 'public', 'cordova_plugins.js'), '');
      if (unexpectedExtra) await writeFile(path.join(assets, 'public', 'unexpected-generated.js'), 'unexpected extra asset');
      if (tamperSync) {
        const scriptPath = path.join(assets, 'public', 'assets', 'app.js');
        await writeFile(scriptPath, `${await readFile(scriptPath, 'utf8')}\n// Different copied bytes: all three configured values remain present.\n`);
      }
      await cp(path.join(job.cwd, 'capacitor.config.json'), path.join(assets, 'capacitor.config.json'));
      await writeFile(path.join(assets, 'capacitor.plugins.json'), '[]\n');
      return { status: 0 };
    }
    if (job.args.some(argument => /bundleRelease/.test(argument))) {
      if (failBundle) return { status: 23 };
      assert.equal(createSyntheticBundle, true, 'bundle creation requires an explicitly selected synthetic fixture');
      const artifact = path.join(job.cwd, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(artifact, 'SYNTHETIC_NOT_AN_ANDROID_BUNDLE_OR_SIGNATURE');
      return { status: 0 };
    }
    if (job.stage === 'verify-bundle') {
      assert.equal(createSyntheticBundle, true);
      assert.equal(job.capture, true);
      return { status: 0, stdout: signatureText };
    }
    assert.fail(`Unexpected injected command stage: ${job.stage}`);
  };
  return { calls, run };
}

async function findManifests(directory) {
  if (!existsSync(directory)) return [];
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findManifests(full));
    else if (entry.isFile() && /release.*manifest.*\.json$/.test(entry.name)) matches.push(full);
  }
  return matches;
}

test('invalid configuration stops before creating a workspace or starting any command', async t => {
  const base = await temporaryRoot(t);
  const webRoot = path.join(base, 'not-created');
  const commands = fakeCommands();
  const env = { ...validEnv };
  delete env.VITE_PUBLIC_APP_URL;
  const result = await runAndroidRelease({ command: 'prepare', webRoot, env, run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, false);
  assert.equal(commands.calls.length, 0);
  assert.equal(existsSync(webRoot), false);
  assert.ok(result.errors.some(error => error.field === 'VITE_PUBLIC_APP_URL'));
});

test('a dangerous public environment variable is rejected without echoing its name or credential', async t => {
  const base = await temporaryRoot(t);
  const webRoot = path.join(base, 'not-created');
  const commands = fakeCommands();
  const logs = [];
  const result = await runAndroidRelease({ command: 'prepare', webRoot,
    env: { ...validEnv, VITE_UNIQUE_PRIVATE_SENTINEL_8712: 'sb_secret_PUBLIC_LEAK_SENTINEL_8712' },
    run: commands.run, inspectNative: nativeReady, log: line => logs.push(line) });
  assert.equal(result.ok, false);
  assert.equal(commands.calls.length, 0);
  assert.equal(existsSync(webRoot), false);
  assert.equal(/UNIQUE_PRIVATE|PUBLIC_LEAK/.test(JSON.stringify(result) + logs.join('\n')), false);
});

for (const failedStage of ['typecheck', 'web-build']) {
  test(`${failedStage} failure stops before Android sync and leaves no release manifest`, async t => {
    const webRoot = await fixture(t);
    const commands = fakeCommands({ failStage: failedStage });
    const result = await runAndroidRelease({ command: 'prepare', webRoot, env: validEnv,
      run: commands.run, inspectNative: nativeReady, log() {} });
    assert.equal(result.ok, false);
    assert.equal(commands.calls.some(call => call.stage === 'sync'), false);
    assert.equal(commands.calls.at(-1).stage, failedStage);
    assert.deepEqual(await findManifests(path.join(webRoot, '.genie-release')), []);
  });
}

test('successful command exit without newly built web assets cannot produce a release manifest', async t => {
  const webRoot = await fixture(t);
  await mkdir(path.join(webRoot, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(webRoot, 'dist', 'index.html'), 'OLD_BUILD_MUST_NOT_BE_REUSED');
  await writeFile(path.join(webRoot, 'dist', 'assets', 'app.js'), 'OLD_BUILD_MUST_NOT_BE_REUSED');
  const commands = fakeCommands({ omitBuildOutput: true });
  const result = await runAndroidRelease({ command: 'prepare', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, false);
  assert.deepEqual(await findManifests(path.join(webRoot, '.genie-release')), []);
  assert.equal(await readFile(path.join(webRoot, 'dist', 'index.html'), 'utf8'), 'OLD_BUILD_MUST_NOT_BE_REUSED');
});

test('prepare uses a fresh Android-only workspace, preserves originals, and strips private credentials from children', async t => {
  const webRoot = await fixture(t);
  const tracked = ['capacitor.config.ts', 'android/app/build.gradle', 'android/app/src/main/res/values/strings.xml'];
  const before = await Promise.all(tracked.map(file => readFile(path.join(webRoot, file))));
  const commands = fakeCommands();
  const env = { ...validEnv,
    GENIE_ANDROID_KEYSTORE_PATH: '/synthetic/UNIQUE_SIGNING_PATH_8712.jks',
    GENIE_ANDROID_KEYSTORE_PASSWORD: 'UNIQUE_SIGNING_STORE_PASSWORD_8712',
    GENIE_ANDROID_KEY_ALIAS: 'UNIQUE_SIGNING_ALIAS_8712',
    GENIE_ANDROID_KEY_PASSWORD: 'UNIQUE_SIGNING_KEY_PASSWORD_8712',
    OPENAI_API_KEY: 'sk_UNRELATED_PRIVATE_SENTINEL_8712',
  };
  const result = await runAndroidRelease({ command: 'prepare', webRoot, env,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.workspace.startsWith(path.join(webRoot, '.genie-release', 'run-')));
  assert.ok(result.manifestPath && existsSync(result.manifestPath));
  assert.deepEqual(commands.calls.map(call => call.stage), ['typecheck', 'web-build', 'sync']);
  const sync = commands.calls.find(call => call.stage === 'sync');
  assert.ok(sync.args.includes('android'));
  assert.equal(sync.args.includes('ios'), false);
  assert.equal(sync.cwd, result.workspace);
  assert.equal(existsSync(path.join(result.workspace, 'ios')), false);
  for (const call of commands.calls) {
    for (const field of signingFields) assert.equal(field in call.env, false, `${field} leaked to ${call.stage}`);
    assert.equal('OPENAI_API_KEY' in call.env, false);
    assert.equal(/UNIQUE_SIGNING|UNRELATED_PRIVATE/.test(JSON.stringify(call.args)), false);
  }
  const build = commands.calls.find(call => call.stage === 'web-build');
  for (const field of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_PUBLIC_APP_URL']) assert.equal(build.env[field], validEnv[field]);
  assert.equal(/UNIQUE_SIGNING|UNRELATED_PRIVATE/.test(await readFile(result.manifestPath, 'utf8')), false);
  for (let index = 0; index < tracked.length; index++) assert.deepEqual(await readFile(path.join(webRoot, tracked[index])), before[index]);
  assert.equal(await readFile(path.join(webRoot, 'ios', 'untouched.txt'), 'utf8'), 'do not prepare iOS here');
});

test('a sync that changes a built asset cannot create a manifest even when all public config values remain embedded', async t => {
  const webRoot = await fixture(t);
  const commands = fakeCommands({ tamperSync: true });
  const result = await runAndroidRelease({ command: 'prepare', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, false);
  assert.ok(commands.calls.some(call => call.stage === 'sync'));
  assert.deepEqual(await findManifests(path.join(webRoot, '.genie-release')), []);
});

for (const [label, behavior] of [
  ['nonempty generated Cordova shim', { nonemptyShim: true }],
  ['unexpected generated asset', { unexpectedExtra: true }],
  ['missing generated Cordova shim', { missingShim: true }],
]) {
  test(`${label} is rejected before creating a release manifest`, async t => {
    const webRoot = await fixture(t);
    const commands = fakeCommands(behavior);
    const result = await runAndroidRelease({ command: 'prepare', webRoot, env: validEnv,
      run: commands.run, inspectNative: nativeReady, log() {} });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'sync');
    assert.ok(result.errors.some(error => error.code === 'ANDROID_COPY_MISMATCH'));
    assert.deepEqual(await findManifests(path.join(webRoot, '.genie-release')), []);
  });
}

test('bundle refuses missing native prerequisites before invoking any command', async t => {
  const webRoot = await fixture(t);
  const commands = fakeCommands();
  let inspected = 0;
  const result = await runAndroidRelease({ command: 'bundle', webRoot, env: validEnv, run: commands.run,
    inspectNative: async () => { inspected++; return { ok: false, errors: [{ field: 'ANDROID_HOME', code: 'SDK_MISSING', message: 'Android SDK is missing.' }] }; },
    log() {} });
  assert.equal(result.ok, false);
  assert.equal(inspected, 1);
  assert.equal(commands.calls.length, 0);
  assert.equal(existsSync(path.join(webRoot, '.genie-release')), false);
});

test('failed bundle cannot be reported successful using an old AAB from the original Android tree', async t => {
  const webRoot = await fixture(t);
  const staleBundle = path.join(webRoot, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  await mkdir(path.dirname(staleBundle), { recursive: true });
  await writeFile(staleBundle, 'STALE_UNSIGNED_AAB_FIXTURE');
  const commands = fakeCommands({ failBundle: true });
  const result = await runAndroidRelease({ command: 'bundle', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, false);
  assert.equal('artifactPath' in result, false);
  const bundle = commands.calls.find(call => call.stage === 'bundle');
  assert.ok(bundle);
  assert.equal(bundle.command, path.join(webRoot, '.synthetic-native-tools', 'gradle'));
  assert.ok(bundle.args.includes('--offline'));
  assert.ok(bundle.args.includes('--no-configuration-cache'));
  assert.equal(/gradlew(?:\.bat)?$/.test(bundle.command), false);
  assert.equal(await readFile(staleBundle, 'utf8'), 'STALE_UNSIGNED_AAB_FIXTURE');
});

test('injected successful bundle flow uses cached tools and returns only the freshly created synthetic artifact', async t => {
  const webRoot = await fixture(t);
  const commands = fakeCommands({ createSyntheticBundle: true });
  const result = await runAndroidRelease({ command: 'bundle', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(commands.calls.map(call => call.stage), ['typecheck', 'web-build', 'sync', 'bundle', 'verify-bundle']);
  const bundle = commands.calls.find(call => call.stage === 'bundle');
  const verify = commands.calls.find(call => call.stage === 'verify-bundle');
  assert.equal(bundle.command, path.join(webRoot, '.synthetic-native-tools', 'gradle'));
  assert.ok(bundle.args.includes('--offline'));
  assert.ok(bundle.args.includes('--no-configuration-cache'));
  assert.equal(verify.command, path.join(webRoot, '.synthetic-native-tools', 'jarsigner'));
  assert.equal(result.artifactPath, path.join(result.workspace, 'android/app/build/outputs/bundle/release/app-release.aab'));
  assert.equal(await readFile(result.artifactPath, 'utf8'), 'SYNTHETIC_NOT_AN_ANDROID_BUNDLE_OR_SIGNATURE');
  const proof = JSON.parse(await readFile(path.join(result.workspace, 'ANDROID-BUNDLE.json'), 'utf8'));
  assert.equal(proof.status, 'created-awaiting-device-and-store-review');
});

test('zero exit with an unsigned verification result cannot be reported as a completed bundle', async t => {
  const webRoot = await fixture(t);
  const commands = fakeCommands({ createSyntheticBundle: true, signatureText: 'jar is unsigned.' });
  const result = await runAndroidRelease({ command: 'bundle', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log() {} });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'verify-bundle');
  assert.equal('artifactPath' in result, false);
  const verify = commands.calls.find(call => call.stage === 'verify-bundle');
  assert.ok(verify);
  assert.equal(existsSync(path.join(verify.cwd, '..', 'ANDROID-BUNDLE.json')), false);
});

test('unexpected runner failures return controlled errors without exposing exception details', async t => {
  const webRoot = await fixture(t);
  const commands = fakeCommands({ throwStage: 'typecheck' });
  const logs = [];
  const result = await runAndroidRelease({ command: 'prepare', webRoot, env: validEnv,
    run: commands.run, inspectNative: nativeReady, log: line => logs.push(line) });
  assert.equal(result.ok, false);
  assert.equal(commands.calls.length, 1);
  assert.equal((JSON.stringify(result) + logs.join('\n')).includes('RUNNER_PRIVATE_SENTINEL_8712'), false);
  assert.deepEqual(await findManifests(path.join(webRoot, '.genie-release')), []);
});
