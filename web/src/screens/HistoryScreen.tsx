import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../components/ui';
import { listDecisionHistory, deleteDecision, type DecisionRecord } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';
import { deleteDecisionDraftsForPoll } from '../lib/decisionDrafts';
import {
  deleteDecisionReflection, readDecisionReflections, reflectionRatingLabel,
  type DecisionReflectionRecord,
} from '../lib/decisionReflections';

export function HistoryScreen() {
  const [rows, setRows] = useState<DecisionRecord[]>([]);
  const [reflections, setReflections] = useState<DecisionReflectionRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [localError, setLocalError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [reflectionFilter, setReflectionFilter] = useState('all');
  const lock = useRef(false), version = useRef(0);

  const load = useCallback(async (offset = 0) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const generation = ++version.current;
    try {
      const result = await listDecisionHistory(offset, 30);
      if (generation !== version.current) return;
      setRows(old => offset ? [...new Map([...old, ...result].map(r => [r.id, r])).values()] : result);
      setMore(result.length === 30);
      const local = readDecisionReflections();
      if (local.ok) { setReflections(local.value); setLocalError(''); }
      else {
        setReflections([]);
        setLocalError('이 기기의 회고를 불러오지 못했어요. 결정 기록은 계속 볼 수 있어요.');
      }
    } catch (e) {
      if (generation === version.current) setError(errorMessage(codeOf(e)));
    } finally {
      if (generation === version.current) { lock.current = false; setBusy(false); }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { version.current++; lock.current = false; };
  }, [load]);

  const remove = async (row: DecisionRecord) => {
    if (lock.current || !window.confirm(`“${row.a} vs ${row.b}” 기록과 친구 투표, 이 기기의 회고와 관련 초안을 삭제할까요? 되돌릴 수 없어요.`)) return;
    lock.current = true; setBusy(true); setError('');
    const generation = ++version.current;
    try {
      await deleteDecision(row.id);
      // Local cleanup belongs to the confirmed server deletion even after leaving this screen.
      const local = deleteDecisionReflection(row.id);
      const drafts = deleteDecisionDraftsForPoll(row.id);
      if (generation !== version.current) return;
      setRows(old => old.filter(r => r.id !== row.id));
      if (local.ok) setReflections(old => old.filter(r => r.pollId !== row.id));
      if (!local.ok || !drafts.ok) setLocalError('결정과 친구 투표는 삭제했지만 이 기기의 회고 또는 관련 초안 삭제를 확인하지 못했어요. 이용 안내에서 기기 회고와 초안을 확인해 주세요.');
    } catch {
      if (generation === version.current) setError('삭제 완료 여부를 확인하지 못했어요. 새로 고침으로 확인한 뒤 다시 시도해주세요.');
    } finally {
      if (generation === version.current) { lock.current = false; setBusy(false); }
    }
  };

  const reflectionByChoice = new Map(reflections.map(entry => [`${entry.pollId}:${entry.choice}`, entry]));
  const visible = rows.filter(row => {
    const matchesQuery = `${row.a} ${row.b}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const done = row.did === 'a' || row.did === 'b';
    const matchesChoice = filter === 'all' || (filter === 'done' ? done : !done);
    const reflection = reflectionByChoice.get(`${row.id}:${row.did}`);
    const matchesReflection = !!localError || reflectionFilter === 'all' ||
      (reflectionFilter === 'unwritten' ? done && !reflection : reflection?.rating === reflectionFilter);
    return matchesQuery && matchesChoice && matchesReflection;
  });

  return (
    <Screen>
      <h1>결정 기록</h1>
      <Link to="/">처음으로</Link>
      <p className="small">서버 기록은 2개월 보관돼요. 익명 로그인이라 기기를 바꾸거나 브라우저 데이터를 지우면 이전 기록을 다시 찾지 못할 수 있어요.</p>
      <label className="field">기록 검색<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <p className="small">지금 불러온 {rows.length}건 안에서 검색해요.</p>
      <label className="field">실제 선택 필터
        <select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">전체</option><option value="done">선택 완료</option><option value="pending">고민 중</option>
        </select>
      </label>
      <label className="field">회고 필터
        <select value={reflectionFilter} disabled={!!localError} onChange={event => setReflectionFilter(event.target.value)}>
          <option value="all">전체 회고</option><option value="unwritten">선택했지만 회고 없음</option>
          <option value="satisfied">만족</option><option value="neutral">보통</option><option value="regret">아쉬움</option>
        </select>
      </label>
      <p className="small">회고는 이 기기에 저장한 내용만 보여요. 실제 선택을 바꾸면 그 선택에 남긴 회고를 보여줘요.</p>
      <button type="button" className="btn text" disabled={busy} onClick={() => void load()}>새로 고침</button>
      {busy && <p role="status">처리 중…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {localError && <p className="error" role="alert">{localError} <Link to="/about">이용 안내</Link></p>}
      {!busy && !visible.length && <p>표시할 기록이 없어요.</p>}
      {visible.map(row => {
        const reflection = reflectionByChoice.get(`${row.id}:${row.did}`);
        const done = row.did === 'a' || row.did === 'b';
        return (
          <section key={row.id} className="sharebox history-entry">
            <Link to={`/p/${row.id}`}>{row.a} vs {row.b}</Link>
            <p>AI 선택: {row.pick === 'a' ? row.a : row.b}</p>
            <p>실제 선택: {row.did === 'a' ? row.a : row.did === 'b' ? row.b : '아직 고민 중'}</p>
            {done && <p>{row.did === row.pick ? 'AI와 같은 선택' : 'AI와 다른 선택'}</p>}
            {reflection && <div className="history-reflection">
              <p>회고: <strong>{reflectionRatingLabel(reflection.rating)}</strong></p>
              {reflection.note && <p className="context-text">{reflection.note}</p>}
            </div>}
            {done && !reflection && !localError && <Link to={`/p/${row.id}`}>선택 후 느낌 남기기</Link>}
            <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleDateString('ko-KR')}</time>
            <button type="button" className="btn text" disabled={busy} aria-label={`${row.a} vs ${row.b} 삭제`}
              onClick={() => void remove(row)}>삭제</button>
          </section>
        );
      })}
      {more && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(rows.length)}>이전 기록 더 보기</button>}
    </Screen>
  );
}
