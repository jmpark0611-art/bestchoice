import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CriterionId } from './decisionCriteria';
import {
  DECISION_PREFERENCE_KEY, getDefaultCriterion, resetDefaultCriterion, saveDefaultCriterion,
  type PreferenceStorage,
} from './decisionPreferences';

function memoryStorage(): PreferenceStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('explicit default decision criterion', () => {
  it('defaults to no criterion and only reads the dedicated preference key', () => {
    const storage = memoryStorage();
    storage.values.set('other-app-history', 'private data');
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'none', status: 'default' });
    expect(storage.values.size).toBe(1);
  });

  it('stores only a version and the explicit criterion, then reads it back', () => {
    const storage = memoryStorage();
    expect(saveDefaultCriterion('cost', storage)).toEqual({ ok: true });
    expect(storage.values.get(DECISION_PREFERENCE_KEY)).toBe('{"version":1,"criterion":"cost"}');
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'cost', status: 'saved' });
  });

  it.each([
    '{broken', 'null', '[]', '{"version":2,"criterion":"time"}',
    '{"version":1,"criterion":"auto"}', '{"criterion":"time"}',
    '{"version":1,"criterion":"time","inferred":true}',
  ])('safely rejects corrupt or unsupported data: %s', (raw) => {
    const storage = memoryStorage();
    storage.values.set(DECISION_PREFERENCE_KEY, raw);
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'none', status: 'invalid' });
    // Reading preferences must not silently mutate or clear stored data.
    expect(storage.values.get(DECISION_PREFERENCE_KEY)).toBe(raw);
  });

  it('resets only its own preference when none is explicitly saved', () => {
    const storage = memoryStorage();
    storage.values.set('other-app-history', 'untouched');
    saveDefaultCriterion('time', storage);
    expect(saveDefaultCriterion('none', storage)).toEqual({ ok: true });
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'none', status: 'default' });
    expect(storage.values.get('other-app-history')).toBe('untouched');
  });

  it('reports blocked localStorage access without throwing or claiming success', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(getDefaultCriterion()).toEqual({ criterion: 'none', status: 'unavailable' });
    expect(saveDefaultCriterion('ease')).toEqual({ ok: false, reason: 'unavailable' });
    expect(resetDefaultCriterion()).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports full storage without discarding the existing preference', () => {
    const storage = memoryStorage();
    saveDefaultCriterion('time', storage);
    storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    expect(saveDefaultCriterion('cost', storage)).toEqual({ ok: false, reason: 'unavailable' });
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'time', status: 'saved' });
  });

  it('does not report saved or cleared when storage does not apply writes', () => {
    const storage = memoryStorage();
    storage.setItem = () => {};
    expect(saveDefaultCriterion('satisfaction', storage)).toEqual({ ok: false, reason: 'unavailable' });
    storage.values.set(DECISION_PREFERENCE_KEY, '{"version":1,"criterion":"time"}');
    storage.removeItem = () => {};
    expect(resetDefaultCriterion(storage)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports an unavailable readback even if a write itself succeeds', () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error('Read blocked'); };
    expect(saveDefaultCriterion('time', storage)).toEqual({ ok: false, reason: 'unavailable' });
    expect(resetDefaultCriterion(storage)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('rejects unsupported values without changing an existing preference', () => {
    const storage = memoryStorage();
    saveDefaultCriterion('ease', storage);
    expect(saveDefaultCriterion('auto' as CriterionId, storage)).toEqual({ ok: false, reason: 'invalid' });
    expect(getDefaultCriterion(storage)).toEqual({ criterion: 'ease', status: 'saved' });
  });
});
