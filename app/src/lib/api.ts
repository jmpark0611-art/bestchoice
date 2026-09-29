import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  analysisSchema,
  clarificationSchema,
  envelopeSchema,
  type Analysis,
  type Answer,
  type ChoiceType,
  type Clarification,
  type DecisionStatus,
  type Envelope,
} from './contract';
import { AppError, codeFromRpcMessage } from './errors';
import { getSupabase } from './supabase';

export type DecisionSummary = {
  id: string;
  concern: string;
  summary: string | null;
  status: DecisionStatus;
  createdAt: string;
  choiceType: ChoiceType | null;
};

export type DecisionDetail = DecisionSummary & {
  safetyMode: 'normal' | 'high_stakes' | 'crisis';
  clarification: Clarification | null;
  analysis: Analysis | null;
  choiceNote: string;
};

function rpcError(error: { message?: string } | null): never {
  throw new AppError(codeFromRpcMessage(error?.message));
}

export async function createDecision(concern: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await getSupabase().rpc('bc_create_decision', { p_id: id, p_concern: concern.trim() });
  if (error) rpcError(error);
  return id;
}

type DecisionRow = {
  id: string;
  concern_text: string;
  summary: string | null;
  status: DecisionStatus;
  created_at: string;
  safety_mode: DecisionDetail['safetyMode'];
  clarification_json: unknown;
  bc_actual_choices: { choice_type: ChoiceType; choice_note: string } | null;
  bc_decision_results: { result_json: unknown } | null;
};

export async function listDecisions(limit = 50): Promise<DecisionSummary[]> {
  const { data, error } = await getSupabase()
    .from('bc_decisions')
    .select('id, concern_text, summary, status, created_at, bc_actual_choices(choice_type)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) rpcError(error);
  return (data as unknown as DecisionRow[]).map((r) => ({
    id: r.id,
    concern: r.concern_text,
    summary: r.summary,
    status: r.status,
    createdAt: r.created_at,
    choiceType: r.bc_actual_choices?.choice_type ?? null,
  }));
}

export async function getDecision(id: string): Promise<DecisionDetail> {
  const { data, error } = await getSupabase()
    .from('bc_decisions')
    .select(
      'id, concern_text, summary, status, created_at, safety_mode, clarification_json, bc_actual_choices(choice_type, choice_note), bc_decision_results(result_json)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new AppError('NOT_FOUND');
  const r = data as unknown as DecisionRow;
  const clarification = clarificationSchema.safeParse(r.clarification_json);
  const analysis = analysisSchema.safeParse(r.bc_decision_results?.result_json);
  return {
    id: r.id,
    concern: r.concern_text,
    summary: r.summary,
    status: r.status,
    createdAt: r.created_at,
    safetyMode: r.safety_mode,
    clarification: clarification.success ? clarification.data : null,
    analysis: analysis.success ? analysis.data : null,
    choiceType: r.bc_actual_choices?.choice_type ?? null,
    choiceNote: r.bc_actual_choices?.choice_note ?? '',
  };
}

export async function requestAI(args: {
  decisionId: string;
  stage: 'clarify' | 'analyze';
  answers?: Answer[];
}): Promise<Envelope> {
  const { data, error } = await getSupabase().functions.invoke('decision-ai', {
    body: {
      decisionId: args.decisionId,
      requestId: crypto.randomUUID(),
      stage: args.stage,
      answers: args.answers ?? [],
    },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let code = 'AI_FAILED';
      try {
        code = ((await error.context.json()) as { error?: string }).error ?? code;
      } catch {
        // 본문이 JSON이 아니면 기본 코드 사용
      }
      throw new AppError(code);
    }
    throw new AppError('NETWORK');
  }
  const parsed = envelopeSchema.safeParse(data);
  if (!parsed.success) throw new AppError('MODEL_FORMAT');
  return parsed.data;
}

export async function saveActualChoice(decisionId: string, choiceType: ChoiceType, note: string): Promise<void> {
  const { error } = await getSupabase().rpc('bc_save_actual_choice', {
    p_decision_id: decisionId,
    p_choice_type: choiceType,
    p_note: note.trim(),
  });
  if (error) rpcError(error);
}

export async function deleteDecision(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('bc_delete_decision', { p_id: id });
  if (error) rpcError(error);
}

export async function deleteAllDecisions(): Promise<number> {
  const { data, error } = await getSupabase().rpc('bc_delete_my_decisions');
  if (error) rpcError(error);
  return data as number;
}

/** 계정과 모든 기록을 즉시 삭제하고 로그아웃 */
export async function deleteAccount(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc('bc_delete_account');
  if (error) rpcError(error);
  await sb.auth.signOut({ scope: 'local' });
}
