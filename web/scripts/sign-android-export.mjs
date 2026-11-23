import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { findExecutable } from './android-release-environment.mjs';
import { digest, publicConfigFingerprint, sourceSnapshot } from './android-release-manifest.mjs';
import { readVerifiedBundleIdentity } from './android-bundle-identity.mjs';
import { packagedAssetsCheckJob } from './android-packaged-assets.mjs';

const bundlePath = 'android/app/build/outputs/bundle/release/app-release.aab';
const identityPath = 'android/app/build/outputs/bundle/release/genie-bundle-identity.json';
const preparationPath = 'android/genie-release-manifest.json';
const exportReceiptPath = 'unsigned-export.json';
const maxArchive = 256 * 1024 * 1024;
const approvedRepository = 'jmpark0611-art/bestchoice';
const approvedSourceRef = 'refs/heads/codex/genie-android-native-check-20261123';
const hashPattern = /^[a-f0-9]{64}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = code => ({ ok: false, code });
class SigningFailure extends Error { constructor(code) { super(code); this.code = code; } }
const stop = code => { throw new SigningFailure(code); };
const execute = job => {
  const result = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

const extractProgram = String.raw`import os,pathlib,stat,sys,zipfile
archive,destination=sys.argv[1:]
limits={"android/app/build/outputs/bundle/release/app-release.aab":256*1024*1024,"android/app/build/outputs/bundle/release/genie-bundle-identity.json":16384,"android/genie-release-manifest.json":16*1024*1024,"unsigned-export.json":16384}
directories={str(p)+"/" for n in limits for p in pathlib.PurePosixPath(n).parents if str(p)!="."}
try:
 with zipfile.ZipFile(archive) as z:
  entries=z.infolist()
  if len(entries)>len(limits)+len(directories): raise ValueError()
  names=[i.filename for i in entries]
  if len(names)!=len(set(names)): raise ValueError()
  files=set()
  for i in entries:
   n=i.filename
   mode=i.external_attr>>16
   if i.orig_filename!=n or "\\" in n or any(ord(c)<32 or ord(c)==127 for c in n) or i.flag_bits&1 or i.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED): raise ValueError()
   if i.is_dir():
    if n not in directories or i.file_size!=0 or stat.S_IFMT(mode) not in (0,stat.S_IFDIR): raise ValueError()
   else:
    if n not in limits or not 0<i.file_size<=limits[n] or stat.S_IFMT(mode) not in (0,stat.S_IFREG): raise ValueError()
    files.add(n)
  if files!=set(limits): raise ValueError()
  root=pathlib.Path(destination)
  root.mkdir(mode=0o700)
  for n,limit in limits.items():
   target=root/n
   target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   total=0
   with z.open(n) as source,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as output:
    while True:
     data=source.read(65536)
     if not data: break
     total+=len(data)
     if total>limit: raise ValueError()
     output.write(data)
   if total!=z.getinfo(n).file_size: raise ValueError()
 print("ANDROID_EXPORT_EXTRACTED")
except Exception:
 print("ANDROID_EXPORT_ARCHIVE_REJECTED")
 sys.exit(1)
`;

const compareProgram = String.raw`import hashlib,re,sys,zipfile
before,after,manifest_hash=sys.argv[1:]
def signature(n):
 return n.upper()=="META-INF/" or bool(re.match(r"^META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC)|SIG-[^/]+)$",n,re.IGNORECASE))
def compare_bytes(left,right):
 while True:
  a=left.read(65536);b=right.read(65536)
  if a!=b: return False
  if not a: return True
try:
 with zipfile.ZipFile(before) as unsigned,zipfile.ZipFile(after) as signed:
  names_u=unsigned.namelist();names_s=signed.namelist()
  if len(names_u)!=len(set(names_u)) or len(names_s)!=len(set(names_s)): raise ValueError()
  for archive,names in ((unsigned,names_u),(signed,names_s)):
   if any(n.upper()=="META-INF/" and archive.getinfo(n).file_size!=0 for n in names): raise ValueError()
  payload_u={n for n in names_u if not signature(n)}
  payload_s={n for n in names_s if not signature(n)}
  if payload_u!=payload_s: raise ValueError()
  for n in payload_u:
   if unsigned.getinfo(n).file_size!=signed.getinfo(n).file_size: raise ValueError()
   with unsigned.open(n) as a,signed.open(n) as b:
    if not compare_bytes(a,b): raise ValueError()
  manifest="base/manifest/AndroidManifest.xml"
  if hashlib.sha256(unsigned.read(manifest)).hexdigest()!=manifest_hash or hashlib.sha256(signed.read(manifest)).hexdigest()!=manifest_hash: raise ValueError()
 print("ANDROID_SIGNED_PAYLOAD_UNCHANGED")
except Exception:
 print("ANDROID_SIGNED_PAYLOAD_REJECTED")
 sys.exit(1)
`;

function safeDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory) return false;
  try {
    for (let current = directory;; current = path.dirname(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      if (path.dirname(current) === current) return true;
    }
  } catch { return false; }
}
function freshDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory) return false;
  try { lstatSync(directory); return false; } catch (error) { if (error.code !== 'ENOENT') return false; }
  return safeDirectory(path.dirname(directory));
}
function regularFile(filename, limit, privateFile = false) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !safeDirectory(path.dirname(filename))) return false;
  try {
    const stat = lstatSync(filename);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit &&
      (!privateFile || (stat.mode & 0o777) === 0o600);
  } catch { return false; }
}
function hashFile(filename) {
  const hash = createHash('sha256');
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = Buffer.alloc(65536);
    let count;
    while ((count = readSync(fd, bytes, 0, bytes.length, null)) !== 0) hash.update(bytes.subarray(0, count));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function jsonFile(filename, limit, privateFile = false) {
  if (!regularFile(filename, limit, privateFile)) stop(privateFile ? 'PRIVATE_SIGNING_INPUTS_INVALID' : 'EXPORT_RECORD_INVALID');
  const bytes = readFileSync(filename);
  if (bytes.length > limit) stop(privateFile ? 'PRIVATE_SIGNING_INPUTS_INVALID' : 'EXPORT_RECORD_INVALID');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { stop(privateFile ? 'PRIVATE_SIGNING_INPUTS_INVALID' : 'EXPORT_RECORD_INVALID'); }
}
function positiveString(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : null;
}
function normalizeRun(expectedRun) {
  if (!expectedRun || typeof expectedRun !== 'object') return null;
  const artifactSha256 = typeof expectedRun.artifactSha256 === 'string' ? expectedRun.artifactSha256.replace(/^sha256:/, '') : '';
  const runId = positiveString(expectedRun.runId);
  const runAttempt = positiveString(expectedRun.runAttempt);
  if (expectedRun.repository !== approvedRepository || expectedRun.sourceRef !== approvedSourceRef ||
      !/^[a-f0-9]{40}$/.test(expectedRun.sourceCommit ?? '') || !runId || !runAttempt || !hashPattern.test(artifactSha256)) return null;
  return { repository: expectedRun.repository, sourceRef: expectedRun.sourceRef, sourceCommit: expectedRun.sourceCommit, runId, runAttempt, artifactSha256 };
}
function certificateFromOutput(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 64 * 1024) stop('SIGNING_CERTIFICATE_UNCONFIRMED');
  const certificates = stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!certificates || certificates.length !== 1) stop('SIGNING_CERTIFICATE_UNCONFIRMED');
  return new X509Certificate(certificates[0]);
}

