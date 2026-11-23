import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAndroidRelease, publicBuildEnvironment } from './android-release.mjs';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { findExecutable } from './android-release-environment.mjs';
import { readVerifiedBundleIdentity } from './android-bundle-identity.mjs';
import { packagedAssetsCheckJob } from './android-packaged-assets.mjs';
import { digest, publicConfigFingerprint, verifyAndroidRelease } from './android-release-manifest.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const signingFields = ['GENIE_ANDROID_KEYSTORE_PATH', 'GENIE_ANDROID_KEYSTORE_PASSWORD', 'GENIE_ANDROID_KEY_ALIAS', 'GENIE_ANDROID_KEY_PASSWORD'];
const wrapperDigest = '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172';
const distributionDigest = 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c';
const bundleRelative = 'android/app/build/outputs/bundle/release/app-release.aab';
const identityRelative = 'android/app/build/outputs/bundle/release/genie-bundle-identity.json';
const preparationRelative = 'android/genie-release-manifest.json';
const resultRelative = 'unsigned-export.json';
const fail = code => ({ ok: false, code });
const regular = filename => { try { return lstatSync(filename).isFile(); } catch { return false; } };
class ExportFailure extends Error { constructor(code) { super(code); this.code = code; } }
const stop = code => { throw new ExportFailure(code); };

// Child output is captured even for build failures: a public client key may be
// present in the environment, but must never be echoed into a CI log.
const execute = job => {
  const result = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, shell: false,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '',
    signal: result.signal ?? null, errorCode: result.error?.code ?? null };
};

/**
 * Project only bounded build metadata, never arbitrary Gradle error text.
 * Redacting a raw log excerpt alone is insufficient: it can include an encoded
 * client key, an environment dump, or a source line containing a credential.
 */
