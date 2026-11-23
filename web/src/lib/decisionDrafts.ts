import type { Side } from './api';
import { DECISION_NOTE_MAX, isCriterionId, type CriterionId } from './decisionCriteria';
import { REFLECTION_NOTE_MAX, REFLECTION_RATINGS, type ReflectionRating } from './decisionReflections';

/** Private text stays on this device. Reading a draft never restores it into a form. */
export const DECISION_DRAFT_STORAGE_KEY = 'genie:decision-drafts:v1';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
export const REFLECTION_DRAFT_LIMIT = 25;
export const DRAFT_OPTION_MAX = 20;

export type HomeDraftInput = {
  a: string;
  b: string;
  note: string;
  criterion: CriterionId;
  quickMode: boolean;
  sourceId?: string;
};
export type ReflectionDraftInput = {
  pollId: string;
  choice: Side;
  rating: ReflectionRating | null;
  note: string;
};
type DraftMetadata = { revision: string; updatedAt: number };
export type HomeDraft = HomeDraftInput & DraftMetadata;
export type ReflectionDraft = ReflectionDraftInput & DraftMetadata;
export type DraftError = 'unavailable' | 'corrupt' | 'quota' | 'invalid' | 'conflict' | 'disabled';
export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: DraftError };
type DraftDocument = { version: 1; enabled: boolean; home: HomeDraft | null; reflections: ReflectionDraft[] };
type RawSnapshot = { storage: Storage; raw: string | null };
type Snapshot = RawSnapshot & { document: DraftDocument };

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const singleLine = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\r\n]/.test(value);
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;
const blank = (enabled = true): DraftDocument => ({ version: 1, enabled, home: null, reflections: [] });

function storageError(error: unknown): DraftError {
  const name = isObject(error) ? error.name : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'quota' : 'unavailable';
}

function isHomeInput(input: unknown): input is HomeDraftInput {
  return isObject(input) && singleLine(input.a, DRAFT_OPTION_MAX) && singleLine(input.b, DRAFT_OPTION_MAX) &&
    singleLine(input.note, DECISION_NOTE_MAX) && isCriterionId(input.criterion) && typeof input.quickMode === 'boolean' &&
    (input.sourceId === undefined || validId(input.sourceId));
}

function isReflectionInput(input: unknown): input is ReflectionDraftInput {
  return isObject(input) && validId(input.pollId) && (input.choice === 'a' || input.choice === 'b') &&
    (input.rating === null || REFLECTION_RATINGS.some(rating => rating.value === input.rating)) &&
    singleLine(input.note, REFLECTION_NOTE_MAX);
}

function hasMetadata(input: unknown, now: number): input is DraftMetadata {
  return isObject(input) && validId(input.revision) && typeof input.updatedAt === 'number' &&
    validTime(input.updatedAt) && input.updatedAt <= now + 300_000;
}

function hasOnlyKeys(input: object, expected: readonly string[]): boolean {
  return Object.keys(input).every(key => expected.includes(key));
}

function decode(raw: string | null, now: number): DraftResult<DraftDocument> {
  if (raw === null) return { ok: true, value: blank() };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { ok: false, error: 'corrupt' }; }
  if (!isObject(data) || data.version !== 1 || typeof data.enabled !== 'boolean' ||
    !hasOnlyKeys(data, ['version', 'enabled', 'home', 'reflections']) ||
    !Array.isArray(data.reflections) || data.reflections.length > REFLECTION_DRAFT_LIMIT) return { ok: false, error: 'corrupt' };
  if (data.home !== null && (!isHomeInput(data.home) || !hasMetadata(data.home, now) ||
    !hasOnlyKeys(data.home, ['a', 'b', 'note', 'criterion', 'quickMode', 'sourceId', 'revision', 'updatedAt']))) {
    return { ok: false, error: 'corrupt' };
  }
  const seen = new Set<string>();
  for (const entry of data.reflections) {
    if (!isReflectionInput(entry) || !hasMetadata(entry, now) ||
      !hasOnlyKeys(entry, ['pollId', 'choice', 'rating', 'note', 'revision', 'updatedAt'])) return { ok: false, error: 'corrupt' };
    const key = `${entry.pollId}:${entry.choice}`;
    if (seen.has(key)) return { ok: false, error: 'corrupt' };
    seen.add(key);
  }
  // A valid opt-out has no retained private drafts.
  if (!data.enabled && (data.home !== null || data.reflections.length > 0)) return { ok: false, error: 'corrupt' };
  return { ok: true, value: data as DraftDocument };
}

