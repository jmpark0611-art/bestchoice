import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectAndroidNativeEnvironment } from './android-release-environment.mjs';

// Inert files prove only discovery/rejection behavior. No compiler, Gradle, SDK,
// keystore reader, or child process is invoked by these tests.
function put(root, relative, content = 'INERT_TEST_FIXTURE_MUST_NOT_EXECUTE\n', executable = false) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
  if (executable) chmodSync(filename, 0o755);
  return filename;
}

function putGradleInstallation(root, version = '8.14.3') {
  const launcher = `gradle-gradle-cli-main-${version}.jar`;
  put(root, `lib/${launcher}`, 'INERT_LAUNCHER_MARKER_NOT_A_REAL_JAR\n');
  return put(root, 'bin/gradle', `INERT_TEST_FIXTURE_MUST_NOT_EXECUTE\n# lib/${launcher}\n`, true);
}

function fixture(t, flavor = 'all') {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-native-presence-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const webRoot = path.join(base, 'web');
  const javaHome = path.join(base, 'fixture-jdk');
  const sdk = path.join(base, 'fixture-sdk');
  const gradleHome = path.join(base, 'fixture-gradle-cache');
  const extension = process.platform === 'win32' ? '.exe' : '';
  const javacExecutable = put(javaHome, `bin/javac${extension}`, undefined, true);
  const jarsignerExecutable = put(javaHome, `bin/jarsigner${extension}`, undefined, true);
  const androidJar = put(sdk, 'platforms/android-36/android.jar', 'INERT_PLATFORM_NOT_A_REAL_JAR\n');
  const aapt2 = put(sdk, `build-tools/36.0.0/aapt2${extension}`, undefined, true);
  const gradleInstallation = path.join(gradleHome, `wrapper/dists/gradle-8.14.3-${flavor}/fixture-hash/gradle-8.14.3`);
  const gradleExecutable = putGradleInstallation(gradleInstallation);
  const keyPath = put(base, 'signing/release-upload.jks', 'INERT_SIGNING_FIXTURE_NOT_A_KEYSTORE\n');
  put(webRoot, 'android/variables.gradle', 'ext { compileSdkVersion = 36; targetSdkVersion = 36 }\n');
  put(webRoot, 'android/gradle/wrapper/gradle-wrapper.properties', `distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-${flavor}.zip\n`);
  const env = Object.freeze({
    JAVA_HOME: javaHome,
    PATH: '',
    ANDROID_HOME: sdk,
    GRADLE_USER_HOME: gradleHome,
    GENIE_ANDROID_KEYSTORE_PATH: keyPath,
    GENIE_ANDROID_KEYSTORE_PASSWORD: 'SYNTHETIC_STORE_PASSWORD_8712',
    GENIE_ANDROID_KEY_ALIAS: 'synthetic-upload-alias',
    GENIE_ANDROID_KEY_PASSWORD: 'SYNTHETIC_KEY_PASSWORD_8712',
  });
  return { base, webRoot, sdk, gradleHome, gradleInstallation, androidJar, aapt2, javacExecutable, jarsignerExecutable, gradleExecutable, env };
}

// The fixtures model a POSIX installation; this is not a real Linux/macOS tool run.
const inspect = (f, env = f.env) => inspectAndroidNativeEnvironment({ webRoot: f.webRoot, env, platform: 'linux' });
function rejected(result, code, field) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === code && (!field || error.field === field)));
}

function fileSnapshot(directory) {
  const files = [];
  const visit = relative => {
    const full = path.join(directory, relative);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push({ path: relative, directory: true, mode: stat.mode, mtime: stat.mtimeMs });
      for (const child of readdirSync(full).sort()) visit(relative ? `${relative}/${child}` : child);
    } else files.push({ path: relative, mode: stat.mode, mtime: stat.mtimeMs, bytes: readFileSync(full).toString('hex') });
  };
  visit('');
  return files;
}

test('resolves the exact configured Gradle all/bin cache and JDK paths without bootstrapping a wrapper', t => {
  for (const flavor of ['all', 'bin']) {
    const f = fixture(t, flavor);
    const values = flavor === 'bin' ? { ...f.env, ANDROID_HOME: '', ANDROID_SDK_ROOT: f.sdk } : f.env;
    const result = inspect(f, values);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.gradleExecutable, f.gradleExecutable);
    assert.equal(result.javacExecutable, f.javacExecutable);
    assert.equal(result.jarsignerExecutable, f.jarsignerExecutable);
    for (const filename of [result.gradleExecutable, result.javacExecutable, result.jarsignerExecutable]) assert.equal(path.isAbsolute(filename), true);
  }
});

