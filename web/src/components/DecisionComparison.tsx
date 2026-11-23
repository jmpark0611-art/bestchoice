import type { Poll } from '../lib/api';

/** Compare only results this visitor is already allowed to see. */
export function DecisionComparison({ poll }: { poll: Poll }) {
  const allowed = poll.isOwner === true || poll.myVote === 'a' || poll.myVote === 'b';
  const votes = poll.votes;
  if (!allowed || (poll.pick !== 'a' && poll.pick !== 'b') ||
      typeof poll.reason !== 'string' || !poll.reason.trim() ||
      typeof poll.a !== 'string' || !poll.a.trim() ||
      typeof poll.b !== 'string' || !poll.b.trim() || !votes ||
      !Number.isSafeInteger(votes.a) || votes.a < 0 ||
      !Number.isSafeInteger(votes.b) || votes.b < 0) return null;

  const total = votes.a + votes.b;
  if (!Number.isSafeInteger(total)) return null;
  const leader = votes.a === votes.b ? null : votes.a > votes.b ? 'a' : 'b';
  const aiChoice = poll.pick === 'a' ? poll.a : poll.b;
  const friendChoice = leader === 'a' ? poll.a : leader === 'b' ? poll.b : null;
  const summary = total === 0
    ? '친구 의견이 모이면 여기에서 비교할 수 있어요.'
    : leader === null
      ? '현재 투표는 동점이에요.'
      : total === 1
        ? leader === poll.pick
          ? '첫 투표가 AI와 같은 쪽이에요.'
          : '첫 투표가 AI와 다른 쪽이에요.'
        : leader === poll.pick
          ? 'AI의 제안과 더 많은 표를 받은 쪽이 같아요.'
          : 'AI의 제안과 더 많은 표를 받은 쪽이 달라요.';

  return (
    <section className="decision-comparison" aria-label="AI와 친구 의견 비교">
      <h3>AI와 친구 의견</h3>
      <div className="decision-comparison-grid">
        <div className="decision-comparison-card">
          <h4 className="decision-comparison-label">지니의 선택</h4>
          <p className={`decision-comparison-choice ${poll.pick}`}>{aiChoice}</p>
          <p className="decision-comparison-reason">{poll.reason}</p>
        </div>
        <div className="decision-comparison-card">
          <h4 className="decision-comparison-label">친구 투표</h4>
          <p className={`decision-comparison-choice${leader ? ` ${leader}` : ''}`}>
            {total === 0 ? '친구 의견을 기다리고 있어요' : friendChoice ?? '같은 표를 받았어요'}
          </p>
          <p className="small">{poll.a} {votes.a}표 · {poll.b} {votes.b}표</p>
          {total === 1 && <p className="small">지금은 한 표만 있어요.</p>}
        </div>
      </div>
      <p className="decision-comparison-summary">{summary}</p>
      <p className="small">참여한 사람들의 의견이에요. AI와 투표를 참고해 마지막 선택은 내가 해요.</p>
    </section>
  );
}
