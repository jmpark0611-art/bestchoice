import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readVerifiedBundleIdentity } from './android-bundle-identity.mjs';

// All files are synthetic; the .aab fixture is deliberately NOT an Android
// bundle. These tests prove receipt consumption/file-integrity behavior only,
// never a native compile, protobuf decode, signature or actual release identity.
const digest = value => createHash('sha256').update(value).digest('hex');
const rejected = result => assert.deepEqual(result, { ok: false, code: 'ANDROID_BUNDLE_IDENTITY_UNCONFIRMED' });

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-bundle-identity-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const androidDir = path.join(base, 'android');
  const output = path.join(androidDir, 'app/build/outputs/bundle/release');
  mkdirSync(output, { recursive: true });
  const bundle = path.join(output, 'app-release.aab');
  const preparation = path.join(androidDir, 'genie-release-manifest.json');
  const receiptFile = path.join(output, 'genie-bundle-identity.json');
  const config = Object.freeze({ applicationId: 'kr.synthfixture.genie', versionCode: 12, versionName: '1.2.0' });
  writeFileSync(bundle, 'SYNTHETIC_NOT_AN_ANDROID_BUNDLE\n');
  writeFileSync(preparation, `${JSON.stringify({ schemaVersion: 1, profile: 'android-release', ...config })}\n`);
  const receipt = {
    schemaVersion: 1,
    status: 'verified-final-aab-manifest-identity',
    file: 'app/build/outputs/bundle/release/app-release.aab',
    manifestEntry: 'base/manifest/AndroidManifest.xml',
    ...config,
    sha256: digest(readFileSync(bundle)),
    manifestSha256: digest('SYNTHETIC_NOT_A_PROTOBUF_MANIFEST'),
    releaseManifestSha256: digest(readFileSync(preparation)),
  };
  const writeReceipt = value => writeFileSync(receiptFile, `${JSON.stringify(value)}\n`);
  writeReceipt(receipt);
  const inspect = (values = config) => readVerifiedBundleIdentity({ androidDir, config: values });
  return { base, androidDir, bundle, preparation, receiptFile, receipt, config, writeReceipt, inspect };
}

test('accepts a matching synthetic receipt and current bytes without modifying any input', t => {
  const f = fixture(t);
  const files = [f.bundle, f.preparation, f.receiptFile];
  const before = files.map(filename => readFileSync(filename));
  assert.deepEqual(f.inspect(), { ok: true, receipt: f.receipt });
  assert.deepEqual(files.map(filename => readFileSync(filename)), before);
  assert.deepEqual(f.config, { applicationId: 'kr.synthfixture.genie', versionCode: 12, versionName: '1.2.0' });
});

test('fails closed when any required receipt, AAB or preparation file is missing', t => {
  for (const name of ['receiptFile', 'bundle', 'preparation']) {
    const f = fixture(t);
    rmSync(f[name]);
    rejected(f.inspect());
  }
});

test('requires actual identity values and types to match the supplied configuration', t => {
  const f = fixture(t);
  for (const change of [
    { applicationId: 'kr.synthfixture.other' },
    { versionCode: 13 },
    { versionCode: '12' },
    { versionName: '1.2.1' },
    { versionName: 1.2 },
  ]) {
    f.writeReceipt({ ...f.receipt, ...change });
    rejected(f.inspect());
  }
  f.writeReceipt(f.receipt);
  rejected(f.inspect({ ...f.config, versionCode: 13 }));
  rejected(f.inspect({ ...f.config, applicationId: undefined }));
  rejected(readVerifiedBundleIdentity());
  rejected(readVerifiedBundleIdentity(null));
});

test('rejects an unconfirmed status, wrong schema or target paths, and unexpected receipt fields', t => {
  const f = fixture(t);
  for (const change of [
    { schemaVersion: '1' },
    { status: 'native-check-passed-not-a-release' },
    { file: '../../other.aab' },
    { manifestEntry: 'AndroidManifest.xml' },
    { additionalUnverifiedField: true },
  ]) {
    f.writeReceipt({ ...f.receipt, ...change });
    rejected(f.inspect());
  }
  const { manifestEntry, ...incomplete } = f.receipt;
  f.writeReceipt(incomplete);
  rejected(f.inspect());
});

test('rejects changed AAB bytes even when the file size and all receipt fields stay the same', t => {
  const f = fixture(t);
  const changed = Buffer.from(readFileSync(f.bundle));
  changed[0] ^= 1;
  writeFileSync(f.bundle, changed);
  rejected(f.inspect());
  assert.deepEqual(readFileSync(f.bundle), changed);
});

test('binds preparation to exact file bytes, including semantically unchanged JSON whitespace', t => {
  const f = fixture(t);
  const original = JSON.parse(readFileSync(f.preparation, 'utf8'));
  writeFileSync(f.preparation, `${JSON.stringify(original, null, 2)}\n`);
  rejected(f.inspect());
});

test('rejects malformed hashes and valid-looking hashes that do not match current files', t => {
  const f = fixture(t);
  for (const field of ['sha256', 'manifestSha256', 'releaseManifestSha256']) {
    for (const value of ['a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}z`, null]) {
      f.writeReceipt({ ...f.receipt, [field]: value });
      rejected(f.inspect());
    }
  }
  for (const field of ['sha256', 'releaseManifestSha256']) {
    f.writeReceipt({ ...f.receipt, [field]: '0'.repeat(64) });
    rejected(f.inspect());
  }
});

test('bounds receipt reads to 16 KiB and returns only the generic failure for malformed contents', t => {
  const f = fixture(t);
  const normal = JSON.stringify(f.receipt);
  writeFileSync(f.receiptFile, normal.padEnd(16 * 1024, ' '));
  assert.equal(f.inspect().ok, true);
  writeFileSync(f.receiptFile, normal.padEnd(16 * 1024 + 1, ' '));
  rejected(f.inspect());
  writeFileSync(f.receiptFile, '{SYNTHETIC_PRIVATE_MARKER_MUST_NOT_ESCAPE');
  rejected(f.inspect());
  for (const malformed of ['null', '[]', '42', '']) {
    writeFileSync(f.receiptFile, malformed);
    rejected(f.inspect());
  }
});

test('rejects linked files, linked output directories and a linked Android root without changing targets',
  { skip: process.platform === 'win32' }, t => {
    for (const name of ['receiptFile', 'bundle', 'preparation']) {
      const f = fixture(t);
      const target = path.join(f.base, `${name}-outside`);
      renameSync(f[name], target);
      const before = readFileSync(target);
      symlinkSync(target, f[name]);
      rejected(f.inspect());
      assert.deepEqual(readFileSync(target), before);
    }
    const f = fixture(t);
    const output = path.join(f.androidDir, 'app/build/outputs');
    const outside = path.join(f.base, 'outside-output-directory');
    renameSync(output, outside);
    symlinkSync(outside, output, 'dir');
    rejected(f.inspect());

    const g = fixture(t);
    const rootAlias = path.join(g.base, 'linked-android');
    symlinkSync(g.androidDir, rootAlias, 'dir');
    rejected(readVerifiedBundleIdentity({ androidDir: rootAlias, config: g.config }));
  });

test('rejects nonregular or empty required files without attempting to replace them', t => {
  for (const name of ['receiptFile', 'bundle', 'preparation']) {
    const f = fixture(t);
    rmSync(f[name]);
    mkdirSync(f[name]);
    rejected(f.inspect());
    rmSync(f[name], { recursive: true });
    writeFileSync(f[name], '');
    rejected(f.inspect());
  }
});
