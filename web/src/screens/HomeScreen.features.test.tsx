import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECISION_PREFERENCE_KEY, getDefaultCriterion, saveDefaultCriterion } from '../lib/decisionPreferences';
import { HomeScreen } from './HomeScreen';

const api = vi.hoisted(() => ({ decide: vi.fn(), listMyPolls: vi.fn() }));
vi.mock('../lib/api', () => api);

function openHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/p/:id" element={<h1>결정 결과</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  api.listMyPolls.mockResolvedValue([]);
  api.decide.mockResolvedValue({ kind: 'pick', id: 'feature-decision' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomeScreen criteria and quick decision', () => {
  it.each(['비용 절약', '시간 절약', '편리함', '내 만족'])(
    'sends the selected %s criterion through the existing note field', async (label) => {
      const user = userEvent.setup();
      openHome();
      await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
      await user.click(screen.getByRole('radio', { name: label }));
      await user.type(screen.getByLabelText(/상황 한 줄/), '오늘 저녁이에요');
      expect(screen.getByText('고른 기준은 AI에게 전달되고, 공유할 때 친구에게도 보여요.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
      expect(api.decide).toHaveBeenCalledExactlyOnceWith({
        a: '짜장면', b: '짬뽕', note: `중요한 기준: ${label}\n오늘 저녁이에요`,
      });
      expect(await screen.findByRole('heading', { name: '결정 결과' })).toBeInTheDocument();
    },
  );

  it('blocks 61 combined units without truncation and submits after the user shortens it to 60', async () => {
    const user = userEvent.setup();
    openHome();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.click(screen.getByRole('radio', { name: '비용 절약' }));
    const prefix = '중요한 기준: 비용 절약\n';
    const fitting = '가'.repeat(60 - prefix.length);
    const note = screen.getByLabelText(/상황 한 줄/);
    await user.type(note, fitting + '나');
    expect(note).toHaveValue(fitting + '나');
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('1자 넘어요');
    const submit = screen.getByRole('button', { name: '딱 정해줘' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(api.decide).not.toHaveBeenCalled();
    await user.clear(note);
    await user.type(note, fitting);
    expect(note).toHaveValue(fitting);
    expect(note).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('기준과 상황을 합쳐 60/60자')).toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: prefix + fitting });
  });

  it('preserves the original situation when criteria are selected, changed, and cleared', async () => {
    const user = userEvent.setup();
    openHome();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    const raw = '  ' + '가'.repeat(56) + '  ';
    const note = screen.getByLabelText(/상황 한 줄/);
    await user.type(note, raw);
    for (const label of ['비용 절약', '편리함', '시간 절약']) {
      await user.click(screen.getByRole('radio', { name: label }));
      expect(note).toHaveValue(raw);
      expect(screen.getByRole('button', { name: '딱 정해줘' })).toBeDisabled();
    }
    await user.click(screen.getByRole('radio', { name: '기준 없이' }));
    expect(note).toHaveValue(raw);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: raw.trim() });
  });

  it('hides and restores a saved situation while quick mode sends only the visible selected criterion', async () => {
    const user = userEvent.setup();
    openHome();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.type(screen.getByLabelText(/상황 한 줄/), '가'.repeat(60));
    await user.click(screen.getByRole('radio', { name: '시간 절약' }));
    expect(screen.getByRole('button', { name: '딱 정해줘' })).toBeDisabled();
    const toggle = screen.getByRole('button', { name: /^빠른 결정$/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/상황 한 줄/)).not.toBeInTheDocument();
    expect(screen.getByText('상황 설명을 생략해요. 아래에서 고른 기준은 함께 반영해요.')).toBeInTheDocument();
    expect(screen.getByText(/적어 둔 상황은 이번 요청에 넣지 않아요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '빠르게 결정하기' })).toBeEnabled();
    await user.click(toggle);
    expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('가'.repeat(60));
    expect(screen.getByRole('button', { name: '딱 정해줘' })).toBeDisabled();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: '빠르게 결정하기' }));
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: '중요한 기준: 시간 절약' });
  });

  it('sends an empty note in quick mode with no selected criterion', async () => {
    const user = userEvent.setup();
    openHome();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.type(screen.getByLabelText(/상황 한 줄/), '이번에는 생략할 상황');
    await user.click(screen.getByRole('button', { name: /^빠른 결정$/ }));
    await user.click(screen.getByRole('button', { name: '빠르게 결정하기' }));
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: '' });
  });
});

