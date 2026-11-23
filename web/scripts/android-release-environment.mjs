import { lstatSync, statSync, realpathSync, readdirSync, readFileSync, accessSync, constants } from 'node:fs';
import path from 'node:path';

const failure = (field, code, message) => ({ field, code, message });
const readableFile = filename => {
  try { return lstatSync(filename).isFile() && (accessSync(filename, constants.R_OK), true); } catch { return false; }
};
export function findExecutable(name, env) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const roots = [env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin') : '', ...(env.PATH ?? '').split(path.delimiter)].filter(Boolean);
  for (const directory of roots) for (const suffix of extensions) {
    const filename = path.resolve(directory, `${name}${suffix}`);
    try { if (statSync(filename).isFile()) { accessSync(filename, constants.X_OK); return realpathSync(filename); } } catch { /* Keep looking. */ }
  }
  return null;
}

// Gradle 8.14.3's installed launcher references this versioned CLI JAR in lib/.
// Check both the installation layout and the launcher's reference without running
// it. These markers are not a checksum/authenticity or successful-compilation proof.
function installedGradleExecutable(filename, expectedVersion) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/^\d+(?:\.\d+)+$/.test(expectedVersion)) return null;
  try {
    const executable = realpathSync(filename);
    if (!readableFile(executable) || path.basename(executable) !== 'gradle' || path.basename(path.dirname(executable)) !== 'bin') return null;
    accessSync(executable, constants.X_OK);
    const lib = path.join(path.dirname(path.dirname(executable)), 'lib');
    const launcher = `gradle-gradle-cli-main-${expectedVersion}.jar`;
    const launchers = readdirSync(lib).filter(name => /^gradle-gradle-cli-main-.+\.jar$/.test(name));
    if (launchers.length !== 1 || launchers[0] !== launcher || !readableFile(path.join(lib, launcher)) ||
        !readFileSync(executable, 'utf8').includes(launcher)) return null;
    return executable;
  } catch { return null; }
}

/** Read-only checks. This never runs/installs tools, downloads Gradle or opens a keystore. */
export function inspectAndroidNativeEnvironment({ webRoot, env, platform = process.platform }) {
  if (!['linux', 'darwin'].includes(platform)) {
    return { ok: false, errors: [failure('platform', 'NATIVE_PLATFORM_UNSUPPORTED',
      'Android AAB 자동 생성은 현재 Linux/macOS에서만 지원합니다. Windows 배치 파일 실행은 제공하지 않습니다.')],
    gradleExecutable: null, javacExecutable: null, jarsignerExecutable: null };
  }
  const errors = [];
  const javacExecutable = findExecutable('javac', env);
  const jarsignerExecutable = findExecutable('jarsigner', env);
  for (const tool of ['javac', 'jarsigner']) if (!(tool === 'javac' ? javacExecutable : jarsignerExecutable)) {
    errors.push(failure(tool, 'NATIVE_TOOL_MISSING', 'Android 출시 빌드용 JDK 도구가 준비되지 않았습니다.'));
  }
  let sdkVersion = '';
  let distribution = '';
  let distributionFlavor = '';
  try {
    sdkVersion = readFileSync(path.join(webRoot, 'android/variables.gradle'), 'utf8').match(/compileSdkVersion\s*=\s*(\d+)/)?.[1] ?? '';
    const configured = readFileSync(path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8').match(/gradle-([\d.]+)-(bin|all)\.zip/);
    distribution = configured?.[1] ?? '';
    distributionFlavor = configured?.[2] ?? '';
  } catch { /* The fixed diagnostics below describe the missing preparation. */ }
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  let buildToolsReady = false;
  if (sdk && path.isAbsolute(sdk)) {
    try {
      buildToolsReady = readdirSync(path.join(sdk, 'build-tools')).some(version =>
        readableFile(path.join(sdk, 'build-tools', version, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')));
    } catch { /* Not prepared. */ }
  }
  if (!sdk || !sdkVersion || !readableFile(path.join(sdk, 'platforms', `android-${sdkVersion}`, 'android.jar')) || !buildToolsReady) {
    errors.push(failure('ANDROID_HOME', 'ANDROID_SDK_MISSING', '현재 프로젝트의 Android SDK 플랫폼과 빌드 도구가 준비되지 않았습니다.'));
  }
  let gradleExecutable = null;
  const explicitGradleField = env.GENIE_GRADLE_EXECUTABLE !== undefined ? 'GENIE_GRADLE_EXECUTABLE'
    : env.GRADLE_HOME !== undefined ? 'GRADLE_HOME' : null;
  if (explicitGradleField) {
    const value = env[explicitGradleField];
    const candidate = explicitGradleField === 'GRADLE_HOME'
      ? typeof value === 'string' && path.isAbsolute(value) ? path.join(value, 'bin/gradle') : null
      : value;
    gradleExecutable = installedGradleExecutable(candidate, distribution);
    if (!gradleExecutable) errors.push(failure(explicitGradleField, 'GRADLE_INSTALLATION_MISMATCH',
      '명시한 Gradle 설치의 실행 파일과 버전 표식을 확인하지 못했습니다. 프로젝트와 같은 버전의 기존 설치가 필요하며 다른 설치나 다운로드로 전환하지 않습니다.'));
  } else {
    const gradleUserHome = env.GRADLE_USER_HOME || (env.HOME ? path.join(env.HOME, '.gradle') : '');
    if (gradleUserHome && path.isAbsolute(gradleUserHome) && distribution) {
      const parent = path.join(gradleUserHome, 'wrapper/dists', `gradle-${distribution}-${distributionFlavor}`);
      try {
        for (const folder of readdirSync(parent).sort()) {
          const candidate = path.join(parent, folder, `gradle-${distribution}`, 'bin/gradle');
          gradleExecutable = installedGradleExecutable(candidate, distribution);
          if (gradleExecutable) break;
        }
      } catch { /* No installation or download is attempted. */ }
    }
    if (!gradleExecutable) errors.push(failure('GRADLE_USER_HOME', 'GRADLE_CACHE_MISSING', '프로젝트가 지정한 Gradle 배포본이 로컬 캐시에 없습니다. 자동 다운로드는 하지 않습니다.'));
  }
  const keyPath = env.GENIE_ANDROID_KEYSTORE_PATH;
  if (typeof keyPath !== 'string' || !path.isAbsolute(keyPath) || !readableFile(keyPath) || /debug\.keystore$/i.test(keyPath)) {
    errors.push(failure('GENIE_ANDROID_KEYSTORE_PATH', 'RELEASE_KEYSTORE_MISSING', '미리보기용이 아닌 출시 서명 파일의 절대 경로가 필요합니다.'));
  }
  for (const field of ['GENIE_ANDROID_KEYSTORE_PASSWORD', 'GENIE_ANDROID_KEY_ALIAS', 'GENIE_ANDROID_KEY_PASSWORD']) {
    if (typeof env[field] !== 'string' || !env[field].trim() || (field.endsWith('ALIAS') && env[field].trim().toLowerCase() === 'androiddebugkey')) {
      errors.push(failure(field, 'RELEASE_SIGNING_MISSING', '출시 서명 환경 변수가 필요합니다. 값은 출력하거나 파일에 기록하지 않습니다.'));
    }
  }
  return { ok: errors.length === 0, errors, gradleExecutable, javacExecutable, jarsignerExecutable };
}
