import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ErrorPanel, Screen, Tally, Thinking } from '../components/ui';
import { DecisionComparison } from '../components/DecisionComparison';
import { DecisionReflection } from '../components/DecisionReflection';
import { DecisionReport } from '../components/DecisionReport';
import { buildReconsideration, makeReconsiderState } from '../lib/decisionReconsider';
import { getMyPoll, setDid, sharePoll, type Did, type Poll } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';
import { hasAcceptedContentPolicy, rememberContentPolicyAcceptance, SHARED_CONTENT_RULES } from '../lib/contentPolicy';

import { publicShareOrigin, voteUrl } from '../lib/shareUrl';
export { voteUrl } from '../lib/shareUrl';
const UNSAVED_REFLECTION_NOTICE = '저장하지 않은 회고가 있어요. 회고를 저장하거나 수정 취소 후 이동·새로 고침해 주세요.';
const PENDING_REPORT_NOTICE = '신고 접수 확인이 끝나지 않았어요. 신고 화면에서 같은 신고를 다시 보내거나 접수 확인 없이 나가기를 허용해 주세요.';

/** 내가 만든 결정: 지니의 결론 → 친구에게 물어보기 → 투표 결과 → 실제로 뭘 했는지 기록 */
export function PollScreen() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const sharing = useRef(false), refreshing = useRef(false), recording = useRef(false);
  const dataVersion = useRef(0);
  const reflectionDirty = useRef(false);
  const reportPending = useRef(false);
  const [recordBusy,setRecordBusy] = useState(false);
  const [shareBusy,setShareBusy] = useState(false);
  const [sharePolicyOpen, setSharePolicyOpen] = useState(false);
  const [sharePolicyChecked, setSharePolicyChecked] = useState(false);
  const [sharePolicyStorageWarning, setSharePolicyStorageWarning] = useState(false);
  const policyAcceptedForPage = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const shareLinkRef = useRef<HTMLElement | null>(null);
  const reflectionChanged = useCallback((dirty: boolean) => {
    if (dirty && !reflectionDirty.current) dataVersion.current++;
    reflectionDirty.current = dirty;
    if (!dirty) setNotice(current => current === UNSAVED_REFLECTION_NOTICE ? null : current);
  }, []);
  const reportChanged = useCallback((pending: boolean) => {
    if (pending && !reportPending.current) dataVersion.current++;
    reportPending.current = pending;
    if (!pending) setNotice(current => current === PENDING_REPORT_NOTICE ? null : current);
  }, []);
  useEffect(() => {
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!sharing.current && !recording.current && !reportPending.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, []);

  const copyLink = async (url: string) => {
    const version = loadVersion.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(url);
      if (version !== loadVersion.current) return;
      setNotice('투표 링크를 복사했어요.');
    } catch {
      if (version !== loadVersion.current) return;
      const selection = window.getSelection();
      const range = document.createRange();
      if (shareLinkRef.current && selection) {
        range.selectNodeContents(shareLinkRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setNotice('자동 복사가 차단됐어요. 선택된 링크를 직접 복사해 주세요.');
    }
  };

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setError(null);
    setPoll(null);
    sharing.current=false;recording.current=false;refreshing.current=false;
    setShareBusy(false);setRecordBusy(false);setNotice(null);dataVersion.current++;
    setSharePolicyOpen(false);setSharePolicyChecked(false);setSharePolicyStorageWarning(false);policyAcceptedForPage.current=false;
    try {
      const result = await getMyPoll(id);
      if (version === loadVersion.current) setPoll(result);
    } catch (e) {
      if (version === loadVersion.current) setError(codeOf(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
    return () => { loadVersion.current++; };
  }, [load]);

  // Only guard manual refresh on this decision. Route changes must load the
  // next record and invalidate an outstanding response from the old route.
  const reloadCurrent = () => {
    if (reportPending.current) { setNotice(PENDING_REPORT_NOTICE); return; }
    if (reflectionDirty.current) {
      setNotice(UNSAVED_REFLECTION_NOTICE);
      return;
    }
    // Never reset mutation guards while a server write may still be in flight.
    if (sharing.current || recording.current) {
      setNotice('저장 또는 공유가 진행 중이에요. 완료 후 다시 확인해 주세요.');
      return;
    }
    void load();
  };

  const refreshShared = useCallback(async () => {
    if (refreshing.current || recording.current || sharing.current || reflectionDirty.current || reportPending.current) return;
    refreshing.current=true;
    const version=loadVersion.current, revision=dataVersion.current;
    try {const result=await getMyPoll(id);if(version===loadVersion.current && revision===dataVersion.current && !reflectionDirty.current) setPoll(result);}
    catch(e){if(version===loadVersion.current) setNotice(errorMessage(codeOf(e)));}
    finally {if(version===loadVersion.current) refreshing.current=false;}
  },[id]);
  useEffect(()=>{
    const visible=()=>{if(document.visibilityState==='visible' && poll?.shareCode) void refreshShared();};
    document.addEventListener('visibilitychange',visible);
    return ()=>document.removeEventListener('visibilitychange',visible);
  },[poll?.shareCode,refreshShared]);

  if (error && !poll) return <Screen><ErrorPanel code={error} onRetry={load} /></Screen>;
  if (!poll || poll.id !== id || !poll.pick) return <Screen><Thinking text="불러오는 중" /></Screen>;

  const winner = poll.pick === 'a' ? poll.a : poll.b;
  const loser = poll.pick === 'a' ? poll.b : poll.a;
  const total = (poll.votes?.a ?? 0) + (poll.votes?.b ?? 0);
  const reconsideration = buildReconsideration(poll);
  const draftCleanupFailed = location.state?.draftCleanupFailed === true;

  const ask = async () => {
    if(sharing.current || recording.current) return;
    if(reportPending.current){setNotice(PENDING_REPORT_NOTICE);return;}
    if(!policyAcceptedForPage.current && !hasAcceptedContentPolicy()){
      setSharePolicyOpen(true);setSharePolicyChecked(false);return;
    }
    if(!publicShareOrigin()){setNotice('공유할 웹 주소가 아직 설정되지 않았어요.');return;}
    sharing.current=true;setShareBusy(true);setNotice(null);
    const version=loadVersion.current;
    let shouldRefresh = false;
    try {
      const code=poll.shareCode ?? await sharePoll(id);
      if(version!==loadVersion.current)return;
      setPoll(current=>current?{...current,shareCode:code}:current);
      const url=voteUrl(code)!;
      const text=`${poll.a} vs ${poll.b}, 뭐가 나아? 눌러서 투표해줘`;
      if(navigator.share){
        try {await navigator.share({text,url});if(version===loadVersion.current)setNotice('공유 화면에서 돌아왔어요.');}
        catch(e){if(e instanceof DOMException && e.name==='AbortError'){if(version===loadVersion.current)setNotice('공유를 취소했어요. 결과는 그대로예요.');}else throw e;}
        if(version===loadVersion.current) shouldRefresh = true;
      } else {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
          await navigator.clipboard.writeText(`${text}\n${url}`);
          if(version===loadVersion.current)setNotice('링크를 복사했어요. 카톡에 붙여 넣어 보내세요.');
        } catch {
          if(version===loadVersion.current)setNotice('자동 복사가 차단됐어요. 아래 링크 복사 버튼을 사용하거나 링크를 길게 눌러 복사해 주세요.');
        }
      }
    } catch(e){if(version===loadVersion.current)setNotice(`${errorMessage(codeOf(e))} 공유가 서버에서 완료됐을 수도 있어요. 기록을 확인한 뒤 다시 시도해 주세요.`);}
    finally {if(version===loadVersion.current){sharing.current=false;setShareBusy(false);if(shouldRefresh) void refreshShared();}}
  };

  const record = async (did: Did) => {
    if(recording.current || sharing.current) return;
    if (did === poll.did) return;
    if (reflectionDirty.current) { setNotice(UNSAVED_REFLECTION_NOTICE); return; }
    recording.current=true;setRecordBusy(true);dataVersion.current++;
    const version=loadVersion.current;
    try {
      await setDid(id,did);
      if(version===loadVersion.current) setPoll(current=>current?.id===id?{...current,did}:current);
    } catch(e){if(version===loadVersion.current)setNotice(`${errorMessage(codeOf(e))} 저장 여부를 새로 확인한 뒤 다시 선택해 주세요.`);}
    finally {if(version===loadVersion.current){recording.current=false;setRecordBusy(false);}}
  };

  const leave = (event: MouseEvent<HTMLAnchorElement>) => {
    if (reportPending.current) { event.preventDefault(); setNotice(PENDING_REPORT_NOTICE); return; }
    if (!reflectionDirty.current) return;
    event.preventDefault();
    setNotice(UNSAVED_REFLECTION_NOTICE);
  };

  return (
    <Screen>
      <p className="kicker">지니의 결론</p>
      <p className={`pick ${poll.pick}`}>{winner}!</p>
      <p className="loser">{loser}</p>
      {draftCleanupFailed && <p className="error" role="alert">새 결정은 만들었지만 이 기기의 이전 초안 삭제를 확인하지 못했어요. <Link to="/about" onClick={leave}>초안 관리</Link>에서 확인해 주세요.</p>}
      {poll.shareCode && poll.votes
        ? <DecisionComparison poll={poll} />
        : <p className="reason">{poll.reason}</p>}
      {poll.note && (
        <details className="decision-context">
          <summary>이번 결정의 기준과 상황</summary>
          <p className="context-text">{poll.note}</p>
        </details>
      )}
      {reconsideration && <Link to="/" state={makeReconsiderState(reconsideration)} className="btn ghost" onClick={leave}>
        조건을 고쳐 다시 비교
      </Link>}

      <button type="button" className="btn" disabled={shareBusy || recordBusy} onClick={ask}>
        {poll.shareCode ? '투표 링크 다시 보내기' : '친구한테 물어보기'}
      </button>
      {sharePolicyOpen && <section className="sharebox" aria-label="공유 전 콘텐츠 정책 동의">
        <h3>공유 전에 확인해 주세요</h3>
        <ul className="help">{SHARED_CONTENT_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul>
        <p className="small">정책을 어긴 질문은 신고 검토 후 공유가 중단되거나 삭제될 수 있어요.</p>
        <Link to="/content-policy" onClick={leave}>공유 콘텐츠 이용정책 전체 보기</Link>
        <label className="report-consent">
          <input type="checkbox" checked={sharePolicyChecked} disabled={shareBusy || recordBusy}
            onChange={event => setSharePolicyChecked(event.target.checked)} />
          공유 콘텐츠 이용정책을 확인했고 동의해요.
        </label>
        <button type="button" className="btn" disabled={!sharePolicyChecked || shareBusy || recordBusy}
          onClick={() => {
            if (!sharePolicyChecked || sharing.current || recording.current) return;
            policyAcceptedForPage.current = true;
            setSharePolicyStorageWarning(!rememberContentPolicyAcceptance());
            setSharePolicyOpen(false);void ask();
          }}>동의하고 공유하기</button>
        <button type="button" className="btn text" onClick={() => { setSharePolicyOpen(false); setSharePolicyChecked(false); }}>공유 취소</button>
      </section>}
      {sharePolicyStorageWarning && <p className="small" role="status">동의는 이번 공유에 적용했어요. 기기에 저장하지 못해 다음에는 다시 확인할 수 있어요.</p>}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}

      {poll.shareCode && (
        <section className="sharebox">
          <p className="small">친구에게 보낼 링크</p>
          <code ref={shareLinkRef} className="share-url">{voteUrl(poll.shareCode) ?? '공유 주소 설정이 필요해요'}</code>
          {voteUrl(poll.shareCode) && <button type="button" className="btn text" onClick={() => void copyLink(voteUrl(poll.shareCode!)!)}>링크 복사</button>}
          <h3>{total > 0 ? `친구 ${total}명이 투표했어요` : '아직 투표가 없어요'}</h3>
          <Tally poll={poll} />
          <button type="button" className="btn text" disabled={shareBusy || recordBusy} onClick={reloadCurrent}>
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
          <button type="button" key={key} disabled={recordBusy || shareBusy} aria-pressed={poll.did === key} onClick={() => record(key)}>
            {label}
          </button>
        ))}
      </div>
      {poll.isOwner && (poll.did === 'a' || poll.did === 'b') && (
        <DecisionReflection pollId={id} choice={poll.did}
          choiceLabel={poll.did === 'a' ? poll.a : poll.b} disabled={recordBusy || shareBusy}
          onDirtyChange={reflectionChanged} />
      )}
      {poll.isOwner && typeof poll.reason === 'string' && <DecisionReport target={{ kind: 'owner', pollId: id }}
        choiceLabel={winner} reason={poll.reason} disabled={recordBusy || shareBusy} onRequestPendingChange={reportChanged} />}
      <Link to="/history" onClick={leave}>결정 기록 보기</Link>
      <Link to="/" className="btn ghost" onClick={leave}>
        다른 것도 정하기
      </Link>
    </Screen>
  );
}

