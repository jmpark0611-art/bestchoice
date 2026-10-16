const sdk = vi.hoisted(() => ({
  Analytics: { log: vi.fn(async () => {}) },
  Review: { request: Object.assign(vi.fn(async () => {}), { isSupported: vi.fn(() => true) }) },
}));
vi.mock('@apps-in-toss/web-framework', () => sdk);

import { logEvent, requestReviewOnce } from './analytics';

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('이벤트를 event 타입으로 기록한다', () => {
    logEvent('result_viewed', { safety: 'normal' });
    expect(sdk.Analytics.log).toHaveBeenCalledWith({ log_name: 'result_viewed', log_type: 'event', params: { safety: 'normal' } });
  });

  it('브리지가 없어도 앱을 멈추지 않는다', () => {
    sdk.Analytics.log.mockImplementationOnce(() => {
      throw new Error('no bridge');
    });
    expect(() => logEvent('decision_submitted')).not.toThrow();
  });

  it('리뷰는 한 번만 요청한다', () => {
    requestReviewOnce();
    requestReviewOnce();
    expect(sdk.Review.request).toHaveBeenCalledTimes(1);
  });

  it('지원하지 않는 버전에서는 요청하지 않고, 다음에 다시 시도할 수 있다', () => {
    sdk.Review.request.isSupported.mockReturnValueOnce(false);
    requestReviewOnce();
    expect(sdk.Review.request).not.toHaveBeenCalled();
    requestReviewOnce();
    expect(sdk.Review.request).toHaveBeenCalledTimes(1);
  });
});
