import { analysis, clarification } from '../test/fixtures';
import {
  analysisSchema,
  answersComplete,
  clarificationSchema,
  concernError,
  recommendationLabel,
  toAnswerList,
} from './contract';

describe('contract', () => {
  it('서버 응답 형식을 그대로 통과시킨다', () => {
    expect(clarificationSchema.parse(clarification)).toEqual(clarification);
    expect(analysisSchema.parse(analysis)).toEqual(analysis);
  });

  it('6축이 아니면 거부한다', () => {
    expect(analysisSchema.safeParse({ ...analysis, axes: analysis.axes.slice(0, 5) }).success).toBe(false);
  });

  it('고민 길이를 검사한다', () => {
    expect(concernError('짧아요')).toMatch('20자 이상');
    expect(concernError('가'.repeat(20))).toBeNull();
    expect(concernError('  ' + '가'.repeat(19) + '  ')).toMatch('20자 이상');
    expect(concernError('가'.repeat(1001))).toMatch('1,000자 이내');
  });

  it('질문 3개에 모두 답해야 완료된다', () => {
    const qs = clarification.questions;
    expect(answersComplete(qs, { q1: 'money', q2: ['stable'] })).toBe(false);
    expect(answersComplete(qs, { q1: 'money', q2: [], q3: '팀장' })).toBe(false);
    expect(answersComplete(qs, { q1: 'money', q2: ['stable'], q3: '   ' })).toBe(false);
    expect(answersComplete(qs, { q1: 'money', q2: ['stable'], q3: '팀장' })).toBe(true);
  });

  it('답변을 질문 순서대로 서버 형식으로 바꾼다', () => {
    expect(toAnswerList(clarification.questions, { q3: ' 팀장 ', q1: 'money', q2: ['people'] })).toEqual([
      { questionId: 'q1', value: 'money' },
      { questionId: 'q2', value: ['people'] },
      { questionId: 'q3', value: '팀장' },
    ]);
  });

  it('특수 추천값을 사람이 읽는 문구로 바꾼다', () => {
    expect(recommendationLabel(analysis)).toBe('새 회사로 옮기기');
    expect(recommendationLabel({ ...analysis, recommendation: { ...analysis.recommendation, optionId: 'wait' } })).toBe(
      '지금은 결정을 미루기',
    );
    expect(
      recommendationLabel({ ...analysis, recommendation: { ...analysis.recommendation, optionId: 'insufficient' } }),
    ).toBe('정보가 더 필요해요');
  });
});
