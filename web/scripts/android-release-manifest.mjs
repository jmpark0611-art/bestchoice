import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
const ignoredNames = new Set(['node_modules', '.git', '.gradle', '.idea', 'build', 'local.properties', 'genie-release-manifest.json']);
const privateFile = name => /\.(?:jks|keystore|p12|pfx)$/i.test(name) || /^\.env(?:\.|$)/.test(name);
export const includeNativePath = relative => !relative.split('/').some(part => ignoredNames.has(part) || privateFile(part)) &&
  relative !== 'app/src/main/assets' && !relative.startsWith('app/src/main/assets/');

/** Deterministic inventories reject symlinks instead of following files outside the source tree. */
export function inventory(directory, filter = () => true) {
  const entries = [];
  const visit = relative => {
    if (relative && !filter(relative)) return;
    const absolute = path.join(directory, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) entries.push({ path: relative, sha256: digest(readFileSync(absolute)) });
    else throw new Error('NON_REGULAR_FILE');
  };
  visit('');
  return entries;
}

export function sourceSnapshot(webRoot) {
  const files = ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'capacitor.config.ts'];
  const result = files.map(name => {
    const stat = lstatSync(path.join(webRoot, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SOURCE_FILE_REQUIRED');
    return { path: name, sha256: digest(readFileSync(path.join(webRoot, name))) };
  });
  for (const directory of ['src', 'scripts', 'public', 'android']) {
    const full = path.join(webRoot, directory);
    if (!existsSync(full)) continue;
    const filter = directory === 'android' ? includeNativePath : relative => !relative.split('/').some(privateFile);
    for (const entry of inventory(full, filter)) result.push({ ...entry, path: `${directory}/${entry.path}` });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export function publicConfigFingerprint(config) {
  return { supabaseUrl: config.supabaseUrl, publicAppUrl: config.publicAppUrl, publishableKeySha256: digest(config.publishableKey) };
}

export function writeReleaseManifest({ webRoot, workspace, config, initialSources }) {
  const current = sourceSnapshot(webRoot);
  if (JSON.stringify(current) !== JSON.stringify(initialSources)) throw new Error('SOURCE_CHANGED_DURING_BUILD');
  const androidDir = path.join(workspace, 'android');
  const manifest = {
    schemaVersion: 1, profile: 'android-release', status: 'prepared-not-native-validated',
    applicationId: config.applicationId, appName: config.appName, versionCode: config.versionCode, versionName: config.versionName,
    sourceRoot: realpathSync(webRoot), sourceFiles: current,
    publicConfig: publicConfigFingerprint(config),
    assets: inventory(path.join(androidDir, 'app/src/main/assets')),
    nativeFiles: inventory(androidDir, includeNativePath),
    verifierFiles: inventory(path.join(workspace, 'scripts')),
    preparedAt: new Date().toISOString(),
  };
  const manifestPath = path.join(androidDir, 'genie-release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return manifestPath;
}

const issue = (code, message) => ({ field: 'release-assets', code, message });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** This proves local identity/integrity, not server reachability, account ownership or signing. */
export function verifyAndroidRelease({ androidDir, env }) {
  const resolved = resolveAndroidReleaseConfig(env);
  if (!resolved.ok) return resolved;
  const { config } = resolved;
  try {
    if (lstatSync(androidDir).isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
    const proofPath = path.join(androidDir, 'genie-release-manifest.json');
    const proofStat = lstatSync(proofPath);
    if (!proofStat.isFile() || proofStat.isSymbolicLink()) throw new Error('MANIFEST_FILE_REQUIRED');
    const manifest = JSON.parse(readFileSync(proofPath, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.profile !== 'android-release' || manifest.status !== 'prepared-not-native-validated' ||
      manifest.applicationId !== config.applicationId || manifest.appName !== config.appName ||
      manifest.versionCode !== config.versionCode || manifest.versionName !== config.versionName ||
      !same(manifest.publicConfig, publicConfigFingerprint(config))) {
      return { ok: false, errors: [issue('RELEASE_CONFIG_MISMATCH', '출시 설정과 준비된 Android 사본이 일치하지 않습니다. 새로 준비해 주세요.')] };
    }
    if (typeof manifest.sourceRoot !== 'string' || !path.isAbsolute(manifest.sourceRoot) ||
      !same(manifest.sourceFiles, sourceSnapshot(manifest.sourceRoot))) {
      return { ok: false, errors: [issue('RELEASE_SOURCE_CHANGED', '출시 준비 뒤 소스가 바뀌었습니다. 새 사본을 만들어 주세요.')] };
    }
    const assetDir = path.join(androidDir, 'app/src/main/assets');
    if (!same(manifest.assets, inventory(assetDir)) || !same(manifest.nativeFiles, inventory(androidDir, includeNativePath)) ||
      !same(manifest.verifierFiles, inventory(path.join(androidDir, '../scripts')))) {
      return { ok: false, errors: [issue('RELEASE_FILES_CHANGED', '출시 파일이 누락되거나 바뀌었습니다. 기존 산출물을 재사용할 수 없습니다.')] };
    }
    const runtimeConfig = JSON.parse(readFileSync(path.join(assetDir, 'capacitor.config.json'), 'utf8'));
    if (!same(runtimeConfig, { appId: config.applicationId, appName: config.appName, webDir: 'web' })) {
      return { ok: false, errors: [issue('RELEASE_RUNTIME_CONFIG', 'Android에 복사된 앱 설정이 출시 설정과 일치하지 않습니다.')] };
    }
    const assets = manifest.assets;
    if (!assets.some(entry => entry.path === 'public/index.html') || !assets.some(entry => entry.path === 'capacitor.plugins.json')) {
      return { ok: false, errors: [issue('RELEASE_ASSETS_MISSING', '필수 Android 웹 자산이 없습니다.')] };
    }
    const javascript = assets.filter(entry => entry.path.startsWith('public/') && entry.path.endsWith('.js'))
      .map(entry => readFileSync(path.join(assetDir, entry.path), 'utf8')).join('\n');
    if (!javascript || ![config.supabaseUrl, config.publishableKey, config.publicAppUrl].every(value => javascript.includes(value))) {
      return { ok: false, errors: [issue('RELEASE_CONFIG_NOT_EMBEDDED', '출시용 공개 설정이 실제 웹 번들에 반영됐는지 확인하지 못했습니다.')] };
    }
    const text = assets.filter(entry => /\.(?:js|json|html|css)$/i.test(entry.path))
      .map(entry => readFileSync(path.join(assetDir, entry.path), 'utf8')).join('\n');
    if (text.includes('genie-test.invalid') || text.includes('test-publishable') ||
      /sb_secret_[A-Za-z0-9_-]{16,}|sk(?:-proj-|-|_live_|_test_)[A-Za-z0-9_-]{16,}/.test(text)) {
      return { ok: false, errors: [issue('RELEASE_UNSAFE_ASSET', '미리보기 설정 또는 비공개 키 형태가 자산에서 발견되어 중단합니다.')] };
    }
    return { ok: true, manifestPath: path.join(androidDir, 'genie-release-manifest.json') };
  } catch {
    return { ok: false, errors: [issue('RELEASE_PROOF_UNREADABLE', '출시 준비 기록과 파일을 확인하지 못했습니다. 새로 준비해 주세요.')] };
  }
}
