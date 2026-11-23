import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { inspectAndroidNativeEnvironment } from './android-release-environment.mjs';
import { digest, includeNativePath, inventory, sourceSnapshot, writeReleaseManifest, verifyAndroidRelease } from './android-release-manifest.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problem = (field, code, message) => ({ field, code, message });
const failed = (stage, code, message) => ({ ok: false, stage, errors: [problem(stage, code, message)] });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Capacitor 8.6.2 creates these two empty files when no Cordova plugins are installed.
// They are generated additions, not an allowance to modify any web-build input.
const generatedCordovaShims = new Set(['cordova.js', 'cordova_plugins.js']);

/** Public build children never receive signing passwords or unrelated service credentials. */
export function publicBuildEnvironment(env, config) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'COMSPEC', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (typeof env[key] === 'string') result[key] = env[key];
  }
  return { ...result, NODE_ENV: 'production', CI: 'true',
    GENIE_ANDROID_APPLICATION_ID: config.applicationId, GENIE_ANDROID_VERSION_CODE: String(config.versionCode), GENIE_ANDROID_VERSION_NAME: config.versionName,
    VITE_SUPABASE_URL: config.supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, VITE_PUBLIC_APP_URL: config.publicAppUrl,
  };
}

async function execute({ command, args, cwd, env, capture = false }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    if (capture) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', () => {});
    }
    child.on('error', () => resolve({ status: 1 }));
    child.on('close', code => resolve({ status: code ?? 1, stdout }));
  });
}

