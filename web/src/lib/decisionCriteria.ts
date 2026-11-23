/** The existing decision endpoint accepts a combined context of at most 60 UTF-16 code units. */
export const DECISION_NOTE_MAX = 60;

export const DECISION_CRITERIA = [
  { id: 'none', label: '기준 없이' },
  { id: 'cost', label: '비용 절약' },
  { id: 'time', label: '시간 절약' },
  { id: 'ease', label: '편리함' },
  { id: 'satisfaction', label: '내 만족' },
] as const;

export type CriterionId = (typeof DECISION_CRITERIA)[number]['id'];

export function isCriterionId(value: unknown): value is CriterionId {
  return DECISION_CRITERIA.some((criterion) => criterion.id === value);
}

export type ComposedDecisionNote = {
  /** Complete context sent through the existing note field; never silently shortened. */
  note: string;
  isValid: boolean;
  length: number;
  remaining: number;
  overBy: number;
};

/**
 * Keep criteria readable in both the AI request and the shared question.
 * Quick mode skips free text only, so an explicitly selected criterion still applies.
 * Callers must check isValid before submitting and retain their original input state.
 */
export function composeNote(input: {
  note: string;
  criterion: CriterionId;
  quickMode: boolean;
}): ComposedDecisionNote {
  const criterion = DECISION_CRITERIA.find((item) => item.id === input.criterion);
  const prefix = criterion && criterion.id !== 'none' ? `중요한 기준: ${criterion.label}` : '';
  const context = input.quickMode ? '' : input.note.trim();
  const note = [prefix, context].filter(Boolean).join('\n');
  // JavaScript string length intentionally matches the existing client and Zod server limit.
  const length = note.length;
  return {
    note,
    isValid: length <= DECISION_NOTE_MAX,
    length,
    remaining: Math.max(0, DECISION_NOTE_MAX - length),
    overBy: Math.max(0, length - DECISION_NOTE_MAX),
  };
}
