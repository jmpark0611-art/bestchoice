import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Brand, ErrorPanel, Screen, Tally, Thinking } from '../components/ui';
import { DecisionComparison } from '../components/DecisionComparison';
import { DecisionReport } from '../components/DecisionReport';
import { getSharedPoll, setQuestionAuthorBlocked, vote, type Poll, type Side } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';

const PENDING_REPORT_NOTICE = '신고 접수 확인이 끝나지 않았어요. 신고 화면에서 같은 신고를 다시 보내거나 접수 확인 없이 나가기를 허용해 주세요.';
type ReportKind = 'question' | 'ai';

/** The shared question can be reported before voting; AI results remain vote-gated. */
export function VoteScreen() {
  const { code = '' } = useParams();
  const routeCode = useRef(code);
  routeCode.current = code;
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pollCode, setPollCode] = useState<string | null>(null);
  const generation = useRef(0);
  const casting = useRef(false);
  const changingBlock = useRef(false);
  const reportPending = useRef({ question: false, ai: false });
  const [pendingReports, setPendingReports] = useState({ question: false, ai: false });
  const [error, setError] = useState<string | null>(null);
  const [errorRoute, setErrorRoute] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const updateReportPending = useCallback((kind: ReportKind, pending: boolean, reportCode: string) => {
    if (reportCode !== routeCode.current) return;
    reportPending.current = { ...reportPending.current, [kind]: pending };
    setPendingReports(reportPending.current);
    if (!reportPending.current.question && !reportPending.current.ai) {
      setNotice(current => current === PENDING_REPORT_NOTICE ? null : current);
    }
  }, []);
  const questionReportChanged = useCallback((pending: boolean) => {
    updateReportPending('question', pending, code);
  }, [code, updateReportPending]);
  const aiReportChanged = useCallback((pending: boolean) => {
    updateReportPending('ai', pending, code);
  }, [code, updateReportPending]);
  const hasPendingReport = () => reportPending.current.question || reportPending.current.ai;
  const leave = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hasPendingReport()) return;
    event.preventDefault(); setNotice(PENDING_REPORT_NOTICE);
  };
  useEffect(() => {
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!reportPending.current.question && !reportPending.current.ai) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, []);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null); setErrorRoute(null); setPoll(null); setPollCode(null); setNotice(null);
    casting.current = false; changingBlock.current = false;
    setVoting(false); setBlocking(false);
    reportPending.current = { question: false, ai: false };
    setPendingReports(reportPending.current);
    try {
      const result = await getSharedPoll(code);
      if (current === generation.current && routeCode.current === code) {
        setPoll(result); setPollCode(code);
      }
    } catch (e) {
      if (current === generation.current && routeCode.current === code) {
        setError(codeOf(e)); setErrorRoute(code);
      }
    }
  }, [code]);
  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);

  const refresh = () => {
    if (hasPendingReport()) { setNotice(PENDING_REPORT_NOTICE); return; }
    if (casting.current || changingBlock.current) return;
    void load();
  };

  const changeBlock = async (blocked: boolean) => {
    if (hasPendingReport()) { setNotice(PENDING_REPORT_NOTICE); return; }
    if (changingBlock.current || casting.current) return;
    if (blocked && !window.confirm('이 작성자의 질문을 차단할까요? 지금 보는 질문도 숨겨져요. 이용 안내에서 전체 차단을 해제할 수 있어요.')) return;
    changingBlock.current = true;
    const current = ++generation.current;
    setBlocking(true); setNotice(null); setError(null); setErrorRoute(null);
    // Hide content while a block result is unknown, including a timeout after a server write.
    setPoll(null); setPollCode(null);
    try {
      await setQuestionAuthorBlocked(code, blocked);
      if (current !== generation.current || routeCode.current !== code) return;
      changingBlock.current = false; setBlocking(false);
      if (blocked) { setError('AUTHOR_BLOCKED'); setErrorRoute(code); }
      else void load();
    } catch (e) {
      if (current !== generation.current || routeCode.current !== code) return;
      changingBlock.current = false; setBlocking(false);
      setError(codeOf(e) === 'BLOCK_LIMIT' ? 'BLOCK_LIMIT' : 'BLOCK_STATUS_UNKNOWN');
      setErrorRoute(code);
    }
  };

  if (blocking) return <Screen><Thinking text="차단 설정 확인 중" /></Screen>;
  if (error && errorRoute === code && !poll) {
    if (error === 'AUTHOR_BLOCKED' || error === 'BLOCK_STATUS_UNKNOWN' || error === 'BLOCK_LIMIT') {
      return <Screen>
        <Brand onClick={leave} />
        <h2>{error === 'AUTHOR_BLOCKED' ? '차단한 작성자의 질문이에요.' : error === 'BLOCK_LIMIT'
          ? errorMessage('BLOCK_LIMIT') : '차단 상태를 확인하지 못했어요.'}</h2>
        <p className="small">질문과 AI 결과는 표시하지 않아요.</p>
        {error === 'AUTHOR_BLOCKED' && <button type="button" className="btn ghost" onClick={() => void changeBlock(false)}>
          차단 해제하고 보기
        </button>}
        {error === 'BLOCK_STATUS_UNKNOWN' && <p className="small">서버에 반영됐을 수 있어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.</p>}
        <button type="button" className="btn text" onClick={refresh}>차단 상태 다시 확인</button>
        <Link to="/about">차단 관리</Link>
        <Link to="/" className="btn text">처음으로</Link>
      </Screen>;
    }
    return <Screen><ErrorPanel code={error} onRetry={error === 'NOT_FOUND' ? undefined : refresh} /></Screen>;
  }
  if (!poll || pollCode !== code) return <Screen><Thinking text="불러오는 중" /></Screen>;
  if (poll.isOwner && poll.id) return <Navigate to={`/p/${poll.id}`} replace />;

  const cast = async (choice: Side) => {
    if (hasPendingReport()) { setNotice(PENDING_REPORT_NOTICE); return; }
    if (casting.current || changingBlock.current || pollCode !== code || poll.myVote) return;
    casting.current = true;
    const current = generation.current;
    setVoting(true); setNotice(null);
    try {
      const result = await vote(code, choice);
      if (current === generation.current && routeCode.current === code) { setPoll(result); setPollCode(code); }
    } catch (e) {
      if (current === generation.current && routeCode.current === code) {
        if (codeOf(e) === 'AUTHOR_BLOCKED') {
          setPoll(null); setPollCode(null); setError('AUTHOR_BLOCKED'); setErrorRoute(code);
        } else setNotice(errorMessage(codeOf(e)));
      }
    } finally {
      if (current === generation.current && routeCode.current === code) { casting.current = false; setVoting(false); }
    }
  };

  const actionDisabled = voting || blocking || pendingReports.question || pendingReports.ai;
  const questionReport = <DecisionReport key={`question:${code}`} target={{ kind: 'question', shareCode: code }}
    question={{ a: poll.a, b: poll.b, note: poll.note }} disabled={voting || blocking}
    onRequestPendingChange={questionReportChanged} />;
  const questionControls = <div key="question-controls" className="sharebox">
    <button type="button" className="btn text" disabled={actionDisabled} onClick={refresh}>새로 고침</button>
    <button type="button" className="btn text" disabled={actionDisabled} onClick={() => void changeBlock(true)}>이 작성자 차단</button>
  </div>;

  if (poll.myVote && poll.pick) {
    return (
      <Screen>
        <Brand onClick={leave} />
        <h2>투표했어요. 지금까지 이래요.</h2>
        <Tally poll={poll} />
        <DecisionComparison poll={poll} />
        {questionReport}
        {typeof poll.reason === 'string' && <DecisionReport key={`ai:${code}`} target={{ kind: 'voter', shareCode: code }}
          choiceLabel={poll.pick === 'a' ? poll.a : poll.b} reason={poll.reason} disabled={voting || blocking}
          onRequestPendingChange={aiReportChanged} />}
        {notice && <p className="small" role="status">{notice}</p>}
        {questionControls}
        <div className="grow" />
        <p className="lead">나도 못 정한 게 있다면</p>
        <Link to="/" className="btn" onClick={leave}>나도 결정 받기</Link>
      </Screen>
    );
  }

  return (
    <Screen>
      <Brand onClick={leave} />
      <h2>친구가 고민 중이에요.<br />뭐가 낫다고 생각해요?</h2>
      {poll.note && <p className="lead context-text">“{poll.note}”</p>}
      <div className="ballot">
        <button type="button" className="vote a" disabled={actionDisabled} onClick={() => void cast('a')}>
          {poll.a}<span>눌러서 투표</span>
        </button>
        <button type="button" className="vote b" disabled={actionDisabled} onClick={() => void cast('b')}>
          {poll.b}<span>눌러서 투표</span>
        </button>
      </div>
      {questionReport}
      {notice && <div>
        <p className="error" role="alert">{notice}</p>
        <button type="button" disabled={actionDisabled} onClick={refresh}>내 투표 상태 다시 확인</button>
      </div>}
      {questionControls}
      <p className="small">투표는 이름 없이 집계돼요. 가입도 필요 없어요.</p>
    </Screen>
  );
}
