import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from '../test/render';
import { SettingsScreen } from './SettingsScreen';

const api = vi.hoisted(() => ({ deleteAccount: vi.fn(), deleteAllDecisions: vi.fn() }));
vi.mock('../lib/api', () => api);
const sb = vi.hoisted(() => ({ ensureSession: vi.fn() }));
vi.mock('../lib/supabase', () => sb);

describe('SettingsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('운영자 정보와 문의 이메일을 보여준다', () => {
    renderAt('/settings', '/settings', <SettingsScreen />);
    expect(screen.getByText(/에스케이컴퍼니/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'jmpark0611@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:jmpark0611@gmail.com',
    );
  });

  it('계정 삭제는 확인 후 실행하고 새 익명 세션으로 처음 화면에 간다', async () => {
    api.deleteAccount.mockResolvedValue(undefined);
    sb.ensureSession.mockResolvedValue('new-user');
    const user = userEvent.setup();
    renderAt('/settings', '/settings', <SettingsScreen />);
    await user.click(screen.getByText('계정 삭제'));
    expect(api.deleteAccount).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '계정 삭제' }));
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sb.ensureSession).toHaveBeenCalled());
    expect(await screen.findByText('other-page')).toBeInTheDocument();
  });

  it('계정 삭제를 취소하면 아무것도 하지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/settings', '/settings', <SettingsScreen />);
    await user.click(screen.getByText('계정 삭제'));
    await user.click(await screen.findByRole('button', { name: '취소' }));
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });
});
