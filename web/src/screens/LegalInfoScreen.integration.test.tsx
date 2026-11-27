import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { App } from '../App';

const backend = vi.hoisted(() => ({
  ensureSession: vi.fn(), getExistingSessionToken: vi.fn(), getSupabase: vi.fn(),
  rpc: vi.fn(), fetch: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({
  ensureSession: backend.ensureSession,
  getExistingSessionToken: backend.getExistingSessionToken,
  getSupabase: backend.getSupabase,
}));

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <div>
    <span data-testid="test-path">{location.pathname}</span>
    <button type="button" onClick={() => navigate(-1)}>테스트 뒤로가기</button>
  </div>;
}

function open(path: string) {
  // Match the app's declarative BrowserRouter without Data Router Request objects.
  render(<MemoryRouter initialEntries={[path]}><NavigationProbe /><App /></MemoryRouter>);
}

function expectPath(path: string) {
  expect(screen.getByTestId('test-path').textContent).toBe(path);
}

function expectNoServerAccess() {
  expect(backend.ensureSession).not.toHaveBeenCalled();
  expect(backend.getExistingSessionToken).not.toHaveBeenCalled();
  expect(backend.getSupabase).not.toHaveBeenCalled();
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  backend.ensureSession.mockResolvedValue('local-test-only');
  backend.getExistingSessionToken.mockResolvedValue(null);
  backend.getSupabase.mockReturnValue({ rpc: backend.rpc });
  backend.rpc.mockImplementation(() => { throw new Error('Unexpected server access'); });
  backend.fetch.mockImplementation(() => { throw new Error('Unexpected network access'); });
  vi.stubGlobal('fetch', backend.fetch);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens both notices from About, crosses documents, and preserves the record-management controls', async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  open('/about');
  expect(screen.getByRole('heading', { name: '이용 안내' })).toHaveAttribute('id', 'about-title');
  expect(screen.queryByText(/검토본|정식 공개 전|확인 중이에요/)).not.toBeInTheDocument();
  const links = within(screen.getByRole('navigation', { name: '개인정보와 삭제 안내' }));
  expect(links.getByRole('link', { name: '데이터 삭제 안내' })).toHaveAttribute('href', '/delete-data');
  await user.click(links.getByRole('link', { name: '개인정보처리방침' }));
  expectPath('/privacy');
  expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toHaveFocus();
  expect(screen.queryByText(/검토본|정식 공개 전|확인 중이에요/)).not.toBeInTheDocument();

  await user.click(screen.getByRole('link', { name: '데이터 삭제 안내 보기' }));
  expectPath('/delete-data');
  expect(screen.getByRole('heading', { name: '데이터 삭제 안내' })).toHaveFocus();
  await user.click(screen.getByRole('link', { name: '개인정보처리방침 보기' }));
  expectPath('/privacy');
  await user.click(screen.getByRole('link', { name: '이용 안내와 기록 관리' }));

  expectPath('/about');
  for (const name of ['작성자 차단 모두 해제', '이 기기의 초안 모두 지우기', '기본 기준 지우기', '이 기기의 회고 모두 지우기']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole('link', { name: '데이터 삭제 안내' }));
  expectPath('/delete-data');
  expect(screen.getByRole('heading', { name: '데이터 삭제 안내' })).toBeVisible();
  await user.click(screen.getByRole('link', { name: '이용 안내로 돌아가기' }));
  expectPath('/about');
  expect(confirm).not.toHaveBeenCalled();
  expectNoServerAccess();
});

it.each([
  { path: '/privacy', title: '개인정보처리방침' },
  { path: '/delete-data', title: '데이터 삭제 안내' },
])('supports direct entry to $path without a session or prior history', async ({ path, title }) => {
  const user = userEvent.setup();
  open(path);
  expect(screen.getByRole('heading', { name: title })).toHaveFocus();
  expect(screen.queryByText(/검토본|정식 공개 전|확인 중이에요|아직 정하지 않았어요/)).not.toBeInTheDocument();
  expect(screen.getByText('jmpark0611@gmail.com')).toBeVisible();
  await user.click(screen.getByRole('link', { name: '이용 안내로 돌아가기' }));
  expectPath('/about');
  expect(screen.getByRole('heading', { name: '이용 안내' })).toBeInTheDocument();
  expectNoServerAccess();
});

it('keeps document links in router history for ordinary back navigation', async () => {
  const user = userEvent.setup();
  open('/about');
  await user.click(screen.getByRole('link', { name: '개인정보처리방침' }));
  await user.click(screen.getByRole('link', { name: '데이터 삭제 안내 보기' }));
  await user.click(screen.getByRole('button', { name: '테스트 뒤로가기' }));
  expectPath('/privacy');
  expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '테스트 뒤로가기' }));
  expectPath('/about');
  expect(screen.getByRole('heading', { name: '이용 안내' })).toBeInTheDocument();
  expectNoServerAccess();
});

it.each([
  { path: '/privacy', title: '개인정보처리방침', label: '개인정보 문의 메일 작성' },
  { path: '/delete-data', title: '데이터 삭제 안내', label: '삭제 문의 메일 작성' },
])('keeps $path readable and return navigation available when mail navigation is denied', async ({ path, title, label }) => {
  const user = userEvent.setup();
  open(path);
  const mailLink = screen.getByRole('link', { name: label });
  expect(mailLink.getAttribute('href')).toMatch(/^mailto:jmpark0611@gmail\.com\?subject=/);
  // Model a browser or host refusing the external navigation, not a real mail client.
  const denyMail = vi.fn((event: Event) => event.preventDefault());
  mailLink.addEventListener('click', denyMail);
  try {
    await user.click(mailLink);
    expect(denyMail).toHaveBeenCalledTimes(1);
    expect(denyMail.mock.calls[0][0].defaultPrevented).toBe(true);
    expectPath(path);
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByText('jmpark0611@gmail.com')).toBeVisible();
    expect(screen.getByText(/메일 앱이 열리지 않으면 위 주소를 복사/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '이용 안내로 돌아가기' }));
    expectPath('/about');
    expectNoServerAccess();
  } finally {
    mailLink.removeEventListener('click', denyMail);
  }
});