export function unsignedBuildFailureDiagnostic(result = {}) {
  const scanLimit = 128 * 1024;
  const streams = [result.stdout, result.stderr].map(value => typeof value === 'string' ? value : '');
  const text = streams.map(value => value.slice(-scanLimit)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).join('\n');
  const reasons = [
    ['DEPENDENCY_RESOLUTION_FAILED', /Could not (?:resolve|download|find)\b|Could not get resource|Could not GET/i],
    ['GRADLE_DISTRIBUTION_DOWNLOAD_FAILED', /Could not install Gradle distribution|Downloading .*gradle-8\.14\.3-all\.zip[\s\S]*Exception/i],
    ['SDK_LICENSE_NOT_ACCEPTED', /licenses? (?:have |has )?not been accepted|License for package .*not accepted|LicenseNotAcceptedException/i],
    ['ANDROID_SDK_COMPONENT_MISSING', /SDK location not found|Failed to find (?:Platform SDK|Build Tools|target)|SDK package.*(?:missing|not installed)/i],
    ['ANDROID_RESOURCE_COMPILATION_FAILED', /Android resource linking failed|Resource compilation failed|AAPT2?.*(?:error|failed)/i],
    ['JAVA_COMPILATION_FAILED', /Compilation failed|error: (?:cannot find symbol|package .* does not exist|incompatible types)/i],
    ['JAVA_TOOLCHAIN_MISMATCH', /Unsupported class file major version|invalid source release|requires Java|Cannot find a Java installation/i],
    ['NETWORK_TIMEOUT', /SocketTimeoutException|ConnectTimeoutException|Read timed out|connect timed out|Connection timed out/i],
    ['NETWORK_CONNECTION_FAILED', /UnknownHostException|ConnectException|Connection reset|Connection refused|Network is unreachable/i],
    ['TLS_VERIFICATION_FAILED', /SSLHandshakeException|PKIX path building failed|unable to find valid certification path/i],
    ['GRADLE_DAEMON_DISAPPEARED', /Gradle build daemon disappeared unexpectedly|DaemonDisappearedException/i],
    ['OUT_OF_MEMORY', /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Cannot allocate memory/i],
    ['DISK_SPACE_EXHAUSTED', /No space left on device|ENOSPC/],
    ['RELEASE_PREPARATION_GUARD_FAILED', /Android release (?:preparation|source, configuration or assets|verifier)/],
    ['BINARY_MANIFEST_IDENTITY_FAILED', /Android bundle identity verification failed/],
    ['UNSIGNED_MODE_GUARD_FAILED', /Unsigned Android export must not receive|unsigned export option accepts only/],
  ].filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
  const safeTask = value => typeof value === 'string' &&
    /^:(?:(?:app|capacitor-android|capacitor-cordova-android-plugins):)?[A-Za-z][A-Za-z0-9]{0,79}$/.test(value);
  const failures = [...text.matchAll(/(?:Execution failed for task '([^'\r\n]{1,180})'|> Task (:[^\s]{1,180}) FAILED)/g)]
    .map(match => match[1] ?? match[2]).filter(safeTask);
  const tasks = [...text.matchAll(/^> Task (:[^\s]{1,180})(?:\s|$)/gm)].map(match => match[1]).filter(safeTask);
  const dependencies = [...text.matchAll(/\b((?:com\.(?:android|google)|androidx|org\.(?:jetbrains|gradle))(?:\.[a-z][a-z0-9_.]{0,63})?:[a-z][a-z0-9._-]{0,79}:[0-9][0-9A-Za-z.+-]{0,39})(?![\w.-])/g)]
    .map(match => match[1].replace(/\.+$/, '')).filter(value => !/sb_(?:publishable|secret)_|sk[-_]/.test(value));
  const httpStatuses = [...text.matchAll(/(?:status(?:\s+code)?\s*:?\s*|HTTP\/[12](?:\.[0-9])?\s+)([45][0-9]{2})\b/gi)]
    .map(match => Number(match[1]));
  const hosts = ['dl.google.com', 'maven.google.com', 'repo.maven.apache.org', 'repo1.maven.org',
    'plugins.gradle.org', 'services.gradle.org', 'downloads.gradle.org'].filter(host => text.includes(`https://${host}/`));
  const knownFiles = new Set(['build.gradle', 'settings.gradle', 'variables.gradle', 'capacitor.build.gradle',
    'genie-release.gradle', 'genie-bundle-identity.gradle']);
  const locations = [...text.matchAll(/(?:Build|Settings|Script) file '([^'\r\n]{1,1024})' line: ([1-9][0-9]{0,5})/g)]
    .map(match => ({ file: match[1].split(/[\\/]/).at(-1), line: Number(match[2]) }))
    .filter(value => knownFiles.has(value.file)).slice(0, 4);
  return {
    stage: 'native-build', exitCode: Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(result.signal) ? result.signal : null,
    spawnErrorCode: ['ENOBUFS', 'ENOMEM', 'ENOENT', 'EACCES', 'ETIMEDOUT', 'EAGAIN'].includes(result.errorCode) ? result.errorCode : null,
    reasonCodes: reasons.length ? reasons : ['UNCLASSIFIED_NATIVE_FAILURE'],
    failedTasks: [...new Set(failures)].slice(0, 4), lastTask: tasks.at(-1) ?? null,
    dependencyCoordinates: [...new Set(dependencies)].slice(0, 6), repositoryHosts: hosts,
    httpStatuses: [...new Set(httpStatuses)].slice(0, 4), locations,
    stdoutCharacters: streams[0].length, stderrCharacters: streams[1].length,
    scanTruncated: streams.some(value => value.length > scanLimit), rawOutputIncluded: false,
  };
}

function freshExportDirectory(exportDir) {
  if (typeof exportDir !== 'string' || !path.isAbsolute(exportDir) || path.normalize(exportDir) !== exportDir) return false;
  try { lstatSync(exportDir); return false; } catch (error) { if (error.code !== 'ENOENT') return false; }
  let directory = path.dirname(exportDir);
  for (;;) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
}

function sourceContext(env) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '') ||
      typeof env.GITHUB_REF !== 'string' || !env.GITHUB_REF.startsWith('refs/heads/') ||
      env.GITHUB_REF.length > 255 || /[\s\u0000-\u001f\u007f]/.test(env.GITHUB_REF) ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) return null;
  return { repository: env.GITHUB_REPOSITORY, sourceCommit: env.GITHUB_SHA, sourceRef: env.GITHUB_REF,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
}

/**
 * Creates only a local, explicitly unsigned export. It never uploads an
 * artifact, opens a keystore, fetches application configuration, or starts the
 * app. The caller supplies already approved public configuration in env.
 */
