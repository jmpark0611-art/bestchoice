import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { signAndroidExport } from './sign-android-export.mjs';
import { findExecutable } from './android-release-environment.mjs';
import { resolveAndroidReleaseConfig } from './android-release-config.mjs';
import { digest, publicConfigFingerprint, sourceSnapshot } from './android-release-manifest.mjs';

// Python only manipulates tiny synthetic ZIPs. All keytool/jarsigner calls are
// injected. The certificate below has a dummy zero signature, no private key,
// and is used only to exercise X509 parsing/fingerprint checks. No actual native
// compilation, certificate signing or AAB signing happens in these tests.
function der(tag, ...values) {
  const body = Buffer.concat(values.map(value => Buffer.isBuffer(value) ? value : Buffer.from(value)));
  let size;
  if (body.length < 128) size = Buffer.from([body.length]);
  else {
    let hex = body.length.toString(16); if (hex.length % 2) hex = `0${hex}`;
    const length = Buffer.from(hex, 'hex'); size = Buffer.concat([Buffer.from([128 + length.length]), length]);
  }
  return Buffer.concat([Buffer.from([tag]), size, body]);
}
function certificateFixture(serial = 1) {
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'), der(0x0c, 'Synthetic fixture only'))));
  const modulus = Buffer.alloc(256, 0xa5);
  const publicKey = der(0x30, der(0x02, Buffer.concat([Buffer.from([0]), modulus])), der(0x02, Buffer.from([1, 0, 1])));
  const spki = der(0x30, Buffer.from('300d06092a864886f70d0101010500', 'hex'), der(0x03, Buffer.from([0]), publicKey));
  const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([serial])), algorithm, name,
    der(0x30, der(0x17, '200101000000Z'), der(0x17, '400101000000Z')), name, spki);
  const certificate = der(0x30, tbs, algorithm, der(0x03, Buffer.alloc(257)));
  return `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}
function put(root, relative, contents, mode = 0o600) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  writeFileSync(filename, contents, { mode });
  return filename;
}
const bundlePath = 'android/app/build/outputs/bundle/release/app-release.aab';
const identityPath = 'android/app/build/outputs/bundle/release/genie-bundle-identity.json';
const prepPath = 'android/genie-release-manifest.json';
const publicEnv = {
  GENIE_ANDROID_APPLICATION_ID: 'kr.synthfixture.genie', GENIE_ANDROID_VERSION_CODE: '12', GENIE_ANDROID_VERSION_NAME: '1.2.0',
  VITE_SUPABASE_URL: 'https://fixtureproject.supabase.co', VITE_PUBLIC_APP_URL: 'https://genie.synthfixture.com',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_7Aq2Zp9Mx4Vr8Nj1Ud5Ls0Ke6Bt3Fy',
};
function fixture(t, options = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-local-signing-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const python = findExecutable('python3', process.env);
  assert.ok(python, 'These tests require an existing Python interpreter; nothing is installed.');
  const webRoot = path.join(base, 'source');
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'capacitor.config.ts']) put(webRoot, name, '{}\n');
  const sourceFile = put(webRoot, 'src/inert.ts', '// Synthetic source only.\n');
  put(webRoot, 'scripts/inert.mjs', '// Synthetic script, never executed.\n');
  put(webRoot, 'android/app/build.gradle', '// Synthetic Android source only.\n');
  const bridge = put(webRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'SYNTHETIC_NATIVE_BRIDGE');
  const config = resolveAndroidReleaseConfig(publicEnv).config;
  const metadata = { repository: 'jmpark0611-art/bestchoice', sourceRef: 'refs/heads/codex/genie-android-native-check-20261123',
    sourceCommit: 'a'.repeat(40), runId: '12345', runAttempt: '1' };
  const tree = path.join(base, 'unsigned-tree');
  mkdirSync(path.join(tree, path.dirname(bundlePath)), { recursive: true });
  const manifest = 'SYNTHETIC_NOT_A_PROTOBUF_MANIFEST';
  const index = 'SYNTHETIC_WEB_ASSET';
  const entries = { 'base/manifest/AndroidManifest.xml': manifest, 'base/dex/classes.dex': 'SYNTHETIC_NOT_DEX',
    'base/assets/public/index.html': options.assetMismatch ? 'WRONG_ASSET' : index, 'base/assets/native-bridge.js': 'SYNTHETIC_NATIVE_BRIDGE' };
  if (options.signedInput) entries['META-INF/ALREADY.SF'] = 'SYNTHETIC_SIGNATURE_METADATA';
  function runPython(program, args) {
    const result = spawnSync(python, ['-I', '-c', program, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  runPython('import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n,v in json.loads(sys.argv[2]).items(): z.writestr(n,v)\n',
    [path.join(tree, bundlePath), JSON.stringify(entries)]);
  const preparation = {
    schemaVersion: 1, profile: 'android-release', status: 'prepared-not-native-validated',
    applicationId: config.applicationId, appName: config.appName, versionCode: config.versionCode, versionName: config.versionName,
    // Success proves the importer does not try to follow this downloaded path.
    sourceRoot: '/this-untrusted-ci-path-must-never-be-followed', sourceFiles: sourceSnapshot(webRoot),
    publicConfig: publicConfigFingerprint(config), assets: [{ path: 'public/index.html', sha256: digest(index) }],
  };
  put(tree, prepPath, `${JSON.stringify(preparation)}\n`);
  const identity = {
    schemaVersion: 1, status: 'verified-final-aab-manifest-identity', file: 'app/build/outputs/bundle/release/app-release.aab',
    manifestEntry: 'base/manifest/AndroidManifest.xml', applicationId: config.applicationId, versionCode: config.versionCode, versionName: config.versionName,
    sha256: digest(readFileSync(path.join(tree, bundlePath))), manifestSha256: options.badManifestHash ? '0'.repeat(64) : digest(manifest),
    releaseManifestSha256: digest(readFileSync(path.join(tree, prepPath))),
  };
  put(tree, identityPath, `${JSON.stringify(identity)}\n`);
  const receipt = {
    schemaVersion: 1, status: 'unsigned-export-awaiting-local-signing', ...metadata,
    applicationId: config.applicationId, versionCode: config.versionCode, versionName: config.versionName, file: bundlePath,
    unsignedAabSha256: identity.sha256, manifestSha256: identity.manifestSha256, releaseManifestSha256: identity.releaseManifestSha256,
    identityReceiptSha256: digest(readFileSync(path.join(tree, identityPath))), publicConfig: publicConfigFingerprint(config),
    libraryAssets: { 'base/assets/native-bridge.js': digest('SYNTHETIC_NATIVE_BRIDGE') },
    nativeCompilation: true, unsignedVerified: true, packagedAssetsMatch: true, finalBinaryManifestIdentityVerified: true, sourceSnapshotVerified: true,
    productionSigningKeyUsed: false, backendContacted: false, artifactUploaded: false, storeSubmission: false,
  };
  put(tree, 'unsigned-export.json', `${JSON.stringify(receipt)}\n`);
  const archivePath = path.join(base, 'github-artifact.zip');
  runPython('import pathlib,stat,sys,zipfile\nroot=pathlib.Path(sys.argv[1]);kind=sys.argv[3]\n' +
    'with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED) as z:\n' +
    ' for p in sorted(root.rglob("*")):\n' +
    '  if not p.is_file(): continue\n' +
    '  n=p.relative_to(root).as_posix();data=p.read_bytes()\n' +
    '  if kind=="oversize" and n=="unsigned-export.json": data+=b" "*16384\n' +
    '  if kind=="symlink" and n=="unsigned-export.json":\n' +
    '   i=zipfile.ZipInfo(n);i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,b"/outside");continue\n' +
    '  z.writestr(n,data)\n' +
    ' if kind=="extra": z.writestr("unexpected.txt",b"UNEXPECTED")\n' +
    ' if kind=="escape": z.writestr("../escaped.txt",b"ESCAPE")\n' +
    ' if kind=="duplicate": z.writestr("unsigned-export.json",(root/"unsigned-export.json").read_bytes())\n',
  [tree, archivePath, options.archiveKind ?? 'normal']);
  if (options.sourceMismatch) writeFileSync(sourceFile, '// Changed local source.\n');
  if (options.bridgeMismatch) writeFileSync(bridge, 'CHANGED_INSTALLED_BRIDGE');
  const javaHome = path.join(base, 'inert-jdk');
  for (const tool of ['keytool', 'jarsigner']) put(javaHome, `bin/${tool}`, 'INERT_MUST_NOT_EXECUTE\n', 0o755);
  const env = { ...publicEnv, JAVA_HOME: javaHome, PATH: path.dirname(python), HOME: path.join(base, 'inert-home'),
    GENIE_ANDROID_KEYSTORE_PATH: '/inherited-path-must-not-be-used', OPENAI_API_KEY: 'INHERITED_PRIVATE_SENTINEL' };
  const pem = certificateFixture();
  const otherPem = certificateFixture(2);
  const keystorePath = put(base, 'private/inert-upload.p12', 'INERT_NOT_A_KEYSTORE');
  const access = { alias: 'genie-upload', storePassword: 'SYNTHETIC_STORE_PASSWORD', keyPassword: 'SYNTHETIC_KEY_PASSWORD', ignoredRecordPath: '/must/not/be/read' };
  const accessJsonPath = put(base, 'private/access.json', JSON.stringify(access));
  const signing = { keystorePath, accessJsonPath, alias: access.alias, expectedCertificateSha256: digest(new X509Certificate(pem).raw) };
  const expectedRun = { ...metadata, artifactSha256: `sha256:${digest(readFileSync(archivePath))}` };
  const outputDir = path.join(base, 'selected-signed-output');
  const state = { calls: [], logs: [] };
  const run = async job => {
    state.calls.push(job);
    assert.equal(job.capture, true);
    assert.equal(Object.hasOwn(job.env, 'OPENAI_API_KEY'), false);
    assert.equal(Object.hasOwn(job.env, 'GENIE_ANDROID_KEYSTORE_PATH'), false);
    assert.equal(job.args.some(value => value.includes(access.storePassword) || value.includes(access.keyPassword)), false);
    if (job.command === python) {
      const value = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, encoding: 'utf8', timeout: 5000 });
      return { status: value.status ?? 1, stdout: value.stdout ?? '' };
    }
    if (job.stage === 'verify-unsigned') return { status: 0, stdout: options.unsignedText ?? 'jar is unsigned.\n' };
    if (job.stage === 'export-signing-certificate') {
      assert.equal(job.env.GENIE_EXPORT_STORE_PASSWORD, access.storePassword);
      if (options.throwPrivate) throw new Error(`DO_NOT_PRINT ${access.storePassword}`);
      return { status: 0, stdout: options.wrongCertificate ? otherPem : pem };
    }
    if (job.stage === 'sign-bundle') {
      assert.equal(job.env.GENIE_EXPORT_KEY_PASSWORD, access.keyPassword);
      const target = job.args[job.args.indexOf('-signedjar') + 1];
      const unsigned = job.args.at(-2);
      runPython('import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as a,zipfile.ZipFile(sys.argv[2],"w") as b:\n' +
        ' for i in a.infolist():\n' +
        '  data=a.read(i.filename)\n' +
        '  if sys.argv[3]=="change" and i.filename=="base/assets/public/index.html": data+=b"CHANGED"\n' +
        '  b.writestr(i,data)\n' +
        ' b.writestr("META-INF/",b"")\n' +
        ' b.writestr("META-INF/MANIFEST.MF",b"SYNTHETIC_MANIFEST")\n' +
        ' b.writestr("META-INF/UPLOAD.SF",b"SYNTHETIC_SIGNATURE_FILE")\n' +
        ' b.writestr("META-INF/UPLOAD.RSA",b"SYNTHETIC_NOT_A_SIGNATURE")\n',
      [unsigned, target, options.payloadChanged ? 'change' : 'same']);
      return { status: options.signFailure ? 1 : 0, stdout: 'SYNTHETIC_SIGNER_ONLY' };
    }
    if (job.stage === 'verify-signed') return { status: 0, stdout: options.signatureText ?? 'jar verified.\n' };
    if (job.stage === 'verify-signer-certificate') {
      if (options.signatureChangedAfterVerify) runPython('import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"a") as z: z.writestr("META-INF/CHANGED.SF",b"CHANGED_AFTER_VERIFY")\n', [job.args.at(-1)]);
      return { status: 0, stdout: options.wrongFinalCertificate ? otherPem : pem };
    }
    assert.fail(`Unexpected injected stage: ${job.stage}`);
  };
  return { base, webRoot, archivePath, expectedRun, env, outputDir, signing, access, state, run, tree };
}
const invoke = (f, changes = {}) => signAndroidExport({ archivePath: f.archivePath, expectedRun: f.expectedRun, webRoot: f.webRoot,
  outputDir: f.outputDir, env: f.env, signing: f.signing, run: f.run, log: value => f.state.logs.push(value), ...changes });
function failed(f, result, code, beforePrivate = false) {
  assert.deepEqual(result, { ok: false, code });
  assert.equal(existsSync(f.outputDir), false);
  assert.equal(readdirSync(f.base).some(name => name.startsWith('.genie-sign-import-')), false);
  assert.equal(JSON.stringify({ result, logs: f.state.logs }).includes(f.access.storePassword), false);
  if (beforePrivate) assert.equal(f.state.calls.some(call => call.stage === 'export-signing-certificate' || call.stage === 'sign-bundle'), false);
}

test('synthetic orchestration preserves unsigned evidence, uses explicit env password references, and writes a separate linked receipt', async t => {
  const f = fixture(t);
  const before = [f.archivePath, f.signing.keystorePath, f.signing.accessJsonPath, path.join(f.tree, identityPath)].map(file => readFileSync(file));
  const result = await invoke(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(readdirSync(f.outputDir).sort(), ['app-release-signed.aab', 'local-signing.json']);
  assert.equal(result.receipt.status, 'signed-awaiting-device-and-store-review');
  assert.equal(result.receipt.sha256, digest(readFileSync(result.artifactPath)));
  assert.notEqual(result.receipt.sha256, result.receipt.unsignedAabSha256);
  assert.equal(result.receipt.binaryManifestIdentityPreserved, true);
  assert.equal(result.receipt.binaryManifestReparsed, false);
  assert.equal(result.receipt.artifactUploaded, false);
  assert.equal(result.receipt.storeSubmission, false);
  assert.equal(statSync(f.outputDir).mode & 0o777, 0o700);
  assert.equal(statSync(result.artifactPath).mode & 0o777, 0o600);
  assert.deepEqual([f.archivePath, f.signing.keystorePath, f.signing.accessJsonPath, path.join(f.tree, identityPath)].map(file => readFileSync(file)), before);
  assert.equal(readdirSync(f.base).some(name => name.startsWith('.genie-sign-import-')), false);
  const stages = f.state.calls.map(call => call.stage);
  assert.ok(stages.indexOf('verify-unsigned-manifest') < stages.indexOf('export-signing-certificate'));
  assert.equal(JSON.stringify({ receipt: result.receipt, logs: f.state.logs }).includes(f.access.keyPassword), false);
});

test('independent artifact digest, run identity and local source/config/bridge are required before private inputs', async t => {
  for (const change of [{ repository: 'other/repository' }, { sourceRef: 'refs/heads/main' }]) {
    const f = fixture(t);
    failed(f, await invoke(f, { expectedRun: { ...f.expectedRun, ...change } }), 'INDEPENDENT_GITHUB_ARTIFACT_METADATA_REQUIRED', true);
    assert.equal(f.state.calls.length, 0);
  }
  const digestMismatch = fixture(t);
  rmSync(digestMismatch.signing.accessJsonPath);
  failed(digestMismatch, await invoke(digestMismatch, { expectedRun: { ...digestMismatch.expectedRun, artifactSha256: '0'.repeat(64) } }), 'GITHUB_ARTIFACT_DIGEST_MISMATCH', true);
  const runMismatch = fixture(t);
  failed(runMismatch, await invoke(runMismatch, { expectedRun: { ...runMismatch.expectedRun, runId: '99999' } }), 'UNSIGNED_EXPORT_PROVENANCE_MISMATCH', true);
  for (const [options, code] of [[{ sourceMismatch: true }, 'LOCAL_SOURCE_SNAPSHOT_MISMATCH'], [{ bridgeMismatch: true }, 'INSTALLED_NATIVE_BRIDGE_MISMATCH']]) {
    const f = fixture(t, options);
    failed(f, await invoke(f), code, true);
  }
  const configMismatch = fixture(t);
  failed(configMismatch, await invoke(configMismatch, { env: { ...configMismatch.env, VITE_PUBLIC_APP_URL: 'https://other.synthfixture.com' } }), 'PUBLIC_CONFIGURATION_BINDING_MISMATCH', true);
});

test('safe extraction rejects extras, traversal, duplicates, symlinks and oversize records before private inputs', async t => {
  for (const archiveKind of ['extra', 'escape', 'duplicate', 'symlink', 'oversize']) {
    const f = fixture(t, { archiveKind });
    rmSync(f.signing.accessJsonPath);
    failed(f, await invoke(f), 'UNSAFE_OR_INCOMPLETE_EXPORT_ARCHIVE', true);
    assert.equal(existsSync(path.join(f.base, 'escaped.txt')), false);
  }
  const oversized = fixture(t);
  truncateSync(oversized.archivePath, 256 * 1024 * 1024 + 1);
  failed(oversized, await invoke(oversized), 'GITHUB_ARTIFACT_DIGEST_MISMATCH', true);
});

test('unsigned state, packaged asset bytes and actual manifest digest must all agree before private inputs', async t => {
  for (const [options, code] of [[{ unsignedText: 'jar verified.\n' }, 'INPUT_AAB_NOT_CONFIRMED_UNSIGNED'],
    [{ signedInput: true }, 'UNSIGNED_PACKAGE_CONTENTS_MISMATCH'], [{ assetMismatch: true }, 'UNSIGNED_PACKAGE_CONTENTS_MISMATCH'],
    [{ badManifestHash: true }, 'UNSIGNED_MANIFEST_DIGEST_MISMATCH']]) {
    const f = fixture(t, options);
    rmSync(f.signing.accessJsonPath);
    failed(f, await invoke(f), code, true);
  }
});

test('explicit private inputs must be regular 0600 files and match the caller alias', async t => {
  for (const variation of ['permissions', 'alias', 'symlink']) {
    const f = fixture(t);
    if (variation === 'permissions') chmodSync(f.signing.accessJsonPath, 0o644);
    if (variation === 'alias') writeFileSync(f.signing.accessJsonPath, JSON.stringify({ ...f.access, alias: 'other-upload' }));
    if (variation === 'symlink') {
      const replacement = put(f.base, 'private/other-access.json', JSON.stringify(f.access));
      rmSync(f.signing.accessJsonPath); symlinkSync(replacement, f.signing.accessJsonPath);
    }
    failed(f, await invoke(f), 'PRIVATE_SIGNING_INPUTS_INVALID', true);
  }
});

test('wrong certificates, signing failure and partially unsigned results never leave a completed output', async t => {
  for (const [options, code] of [[{ wrongCertificate: true }, 'SIGNING_CERTIFICATE_FINGERPRINT_MISMATCH'],
    [{ signFailure: true }, 'LOCAL_AAB_SIGNING_FAILED'], [{ signatureText: 'jar verified.\nThis jar contains unsigned entries.\n' }, 'SIGNED_AAB_SIGNATURE_UNCONFIRMED'],
    [{ wrongFinalCertificate: true }, 'SIGNED_AAB_CERTIFICATE_MISMATCH'], [{ throwPrivate: true }, 'LOCAL_SIGNING_INCOMPLETE']]) {
    const f = fixture(t, options);
    failed(f, await invoke(f), code);
  }
});

test('byte changes to payload or signature metadata after verification are detected and cleaned', async t => {
  for (const [options, code] of [[{ payloadChanged: true }, 'SIGNED_AAB_PAYLOAD_CHANGED'],
    [{ signatureChangedAfterVerify: true }, 'SIGNED_AAB_CHANGED_DURING_VERIFICATION']]) {
    const f = fixture(t, options);
    failed(f, await invoke(f), code);
  }
});

test('an existing selected output is preserved without invoking a signing tool', async t => {
  const f = fixture(t);
  put(f.outputDir, 'keep.txt', 'PRESERVE_EXISTING_OUTPUT');
  assert.deepEqual(await invoke(f), { ok: false, code: 'EXPLICIT_LOCAL_SOURCE_AND_FRESH_OUTPUT_REQUIRED' });
  assert.equal(readFileSync(path.join(f.outputDir, 'keep.txt'), 'utf8'), 'PRESERVE_EXISTING_OUTPUT');
  assert.equal(f.state.calls.length, 0);
});
