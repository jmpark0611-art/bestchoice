import { z } from 'zod';

// decision-ai Edge Function(supabase/functions/decision-ai)의 응답 계약과 동일하게 유지할 것

export const CONCERN_MIN = 20;
export const CONCERN_MAX = 1000;
export const NOTE_MAX = 300;
export const TEXT_ANSWER_MAX = 500;

const boundedText = z.string().trim().min(1).max(2000);
const option = z.object({ id: z.string().min(1), label: boundedText });

export const questionSchema = z.object({
  id: z.string().min(1),
  text: boundedText,
  inputType: z.enum(['single', 'multiple', 'text']),
  choices: z.array(option).min(2).max(8).nullable().optional(),
  required: z.literal(true),
});

export const clarificationSchema = z.object({
  summary: boundedText,
  category: z.enum(['career', 'money', 'relationship', 'growth', 'health', 'timing', 'choice', 'other']),
  options: z.array(option).min(2).max(6),
  questions: z.array(questionSchema).length(3),
  safetyMode: z.enum(['normal', 'high_stakes']),
});

export const AXIS_KEYS = ['purpose', 'cost', 'risk', 'reversibility', 'long_term', 'priority'] as const;

export const analysisSchema = z.object({
  summary: boundedText,
  recommendation: z.object({ optionId: z.string().min(1), label: boundedText, rationale: boundedText }),
  confidence: z.enum(['weak', 'medium', 'strong']),
  confidenceReason: boundedText,
  axes: z
    .array(
      z.object({
        key: z.enum(AXIS_KEYS),
        score: z.number().int().min(1).max(5),
        rationale: boundedText,
        uncertainty: boundedText.nullable(),
      }),
    )
    .length(6),
  missedFactors: z.array(boundedText).min(1).max(3),
  nextAction: z.object({ text: boundedText, timeframeHours: z.number().int().min(24).max(72) }),
  switchConditions: z.array(boundedText).min(1).max(5),
  disclaimer: boundedText,
});

export const envelopeSchema = z.object({
  kind: z.enum(['clarification', 'analysis', 'crisis']),
  safetyMode: z.enum(['normal', 'high_stakes', 'crisis']),
  clarification: clarificationSchema.nullable(),
  analysis: analysisSchema.nullable(),
});

export type Question = z.infer<typeof questionSchema>;
export type Clarification = z.infer<typeof clarificationSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type AnswerValue = string | string[];
export type Answer = { questionId: string; value: AnswerValue };

export type DecisionStatus = 'draft' | 'clarifying' | 'analyzing' | 'completed' | 'failed' | 'crisis';
export type ChoiceType = 'followed' | 'other' | 'undecided';

export const AXIS_LABELS: Record<(typeof AXIS_KEYS)[number], string> = {
  purpose: '목적 부합',
  cost: '비용 감당',
  risk: '위험 통제',
  reversibility: '되돌리기 쉬움',
  long_term: '장기 이익',
  priority: '우선순위',
};

export const CONFIDENCE_LABELS: Record<Analysis['confidence'], string> = {
  weak: '판단 강도 약함',
  medium: '판단 강도 보통',
  strong: '판단 강도 강함',
};

export const CHOICE_LABELS: Record<ChoiceType, string> = {
  followed: '추천대로 했어요',
  other: '다른 선택을 했어요',
  undecided: '아직 못 정했어요',
};

/** 추천 optionId가 선택지가 아닌 특수값일 때의 표시 문구 */
export function recommendationLabel(analysis: Analysis): string {
  if (analysis.recommendation.optionId === 'wait') return '지금은 결정을 미루기';
  if (analysis.recommendation.optionId === 'insufficient') return '정보가 더 필요해요';
  return analysis.recommendation.label;
}

export function concernError(text: string): string | null {
  const len = text.trim().length;
  if (len < CONCERN_MIN) return `상황을 ${CONCERN_MIN}자 이상 적어주세요. (${len}/${CONCERN_MIN})`;
  if (len > CONCERN_MAX) return `${CONCERN_MAX.toLocaleString()}자 이내로 적어주세요.`;
  return null;
}

/** 질문 3개에 모두 유효한 답을 했는지 */
export function answersComplete(questions: Question[], answers: Record<string, AnswerValue | undefined>): boolean {
  return questions.every((q) => {
    const v = answers[q.id];
    if (q.inputType === 'text') return typeof v === 'string' && v.trim().length > 0 && v.length <= TEXT_ANSWER_MAX;
    if (q.inputType === 'single') return typeof v === 'string' && v.length > 0;
    return Array.isArray(v) && v.length > 0;
  });
}

export function toAnswerList(questions: Question[], answers: Record<string, AnswerValue | undefined>): Answer[] {
  return questions.map((q) => {
    const v = answers[q.id] ?? '';
    return { questionId: q.id, value: typeof v === 'string' ? v.trim() : v };
  });
}
