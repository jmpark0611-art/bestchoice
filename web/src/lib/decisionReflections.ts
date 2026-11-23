import type { Side } from './api';

/** These records stay in this browser/WebView; this module never calls a server. */
export const REFLECTION_STORAGE_KEY = 'genie:decision-reflections:v1';
export const REFLECTION_NOTE_MAX = 80;
export const REFLECTION_LIMIT = 100;
export const REFLECTION_RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;

export const REFLECTION_RATINGS = [
  { value: 'satisfied', label: '만족' },
  { value: 'neutral', label: '보통' },
  { value: 'regret', label: '아쉬움' },
] as const;
export type ReflectionRating = (typeof REFLECTION_RATINGS)[number]['value'];
export type DecisionReflectionRecord = {
  pollId: string;
  choice: Side;
  rating: ReflectionRating;
  note: string;
  updatedAt: number;
};
export type ReflectionError = 'unavailable' | 'corrupt' | 'quota' | 'invalid';
export type ReflectionResult<T> = { ok: true; value: T } | { ok: false; error: ReflectionError };
type ReflectionInput = Omit<DecisionReflectionRecord, 'updatedAt'>;
type StoredReflections = { version: 1; entries: DecisionReflectionRecord[] };

function storageError(error: unknown): ReflectionError {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'quota' : 'unavailable';
}

function validInput(value: unknown): value is ReflectionInput {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ReflectionInput>;
  return typeof entry.pollId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(entry.pollId) &&
    (entry.choice === 'a' || entry.choice === 'b') &&
    REFLECTION_RATINGS.some(rating => rating.value === entry.rating) &&
    typeof entry.note === 'string' && entry.note.length <= REFLECTION_NOTE_MAX && !/[\r\n]/.test(entry.note);
}

function writeEntries(storage: Storage, entries: DecisionReflectionRecord[]): ReflectionResult<void> {
  try {
    const expected = entries.length ? JSON.stringify({ version: 1, entries } satisfies StoredReflections) : null;
    if (expected === null) storage.removeItem(REFLECTION_STORAGE_KEY);
    else storage.setItem(REFLECTION_STORAGE_KEY, expected);
    if (storage.getItem(REFLECTION_STORAGE_KEY) !== expected) return { ok: false, error: 'unavailable' };
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: storageError(error) };
  }
}

function readEntries(now: number): ReflectionResult<{ storage: Storage; entries: DecisionReflectionRecord[] }> {
  let storage: Storage;
  let raw: string | null;
  try {
    storage = window.localStorage;
    raw = storage.getItem(REFLECTION_STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: storageError(error) };
  }
  if (raw === null) return { ok: true, value: { storage, entries: [] } };

  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { ok: false, error: 'corrupt' }; }
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
    !('entries' in data) || !Array.isArray(data.entries) || data.entries.length > REFLECTION_LIMIT) {
    return { ok: false, error: 'corrupt' };
  }

  const seen = new Set<string>();
  const entries: DecisionReflectionRecord[] = [];
  for (const rawEntry of data.entries) {
    if (!validInput(rawEntry) || !('updatedAt' in rawEntry) || typeof rawEntry.updatedAt !== 'number' ||
      !Number.isSafeInteger(rawEntry.updatedAt) || rawEntry.updatedAt < 0 || rawEntry.updatedAt > now + 300_000) {
      return { ok: false, error: 'corrupt' };
    }
    const key = `${rawEntry.pollId}:${rawEntry.choice}`;
    if (seen.has(key)) return { ok: false, error: 'corrupt' };
    seen.add(key);
    if (now - rawEntry.updatedAt < REFLECTION_RETENTION_MS) {
      entries.push({ pollId: rawEntry.pollId, choice: rawEntry.choice, rating: rawEntry.rating,
        note: rawEntry.note, updatedAt: rawEntry.updatedAt });
    }
  }
  // Expiration is enforced when the app reads local records, not by a background service.
  if (entries.length !== data.entries.length) {
    const cleaned = writeEntries(storage, entries);
    if (!cleaned.ok) return cleaned;
  }
  return { ok: true, value: { storage, entries } };
}

export function readDecisionReflections(now = Date.now()): ReflectionResult<DecisionReflectionRecord[]> {
  const result = readEntries(now);
  return result.ok ? { ok: true, value: result.value.entries } : result;
}

export function readDecisionReflection(pollId: string, choice: Side, now = Date.now()): ReflectionResult<DecisionReflectionRecord | null> {
  const result = readEntries(now);
  return result.ok ? { ok: true, value: result.value.entries.find(entry => entry.pollId === pollId && entry.choice === choice) ?? null } : result;
}

export function saveDecisionReflection(input: ReflectionInput, now = Date.now()): ReflectionResult<DecisionReflectionRecord> {
  if (!validInput(input) || !Number.isSafeInteger(now) || now < 0) return { ok: false, error: 'invalid' };
  const current = readEntries(now);
  if (!current.ok) return current;
  const saved: DecisionReflectionRecord = {
    pollId: input.pollId, choice: input.choice, rating: input.rating, note: input.note.trim(), updatedAt: now,
  };
  const entries = current.value.entries.filter(entry => entry.pollId !== input.pollId || entry.choice !== input.choice);
  entries.push(saved);
  // Keep the most recently saved entries, with the new record retained on timestamp ties.
  entries.sort((a, b) => a.updatedAt - b.updatedAt);
  const written = writeEntries(current.value.storage, entries.slice(-REFLECTION_LIMIT));
  return written.ok ? { ok: true, value: saved } : written;
}

/** Omit choice after deleting a server decision to remove reflections for both choices. */
export function deleteDecisionReflection(pollId: string, choice?: Side, now = Date.now()): ReflectionResult<void> {
  const current = readEntries(now);
  if (!current.ok) return current;
  return writeEntries(current.value.storage, current.value.entries.filter(entry =>
    entry.pollId !== pollId || (choice !== undefined && entry.choice !== choice)));
}

/** Caller presents confirmation; this explicit reset can recover malformed local data. */
export function clearDecisionReflections(): ReflectionResult<void> {
  try {
    return writeEntries(window.localStorage, []);
  } catch (error) {
    return { ok: false, error: storageError(error) };
  }
}

export function reflectionErrorMessage(error: ReflectionError): string {
  switch (error) {
    case 'corrupt': return '기기 회고 데이터를 읽을 수 없어요. 이용 안내에서 기기 회고를 지운 뒤 다시 시도해 주세요.';
    case 'quota': return '이 기기의 저장 공간이 부족해요. 저장 공간을 비운 뒤 다시 시도해 주세요.';
    case 'invalid': return '만족도와 80자 이내의 한 줄 메모를 확인해 주세요.';
    default: return '이 기기의 저장 공간에 접근할 수 없어요. 브라우저 설정을 확인한 뒤 다시 시도해 주세요.';
  }
}

export function reflectionRatingLabel(rating: ReflectionRating): string {
  return REFLECTION_RATINGS.find(item => item.value === rating)?.label ?? '';
}
