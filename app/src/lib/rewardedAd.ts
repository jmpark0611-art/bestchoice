import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { AppError } from './errors';

/** 콘솔에서 발급받은 보상형 광고 그룹 ID. 없으면 광고 기능을 숨긴다 */
export const rewardedAdGroupId = () => import.meta.env.VITE_AD_GROUP_REWARDED ?? '';

export function rewardedAdAvailable(): boolean {
  if (!rewardedAdGroupId()) return false;
  try {
    return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
  } catch {
    return false;
  }
}

/**
 * 보상형 광고를 불러와 보여준다.
 * - 끝까지 봐서 userEarnedReward가 온 뒤 닫히면 true
 * - 중간에 닫으면 false
 * - 불러오기/노출 실패는 AppError('AD_NOT_READY')
 */
export function watchRewardedAd(timeoutMs = 15000): Promise<boolean> {
  const adGroupId = rewardedAdGroupId();
  return new Promise<boolean>((resolve, reject) => {
    let earned = false;
    let settled = false;
    let stopLoad: (() => void) | undefined;
    let stopShow: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopLoad?.();
      stopShow?.();
      fn();
    };
    const fail = () => finish(() => reject(new AppError('AD_NOT_READY')));
    // 광고가 제때 로드되지 않으면 사용자를 기다리게 두지 않는다
    const timer = setTimeout(fail, timeoutMs);

    try {
      stopLoad = loadFullScreenAd({
        options: { adGroupId },
        onError: fail,
        onEvent: (event) => {
          if (event.type !== 'loaded' || settled) return;
          clearTimeout(timer);
          stopShow = showFullScreenAd({
            options: { adGroupId },
            onError: fail,
            onEvent: (e) => {
              if (e.type === 'userEarnedReward') earned = true;
              else if (e.type === 'failedToShow') fail();
              else if (e.type === 'dismissed') finish(() => resolve(earned));
            },
          });
        },
      });
    } catch {
      fail();
    }
  });
}