describe('HomeScreen explicit default criterion', () => {
  it('does not remember a selection without the explicit save action', async () => {
    const user = userEvent.setup();
    const first = openHome();
    await user.click(screen.getByRole('radio', { name: '비용 절약' }));
    expect(screen.getByRole('radio', { name: '비용 절약' })).toBeChecked();
    expect(getDefaultCriterion()).toEqual({ criterion: 'none', status: 'default' });
    first.unmount();
    await act(async () => { openHome(); });
    expect(screen.getByRole('radio', { name: '기준 없이' })).toBeChecked();
    expect(screen.queryByText(/이 기기의 기본 기준:/)).not.toBeInTheDocument();
  });

  it('applies a saved default after remount and keeps it when a later choice is not saved', async () => {
    const user = userEvent.setup();
    const first = openHome();
    await user.click(screen.getByRole('radio', { name: '편리함' }));
    await user.click(screen.getByRole('button', { name: '이 기준을 기본으로 저장' }));
    expect(screen.getByRole('status')).toHaveTextContent('기본 기준을 저장했어요');
    expect(getDefaultCriterion()).toEqual({ criterion: 'ease', status: 'saved' });
    await user.click(screen.getByRole('radio', { name: '내 만족' }));
    expect(getDefaultCriterion()).toEqual({ criterion: 'ease', status: 'saved' });
    first.unmount();
    await act(async () => { openHome(); });
    expect(screen.getByRole('radio', { name: '편리함' })).toBeChecked();
    expect(screen.getByText('이 기기의 기본 기준: 편리함')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: '중요한 기준: 편리함' });
  });

  it('clears the explicit default without erasing the current situation or unrelated storage', async () => {
    const user = userEvent.setup();
    saveDefaultCriterion('time');
    window.localStorage.setItem('unrelated-app-value', 'keep');
    const first = openHome();
    await user.type(screen.getByLabelText(/상황 한 줄/), '입력 중인 상황');
    await user.click(screen.getByRole('button', { name: '기본 기준 지우기' }));
    expect(screen.getByRole('status')).toHaveTextContent('기본 기준을 지웠어요');
    expect(screen.getByRole('radio', { name: '기준 없이' })).toBeChecked();
    expect(screen.getByLabelText(/상황 한 줄/)).toHaveValue('입력 중인 상황');
    expect(window.localStorage.getItem(DECISION_PREFERENCE_KEY)).toBeNull();
    expect(window.localStorage.getItem('unrelated-app-value')).toBe('keep');
    first.unmount();
    await act(async () => { openHome(); });
    await user.click(screen.getByRole('button', { name: '초안 이어쓰기' }));
    expect(screen.getByRole('radio', { name: '기준 없이' })).toBeChecked();
    expect(screen.queryByRole('button', { name: '기본 기준 지우기' })).not.toBeInTheDocument();
  });

  it('honestly reports denied storage but still submits the criterion chosen for this decision', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage blocked'); });
    const user = userEvent.setup();
    openHome();
    expect(screen.getByRole('status')).toHaveTextContent('기본 기준을 불러오지 못했어요');
    expect(screen.getByRole('radio', { name: '기준 없이' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '내 만족' }));
    await user.click(screen.getByRole('button', { name: '이 기준을 기본으로 저장' }));
    expect(screen.getByRole('status')).toHaveTextContent('이 기기에 기준을 저장하지 못했어요');
    expect(screen.queryByText(/기본 기준을 저장했어요/)).not.toBeInTheDocument();
    expect(screen.queryByText(/이 기기의 기본 기준:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '짜장면 vs 짬뽕' }));
    await user.click(screen.getByRole('button', { name: '딱 정해줘' }));
    expect(api.decide).toHaveBeenCalledExactlyOnceWith({ a: '짜장면', b: '짬뽕', note: '중요한 기준: 내 만족' });
    expect(await screen.findByRole('heading', { name: '결정 결과' })).toBeInTheDocument();
  });

  it('does not report a successful clear when storage refuses deletion', async () => {
    saveDefaultCriterion('cost');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const user = userEvent.setup();
    openHome();
    await user.click(screen.getByRole('button', { name: '기본 기준 지우기' }));
    expect(screen.getByRole('status')).toHaveTextContent('기본 기준을 지우지 못했어요');
    expect(screen.getByRole('radio', { name: '비용 절약' })).toBeChecked();
    expect(screen.getByText('이 기기의 기본 기준: 비용 절약')).toBeInTheDocument();
    expect(getDefaultCriterion()).toEqual({ criterion: 'cost', status: 'saved' });
  });
});