function readRaw(): DraftResult<RawSnapshot> {
  try {
    const storage = window.localStorage;
    return { ok: true, value: { storage, raw: storage.getItem(DECISION_DRAFT_STORAGE_KEY) } };
  } catch (error) { return { ok: false, error: storageError(error) }; }
}

function encoded(document: DraftDocument): string | null {
  return document.enabled && document.home === null && document.reflections.length === 0 ? null : JSON.stringify(document);
}

/** Best-effort stale-tab protection; localStorage does not offer an atomic cross-tab transaction. */
function commit(snapshot: RawSnapshot, document: DraftDocument): DraftResult<void> {
  const next = encoded(document);
  try {
    if (snapshot.storage.getItem(DECISION_DRAFT_STORAGE_KEY) !== snapshot.raw) return { ok: false, error: 'conflict' };
    if (next !== snapshot.raw) {
      if (next === null) snapshot.storage.removeItem(DECISION_DRAFT_STORAGE_KEY);
      else snapshot.storage.setItem(DECISION_DRAFT_STORAGE_KEY, next);
    }
    if (snapshot.storage.getItem(DECISION_DRAFT_STORAGE_KEY) !== next) return { ok: false, error: 'unavailable' };
    return { ok: true, value: undefined };
  } catch (error) { return { ok: false, error: storageError(error) }; }
}

function readSnapshot(now: number): DraftResult<Snapshot> {
  if (!validTime(now)) return { ok: false, error: 'invalid' };
  const source = readRaw();
  if (!source.ok) return source;
  const parsed = decode(source.value.raw, now);
  if (!parsed.ok) return parsed;
  const document = parsed.value;
  const home = document.home && now - document.home.updatedAt < DRAFT_TTL_MS ? document.home : null;
  const reflections = document.reflections.filter(entry => now - entry.updatedAt < DRAFT_TTL_MS);
  if (home !== document.home || reflections.length !== document.reflections.length) {
    const cleaned = { ...document, home, reflections };
    const result = commit(source.value, cleaned);
    if (!result.ok) return result;
    return { ok: true, value: { ...source.value, raw: encoded(cleaned), document: cleaned } };
  }
  return { ok: true, value: { ...source.value, document } };
}

let sequence = 0;
function newRevision(): string {
  // Revisions detect edits, not identity or authorization; this fallback is for older WebViews.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${(++sequence).toString(36)}`;
}

export function getDraftAutosaveEnabled(now = Date.now()): DraftResult<boolean> {
  const snapshot = readSnapshot(now);
  return snapshot.ok ? { ok: true, value: snapshot.value.document.enabled } : snapshot;
}

/** Disabling is an explicit privacy action: it atomically clears all drafts in this bucket. */
export function setDraftAutosaveEnabled(enabled: boolean, now = Date.now()): DraftResult<void> {
  if (typeof enabled !== 'boolean' || !validTime(now)) return { ok: false, error: 'invalid' };
  if (!enabled) {
    const raw = readRaw();
    return raw.ok ? commit(raw.value, blank(false)) : raw;
  }
  const snapshot = readSnapshot(now);
  return snapshot.ok ? commit(snapshot.value, { ...snapshot.value.document, enabled: true }) : snapshot;
}

export function readHomeDraft(now = Date.now()): DraftResult<HomeDraft | null> {
  const snapshot = readSnapshot(now);
  return snapshot.ok ? { ok: true, value: snapshot.value.document.home } : snapshot;
}

export function saveHomeDraft(input: HomeDraftInput, expectedRevision: string | null, now = Date.now()): DraftResult<HomeDraft> {
  if (!isHomeInput(input) || !validTime(now)) return { ok: false, error: 'invalid' };
  const snapshot = readSnapshot(now);
  if (!snapshot.ok) return snapshot;
  if (!snapshot.value.document.enabled) return { ok: false, error: 'disabled' };
  if ((snapshot.value.document.home?.revision ?? null) !== expectedRevision) return { ok: false, error: 'conflict' };
  const saved: HomeDraft = { a: input.a, b: input.b, note: input.note, criterion: input.criterion, quickMode: input.quickMode,
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}), revision: newRevision(), updatedAt: now };
  const result = commit(snapshot.value, { ...snapshot.value.document, home: saved });
  return result.ok ? { ok: true, value: saved } : result;
}

export function deleteHomeDraft(expectedRevision: string | null, now = Date.now()): DraftResult<void> {
  const snapshot = readSnapshot(now);
  if (!snapshot.ok) return snapshot;
  const current = snapshot.value.document.home;
  if (!current) return { ok: true, value: undefined };
  if (current.revision !== expectedRevision) return { ok: false, error: 'conflict' };
  return commit(snapshot.value, { ...snapshot.value.document, home: null });
}

