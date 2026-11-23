import { describe, expect, it } from 'vitest';
import { composeNote, isCriterionId, type CriterionId } from './decisionCriteria';

describe('decision criteria context', () => {
  it('preserves the existing trimmed note when no criterion is chosen', () => {
    const result = composeNote({ note: '  어제도 면 먹었어요\n오늘은 밥이 좋아요  ', criterion: 'none', quickMode: false });
    expect(result.note).toBe('어제도 면 먹었어요\n오늘은 밥이 좋아요');
    expect(result.isValid).toBe(true);
  });

  it.each<[CriterionId, string]>([
    ['cost', '비용 절약'],
    ['time', '시간 절약'],
    ['ease', '편리함'],
    ['satisfaction', '내 만족'],
  ])('includes the explicitly chosen %s criterion in the request context', (criterion, label) => {
    expect(composeNote({ note: '오늘 저녁이에요', criterion, quickMode: false }).note)
      .toBe(`중요한 기준: ${label}\n오늘 저녁이에요`);
  });

  it('allows a criterion without a situation', () => {
    expect(composeNote({ note: '   ', criterion: 'ease', quickMode: false }).note).toBe('중요한 기준: 편리함');
  });

  it('keeps the selected criterion in quick mode and does not alter the saved situation', () => {
    const input = { note: '비밀이 아니라도 이번에는 보내지 않을 긴 상황'.repeat(10), criterion: 'time' as const, quickMode: true };
    const original = input.note;
    expect(composeNote(input)).toMatchObject({ note: '중요한 기준: 시간 절약', isValid: true, overBy: 0 });
    expect(input.note).toBe(original);
    expect(composeNote({ ...input, quickMode: false }).note).toBe(`중요한 기준: 시간 절약\n${original}`);
  });

  it('sends no context in quick mode when no criterion is selected', () => {
    expect(composeNote({ note: '숨겨진 상황', criterion: 'none', quickMode: true }))
      .toEqual({ note: '', isValid: true, length: 0, remaining: 60, overBy: 0 });
  });

  it('accepts exactly 60 units and reports overflow without dropping any text', () => {
    const prefix = '중요한 기준: 비용 절약\n';
    const fitting = '가'.repeat(60 - prefix.length);
    expect(composeNote({ note: fitting, criterion: 'cost', quickMode: false }))
      .toEqual({ note: prefix + fitting, isValid: true, length: 60, remaining: 0, overBy: 0 });
    expect(composeNote({ note: fitting + '나', criterion: 'cost', quickMode: false }))
      .toEqual({ note: prefix + fitting + '나', isValid: false, length: 61, remaining: 0, overBy: 1 });
  });

  it('matches the server length boundary for emoji instead of counting code points', () => {
    expect(composeNote({ note: '🙂'.repeat(30), criterion: 'none', quickMode: false }))
      .toMatchObject({ isValid: true, length: 60, remaining: 0 });
    expect(composeNote({ note: '🙂'.repeat(30) + '가', criterion: 'none', quickMode: false }))
      .toMatchObject({ isValid: false, length: 61, overBy: 1 });
  });

  it('recognizes only supported explicit criteria', () => {
    expect(isCriterionId('none')).toBe(true);
    expect(isCriterionId('satisfaction')).toBe(true);
    for (const value of [undefined, null, 'auto', 'cost,time', {}, 1]) expect(isCriterionId(value)).toBe(false);
  });
});
