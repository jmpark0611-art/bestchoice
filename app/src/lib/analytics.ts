import { Analytics, Review } from '@apps-in-toss/web-framework';

/**
 * 콘솔 전환 지표용 이벤트. 이름을 바꾸면 콘솔에 등록한 지표도 같이 바꿔야 한다.
 * - decision_submitted: 고민 등록 (활성)
 * - result_viewed: 6축 결과 리포트 열람 (전환 지표로 등록)
 * - actual_choice_saved: 실제 선택 기록
 * - ad_reward_earned: 보상형 광고 시청 완료
 */
export type AppEvent = 'decision_submitted' | 'result_viewed' | 'actual_choice_saved' | 'ad_reward_earned';

export function logEvent(name: AppEvent, params: Record<string, string | number | boolean | undefined> = {}) {
  try {
    void Analytics.log({ log_name: name, log_type: 'event', params }).catch(() => {});
  } catch {
    // 토스 앱 밖(브라우저·테스트)에서는 브리지가 없어 무시
  }
}

const REVIEW_KEY = 'bc:review-requested';

/** 실제 선택을 처음 기록한 뒤 한 번만 리뷰를 요청한다 */
export function requestReviewOnce() {
  try {
    if (localStorage.getItem(REVIEW_KEY)) return;
    if (!Review.request.isSupported()) return;
    localStorage.setItem(REVIEW_KEY, new Date().toISOString());
    void Review.request().catch(() => {});
  } catch {
    // 미지원 환경이면 조용히 건너뜀
  }
}