export async function runUnsignedExport({ webRoot = defaultRoot, env = process.env, exportDir,
  allowDownloads = false, run = execute, prepare = runAndroidRelease, verify = verifyAndroidRelease, log = console.log } = {}) {
  if (allowDownloads !== true) return fail('EXPLICIT_DEPENDENCY_DOWNLOAD_OPT_IN_REQUIRED');
  if (process.platform !== 'linux') return fail('LINUX_UNSIGNED_EXPORT_REQUIRED');
  if (!env || typeof env !== 'object' || signingFields.some(field => Object.hasOwn(env, field))) {
    return fail('REMOVE_SIGNING_INPUTS_FROM_UNSIGNED_EXPORT');
  }
  const resolved = resolveAndroidReleaseConfig(env);
  if (!resolved.ok) return fail('PUBLIC_RELEASE_CONFIGURATION_REQUIRED');
  const source = sourceContext(env);
  if (!source) return fail('CI_SOURCE_CONTEXT_REQUIRED');
  const { config } = resolved;
  let workspace;
  let exportCreated = false;
  let succeeded = false;
  let result;
  try {
    if (!freshExportDirectory(exportDir)) stop('FRESH_EXPORT_DIRECTORY_REQUIRED');
    const tools = Object.fromEntries(['java', 'javac', 'jarsigner', 'python3'].map(name => [name, findExecutable(name, env)]));
    if (Object.values(tools).some(value => !value)) stop('LOCAL_NATIVE_TOOLS_REQUIRED');
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    if (!sdk || !path.isAbsolute(sdk) || !regular(path.join(sdk, 'platforms/android-36/android.jar')) ||
        !regular(path.join(sdk, 'build-tools/35.0.0/aapt2'))) stop('EXISTING_ANDROID_36_AND_BUILD_TOOLS_35_REQUIRED');
    const wrapper = path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.jar');
    const properties = path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.properties');
    if (!regular(wrapper) || digest(readFileSync(wrapper)) !== wrapperDigest || !regular(properties)) stop('GRADLE_WRAPPER_IDENTITY_MISMATCH');
    const propertiesText = readFileSync(properties, 'utf8');
    const urls = propertiesText.split(/\r?\n/).filter(line => /^distributionUrl\s*[=:]/.test(line));
    const sums = propertiesText.split(/\r?\n/).filter(line => /^distributionSha256Sum\s*[=:]/.test(line));
    if (urls.length !== 1 || urls[0] !== 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip' ||
        sums.length !== 1 || sums[0] !== `distributionSha256Sum=${distributionDigest}`) stop('GRADLE_DISTRIBUTION_IDENTITY_MISMATCH');
    const releaseRoot = path.join(webRoot, '.genie-release');
    if (existsSync(releaseRoot) && (lstatSync(releaseRoot).isSymbolicLink() || !lstatSync(releaseRoot).isDirectory())) stop('UNSAFE_WORKSPACE_DIRECTORY');
    mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
    const nativeBridge = path.join(webRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js');
    if (!regular(nativeBridge)) stop('CAPACITOR_NATIVE_BRIDGE_REQUIRED');
    const libraryAssets = { 'base/assets/native-bridge.js': digest(readFileSync(nativeBridge)) };
    const buildEnv = publicBuildEnvironment(env, config);
    for (const key of ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME']) {
      if (typeof env[key] === 'string') buildEnv[key] = env[key];
    }
    buildEnv.GENIE_NODE_BINARY = process.execPath;
    const capturedRun = job => run({ ...job, capture: true });
    const java = await capturedRun({ stage: 'java-version', command: tools.javac, args: ['-version'], cwd: webRoot, env: buildEnv });
    if (java.status !== 0 || !/^javac 21(?:\.|\s|$)/m.test(java.stdout ?? '')) stop('JAVA_21_COMPILER_REQUIRED');
    log('unsigned-export: preparing a fresh Android workspace');
    const prepared = await prepare({ command: 'prepare', webRoot, env: buildEnv, run: capturedRun, log() {} });
    if (!prepared.ok) stop('FRESH_ANDROID_PREPARATION_FAILED');
    const candidate = prepared.workspace;
    if (typeof candidate !== 'string' || path.dirname(candidate) !== releaseRoot || !path.basename(candidate).startsWith('run-') ||
        !lstatSync(candidate).isDirectory() || lstatSync(candidate).isSymbolicLink()) stop('UNEXPECTED_PREPARATION_WORKSPACE');
    workspace = candidate;
    if (exportDir === workspace || exportDir.startsWith(`${workspace}${path.sep}`)) stop('FRESH_EXPORT_DIRECTORY_REQUIRED');
    const androidDir = path.join(workspace, 'android');
    if (!verify({ androidDir, env: buildEnv }).ok) stop('SOURCE_OR_ASSETS_UNCONFIRMED');
    log('unsigned-export: compiling without signing inputs');
    const build = await capturedRun({ stage: 'native-build', command: '/bin/sh',
      args: [path.join(androidDir, 'gradlew'), '--no-daemon', '--no-configuration-cache',
        '-Pandroid.builder.sdkDownload=false', '-PgenieUnsignedExport=true', '--console=plain', 'bundleRelease', 'verifyGenieBundleIdentity'],
      cwd: androidDir, env: buildEnv });
    if (build.status !== 0) {
      log('GENIE_UNSIGNED_GRADLE_FAILURE ' + JSON.stringify(unsignedBuildFailureDiagnostic(build)));
      stop('ANDROID_UNSIGNED_COMPILATION_FAILED');
    }
    const artifact = path.join(workspace, bundleRelative);
    if (!regular(artifact) || lstatSync(artifact).size === 0) stop('NEW_UNSIGNED_AAB_MISSING');
    const unsigned = await capturedRun({ stage: 'verify-unsigned', command: tools.jarsigner,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', artifact], cwd: androidDir, env: buildEnv });
    const unsignedText = unsigned.stdout ?? '';
    if (unsigned.status !== 0 || !/\bjar is unsigned\b/i.test(unsignedText) ||
        /jar verified|jar signed|signed by|invalid signature|unsigned entries/i.test(unsignedText)) stop('AAB_UNSIGNED_STATE_UNCONFIRMED');
    const identity = readVerifiedBundleIdentity({ androidDir, config });
    if (!identity.ok) stop('AAB_FINAL_MANIFEST_IDENTITY_UNCONFIRMED');
    const assets = await capturedRun(packagedAssetsCheckJob({ pythonExecutable: tools.python3, artifactPath: artifact,
      assetRoot: path.join(androidDir, 'app/src/main/assets'), libraryAssets, requireUnsigned: true, cwd: androidDir, env: buildEnv }));
    if (assets.status !== 0 || !/^AAB_ASSETS_MATCH\s*$/m.test(assets.stdout ?? '')) stop('AAB_PACKAGED_ASSETS_OR_UNSIGNED_METADATA_MISMATCH');
    if (!regular(nativeBridge) || digest(readFileSync(nativeBridge)) !== libraryAssets['base/assets/native-bridge.js']) {
      stop('CAPACITOR_NATIVE_BRIDGE_CHANGED_DURING_BUILD');
    }
    if (!verify({ androidDir, env: buildEnv }).ok) stop('SOURCE_OR_ASSETS_CHANGED_DURING_NATIVE_BUILD');
    const finalIdentity = readVerifiedBundleIdentity({ androidDir, config });
    if (!finalIdentity.ok || JSON.stringify(finalIdentity.receipt) !== JSON.stringify(identity.receipt)) stop('AAB_OR_IDENTITY_CHANGED_DURING_VERIFICATION');
    const identityBytes = readFileSync(path.join(workspace, identityRelative));
    const receipt = {
      schemaVersion: 1, status: 'unsigned-export-awaiting-local-signing', ...source,
      applicationId: identity.receipt.applicationId, versionCode: identity.receipt.versionCode, versionName: identity.receipt.versionName,
      file: bundleRelative, unsignedAabSha256: identity.receipt.sha256, manifestSha256: identity.receipt.manifestSha256,
      releaseManifestSha256: identity.receipt.releaseManifestSha256, identityReceiptSha256: digest(identityBytes),
      publicConfig: publicConfigFingerprint(config), libraryAssets,
      nativeCompilation: true, unsignedVerified: true, packagedAssetsMatch: true, finalBinaryManifestIdentityVerified: true,
      sourceSnapshotVerified: true, productionSigningKeyUsed: false, backendContacted: false, artifactUploaded: false, storeSubmission: false,
    };
    if (!freshExportDirectory(exportDir)) stop('FRESH_EXPORT_DIRECTORY_REQUIRED');
    mkdirSync(exportDir, { mode: 0o700 }); exportCreated = true;
    for (const relative of [bundleRelative, identityRelative, preparationRelative]) {
      const target = path.join(exportDir, relative);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(path.join(workspace, relative), target);
    }
    const exported = readVerifiedBundleIdentity({ androidDir: path.join(exportDir, 'android'), config });
    if (!exported.ok || JSON.stringify(exported.receipt) !== JSON.stringify(identity.receipt) ||
        digest(readFileSync(path.join(exportDir, identityRelative))) !== receipt.identityReceiptSha256) stop('EXPORTED_BYTES_CHANGED');
    // The selected export is the only retained output. Remove the temporary
    // Android workspace before writing its completion record.
    rmSync(workspace, { recursive: true }); workspace = undefined;
    const receiptPath = path.join(exportDir, resultRelative);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    succeeded = true;
    result = { ok: true, exportDir, artifactPath: path.join(exportDir, bundleRelative), receiptPath, receipt };
  } catch (error) {
    result = fail(error instanceof ExportFailure ? error.code : 'UNSIGNED_EXPORT_INCOMPLETE');
  } finally {
    let cleanupFailed = false;
    if (workspace) try { rmSync(workspace, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (exportCreated && !succeeded) try { rmSync(exportDir, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (cleanupFailed) result = fail('UNSIGNED_EXPORT_CLEANUP_INCOMPLETE');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--export-dir' || args[2] !== '--allow-dependency-downloads') {
    console.error('Unsigned export requires --export-dir <fresh absolute directory> --allow-dependency-downloads.');
    process.exitCode = 1;
  } else {
    const result = await runUnsignedExport({ exportDir: args[1], allowDownloads: true });
    if (!result.ok) { console.error(`Android unsigned export stopped: ${result.code}`); process.exitCode = 1; }
    else console.log(`Unsigned Android export verified locally: ${result.exportDir}\nLocal signing is still required. No artifact was uploaded.`);
  }
}