test('missing SDK platform/build tools and a wrong Gradle distribution flavor are reported without filling the gaps', t => {
  for (const missing of ['platform', 'build-tools', 'configured-cache']) {
    const f = fixture(t, 'all');
    if (missing === 'platform') rmSync(f.androidJar);
    if (missing === 'build-tools') rmSync(f.aapt2);
    if (missing === 'configured-cache') renameSync(path.join(f.gradleHome, 'wrapper/dists/gradle-8.14.3-all'), path.join(f.gradleHome, 'wrapper/dists/gradle-8.14.3-bin'));
    const before = fileSnapshot(f.base);
    rejected(inspect(f), missing === 'configured-cache' ? 'GRADLE_CACHE_MISSING' : 'ANDROID_SDK_MISSING');
    assert.deepEqual(fileSnapshot(f.base), before);
  }
});

test('nonexecutable JDK tools or cached Gradle cannot pass an execution preflight', { skip: process.platform === 'win32' }, t => {
  for (const tool of ['javac', 'jarsigner', 'gradle']) {
    const f = fixture(t);
    chmodSync(f[`${tool}Executable`], 0o644);
    rejected(inspect(f), tool === 'gradle' ? 'GRADLE_CACHE_MISSING' : 'NATIVE_TOOL_MISSING', tool === 'gradle' ? 'GRADLE_USER_HOME' : tool);
  }
});

test('accepts an explicit installed Gradle executable or GRADLE_HOME outside the wrapper cache', t => {
  const f = fixture(t);
  const installation = path.join(f.base, 'approved-existing-installation');
  const executable = putGradleInstallation(installation);
  rmSync(f.gradleHome, { recursive: true });
  const before = fileSnapshot(f.base);
  for (const entry of [{ GENIE_GRADLE_EXECUTABLE: executable }, { GRADLE_HOME: installation }]) {
    const env = Object.freeze({ ...f.env, ...entry });
    const result = inspect(f, env);
    assert.equal(result.ok, true);
    assert.equal(result.gradleExecutable, executable);
    assert.deepEqual(env, { ...f.env, ...entry });
  }
  assert.deepEqual(fileSnapshot(f.base), before);
});

test('explicit executable takes precedence, and invalid explicit choices do not fall back to another valid installation', t => {
  const f = fixture(t);
  const home = path.join(f.base, 'approved-home');
  putGradleInstallation(home);
  const selected = putGradleInstallation(path.join(f.base, 'approved-executable'));
  assert.equal(inspect(f, { ...f.env, GENIE_GRADLE_EXECUTABLE: selected, GRADLE_HOME: home }).gradleExecutable, selected);
  for (const value of ['', ' ', 'relative/bin/gradle', path.join(f.base, 'missing/bin/gradle')]) {
    rejected(inspect(f, { ...f.env, GENIE_GRADLE_EXECUTABLE: value, GRADLE_HOME: home }),
      'GRADLE_INSTALLATION_MISMATCH', 'GENIE_GRADLE_EXECUTABLE');
    rejected(inspect(f, { ...f.env, GRADLE_HOME: value }), 'GRADLE_INSTALLATION_MISMATCH', 'GRADLE_HOME');
  }
});

test('rejects a wrong version, missing or ambiguous launcher markers, and a launcher pointing to a different version', t => {
  for (const invalid of ['wrong-version', 'missing-marker', 'ambiguous-markers', 'wrong-launcher-reference']) {
    const f = fixture(t);
    const installation = path.join(f.base, 'explicit-installation');
    const executable = putGradleInstallation(installation, invalid === 'wrong-version' ? '8.14.2' : '8.14.3');
    if (invalid === 'missing-marker') rmSync(path.join(installation, 'lib/gradle-gradle-cli-main-8.14.3.jar'));
    if (invalid === 'ambiguous-markers') put(installation, 'lib/gradle-gradle-cli-main-8.14.2.jar');
    if (invalid === 'wrong-launcher-reference') writeFileSync(executable, 'INERT_TEST_FIXTURE_MUST_NOT_EXECUTE\n# gradle-gradle-cli-main-8.14.2.jar\n');
    rejected(inspect(f, { ...f.env, GENIE_GRADLE_EXECUTABLE: executable }), 'GRADLE_INSTALLATION_MISMATCH');
  }
});

