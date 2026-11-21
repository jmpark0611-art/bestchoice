import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Brand, ErrorPanel, Screen, Tally, Thinking } from '../components/ui';
import { getSharedPoll, vote, type Poll, type Side } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';

/** 링크를 받은 친구 화면. 가입 없이 한 표를 던지고, 던진 뒤에만 집계와 지니의 선택을 본다 */
export function VoteScreen() {
  const { code = '' } = useParams();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pollCode, setPollCode] = useState<string | null>(null);
  const generation = useRef(0);
  const casting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null); setPoll(null); setPollCode(null); setNotice(null);
    casting.current = false; setVoting(false);
    try {
      const result = await getSharedPoll(code);
      if (current === generation.current) { setPoll(result); setPollCode(code); }
    } catch (e) {
      if (current === generation.current) setError(codeOf(e));
    }
  }, [code]);
  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);

  if (error && !poll) return <Screen><ErrorPanel code={error} onRetry={error === 'NOT_FOUND' ? undefined : load} /></Screen>;
  if (!poll || pollCode !== code) return <Screen><Thinking text="불러오는 중" /></Screen>;
  // 내가 만든 투표 링크를 직접 열었으면 내 화면으로 보낸다
  if (poll.isOwner && poll.id) return <Navigate to={`/p/${poll.id}`} replace />;

  const cast = async (choice: Side) => {
    if (casting.current || pollCode !== code || poll.myVote) return;
    casting.current = true;
    const current = generation.current;
    setVoting(true);
    setNotice(null);
    try {
      const result = await vote(code, choice);
      if (current === generation.current) { setPoll(result); setPollCode(code); }
    } catch (e) {
      if (current === generation.current) setNotice(errorMessage(codeOf(e)));
    } finally {
      if (current === generation.current) { casting.current = false; setVoting(false); }
    }
  };

  if (poll.myVote && poll.pick) {
    return (
      <Screen>
        <Brand />
        <h2>투표했어요. 지금까지 이래요.</h2>
        <Tally poll={poll} />
        <div className="genie">
          <b>지니의 선택</b>
          <span>{poll.pick === 'a' ? poll.a : poll.b}</span>
        </div>
        <p className="reason">{poll.reason}</p>
        <div className="grow" />
        <p className="lead">나도 못 정한 게 있다면</p>
        <Link to="/" className="btn">
          나도 결정 받기
        </Link>
      </Screen>
    );
  }

  return (
    <Screen>
      <Brand />
      <h2>
        친구가 고민 중이에요.
        <br />
        뭐가 낫다고 생각해요?
      </h2>
      {poll.note && <p className="lead">“{poll.note}”</p>}
      <div className="ballot">
        <button type="button" className="vote a" disabled={voting} onClick={() => cast('a')}>
          {poll.a}
          <span>눌러서 투표</span>
        </button>
        <button type="button" className="vote b" disabled={voting} onClick={() => cast('b')}>
          {poll.b}
          <span>눌러서 투표</span>
        </button>
      </div>
      {notice && (
        <div><p className="error" role="alert">{notice}</p><button type="button" onClick={load}>내 투표 상태 다시 확인</button></div>
      )}
      <p className="small">투표는 이름 없이 집계돼요. 가입도 필요 없어요.</p>
    </Screen>
  );
}

