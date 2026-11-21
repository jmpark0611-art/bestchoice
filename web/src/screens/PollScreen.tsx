import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorPanel, Screen, Tally, Thinking } from '../components/ui';
import { getMyPoll, setDid, sharePoll, type Did, type Poll } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';

import { publicShareOrigin, voteUrl } from '../lib/shareUrl';
export { voteUrl } from '../lib/shareUrl';

/** 내가 만든 결정: 지니의 결론 → 친구에게 물어보기 → 투표 결과 → 실제로 뭘 했는지 기록 */
export function PollScreen() {
  const { id = '' } = useParams();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const sharing = useRef(false), refreshing = useRef(false), recording = useRef(false);
  const dataVersion = useRef(0);
  const [recordBusy,setRecordBusy] = useState(false);
  const [shareBusy,setShareBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const shareLinkRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!sharing.current && !recording.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, []);

  const copyLink = async (url: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(url);
      setNotice('투표 링크를 복사했어요.');
    } catch {
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
    // Never reset mutation guards while a server write may still be in flight.
    if (sharing.current || recording.current) {
      setNotice('저장 또는 공유가 진행 중이에요. 완료 후 다시 확인해 주세요.');
      return;
    }
    void load();
  };

  const refreshShared = useCallback(async () => {
    if (refreshing.current || recording.current || sharing.current) return;
    refreshing.current=true;
    const version=loadVersion.current, revision=dataVersion.current;
    try {const result=await getMyPoll(id);if(version===loadVersion.current && revision===dataVersion.current) setPoll(result);}
    catch(e){if(version===loadVersion.current) setNotice(errorMessage(codeOf(e)));}
    finally {if(version===loadVersion.current) refreshing.current=false;}
  },[id]);
  useEffect(()=>{
    const visible=()=>{if(document.visibilityState==='visible' && poll?.shareCode) void refreshShared();};
    document.addEventListener('visibilitychange',visible);
    return ()=>document.removeEventListener('visibilitychange',visible);
  },[poll?.shareCode,refreshShared]);

  if (error && !poll) return <Screen><ErrorPanel code={error} onRetry={load} /></Screen>;
  if (!poll || !poll.pick) return <Screen><Thinking text="불러오는 중" /></Screen>;

  const winner = poll.pick === 'a' ? poll.a : poll.b;
  const loser = poll.pick === 'a' ? poll.b : poll.a;
  const total = (poll.votes?.a ?? 0) + (poll.votes?.b ?? 0);

  const ask = async () => {
    if(sharing.current || recording.current) return;
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
    recording.current=true;setRecordBusy(true);dataVersion.current++;
    const version=loadVersion.current;
    try {
      await setDid(id,did);
      if(version===loadVersion.current) setPoll(current=>current?.id===id?{...current,did}:current);
    } catch(e){if(version===loadVersion.current)setNotice(`${errorMessage(codeOf(e))} 저장 여부를 새로 확인한 뒤 다시 선택해 주세요.`);}
    finally {if(version===loadVersion.current){recording.current=false;setRecordBusy(false);}}
  };

  return (
    <Screen>
      <p className="kicker">지니의 결론</p>
      <p className={`pick ${poll.pick}`}>{winner}!</p>
      <p className="loser">{loser}</p>
      <p className="reason">{poll.reason}</p>

      <button type="button" className="btn" disabled={shareBusy || recordBusy} onClick={ask}>
        {poll.shareCode ? '투표 링크 다시 보내기' : '친구한테 물어보기'}
      </button>
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
      <Link to="/history">결정 기록 보기</Link>
      <Link to="/" className="btn ghost">
        다른 것도 정하기
      </Link>
    </Screen>
  );
}

