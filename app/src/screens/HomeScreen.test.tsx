import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HomeScreen } from './HomeScreen';
import { EXAMPLES, InputScreen } from './InputScreen';

const api = vi.hoisted(() => ({
  listDecisions: vi.fn(),
  getQuota: vi.fn(),
  createDecision: vi.fn(),
  grantAdBonus: vi.fn(),
}));
vi.mock('../lib/api', () => api);
vi.mock('../lib/supabase', () => ({ aiEnabled: () => true }));
vi.mock('../lib/rewardedAd', () => ({ rewardedAdAvailable: () => false, watchRewardedAd: vi.fn() }));

describe('HomeScreen', () => {
  beforeEach(() => {
    api.listDecisions.mockResolvedValue([]);
    api.getQuota.mockResolvedValue({ freeLimit: 20, used: 0, bonus: 0, remaining: 20, canEarnBonus: false });
  });

  it('예시 고민을 누르면 그 문장이 채워진 입력 화면으로 간다', async () => {
    const user = userEvent.setup();
    render(
      <TDSMobileAITProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/input" element={<InputScreen />} />
          </Routes>
        </MemoryRouter>
      </TDSMobileAITProvider>,
    );
    expect(screen.getByRole('button', { name: '결정해줘' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이직할까?' }));
    expect(await screen.findByRole('textbox', { name: '고민 내용' })).toHaveValue(EXAMPLES[0][1]);
  });
});
