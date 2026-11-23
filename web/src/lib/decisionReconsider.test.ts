import type { Poll } from './api';
import { composeNote, DECISION_CRITERIA } from './decisionCriteria';
import { buildReconsideration, makeReconsiderState, readReconsiderState, type ReconsiderInput } from './decisionReconsider';

const poll: Poll = {
  id: 'poll-original', a: '집에서 요리', b: '밖에서 식사', note: null,
  isOwner: true, myVote: null, shareCode: 'shared-original', did: 'b',
  createdAt: '2026-11-23T00:00:00Z', pick: 'a', reason: '기존 결론', votes: { a: 2, b: 3 },
};
const input: ReconsiderInput = {
  a: poll.a, b: poll.b, note: '오늘은 시간이 없어요', criterion: 'time', quickMode: false, sourceId: poll.id!,
};

describe('buildReconsideration', () => {
  it('copies only owner inputs from a frozen original, including an empty legacy note', () => {
    const original = Object.freeze({ ...poll, votes: Object.freeze({ a: 2, b: 3 }) });
    const before = JSON.stringify(original);
    expect(buildReconsideration(original)).toEqual({
      a: poll.a, b: poll.b, note: '', criterion: 'none', quickMode: false, sourceId: poll.id,
    });
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(DECISION_CRITERIA.filter(item => item.id !== 'none'))('restores known criterion $id and preserves context whitespace exactly', item => {
    const context = '  처음 적은 상황 그대로  ';
    const result = buildReconsideration({ ...poll, note: `중요한 기준: ${item.label}\n${context}` });
    expect(result).toEqual({ a: poll.a, b: poll.b, note: context, criterion: item.id, quickMode: false, sourceId: poll.id });
  });

  it('recognizes a known criterion with no context without adding a second prefix', () => {
    const result = buildReconsideration({ ...poll, note: '중요한 기준: 편리함' });
    expect(result).toMatchObject({ criterion: 'ease', note: '' });
    expect(composeNote(result!).note).toBe('중요한 기준: 편리함');
  });

  it.each([
    '중요한 기준: 비용 절약을 최우선으로',
    '중요한 기준: 건강',
    '중요한 기준: 기준 없이',
    ' 앞에 적은 말 중요한 기준: 시간 절약',
    ' 중요한 기준: 비용 절약',
    '중요한 기준: 비용 절약 ',
  ])('preserves an unrecognized one-line note without interpreting it: %s', note => {
    expect(buildReconsideration({ ...poll, note })).toMatchObject({ note, criterion: 'none' });
  });

  it.each([
    '중요한 기준: 비용 절약\n첫 줄\n다음 줄',
    '중요한 기준: 건강\n오늘의 상황',
    '중요한 기준: 시간 절약\r\n오늘의 상황',
    '첫 줄\n다음 줄',
  ])('refuses an unrepresentable multiline note instead of flattening or dropping it', note => {
    const original = { ...poll, note };
    expect(buildReconsideration(original)).toBeNull();
    expect(original.note).toBe(note);
  });

  it('uses UTF-16 limits and rejects excess instead of truncating options or context', () => {
    expect(buildReconsideration({ ...poll, a: '😀'.repeat(10), note: '😀'.repeat(30) })).not.toBeNull();
    expect(buildReconsideration({ ...poll, a: '😀'.repeat(11) })).toBeNull();
    expect(buildReconsideration({ ...poll, note: '😀'.repeat(30) + '가' })).toBeNull();
    const prefix = '중요한 기준: 비용 절약\n';
    const noteAtLimit = prefix + '가'.repeat(60 - prefix.length);
    expect(buildReconsideration({ ...poll, note: noteAtLimit })).not.toBeNull();
    expect(buildReconsideration({ ...poll, note: noteAtLimit + '나' })).toBeNull();
  });

  it.each([
    { isOwner: false }, { id: null }, { id: '../unsafe' }, { id: 'a'.repeat(129) },
    { a: '' }, { a: '   ' }, { a: '첫 줄\n둘째 줄' }, { a: '같음', b: ' 같음 ' },
  ])('refuses a non-owner or invalid original input (%j)', changes => {
    expect(buildReconsideration({ ...poll, ...changes })).toBeNull();
  });
});

describe('versioned reconsider route state', () => {
  it('round-trips explicit inputs using fresh objects with no old decision result', () => {
    const state = makeReconsiderState(input);
    expect(state).toEqual({ kind: 'genie-reconsider', version: 1, input });
    expect(state!.input).not.toBe(input);
    const restored = readReconsiderState(state);
    expect(restored).toEqual(input);
    expect(restored).not.toBe(state!.input);
    restored!.note = '복원한 뒤 수정';
    expect(input.note).toBe('오늘은 시간이 없어요');
    expect(state!.input.note).toBe('오늘은 시간이 없어요');
  });

  it.each([
    null, [], 'genie-reconsider', {},
    { kind: 'another-feature', version: 1, input },
    { kind: 'genie-reconsider', version: 2, input },
    { kind: 'genie-reconsider', version: 1, input, autoSubmit: true },
    { kind: 'genie-reconsider', version: 1, input: { ...input, quickMode: true } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, sourceId: undefined } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, sourceId: '/p/p1' } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, criterion: 'unknown' } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, privateReflection: 'never copy this' } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, note: '가'.repeat(60), criterion: 'cost' } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, note: '첫 줄\n다음 줄' } },
    { kind: 'genie-reconsider', version: 1, input: { ...input, a: '😀'.repeat(11) } },
  ])('rejects invalid, unexpected, or oversized history state', state => {
    expect(readReconsiderState(state)).toBeNull();
  });

  it('validates runtime input even when called from typed code', () => {
    expect(makeReconsiderState({ ...input, note: '가'.repeat(61) })).toBeNull();
    expect(makeReconsiderState({ ...input, a: input.b })).toBeNull();
  });
});
