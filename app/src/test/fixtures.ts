import type { Analysis, Clarification } from '../lib/contract';

export const clarification: Clarification = {
  summary: '이직과 잔류 사이에서 고민하고 있어요.',
  category: 'career',
  options: [
    { id: 'stay', label: '지금 회사에 남기' },
    { id: 'move', label: '새 회사로 옮기기' },
  ],
  questions: [
    {
      id: 'q1',
      text: '가장 중요한 것은?',
      inputType: 'single',
      choices: [
        { id: 'money', label: '연봉' },
        { id: 'growth', label: '성장' },
      ],
      required: true,
    },
    {
      id: 'q2',
      text: '걱정되는 점을 모두 골라주세요',
      inputType: 'multiple',
      choices: [
        { id: 'stable', label: '안정성' },
        { id: 'people', label: '사람' },
      ],
      required: true,
    },
    { id: 'q3', text: '1년 뒤 원하는 모습은?', inputType: 'text', choices: null, required: true },
  ],
  safetyMode: 'normal',
};

const axis = (key: Analysis['axes'][number]['key'], score: number) => ({
  key,
  score,
  rationale: `${key} 근거`,
  uncertainty: null,
});

export const analysis: Analysis = {
  summary: '성장을 가장 중요하게 보고 있어요.',
  recommendation: { optionId: 'move', label: '새 회사로 옮기기', rationale: '성장 기회가 커요.' },
  confidence: 'medium',
  confidenceReason: '연봉 차이 정보가 부족해요.',
  axes: [
    axis('purpose', 5),
    axis('cost', 3),
    axis('risk', 3),
    axis('reversibility', 4),
    axis('long_term', 5),
    axis('priority', 4),
  ],
  missedFactors: ['수습 기간 조건'],
  nextAction: { text: '새 회사 팀원과 30분 대화하기', timeframeHours: 48 },
  switchConditions: ['연봉이 20% 이상 낮다면 남기'],
  disclaimer: 'AI의 판단 보조이며 최종 결정은 본인에게 있어요.',
};
