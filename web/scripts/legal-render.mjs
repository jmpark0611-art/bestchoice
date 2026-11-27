// Renders the public privacy.html / delete-data.html from web/release-assets/legal templates.
// The templates keep exactly three placeholders that the operator must decide:
//   {{EFFECTIVE_DATE}} (YYYY-MM-DD), {{OPERATOR_NAME}}, {{CONTACT_EMAIL}}.
// Usage:
//   node scripts/legal-render.mjs --check
//   node scripts/legal-render.mjs --date 2026-11-28 --operator "에스제이컴퍼니(대표 박지민)" --email jmpark0611@gmail.com [--out public]
// Output defaults to web/public (published as /privacy.html and /delete-data.html by the web deploy).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_FILES = ['privacy.html', 'delete-data.html'];
export const PLACEHOLDERS = ['{{EFFECTIVE_DATE}}', '{{OPERATOR_NAME}}', '{{CONTACT_EMAIL}}'];
const DRAFT_WORDING = /검토본|게시 전|확정 항목|정식 공개 전|확인 중|확인해야|아직 정하지|noindex/;
const here = path.dirname(fileURLToPath(import.meta.url));
export const templateDir = path.join(here, '..', 'release-assets', 'legal');

const escapeHtml = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function checkTemplate(name, html) {
  const problems = [];
  const found = new Set(html.match(/\{\{[^}]*\}\}/g) ?? []);
  for (const token of found) if (!PLACEHOLDERS.includes(token)) problems.push(`unexpected placeholder ${token}`);
  for (const token of PLACEHOLDERS) if (!html.includes(token)) problems.push(`missing placeholder ${token}`);
  const draft = html.match(DRAFT_WORDING);
  if (draft) problems.push(`draft wording "${draft[0]}"`);
  return problems.map((p) => `${name}: ${p}`);
}

export function render(html, { date, operator, email }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(Date.parse(date))) throw new Error('--date must be YYYY-MM-DD');
  if (!operator?.trim()) throw new Error('--operator is required');
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email ?? '')) throw new Error('--email must be a valid address');
  const [y, m, d] = date.split('-').map(Number);
  const out = html
    .replaceAll('{{EFFECTIVE_DATE}}', `${y}년 ${m}월 ${d}일`)
    .replaceAll('{{OPERATOR_NAME}}', escapeHtml(operator.trim()))
    .replaceAll('{{CONTACT_EMAIL}}', escapeHtml(email.trim()));
  if (/\{\{[^}]*\}\}/.test(out)) throw new Error('unresolved placeholder left in output');
  return out;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sources = TEMPLATE_FILES.map((name) => [name, readFileSync(path.join(templateDir, name), 'utf8')]);
  const problems = sources.flatMap(([name, html]) => checkTemplate(name, html));
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  if (argv.includes('--check')) { console.log(`templates ok: ${TEMPLATE_FILES.join(', ')}`); process.exit(0); }
  try {
    const outDir = path.resolve(arg(argv, '--out') ?? path.join(here, '..', 'public'));
    const values = { date: arg(argv, '--date'), operator: arg(argv, '--operator'), email: arg(argv, '--email') };
    mkdirSync(outDir, { recursive: true });
    for (const [name, html] of sources) writeFileSync(path.join(outDir, name), render(html, values));
    console.log(`rendered ${TEMPLATE_FILES.join(', ')} -> ${outDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
