import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream, accessSync, closeSync, cpSync, existsSync,
  lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fixture instrumentation only. No release identity, keys, backend credentials,
// SDK license acceptance, artifact upload, or production app/server is used.
export const FIXTURE_APP_ID = 'dev.local.genie.preview';
export const TEST_CLASS = FIXTURE_APP_ID + '.GenieDeviceCheck';
export const PHASES = Object.freeze({
  first: { method: 'launchBackNarrowAndPrepareDraft', cases: ['launch', 'native-back', 'narrow-screen'] },
  restore: { method: 'restoreDraftAfterHostForceStop', cases: ['draft-restore-after-force-stop'] },
});
export const EMULATOR_PIN = Object.freeze({
  revision: '37.3.10',
  url: 'https://dl.google.com/android/repository/emulator-linux_x64-16970787.zip',
  size: 350068887,
  sha256: 'a4405349d8a9c52136ab7861e5331dc40e85574bd91cb8889a298a2ff4c52e26',
  source: 'https://developer.android.com/studio/emulator_archive',
});
export const METADATA = Object.freeze({
  emulator: 'https://dl.google.com/android/repository/repository2-1.xml',
  image: 'https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-1.xml',
});
const scriptFile = fileURLToPath(import.meta.url);
const defaultWebRoot = path.resolve(path.dirname(scriptFile), '..');
const serial = 'emulator-5554';
const avdName = 'genie_fixture_api36';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => { const error = new Error(code); error.code = code; throw error; };
const regular = file => { try { return lstatSync(file).isFile(); } catch { return false; } };
const executable = file => { try { accessSync(file, constants.X_OK); return regular(file) || lstatSync(file).isSymbolicLink(); } catch { return false; } };
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function checkFixtureEnvironment(env) {
  if (Object.keys(env).some(key => key.startsWith('GENIE_ANDROID_') || key.startsWith('VITE_'))) {
    reject('REMOVE_RELEASE_AND_PUBLIC_SERVER_INPUTS_FROM_DEVICE_FIXTURE');
  }
}

