import fs from 'node:fs';
import path from 'node:path';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return [];
    const index = line.indexOf('=');
    if (index < 1) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const env = { ...readEnv(path.resolve('.env')), ...readEnv(path.resolve('.env.local')), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Supabase 환경설정이 없습니다.');

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const started = Date.now();
let decisionId;

async function invoke(body) {
  const { data, error } = await client.functions.invoke('decision-ai', { body });
  if (!error) return data;
  if (error instanceof FunctionsHttpError) {
    let detail = 'HTTP_ERROR';
    try { detail = (await error.context.json()).error ?? detail; } catch { /* no body */ }
    throw new Error(detail);
  }
  throw error;
}

try {
  const { data: auth, error: authError } = await client.auth.signInAnonymously();
  if (authError || !auth.user) throw authError ?? new Error('익명 로그인 실패');

  decisionId = crypto.randomUUID();
  const concern = '현재 회사에 남을지 새로운 회사로 이직할지 고민입니다. 성장 가능성과 안정성 중 무엇을 우선할지 결정하고 싶습니다.';
  const { error: createError } = await client.rpc('bc_create_decision', { p_id: decisionId, p_concern: concern });
  if (createError) throw createError;

  const clarification = await invoke({ decisionId, requestId: crypto.randomUUID(), stage: 'clarify', answers: [] });
  if (clarification?.kind !== 'clarification' || clarification.clarification?.questions?.length !== 3) throw new Error('질문 응답 계약 불일치');

  const answers = clarification.clarification.questions.map((question) => ({
    questionId: question.id,
    value: question.inputType === 'text' ? '성장 기회를 얻되 감당 가능한 위험 안에서 결정하고 싶습니다.' : question.inputType === 'multiple' ? [question.choices[0].id] : question.choices[0].id,
  }));
  const analysis = await invoke({ decisionId, requestId: crypto.randomUUID(), stage: 'analyze', answers });
  if (analysis?.kind !== 'analysis' || analysis.analysis?.axes?.length !== 6) throw new Error('분석 응답 계약 불일치');

  const { error: choiceError } = await client.rpc('bc_save_actual_choice', { p_decision_id: decisionId, p_choice_type: 'undecided', p_note: '자동 통합 테스트' });
  if (choiceError) throw choiceError;

  const { data: stored, error: readError } = await client.from('bc_decisions').select('status,bc_decision_results(result_json),bc_actual_choices(choice_type)').eq('id', decisionId).single();
  if (readError || stored.status !== 'completed' || !stored.bc_decision_results || !stored.bc_actual_choices) throw readError ?? new Error('저장 결과 검증 실패');

  console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - started, questions: 3, axes: 6, resultStored: true, choiceStored: true }));
} finally {
  const { data: session } = await client.auth.getSession();
  if (session.session) {
    const { error } = await client.rpc('bc_delete_account');
    if (error) console.error('테스트 계정 정리 실패:', error.code ?? error.message);
    await client.auth.signOut({ scope: 'local' });
  }
}
