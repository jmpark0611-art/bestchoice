import { screen } from '@testing-library/react';
import { renderAt } from '../test/render';
import { HistoryScreen, statusLabel } from './HistoryScreen';

const api = vi.hoisted(() => ({ listDecisions: vi.fn(), deleteAllDecisions: vi.fn() }));
vi.mock('../lib/api', () => api);

describe('HistoryScreen', () => {
  it('상태 문구', () => {
    const createdAt = '2026-09-29T03:00:00Z';
    expect(statusLabel({ status: 'completed', choiceType: 'followed', createdAt })).toMatch('추천대로 했어요');
    expect(statusLabel({ status: 'completed', choiceType: null, createdAt })).toMatch('분석 완료');
    expect(statusLabel({ status: 'failed', choiceType: null, createdAt })).toMatch('다시 시도 필요');
  });

  it('자동 삭제 안내와 목록을 보여준다', async () => {
    api.listDecisions.mockResolvedValue([
      {
        id: 'a',
        concern: '고민 원문',
        summary: '요약된 고민',
        status: 'completed',
        createdAt: '2026-09-29T03:00:00Z',
        choiceType: null,
      },
    ]);
    renderAt('/history', '/history', <HistoryScreen />);
    expect(await screen.findByText('요약된 고민')).toBeInTheDocument();
    expect(screen.getByText(/2개월이 지나면 자동으로 삭제/)).toBeInTheDocument();
  });

  it('기록이 없으면 빈 화면', async () => {
    api.listDecisions.mockResolvedValue([]);
    renderAt('/history', '/history', <HistoryScreen />);
    expect(await screen.findByText('아직 기록이 없어요.')).toBeInTheDocument();
  });
});
