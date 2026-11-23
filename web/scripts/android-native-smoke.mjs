import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAndroidRelease, publicBuildEnvironment } from './android-release.mjs';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { findExecutable } from './android-release-environment.mjs';
import { readVerifiedBundleIdentity } from './android-bundle-identity.mjs';
import { packagedAssetsCheckJob } from './android-packaged-assets.mjs';
import { digest, verifyAndroidRelease } from './android-release-manifest.mjs';

const webRootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapperDigest = '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172';
const distributionDigest = 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c';
const fixtureEnv = Object.freeze({
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie',
  GENIE_ANDROID_VERSION_CODE: '12', GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
  VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
});
const fail = code => ({ ok: false, code });
const regular = file => { try { return lstatSync(file).isFile(); } catch { return false; } };
const execute = job => {
  const result = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, shell: false,
    encoding: 'utf8', stdio: job.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

/** Native compilation check only. Never reads production inputs, starts the app, or keeps the test key/AAB. */
export async function runNativeSmoke({ webRoot = webRootDefault, env = process.env, allowDownloads = false,
  run = execute, prepare = runAndroidRelease, verify = verifyAndroidRelease } = {}) {
  if (!allowDownloads) return fail('EXPLICIT_DEPENDENCY_DOWNLOAD_OPT_IN_REQUIRED');
  if (process.platform !== 'linux') return fail('LINUX_NATIVE_CHECK_REQUIRED');
  if (Object.keys(env).some(key => key.startsWith('GENIE_ANDROID_') || key.startsWith('VITE_'))) {
    return fail('REMOVE_REAL_RELEASE_INPUTS_FROM_SYNTHETIC_CHECK');
  }
  const tools = Object.fromEntries(['java', 'javac', 'jarsigner', 'keytool', 'python3'].map(name => [name, findExecutable(name, env)]));
  if (Object.values(tools).some(value => !value)) return fail('LOCAL_NATIVE_TOOLS_REQUIRED');
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk || !path.isAbsolute(sdk) || !regular(path.join(sdk, 'platforms/android-36/android.jar')) ||
      !regular(path.join(sdk, 'build-tools/35.0.0/aapt2'))) return fail('EXISTING_ANDROID_36_AND_BUILD_TOOLS_35_REQUIRED');
  const wrapper = path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.jar');
  const properties = path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.properties');
  if (!regular(wrapper) || digest(readFileSync(wrapper)) !== wrapperDigest || !regular(properties)) return fail('GRADLE_WRAPPER_IDENTITY_MISMATCH');
  const configText = readFileSync(properties, 'utf8');
  const urls = configText.split(/\r?\n/).filter(line => /^distributionUrl\s*[=:]/.test(line));
  const sums = configText.split(/\r?\n/).filter(line => /^distributionSha256Sum\s*[=:]/.test(line));
  if (urls.length !== 1 || urls[0] !== 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip' ||
      sums.length !== 1 || sums[0] !== `distributionSha256Sum=${distributionDigest}`) return fail('GRADLE_DISTRIBUTION_IDENTITY_MISMATCH');
  const releaseRoot = path.join(webRoot, '.genie-release');
  if (existsSync(releaseRoot) && (lstatSync(releaseRoot).isSymbolicLink() || !lstatSync(releaseRoot).isDirectory())) return fail('UNSAFE_RESULT_DIRECTORY');
  mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(releaseRoot, 'native-smoke-result.json');
  if (existsSync(receiptPath)) return fail('PREVIOUS_NATIVE_CHECK_RECEIPT_EXISTS');
  const config = resolveAndroidReleaseConfig(fixtureEnv).config;
  const buildEnv = publicBuildEnvironment(env, config);
  for (const key of ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME']) {
    if (typeof env[key] === 'string') buildEnv[key] = env[key];
  }
  buildEnv.GENIE_NODE_BINARY = process.execPath;
  let temporary;
  let workspace;
  try {
    // AGP merges this required Capacitor library asset into the app bundle.
    // Snapshot its bytes before preparation/build; do not accept arbitrary extras.
    const nativeBridge = path.join(webRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js');
    if (!regular(nativeBridge)) return fail('CAPACITOR_NATIVE_BRIDGE_REQUIRED');
    const libraryAssets = { 'base/assets/native-bridge.js': digest(readFileSync(nativeBridge)) };
    const java = await run({ stage: 'java-version', command: tools.javac, args: ['-version'], cwd: webRoot, env: buildEnv, capture: true });
    if (java.status !== 0 || !/^javac 21(?:\.|\s|$)/m.test(java.stdout)) return fail('JAVA_21_COMPILER_REQUIRED');
    const prepared = await prepare({ command: 'prepare', webRoot, env: buildEnv });
    if (!prepared.ok) return fail('FRESH_ANDROID_PREPARATION_FAILED');
    workspace = prepared.workspace;
    if (path.dirname(workspace) !== releaseRoot || !path.basename(workspace).startsWith('run-') || lstatSync(workspace).isSymbolicLink()) {
      workspace = undefined;
      return fail('UNEXPECTED_PREPARATION_WORKSPACE');
    }
    temporary = mkdtempSync(path.join(tmpdir(), 'genie-native-disposable-key-'));
    const keyFile = path.join(temporary, 'native-check.p12');
    const password = randomBytes(24).toString('hex');
    const privateEnv = { ...buildEnv, GENIE_NATIVE_SMOKE_PASSWORD: password };
    const key = await run({ stage: 'temporary-key', command: tools.keytool, args: ['-genkeypair', '-noprompt',
      '-keystore', keyFile, '-storetype', 'PKCS12', '-storepass:env', 'GENIE_NATIVE_SMOKE_PASSWORD',
      '-keypass:env', 'GENIE_NATIVE_SMOKE_PASSWORD', '-alias', 'genie-native-smoke', '-keyalg', 'RSA',
      '-keysize', '2048', '-validity', '2', '-dname', 'CN=Genie Disposable Native Check'], cwd: temporary, env: privateEnv, capture: true });
    if (key.status !== 0 || !regular(keyFile)) return fail('TEMPORARY_SIGNING_KEY_FAILED');
    const nativeEnv = { ...buildEnv,
      GENIE_ANDROID_KEYSTORE_PATH: keyFile, GENIE_ANDROID_KEYSTORE_PASSWORD: password,
      GENIE_ANDROID_KEY_ALIAS: 'genie-native-smoke', GENIE_ANDROID_KEY_PASSWORD: password,
    };
    const androidDir = path.join(workspace, 'android');
    // Explicitly opt-in only here: a disposable compilation check may fetch the
    // checksum-pinned Gradle distribution and configured Android build dependencies.
    // The production android:bundle command remains offline.
    const build = await run({ stage: 'native-build', command: '/bin/sh',
      args: [path.join(androidDir, 'gradlew'), '--no-daemon', '--no-configuration-cache',
        '-Pandroid.builder.sdkDownload=false', '--console=plain', 'bundleRelease', 'verifyGenieBundleIdentity'], cwd: androidDir, env: nativeEnv });
    if (build.status !== 0) return fail('ANDROID_NATIVE_COMPILATION_FAILED');
    const artifact = path.join(androidDir, 'app/build/outputs/bundle/release/app-release.aab');
    if (!regular(artifact) || lstatSync(artifact).size === 0) return fail('NEW_AAB_MISSING');
    const signature = await run({ stage: 'verify-signature', command: tools.jarsigner,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', artifact], cwd: androidDir, env: buildEnv, capture: true });
    if (signature.status !== 0 || !/jar verified\./i.test(signature.stdout) || /jar is unsigned|unsigned entries|invalid signature/i.test(signature.stdout)) {
      return fail('AAB_SIGNATURE_UNCONFIRMED');
    }
    const identity = readVerifiedBundleIdentity({ androidDir, config });
    if (!identity.ok) return fail('AAB_FINAL_MANIFEST_IDENTITY_UNCONFIRMED');
    // Read only the new AAB. Compare the exact combined set of prepared app assets
    // and the pinned dependency's bridge, including every byte/fingerprint.
    const archive = await run(packagedAssetsCheckJob({ pythonExecutable: tools.python3, artifactPath: artifact,
      assetRoot: path.join(androidDir, 'app/src/main/assets'), libraryAssets, cwd: androidDir, env: buildEnv }));
    if (archive.status !== 0 || !archive.stdout.includes('AAB_ASSETS_MATCH')) {
      // File names and structural checks only; never log file bytes or signing inputs.
      const diagnostic = archive.stdout.split('\n').find(line => line.startsWith('AAB_PACKAGE_DIAGNOSTICS '));
      if (diagnostic) console.error(diagnostic);
      return fail('AAB_PACKAGED_ASSETS_MISMATCH');
    }
    if (!regular(nativeBridge) || digest(readFileSync(nativeBridge)) !== libraryAssets['base/assets/native-bridge.js']) {
      return fail('CAPACITOR_NATIVE_BRIDGE_CHANGED_DURING_BUILD');
    }
    const checked = verify({ androidDir, env: buildEnv });
    if (!checked.ok) return fail('SOURCE_OR_ASSETS_CHANGED_DURING_NATIVE_BUILD');
    const finalBundleSha256 = digest(readFileSync(artifact));
    if (finalBundleSha256 !== identity.receipt.sha256) return fail('AAB_CHANGED_AFTER_FINAL_MANIFEST_VERIFICATION');
    const receipt = { status: 'native-check-passed-not-a-release',
      sourceCommit: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
      node: process.version, javac: java.stdout.trim(), configuredApplicationId: config.applicationId,
      versionCode: config.versionCode, versionName: config.versionName,
      aabSha256: finalBundleSha256, nativeCompilation: true, signatureVerified: true,
      packagedAssetsMatch: true, libraryAssetsVerified: libraryAssets, finalBinaryManifestIdentityVerified: true,
      finalApplicationId: identity.receipt.applicationId, finalVersionCode: identity.receipt.versionCode,
      finalVersionName: identity.receipt.versionName, finalManifestSha256: identity.receipt.manifestSha256,
      syntheticConfigurationOnly: true, backendContacted: false, appOrDeviceLaunched: false,
      storeSubmission: false, productionSigningKeyUsed: false,
      generatedKeyAndAabDeleted: true };
    // Remove all temporary key and app bytes before publishing a success receipt.
    rmSync(temporary, { recursive: true }); temporary = undefined;
    rmSync(workspace, { recursive: true }); workspace = undefined;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { ok: true, receiptPath, receipt };
  } catch { return fail('NATIVE_CHECK_INCOMPLETE'); }
  finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runNativeSmoke({ allowDownloads: process.argv.length === 3 && process.argv[2] === '--allow-dependency-downloads' });
  if (!result.ok) { console.error(`Android native check stopped: ${result.code}`); process.exitCode = 1; }
  else {
    console.log('Android native compilation and temporary-signature check passed. Temporary key and AAB deleted; this is not a store release.');
    console.log(`GENIE_NATIVE_CHECK_RECEIPT ${JSON.stringify(result.receipt)}`);
  }
}
