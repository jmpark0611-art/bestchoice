import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CONTENT_POLICY_STORAGE_KEY, CONTENT_POLICY_VERSION } from '../lib/contentPolicy';
import { PollScreen } from './PollScreen';

const api = vi.hoisted(() => ({ getMyPoll: vi.fn(), sharePoll: vi.fn(), setDid: vi.fn() }));
vi.mock('../lib/api', () => api);
const mine = { id: 'p1', a: '요리', b: '외식', note: null, isOwner: true, myVote: null,
  shareCode: null, did: null, createdAt: '', pick: 'a', reason: '집에서 준비해요.' };
function open() { return render(<MemoryRouter initialEntries={['/p/p1']}><Routes>
  <Route path="/p/:id" element={<PollScreen />} />
</Routes></MemoryRouter>); }
beforeEach(() => { vi.resetAllMocks();localStorage.clear();api.getMyPoll.mockResolvedValue(mine);api.sharePoll.mockResolvedValue('public-code'); });
afterEach(() => { vi.restoreAllMocks();localStorage.clear(); });

it('does not create or copy a share link before explicit consent and preserves cancellation', async () => {
  const user = userEvent.setup();const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  open();await user.click(await screen.findByRole('button', { name: '친구한테 물어보기' }));
  const panel = screen.getByRole('region', { name: '공유 전 콘텐츠 정책 동의' });
  expect(within(panel).getByRole('button', { name: '동의하고 공유하기' })).toBeDisabled();
  expect(api.sharePoll).not.toHaveBeenCalled();expect(copy).not.toHaveBeenCalled();
  await user.click(within(panel).getByRole('button', { name: '공유 취소' }));
  expect(screen.queryByRole('region', { name: '공유 전 콘텐츠 정책 동의' })).not.toBeInTheDocument();
  expect(api.sharePoll).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '친구한테 물어보기' }));
  await user.click(screen.getByRole('checkbox', { name: '공유 콘텐츠 이용정책을 확인했고 동의해요.' }));
  await user.click(screen.getByRole('button', { name: '동의하고 공유하기' }));
  expect(api.sharePoll).toHaveBeenCalledExactlyOnceWith('p1');
  expect(copy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(CONTENT_POLICY_STORAGE_KEY)!)).toEqual({ version: CONTENT_POLICY_VERSION, accepted: true });
});

it('asks again for an older policy and allows only the explicitly accepted share when storage is denied', async () => {
  localStorage.setItem(CONTENT_POLICY_STORAGE_KEY, JSON.stringify({ version: 'old', accepted: true }));
  const user = userEvent.setup();vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  open();await user.click(await screen.findByRole('button', { name: '친구한테 물어보기' }));
  expect(api.sharePoll).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: '공유 콘텐츠 이용정책을 확인했고 동의해요.' }));
  await user.click(screen.getByRole('button', { name: '동의하고 공유하기' }));
  expect(api.sharePoll).toHaveBeenCalledExactlyOnceWith('p1');
  expect(screen.getByText(/기기에 저장하지 못해 다음에는 다시 확인/)).toBeInTheDocument();
});
