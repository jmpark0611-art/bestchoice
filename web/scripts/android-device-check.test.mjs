import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFixtureEnvironment, copyFixture, downloadArchive, EMULATOR_PIN, fixtureEnvironment,
  instrumentationArgs, parseInstrumentation, parseSdkMetadata, PHASES, prepareDeviceCheck,
  requireAcceptedLicense, validateNamespace } from './android-device-check.mjs';

const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
const temp = t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'genie-device-driver-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const packageXml = (kind = 'image') => '<remotePackage path="' + (kind === 'image' ? 'system-images;android-36;google_apis;x86_64' : 'emulator') + '">'
  + (kind === 'image' ? '<type-details><api-level>36</api-level><abi>x86_64</abi><tag><id>google_apis</id></tag></type-details>' : '')
  + '<revision>' + (kind === 'image' ? '<major>17</major>' : '<major>37</major><minor>3</minor><micro>10</micro>') + '</revision>'
  + '<channelRef ref="channel-0"/><uses-license ref="android-sdk-license"/>'
  + '<archives><archive><host-os>linux</host-os><complete><size>' + (kind === 'image' ? '1800000000' : '350068887') + '</size>'
  + '<checksum type="sha1">' + 'a'.repeat(40) + '</checksum><url>'
  + (kind === 'image' ? 'x86_64-36_r17.zip' : 'emulator-linux_x64-16970787.zip') + '</url></complete></archive></archives></remotePackage>';
const metadataXml = (packages = packageXml()) => '<?xml version="1.0"?><repository xmlns="urn:synthetic">'
  + '<license id="android-sdk-license" type="text">  Synthetic\nlicense &amp; terms.  </license>' + packages + '</repository>';

test('rejects release/server inputs before commands, filesystem writes or downloads', async t => {
  const workDir = path.join(temp(t), 'must-not-exist');
  let calls = 0;
  for (const key of ['GENIE_ANDROID_KEYSTORE_PASSWORD', 'GENIE_ANDROID_APPLICATION_ID', 'VITE_SUPABASE_URL', 'VITE_ANY_SECRET']) {
    await assert.rejects(prepareDeviceCheck({ workDir, allowDownloads: true, env: { [key]: 'synthetic-private-value' },
      run: () => { calls++; throw new Error('must not run'); } }), { code: 'REMOVE_RELEASE_AND_PUBLIC_SERVER_INPUTS_FROM_DEVICE_FIXTURE' });
  }
  await assert.rejects(prepareDeviceCheck({ workDir, env: {} }), { code: 'EXPLICIT_TOOL_DOWNLOAD_OPT_IN_REQUIRED' });
  assert.equal(calls, 0);
  assert.equal(existsSync(workDir), false);
  assert.doesNotThrow(() => checkFixtureEnvironment({ HTTP_PROXY: 'ignored' }));
  const child = fixtureEnvironment({ workDir, sdkRoot: '/synthetic/sdk', javaHome: '/synthetic/java', nodeBinary: '/synthetic/node' });
  assert.equal(child.ANDROID_USER_HOME, path.join(workDir, 'android-user'));
  assert.equal(child.GRADLE_USER_HOME, path.join(workDir, 'gradle-user'));
  assert.notEqual(child.NPM_CONFIG_USERCONFIG, child.NPM_CONFIG_GLOBALCONFIG);
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'HOME', 'GITHUB_TOKEN', 'JAVA_TOOL_OPTIONS', 'VITE_SUPABASE_URL', 'GENIE_ANDROID_KEYSTORE_PASSWORD']) {
    assert.equal(Object.hasOwn(child, key), false);
  }
});

test('resolves one stable image using exact decoded license and raw metadata hashes', () => {
  const xml = metadataXml().replaceAll('\n', '\r\n');
  const pin = parseSdkMetadata(xml, 'image');
  assert.equal(pin.package, 'system-images;android-36;google_apis;x86_64');
  assert.equal(pin.revision, '17.0.0');
  assert.equal(pin.url, 'https://dl.google.com/android/repository/sys-img/google_apis/x86_64-36_r17.zip');
  assert.equal(pin.checksumAlgorithm, 'sha1');
  assert.equal(pin.licenseSha1, hash('sha1', '  Synthetic\nlicense & terms.  '));
  assert.equal(pin.metadataSha256, hash('sha256', xml));
  const emulator = parseSdkMetadata(metadataXml(packageXml('emulator')), 'emulator');
  assert.equal(emulator.url, EMULATOR_PIN.url);
  assert.equal(emulator.revision, EMULATOR_PIN.revision);
});

