import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppError } from '../lib/errors';
import { renderAt } from '../test/render';
import { InputScreen } from './InputScreen';

const api = vi.hoisted(() => ({ createDecision: vi.fn() }));
vi.mock('../lib/api', () => api);

const long = '지금 회사에 남을지 새 회사로 옮길지 고민이에요. 연봉은 비슷해요.';

describe('InputScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('20자 미만이면 제출할 수 없고 안내를 보여준다', async () => {
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    const box = screen.getByRole('textbox', { name: '고민 내용' });
    await user.type(box, '짧은 고민');
    await user.tab();
    expect(screen.getByText(/20자 이상 적어주세요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '질문 받기' })).toBeDisabled();
  });

  it('AI 이용 안내를 보여준다', () => {
    renderAt('/input', '/input', <InputScreen />);
    expect(screen.getByRole('list', { name: 'AI 이용 안내' })).toHaveTextContent('OpenAI');
    expect(screen.getByRole('list', { name: 'AI 이용 안내' })).toHaveTextContent('2개월');
  });

  it('등록하면 결정 화면으로 이동한다', async () => {
    api.createDecision.mockResolvedValue('new-id');
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByRole('button', { name: '질문 받기' }));
    expect(api.createDecision).toHaveBeenCalledWith(long);
    expect(await screen.findByText('other-page')).toBeInTheDocument();
  });

  it('일일 한도면 안내하고 화면에 남는다', async () => {
    api.createDecision.mockRejectedValue(new AppError('DAILY_LIMIT'));
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByRole('button', { name: '질문 받기' }));
    expect((await screen.findAllByText(/오늘은 고민을 더 등록할 수 없어요/)).length).toBeGreaterThan(0);
    // 토스트가 떠 있는 동안 TDS가 하단 CTA를 접근성 트리에서 숨기므로 텍스트로 찾는다
    await waitFor(() => expect(screen.getByText('질문 받기').closest('button')).toBeEnabled());
  });
});
