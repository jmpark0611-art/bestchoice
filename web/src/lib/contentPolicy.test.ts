import { CONTENT_POLICY_STORAGE_KEY, CONTENT_POLICY_VERSION, hasAcceptedContentPolicy, rememberContentPolicyAcceptance } from './contentPolicy';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('requires the current explicit acknowledgement instead of any truthy stored value', () => {
  expect(hasAcceptedContentPolicy()).toBe(false);
  for (const value of ['true', '{}', '{', JSON.stringify({ version: 'old', accepted: true }),
    JSON.stringify({ version: CONTENT_POLICY_VERSION, accepted: 'true' })]) {
    localStorage.setItem(CONTENT_POLICY_STORAGE_KEY, value);
    expect(hasAcceptedContentPolicy()).toBe(false);
  }
  expect(rememberContentPolicyAcceptance()).toBe(true);
  expect(hasAcceptedContentPolicy()).toBe(true);
  expect(JSON.parse(localStorage.getItem(CONTENT_POLICY_STORAGE_KEY)!)).toEqual({ version: CONTENT_POLICY_VERSION, accepted: true });
});

it('never turns denied or silently ignored storage into remembered consent', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  expect(hasAcceptedContentPolicy()).toBe(false);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  expect(rememberContentPolicyAcceptance()).toBe(false);
  vi.restoreAllMocks();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  expect(rememberContentPolicyAcceptance()).toBe(false);
});
