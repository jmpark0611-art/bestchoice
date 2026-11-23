import type { Poll } from './api';
import { composeNote, DECISION_CRITERIA, DECISION_NOTE_MAX, isCriterionId } from './decisionCriteria';
import type { HomeDraftInput } from './decisionDrafts';

export type ReconsiderInput = Omit<HomeDraftInput, 'quickMode' | 'sourceId'> & {
  quickMode: false;
  sourceId: string;
};
export type ReconsiderState = { kind: 'genie-reconsider'; version: 1; input: ReconsiderInput };

const OPTION_MAX = 20;
const INPUT_KEYS = ['a', 'b', 'note', 'criterion', 'quickMode', 'sourceId'] as const;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hasExactlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
};
const isOption = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= OPTION_MAX && !/[\r\n]/.test(value);

function isInput(value: unknown): value is ReconsiderInput {
  return isRecord(value) && hasExactlyKeys(value, INPUT_KEYS) &&
    isOption(value.a) && isOption(value.b) && value.a.trim() !== value.b.trim() &&
    typeof value.note === 'string' && value.note.length <= DECISION_NOTE_MAX && !/[\r\n]/.test(value.note) &&
    isCriterionId(value.criterion) && value.quickMode === false && validId(value.sourceId) &&
    composeNote({ note: value.note, criterion: value.criterion, quickMode: false }).isValid;
}

function copyInput(input: ReconsiderInput): ReconsiderInput {
  return { a: input.a, b: input.b, note: input.note, criterion: input.criterion,
    quickMode: false, sourceId: input.sourceId };
}

/**
 * Reuse only an owner's inputs, never their previous result, votes, or private reflection.
 * A legacy multiline note cannot fit the current one-line form/draft contract. In that
 * case return null, keeping the original record available instead of changing its text.
 */
export function buildReconsideration(poll: Poll): ReconsiderInput | null {
  if (!poll || poll.isOwner !== true || !validId(poll.id) ||
      !isOption(poll.a) || !isOption(poll.b) ||
      (poll.note !== null && typeof poll.note !== 'string')) return null;
  const originalNote = poll.note ?? '';
  if (originalNote.length > DECISION_NOTE_MAX) return null;

  let note = originalNote;
  let criterion: ReconsiderInput['criterion'] = 'none';
  for (const item of DECISION_CRITERIA) {
    if (item.id === 'none') continue;
    const prefix = `중요한 기준: ${item.label}`;
    if (originalNote === prefix || originalNote.startsWith(`${prefix}\n`)) {
      criterion = item.id;
      note = originalNote === prefix ? '' : originalNote.slice(prefix.length + 1);
      break;
    }
  }

  const input: ReconsiderInput = { a: poll.a, b: poll.b, note, criterion, quickMode: false, sourceId: poll.id };
  return isInput(input) ? input : null;
}

/** A small versioned React Router state; building it never submits or changes a decision. */
export function makeReconsiderState(input: ReconsiderInput): ReconsiderState | null {
  return isInput(input) ? { kind: 'genie-reconsider', version: 1, input: copyInput(input) } : null;
}

/** Treat history state as untrusted input, including field sizes and combined note limit. */
export function readReconsiderState(value: unknown): ReconsiderInput | null {
  if (!isRecord(value) || !hasExactlyKeys(value, ['kind', 'version', 'input']) ||
      value.kind !== 'genie-reconsider' || value.version !== 1 || !isInput(value.input)) return null;
  return copyInput(value.input);
}
