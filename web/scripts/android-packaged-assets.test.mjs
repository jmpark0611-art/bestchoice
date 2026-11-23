import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packagedAssetsCheckJob } from './android-packaged-assets.mjs';
import { findExecutable } from './android-release-environment.mjs';
import { digest } from './android-release-manifest.mjs';

// Only Python's standard-library ZIP reader runs. Synthetic manifest and dex
// bytes below are NOT an Android bundle and do not establish a native build.
test('the real ZIP program supports portable inventory checks and refuses signing metadata only in unsigned mode', t => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'genie-package-check-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const python = findExecutable('python3', process.env);
  assert.ok(python, 'An existing Python interpreter is required; this test installs nothing.');
  const assetRoot = path.join(base, 'assets');
  mkdirSync(path.join(assetRoot, 'public'), { recursive: true });
  writeFileSync(path.join(assetRoot, 'public/index.html'), 'SYNTHETIC_ASSET');
  const expectedAssets = [{ path: 'public/index.html', sha256: digest('SYNTHETIC_ASSET') }];
  const libraryAssets = { 'base/assets/native-bridge.js': digest('SYNTHETIC_BRIDGE') };
  const env = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' };
  const setup = spawnSync(python, ['-I', '-c',
    'import pathlib,sys,zipfile\n' +
    'for kind in ("exact","signature","changed"):\n' +
    ' with zipfile.ZipFile(pathlib.Path(sys.argv[1])/(kind+".zip"),"w") as z:\n' +
    '  z.writestr("base/manifest/AndroidManifest.xml","INERT_NOT_PROTOBUF")\n' +
    '  z.writestr("base/dex/classes.dex","INERT_NOT_DEX")\n' +
    '  z.writestr("base/assets/public/index.html","CHANGED" if kind=="changed" else "SYNTHETIC_ASSET")\n' +
    '  z.writestr("base/assets/native-bridge.js","SYNTHETIC_BRIDGE")\n' +
    '  if kind=="signature": z.writestr("meta-inf/UPLOAD.sF","INERT_NOT_A_SIGNATURE")\n', base],
  { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(setup.status, 0, setup.stderr);
  for (const inventoryMode of [false, true]) for (const requireUnsigned of [false, true]) for (const kind of ['exact', 'signature', 'changed']) {
    const job = packagedAssetsCheckJob({ pythonExecutable: python, artifactPath: path.join(base, `${kind}.zip`),
      ...(inventoryMode ? { expectedAssets } : { assetRoot }), libraryAssets, cwd: base, env, requireUnsigned });
    const result = spawnSync(job.command, ['-I', ...job.args], { cwd: job.cwd, env: job.env, encoding: 'utf8', timeout: 5000 });
    const accepted = kind === 'exact' || (kind === 'signature' && !requireUnsigned);
    assert.equal(result.status === 0, accepted, result.stderr || result.stdout);
    if (accepted) assert.match(result.stdout, /^AAB_ASSETS_MATCH\s*$/);
    else {
      assert.equal(result.stdout.includes('AAB_ASSETS_MATCH'), false);
      const report = JSON.parse(result.stdout.replace('AAB_PACKAGE_DIAGNOSTICS ', ''));
      if (kind === 'signature') assert.deepEqual(report.signatureMetadata, ['meta-inf/UPLOAD.sF']);
      else assert.deepEqual(report.changed, ['base/assets/public/index.html']);
    }
  }
});

test('portable inventories cannot authorize escaping paths, duplicate assets or additional library allowances', () => {
  const common = { pythonExecutable: '/inert/python3', artifactPath: '/inert/app.aab', cwd: '/inert', env: {},
    libraryAssets: { 'base/assets/native-bridge.js': digest('INERT_BRIDGE') } };
  const valid = { path: 'public/index.html', sha256: digest('INERT_ASSET') };
  for (const expectedAssets of [[{ ...valid, path: '../escape' }], [{ ...valid, path: '/absolute' }],
    [{ ...valid, path: 'public\\escape' }], [valid, valid], [{ ...valid, sha256: 'not-a-hash' }]]) {
    assert.throws(() => packagedAssetsCheckJob({ ...common, expectedAssets }), /INVALID_PACKAGE_CHECK_INPUT/);
  }
  assert.throws(() => packagedAssetsCheckJob({ ...common, expectedAssets: [valid],
    libraryAssets: { ...common.libraryAssets, 'base/assets/extra.js': digest('EXTRA') } }), /INVALID_PACKAGE_CHECK_INPUT/);
});
