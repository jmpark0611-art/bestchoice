import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand, CrisisPanel, Screen, Thinking } from '../components/ui';
import { decide, listMyPolls, type PollSummary } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';

export const OPTION_MAX = 20;
export const NOTE_MAX = 60;
const EXAMPLES: [string, string][] = [
  ['짜장면', '짬뽕'],
  ['이직한다', '남는다'],
  ['산다', '참는다'],
  ['연락한다', '기다린다'],
];

export function HomeScreen() {
  const navigate = useNavigate();
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<PollSummary[]>([]);

  const [recentError, setRecentError] = useState(false);
  const recentVersion = useRef(0);
  const loadRecent = useCallback(async () => {
    const version = ++recentVersion.current;
    try {
      const rows = await listMyPolls();
      if (!active.current || version !== recentVersion.current) return;
      setRecent(rows);
      setRecentError(false);
    } catch {
      if (active.current && version === recentVersion.current) setRecentError(true);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const ready = a.trim().length > 0 && b.trim().length > 0;

  const submit = async () => {
    if (submitting.current || !ready) return;
    if (a.trim() === b.trim()) return setError(errorMessage('SAME_OPTIONS'));
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await decide({ a: a.trim(), b: b.trim(), note: note.trim() });
      if (!active.current) return;
      if (result.kind === 'crisis') setCrisis(true);
      else navigate(`/p/${result.id}`);
    } catch (e) {
      if (!active.current) return;
      setError(errorMessage(codeOf(e)));
      // Read only: do not resubmit or guess which recent row belongs to this request.
      void loadRecent();
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };

  if (busy) {
    return (
      <Screen>
        <Thinking text={`${a.trim()} vs ${b.trim()}, 저울질하는 중`} />
      </Screen>
    );
  }
  if (crisis) {
    return (
      <Screen>
        <Brand />
        <CrisisPanel />
        <Link to="/history">결정 기록 전체 보기</Link>
      <div className="grow" />
        <button type="button" className="btn ghost" onClick={() => setCrisis(false)}>
          돌아가기
        </button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Brand />
      <h1>
        이거, <em>저거?</em>
      </h1>
      <p className="lead">둘만 적으면 지니가 바로 골라줘요.</p>
      <div className="versus">
        <div className="side a">
          <label htmlFor="in-a">A</label>
          <input id="in-a" maxLength={OPTION_MAX} value={a} onChange={(e) => setA(e.target.value)} placeholder="짜장면" autoComplete="off" />
        </div>
        <div className="vs">vs</div>
        <div className="side b">
          <label htmlFor="in-b">B</label>
          <input id="in-b" maxLength={OPTION_MAX} value={b} onChange={(e) => setB(e.target.value)} placeholder="짬뽕" autoComplete="off" />
        </div>
      </div>
      <div className="chips" aria-label="예시">
        {EXAMPLES.map(([ea, eb]) => (
          <button
            type="button"
            key={ea}
            className="chip"
            onClick={() => {
              setA(ea);
              setB(eb);
            }}
          >
            {ea} vs {eb}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="in-note">상황 한 줄 (안 적어도 돼요)</label>
        <input
          id="in-note"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예) 어제도 면 먹었어요"
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Link to="/history">결정 기록 전체 보기</Link>
      <div className="grow" />
      <button type="button" className="btn" disabled={!ready} onClick={submit}>
        딱 정해줘
      </button>
      <p className="small">
        AI가 골라요. 이름·연락처 같은 개인정보는 적지 마세요. <Link to="/about">안내 보기</Link>
      </p>
      {recentError && (
        <p className="small" role="status">최근 결정을 불러오지 못했어요. <button type="button" className="btn text" onClick={() => void loadRecent()}>다시 불러오기</button></p>
      )}
      {recent.length > 0 && (
        <section className="recent" aria-label="최근 결정">
          <h3>최근 결정</h3>
          {recent.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`} className="recent-row">
              <span>
                {p.a} vs {p.b}
              </span>
              <b className={p.pick}>{p.pick === 'a' ? p.a : p.b}</b>
            </Link>
          ))}
        </section>
      )}
    </Screen>
  );
}

