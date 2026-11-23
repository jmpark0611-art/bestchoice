import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Side } from '../lib/api';
import {
  REFLECTION_NOTE_MAX, REFLECTION_RATINGS, deleteDecisionReflection, readDecisionReflection,
  reflectionErrorMessage, saveDecisionReflection, type ReflectionRating,
} from '../lib/decisionReflections';
import {
  deleteReflectionDraft, draftErrorMessage, getDraftAutosaveEnabled, readReflectionDraft,
  saveReflectionDraft, type ReflectionDraft,
} from '../lib/decisionDrafts';

type Props = {
  pollId: string;
  choice: Side;
  choiceLabel: string;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};

/** Only the owner's confirmed actual choice should render this local-only editor. */
export function DecisionReflection(props: Props) {
  // Changing a route or actual choice must never carry the previous editor's draft along.
  return <ReflectionEditor key={`${props.pollId}:${props.choice}`} {...props} />;
}

function ReflectionEditor({ pollId, choice, choiceLabel, disabled = false, onDirtyChange }: Props) {
  const headingId = useId();
  const noteId = useId();
  const [initial] = useState(() => readDecisionReflection(pollId, choice));
  const [initialDraft] = useState(() => readReflectionDraft(pollId, choice));
  const [initialAutosave] = useState(() => getDraftAutosaveEnabled());
  const [saved, setSaved] = useState(initial.ok ? initial.value : null);
  const [rating, setRating] = useState<ReflectionRating | null>(initial.ok ? initial.value?.rating ?? null : null);
  const [note, setNote] = useState(initial.ok ? initial.value?.note ?? '' : '');
  const [error, setError] = useState<string | null>(() => {
    if (!initial.ok) return reflectionErrorMessage(initial.error);
    if (!initialDraft.ok) return draftErrorMessage(initialDraft.error);
    return initialAutosave.ok ? null : draftErrorMessage(initialAutosave.error);
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<ReflectionDraft | null>(initialDraft.ok ? initialDraft.value : null);
  const draftRevision = useRef(initialDraft.ok ? initialDraft.value?.revision ?? null : null);
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean | null>(initialAutosave.ok ? initialAutosave.value : null);
  const [draftIssue, setDraftIssue] = useState(!initialDraft.ok || !initialAutosave.ok);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const dirty = rating !== (saved?.rating ?? null) || note !== (saved?.note ?? '');
  const editingDisabled = disabled || pendingDraft !== null;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warnOnExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, [dirty]);

  const clearMatchingDraft = () => {
    const result = deleteReflectionDraft(pollId, choice, draftRevision.current);
    if (result.ok) {
      draftRevision.current = null;
      setPendingDraft(null); setDraftIssue(false); setDraftStatus(null);
    } else setDraftIssue(true);
    return result;
  };

  const persistDraft = (nextRating: ReflectionRating | null, nextNote: string) => {
    const hasChanges = nextRating !== (saved?.rating ?? null) || nextNote !== (saved?.note ?? '');
    if (!hasChanges) {
      const cleared = clearMatchingDraft();
      setError(cleared.ok ? null : draftErrorMessage(cleared.error));
      return;
    }
    const result = saveReflectionDraft({ pollId, choice, rating: nextRating, note: nextNote }, draftRevision.current);
    if (result.ok) {
      draftRevision.current = result.value.revision;
      setDraftIssue(false); setError(null);
      setDraftStatus('작성 중인 회고를 이 기기에 임시저장했어요.');
    } else {
      setDraftStatus(null);
      if (result.error === 'disabled') {
        setAutosaveEnabled(false); setDraftIssue(false); setError(null);
      } else { setDraftIssue(true); setError(draftErrorMessage(result.error)); }
    }
  };

  const edit = (nextRating: ReflectionRating | null, nextNote: string) => {
    if (editingDisabled) return;
    setRating(nextRating); setNote(nextNote); setNotice(null);
    if (autosaveEnabled) persistDraft(nextRating, nextNote);
  };

  const checkDraft = () => {
    if (disabled) return;
    const settings = getDraftAutosaveEnabled();
    const latest = readReflectionDraft(pollId, choice);
    setNotice(null); setDraftStatus(null);
    if (!settings.ok || !latest.ok) {
      if (!settings.ok) setAutosaveEnabled(null);
      setDraftIssue(true);
      setError(draftErrorMessage(!settings.ok ? settings.error : !latest.ok ? latest.error : 'unavailable'));
      return;
    }
    setAutosaveEnabled(settings.value); setDraftIssue(false); setError(null);
    if (latest.value) {
      // Do not adopt a new revision and overwrite another tab's draft automatically.
      setPendingDraft(latest.value);
    } else {
      setPendingDraft(null); draftRevision.current = null;
      if (settings.value && dirty) persistDraft(rating, note);
    }
  };

  const restoreDraft = () => {
    if (disabled || !pendingDraft) return;
    const latest = readReflectionDraft(pollId, choice);
    setNotice(null);
    if (!latest.ok) { setDraftIssue(true); setError(draftErrorMessage(latest.error)); return; }
    if (!latest.value) {
      setPendingDraft(null); draftRevision.current = null; setError(null); setDraftIssue(false);
      setNotice('불러올 임시저장이 없어요. 현재 입력은 그대로예요.');
      if (autosaveEnabled && dirty) persistDraft(rating, note);
      return;
    }
    if (latest.value.revision !== pendingDraft.revision) {
      setPendingDraft(latest.value); setDraftIssue(true); setError(draftErrorMessage('conflict'));
      return;
    }
    setRating(latest.value.rating); setNote(latest.value.note);
    draftRevision.current = latest.value.revision;
    setPendingDraft(null); setDraftIssue(false); setDraftStatus(null); setError(null);
    setNotice('임시저장을 불러왔어요. 회고 저장을 누르면 기록으로 남아요.');
  };

  const discardDraft = () => {
    if (disabled || !pendingDraft) return;
    const result = deleteReflectionDraft(pollId, choice, pendingDraft.revision);
    setNotice(null);
    if (!result.ok) { setDraftIssue(true); setError(draftErrorMessage(result.error)); return; }
    draftRevision.current = null;
    setPendingDraft(null); setDraftIssue(false); setDraftStatus(null); setError(null);
    setNotice(dirty ? '이전 임시저장을 버렸어요. 현재 입력은 그대로예요.' : '임시저장을 버렸어요. 저장한 회고는 그대로예요.');
    if (autosaveEnabled && dirty) persistDraft(rating, note);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (editingDisabled || rating === null) return;
    const result = saveDecisionReflection({ pollId, choice, rating, note });
    setNotice(null);
    if (!result.ok) { setError(reflectionErrorMessage(result.error)); return; }
    setSaved(result.value);
    setNote(result.value.note);
    const cleared = clearMatchingDraft();
    setError(cleared.ok ? null : `회고는 저장했지만 임시저장을 지우지 못했어요. ${draftErrorMessage(cleared.error)}`);
    setNotice('이 기기에 회고를 저장했어요.');
  };

  const remove = () => {
    if (editingDisabled) return;
    const result = deleteDecisionReflection(pollId, choice);
    setNotice(null);
    if (!result.ok) { setError(reflectionErrorMessage(result.error)); return; }
    setSaved(null); setRating(null); setNote('');
    const cleared = clearMatchingDraft();
    setError(cleared.ok ? null : `저장한 회고는 지웠지만 임시저장을 지우지 못했어요. ${draftErrorMessage(cleared.error)}`);
    setNotice('이 기기의 회고를 지웠어요.');
  };

  const cancelChanges = () => {
    if (editingDisabled) return;
    const latest = readDecisionReflection(pollId, choice);
    const cleared = clearMatchingDraft();
    setNotice(null);
    if (!cleared.ok && cleared.error === 'conflict') {
      setError(draftErrorMessage(cleared.error));
      return;
    }
    const restored = latest.ok ? latest.value : saved;
    if (latest.ok) setSaved(latest.value);
    setRating(restored?.rating ?? null);
    setNote(restored?.note ?? '');
    if (!latest.ok) setError(reflectionErrorMessage(latest.error));
    else setError(cleared.ok ? null : `화면의 수정을 취소했지만 임시저장을 지우지 못했어요. ${draftErrorMessage(cleared.error)}`);
  };

  return (
    <section className="sharebox reflection" aria-labelledby={headingId}>
      <h3 id={headingId}>선택하고 나니 어땠어요?</h3>
      <p className="small">“{choiceLabel}”을 선택한 뒤의 느낌을 남겨보세요. 안 남겨도 괜찮아요.</p>
      {pendingDraft && <section className="sharebox draft-restore" aria-label="회고 임시저장 확인">
        <h3>저장하지 않은 회고가 있어요</h3>
        <p className="small">내용을 불러올까요, 버리고 시작할까요? {dirty && '불러오면 현재 입력한 내용을 바꿔요.'}</p>
        <button type="button" className="btn ghost" disabled={disabled} onClick={restoreDraft}>임시 회고 불러오기</button>
        <button type="button" className="btn text" disabled={disabled} onClick={discardDraft}>임시 회고 버리기</button>
      </section>}
      <form className="reflection-form" onSubmit={save}>
        <div className="three" role="group" aria-label="선택 후 만족도">
          {REFLECTION_RATINGS.map(item => (
            <button type="button" key={item.value} disabled={editingDisabled} aria-pressed={rating === item.value}
              onClick={() => edit(item.value, note)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor={noteId}>나중에 떠올릴 한 줄 (선택)</label>
          <input id={noteId} value={note} maxLength={REFLECTION_NOTE_MAX} disabled={editingDisabled}
            aria-describedby={`${noteId}-count`} autoComplete="off" placeholder="예) 생각보다 시간이 많이 들었어요"
            onChange={event => edit(rating, event.target.value)} />
          <p className="small" id={`${noteId}-count`}>{note.length}/{REFLECTION_NOTE_MAX}</p>
        </div>
        <button type="submit" className="btn ghost" disabled={editingDisabled || rating === null}>회고 저장</button>
        {dirty && <button type="button" className="btn text" disabled={editingDisabled} onClick={cancelChanges}>수정 취소</button>}
        {saved && <button type="button" className="btn text" disabled={editingDisabled} onClick={remove}>회고 삭제</button>}
      </form>
      {dirty && <p className="small">아직 저장하지 않은 내용이 있어요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {draftIssue && <button type="button" className="btn text" disabled={disabled} onClick={checkDraft}>임시저장 다시 확인</button>}
      {notice && <p className="small" role="status">{notice}</p>}
      {draftStatus && <p className="small">{draftStatus}</p>}
      <p className="small">{autosaveEnabled === null
        ? '자동 임시저장 상태를 확인하지 못했어요. 현재 입력은 이 화면에 남아 있어요.'
        : autosaveEnabled
          ? '자동 임시저장이 켜져 있어요. 마지막 수정 후 24시간 안에 다시 열면 불러올지 고를 수 있어요. 이용 안내에서 끌 수 있어요.'
          : '자동 임시저장이 꺼져 있어요. 회고 저장을 눌러 기록을 남겨 주세요.'}</p>
      <p className="small">회고는 앱의 기기 저장 공간에 보관해요. 이 앱은 회고를 친구나 AI에게 보내지 않아요. 앱·브라우저 데이터를 지우면 기록을 잃을 수 있어요.</p>
      <p className="small">최근 100개를 저장해요. 마지막 저장일부터 60일 동안 표시하고, 기간이 지난 기록은 앱을 사용할 때 정리해요.</p>
    </section>
  );
}
