import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Brand, CrisisPanel, Screen, Thinking } from '../components/ui';
import { decide, listMyPolls, type PollSummary } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';
import { composeNote, DECISION_CRITERIA, DECISION_NOTE_MAX, type CriterionId } from '../lib/decisionCriteria';
import { getDefaultCriterion, resetDefaultCriterion, saveDefaultCriterion } from '../lib/decisionPreferences';
import {
  deleteHomeDraft, draftErrorMessage, getDraftAutosaveEnabled, readHomeDraft, saveHomeDraft,
  type HomeDraft, type HomeDraftInput,
} from '../lib/decisionDrafts';
import { readReconsiderState, type ReconsiderInput } from '../lib/decisionReconsider';

export const OPTION_MAX = 20;
export const NOTE_MAX = DECISION_NOTE_MAX;
const EXAMPLES: [string, string][] = [
  ['짜장면', '짬뽕'],
  ['이직한다', '남는다'],
  ['산다', '참는다'],
  ['연락한다', '기다린다'],
];

export function HomeScreen() {
  const location = useLocation();
  return <HomeForm key={location.key} reconsideration={readReconsiderState(location.state)} />;
}

function HomeForm({ reconsideration }: { reconsideration: ReconsiderInput | null }) {
  const navigate = useNavigate();
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [initialPreference] = useState(() => getDefaultCriterion());
  const [initialDraft] = useState(() => readHomeDraft());
  const [initialAutosave] = useState(() => getDraftAutosaveEnabled());
  const [form, setForm] = useState<HomeDraftInput>(() => reconsideration ?? {
    a: '', b: '', note: '', criterion: initialPreference.criterion, quickMode: false,
  });
  const formRef = useRef(form);
  const { a, b, note, criterion, quickMode, sourceId } = form;
  const [pendingDraft, setPendingDraft] = useState<HomeDraft | null>(() => initialDraft.ok ? initialDraft.value : null);
  const [reviewingConflict, setReviewingConflict] = useState(false);
  const draftRevision = useRef<string | null>(initialDraft.ok ? initialDraft.value?.revision ?? null : null);
  const autosaveReady = useRef(initialDraft.ok && initialAutosave.ok && initialAutosave.value);
  const unsavedForm = useRef(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(() => !initialDraft.ok ? draftErrorMessage(initialDraft.error)
    : !initialAutosave.ok ? draftErrorMessage(initialAutosave.error) : null);

  // Persist edits synchronously so Back or process loss does not depend on a timer.
  // A stale revision pauses autosave rather than replacing another tab's draft.
  const persistForm = (next: HomeDraftInput) => {
    if (!autosaveReady.current) return;
    if (!next.a && !next.b && !next.note) {
      const removed = deleteHomeDraft(draftRevision.current);
      if (removed.ok) { draftRevision.current = null; unsavedForm.current = false; setDraftNotice(null); }
      else { autosaveReady.current = false; setDraftError(draftErrorMessage(removed.error)); }
      return;
    }
    const saved = saveHomeDraft(next, draftRevision.current);
    if (saved.ok) {
      draftRevision.current = saved.value.revision;
      unsavedForm.current = false;
      setDraftNotice('입력한 내용을 이 기기의 초안으로 보관했어요.');
      setDraftError(null);
    } else {
      autosaveReady.current = false;
      setDraftNotice(null);
      setDraftError(`${draftErrorMessage(saved.error)} 현재 입력은 그대로 두었어요. 초안 자동 저장을 멈췄으니 화면을 떠나기 전에 내용을 확인해 주세요.`);
    }
  };
  const updateForm = (patch: Partial<HomeDraftInput>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    unsavedForm.current = !!(next.a || next.b || next.note);
    if (!pendingDraft) persistForm(next);
  };

  const resolveDraft = (restore: boolean) => {
    if (!pendingDraft) return;
    // Re-read before the user's explicit choice, without silently adopting a newer revision.
    const latest = readHomeDraft();
    if (!latest.ok) { setDraftError(draftErrorMessage(latest.error)); return; }
    if (!latest.value || latest.value.revision !== pendingDraft.revision) {
      setPendingDraft(latest.value);
      draftRevision.current = latest.value?.revision ?? null;
      setDraftError('초안이 다른 화면에서 바뀌었거나 보관 기간이 지났어요. 현재 초안을 다시 확인해 주세요.');
      return;
    }
    if (restore) {
      const { revision: _revision, updatedAt: _updatedAt, ...input } = latest.value;
      formRef.current = input;
      setForm(input);
      unsavedForm.current = false;
      setDraftNotice('초안을 불러왔어요. 내용을 확인한 뒤 직접 결정해 주세요.');
    } else {
      const removed = deleteHomeDraft(pendingDraft.revision);
      if (!removed.ok) { setDraftError(draftErrorMessage(removed.error)); return; }
      draftRevision.current = null;
      setDraftNotice('이전 초안을 버렸어요.');
    }
    setDraftError(null);
    setPendingDraft(null);
    setReviewingConflict(false);
    const preference = getDraftAutosaveEnabled();
    autosaveReady.current = preference.ok && preference.value;
    if (!restore && reviewingConflict) persistForm(formRef.current);
  };

  const reviewStoredDraft = () => {
    const latest = readHomeDraft();
    if (!latest.ok) { setDraftError(draftErrorMessage(latest.error)); return; }
    draftRevision.current = latest.value?.revision ?? null;
    if (latest.value) { setReviewingConflict(true); setPendingDraft(latest.value); }
    else {
      const preference = getDraftAutosaveEnabled();
      autosaveReady.current = preference.ok && preference.value;
      setDraftError(preference.ok ? null : draftErrorMessage(preference.error));
      setDraftNotice(preference.ok && preference.value
        ? '현재 보관된 초안은 없어요. 다음 입력부터 자동 저장을 다시 시작해요.'
        : '초안 자동 저장이 꺼져 있어요. 현재 입력은 화면에만 남아 있어요.');
      if (autosaveReady.current) persistForm(formRef.current);
    }
  };

  useEffect(() => {
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!submitting.current && !unsavedForm.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, []);
  const [savedCriterion, setSavedCriterion] = useState<CriterionId>(initialPreference.criterion);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(() =>
    initialPreference.status === 'invalid' || initialPreference.status === 'unavailable'
      ? '기본 기준을 불러오지 못했어요. 이번에 쓸 기준을 직접 골라 주세요.' : null);
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
  const composed = composeNote({ note, criterion, quickMode });
  const savedLabel = DECISION_CRITERIA.find((item) => item.id === savedCriterion)?.label;

  const rememberCriterion = () => {
    const result = saveDefaultCriterion(criterion);
    if (!result.ok) {
      setPreferenceNotice('이 기기에 기준을 저장하지 못했어요. 고른 기준은 이번 결정에만 반영돼요.');
      return;
    }
    setSavedCriterion(criterion);
    setPreferenceNotice('기본 기준을 저장했어요. 다음 결정에도 미리 선택돼요.');
  };

  const forgetCriterion = () => {
    const result = resetDefaultCriterion();
    if (!result.ok) {
      setPreferenceNotice('기본 기준을 지우지 못했어요. 기기의 저장 공간 설정을 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    setSavedCriterion('none');
    updateForm({ criterion: 'none' });
    setPreferenceNotice('기본 기준을 지웠어요. 필요할 때 다시 고를 수 있어요.');
  };

  const submit = async () => {
    if (submitting.current || !ready || !composed.isValid) return;
    if (a.trim() === b.trim()) return setError(errorMessage('SAME_OPTIONS'));
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await decide({ a: a.trim(), b: b.trim(), note: composed.note });
      if (!active.current) return;
      if (result.kind === 'crisis') setCrisis(true);
      else {
        // The decision already exists: a local cleanup failure must never resubmit it.
        const removed = deleteHomeDraft(draftRevision.current);
        navigate(`/p/${result.id}`, { state: removed.ok ? null : { draftCleanupFailed: true } });
      }
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

  if (pendingDraft) {
    return <Screen>
      <Brand />
      <section className="draft-panel" aria-label="이전 결정 초안">
        <h1>쓰던 결정이 있어요</h1>
        <p>이 기기에 남긴 초안을 이어 쓸까요? 선택지와 상황은 이어쓰기를 누른 뒤 보여요.</p>
        <p className="small">초안만 불러오며 AI에게 자동으로 요청하지 않아요. 이전 요청이 진행 중이었다면 결정 기록을 먼저 확인해 주세요.</p>
        {reviewingConflict && <p className="small">이어쓰기를 누르면 현재 화면의 입력을 기기에 보관된 초안으로 바꿔요. 버리기를 누르면 현재 입력을 유지하고 초안 저장을 다시 시도해요.</p>}
        <button type="button" className="btn" onClick={() => resolveDraft(true)}>초안 이어쓰기</button>
        <button type="button" className="btn ghost" onClick={() => resolveDraft(false)}>{reviewingConflict ? '기기 초안 버리고 현재 입력 유지' : '초안 버리고 새로 쓰기'}</button>
        {draftError && <p className="error" role="alert">{draftError}</p>}
      </section>
      {reconsideration && <p className="small">이전 초안을 버리면 선택한 결정의 조건을 불러와 다시 비교할 수 있어요.</p>}
      <Link to="/history">결정 기록 전체 보기</Link>
      <Link to="/about">초안 저장 설정</Link>
    </Screen>;
  }

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
      {sourceId && <section className="reconsider-panel" aria-label="조건을 바꿔 다시 비교">
        <h2>조건을 고쳐 다시 비교해요</h2>
        <p className="small">기존 결과와 투표는 그대로 남아요. 선택지·기준·상황을 수정한 뒤 새 결정을 요청해 주세요.</p>
        <Link to={`/p/${sourceId}`}>기존 결정 보기</Link>
      </section>}
      <div className="quick-mode">
        <button type="button" className="chip mode-toggle" aria-pressed={quickMode}
          onClick={() => { updateForm({ quickMode: !quickMode }); setError(null); }}>
          빠른 결정
        </button>
        <p className="small">{quickMode
          ? '상황 설명을 생략해요. 아래에서 고른 기준은 함께 반영해요.'
          : '상황을 적기 번거로울 때 빠른 결정을 켜 보세요.'}</p>
      </div>
      <div className="versus">
        <div className="side a">
          <label htmlFor="in-a">A</label>
          <input id="in-a" maxLength={OPTION_MAX} value={a} onChange={(e) => updateForm({ a: e.target.value })} placeholder="짜장면" autoComplete="off" />
        </div>
        <div className="vs">vs</div>
        <div className="side b">
          <label htmlFor="in-b">B</label>
          <input id="in-b" maxLength={OPTION_MAX} value={b} onChange={(e) => updateForm({ b: e.target.value })} placeholder="짬뽕" autoComplete="off" />
        </div>
      </div>
      <div className="chips" aria-label="예시">
        {EXAMPLES.map(([ea, eb]) => (
          <button
            type="button"
            key={ea}
            className="chip"
            onClick={() => {
              updateForm({ a: ea, b: eb });
            }}
          >
            {ea} vs {eb}
          </button>
        ))}
      </div>
      <fieldset className="criteria-panel">
        <legend>이번에 중요한 기준 <span className="small">(선택)</span></legend>
        <div className="criteria-options">
          {DECISION_CRITERIA.map((item) => (
            <label key={item.id} className="criterion-option">
              <input type="radio" name="decision-criterion" value={item.id}
                checked={criterion === item.id}
                onChange={() => { updateForm({ criterion: item.id }); setError(null); setPreferenceNotice(null); }} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
        <p className="small">고른 기준은 AI에게 전달되고, 공유할 때 친구에게도 보여요.</p>
        {criterion !== 'none' && criterion !== savedCriterion && (
          <button type="button" className="btn text" onClick={rememberCriterion}>이 기준을 기본으로 저장</button>
        )}
        {savedCriterion !== 'none' && (
          <div className="saved-criterion">
            <p className="small">이 기기의 기본 기준: {savedLabel}</p>
            <button type="button" className="btn text" onClick={forgetCriterion}>기본 기준 지우기</button>
          </div>
        )}
        {preferenceNotice && <p className="small" role="status">{preferenceNotice}</p>}
      </fieldset>
      {!quickMode && <div className="field">
        <label htmlFor="in-note">상황 한 줄 (안 적어도 돼요)</label>
        <input
          id="in-note"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => updateForm({ note: e.target.value })}
          placeholder="예) 어제도 면 먹었어요"
          autoComplete="off"
          aria-describedby="note-length"
          aria-invalid={!composed.isValid}
        />
      </div>}
      {quickMode && note.trim() && <p className="small">적어 둔 상황은 이번 요청에 넣지 않아요. 빠른 결정을 끄면 다시 보여요.</p>}
      <p id="note-length" className={composed.isValid ? 'small' : 'error'} role={composed.isValid ? undefined : 'alert'}>
        {composed.isValid
          ? `기준과 상황을 합쳐 ${composed.length}/${NOTE_MAX}자`
          : `기준과 상황이 ${composed.overBy}자 넘어요. 상황을 줄이거나 기준을 해제해 주세요.`}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small">입력 중인 결정과 회고는 기본으로 이 기기에 초안 저장해요. 마지막 수정 후 24시간 동안 이어 쓸 수 있어요. <Link id="home-draft-settings-link" to="/about">초안 저장 설정</Link></p>
      {initialAutosave.ok && !initialAutosave.value && <p className="small">초안 자동 저장이 꺼져 있어요.</p>}
      {draftNotice && <p className="small" aria-live="polite">{draftNotice}</p>}
      {draftError && <div>
        <p className="error" role="alert">{draftError} <Link to="/about">초안 관리</Link></p>
        <button type="button" className="btn text" onClick={reviewStoredDraft}>기기 초안 다시 확인</button>
      </div>}
      <Link to="/history">결정 기록 전체 보기</Link>
      <div className="grow" />
      <button type="button" className="btn" disabled={!ready || !composed.isValid} onClick={submit}>
        {quickMode ? '빠르게 결정하기' : '딱 정해줘'}
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

