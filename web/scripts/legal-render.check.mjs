import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readFileSync as read } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATE_FILES, PLACEHOLDERS, templateDir, checkTemplate, render } from './legal-render.mjs';

const templates = Object.fromEntries(TEMPLATE_FILES.map((n) => [n, readFileSync(path.join(templateDir, n), 'utf8')]));

test('final templates keep only the three operator-decided placeholders and no draft wording', () => {
  for (const [name, html] of Object.entries(templates)) assert.deepEqual(checkTemplate(name, html), []);
});

test('rendering requires all three values and leaves no placeholder', () => {
  const values = { date: '2026-11-28', operator: '에스제이컴퍼니(대표 박지민)', email: 'owner@example.com' };
  for (const html of Object.values(templates)) {
    const out = render(html, values);
    for (const token of PLACEHOLDERS) assert.ok(!out.includes(token));
    assert.match(out, /2026년 11월 28일/);
    assert.match(out, /mailto:owner@example\.com/);
  }
  assert.throws(() => render(templates['privacy.html'], { ...values, date: '28-11-2026' }));
  assert.throws(() => render(templates['privacy.html'], { ...values, email: 'not-an-email' }));
  assert.throws(() => render(templates['privacy.html'], { ...values, operator: ' ' }));
});

test('operator text is escaped and the CLI refuses to publish with missing values', () => {
  const out = render(templates['delete-data.html'], { date: '2026-12-01', operator: 'A<b>&"', email: 'a@b.co' });
  assert.ok(!out.includes('A<b>'));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'legal-'));
  const cli = path.join(templateDir, '..', '..', 'scripts', 'legal-render.mjs');
  const bad = spawnSync(process.execPath, [cli, '--out', dir, '--date', '2026-12-01'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  const good = spawnSync(process.execPath, [cli, '--out', dir, '--date', '2026-12-01', '--operator', 'X', '--email', 'a@b.co'], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.match(read(path.join(dir, 'privacy.html'), 'utf8'), /2026년 12월 1일/);
});
