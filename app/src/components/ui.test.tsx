import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../test/render';
import { LoadingView } from './ui';

describe('LoadingView', () => {
  afterEach(() => vi.useRealTimers());

  it('여러 문구를 차례로 보여주고 마지막 문구에서 멈춘다', () => {
    vi.useFakeTimers();
    renderAt('/', '/', <LoadingView message={['하나', '둘']} />);
    expect(screen.getByText('하나')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByText('둘')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText('둘')).toBeInTheDocument();
  });
});