/** Allowlist child environment; never inherit proxies, tokens or signing inputs. */
export function fixtureEnvironment({ workDir, sdkRoot, javaHome, nodeBinary = process.execPath }) {
  return {
    PATH: [path.dirname(nodeBinary), path.join(javaHome, 'bin'), path.join(sdkRoot, 'platform-tools'), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', CI: 'true', JAVA_HOME: javaHome,
    ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_USER_HOME: path.join(workDir, 'android-user'),
    ANDROID_EMULATOR_HOME: path.join(workDir, 'emulator-user'),
    ANDROID_AVD_HOME: path.join(workDir, 'avd'),
    GRADLE_USER_HOME: path.join(workDir, 'gradle-user'),
    NPM_CONFIG_USERCONFIG: path.join(workDir, 'npm-user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(workDir, 'npm-global.npmrc'),
    TMPDIR: path.join(workDir, 'tmp'),
  };
}

const execute = job => {
  const result = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, input: job.input,
    shell: false, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    timeout: job.timeout ?? 120_000, maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

async function checked(run, job) {
  const result = await run(job);
  if (result.status !== 0) {
    // Child environments and arguments are fixture-only. Keep compiler/emulator
    // diagnostics bounded; never print the inherited environment.
    if (result.stderr) console.error(result.stderr.slice(-10_000));
    if (result.stdout) console.error(result.stdout.slice(-10_000));
    reject(job.stage.toUpperCase().replaceAll('-', '_') + '_FAILED');
  }
  return result.stdout;
}

// Android's generated LicenseType value is bound through TrimStringAdapter
// before License.getLicenseHash hashes its UTF-8 value. Match that adapter's
// paragraph-preserving normalization, then require an exact existing accepted
// hash; never accept/write licenses. Preserve the decoded literal hash too.
// AOSP implementation and generated binding, in JetBrains' Android tools vendor:
// https://github.com/JetBrains/adt-tools-base/blob/master/repository/src/main/java/com/android/repository/impl/meta/TrimStringAdapter.java
// https://github.com/JetBrains/adt-tools-base/blob/master/repository/src/main/java/com/android/repository/impl/generated/v1/LicenseType.java
// Independently checked against official sdkmanager (EOF, no acceptance), run
// 45157021103: raw efa68a6b... normalizes to existing accepted 24333f8a... .
// ElementTree does not load external resources. Reject declarations outright,
// so neither external entities nor internal expansion can enter the parser.
const metadataParser = String.raw`
import hashlib,json,re,sys,urllib.parse,xml.etree.ElementTree as ET
kind=sys.argv[1]
raw=sys.stdin.read()
if len(raw)>20000000 or re.search(r'<!\s*(DOCTYPE|ENTITY)',raw,re.I):
 raise ValueError('UNSAFE_XML')
root=ET.fromstring(raw)
for element in root.iter():
 element.tag=element.tag.split('}')[-1]
target='emulator' if kind=='emulator' else 'system-images;android-36;google_apis;x86_64'
def revision(package):
 node=package.find('revision')
 if node is None or node.find('preview') is not None: return None
 values=[]
 for tag in ['major','minor','micro']:
  matches=node.findall(tag)
  if len(matches)>1: raise ValueError('DUPLICATE_REVISION')
  value=matches[0].text if matches else '0'
  if not value or not re.fullmatch(r'[0-9]{1,5}',value): raise ValueError('BAD_REVISION')
  values.append(int(value))
 return values
selected=[]
for package in root.findall('remotePackage'):
 if package.get('path')!=target or package.find('obsolete') is not None: continue
 channels=package.findall('channelRef')
 if len(channels)>1: raise ValueError('DUPLICATE_CHANNEL')
 if channels and channels[0].get('ref')!='channel-0': continue
 rev=revision(package)
 if rev is None or rev[0]<1: continue
 if kind=='emulator' and rev!=[37,3,10]: continue
 selected.append((package,rev))
if len(selected)!=1: raise ValueError('SINGLE_STABLE_PACKAGE_REQUIRED')
package,rev=selected[0]
if kind=='image':
 details=package.find('type-details')
 if details is None or details.findtext('api-level')!='36' or details.findtext('abi')!='x86_64' or details.findtext('tag/id')!='google_apis':
  raise ValueError('WRONG_IMAGE_TYPE')
archives=[]
for archive in package.findall('archives/archive'):
 host=archive.findtext('host-os')
 arch=archive.findtext('host-arch')
 bits=archive.findtext('host-bits')
 if host not in [None,'linux'] or arch not in [None,'x86_64'] or bits not in [None,'64']: continue
 complete=archive.find('complete')
 if complete is None: continue
 relative=complete.findtext('url','')
 if kind=='emulator' and relative!='emulator-linux_x64-16970787.zip': continue
 base='https://dl.google.com/android/repository/' if kind=='emulator' else 'https://dl.google.com/android/repository/sys-img/google_apis/'
 if not re.fullmatch(r'[A-Za-z0-9_.-]+\.zip',relative): raise ValueError('ARCHIVE_URL_NOT_FIXED_GOOGLE_PATH')
 url=urllib.parse.urljoin(base,relative)
 checksum=complete.find('checksum')
 if checksum is None: raise ValueError('MISSING_PUBLISHED_CHECKSUM')
 algorithm=checksum.get('type','sha1').lower()
 expected=checksum.text or ''
 if algorithm not in ['sha1','sha256'] or not re.fullmatch('[0-9a-f]{'+str(40 if algorithm=='sha1' else 64)+'}',expected):
  raise ValueError('INVALID_CHECKSUM')
 size=int(complete.findtext('size','0'))
 if not 1000000<=size<=4000000000: raise ValueError('INVALID_ARCHIVE_SIZE')
 archives.append(dict(url=url,size=size,checksumAlgorithm=algorithm,checksum=expected))
if len(archives)!=1: raise ValueError('SINGLE_ARCHIVE_REQUIRED')
refs=package.findall('uses-license')
if len(refs)!=1: raise ValueError('SINGLE_LICENSE_REQUIRED')
license_id=refs[0].get('ref','')
if not re.fullmatch(r'[a-z0-9-]{1,100}',license_id): raise ValueError('INVALID_LICENSE_ID')
licenses=[value for value in root.findall('license') if value.get('id')==license_id]
if len(licenses)!=1 or len(licenses[0]) or not licenses[0].text: raise ValueError('LICENSE_TEXT_MISSING')
license_literal=licenses[0].text
# Java Pattern's default \\s is ASCII. String.trim removes code points <= U+0020.
# Do not use split/join: TrimStringAdapter deliberately preserves blank lines.
license_value=re.sub(r'(?<=\s)[ \t]*','',license_literal,flags=re.ASCII)
license_value=re.sub(r'(?<!\n)\n(?!\n)',' ',license_value)
license_value=re.sub(r' +',' ',license_value).strip(''.join(chr(i) for i in range(33)))
if not license_value: raise ValueError('LICENSE_TEXT_MISSING')
result=archives[0]
result.update(package=target,revision='.'.join(str(v) for v in rev),licenseId=license_id,
 licenseSha1=hashlib.sha1(license_value.encode('utf-8')).hexdigest(),
 licenseLiteralSha1=hashlib.sha1(license_literal.encode('utf-8')).hexdigest(),
 licenseNormalization='android-TrimStringAdapter',
 metadataSha256=hashlib.sha256(raw.encode('utf-8')).hexdigest())
print(json.dumps(result))
`;

/** Interpret XML using Python's standard library; no network or SDK command. */
export function parseSdkMetadata(xml, kind) {
  if (!Object.hasOwn(METADATA, kind) || typeof xml !== 'string') reject('INVALID_METADATA_INPUT');
  const result = execute({ command: '/usr/bin/python3', args: ['-c', metadataParser, kind],
    input: xml, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 10_000 });
  if (result.status !== 0) reject('OFFICIAL_METADATA_REJECTED');
  try {
    const parsed = JSON.parse(result.stdout);
    // Hash the bytes Node actually received, including original line endings.
    parsed.metadataSha256 = digest(Buffer.from(xml, 'utf8'));
    return parsed;
  } catch { reject('OFFICIAL_METADATA_REJECTED'); }
}

export function requireAcceptedLicense(pin, sdkRoot) {
  if (!/^[a-z0-9-]{1,100}$/.test(pin.licenseId) || !/^[0-9a-f]{40}$/.test(pin.licenseSha1)) reject('INVALID_LICENSE_REFERENCE');
  const file = path.join(sdkRoot, 'licenses', pin.licenseId);
  const licenseFilePresent = regular(file);
  let readable = licenseFilePresent, acceptedHashes = [];
  if (licenseFilePresent) {
    try {
      acceptedHashes = readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /^[0-9a-f]{40}$/.test(line));
    } catch { readable = false; }
  }
  if (!acceptedHashes.includes(pin.licenseSha1)) {
    const error = new Error('SDK_LICENSE_ACCEPTANCE_REQUIRED');
    error.code = 'SDK_LICENSE_ACCEPTANCE_REQUIRED';
    // Public license fingerprints only. Do not print arbitrary file contents.
    error.licenseDiagnostic = {
      package: ['emulator', 'system-images;android-36;google_apis;x86_64'].includes(pin.package) ? pin.package : 'synthetic-test',
      licenseId: pin.licenseId, expectedSha1: pin.licenseSha1, licenseFilePresent,
      licenseFileReadable: readable, acceptedHashes: [...new Set(acceptedHashes)].slice(0, 20),
    };
    throw error;
  }
}

async function fetchMetadata(url) {
  if (!Object.values(METADATA).includes(url)) reject('METADATA_URL_NOT_ALLOWED');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) reject('OFFICIAL_METADATA_DOWNLOAD_FAILED');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 20_000_000) reject('OFFICIAL_METADATA_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function downloadArchive(pin, file, fetchImpl = fetch) {
  const url = new URL(pin.url);
  if (url.origin !== 'https://dl.google.com' || url.search || url.hash ||
      !/^\/android\/repository\/(?:sys-img\/google_apis\/)?[A-Za-z0-9_.-]+\.zip$/.test(url.pathname)) reject('ARCHIVE_URL_NOT_ALLOWED');
  const sha256 = createHash('sha256'), published = createHash(pin.checksumAlgorithm);
  let count = 0;
  const response = await fetchImpl(pin.url, { redirect: 'error', signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) reject('PINNED_ARCHIVE_DOWNLOAD_FAILED');
  const meter = new Transform({ transform(chunk, encoding, callback) {
    count += chunk.length;
    if (count > pin.size) return callback(new Error('ARCHIVE_TOO_LARGE'));
    sha256.update(chunk); published.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    const actualSha256 = sha256.digest('hex');
    if (count !== pin.size || published.digest('hex') !== pin.checksum ||
        (pin.sha256 && actualSha256 !== pin.sha256)) reject('PINNED_ARCHIVE_CHECKSUM_MISMATCH');
    return { size: count, sha256: actualSha256 };
  } catch (error) { rmSync(file, { force: true }); throw error; }
}

const unzipScript = String.raw`
import os,pathlib,stat,sys,zipfile
archive,destination,required_root=sys.argv[1:]
destination=pathlib.Path(destination)
destination.mkdir()
with zipfile.ZipFile(archive) as z:
 entries=z.infolist()
 if len(entries)>50000 or sum(e.file_size for e in entries)>12000000000: raise ValueError('ZIP_LIMIT')
 if len({e.filename for e in entries})!=len(entries): raise ValueError('DUPLICATE_ENTRY')
 links=[]
 for e in entries:
  p=pathlib.PurePosixPath(e.filename)
  if p.is_absolute() or '\\' in e.filename or '..' in p.parts or not p.parts or p.parts[0]!=required_root:
   raise ValueError('UNSAFE_ENTRY')
  mode=e.external_attr>>16
  if stat.S_ISLNK(mode): links.append(e)
  elif not e.is_dir() and not (stat.S_ISREG(mode) or mode==0 or stat.S_IFMT(mode)==0):
   raise ValueError('SPECIAL_ENTRY')
 for link in links:
  if any(e.filename.startswith(link.filename.rstrip('/')+'/') for e in entries): raise ValueError('SYMLINK_PARENT')
 for e in entries:
  if e in links: continue
  target=destination/e.filename
  if e.is_dir(): target.mkdir(parents=True,exist_ok=True); continue
  target.parent.mkdir(parents=True,exist_ok=True)
  with z.open(e) as src, target.open('xb') as dst:
   while chunk:=src.read(1024*1024): dst.write(chunk)
  os.chmod(target,0o755 if (e.external_attr>>16)&0o111 else 0o644)
 for e in links:
  target=destination/e.filename
  value=z.read(e).decode('utf-8')
  if len(value)>4096 or os.path.isabs(value) or not (target.parent/value).resolve().is_relative_to((destination/required_root).resolve()):
   raise ValueError('UNSAFE_SYMLINK')
  target.parent.mkdir(parents=True,exist_ok=True)
  os.symlink(value,target)
`;

function properties(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /^[A-Za-z]/.test(line) && line.includes('='))
    .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
}
const normalizedRevision = value => String(value).split('.').map(Number).concat([0, 0, 0]).slice(0, 3).join('.');

export function copyFixture(webRoot, destination) {
  mkdirSync(destination);
  for (const entry of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'capacitor.config.ts']) {
    const source = path.join(webRoot, entry);
    if (entry === 'public' && !existsSync(source)) continue;
    cpSync(source, path.join(destination, entry), { recursive: true, filter: file => {
      if (lstatSync(file).isSymbolicLink()) reject('SOURCE_SYMLINK_NOT_ALLOWED');
      return true;
    } });
  }
  mkdirSync(path.join(destination, 'scripts'));
  cpSync(path.join(webRoot, 'scripts/build-native-preview.mjs'), path.join(destination, 'scripts/build-native-preview.mjs'));
  const android = path.join(webRoot, 'android');
  cpSync(android, path.join(destination, 'android'), { recursive: true, filter: file => {
    const relative = path.relative(android, file).split(path.sep);
    if (relative.some(part => ['build', '.gradle', '.idea', 'assets', 'release'].includes(part))) return false;
    if (['local.properties', 'google-services.json', 'genie-release-manifest.json'].includes(path.basename(file))) return false;
    if (lstatSync(file).isSymbolicLink()) reject('ANDROID_SOURCE_SYMLINK_NOT_ALLOWED');
    return true;
  } });
  symlinkSync(realpathSync(path.join(webRoot, 'node_modules')), path.join(destination, 'node_modules'), 'dir');
}

export async function prepareDeviceCheck({ workDir, webRoot = defaultWebRoot, sdkRoot, javaHome,
  env = process.env, allowDownloads = false, run = execute } = {}) {
  checkFixtureEnvironment(env);
  if (!allowDownloads) reject('EXPLICIT_TOOL_DOWNLOAD_OPT_IN_REQUIRED');
  if (process.platform !== 'linux' || process.arch !== 'x64') reject('LINUX_X64_REQUIRED');
  if (process.version !== 'v24.22.3') reject('NODE_24_22_3_REQUIRED');
  if (!path.isAbsolute(workDir ?? '') || existsSync(workDir) || lstatSync(path.dirname(workDir)).isSymbolicLink()) reject('NEW_ABSOLUTE_WORK_DIRECTORY_REQUIRED');
  if (!existsSync('/dev/kvm') || !lstatSync('/dev/kvm').isCharacterDevice()) reject('KVM_REQUIRED_NO_SOFTWARE_FALLBACK');
  try { accessSync('/dev/kvm', constants.R_OK | constants.W_OK); } catch { reject('KVM_ACCESS_REQUIRED'); }
  if (![sdkRoot, javaHome].every(value => typeof value === 'string' && path.isAbsolute(value))) reject('EXISTING_SDK_AND_JDK_REQUIRED');
  if (!executable(path.join(javaHome, 'bin/javac')) || !regular(path.join(sdkRoot, 'platforms/android-36/android.jar')) ||
      !executable(path.join(sdkRoot, 'build-tools/35.0.0/aapt')) || !executable(path.join(sdkRoot, 'platform-tools/adb'))) reject('EXISTING_ANDROID_36_JAVA_21_TOOLS_REQUIRED');
  const wrapper = path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.jar');
  if (!regular(wrapper) || digest(readFileSync(wrapper)) !== '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172') reject('GRADLE_WRAPPER_MISMATCH');
  const wrapperProps = properties(path.join(webRoot, 'android/gradle/wrapper/gradle-wrapper.properties'));
  if (wrapperProps.distributionSha256Sum !== 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c' ||
      wrapperProps.distributionUrl !== 'https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip') reject('GRADLE_DISTRIBUTION_MISMATCH');
  mkdirSync(workDir, { mode: 0o700 });
  for (const dir of ['android-user', 'emulator-user', 'avd', 'tmp', 'downloads', 'sdk']) mkdirSync(path.join(workDir, dir), { mode: 0o700 });
  // adb remains the runner's existing tool. This read-only SDK link lets the
  // emulator discover it without copying/installing another platform-tools set.
  symlinkSync(path.join(sdkRoot, 'platform-tools'), path.join(workDir, 'sdk/platform-tools'), 'dir');
  const buildEnv = fixtureEnvironment({ workDir, sdkRoot, javaHome });
  const javac = await checked(run, { stage: 'java-version', command: path.join(javaHome, 'bin/javac'), args: ['-version'], env: buildEnv });
  if (!/^javac 21(?:\.|\s|$)/.test(javac.trim())) reject('JAVA_21_REQUIRED');

  // Resolve the official image once, before any binary download. This is a
  // per-run pin, not a claim that its revision was known before this run.
  const sourceXml = await Promise.all(Object.values(METADATA).map(fetchMetadata));
  const emulator = parseSdkMetadata(sourceXml[0], 'emulator');
  const image = parseSdkMetadata(sourceXml[1], 'image');
  if (emulator.url !== EMULATOR_PIN.url || emulator.size !== EMULATOR_PIN.size ||
      normalizedRevision(emulator.revision) !== normalizedRevision(EMULATOR_PIN.revision)) reject('OFFICIAL_EMULATOR_PIN_CHANGED');
  Object.assign(emulator, { sha256: EMULATOR_PIN.sha256, archiveSource: EMULATOR_PIN.source, metadataSource: METADATA.emulator });
  Object.assign(image, { metadataSource: METADATA.image });
  const pins = { schemaVersion: 1, resolvedAt: new Date().toISOString(), imagePinScope: 'resolved-once-from-official-metadata-for-this-run', emulator, image };
  save(path.join(workDir, 'download-pins.json'), pins);
  console.log('Official per-run download pins: ' + JSON.stringify(pins));
  try {
    for (const pin of [emulator, image]) requireAcceptedLicense(pin, sdkRoot);
  } catch (error) {
    if (error.code === 'SDK_LICENSE_ACCEPTANCE_REQUIRED') {
      save(path.join(workDir, 'result.json'), {
        schemaVersion: 1, status: 'blocked-before-binary-download-license-not-accepted',
        sourceCommit: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
        failureCode: error.code, licenseDiagnostic: error.licenseDiagnostic, pins,
        fixtureOnly: true, allFourCasesPassed: false, cases: [],
        binariesDownloaded: false, physicalDeviceTested: false, signedReleaseNotTested: true,
      });
    }
    throw error;
  }
  for (const [kind, pin] of Object.entries({ emulator, image })) {
    const archive = path.join(workDir, 'downloads', kind + '.zip');
    pin.actualArchive = await downloadArchive(pin, archive);
    const extracted = path.join(workDir, kind + '-unpacked');
    await checked(run, { stage: kind + '-extract', command: '/usr/bin/python3',
      args: ['-c', unzipScript, archive, extracted, kind === 'emulator' ? 'emulator' : 'x86_64'], env: buildEnv, timeout: 120_000 });
    const source = path.join(extracted, kind === 'emulator' ? 'emulator' : 'x86_64');
    const props = properties(path.join(source, 'source.properties'));
    if (normalizedRevision(props['Pkg.Revision']) !== normalizedRevision(pin.revision)) reject('EXTRACTED_PACKAGE_REVISION_MISMATCH');
    if (kind === 'image' && (props['AndroidVersion.ApiLevel'] !== '36' || props['SystemImage.Abi'] !== 'x86_64' || props['SystemImage.TagId'] !== 'google_apis')) reject('EXTRACTED_IMAGE_IDENTITY_MISMATCH');
    const target = kind === 'emulator' ? path.join(workDir, 'sdk/emulator') : path.join(workDir, 'sdk/system-images/android-36/google_apis/x86_64');
    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(source, target);
    rmSync(extracted, { recursive: true });
    rmSync(archive); // avoid retaining a second multi-GB copy on the small runner
  }
  save(path.join(workDir, 'verified-downloads.json'), pins);

  const fixture = path.join(workDir, 'fixture');
  copyFixture(webRoot, fixture);
  await checked(run, { stage: 'preview-build', command: 'npm', args: ['run', 'native:preview'], cwd: fixture, env: buildEnv, timeout: 180_000 });
  await checked(run, { stage: 'android-sync', command: process.execPath,
    args: [path.join(fixture, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], cwd: fixture, env: buildEnv, timeout: 120_000 });
  const nativeConfig = json(path.join(fixture, 'android/app/src/main/assets/capacitor.config.json'));
  if (nativeConfig.appId !== FIXTURE_APP_ID || nativeConfig.server?.url) reject('REMOTE_OR_NONFIXTURE_CAPACITOR_CONFIG');
  const assets = path.join(fixture, 'android/app/src/main/assets/public/assets');
  const javascript = readdirSync(assets).filter(file => file.endsWith('.js')).map(file => readFileSync(path.join(assets, file), 'utf8')).join('\n');
  if (!javascript.includes('https://genie-test.invalid') || !javascript.includes('test-publishable')) reject('NATIVE_PREVIEW_FIXTURE_NOT_CONFIRMED');
  const androidDir = path.join(fixture, 'android');
  await checked(run, { stage: 'debug-apk-build', command: '/bin/sh', args: [path.join(androidDir, 'gradlew'),
    '--no-daemon', '--no-configuration-cache', '-Pandroid.builder.sdkDownload=false', '--console=plain',
    ':app:assembleDebug', ':app:assembleDebugAndroidTest'], cwd: androidDir, env: buildEnv, timeout: 900_000 });
  const apk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
  const testApk = path.join(androidDir, 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
  if (![apk, testApk].every(file => regular(file) && lstatSync(file).size > 0)) reject('NEW_DEBUG_APKS_MISSING');
  const aapt = path.join(sdkRoot, 'build-tools/35.0.0/aapt');
  for (const [file, expected] of [[apk, FIXTURE_APP_ID], [testApk, FIXTURE_APP_ID + '.test']]) {
    const badging = await checked(run, { stage: 'apk-identity', command: aapt, args: ['dump', 'badging', file], env: buildEnv });
    if (!badging.includes("package: name='" + expected + "'") || (file === apk && !/^application-debuggable$/m.test(badging))) reject('FIXTURE_APK_IDENTITY_UNCONFIRMED');
  }
  const prepared = {
    schemaVersion: 1, status: 'fixture-prepared-device-not-yet-tested', workDir, sdkRoot, javaHome,
    nodeBinary: process.execPath, scriptFile, apk, testApk,
    apkSha256: digest(readFileSync(apk)), testApkSha256: digest(readFileSync(testApk)),
    sourceCommit: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    node: process.version, javac: javac.trim(), pins,
    fixtureOnly: true, physicalDeviceTested: false, signedReleaseNotTested: true,
  };
  save(path.join(workDir, 'prepared.json'), prepared);
  console.log('Fixture APKs prepared; device checks have not run.');
  return prepared;
}

export function validateNamespace({ parent, current, links, routes }) {
  if (!/^net:\[\d+\]$/.test(parent ?? '') || parent === current || !/^net:\[\d+\]$/.test(current ?? '')) reject('NEW_NETWORK_NAMESPACE_REQUIRED');
  if (!Array.isArray(links) || links.length !== 1 || links[0].ifname !== 'lo' ||
      !Array.isArray(routes) || routes.some(route => route.dev !== 'lo')) reject('LOOPBACK_ONLY_NETWORK_REQUIRED');
}

export function instrumentationArgs(phase) {
  if (!Object.hasOwn(PHASES, phase)) reject('UNKNOWN_INSTRUMENTATION_PHASE');
  return ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
    TEST_CLASS + '#' + PHASES[phase].method, FIXTURE_APP_ID + '.test/androidx.test.runner.AndroidJUnitRunner'];
}

export function parseInstrumentation(result, phase) {
  const expected = PHASES[phase]?.cases;
  if (!expected) reject('UNKNOWN_INSTRUMENTATION_PHASE');
  const output = result.stdout ?? '';
  if (result.status !== 0 || !/^OK \(1 test\)\s*$/m.test(output) || !/^INSTRUMENTATION_CODE: -1\s*$/m.test(output) ||
      /^INSTRUMENTATION_STATUS_CODE: -[0-9]+/m.test(output) ||
      /FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|Process crashed|shortMsg=/.test(output)) reject('INSTRUMENTATION_DID_NOT_PASS');
  const reports = [];
  for (const line of output.split(/\r?\n/)) {
    const start = line.indexOf('GENIE_DEVICE_CASE ');
    if (start < 0) continue;
    try { reports.push(JSON.parse(line.slice(start + 'GENIE_DEVICE_CASE '.length))); } catch { reject('MALFORMED_DEVICE_CASE_REPORT'); }
  }
  if (reports.length !== expected.length || reports.some(report => report.passed !== true || !expected.includes(report.caseId)) ||
      new Set(reports.map(report => report.caseId)).size !== expected.length) reject('MISSING_OR_DUPLICATE_DEVICE_CASE');
  if (phase === 'first' && !output.includes('GENIE_DRAFT_PREPARED')) reject('DRAFT_PREPARATION_NOT_CONFIRMED');
  return reports;
}

function preparedAt(workDir) {
  if (!path.isAbsolute(workDir ?? '') || lstatSync(workDir).isSymbolicLink() || !regular(path.join(workDir, 'prepared.json'))) reject('PREPARED_FIXTURE_REQUIRED');
  const prepared = json(path.join(workDir, 'prepared.json'));
  if (prepared.schemaVersion !== 1 || prepared.workDir !== workDir || prepared.fixtureOnly !== true ||
      prepared.signedReleaseNotTested !== true || prepared.nodeBinary !== process.execPath || prepared.scriptFile !== scriptFile) reject('PREPARED_FIXTURE_INVALID');
  for (const [file, hash] of [[prepared.apk, prepared.apkSha256], [prepared.testApk, prepared.testApkSha256]]) {
    if (typeof file !== 'string' || !file.startsWith(workDir + path.sep) || !regular(file) || digest(readFileSync(file)) !== hash) reject('PREPARED_APK_CHANGED');
  }
  return prepared;
}

/** Parent starts only a fresh network namespace; runtime drops root before tools. */
export async function isolateDeviceCheck(workDir, env = process.env, run = execute) {
  checkFixtureEnvironment(env);
  const prepared = preparedAt(workDir);
  if (process.getuid() === 0) reject('START_ISOLATION_AS_RUNNER_USER');
  const child = fixtureEnvironment({ workDir, sdkRoot: prepared.sdkRoot, javaHome: prepared.javaHome });
  const parent = readlinkSync('/proc/self/ns/net');
  const result = await run({ stage: 'isolated-runtime', command: '/usr/bin/sudo', args: [
    '-n', '/usr/bin/unshare', '--net', '--', '/usr/bin/env', '-i',
    ...Object.entries(child).map(([key, value]) => key + '=' + value),
    'GENIE_DEVICE_PARENT_NETNS=' + parent, 'GENIE_DEVICE_OWNER_UID=' + process.getuid(),
    'GENIE_DEVICE_OWNER_GID=' + process.getgid(), process.execPath, scriptFile, 'runtime-root', '--work-dir', workDir,
  ], env: child, timeout: 600_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) reject('ISOLATED_DEVICE_CHECK_FAILED');
}

async function enterRuntimeAsOwner(workDir) {
  if (process.getuid() !== 0 || !/^[1-9][0-9]*$/.test(process.env.GENIE_DEVICE_OWNER_UID ?? '') ||
      !/^[1-9][0-9]*$/.test(process.env.GENIE_DEVICE_OWNER_GID ?? '')) reject('ISOLATED_OWNER_REQUIRED');
  const parent = process.env.GENIE_DEVICE_PARENT_NETNS;
  if (parent === readlinkSync('/proc/self/ns/net')) reject('NEW_NETWORK_NAMESPACE_REQUIRED');
  await checked(execute, { stage: 'loopback-enable', command: '/usr/sbin/ip', args: ['link', 'set', 'dev', 'lo', 'up'],
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } });
  const prepared = preparedAt(workDir);
  const child = fixtureEnvironment({ workDir, sdkRoot: prepared.sdkRoot, javaHome: prepared.javaHome });
  const result = execute({ command: '/usr/bin/setpriv', args: [
    '--reuid=' + process.env.GENIE_DEVICE_OWNER_UID, '--regid=' + process.env.GENIE_DEVICE_OWNER_GID, '--init-groups',
    '/usr/bin/env', '-i', ...Object.entries(child).map(([key, value]) => key + '=' + value),
    'GENIE_DEVICE_PARENT_NETNS=' + parent, process.execPath, scriptFile, 'runtime', '--work-dir', workDir,
  ], env: child, timeout: 540_000 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  if (result.status !== 0) reject('DEVICE_RUNTIME_FAILED');
}

export async function runDeviceCheck(workDir, env = process.env, run = execute) {
  checkFixtureEnvironment(env);
  if (process.getuid() === 0) reject('DEVICE_RUNTIME_MUST_NOT_BE_ROOT');
  const prepared = preparedAt(workDir);
  const child = fixtureEnvironment({ workDir, sdkRoot: path.join(workDir, 'sdk'), javaHome: prepared.javaHome });
  const network = async args => JSON.parse(await checked(run, { stage: 'namespace-inspection',
    command: '/usr/sbin/ip', args, env: child }));
  const links = await network(['-j', 'link', 'show']);
  const routes = (await network(['-j', 'route', 'show', 'table', 'all'])).concat(await network(['-j', '-6', 'route', 'show', 'table', 'all']));
  validateNamespace({ parent: env.GENIE_DEVICE_PARENT_NETNS, current: readlinkSync('/proc/self/ns/net'), links, routes });
  if (existsSync(path.join(workDir, 'result.json'))) reject('PREVIOUS_DEVICE_RECEIPT_EXISTS');
  const emulatorBinary = path.join(workDir, 'sdk/emulator/emulator');
  const adbBinary = path.join(prepared.sdkRoot, 'platform-tools/adb');
  const adb = (args, timeout = 60_000) => run({ stage: 'adb', command: adbBinary, args, env: child, timeout });
  const mustAdb = async (args, timeout) => {
    const result = await adb(args, timeout);
    if (result.status !== 0) {
      if (result.stdout) console.error(result.stdout.slice(-5_000));
      if (result.stderr) console.error(result.stderr.slice(-5_000));
      reject('ADB_COMMAND_FAILED');
    }
    return result.stdout;
  };
  let emulator; let logFd; const cases = [];
  const receipt = {
    schemaVersion: 1, status: 'device-check-failed', sourceCommit: prepared.sourceCommit,
    fixtureOnly: true, applicationId: FIXTURE_APP_ID, debugApkSha256: prepared.apkSha256,
    instrumentationApkSha256: prepared.testApkSha256, signedReleaseNotTested: true,
    physicalDeviceTested: false, backendContacted: false, externalNetwork: 'blocked-by-loopback-only-network-namespace',
    emulator: prepared.pins.emulator, image: prepared.pins.image, node: prepared.node, javac: prepared.javac,
    forceStopConfirmed: false, cases, allFourCasesPassed: false,
  };
  let failure;
  try {
    const acceleration = await checked(run, { stage: 'kvm-check', command: emulatorBinary, args: ['-accel-check'], env: child });
    if (!/\bKVM\b/i.test(acceleration) || !/usable|installed/i.test(acceleration)) reject('KVM_ACCELERATION_NOT_CONFIRMED');
    receipt.emulatorVersionOutput = (await checked(run, { stage: 'emulator-version', command: emulatorBinary, args: ['-version'], env: child })).split('\n')[0];
    const avd = path.join(workDir, 'avd', avdName + '.avd');
    mkdirSync(avd);
    writeFileSync(path.join(workDir, 'avd', avdName + '.ini'),
      'avd.ini.encoding=UTF-8\npath=' + avd + '\ntarget=android-36\n', { flag: 'wx' });
    writeFileSync(path.join(avd, 'config.ini'), [
      'AvdId=' + avdName, 'avd.ini.encoding=UTF-8', 'abi.type=x86_64', 'hw.cpu.arch=x86_64',
      'hw.cpu.ncore=2', 'hw.ramSize=2048', 'vm.heapSize=256', 'hw.lcd.width=640', 'hw.lcd.height=1280',
      'hw.lcd.density=320', 'hw.keyboard=yes', 'hw.audioInput=no', 'hw.gpu.enabled=yes', 'hw.gpu.mode=swiftshader',
      'disk.dataPartition.size=2G', 'image.sysdir.1=system-images/android-36/google_apis/x86_64/',
      'tag.id=google_apis', 'tag.display=Google APIs', 'target=android-36', 'PlayStore.enabled=false',
      'skin.name=640x1280', 'skin.path=640x1280', 'showDeviceFrame=no',
      'fastboot.forceColdBoot=yes', 'fastboot.forceFastBoot=no', '',
    ].join('\n'), { flag: 'wx' });
    await mustAdb(['start-server']);
    logFd = openSync(path.join(workDir, 'emulator.log'), 'wx', 0o600);
    emulator = spawn(emulatorBinary, ['-avd', avdName, '-port', '5554', '-accel', 'on', '-no-window',
      '-no-snapshot', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader', '-memory', '2048', '-cores', '2',
      '-no-metrics'], { env: child, stdio: ['ignore', logFd, logFd] });
    let emulatorError = false;
    emulator.on('error', () => { emulatorError = true; });
    const deadline = Date.now() + 180_000;
    let booted = false;
    while (Date.now() < deadline) {
      if (emulatorError || emulator.exitCode !== null) reject('EMULATOR_EXITED_BEFORE_BOOT');
      const boot = await adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], 5_000);
      if (boot.status === 0 && boot.stdout.trim() === '1') { booted = true; break; }
      await pause(1_000);
    }
    if (!booted) reject('EMULATOR_BOOT_TIMEOUT');
    if ((await mustAdb(['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'])).trim() !== '1' ||
        (await mustAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'])).trim() !== '36') reject('EXPECTED_API36_EMULATOR_REQUIRED');
    await mustAdb(['-s', serial, 'shell', 'wm', 'size', '640x1280']);
    await mustAdb(['-s', serial, 'shell', 'wm', 'density', '320']);
    await mustAdb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    await mustAdb(['-s', serial, 'shell', 'wm', 'dismiss-keyguard']);
    for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
      await mustAdb(['-s', serial, 'shell', 'settings', 'put', 'global', setting, '0']);
    }
    await mustAdb(['-s', serial, 'install', prepared.apk]);
    await mustAdb(['-s', serial, 'install', prepared.testApk]);
    const first = await adb(instrumentationArgs('first'), 120_000);
    writeFileSync(path.join(workDir, 'phase-first.log'), first.stdout, { flag: 'wx', mode: 0o600 });
    cases.push(...parseInstrumentation(first, 'first'));
    // The first runner may finish its app process. Launch it once before the
    // explicit host force-stop so we prove a running app is actually stopped.
    await mustAdb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', FIXTURE_APP_ID + '/' + FIXTURE_APP_ID + '.MainActivity']);
    const pidBefore = (await mustAdb(['-s', serial, 'shell', 'pidof', FIXTURE_APP_ID])).trim();
    if (!/^\d+(?: \d+)*$/.test(pidBefore)) reject('APP_NOT_RUNNING_BEFORE_FORCE_STOP');
    await mustAdb(['-s', serial, 'shell', 'am', 'force-stop', FIXTURE_APP_ID]);
    const remaining = await adb(['-s', serial, 'shell', 'pidof', FIXTURE_APP_ID]);
    if (remaining.status !== 1 || remaining.stdout.trim() || remaining.stderr?.trim()) reject('APP_FORCE_STOP_NOT_CONFIRMED');
    receipt.forceStopConfirmed = true;
    const restored = await adb(instrumentationArgs('restore'), 120_000);
    writeFileSync(path.join(workDir, 'phase-restore.log'), restored.stdout, { flag: 'wx', mode: 0o600 });
    cases.push(...parseInstrumentation(restored, 'restore'));
    receipt.allFourCasesPassed = cases.length === 4 && receipt.forceStopConfirmed;
    receipt.status = 'four-android-emulator-fixture-cases-passed-not-a-release';
  } catch (error) {
    failure = error;
    receipt.failureCode = /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'DEVICE_CHECK_FAILED';
    for (const file of ['phase-first.log', 'phase-restore.log', 'emulator.log']) {
      const logFile = path.join(workDir, file);
      if (regular(logFile)) console.error(file + '\n' + readFileSync(logFile, 'utf8').slice(-10_000));
    }
  } finally {
    if (emulator) {
      await adb(['-s', serial, 'emu', 'kill'], 5_000);
      if (emulator.exitCode === null) emulator.kill('SIGTERM');
      for (let i = 0; i < 20 && emulator.exitCode === null; i++) await pause(100);
      if (emulator.exitCode === null) emulator.kill('SIGKILL');
    }
    await adb(['kill-server'], 5_000);
    if (logFd !== undefined) closeSync(logFd);
    for (const owned of ['avd', 'android-user', 'emulator-user']) rmSync(path.join(workDir, owned), { recursive: true, force: true });
    receipt.disposableAvdAndDebugKeyRemoved = true;
    save(path.join(workDir, 'result.json'), receipt);
    console.log(JSON.stringify(receipt, null, 2));
  }
  if (failure) throw failure;
  return receipt;
}

function argsOf(argv) {
  const command = argv.shift();
  const options = {};
  while (argv.length) {
    const key = argv.shift();
    if (key === '--allow-tool-downloads') options.allowDownloads = true;
    else if (['--work-dir', '--sdk-root', '--java-home'].includes(key) && argv.length) options[key.slice(2)] = argv.shift();
    else reject('UNKNOWN_DEVICE_CHECK_ARGUMENT');
  }
  return { command, workDir: options['work-dir'], sdkRoot: options['sdk-root'], javaHome: options['java-home'], allowDownloads: options.allowDownloads };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = argsOf(process.argv.slice(2));
    if (options.command === 'prepare') await prepareDeviceCheck(options);
    else if (options.command === 'isolate') await isolateDeviceCheck(options.workDir);
    else if (options.command === 'runtime-root') await enterRuntimeAsOwner(options.workDir);
    else if (options.command === 'runtime') await runDeviceCheck(options.workDir);
    else reject('EXPECTED_PREPARE_OR_ISOLATE_COMMAND');
  } catch (error) {
    if (error.code === 'SDK_LICENSE_ACCEPTANCE_REQUIRED' && error.licenseDiagnostic) {
      console.error('SDK_LICENSE_DIAGNOSTIC ' + JSON.stringify(error.licenseDiagnostic));
    }
    console.error(/^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'ANDROID_DEVICE_CHECK_FAILED');
    process.exitCode = 1;
  }
}
