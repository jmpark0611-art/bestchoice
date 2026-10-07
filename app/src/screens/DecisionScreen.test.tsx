import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DecisionDetail } from '../lib/api';
import { AppError } from '../lib/errors';
import { analysis, clarification } from '../test/fixtures';
import { renderAt } from '../test/render';
import { DecisionScreen, viewFor } from './DecisionScreen';

const api = vi.hoisted(() => ({
  getDecision: vi.fn(),
  requestAI: vi.fn(),
  saveActualChoice: vi.fn(),
}));
vi.mock('../lib/api', () => api);
const flags = vi.hoisted(() => ({ ai: true }));
vi.mock('../lib/supabase', () => ({ aiEnabled: () => flags.ai }));

const base: DecisionDetail = {
  id: 'd1',
  concern: '이직을 할지 고민이에요. 스무 글자를 넘기는 문장입니다.',
  summary: null,
  status: 'draft',
  createdAt: '2026-09-29T00:00:00Z',
  safetyMode: 'normal',
  clarification: null,
  analysis: null,
  choiceType: null,
  choiceNote: '',
};
const d = (patch: Partial<DecisionDetail>): DecisionDetail => ({ ...base, ...patch });
const open = () => renderAt('/decision/d1', '/decision/:id', <DecisionScreen />);

beforeEach(() => {
  vi.clearAllMocks();
  flags.ai = true;
  sessionStorage.clear();
});

describe('viewFor', () => {
  it('서버 상태를 화면으로 매핑한다', () => {
    expect(viewFor(d({ status: 'draft' }), true)).toBe('clarify');
    expect(viewFor(d({ status: 'failed' }), true)).toBe('clarify');
    expect(viewFor(d({ status: 'failed', clarification }), true)).toBe('questions');
    expect(viewFor(d({ status: 'clarifying', clarification }), true)).toBe('questions');
    expect(viewFor(d({ status: 'analyzing', clarification }), true)).toBe('waiting');
    expect(viewFor(d({ status: 'completed', clarification, analysis }), true)).toBe('result');
    expect(viewFor(d({ status: 'crisis' }), true)).toBe('crisis');
  });

  it('AI가 꺼져 있어도 완료된 결과는 보여주고, 가짜 결과는 만들지 않는다', () => {
    expect(viewFor(d({ status: 'completed', clarification, analysis }), false)).toBe('result');
    expect(viewFor(d({ status: 'draft' }), false)).toBe('ai-off');
  });
});

describe('DecisionScreen', () => {
  it('등록 직후 질문을 받아오고, 3개 답한 뒤 분석 결과를 보여준다', async () => {
    api.getDecision
      .mockResolvedValueOnce(d({ status: 'draft' }))
      .mockResolvedValueOnce(d({ status: 'clarifying', clarification }))
      .mockResolvedValueOnce(d({ status: 'completed', clarification, analysis }));
    api.requestAI.mockResolvedValue({});
    const user = userEvent.setup();
    open();

    expect(await screen.findByText('질문 카드를 열어볼게요')).toBeInTheDocument();
    expect(api.requestAI).toHaveBeenCalledWith({ decisionId: 'd1', stage: 'clarify' });
    expect(api.requestAI).toHaveBeenCalledTimes(1);

    let cta = screen.getByRole('button', { name: '다음 카드 뒤집기' });
    expect(cta).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '성장' }));
    await user.click(cta);
    await user.click(screen.getByRole('button', { name: '안정성' }));
    await user.click(screen.getByRole('button', { name: '사람' }));
    await user.click(screen.getByRole('button', { name: '다음 카드 뒤집기' }));
    await user.type(screen.getByRole('textbox', { name: '1년 뒤 원하는 모습은?' }), '팀장');
    cta = screen.getByRole('button', { name: '결과 리포트 열기' });
    expect(cta).toBeEnabled();
    await user.click(cta);

    expect(await screen.findByText('이렇게 판단했어요')).toBeInTheDocument();
    expect(api.requestAI).toHaveBeenLastCalledWith({
      decisionId: 'd1',
      stage: 'analyze',
      answers: [
        { questionId: 'q1', value: 'growth' },
        { questionId: 'q2', value: ['stable', 'people'] },
        { questionId: 'q3', value: '팀장' },
      ],
    });
    for (const label of ['목적 부합', '비용 감당', '위험 통제', '되돌리기 쉬움', '장기 이익', '우선순위'])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('48시간 안에 해볼 일')).toBeInTheDocument();
  });

  it('분석이 실패하면 다시 시도할 수 있고, 적었던 답이 남아 있다', async () => {
    api.getDecision.mockResolvedValue(d({ status: 'clarifying', clarification }));
    api.requestAI.mockRejectedValueOnce(new AppError('AI_UPSTREAM'));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: '연봉' }));
    await user.click(screen.getByRole('button', { name: '다음 카드 뒤집기' }));
    await user.click(screen.getByRole('button', { name: '안정성' }));
    await user.click(screen.getByRole('button', { name: '다음 카드 뒤집기' }));
    await user.type(screen.getByRole('textbox', { name: '1년 뒤 원하는 모습은?' }), '팀장');
    await user.click(screen.getByRole('button', { name: '결과 리포트 열기' }));

    await user.click(await screen.findByRole('button', { name: '다시 시도하기' }));
    expect(screen.getByRole('button', { name: '연봉' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '다음 카드 뒤집기' }));
    await user.click(screen.getByRole('button', { name: '다음 카드 뒤집기' }));
    expect(screen.getByRole('textbox', { name: '1년 뒤 원하는 모습은?' })).toHaveValue('팀장');
  });

  it('지난 분석이 실패한 기록은 안내와 함께 질문을 다시 보여준다', async () => {
    api.getDecision.mockResolvedValue(d({ status: 'failed', clarification }));
    open();
    expect(await screen.findByText(/지난 분석이 끝나지 못했어요/)).toBeInTheDocument();
    expect(api.requestAI).not.toHaveBeenCalled();
  });

  it('한도 초과는 다시 시도 버튼 없이 안내한다', async () => {
    api.getDecision.mockResolvedValue(d({ status: 'draft' }));
    api.requestAI.mockRejectedValue(new AppError('AI_LIMIT'));
    open();
    expect(await screen.findByText(/AI 분석 가능 횟수를 모두 썼어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 시도하기' })).not.toBeInTheDocument();
  });

  it('위기 신호가 있으면 분석 대신 도움받을 곳을 안내한다', async () => {
    api.getDecision.mockResolvedValue(d({ status: 'crisis', safetyMode: 'crisis' }));
    open();
    expect(await screen.findByText('지금은 분석보다 도움이 먼저예요')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '109' })).toHaveAttribute('href', 'tel:109');
  });

  it('AI가 꺼져 있으면 호출하지 않고 준비 중 안내', async () => {
    flags.ai = false;
    api.getDecision.mockResolvedValue(d({ status: 'draft' }));
    open();
    expect(await screen.findByText('AI 분석을 준비하고 있어요')).toBeInTheDocument();
    expect(api.requestAI).not.toHaveBeenCalled();
  });

  it('실제 선택을 기록한다', async () => {
    api.getDecision.mockResolvedValue(d({ status: 'completed', clarification, analysis }));
    api.saveActualChoice.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open();
    const save = await screen.findByRole('button', { name: '기록하기' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '다른 선택을 했어요' }));
    await user.type(screen.getByRole('textbox', { name: '메모' }), '연봉 때문에');
    await user.click(save);
    await waitFor(() => expect(api.saveActualChoice).toHaveBeenCalledWith('d1', 'other', '연봉 때문에'));
  });
});
