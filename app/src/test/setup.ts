import '@testing-library/jest-dom/vitest';

// jsdom에 없는 브라우저 API (TDS가 사용)
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
if (!window.scrollTo) window.scrollTo = () => {};

// TDS 아이콘은 static.toss.im에서 SVG를 받아온다. 테스트에서는 네트워크 없이 빈 SVG로 대체
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://static.toss.im/'))
    return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200 });
  return realFetch(input, init);
}) as typeof fetch;

// TDS 다이얼로그 정리 코드가 jsdom에서 빈 선택자로 querySelectorAll을 호출함 (실기기와 무관한 테스트 환경 문제)
const realQSA = Document.prototype.querySelectorAll;
Document.prototype.querySelectorAll = function (this: Document, selector: string) {
  if (selector === '') return realQSA.call(this, ':not(*)');
  return realQSA.call(this, selector);
} as typeof Document.prototype.querySelectorAll;