test('does not auto-select a Gradle installation from PATH and validates cached installation markers too', t => {
  const f = fixture(t);
  const pathExecutable = putGradleInstallation(path.join(f.base, 'path-only-installation'));
  rmSync(path.join(f.gradleInstallation, 'lib'), { recursive: true });
  rejected(inspect(f, { ...f.env, PATH: path.dirname(pathExecutable) }), 'GRADLE_CACHE_MISSING', 'GRADLE_USER_HOME');
});

test('resolves an explicitly chosen installation symlink and rejects nonexecutable explicit launchers', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const installation = path.join(f.base, 'approved-installation');
  const executable = putGradleInstallation(installation);
  const link = path.join(f.base, 'chosen-gradle');
  symlinkSync(executable, link);
  assert.equal(inspect(f, { ...f.env, GENIE_GRADLE_EXECUTABLE: link }).gradleExecutable, executable);
  chmodSync(executable, 0o644);
  rejected(inspect(f, { ...f.env, GENIE_GRADLE_EXECUTABLE: link }), 'GRADLE_INSTALLATION_MISMATCH');
});

test('a simulated Windows preflight stops before claiming batch-file execution support', t => {
  const f = fixture(t);
  const before = fileSnapshot(f.base);
  const result = inspectAndroidNativeEnvironment({ webRoot: f.webRoot, env: f.env, platform: 'win32' });
  rejected(result, 'NATIVE_PLATFORM_UNSUPPORTED', 'platform');
  assert.equal(result.gradleExecutable, null);
  assert.equal(result.javacExecutable, null);
  assert.equal(result.jarsignerExecutable, null);
  assert.deepEqual(fileSnapshot(f.base), before);
});

test('debug signing paths and aliases are blocked, and missing signing values are not guessed', t => {
  const f = fixture(t);
  const debugKey = put(f.base, 'signing/DEBUG.KEYSTORE', 'INERT_DEBUG_KEY_FIXTURE\n');
  rejected(inspect(f, { ...f.env, GENIE_ANDROID_KEYSTORE_PATH: debugKey }), 'RELEASE_KEYSTORE_MISSING', 'GENIE_ANDROID_KEYSTORE_PATH');
  for (const alias of ['androiddebugkey', 'AndroidDebugKey', ' androiddebugkey ']) {
    rejected(inspect(f, { ...f.env, GENIE_ANDROID_KEY_ALIAS: alias }), 'RELEASE_SIGNING_MISSING', 'GENIE_ANDROID_KEY_ALIAS');
  }
  for (const field of ['GENIE_ANDROID_KEYSTORE_PASSWORD', 'GENIE_ANDROID_KEY_ALIAS', 'GENIE_ANDROID_KEY_PASSWORD']) {
    rejected(inspect(f, { ...f.env, [field]: '   ' }), 'RELEASE_SIGNING_MISSING', field);
  }
});

test('both success and failure leave files/environment unchanged and errors do not expose supplied paths or secrets', t => {
  const f = fixture(t);
  const before = fileSnapshot(f.base);
  const envBefore = { ...f.env };
  assert.equal(inspect(f).ok, true);
  const secretPath = path.join(f.base, 'UNIQUE_PRIVATE_LOCATION_8712');
  const result = inspect(f, Object.freeze({ ...f.env,
    JAVA_HOME: secretPath,
    ANDROID_HOME: secretPath,
    GRADLE_USER_HOME: secretPath,
    GENIE_GRADLE_EXECUTABLE: path.join(secretPath, 'UNIQUE_PRIVATE_GRADLE_8712'),
    GENIE_ANDROID_KEYSTORE_PATH: path.join(secretPath, 'UNIQUE_PRIVATE_STORE_8712.jks'),
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 5);
  const diagnostics = JSON.stringify(result.errors);
  for (const value of [f.base, secretPath, 'UNIQUE_PRIVATE', f.env.GENIE_ANDROID_KEYSTORE_PASSWORD,
    f.env.GENIE_ANDROID_KEY_PASSWORD, f.env.GENIE_ANDROID_KEY_ALIAS]) assert.equal(diagnostics.includes(value), false);
  assert.deepEqual(f.env, envBefore);
  assert.deepEqual(fileSnapshot(f.base), before);
});