function createWorkspace(webRoot) {
  const parent = path.join(webRoot, '.genie-release');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw new Error('UNSAFE_WORKSPACE');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const workspace = mkdtempSync(path.join(parent, 'run-'));
  chmodSync(workspace, 0o700);
  const originalAndroid = path.join(webRoot, 'android');
  cpSync(originalAndroid, path.join(workspace, 'android'), {
    recursive: true,
    filter: filename => {
      const relative = path.relative(originalAndroid, filename).split(path.sep).join('/');
      if (relative && !includeNativePath(relative)) return false;
      if (lstatSync(filename).isSymbolicLink()) throw new Error('NATIVE_SYMLINK');
      return true;
    },
  });
  const originalPackage = JSON.parse(readFileSync(path.join(webRoot, 'package.json'), 'utf8'));
  writeFileSync(path.join(workspace, 'package.json'), json({ name: 'genie-android-release-workspace', private: true, type: 'module',
    dependencies: originalPackage.dependencies, devDependencies: originalPackage.devDependencies, scripts: {} }));
  symlinkSync(path.join(webRoot, 'node_modules'), path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  mkdirSync(path.join(workspace, 'scripts'));
  for (const name of ['verify-android-release.mjs', 'android-release-manifest.mjs', 'android-release-config.mjs']) {
    cpSync(path.join(webRoot, 'scripts', name), path.join(workspace, 'scripts', name));
  }
  return workspace;
}

function releaseStrings(config) {
  // Validated identifier and fixed Korean label contain no XML control characters.
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n` +
    `  <string name="app_name">${config.appName}</string>\n  <string name="title_activity_main">${config.appName}</string>\n` +
    `  <string name="package_name">${config.applicationId}</string>\n  <string name="custom_url_scheme">${config.applicationId}</string>\n</resources>\n`;
}

/** prepare performs only local compilation and Android copying; bundle additionally runs offline Gradle. */
export async function runAndroidRelease({ command, webRoot = defaultRoot, env = process.env, run = execute,
  inspectNative = inspectAndroidNativeEnvironment, log = console.log }) {
  if (!['check', 'prepare', 'bundle'].includes(command)) return failed('arguments', 'UNKNOWN_COMMAND', 'check, prepare, bundle 중 하나를 사용해 주세요.');
  const resolved = resolveAndroidReleaseConfig(env);
  if (command === 'check') {
    const native = await inspectNative({ webRoot, env });
    const errors = [...(resolved.ok ? [] : resolved.errors), ...(native.ok ? [] : native.errors)];
    return errors.length ? { ok: false, stage: 'check', errors } : { ok: true };
  }
  if (!resolved.ok) return { ...resolved, stage: 'configuration' };
  let nativeTools;
  if (command === 'bundle') {
    nativeTools = await inspectNative({ webRoot, env });
    if (!nativeTools.ok) return { ok: false, errors: nativeTools.errors, stage: 'native-environment' };
    if (!nativeTools.gradleExecutable || !path.isAbsolute(nativeTools.gradleExecutable) ||
      !nativeTools.jarsignerExecutable || !path.isAbsolute(nativeTools.jarsignerExecutable)) {
      return failed('native-environment', 'NATIVE_EXECUTABLES_MISSING', '이미 설치된 Gradle과 서명 검증 도구의 경로가 필요합니다. 자동 다운로드는 하지 않습니다.');
    }
  }
  const { config } = resolved;
  let stage = 'preparation';
  let workspace;
  let manifestPath;
  try {
    const tsc = path.join(webRoot, 'node_modules/typescript/bin/tsc');
    const capacitor = path.join(webRoot, 'node_modules/@capacitor/cli/bin/capacitor');
    if (![tsc, capacitor].every(filename => existsSync(filename) && lstatSync(filename).isFile())) {
      return failed(stage, 'LOCAL_DEPENDENCIES_MISSING', '검증된 앱 의존성이 로컬에 없습니다. 자동 설치는 하지 않습니다.');
    }
    const initialSources = sourceSnapshot(webRoot);
    workspace = createWorkspace(webRoot);
    writeFileSync(path.join(workspace, 'capacitor.config.json'), json({ appId: config.applicationId, appName: config.appName, webDir: 'web', android: { path: 'android' } }));
    const childEnv = publicBuildEnvironment(env, config);
    const jobs = [
      { stage: 'typecheck', command: process.execPath, args: [tsc, '--build'], cwd: webRoot },
      { stage: 'web-build', command: process.execPath, args: [path.join(webRoot, 'scripts/android-release.mjs'), '__build-web', path.join(workspace, 'web')], cwd: webRoot },
    ];
    for (const job of jobs) {
      stage = job.stage;
      log(`${stage}: 로컬 출시 준비 실행`);
      if ((await run({ ...job, env: childEnv })).status !== 0) return failed(stage, 'LOCAL_COMMAND_FAILED', '로컬 명령이 실패하여 다음 단계로 진행하지 않았습니다.');
    }
    stage = 'web-assets';
    const builtAssets = inventory(path.join(workspace, 'web'));
    if (!builtAssets.some(entry => entry.path === 'index.html')) return failed(stage, 'WEB_ENTRY_MISSING', '새로 만든 웹 진입 파일이 없습니다.');
    if (builtAssets.some(entry => generatedCordovaShims.has(entry.path))) {
      return failed(stage, 'WEB_RESERVED_ASSET', '웹 빌드에 Android가 생성하는 예약 파일이 포함되어 있습니다. 복사 규칙을 먼저 확인해 주세요.');
    }
    stage = 'sync';
    log('sync: 별도 사본에 Android 자산 복사');
    if ((await run({ stage, command: process.execPath, args: [capacitor, 'sync', 'android'], cwd: workspace, env: childEnv })).status !== 0) {
      return failed(stage, 'ANDROID_SYNC_FAILED', 'Android 복사에 실패하여 출시 준비 기록을 만들지 않았습니다.');
    }
    const assetRoot = path.join(workspace, 'android/app/src/main/assets');
    const copiedAssets = inventory(path.join(assetRoot, 'public'));
    const generatedAssets = copiedAssets.filter(entry => generatedCordovaShims.has(entry.path));
    const copiedWebAssets = copiedAssets.filter(entry => !generatedCordovaShims.has(entry.path));
    if (generatedAssets.length !== generatedCordovaShims.size || generatedAssets.some(entry => entry.sha256 !== digest('')) ||
        !same(builtAssets, copiedWebAssets)) {
      return failed(stage, 'ANDROID_COPY_MISMATCH', '복사한 Android 자산이 새 웹 빌드와 다르거나 예상된 빈 생성 파일을 확인하지 못했습니다.');
    }
    const copied = JSON.parse(readFileSync(path.join(assetRoot, 'capacitor.config.json'), 'utf8'));
    if (copied.appId !== config.applicationId || copied.appName !== config.appName || copied.webDir !== 'web') {
      return failed(stage, 'ANDROID_IDENTITY_MISMATCH', 'Android에 복사한 앱 식별자가 출시 설정과 다릅니다.');
    }
    writeFileSync(path.join(assetRoot, 'capacitor.config.json'), json({ appId: config.applicationId, appName: config.appName, webDir: 'web' }));
    const resourceDir = path.join(workspace, 'android/app/src/release/res/values');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(path.join(resourceDir, 'genie-release.xml'), releaseStrings(config), { flag: 'wx' });
    stage = 'verification';
    manifestPath = writeReleaseManifest({ webRoot, workspace, config, initialSources });
    const verified = verifyAndroidRelease({ androidDir: path.join(workspace, 'android'), env });
    if (!verified.ok) return { ...verified, stage };
    if (command === 'prepare') return { ok: true, workspace, manifestPath };

    stage = 'bundle';
    log('bundle: 로컬 캐시를 사용하는 Android AAB 빌드');
    const androidDir = path.join(workspace, 'android');
    // --offline does not prevent Gradle Wrapper bootstrap downloads. Use the already
    // cached distribution executable directly, so a missing wrapper cache cannot fetch one.
    const gradle = nativeTools.gradleExecutable;
    const nativeEnv = { ...env, GENIE_NODE_BINARY: process.execPath };
    if ((await run({ stage, command: gradle, args: ['--offline', '--no-daemon', '--no-configuration-cache', '-Pandroid.builder.sdkDownload=false', '--console=plain', 'bundleRelease'], cwd: androidDir, env: nativeEnv })).status !== 0) {
      return failed(stage, 'ANDROID_BUNDLE_FAILED', 'Android 빌드에 실패했습니다. 이전 AAB를 완료 결과로 사용하지 않습니다.');
    }
    const artifactPath = path.join(androidDir, 'app/build/outputs/bundle/release/app-release.aab');
    if (!existsSync(artifactPath) || !lstatSync(artifactPath).isFile() || lstatSync(artifactPath).size === 0) {
      return failed(stage, 'ANDROID_BUNDLE_MISSING', '이번 작업 사본에서 생성한 AAB를 찾지 못했습니다.');
    }
    stage = 'verify-bundle';
    const signature = await run({ stage, command: nativeTools.jarsignerExecutable,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', artifactPath], cwd: androidDir, env: nativeEnv, capture: true });
    if (signature.status !== 0 || !/jar verified\./i.test(signature.stdout ?? '') || /jar is unsigned|unsigned entries|invalid signature/i.test(signature.stdout ?? '')) {
      return failed(stage, 'ANDROID_SIGNATURE_UNCONFIRMED', 'AAB 서명을 확인하지 못했습니다. 제출 가능한 파일로 표시하지 않습니다.');
    }
    writeFileSync(path.join(workspace, 'ANDROID-BUNDLE.json'), json({ status: 'created-awaiting-device-and-store-review',
      applicationId: config.applicationId, versionCode: config.versionCode, versionName: config.versionName,
      file: 'android/app/build/outputs/bundle/release/app-release.aab', sha256: digest(readFileSync(artifactPath)) }));
    return { ok: true, workspace, artifactPath, manifestPath };
  } catch {
    return failed(stage, 'LOCAL_PREPARATION_FAILED', '로컬 출시 준비를 완료하지 못했습니다. 준비 기록이나 이전 산출물을 출시 완료로 사용하지 마세요.');
  }
}

async function buildWeb(output) {
  const resolved = resolveAndroidReleaseConfig(process.env);
  if (!resolved.ok) throw new Error('CONFIGURATION_REQUIRED');
  const parent = path.join(defaultRoot, '.genie-release');
  const relative = path.relative(parent, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output)) throw new Error('FRESH_OUTPUT_REQUIRED');
  const { config } = resolved;
  const { build } = await import('vite');
  await build({ root: defaultRoot, configFile: path.join(defaultRoot, 'vite.config.ts'), envDir: false, mode: 'genie-android-release',
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(config.supabaseUrl),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(config.publishableKey),
      'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(config.publicAppUrl) },
    build: { outDir: output, emptyOutDir: false },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '__build-web') {
    try {
      if (process.argv.length !== 4 || !path.isAbsolute(process.argv[3])) throw new Error('OUTPUT_REQUIRED');
      await buildWeb(process.argv[3]);
    } catch { console.error('독립된 출시용 웹 빌드에 실패했습니다.'); process.exitCode = 1; }
  } else {
    const result = await runAndroidRelease({ command: process.argv.length === 3 ? process.argv[2] : '' });
    if (!result.ok) { for (const error of result.errors) console.error(`${error.field}: ${error.message}`); process.exitCode = 1; }
    else if (result.artifactPath) console.log(`AAB 생성 및 서명 확인 완료: ${result.artifactPath}\n실기기·스토어 검토는 별도입니다.`);
    else if (result.workspace) console.log(`Android 출시 사본 준비 완료: ${result.workspace}\nAAB 생성·서명·서버 검증 완료를 뜻하지 않습니다.`);
    else console.log('입력 형식과 로컬 빌드 준비 조건을 확인했습니다. 서버·계정·서명 유효성은 별도 검증이 필요합니다.');
  }
}
