import fs from 'node:fs';
import path from 'node:path';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    values[key] = value;
  }
  return values;
}

const cwd = process.cwd();
const env = {
  ...readEnv(path.join(cwd, '.env')),
  ...readEnv(path.join(cwd, '.env.local')),
  ...process.env,
};
const failures = [];
const url = env.VITE_SUPABASE_URL ?? '';
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

if (url !== 'https://njrtcxohbkfgrgwhlvua.supabase.co') failures.push('VITE_SUPABASE_URL이 Bestchoice 프로젝트와 일치하지 않습니다.');
if (!key.startsWith('sb_publishable_') || key.includes('xxx')) failures.push('VITE_SUPABASE_PUBLISHABLE_KEY가 실제 publishable 키가 아닙니다.');
if (env.VITE_ENABLE_AI !== 'true') failures.push('VITE_ENABLE_AI=true가 아닙니다. AI가 꺼진 번들은 출시할 수 없습니다.');

for (const file of ['../docs/legal/privacy-policy.md', '../docs/legal/terms-of-service.md']) {
  const content = fs.readFileSync(path.resolve(cwd, file), 'utf8');
  if (!content.includes('시행일: 2026년 10월 15일')) failures.push(`${file}의 시행일이 확정되지 않았습니다.`);
}

if (failures.length) {
  console.error('출시 사전점검 실패:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('출시 사전점검 통과: Supabase 설정, AI 활성화, 정책 시행일을 확인했습니다.');