test('rejects ambiguous stable images, wrong API/ABI and preview-only selections', () => {
  for (const xml of [
    metadataXml(packageXml() + packageXml()),
    metadataXml().replace('<api-level>36</api-level>', '<api-level>35</api-level>'),
    metadataXml().replace('<abi>x86_64</abi>', '<abi>arm64-v8a</abi>'),
    metadataXml().replace('ref="channel-0"', 'ref="channel-1"'),
    metadataXml().replace('<major>17</major>', '<major>17</major><preview>1</preview>'),
  ]) assert.throws(() => parseSdkMetadata(xml, 'image'), { code: 'OFFICIAL_METADATA_REJECTED' });
});

test('rejects external entities, archive redirects/other hosts and duplicate archives', () => {
  const normal = metadataXml();
  for (const xml of [
    normal.replace('<repository', '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///never-read">]><repository'),
    normal.replace('x86_64-36_r17.zip', 'https://untrusted.invalid/image.zip'),
    normal.replace('x86_64-36_r17.zip', '../image.zip'),
    normal.replace('x86_64-36_r17.zip', '//dl.google.com/image.zip'),
    normal.replace('</archives>', '<archive><complete><size>1800000000</size><checksum type="sha1">' + 'a'.repeat(40) + '</checksum><url>second.zip</url></complete></archive></archives>'),
  ]) assert.throws(() => parseSdkMetadata(xml, 'image'), { code: 'OFFICIAL_METADATA_REJECTED' });
});

test('requires an already accepted exact license, never creates or updates its file', t => {
  const sdk = temp(t), pin = parseSdkMetadata(metadataXml(), 'image');
  assert.throws(() => requireAcceptedLicense(pin, sdk), { code: 'SDK_LICENSE_ACCEPTANCE_REQUIRED' });
  assert.equal(existsSync(path.join(sdk, 'licenses')), false);
  mkdirSync(path.join(sdk, 'licenses'));
  const file = path.join(sdk, 'licenses/android-sdk-license');
  writeFileSync(file, 'b'.repeat(40) + '\n');
  assert.throws(() => requireAcceptedLicense(pin, sdk), { code: 'SDK_LICENSE_ACCEPTANCE_REQUIRED' });
  assert.equal(readFileSync(file, 'utf8'), 'b'.repeat(40) + '\n');
  writeFileSync(file, 'b'.repeat(40) + '\n' + pin.licenseSha1 + '\n');
  assert.doesNotThrow(() => requireAcceptedLicense(pin, sdk));
});

test('downloads only a preselected Google URL, rejects redirects and verifies every byte', async t => {
  const bytes = Buffer.from('synthetic fixture archive bytes');
  const pin = { url: EMULATOR_PIN.url, size: bytes.length, checksumAlgorithm: 'sha1',
    checksum: hash('sha1', bytes), sha256: hash('sha256', bytes) };
  const file = path.join(temp(t), 'archive.zip');
  let calls = 0;
  const fakeFetch = async (url, options) => {
    calls++;
    assert.equal(url, EMULATOR_PIN.url);
    assert.equal(options.redirect, 'error');
    return new Response(bytes);
  };
  assert.deepEqual(await downloadArchive(pin, file, fakeFetch), { size: bytes.length, sha256: pin.sha256 });
  assert.deepEqual(readFileSync(file), bytes);
  rmSync(file);
  await assert.rejects(downloadArchive({ ...pin, sha256: '0'.repeat(64) }, file, fakeFetch), { code: 'PINNED_ARCHIVE_CHECKSUM_MISMATCH' });
  assert.equal(existsSync(file), false);
  await assert.rejects(downloadArchive({ ...pin, url: 'https://other.invalid/image.zip' }, file, fakeFetch), { code: 'ARCHIVE_URL_NOT_ALLOWED' });
  assert.equal(calls, 2);
});

