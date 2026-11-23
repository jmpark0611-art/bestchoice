import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareLocalJdk, shellQuote } from './prepare-local-jdk.mjs';

function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'genie-java-adapter-safety-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('rejects relative and outside-workspace outputs before probing a runtime', t => {
  const workspaceRoot = temporary(t);
  assert.equal(prepareLocalJdk({ output: 'relative', workspaceRoot, javaExecutable: '/missing-java' }).errors[0].code, 'ABSOLUTE_OUTPUT_REQUIRED');
  const outside = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)}-outside`);
  assert.equal(prepareLocalJdk({ output: outside, workspaceRoot, javaExecutable: '/missing-java' }).errors[0].code, 'OUTPUT_OUTSIDE_WORKSPACE');
  assert.equal(existsSync(outside), false);
});

test('never overwrites an existing directory, file, or symlink, including a dangling symlink', t => {
  const workspaceRoot = temporary(t);
  const directory = path.join(workspaceRoot, 'existing');
  mkdirSync(directory);
  writeFileSync(path.join(directory, 'sentinel'), 'keep');
  const file = path.join(workspaceRoot, 'existing-file');
  writeFileSync(file, 'keep-file');
  const link = path.join(workspaceRoot, 'link');
  symlinkSync(directory, link, 'dir');
  const dangling = path.join(workspaceRoot, 'dangling');
  symlinkSync(path.join(workspaceRoot, 'absent'), dangling, 'dir');
  for (const output of [directory, file, link, dangling]) {
    assert.equal(prepareLocalJdk({ output, workspaceRoot, javaExecutable: '/missing-java' }).errors[0].code, 'OUTPUT_EXISTS');
  }
  assert.equal(readFileSync(path.join(directory, 'sentinel'), 'utf8'), 'keep');
  assert.equal(readFileSync(file, 'utf8'), 'keep-file');
});

test('rejects symlink parents instead of writing outside the workspace through them', t => {
  const workspaceRoot = temporary(t);
  const other = temporary(t);
  symlinkSync(other, path.join(workspaceRoot, 'redirect'), 'dir');
  const result = prepareLocalJdk({ output: path.join(workspaceRoot, 'redirect', 'adapter'), workspaceRoot, javaExecutable: '/missing-java' });
  assert.equal(result.errors[0].code, 'UNSAFE_OUTPUT_PARENT');
  assert.equal(existsSync(path.join(other, 'adapter')), false);
});

test('missing runtime leaves the explicitly new output uncreated', t => {
  const workspaceRoot = temporary(t);
  const output = path.join(workspaceRoot, 'new-adapter');
  const result = prepareLocalJdk({ output, workspaceRoot, javaExecutable: '/definitely-missing-java', env: {} });
  assert.equal(result.errors[0].code, 'JAVA_NOT_FOUND');
  assert.equal(existsSync(output), false);
});

test('launcher path quoting preserves apostrophes, spaces, dollar signs and command-substitution text literally', () => {
  const value = "adapter 'quoted' $(printf SHOULD_NOT_RUN) $HOME ; another argument";
  const result = spawnSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
});
