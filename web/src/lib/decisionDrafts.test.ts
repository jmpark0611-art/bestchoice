import {
  DECISION_DRAFT_STORAGE_KEY, DRAFT_TTL_MS, REFLECTION_DRAFT_LIMIT,
  clearDecisionDrafts, clearReflectionDrafts, deleteDecisionDraftsForPoll, deleteHomeDraft, deleteReflectionDraft, getDraftAutosaveEnabled,
  readHomeDraft, readReflectionDraft, saveHomeDraft, saveReflectionDraft, setDraftAutosaveEnabled,
  type DraftResult, type HomeDraftInput,
} from './decisionDrafts';
import { readDecisionReflection, saveDecisionReflection } from './decisionReflections';
import { getDefaultCriterion, saveDefaultCriterion } from './decisionPreferences';

const NOW = Date.UTC(2026, 10, 23, 8);
const home: HomeDraftInput = { a: '  커피', b: '', note: ' 상황을 입력 중  ', criterion: 'cost', quickMode: false, sourceId: 'poll-original' };
const reflection = { pollId: 'poll-1', choice: 'a' as const, rating: null, note: '생각을 적는 중  ' };

function value<T>(result: DraftResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Unexpected draft error: ${result.error}`);
  return result.value;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

it('defaults autosave on but stores nothing until a caller saves, retaining incomplete raw text and reconsider origin', () => {
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: true });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: null });
  expect(window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)).toBeNull();
  const saved = value(saveHomeDraft(home, null, NOW));
  expect(saved).toMatchObject({ ...home, updatedAt: NOW });
  expect(saved.revision).toEqual(expect.any(String));
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: saved });
});

it('keeps the raw note when quick mode is enabled and allows a not-yet-valid combined criterion context', () => {
  const saved = value(saveHomeDraft({ ...home, a: '', b: '', note: '가'.repeat(60), quickMode: true }, null, NOW));
  const changed = value(saveHomeDraft({ ...home, note: saved.note, quickMode: false }, saved.revision, NOW + 1));
  expect(changed.note).toBe('가'.repeat(60));
  expect(changed.criterion).toBe('cost');
  expect(changed.quickMode).toBe(false);
});

it('rejects oversized UTF-16 fields without truncating or replacing an existing home draft', () => {
  const saved = value(saveHomeDraft({ ...home, a: '😀'.repeat(10), note: '😀'.repeat(30) }, null, NOW));
  expect(saveHomeDraft({ ...home, a: '😀'.repeat(11) }, saved.revision, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(saveHomeDraft({ ...home, note: '😀'.repeat(31) }, saved.revision, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(saveHomeDraft({ ...home, b: '다'.repeat(21) }, saved.revision, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: saved });
});

it('keeps reflection drafts separate by actual choice and allows note-only edits before selecting satisfaction', () => {
  const first = value(saveReflectionDraft(reflection, null, NOW));
  const second = value(saveReflectionDraft({ ...reflection, choice: 'b', rating: 'regret', note: '다른 선택의 메모' }, null, NOW));
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: first });
  expect(readReflectionDraft('poll-1', 'b', NOW)).toEqual({ ok: true, value: second });
  value(deleteReflectionDraft('poll-1', 'a', first.revision, NOW));
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'b', NOW)).toEqual({ ok: true, value: second });
});

it('accepts the reflection note boundary and rejects excess input or multiline text without replacing it', () => {
  const saved = value(saveReflectionDraft({ ...reflection, note: '😀'.repeat(40) }, null, NOW));
  expect(saveReflectionDraft({ ...reflection, note: '😀'.repeat(41) }, saved.revision, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(saveReflectionDraft({ ...reflection, note: '첫 줄\n다음 줄' }, saved.revision, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: saved });
});

it('expires each draft after 24 hours from its last edit while preserving more recent drafts', () => {
  const saved = value(saveHomeDraft(home, null, NOW));
  value(saveReflectionDraft(reflection, null, NOW + 1));
  value(saveHomeDraft({ ...home, b: '차' }, saved.revision, NOW + 2));
  expect(readReflectionDraft('poll-1', 'a', NOW + DRAFT_TTL_MS)).toMatchObject({ ok: true, value: { pollId: 'poll-1' } });
  expect(readReflectionDraft('poll-1', 'a', NOW + DRAFT_TTL_MS + 1)).toEqual({ ok: true, value: null });
  expect(readHomeDraft(NOW + DRAFT_TTL_MS + 1)).toMatchObject({ ok: true, value: { b: '차' } });
  expect(readHomeDraft(NOW + DRAFT_TTL_MS + 2)).toEqual({ ok: true, value: null });
  expect(window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)).toBeNull();
});

it('bounds reflection drafts to the latest 25 without replacing the separate home draft', () => {
  const saved = value(saveHomeDraft(home, null, NOW));
  for (let i = 0; i <= REFLECTION_DRAFT_LIMIT; i++) value(saveReflectionDraft({ ...reflection, pollId: `poll-${i}` }, null, NOW));
  expect(readReflectionDraft('poll-0', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-25', 'a', NOW)).toMatchObject({ ok: true, value: { pollId: 'poll-25' } });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: saved });
});

it('rejects stale-tab home writes and deletion instead of overwriting a newer draft', () => {
  const first = value(saveHomeDraft(home, null, NOW));
  const newer = value(saveHomeDraft({ ...home, note: '다른 탭에서 바뀐 내용' }, first.revision, NOW + 1));
  expect(saveHomeDraft({ ...home, note: '오래된 탭의 내용' }, first.revision, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  expect(deleteHomeDraft(first.revision, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  expect(saveHomeDraft(home, null, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  expect(readHomeDraft(NOW + 2)).toEqual({ ok: true, value: newer });
});

it('rejects a stale reflection revision and merges edits to distinct reflection drafts', () => {
  const first = value(saveReflectionDraft(reflection, null, NOW));
  const second = value(saveReflectionDraft({ ...reflection, pollId: 'poll-2' }, null, NOW));
  const newer = value(saveReflectionDraft({ ...reflection, rating: 'neutral' }, first.revision, NOW + 1));
  expect(saveReflectionDraft({ ...reflection, rating: 'regret' }, first.revision, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  expect(deleteReflectionDraft('poll-1', 'a', first.revision, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  expect(readReflectionDraft('poll-1', 'a', NOW + 2)).toEqual({ ok: true, value: newer });
  expect(readReflectionDraft('poll-2', 'a', NOW + 2)).toEqual({ ok: true, value: second });
});

it('detects a changed bucket between read and write rather than overwriting another edit', () => {
  const first = value(saveHomeDraft(home, null, NOW));
  const oldRaw = window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)!;
  const newer = value(saveHomeDraft({ ...home, b: '차' }, first.revision, NOW + 1));
  const newRaw = window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)!;
  window.localStorage.setItem(DECISION_DRAFT_STORAGE_KEY, oldRaw);
  const originalGet = Storage.prototype.getItem;
  let reads = 0;
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === DECISION_DRAFT_STORAGE_KEY && ++reads === 2) this.setItem(key, newRaw);
    return originalGet.call(this, key);
  });
  expect(saveHomeDraft({ ...home, a: '바꾼 커피' }, first.revision, NOW + 2)).toEqual({ ok: false, error: 'conflict' });
  get.mockRestore();
  expect(readHomeDraft(NOW + 2)).toEqual({ ok: true, value: newer });
});

it('explicit opt-out clears drafts atomically and remains off after clear-all', () => {
  value(saveHomeDraft(home, null, NOW));
  value(saveReflectionDraft(reflection, null, NOW));
  value(setDraftAutosaveEnabled(false, NOW));
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: false });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(saveHomeDraft(home, null, NOW)).toEqual({ ok: false, error: 'disabled' });
  expect(saveReflectionDraft(reflection, null, NOW)).toEqual({ ok: false, error: 'disabled' });
  value(clearDecisionDrafts(NOW));
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: false });
  value(setDraftAutosaveEnabled(true, NOW));
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: true });
});

it('clears only drafts while preserving saved reflections, default criterion, and unrelated app storage', () => {
  value(saveHomeDraft(home, null, NOW));
  value(saveReflectionDraft(reflection, null, NOW));
  saveDecisionReflection({ pollId: 'poll-1', choice: 'a', rating: 'satisfied', note: '명시적으로 저장한 회고' }, NOW);
  saveDefaultCriterion('time');
  window.localStorage.setItem('another-app', 'untouched');
  value(clearDecisionDrafts(NOW));
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: true });
  expect(readDecisionReflection('poll-1', 'a', NOW)).toMatchObject({ ok: true, value: { note: '명시적으로 저장한 회고' } });
  expect(getDefaultCriterion()).toEqual({ criterion: 'time', status: 'saved' });
  expect(window.localStorage.getItem('another-app')).toBe('untouched');
});

it.each([
  '{broken',
  JSON.stringify({ version: 2, enabled: true, home: null, reflections: [] }),
  JSON.stringify({ version: 1, enabled: true, home: { ...home, revision: 'old', updatedAt: NOW, note: '너'.repeat(61) }, reflections: [] }),
  JSON.stringify({ version: 1, enabled: true, home: null, reflections: [{ ...reflection, revision: 'one', updatedAt: NOW }, { ...reflection, revision: 'two', updatedAt: NOW }] }),
])('preserves unreadable drafts until explicit clear and recovers with autosave off: %s', raw => {
  window.localStorage.setItem(DECISION_DRAFT_STORAGE_KEY, raw);
  expect(readHomeDraft(NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(saveHomeDraft(home, null, NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(deleteHomeDraft(null, NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)).toBe(raw);
  value(clearDecisionDrafts(NOW));
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: false });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: null });
});

it('reports a blocked storage getter on reads, saves, and explicit clear without crashing', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(readHomeDraft(NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(saveHomeDraft(home, null, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(clearDecisionDrafts(NOW)).toEqual({ ok: false, error: 'unavailable' });
});

it('preserves the last saved draft and opt-in state when a save or opt-out write runs out of space', () => {
  const saved = value(saveHomeDraft(home, null, NOW));
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(saveHomeDraft({ ...home, b: '차' }, saved.revision, NOW + 1)).toEqual({ ok: false, error: 'quota' });
  expect(setDraftAutosaveEnabled(false, NOW + 1)).toEqual({ ok: false, error: 'quota' });
  set.mockRestore();
  expect(readHomeDraft(NOW + 1)).toEqual({ ok: true, value: saved });
  expect(getDraftAutosaveEnabled(NOW + 1)).toEqual({ ok: true, value: true });
});

it('does not report save or delete success when storage operations silently do nothing', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  expect(saveHomeDraft(home, null, NOW)).toEqual({ ok: false, error: 'unavailable' });
  set.mockRestore();
  const saved = value(saveHomeDraft(home, null, NOW));
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  expect(deleteHomeDraft(saved.revision, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(clearDecisionDrafts(NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: saved });
});

it('reports an uncertain save when readback fails even though the local write may have completed', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce(null).mockReturnValueOnce(null)
    .mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(saveHomeDraft(home, null, NOW)).toEqual({ ok: false, error: 'unavailable' });
  get.mockRestore();
  expect(readHomeDraft(NOW)).toMatchObject({ ok: true, value: home });
});

it('does not expose an expired draft as restored when expiry cleanup cannot be confirmed', () => {
  value(saveHomeDraft(home, null, NOW));
  const raw = window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(readHomeDraft(NOW + DRAFT_TTL_MS)).toEqual({ ok: false, error: 'unavailable' });
  expect(window.localStorage.getItem(DECISION_DRAFT_STORAGE_KEY)).toBe(raw);
});

it('scoped server-deletion cleanup removes both reflection choices and a matching reconsider draft only', () => {
  value(saveHomeDraft({ ...home, sourceId: 'poll-1' }, null, NOW));
  value(saveReflectionDraft(reflection, null, NOW));
  value(saveReflectionDraft({ ...reflection, choice: 'b' }, null, NOW));
  const other = value(saveReflectionDraft({ ...reflection, pollId: 'poll-2' }, null, NOW));
  value(deleteDecisionDraftsForPoll('poll-1', NOW));
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-1', 'b', NOW)).toEqual({ ok: true, value: null });
  expect(readReflectionDraft('poll-2', 'a', NOW)).toEqual({ ok: true, value: other });
  const unrelatedHome = value(saveHomeDraft(home, null, NOW));
  value(deleteDecisionDraftsForPoll('poll-2', NOW));
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: unrelatedHome });
});

it('clearing reflection drafts preserves the Home draft, autosave preference, and permanent reflections', () => {
  const savedHome = value(saveHomeDraft(home, null, NOW));
  value(saveReflectionDraft(reflection, null, NOW));
  saveDecisionReflection({ pollId: 'poll-1', choice: 'a', rating: 'neutral', note: '영구 회고' }, NOW);
  value(clearReflectionDrafts(NOW));
  expect(readHomeDraft(NOW)).toEqual({ ok: true, value: savedHome });
  expect(readReflectionDraft('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: true });
  expect(readDecisionReflection('poll-1', 'a', NOW)).toMatchObject({ ok: true, value: { note: '영구 회고' } });
  value(setDraftAutosaveEnabled(false, NOW));
  value(clearReflectionDrafts(NOW));
  expect(getDraftAutosaveEnabled(NOW)).toEqual({ ok: true, value: false });
});
