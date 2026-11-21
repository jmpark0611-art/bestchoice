import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../components/ui';
import { listDecisionHistory, deleteDecision, type DecisionRecord } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';
export function HistoryScreen() {
  const [rows,setRows] = useState<DecisionRecord[]>([]);
  const [busy,setBusy] = useState(false);
  const [more,setMore] = useState(false);
  const [error,setError] = useState('');
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all');
  const lock = useRef(false), version = useRef(0);
  const load = useCallback(async (offset=0) => {
    if(lock.current) return;
    lock.current=true; setBusy(true); setError('');
    const generation=++version.current;
    try {
      const result=await listDecisionHistory(offset,30);
      if(generation!==version.current) return;
      setRows(old => offset ? [...new Map([...old,...result].map(r=>[r.id,r])).values()] : result);
      setMore(result.length===30);
    } catch(e) { if(generation===version.current) setError(errorMessage(codeOf(e))); }
    finally { if(generation===version.current) {lock.current=false;setBusy(false);} }
  },[]);
  useEffect(()=>{void load();return ()=>{version.current++;lock.current=false;};},[load]);
  const remove=async (row:DecisionRecord)=>{
    if(lock.current || !window.confirm(`“${row.a} vs ${row.b}” 기록과 친구 투표를 삭제할까요? 되돌릴 수 없어요.`)) return;
    lock.current=true; setBusy(true);setError('');
    const generation=++version.current;
    try {
      await deleteDecision(row.id);
      if(generation===version.current) setRows(old=>old.filter(r=>r.id!==row.id));
    } catch(e) {if(generation===version.current) setError('삭제 완료 여부를 확인하지 못했어요. 새로 고침으로 확인한 뒤 다시 시도해주세요.');}
    finally {if(generation===version.current){lock.current=false;setBusy(false);}}
  };
  const visible=rows.filter(r=>(`${r.a} ${r.b}`).toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
    (filter==='all' || (filter==='done' ? r.did==='a'||r.did==='b' : !r.did||r.did==='none')));
  return <Screen><h1>결정 기록</h1><Link to="/">처음으로</Link>
    <p className="small">서버 기록은 2개월 보관돼요. 익명 로그인이라 기기를 바꾸거나 브라우저 데이터를 지우면 이전 기록을 다시 찾지 못할 수 있어요.</p>
    <label>기록 검색<input value={query} onChange={e=>setQuery(e.target.value)} /></label>
    <p className="small">지금 불러온 {rows.length}건 안에서 검색해요.</p>
    <label>실제 선택 필터<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option><option value="done">선택 완료</option><option value="pending">고민 중</option></select></label>
    <button disabled={busy} onClick={()=>void load()}>새로 고침</button>
    {busy&&<p role="status">처리 중…</p>}{error&&<p role="alert">{error}</p>}
    {!busy&&!visible.length&&<p>표시할 기록이 없어요.</p>}
    {visible.map(r=><section key={r.id} className="sharebox"><Link to={`/p/${r.id}`}>{r.a} vs {r.b}</Link>
      <p>AI 선택: {r.pick==='a'?r.a:r.b}</p><p>실제 선택: {r.did==='a'?r.a:r.did==='b'?r.b:'아직 고민 중'}</p>
      {(r.did==='a'||r.did==='b')&&<p>{r.did===r.pick?'AI와 같은 선택':'AI와 다른 선택'}</p>}
      <time>{new Date(r.createdAt).toLocaleDateString('ko-KR')}</time>
      <button disabled={busy} aria-label={`${r.a} vs ${r.b} 삭제`} onClick={()=>void remove(r)}>삭제</button></section>)}
    {more&&<button disabled={busy} onClick={()=>void load(rows.length)}>이전 기록 더 보기</button>}
  </Screen>;
}
