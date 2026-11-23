import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { captureFailureEvidence, checkFixtureEnvironment, copyFixture, downloadArchive, EMULATOR_PIN, FIXTURE_APP_ID, fixtureEnvironment, inspectFailurePng,
  instrumentationArgs, parseInstrumentation, parseSdkMetadata, PHASES, prepareDeviceCheck, prepareDraftAndForceStop,
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

test('resolves one stable image using Android license normalization and raw metadata hashes', () => {
  const xml = metadataXml().replaceAll('\n', '\r\n');
  const pin = parseSdkMetadata(xml, 'image');
  assert.equal(pin.package, 'system-images;android-36;google_apis;x86_64');
  assert.equal(pin.revision, '17.0.0');
  assert.equal(pin.url, 'https://dl.google.com/android/repository/sys-img/google_apis/x86_64-36_r17.zip');
  assert.equal(pin.checksumAlgorithm, 'sha1');
  assert.equal(pin.licenseSha1, hash('sha1', 'Synthetic license & terms.'));
  assert.equal(pin.licenseLiteralSha1, hash('sha1', '  Synthetic\nlicense & terms.  '));
  assert.equal(pin.licenseNormalization, 'android-TrimStringAdapter');
  assert.equal(pin.metadataSha256, hash('sha256', xml));
  const emulator = parseSdkMetadata(metadataXml(packageXml('emulator')), 'emulator');
  assert.equal(emulator.url, EMULATOR_PIN.url);
  assert.equal(emulator.revision, EMULATOR_PIN.revision);
});

test('normalizes with the SDK adapter while preserving paragraph breaks and exact acceptance', t => {
  const literal = ' \tClause   one\nwraps.\n \t\nClause two.\n\nJanuary 16, 2019 \t\n';
  const canonical = 'Clause one wraps.\n\nClause two.\n\nJanuary 16, 2019';
  const xml = metadataXml().replace('  Synthetic\nlicense &amp; terms.  ', literal);
  const pin = parseSdkMetadata(xml, 'image');
  assert.equal(pin.licenseSha1, hash('sha1', canonical));
  assert.equal(pin.licenseLiteralSha1, hash('sha1', literal));
  const sdk = temp(t), file = path.join(sdk, 'licenses/android-sdk-license');
  mkdirSync(path.dirname(file));
  writeFileSync(file, pin.licenseLiteralSha1 + '\n');
  assert.throws(() => requireAcceptedLicense(pin, sdk), { code: 'SDK_LICENSE_ACCEPTANCE_REQUIRED' });
  const accepted = pin.licenseSha1 + '\n';
  writeFileSync(file, accepted);
  assert.doesNotThrow(() => requireAcceptedLicense(pin, sdk));
  for (const altered of [xml.replace('Clause two.', 'Changed clause.'), xml.replace('wraps.\n \t\nClause', 'wraps.\nClause')]) {
    assert.throws(() => requireAcceptedLicense(parseSdkMetadata(altered, 'image'), sdk), { code: 'SDK_LICENSE_ACCEPTANCE_REQUIRED' });
  }
  assert.equal(readFileSync(file, 'utf8'), accepted);
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
  assert.throws(() => requireAcceptedLicense(pin, sdk), error => {
    assert.equal(error.code, 'SDK_LICENSE_ACCEPTANCE_REQUIRED');
    assert.deepEqual(error.licenseDiagnostic, {
      package: 'system-images;android-36;google_apis;x86_64', licenseId: 'android-sdk-license',
      expectedSha1: pin.licenseSha1, licenseFilePresent: true, licenseFileReadable: true,
      acceptedHashes: ['b'.repeat(40)],
    });
    return true;
  });
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

const preparedReceipt = pid => 'GENIE_DRAFT_PREPARED ' + JSON.stringify({ schemaVersion: 1, pid });
const phaseOutput = (phase, pid = 4242) => PHASES[phase].cases.map(caseId => 'GENIE_DEVICE_CASE ' + JSON.stringify({ caseId, passed: true })).join('\n')
  + (phase === 'first' ? '\n' + preparedReceipt(pid) : '') + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';

test('selects only the two intended instrumentation methods and verifies all named case receipts', () => {
  assert.match(instrumentationArgs('first').at(-2), /GenieDeviceCheck#launchBackNarrowAndPrepareDraft$/);
  assert.match(instrumentationArgs('restore').at(-2), /GenieDeviceCheck#restoreDraftAfterHostForceStop$/);
  assert.equal(instrumentationArgs('first').filter(arg => arg === '--no-restart').length, 1);
  assert.equal(instrumentationArgs('restore').includes('--no-restart'), false);
  assert.equal(instrumentationArgs('first').includes('waitForActivitiesToComplete'), false);
  assert.equal(instrumentationArgs('first').includes('clearPackageData'), false);
  const first = parseInstrumentation({ status: 0, stdout: phaseOutput('first') }, 'first');
  assert.equal(first.cases.length, 3); assert.equal(first.preparedPid, 4242);
  const restored = parseInstrumentation({ status: 0, stdout: phaseOutput('restore') }, 'restore');
  assert.equal(restored.cases.length, 1); assert.equal(restored.preparedPid, null);
});

test('adb exit zero cannot turn failed, missing, duplicate or crashed tests into success', () => {
  const good = phaseOutput('first');
  for (const stdout of [
    good.replace('OK (1 test)', 'FAILURES!!!'),
    good + 'INSTRUMENTATION_STATUS_CODE: -2\n',
    good + 'INSTRUMENTATION_FAILED\n',
    good + 'INSTRUMENTATION_ABORTED\n',
    good + 'Process crashed\n',
    good + 'shortMsg=Process crashed\n',
    good.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'),
    good.replace('GENIE_DRAFT_PREPARED', ''),
    good.replace('\"caseId\":\"launch\"', '\"caseId\":\"native-back\"'),
    good.replace('\"passed\":true', '\"passed\":false'),
    good.split('\n').slice(1).join('\n'),
  ]) assert.throws(() => parseInstrumentation({ status: 0, stdout }, 'first'));
  assert.throws(() => parseInstrumentation({ status: 1, stdout: good }, 'first'), { code: 'INSTRUMENTATION_DID_NOT_PASS' });
});

test('requires exactly one well-formed prepared PID receipt, never a bare marker or duplicate', () => {
  const good = phaseOutput('first'), marker = preparedReceipt(4242);
  const parse = stdout => parseInstrumentation({ status: 0, stdout }, 'first');
  for (const raw of ['null', '[]', '{}', '{', '{"schemaVersion":1}',
    '{"schemaVersion":1,"pid":0}', '{"schemaVersion":1,"pid":-1}', '{"schemaVersion":1,"pid":1.5}',
    '{"schemaVersion":1,"pid":"4242"}', '{"schemaVersion":1,"pid":2147483648}',
    '{"schemaVersion":2,"pid":4242}', '{"schemaVersion":1,"pid":4242,"pid":4243}',
    '{"schemaVersion":1,"pid":4242,"\\u0070id":4243}',
    '{"schemaVersion":1,"pid":4242,"\\u0073chemaVersion":1}',
    '{"schemaVersion":1,"schemaVersion":1,"pid":4242}', '{"schemaVersion":1,"pid":4242,"extra":true}',
    ' '.repeat(128) + '{"schemaVersion":1,"pid":4242}',
  ]) assert.throws(() => parse(good.replace(marker, 'GENIE_DRAFT_PREPARED ' + raw)), { code: 'MALFORMED_DRAFT_PREPARATION' });
  assert.throws(() => parse(good.replace(marker, 'GENIE_DRAFT_PREPARED')), { code: 'MALFORMED_DRAFT_PREPARATION' });
  for (const stdout of [good.replace(marker, ''), good + marker + '\n', good + preparedReceipt(4243) + '\n']) {
    assert.throws(() => parse(stdout), { code: 'MISSING_OR_DUPLICATE_DRAFT_PREPARATION' });
  }
  assert.throws(() => parseInstrumentation({ status: 0, stdout: phaseOutput('restore') + marker + '\n' }, 'restore'),
    { code: 'MISSING_OR_DUPLICATE_DRAFT_PREPARATION' });
  assert.equal(parse(good.replace(marker, 'GENIE_DRAFT_PREPARED {"pid":4242,"schemaVersion":1}')).preparedPid, 4242);
});

const boundaryFixture = (t, replacements = {}) => {
  const workDir = temp(t), calls = [];
  const receipt = { cases: [], preparedProcessPreserved: false, forceStopConfirmed: false };
  const results = [
    { status: 0, stdout: 'Status: ok\n' }, { status: 0, stdout: '4242\n' },
    { status: 0, stdout: phaseOutput('first') }, { status: 0, stdout: '4242\n' },
    { status: 0, stdout: '' }, { status: 1, stdout: '', stderr: '' },
  ].map((result, index) => replacements[index] ?? result);
  return { workDir, calls, receipt, run: () => prepareDraftAndForceStop({ workDir, receipt,
    adb: async (args, timeout) => {
      calls.push({ args, timeout });
      assert.ok(calls.length <= results.length, 'unexpected command or fallback');
      return results[calls.length - 1];
    },
  }) };
};

test('stops the same prepared process after normal JUnit success, without an intermediate relaunch', async t => {
  const fixture = boundaryFixture(t);
  await fixture.run();
  const pidArgs = ['-s', 'emulator-5554', 'shell', 'pidof', FIXTURE_APP_ID];
  assert.deepEqual(fixture.calls.map(call => call.args), [
    ['-s', 'emulator-5554', 'shell', 'am', 'start', '-W', '-n', FIXTURE_APP_ID + '/' + FIXTURE_APP_ID + '.MainActivity'],
    pidArgs, instrumentationArgs('first'), pidArgs,
    ['-s', 'emulator-5554', 'shell', 'am', 'force-stop', FIXTURE_APP_ID], pidArgs,
  ]);
  assert.equal(fixture.calls[2].timeout, 120_000);
  assert.deepEqual([fixture.receipt.prelaunchPid, fixture.receipt.preparedPid, fixture.receipt.pidBeforeForceStop], [4242, 4242, 4242]);
  assert.equal(fixture.receipt.preparedProcessPreserved, true);
  assert.equal(fixture.receipt.forceStopConfirmed, true);
  assert.equal(fixture.receipt.cases.length, 3);
  assert.equal(readFileSync(path.join(fixture.workDir, 'phase-first.log'), 'utf8'), phaseOutput('first'));
});

test('fails before instrumentation when prelaunch fails or its PID is absent, ambiguous or invalid', async t => {
  const launchFailure = boundaryFixture(t, { 0: { status: 1, stdout: '' } });
  await assert.rejects(launchFailure.run(), { code: 'APP_PRELAUNCH_FAILED' });
  assert.equal(launchFailure.calls.length, 1);
  for (const result of [{ status: 1, stdout: '' }, { status: 0, stdout: '' },
    { status: 0, stdout: '4242 4243\n' }, { status: 0, stdout: '0\n' }, { status: 0, stdout: '2147483648\n' },
    { status: 0, stdout: '4242\n', stderr: 'unexpected error' }]) {
    const fixture = boundaryFixture(t, { 1: result });
    await assert.rejects(fixture.run(), { code: 'APP_NOT_RUNNING_BEFORE_INSTRUMENTATION' });
    assert.equal(fixture.calls.length, 2);
    assert.equal(existsSync(path.join(fixture.workDir, 'phase-first.log')), false);
    assert.equal(fixture.receipt.forceStopConfirmed, false);
  }
});

test('does not fall back or stop another process when attachment fails or the prepared PID changes', async t => {
  for (const [result, code] of [
    [{ status: 0, stdout: 'INSTRUMENTATION_FAILED: unsupported --no-restart\n' }, 'INSTRUMENTATION_DID_NOT_PASS'],
    [{ status: 0, stdout: phaseOutput('first') + 'INSTRUMENTATION_ABORTED\n' }, 'INSTRUMENTATION_DID_NOT_PASS'],
    [{ status: 0, stdout: phaseOutput('first', 4243) }, 'PREPARED_PROCESS_CHANGED'],
    [{ status: 0, stdout: phaseOutput('first').replace(preparedReceipt(4242), '') }, 'MISSING_OR_DUPLICATE_DRAFT_PREPARATION'],
  ]) {
    const fixture = boundaryFixture(t, { 2: result });
    await assert.rejects(fixture.run(), { code });
    assert.equal(fixture.calls.length, 3);
    assert.equal(fixture.receipt.preparedProcessPreserved, false);
    assert.equal(fixture.receipt.forceStopConfirmed, false);
  }
});

test('rejects a prepared process that vanishes, changes or becomes ambiguous after JUnit completion', async t => {
  for (const [result, code] of [
    [{ status: 1, stdout: '' }, 'PREPARED_PROCESS_NOT_RUNNING'],
    [{ status: 0, stdout: '4243\n' }, 'PREPARED_PROCESS_CHANGED'],
    [{ status: 0, stdout: '4242 4243\n' }, 'PREPARED_PROCESS_NOT_RUNNING'],
    [{ status: 0, stdout: '4242\n', stderr: 'unexpected error' }, 'PREPARED_PROCESS_NOT_RUNNING'],
  ]) {
    const fixture = boundaryFixture(t, { 3: result });
    await assert.rejects(fixture.run(), { code });
    assert.equal(fixture.calls.length, 4);
    assert.equal(fixture.receipt.preparedProcessPreserved, false);
    assert.equal(fixture.receipt.forceStopConfirmed, false);
  }
});

test('requires the host stop to succeed and the target PID to be absent before restore is allowed', async t => {
  const stopFailure = boundaryFixture(t, { 4: { status: 1, stdout: '' } });
  await assert.rejects(stopFailure.run(), { code: 'HOST_FORCE_STOP_FAILED' });
  assert.equal(stopFailure.calls.length, 5);
  assert.equal(stopFailure.receipt.forceStopConfirmed, false);
  for (const result of [{ status: 0, stdout: '4242\n' }, { status: 0, stdout: '' },
    { status: 1, stdout: '4242\n' }, { status: 1, stdout: '', stderr: 'unexpected error' }]) {
    const fixture = boundaryFixture(t, { 5: result });
    await assert.rejects(fixture.run(), { code: 'APP_FORCE_STOP_NOT_CONFIRMED' });
    assert.equal(fixture.calls.length, 6);
    assert.equal(fixture.receipt.preparedProcessPreserved, true);
    assert.equal(fixture.receipt.forceStopConfirmed, false);
  }
});

const syntheticPng = (width = 640, height = 1280) => {
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
};

test('failure PNG evidence requires the fixed name, regular small complete PNG and exact dimensions', t => {
  const work = temp(t), file = path.join(work, 'failure.png'), bytes = syntheticPng();
  writeFileSync(file, bytes);
  assert.deepEqual(inspectFailurePng(file), { file: 'failure.png', bytes: bytes.length,
    sha256: hash('sha256', bytes), width: 640, height: 1280 });
  for (const invalid of [Buffer.from('not an image'), bytes.subarray(0, -12), syntheticPng(640, 1279), Buffer.alloc(1_048_577)]) {
    writeFileSync(file, invalid);
    assert.throws(() => inspectFailurePng(file), { code: 'INVALID_FAILURE_PNG' });
  }
  rmSync(file);
  const other = path.join(work, 'other.png'); writeFileSync(other, bytes); symlinkSync(other, file);
  assert.throws(() => inspectFailurePng(file), { code: 'INVALID_FAILURE_PNG' });
  assert.throws(() => inspectFailurePng(other), { code: 'INVALID_FAILURE_PNG' });
});

test('failure capture writes only the small PNG and fixed nonprivate state, with partial cases separate', async t => {
  const workDir = temp(t), calls = [], bytes = syntheticPng();
  const result = await captureFailureEvidence({ workDir, emulatorAlive: true,
    receipt: { sourceCommit: 'a'.repeat(40), failureCode: 'INSTRUMENTATION_DID_NOT_PASS',
      observedPassedCaseIds: ['launch', 'unrecognized-case'], privateValue: 'never-publish', allFourCasesPassed: true,
      failureScreenshotBeforeExit: true },
    adb: async args => { calls.push(args); if (args[2] === 'pull') writeFileSync(args[4], bytes); return { status: 0 }; },
  });
  assert.equal(result.saved, true); assert.equal(result.captureError, null);
  assert.deepEqual(calls.map(args => args.slice(2, 4)), [['pull', '/data/local/tmp/genie-device-failure.png'], ['shell', 'rm']]);
  const raw = readFileSync(path.join(workDir, 'diagnostics/state.json'), 'utf8'), state = JSON.parse(raw);
  assert.equal(state.allFourCasesPassed, false);
  assert.deepEqual(state.observedPassedCaseIds, ['launch']);
  assert.equal(state.screenshot.sha256, hash('sha256', bytes));
  assert.equal(state.screenshotTiming, 'before-test-exit');
  assert.equal(raw.includes('never-publish'), false);
  assert.deepEqual(readFileSync(path.join(workDir, 'diagnostics/failure.png')), bytes);
});

test('failure capture rejects bad image and preserves original failure when capture or cleanup fails', async t => {
  const workDir = temp(t), calls = [];
  const result = await captureFailureEvidence({ workDir, emulatorAlive: true,
    receipt: { failureCode: 'ORIGINAL_TOUCH_FAILURE', observedPassedCaseIds: ['launch'] },
    adb: async args => {
      calls.push(args);
      if (args[2] === 'pull') writeFileSync(args[4], 'not a screenshot');
      if (args[3] === 'rm') throw new Error('private diagnostic must not escape');
      return { status: 0 };
    },
  });
  assert.equal(result.saved, true); assert.equal(result.captureError, 'INVALID_FAILURE_PNG');
  assert.equal(existsSync(path.join(workDir, 'diagnostics/failure.png')), false);
  const state = JSON.parse(readFileSync(path.join(workDir, 'diagnostics/state.json'), 'utf8'));
  assert.equal(state.failureCode, 'ORIGINAL_TOUCH_FAILURE'); assert.equal(state.screenshot, null);
  assert.equal(state.allFourCasesPassed, false); assert.equal(calls.length, 3);
});
