import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

const receiptPath = 'app/build/outputs/bundle/release/genie-bundle-identity.json';
const bundlePath = 'app/build/outputs/bundle/release/app-release.aab';
const preparationPath = 'genie-release-manifest.json';
const receiptLimit = 16 * 1024;
const hashPattern = /^[0-9a-f]{64}$/;
const receiptFields = ['schemaVersion', 'status', 'file', 'manifestEntry', 'applicationId', 'versionCode', 'versionName',
  'sha256', 'manifestSha256', 'releaseManifestSha256'];
const failure = () => ({ ok: false, code: 'ANDROID_BUNDLE_IDENTITY_UNCONFIRMED' });

// Check fixed path components as well as the leaf so a linked build directory
// cannot redirect verification outside the prepared Android workspace.
function fixedPath(androidDir, relative) {
  let directory = androidDir;
  for (const segment of ['', ...relative.split('/').slice(0, -1)]) {
    if (segment) directory = path.join(directory, segment);
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_DIRECTORY');
  }
  return path.join(androidDir, relative);
}

function readRegularFile(filename, consume) {
  const before = lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0) throw new Error('INVALID_FILE');
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('FILE_CHANGED');
    const value = consume(fd, opened.size);
    const after = fstatSync(fd);
    const current = lstatSync(filename);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
        current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) {
      throw new Error('FILE_CHANGED');
    }
    return value;
  } finally {
    closeSync(fd);
  }
}

function readReceipt(filename) {
  return readRegularFile(filename, (fd, size) => {
    if (size > receiptLimit) throw new Error('RECEIPT_TOO_LARGE');
    const bytes = Buffer.alloc(receiptLimit + 1);
    let total = 0;
    let count;
    while (total < bytes.length && (count = readSync(fd, bytes, total, bytes.length - total, null)) !== 0) total += count;
    if (total !== size || total > receiptLimit) throw new Error('RECEIPT_TOO_LARGE');
    return JSON.parse(bytes.subarray(0, total).toString('utf8'));
  });
}

function hashFile(filename) {
  return readRegularFile(filename, (fd, size) => {
    const hash = createHash('sha256');
    const bytes = Buffer.alloc(64 * 1024);
    let total = 0;
    let count;
    while ((count = readSync(fd, bytes, 0, bytes.length, null)) !== 0) {
      total += count;
      if (total > size) throw new Error('FILE_CHANGED');
      hash.update(bytes.subarray(0, count));
    }
    if (total !== size) throw new Error('FILE_CHANGED');
    return hash.digest('hex');
  });
}

/**
 * Consumes the trusted local Gradle identity gate's receipt. This does not parse
 * protobuf, run Gradle, verify signing, or establish that a native build ran.
 * Call only after verifyGenieBundleIdentity succeeds for this workspace.
 */
export function readVerifiedBundleIdentity(input) {
  try {
    const { androidDir, config } = input;
    if (typeof androidDir !== 'string' || !androidDir || !config || typeof config !== 'object') return failure();
    const receipt = readReceipt(fixedPath(androidDir, receiptPath));
    if (!receipt || Array.isArray(receipt) || typeof receipt !== 'object' ||
        Object.keys(receipt).length !== receiptFields.length || !receiptFields.every(field => Object.hasOwn(receipt, field)) ||
        receipt.schemaVersion !== 1 || receipt.status !== 'verified-final-aab-manifest-identity' ||
        receipt.file !== bundlePath || receipt.manifestEntry !== 'base/manifest/AndroidManifest.xml' ||
        typeof receipt.applicationId !== 'string' || receipt.applicationId.length > 255 ||
        !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(receipt.applicationId) ||
        !Number.isSafeInteger(receipt.versionCode) || receipt.versionCode < 1 || receipt.versionCode > 2100000000 ||
        typeof receipt.versionName !== 'string' || !/^[\x21-\x7e]{1,40}$/.test(receipt.versionName) ||
        receipt.applicationId !== config.applicationId || receipt.versionCode !== config.versionCode || receipt.versionName !== config.versionName ||
        !['sha256', 'manifestSha256', 'releaseManifestSha256'].every(field => typeof receipt[field] === 'string' && hashPattern.test(receipt[field]))) {
      return failure();
    }
    if (receipt.sha256 !== hashFile(fixedPath(androidDir, bundlePath)) ||
        receipt.releaseManifestSha256 !== hashFile(fixedPath(androidDir, preparationPath))) return failure();
    return { ok: true, receipt };
  } catch {
    // No exception, file content, configuration or signing values escape here.
    return failure();
  }
}
