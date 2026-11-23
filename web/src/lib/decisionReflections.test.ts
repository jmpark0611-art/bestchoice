import {
  REFLECTION_LIMIT, REFLECTION_RETENTION_MS, REFLECTION_STORAGE_KEY,
  clearDecisionReflections, deleteDecisionReflection, readDecisionReflection, readDecisionReflections,
  saveDecisionReflection,
} from './decisionReflections';

const NOW = Date.UTC(2026, 10, 23);
const input = { pollId: 'poll-1', choice: 'a' as const, rating: 'satisfied' as const, note: '다음에도 이걸 고를래요' };

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

it('keeps reflections distinct for the actual choice and updates only the selected record', () => {
  expect(readDecisionReflections(NOW)).toEqual({ ok: true, value: [] });
  expect(saveDecisionReflection(input, NOW).ok).toBe(true);
  expect(readDecisionReflection(input.pollId, 'b', NOW)).toEqual({ ok: true, value: null });
  saveDecisionReflection({ ...input, choice: 'b', rating: 'regret', note: '생각보다 불편했어요' }, NOW);
  saveDecisionReflection({ ...input, rating: 'neutral', note: '  다시 생각해보니 보통  ' }, NOW + 1);
  expect(readDecisionReflection(input.pollId, 'a', NOW + 1)).toEqual({ ok: true, value: {
    ...input, rating: 'neutral', note: '다시 생각해보니 보통', updatedAt: NOW + 1,
  } });
  expect(readDecisionReflection(input.pollId, 'b', NOW + 1)).toMatchObject({ ok: true, value: { rating: 'regret' } });
});

it('rejects an oversized or multiline note without replacing the previously saved text', () => {
  saveDecisionReflection(input, NOW);
  expect(saveDecisionReflection({ ...input, note: '😀'.repeat(41) }, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(saveDecisionReflection({ ...input, note: '첫 줄\n다음 줄' }, NOW)).toEqual({ ok: false, error: 'invalid' });
  expect(readDecisionReflection('poll-1', 'a', NOW)).toMatchObject({ ok: true, value: { note: input.note } });
  expect(saveDecisionReflection({ ...input, note: '😀'.repeat(40) }, NOW).ok).toBe(true);
});

it('deletes both choices for one deleted decision while preserving other decisions', () => {
  saveDecisionReflection(input, NOW);
  saveDecisionReflection({ ...input, choice: 'b' }, NOW);
  saveDecisionReflection({ ...input, pollId: 'poll-2' }, NOW);
  expect(deleteDecisionReflection('poll-1', undefined, NOW).ok).toBe(true);
  expect(readDecisionReflections(NOW)).toMatchObject({ ok: true, value: [{ pollId: 'poll-2' }] });
});

it('deletes one choice without discarding the other choice for the same decision', () => {
  saveDecisionReflection(input, NOW);
  saveDecisionReflection({ ...input, choice: 'b' }, NOW);
  deleteDecisionReflection('poll-1', 'a', NOW);
  expect(readDecisionReflections(NOW)).toMatchObject({ ok: true, value: [{ choice: 'b' }] });
});

it('removes expired entries on the next read and retains a recently updated reflection', () => {
  saveDecisionReflection(input, NOW);
  saveDecisionReflection({ ...input, pollId: 'poll-2' }, NOW + 1);
  expect(readDecisionReflection('poll-1', 'a', NOW + REFLECTION_RETENTION_MS)).toEqual({ ok: true, value: null });
  expect(readDecisionReflection('poll-2', 'a', NOW + REFLECTION_RETENTION_MS)).toMatchObject({ ok: true, value: { pollId: 'poll-2' } });
  expect(readDecisionReflections(NOW + REFLECTION_RETENTION_MS + 1)).toEqual({ ok: true, value: [] });
  expect(window.localStorage.getItem(REFLECTION_STORAGE_KEY)).toBeNull();
});

it('keeps only the most recent 100 reflections without dropping the newly saved entry on a timestamp tie', () => {
  for (let i = 0; i <= REFLECTION_LIMIT; i++) {
    expect(saveDecisionReflection({ ...input, pollId: `poll-${i}` }, NOW).ok).toBe(true);
  }
  const records = readDecisionReflections(NOW);
  expect(records.ok && records.value.length).toBe(REFLECTION_LIMIT);
  expect(readDecisionReflection('poll-0', 'a', NOW)).toEqual({ ok: true, value: null });
  expect(readDecisionReflection('poll-100', 'a', NOW)).toMatchObject({ ok: true, value: { pollId: 'poll-100' } });
});

it.each([
  '{broken',
  JSON.stringify({ version: 2, entries: [] }),
  JSON.stringify({ version: 1, entries: [{ ...input, rating: 'unknown', updatedAt: NOW }] }),
  JSON.stringify({ version: 1, entries: [{ ...input, updatedAt: NOW }, { ...input, updatedAt: NOW }] }),
])('does not silently overwrite corrupted or newer-format records: %s', raw => {
  window.localStorage.setItem(REFLECTION_STORAGE_KEY, raw);
  expect(readDecisionReflections(NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(saveDecisionReflection(input, NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(deleteDecisionReflection('poll-1', undefined, NOW)).toEqual({ ok: false, error: 'corrupt' });
  expect(window.localStorage.getItem(REFLECTION_STORAGE_KEY)).toBe(raw);
  expect(clearDecisionReflections().ok).toBe(true);
  expect(readDecisionReflections(NOW)).toEqual({ ok: true, value: [] });
});

it('reports blocked local storage without crashing', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(readDecisionReflections(NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(saveDecisionReflection(input, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(clearDecisionReflections()).toEqual({ ok: false, error: 'unavailable' });
});

it('reports quota failure and preserves the previously saved record', () => {
  saveDecisionReflection(input, NOW);
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(saveDecisionReflection({ ...input, rating: 'regret' }, NOW)).toEqual({ ok: false, error: 'quota' });
  write.mockRestore();
  expect(readDecisionReflection('poll-1', 'a', NOW)).toMatchObject({ ok: true, value: { rating: 'satisfied' } });
});

it('does not report success when deletion or expiry cleanup is blocked', () => {
  saveDecisionReflection(input, NOW);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(deleteDecisionReflection('poll-1', undefined, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(clearDecisionReflections()).toEqual({ ok: false, error: 'unavailable' });
  expect(readDecisionReflections(NOW + REFLECTION_RETENTION_MS)).toEqual({ ok: false, error: 'unavailable' });
});

it('checks that a write really persisted before reporting a saved reflection', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  expect(saveDecisionReflection(input, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(readDecisionReflection('poll-1', 'a', NOW)).toEqual({ ok: true, value: null });
});

it('checks that remove really cleared a record before reporting deletion or reset success', () => {
  saveDecisionReflection(input, NOW);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  expect(deleteDecisionReflection('poll-1', undefined, NOW)).toEqual({ ok: false, error: 'unavailable' });
  expect(clearDecisionReflections()).toEqual({ ok: false, error: 'unavailable' });
  expect(readDecisionReflection('poll-1', 'a', NOW)).toMatchObject({ ok: true, value: { note: input.note } });
});

it('reports an uncertain save if persistence cannot be read back', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce(null).mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  expect(saveDecisionReflection(input, NOW)).toEqual({ ok: false, error: 'unavailable' });
});