/**
 * expectedRun must come from independently retrieved, approved GitHub run and
 * artifact metadata. Never obtain it from the archive being verified. The
 * downloaded sourceRoot is not followed. No remote request occurs here.
 */
export async function signAndroidExport({ archivePath, expectedRun, webRoot, outputDir, env = process.env,
  signing, run = execute, log = console.log } = {}) {
  let temporary;
  let outputCreated = false;
  let succeeded = false;
  let result;
  try {
    const source = normalizeRun(expectedRun);
    if (!source) stop('INDEPENDENT_GITHUB_ARTIFACT_METADATA_REQUIRED');
    if (!safeDirectory(webRoot) || !freshDirectory(outputDir)) stop('EXPLICIT_LOCAL_SOURCE_AND_FRESH_OUTPUT_REQUIRED');
    const resolved = resolveAndroidReleaseConfig(env);
    if (!resolved.ok) stop('PUBLIC_RELEASE_CONFIGURATION_REQUIRED');
    const { config } = resolved;
    if (!signing || typeof signing.keystorePath !== 'string' || !path.isAbsolute(signing.keystorePath) ||
        typeof signing.accessJsonPath !== 'string' || !path.isAbsolute(signing.accessJsonPath) ||
        typeof signing.alias !== 'string' || !/^[A-Za-z0-9][\x20-\x7e]{0,127}$/.test(signing.alias) ||
        signing.alias.trim() !== signing.alias || signing.alias.toLowerCase() === 'androiddebugkey' ||
        !hashPattern.test(signing.expectedCertificateSha256 ?? '') || /debug\.keystore$/i.test(signing.keystorePath)) {
      stop('EXPLICIT_PRIVATE_SIGNING_INPUTS_REQUIRED');
    }
    if (!regularFile(archivePath, maxArchive) || hashFile(archivePath) !== source.artifactSha256) stop('GITHUB_ARTIFACT_DIGEST_MISMATCH');
    const tools = Object.fromEntries(['python3', 'keytool', 'jarsigner'].map(name => [name, findExecutable(name, env)]));
    if (Object.values(tools).some(value => !value)) stop('EXISTING_LOCAL_SIGNING_TOOLS_REQUIRED');
    const toolEnv = {};
    for (const name of ['PATH', 'HOME', 'JAVA_HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) if (typeof env[name] === 'string') toolEnv[name] = env[name];
    const capturedRun = job => run({ ...job, env: job.env ?? toolEnv, capture: true });
    temporary = mkdtempSync(path.join(path.dirname(outputDir), '.genie-sign-import-'));
    chmodSync(temporary, 0o700);
    const archiveCopy = path.join(temporary, 'github-artifact.zip');
    copyFileSync(archivePath, archiveCopy, constants.COPYFILE_EXCL);
    chmodSync(archiveCopy, 0o600);
    if (hashFile(archiveCopy) !== source.artifactSha256) stop('GITHUB_ARTIFACT_DIGEST_MISMATCH');
    const imported = path.join(temporary, 'unsigned');
    const extraction = await capturedRun({ stage: 'extract-export', command: tools.python3,
      args: ['-I', '-c', extractProgram, archiveCopy, imported], cwd: temporary });
    if (extraction.status !== 0 || !/^ANDROID_EXPORT_EXTRACTED\s*$/m.test(extraction.stdout ?? '')) stop('UNSAFE_OR_INCOMPLETE_EXPORT_ARCHIVE');
    const exported = jsonFile(path.join(imported, exportReceiptPath), 16384);
    const preparation = jsonFile(path.join(imported, preparationPath), 16 * 1024 * 1024);
    const identity = readVerifiedBundleIdentity({ androidDir: path.join(imported, 'android'), config });
    if (!identity.ok) stop('UNSIGNED_BINARY_IDENTITY_UNCONFIRMED');
    if (!exported || exported.schemaVersion !== 1 || exported.status !== 'unsigned-export-awaiting-local-signing' || exported.file !== bundlePath ||
        !['repository', 'sourceRef', 'sourceCommit', 'runId', 'runAttempt'].every(field => exported[field] === source[field]) ||
        !['applicationId', 'versionCode', 'versionName'].every(field => exported[field] === config[field]) ||
        exported.unsignedAabSha256 !== identity.receipt.sha256 || exported.manifestSha256 !== identity.receipt.manifestSha256 ||
        exported.releaseManifestSha256 !== identity.receipt.releaseManifestSha256 ||
        exported.identityReceiptSha256 !== hashFile(path.join(imported, identityPath)) ||
        !['nativeCompilation', 'unsignedVerified', 'packagedAssetsMatch', 'finalBinaryManifestIdentityVerified', 'sourceSnapshotVerified'].every(field => exported[field] === true) ||
        !['productionSigningKeyUsed', 'backendContacted', 'artifactUploaded', 'storeSubmission'].every(field => exported[field] === false)) stop('UNSIGNED_EXPORT_PROVENANCE_MISMATCH');
    const publicConfig = publicConfigFingerprint(config);
    if (!preparation || preparation.schemaVersion !== 1 || preparation.profile !== 'android-release' ||
        preparation.status !== 'prepared-not-native-validated' || preparation.appName !== config.appName ||
        !['applicationId', 'versionCode', 'versionName'].every(field => preparation[field] === config[field]) ||
        !same(preparation.publicConfig, publicConfig) || !same(exported.publicConfig, publicConfig)) stop('PUBLIC_CONFIGURATION_BINDING_MISMATCH');
    // Compare relative source inventories against the caller's explicit source
    // tree. Never read or resolve preparation.sourceRoot from a downloaded file.
    if (!same(preparation.sourceFiles, sourceSnapshot(webRoot))) stop('LOCAL_SOURCE_SNAPSHOT_MISMATCH');
    const bridge = path.join(webRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js');
    if (!regularFile(bridge, 4 * 1024 * 1024) || !exported.libraryAssets || Object.keys(exported.libraryAssets).length !== 1 ||
        exported.libraryAssets['base/assets/native-bridge.js'] !== hashFile(bridge)) stop('INSTALLED_NATIVE_BRIDGE_MISMATCH');
    const unsignedAab = path.join(imported, bundlePath);
    const unsigned = await capturedRun({ stage: 'verify-unsigned', command: tools.jarsigner,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', unsignedAab], cwd: temporary });
    if (unsigned.status !== 0 || !/\bjar is unsigned\b/i.test(unsigned.stdout ?? '') ||
        /jar verified|jar signed|signed by|invalid signature|unsigned entries/i.test(unsigned.stdout ?? '')) stop('INPUT_AAB_NOT_CONFIRMED_UNSIGNED');
    const assets = await capturedRun(packagedAssetsCheckJob({ pythonExecutable: tools.python3, artifactPath: unsignedAab,
      expectedAssets: preparation.assets, libraryAssets: exported.libraryAssets, requireUnsigned: true, cwd: temporary, env: toolEnv }));
    if (assets.status !== 0 || !/^AAB_ASSETS_MATCH\s*$/m.test(assets.stdout ?? '')) stop('UNSIGNED_PACKAGE_CONTENTS_MISMATCH');
    const manifest = await capturedRun({ stage: 'verify-unsigned-manifest', command: tools.python3,
      args: ['-I', '-c', compareProgram, unsignedAab, unsignedAab, identity.receipt.manifestSha256], cwd: temporary });
    if (manifest.status !== 0 || !/^ANDROID_SIGNED_PAYLOAD_UNCHANGED\s*$/m.test(manifest.stdout ?? '')) stop('UNSIGNED_MANIFEST_DIGEST_MISMATCH');
    const beforeSigning = readVerifiedBundleIdentity({ androidDir: path.join(imported, 'android'), config });
    if (!beforeSigning.ok || !same(beforeSigning.receipt, identity.receipt)) stop('ORIGINAL_UNSIGNED_EVIDENCE_CHANGED');
    log('local-signing: imported source, configuration, identity and unsigned payload verified');

    // This is the first point that may inspect the explicit private files. No
    // discovery or fallback to inherited signing paths/passwords is performed.
    if (!regularFile(signing.keystorePath, 16 * 1024 * 1024, true)) stop('PRIVATE_SIGNING_INPUTS_INVALID');
    const access = jsonFile(signing.accessJsonPath, 16384, true);
    if (!access || access.alias !== signing.alias || !['storePassword', 'keyPassword'].every(field =>
      typeof access[field] === 'string' && access[field].length > 0 && Buffer.byteLength(access[field]) <= 4096 && !access[field].includes('\0'))) {
      stop('PRIVATE_SIGNING_INPUTS_INVALID');
    }
    const privateEnv = { ...toolEnv, GENIE_EXPORT_STORE_PASSWORD: access.storePassword, GENIE_EXPORT_KEY_PASSWORD: access.keyPassword };
    const certificate = await capturedRun({ stage: 'export-signing-certificate', command: tools.keytool,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-exportcert', '-rfc', '-keystore', signing.keystorePath,
        '-alias', signing.alias, '-storepass:env', 'GENIE_EXPORT_STORE_PASSWORD'], cwd: temporary, env: privateEnv });
    if (certificate.status !== 0) stop('SIGNING_CERTIFICATE_UNCONFIRMED');
    const x509 = certificateFromOutput(certificate.stdout);
    if (digest(x509.raw) !== signing.expectedCertificateSha256) stop('SIGNING_CERTIFICATE_FINGERPRINT_MISMATCH');
    if (x509.publicKey.asymmetricKeyType !== 'rsa' || (x509.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        !(Date.parse(x509.validFrom) <= Date.now() && Date.now() < Date.parse(x509.validTo))) stop('UNSUPPORTED_OR_EXPIRED_SIGNING_CERTIFICATE');
    if (!freshDirectory(outputDir)) stop('FRESH_SIGNING_OUTPUT_REQUIRED');
    mkdirSync(outputDir, { mode: 0o700 }); outputCreated = true;
    const artifactPath = path.join(outputDir, 'app-release-signed.aab');
    log('local-signing: signing a new output file');
    const signed = await capturedRun({ stage: 'sign-bundle', command: tools.jarsigner,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-keystore', signing.keystorePath,
        '-storepass:env', 'GENIE_EXPORT_STORE_PASSWORD', '-keypass:env', 'GENIE_EXPORT_KEY_PASSWORD',
        '-digestalg', 'SHA-256', '-sigalg', 'SHA256withRSA', '-signedjar', artifactPath, unsignedAab, signing.alias],
      cwd: temporary, env: privateEnv });
    if (signed.status !== 0 || !regularFile(artifactPath, maxArchive)) stop('LOCAL_AAB_SIGNING_FAILED');
    chmodSync(artifactPath, 0o600);
    const signedSha256 = hashFile(artifactPath);
    const signature = await capturedRun({ stage: 'verify-signed', command: tools.jarsigner,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', artifactPath], cwd: temporary });
    if (signature.status !== 0 || !/jar verified\./i.test(signature.stdout ?? '') ||
        /jar is unsigned|unsigned entries|invalid signature/i.test(signature.stdout ?? '')) stop('SIGNED_AAB_SIGNATURE_UNCONFIRMED');
    const signer = await capturedRun({ stage: 'verify-signer-certificate', command: tools.keytool,
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-rfc', '-jarfile', artifactPath], cwd: temporary });
    if (signer.status !== 0 || digest(certificateFromOutput(signer.stdout).raw) !== signing.expectedCertificateSha256) {
      stop('SIGNED_AAB_CERTIFICATE_MISMATCH');
    }
    const comparison = await capturedRun({ stage: 'compare-signed-payload', command: tools.python3,
      args: ['-I', '-c', compareProgram, unsignedAab, artifactPath, identity.receipt.manifestSha256], cwd: temporary });
    if (comparison.status !== 0 || !/^ANDROID_SIGNED_PAYLOAD_UNCHANGED\s*$/m.test(comparison.stdout ?? '')) stop('SIGNED_AAB_PAYLOAD_CHANGED');
    const unchanged = readVerifiedBundleIdentity({ androidDir: path.join(imported, 'android'), config });
    if (!unchanged.ok || !same(unchanged.receipt, identity.receipt) || hashFile(path.join(imported, identityPath)) !== exported.identityReceiptSha256) {
      stop('ORIGINAL_UNSIGNED_EVIDENCE_CHANGED');
    }
    if (!regularFile(artifactPath, maxArchive) || hashFile(artifactPath) !== signedSha256) stop('SIGNED_AAB_CHANGED_DURING_VERIFICATION');
    const receipt = {
      schemaVersion: 1, status: 'signed-awaiting-device-and-store-review', ...source,
      applicationId: config.applicationId, versionCode: config.versionCode, versionName: config.versionName,
      file: 'app-release-signed.aab', sha256: signedSha256, unsignedAabSha256: identity.receipt.sha256,
      manifestSha256: identity.receipt.manifestSha256, originalIdentityReceiptSha256: exported.identityReceiptSha256,
      releaseManifestSha256: identity.receipt.releaseManifestSha256, signerCertificateSha256: signing.expectedCertificateSha256,
      signatureVerified: true, payloadUnchanged: true, binaryManifestIdentityPreserved: true, binaryManifestReparsed: false,
      artifactUploaded: false, storeSubmission: false,
    };
    rmSync(temporary, { recursive: true }); temporary = undefined;
    const receiptPath = path.join(outputDir, 'local-signing.json');
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    succeeded = true;
    result = { ok: true, outputDir, artifactPath, receiptPath, receipt };
  } catch (error) {
    result = fail(error instanceof SigningFailure ? error.code : 'LOCAL_SIGNING_INCOMPLETE');
  } finally {
    let cleanupFailed = false;
    if (temporary) try { rmSync(temporary, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (outputCreated && !succeeded) try { rmSync(outputDir, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (cleanupFailed) result = fail('LOCAL_SIGNING_CLEANUP_INCOMPLETE');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const names = ['--archive', '--expected-run', '--web-root', '--output-dir', '--keystore', '--access-json', '--alias', '--certificate-sha256'];
  try {
    const args = process.argv.slice(2);
    const values = {};
    if (args.length !== names.length * 2) throw new Error('ARGUMENTS_REQUIRED');
    for (let index = 0; index < args.length; index += 2) {
      if (!names.includes(args[index]) || Object.hasOwn(values, args[index])) throw new Error('ARGUMENTS_REQUIRED');
      values[args[index]] = args[index + 1];
    }
    const result = await signAndroidExport({ archivePath: values['--archive'], expectedRun: jsonFile(values['--expected-run'], 16384),
      webRoot: values['--web-root'], outputDir: values['--output-dir'], signing: { keystorePath: values['--keystore'],
        accessJsonPath: values['--access-json'], alias: values['--alias'], expectedCertificateSha256: values['--certificate-sha256'] } });
    if (!result.ok) { console.error(`Local Android signing stopped: ${result.code}`); process.exitCode = 1; }
    else console.log(`Signed Android bundle verified locally: ${result.artifactPath}\nDevice/store review is still required. Nothing was uploaded.`);
  } catch {
    console.error('Provide --archive, --expected-run, --web-root, --output-dir, --keystore, --access-json, --alias and --certificate-sha256 explicitly.');
    process.exitCode = 1;
  }
}
