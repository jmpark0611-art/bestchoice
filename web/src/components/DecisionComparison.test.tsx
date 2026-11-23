import { render, screen } from '@testing-library/react';
import type { Poll } from '../lib/api';
import { DecisionComparison } from './DecisionComparison';

const owner: Poll = {
  id: 'decision-1',
  a: '집에서 요리',
  b: '밖에서 식사',
  note: null,
  isOwner: true,
  myVote: null,
  shareCode: 'shared-1',
  did: null,
  createdAt: '2026-11-23T00:00:00Z',
  pick: 'a',
  reason: '오늘 예산을 아끼려면 집에서 요리해요.',
  votes: { a: 3, b: 1 },
};

describe('DecisionComparison', () => {
  it('does not reveal a populated result to a visitor who has not voted', () => {
    const { container } = render(<DecisionComparison poll={{ ...owner, isOwner: false }} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(owner.reason!)).not.toBeInTheDocument();
    expect(screen.queryByText(/3표/)).not.toBeInTheDocument();
  });

  it('allows a voter to compare the actual model reason with exact counts', () => {
    render(<DecisionComparison poll={{ ...owner, id: null, isOwner: false, myVote: 'b' }} />);
    expect(screen.getByRole('region', { name: 'AI와 친구 의견 비교' })).toBeInTheDocument();
    expect(screen.getByText(owner.reason!)).toBeInTheDocument();
    expect(screen.getByText('집에서 요리 3표 · 밖에서 식사 1표')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'zero votes', votes: { a: 0, b: 0 }, text: '친구 의견이 모이면 여기에서 비교할 수 있어요.' },
    { name: 'a tie', votes: { a: 2, b: 2 }, text: '현재 투표는 동점이에요.' },
    { name: 'agreement', votes: { a: 3, b: 1 }, text: 'AI의 제안과 더 많은 표를 받은 쪽이 같아요.' },
    { name: 'disagreement', votes: { a: 1, b: 3 }, text: 'AI의 제안과 더 많은 표를 받은 쪽이 달라요.' },
    { name: 'one agreeing vote', votes: { a: 1, b: 0 }, text: '첫 투표가 AI와 같은 쪽이에요.' },
    { name: 'one disagreeing vote', votes: { a: 0, b: 1 }, text: '첫 투표가 AI와 다른 쪽이에요.' },
  ])('describes $name without presenting it as certainty', ({ votes, text }) => {
    render(<DecisionComparison poll={{ ...owner, votes }} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('참여한 사람들의 의견이에요. AI와 투표를 참고해 마지막 선택은 내가 해요.')).toBeInTheDocument();
    if (votes.a + votes.b === 1) expect(screen.getByText('지금은 한 표만 있어요.')).toBeInTheDocument();
  });

  it('compares against the AI pick when B is recommended', () => {
    render(<DecisionComparison poll={{ ...owner, pick: 'b', votes: { a: 1, b: 4 } }} />);
    expect(screen.getByText('AI의 제안과 더 많은 표를 받은 쪽이 같아요.')).toBeInTheDocument();
    expect(screen.getAllByText('밖에서 식사')).toHaveLength(2);
  });

  it.each([
    { name: 'missing totals', changes: { votes: undefined } },
    { name: 'missing pick', changes: { pick: undefined } },
    { name: 'missing reason', changes: { reason: undefined } },
    { name: 'negative totals', changes: { votes: { a: -1, b: 2 } } },
    { name: 'fractional totals', changes: { votes: { a: 1.5, b: 2 } } },
    { name: 'an unsafe total', changes: { votes: { a: Number.MAX_SAFE_INTEGER, b: 1 } } },
  ])('does not invent a comparison from $name', ({ changes }) => {
    const { container } = render(<DecisionComparison poll={{ ...owner, ...changes }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
