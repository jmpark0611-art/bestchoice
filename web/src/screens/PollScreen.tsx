import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorPanel, Screen, Tally, Thinking } from '../components/ui';
import { getMyPoll, setDid, sharePoll, type Did, type Poll } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';

export const voteUrl = (code: string) => `${window.location.origin}/v/${code}`;

/** 내가 만든 결정: 지니의 결론 → 친구에게 물어보기 → 투표 결과 → 실제로 뭘 했는지 기록 */
export function PollScreen() {
  const { id = '' } = useParams();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPoll(await getMyPoll(id));
    } catch (e) {
      setError(codeOf(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !poll) return <Screen><ErrorPanel code={error} onRetry={load} /></Screen>;
  if (!poll || !poll.pick) return <Screen><Thinking text="불러오는 중" /></Screen>;

  const winner = poll.pick === 'a' ? poll.a : poll.b;
  const loser = poll.pick === 'a' ? poll.b : poll.a;
  const total = (poll.votes?.a ?? 0) + (poll.votes?.b ?? 0);

  const ask = async () => {
    setNotice(null);
    try {
      const code = poll.shareCode ?? (await sharePoll(id));
      setPoll({ ...poll, shareCode: code });
      const url = voteUrl(code);
      const text = `${poll.a} vs ${poll.b}, 뭐가 나아? 눌러서 투표해줘`;
      if (navigator.share) {
        // 공유 창을 닫아도 오류가 아니므로 무시
        await navigator.share({ text, url }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setNotice('링크를 복사했어요. 카톡에 붙여 넣어 보내세요.');
      }
    } catch (e) {
      setNotice(e instanceof DOMException ? '아래 주소를 길게 눌러 복사해주세요.' : errorMessage(codeOf(e)));
    }
  };

  const record = async (did: Did) => {
    try {
      await setDid(id, did);
      setPoll({ ...poll, did });
    } catch (e) {
      setNotice(errorMessage(codeOf(e)));
    }
  };

  return (
    <Screen>
      <p className="kicker">지니의 결론</p>
      <p className={`pick ${poll.pick}`}>{winner}!</p>
      <p className="loser">{loser}</p>
      <p className="reason">{poll.reason}</p>

      <button type="button" className="btn" onClick={ask}>
        {poll.shareCode ? '투표 링크 다시 보내기' : '친구한테 물어보기'}
      </button>
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}

      {poll.shareCode && (
        <section className="sharebox">
          <code>{voteUrl(poll.shareCode)}</code>
          <h3>{total > 0 ? `친구 ${total}명이 투표했어요` : '아직 투표가 없어요'}</h3>
          <Tally poll={poll} />
          <button type="button" className="btn text" onClick={load}>
            새로 고침
          </button>
        </section>
      )}

      <div className="grow" />
      <h3>그래서, 뭘로 했어요?</h3>
      <div className="three" role="group" aria-label="실제 선택">
        {(
          [
            ['a', poll.a],
            ['b', poll.b],
            ['none', '아직 고민 중'],
          ] as [Did, string][]
        ).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={poll.did === key} onClick={() => record(key)}>
            {label}
          </button>
        ))}
      </div>
      <Link to="/" className="btn ghost">
        다른 것도 정하기
      </Link>
    </Screen>
  );
}
