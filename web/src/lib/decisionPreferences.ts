import { isCriterionId, type CriterionId } from './decisionCriteria';

export const DECISION_PREFERENCE_KEY = 'genie.decision-preference.v1';
const PREFERENCE_VERSION = 1;

/** Only a user-selected default is stored; decision text and history are never included. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PreferenceReadResult = {
  criterion: CriterionId;
  status: 'default' | 'saved' | 'invalid' | 'unavailable';
};
export type PreferenceWriteResult = { ok: true } | { ok: false; reason: 'invalid' | 'unavailable' };

function localStorageFor(storage?: PreferenceStorage): PreferenceStorage {
  if (storage) return storage;
  // Access happens inside each operation's try block: even the getter can be blocked.
  if (typeof window === 'undefined') throw new Error('Storage unavailable');
  return window.localStorage;
}

export function getDefaultCriterion(storage?: PreferenceStorage): PreferenceReadResult {
  let raw: string | null;
  try {
    raw = localStorageFor(storage).getItem(DECISION_PREFERENCE_KEY);
  } catch {
    return { criterion: 'none', status: 'unavailable' };
  }
  if (raw === null) return { criterion: 'none', status: 'default' };
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { criterion: 'none', status: 'invalid' };
    const value = saved as Record<string, unknown>;
    if (value.version !== PREFERENCE_VERSION || !isCriterionId(value.criterion) ||
      Object.keys(value).length !== 2) return { criterion: 'none', status: 'invalid' };
    return { criterion: value.criterion, status: 'saved' };
  } catch {
    return { criterion: 'none', status: 'invalid' };
  }
}

export function saveDefaultCriterion(criterion: CriterionId, storage?: PreferenceStorage): PreferenceWriteResult {
  if (!isCriterionId(criterion)) return { ok: false, reason: 'invalid' };
  if (criterion === 'none') return resetDefaultCriterion(storage);
  try {
    const target = localStorageFor(storage);
    const value = JSON.stringify({ version: PREFERENCE_VERSION, criterion });
    target.setItem(DECISION_PREFERENCE_KEY, value);
    // A failed or unavailable readback must not produce a misleading "saved" message.
    return target.getItem(DECISION_PREFERENCE_KEY) === value ? { ok: true } : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function resetDefaultCriterion(storage?: PreferenceStorage): PreferenceWriteResult {
  try {
    const target = localStorageFor(storage);
    target.removeItem(DECISION_PREFERENCE_KEY);
    return target.getItem(DECISION_PREFERENCE_KEY) === null ? { ok: true } : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
