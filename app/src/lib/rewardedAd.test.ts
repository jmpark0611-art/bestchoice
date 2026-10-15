const sdk = vi.hoisted(() => {
  type Handlers = { options?: { adGroupId: string }; onEvent: (e: { type: string }) => void; onError: (e: Error) => void };
  const state: { load?: Handlers; show?: Handlers } = {};
  const load = Object.assign(
    vi.fn((h: Handlers) => {
      state.load = h;
      return vi.fn();
    }),
    { isSupported: vi.fn(() => true) },
  );
  const show = Object.assign(
    vi.fn((h: Handlers) => {
      state.show = h;
      return vi.fn();
    }),
    { isSupported: vi.fn(() => true) },
  );
  return { state, loadFullScreenAd: load, showFullScreenAd: show };
});
vi.mock('@apps-in-toss/web-framework', () => sdk);

import { rewardedAdAvailable, watchRewardedAd } from './rewardedAd';

describe('rewardedAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_AD_GROUP_REWARDED', 'ad-group-1');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('광고 그룹 ID가 없으면 사용할 수 없다', () => {
    vi.stubEnv('VITE_AD_GROUP_REWARDED', '');
    expect(rewardedAdAvailable()).toBe(false);
  });

  it('지원하지 않는 환경이면 사용할 수 없다', () => {
    sdk.loadFullScreenAd.isSupported.mockReturnValueOnce(false);
    expect(rewardedAdAvailable()).toBe(false);
  });

  it('끝까지 보면 true', async () => {
    const p = watchRewardedAd();
    expect(sdk.state.load!.options).toEqual({ adGroupId: 'ad-group-1' });
    sdk.state.load!.onEvent({ type: 'loaded' });
    expect(sdk.state.show!.options).toEqual({ adGroupId: 'ad-group-1' });
    sdk.state.show!.onEvent({ type: 'show' });
    sdk.state.show!.onEvent({ type: 'userEarnedReward' });
    sdk.state.show!.onEvent({ type: 'dismissed' });
    await expect(p).resolves.toBe(true);
  });

  it('중간에 닫으면 false', async () => {
    const p = watchRewardedAd();
    sdk.state.load!.onEvent({ type: 'loaded' });
    sdk.state.show!.onEvent({ type: 'dismissed' });
    await expect(p).resolves.toBe(false);
  });

  it('불러오기 실패나 노출 실패는 AD_NOT_READY', async () => {
    const p1 = watchRewardedAd();
    sdk.state.load!.onError(new Error('no fill'));
    await expect(p1).rejects.toMatchObject({ code: 'AD_NOT_READY' });

    const p2 = watchRewardedAd();
    sdk.state.load!.onEvent({ type: 'loaded' });
    sdk.state.show!.onEvent({ type: 'failedToShow' });
    await expect(p2).rejects.toMatchObject({ code: 'AD_NOT_READY' });
  });

  it('제때 로드되지 않으면 시간 초과', async () => {
    vi.useFakeTimers();
    const p = watchRewardedAd(1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ code: 'AD_NOT_READY' });
    vi.useRealTimers();
  });
});