test('fresh copy contains Android sources only and excludes env, release proof and stale assets', t => {
  const base = temp(t), source = path.join(base, 'source'), copy = path.join(base, 'copy');
  mkdirSync(source);
  for (const dir of ['src', 'node_modules', 'android/app/src/main/assets', 'android/app/src/release',
    'android/app/src/androidTest/java', 'android/app/build', 'ios', 'scripts']) mkdirSync(path.join(source, dir), { recursive: true });
  for (const file of ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'capacitor.config.ts',
    'src/App.tsx', 'scripts/build-native-preview.mjs', '.env.local', 'android/local.properties', 'android/genie-release-manifest.json',
    'android/app/google-services.json', 'android/app/src/main/assets/old.js', 'android/app/src/release/old.xml',
    'android/app/src/androidTest/java/NewTest.java', 'android/app/build/old.apk', 'ios/old.txt']) {
    writeFileSync(path.join(source, file), 'synthetic:' + file);
  }
  copyFixture(source, copy);
  assert.equal(readFileSync(path.join(copy, 'android/app/src/androidTest/java/NewTest.java'), 'utf8'), 'synthetic:android/app/src/androidTest/java/NewTest.java');
  for (const file of ['.env.local', 'ios', 'android/local.properties', 'android/genie-release-manifest.json',
    'android/app/google-services.json', 'android/app/src/main/assets', 'android/app/src/release', 'android/app/build']) {
    assert.equal(existsSync(path.join(copy, file)), false, file);
    assert.equal(existsSync(path.join(source, file)), true, 'original still exists: ' + file);
  }
  symlinkSync('/outside-do-not-read', path.join(source, 'src/unsafe'));
  assert.throws(() => copyFixture(source, path.join(base, 'unsafe-copy')), { code: 'SOURCE_SYMLINK_NOT_ALLOWED' });
});

test('requires a different namespace with exactly loopback and no external IPv4 or IPv6 route', () => {
  const safe = { parent: 'net:[111]', current: 'net:[222]', links: [{ ifname: 'lo' }],
    routes: [{ dev: 'lo', dst: '127.0.0.0/8' }, { dev: 'lo', dst: '::1' }] };
  assert.doesNotThrow(() => validateNamespace(safe));
  assert.throws(() => validateNamespace({ ...safe, current: safe.parent }), { code: 'NEW_NETWORK_NAMESPACE_REQUIRED' });
  assert.throws(() => validateNamespace({ ...safe, links: [...safe.links, { ifname: 'eth0' }] }), { code: 'LOOPBACK_ONLY_NETWORK_REQUIRED' });
  assert.throws(() => validateNamespace({ ...safe, routes: [...safe.routes, { dev: 'eth0', dst: 'default' }] }), { code: 'LOOPBACK_ONLY_NETWORK_REQUIRED' });
});

const phaseOutput = phase => PHASES[phase].cases.map(caseId => 'GENIE_DEVICE_CASE ' + JSON.stringify({ caseId, passed: true })).join('\n')
  + (phase === 'first' ? '\nGENIE_DRAFT_PREPARED' : '') + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';

test('selects only the two intended instrumentation methods and verifies all named case receipts', () => {
  assert.match(instrumentationArgs('first').at(-2), /GenieDeviceCheck#launchBackNarrowAndPrepareDraft$/);
  assert.match(instrumentationArgs('restore').at(-2), /GenieDeviceCheck#restoreDraftAfterHostForceStop$/);
  assert.equal(instrumentationArgs('first').includes('clearPackageData'), false);
  assert.equal(parseInstrumentation({ status: 0, stdout: phaseOutput('first') }, 'first').length, 3);
  assert.equal(parseInstrumentation({ status: 0, stdout: phaseOutput('restore') }, 'restore').length, 1);
});

test('adb exit zero cannot turn failed, missing, duplicate or crashed tests into success', () => {
  const good = phaseOutput('first');
  for (const stdout of [
    good.replace('OK (1 test)', 'FAILURES!!!'),
    good + 'INSTRUMENTATION_STATUS_CODE: -2\n',
    good + 'INSTRUMENTATION_FAILED\n',
    good.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'),
    good.replace('GENIE_DRAFT_PREPARED', ''),
    good.replace('\"caseId\":\"launch\"', '\"caseId\":\"native-back\"'),
    good.replace('\"passed\":true', '\"passed\":false'),
    good.split('\n').slice(1).join('\n'),
  ]) assert.throws(() => parseInstrumentation({ status: 0, stdout }, 'first'));
  assert.throws(() => parseInstrumentation({ status: 1, stdout: good }, 'first'), { code: 'INSTRUMENTATION_DID_NOT_PASS' });
});
