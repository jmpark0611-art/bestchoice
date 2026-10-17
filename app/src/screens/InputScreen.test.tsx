import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppError } from '../lib/errors';
import { renderAt } from '../test/render';
import { InputScreen } from './InputScreen';

const api = vi.hoisted(() => ({ createDecision: vi.fn(), getQuota: vi.fn(), grantAdBonus: vi.fn() }));
vi.mock('../lib/api', () => api);
const ad = vi.hoisted(() => ({ rewardedAdAvailable: vi.fn(() => true), watchRewardedAd: vi.fn() }));
vi.mock('../lib/rewardedAd', () => ad);

const quota = (remaining: number, canEarnBonus = true) => ({ freeLimit: 3, used: 3 - remaining, bonus: 0, remaining, canEarnBonus });

const long = '지금 회사에 남을지 새 회사로 옮길지 고민이에요. 연봉은 비슷해요.';
const completeQuest = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('radio', { name: '일' }));
  await user.click(screen.getByRole('radio', { name: '이번 주' }));
};

describe('InputScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getQuota.mockResolvedValue(quota(3));
    ad.rewardedAdAvailable.mockReturnValue(true);
  });

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
    await completeQuest(user);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByRole('button', { name: '질문 받기' }));
    expect(api.createDecision).toHaveBeenCalledWith(long, { category: 'career', urgency: 'week' });
    expect(await screen.findByText('other-page')).toBeInTheDocument();
  });

  it('일일 한도면 안내하고 화면에 남는다', async () => {
    api.createDecision.mockRejectedValue(new AppError('DAILY_LIMIT'));
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await completeQuest(user);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByRole('button', { name: '질문 받기' }));
    expect((await screen.findAllByText(/오늘은 고민을 더 등록할 수 없어요/)).length).toBeGreaterThan(0);
    // 토스트가 떠 있는 동안 TDS가 하단 CTA를 접근성 트리에서 숨기므로 텍스트로 찾는다
    await waitFor(() => expect(screen.getByText('질문 받기').closest('button')).toBeEnabled());
  });

  it('남은 무료 분석 수를 보여준다', async () => {
    api.getQuota.mockResolvedValue(quota(2));
    renderAt('/input', '/input', <InputScreen />);
    expect(await screen.findByText('오늘 남은 분석 2건')).toBeInTheDocument();
  });

  const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await completeQuest(user);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByText('질문 받기').closest('button')!);
  };

  it('무료를 다 쓰면 광고를 끝까지 본 뒤 1건을 받아 등록한다', async () => {
    api.getQuota.mockResolvedValue(quota(0));
    ad.watchRewardedAd.mockResolvedValue(true);
    api.grantAdBonus.mockResolvedValue({ ...quota(0), bonus: 1, remaining: 1 });
    api.createDecision.mockResolvedValue('new-id');
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    expect(await screen.findByText(/광고를 보면 1건 더/)).toBeInTheDocument();
    await fillAndSubmit(user);
    await user.click(await screen.findByRole('button', { name: '광고 보고 1건 더 받기' }));
    expect(await screen.findByText('other-page')).toBeInTheDocument();
    expect(api.grantAdBonus).toHaveBeenCalledTimes(1);
    expect(api.createDecision).toHaveBeenCalledWith(long, { category: 'career', urgency: 'week' });
  });

  it('광고를 중간에 닫으면 보상 없이 등록하지 않는다', async () => {
    api.getQuota.mockResolvedValue(quota(0));
    ad.watchRewardedAd.mockResolvedValue(false);
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await screen.findByText(/광고를 보면 1건 더/);
    await fillAndSubmit(user);
    await user.click(await screen.findByRole('button', { name: '광고 보고 1건 더 받기' }));
    expect((await screen.findAllByText(/광고를 끝까지 봐야/)).length).toBeGreaterThan(0);
    expect(api.grantAdBonus).not.toHaveBeenCalled();
    expect(api.createDecision).not.toHaveBeenCalled();
  });

  it('광고 제안을 거절하면 등록하지 않는다', async () => {
    api.getQuota.mockResolvedValue(quota(0));
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await screen.findByText(/광고를 보면 1건 더/);
    await fillAndSubmit(user);
    await user.click(await screen.findByRole('button', { name: '내일 할게요' }));
    expect(ad.watchRewardedAd).not.toHaveBeenCalled();
    expect(api.createDecision).not.toHaveBeenCalled();
  });

  it('광고를 쓸 수 없으면 내일 다시 이용하라고 안내한다', async () => {
    api.getQuota.mockResolvedValue(quota(0));
    ad.rewardedAdAvailable.mockReturnValue(false);
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    expect(await screen.findByText('오늘 분석을 모두 썼어요. 내일 다시 이용해주세요.')).toBeInTheDocument();
    await fillAndSubmit(user);
    expect((await screen.findAllByText(/오늘 무료 분석을 모두 썼어요/)).length).toBeGreaterThan(0);
    expect(ad.watchRewardedAd).not.toHaveBeenCalled();
    expect(api.createDecision).not.toHaveBeenCalled();
  });

  it('서버가 FREE_LIMIT으로 막으면 광고 후 한 번 다시 등록한다', async () => {
    api.getQuota.mockResolvedValue(quota(1)); // 표시가 오래된 경우
    api.createDecision.mockRejectedValueOnce(new AppError('FREE_LIMIT')).mockResolvedValueOnce('new-id');
    ad.watchRewardedAd.mockResolvedValue(true);
    api.grantAdBonus.mockResolvedValue({ ...quota(0), bonus: 1, remaining: 1 });
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await screen.findByText('오늘 남은 분석 1건');
    await fillAndSubmit(user);
    await user.click(await screen.findByRole('button', { name: '광고 보고 1건 더 받기' }));
    expect(await screen.findByText('other-page')).toBeInTheDocument();
    expect(api.createDecision).toHaveBeenCalledTimes(2);
  });

  it('분야와 시급도는 선택하지 않아도 등록할 수 있다', async () => {
    api.createDecision.mockResolvedValue('new-id');
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    await user.type(screen.getByRole('textbox', { name: '고민 내용' }), long);
    await user.click(screen.getByText('질문 받기').closest('button')!);
    expect(api.createDecision).toHaveBeenCalledWith(long, { category: undefined, urgency: undefined });
  });

  it('선택한 칩을 다시 누르면 선택이 풀린다', async () => {
    const user = userEvent.setup();
    renderAt('/input', '/input', <InputScreen />);
    const chip = screen.getByRole('radio', { name: '오늘' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-checked', 'true');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-checked', 'false');
  });
});
