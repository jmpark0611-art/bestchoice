import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useNativeBack } from './useNativeBack';

const sdk = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  return {
    listeners,
    graniteEvent: {
      addEventListener: vi.fn((_e: string, args: { onEvent: () => void }) => {
        listeners.push(args.onEvent);
        return () => listeners.splice(listeners.indexOf(args.onEvent), 1);
      }),
    },
    Screen: { close: vi.fn(async () => {}) },
  };
});
vi.mock('@apps-in-toss/web-framework', () => sdk);

function Harness() {
  useNativeBack();
  const navigate = useNavigate();
  return <button onClick={() => navigate('/b')}>go</button>;
}

const back = () => sdk.listeners.at(-1)!();

describe('useNativeBack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({ idx: 0 }, '');
  });

  it('첫 화면에서 뒤로가기는 미니앱을 닫는다', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    back();
    expect(sdk.Screen.close).toHaveBeenCalled();
  });

  it('이동한 기록이 있으면 이전 화면으로', async () => {
    render(
      <MemoryRouter initialEntries={['/a', '/b']} initialIndex={1}>
        <Routes>
          <Route path="/a" element={<div>page-a</div>} />
          <Route path="/b" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    window.history.replaceState({ idx: 1 }, '');
    back();
    expect(await screen.findByText('page-a')).toBeInTheDocument();
    expect(sdk.Screen.close).not.toHaveBeenCalled();
  });
});