export function readReflectionDraft(pollId: string, choice: Side, now = Date.now()): DraftResult<ReflectionDraft | null> {
  if (!validId(pollId) || (choice !== 'a' && choice !== 'b')) return { ok: false, error: 'invalid' };
  const snapshot = readSnapshot(now);
  return snapshot.ok ? { ok: true, value: snapshot.value.document.reflections.find(entry => entry.pollId === pollId && entry.choice === choice) ?? null } : snapshot;
}

export function saveReflectionDraft(input: ReflectionDraftInput, expectedRevision: string | null, now = Date.now()): DraftResult<ReflectionDraft> {
  if (!isReflectionInput(input) || !validTime(now)) return { ok: false, error: 'invalid' };
  const snapshot = readSnapshot(now);
  if (!snapshot.ok) return snapshot;
  if (!snapshot.value.document.enabled) return { ok: false, error: 'disabled' };
  const current = snapshot.value.document.reflections.find(entry => entry.pollId === input.pollId && entry.choice === input.choice);
  if ((current?.revision ?? null) !== expectedRevision) return { ok: false, error: 'conflict' };
  const saved: ReflectionDraft = { pollId: input.pollId, choice: input.choice, rating: input.rating,
    note: input.note, revision: newRevision(), updatedAt: now };
  const reflections = snapshot.value.document.reflections.filter(entry => entry.pollId !== input.pollId || entry.choice !== input.choice);
  reflections.push(saved);
  reflections.sort((a, b) => a.updatedAt - b.updatedAt);
  const result = commit(snapshot.value, { ...snapshot.value.document, reflections: reflections.slice(-REFLECTION_DRAFT_LIMIT) });
  return result.ok ? { ok: true, value: saved } : result;
}

export function deleteReflectionDraft(pollId: string, choice: Side, expectedRevision: string | null, now = Date.now()): DraftResult<void> {
  if (!validId(pollId) || (choice !== 'a' && choice !== 'b')) return { ok: false, error: 'invalid' };
  const snapshot = readSnapshot(now);
  if (!snapshot.ok) return snapshot;
  const current = snapshot.value.document.reflections.find(entry => entry.pollId === pollId && entry.choice === choice);
  if (!current) return { ok: true, value: undefined };
  if (current.revision !== expectedRevision) return { ok: false, error: 'conflict' };
  return commit(snapshot.value, { ...snapshot.value.document, reflections: snapshot.value.document.reflections.filter(entry => entry !== current) });
}

/** Used only after the caller has confirmed deletion of this server decision. */
export function deleteDecisionDraftsForPoll(pollId: string, now = Date.now()): DraftResult<void> {
  if (!validId(pollId)) return { ok: false, error: 'invalid' };
  const snapshot = readSnapshot(now);
  if (!snapshot.ok) return snapshot;
  const document = snapshot.value.document;
  return commit(snapshot.value, { ...document,
    home: document.home?.sourceId === pollId ? null : document.home,
    reflections: document.reflections.filter(entry => entry.pollId !== pollId),
  });
}

/** Clear reflection drafts without touching a Home draft, the opt-out, or saved reflections. */
export function clearReflectionDrafts(now = Date.now()): DraftResult<void> {
  const snapshot = readSnapshot(now);
  return snapshot.ok ? commit(snapshot.value, { ...snapshot.value.document, reflections: [] }) : snapshot;
}

/** Explicit clear-all preserves opt-out. A malformed bucket is reset with autosave off. */
export function clearDecisionDrafts(now = Date.now()): DraftResult<void> {
  if (!validTime(now)) return { ok: false, error: 'invalid' };
  const raw = readRaw();
  if (!raw.ok) return raw;
  const parsed = decode(raw.value.raw, now);
  return commit(raw.value, blank(parsed.ok ? parsed.value.enabled : false));
}

export function draftErrorMessage(error: DraftError): string {
  switch (error) {
    case 'conflict': return '다른 화면에서 임시저장이 바뀌었어요. 최신 임시저장을 확인한 뒤 다시 시도해 주세요.';
    case 'corrupt': return '임시저장 내용을 읽을 수 없어요. 이용 안내에서 임시저장을 지운 뒤 다시 시도해 주세요.';
    case 'quota': return '기기의 저장 공간이 부족해 임시저장을 확인하지 못했어요. 입력 내용은 현재 화면에 그대로 있어요.';
    case 'disabled': return '이 기기의 자동 임시저장이 꺼져 있어요.';
    case 'invalid': return '임시저장할 내용의 글자 수와 입력 형식을 확인해 주세요.';
    default: return '이 기기에 임시저장했는지 확인하지 못했어요. 입력 내용은 현재 화면에 그대로 있어요.';
  }
}
