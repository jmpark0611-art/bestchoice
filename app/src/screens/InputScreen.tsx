import { FixedBottomCTA, TextArea, useDialog, useToast } from '@toss/tds-mobile';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import aiNotice from '../../../docs/legal/ai-notice.md?raw';
import { Gap, Page, PageTop } from '../components/ui';
import { createDecision, getQuota, grantAdBonus, type Quota, type Urgency, type UserCategory } from '../lib/api';
import { logEvent } from '../lib/analytics';
import { CONCERN_MAX, concernError } from '../lib/contract';
import { AppError, errorMessage } from '../lib/errors';
import { parseMarkdown } from '../lib/markdown';
import { rewardedAdAvailable, watchRewardedAd } from '../lib/rewardedAd';

const CATEGORIES: [UserCategory, string][] = [
  ['career', '일'],
  ['money', '돈'],
  ['relationship', '관계'],
  ['growth', '도전'],
  ['other', '기타'],
];
const URGENCIES: [Urgency, string][] = [
  ['today', '오늘'],
  ['week', '이번 주'],
  ['relaxed', '천천히'],
];
/** [칩 이름, 채워 넣을 고민 문장]. 홈의 예시 칩도 같은 문장을 쓴다 */
export const EXAMPLES = [
  ['이직', '지금 회사에 남을지 새로운 회사로 이직할지 고민이에요. 연봉과 성장 가능성 중 무엇을 우선해야 할지 모르겠어요.'],
  ['구매', '필요한 물건을 지금 구매할지 조금 더 기다릴지 고민이에요. 가격과 실제 사용 빈도를 함께 따져보고 싶어요.'],
  ['관계', '지금의 관계를 계속 이어갈지 거리를 둘지 고민이에요. 제 마음과 앞으로의 변화를 함께 생각하고 싶어요.'],
  ['새 출발', '새로운 일을 지금 시작할지 조금 더 준비한 뒤 시작할지 고민이에요. 기회와 위험을 비교하고 싶어요.'],
];

const noticeItems = parseMarkdown(aiNotice).flatMap((b) => (b.type === 'list' ? b.items : []));

export function InputScreen() {
  const navigate = useNavigate();
  const { openToast } = useToast();
  const { openConfirm } = useDialog();
  const [quota, setQuota] = useState<Quota | null>(null);
  // 홈에서 예시를 눌러 들어오면 그 문장으로 시작
  const prefill = (useLocation().state as { text?: string } | null)?.text;
  const [text, setText] = useState(prefill ?? '');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [category, setCategory] = useState<UserCategory | ''>('');
  const [urgency, setUrgency] = useState<Urgency | ''>('');
  const error = concernError(text);

  const refreshQuota = useCallback(() => {
    getQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, []);
  useEffect(refreshQuota, [refreshQuota]);

  const codeOf = (e: unknown) => (e instanceof AppError ? e.code : 'UNKNOWN');

  /** 무료 분석을 다 썼을 때: 보상형 광고를 보면 1건 추가. 성공하면 true */
  const earnBonus = async (): Promise<boolean> => {
    const canEarn = quota?.canEarnBonus !== false && rewardedAdAvailable();
    if (!canEarn) {
      openToast(errorMessage(quota?.canEarnBonus === false ? 'AD_BONUS_LIMIT' : 'FREE_LIMIT'));
      return false;
    }
    const ok = await openConfirm({
      title: '오늘 무료 분석을 모두 썼어요',
      description: '짧은 광고를 끝까지 보면 분석 1건을 더 받을 수 있어요.',
      confirmButton: '광고 보고 1건 더 받기',
      cancelButton: '내일 할게요',
    });
    if (!ok) return false;
    try {
      const earned = await watchRewardedAd();
      if (!earned) {
        openToast(errorMessage('AD_NOT_COMPLETED'));
        return false;
      }
      setQuota(await grantAdBonus());
      logEvent('ad_reward_earned');
      return true;
    } catch (e) {
      openToast(errorMessage(codeOf(e)));
      return false;
    }
  };

  const context = { category: category || undefined, urgency: urgency || undefined };
  const goToDecision = (id: string) => {
    logEvent('decision_submitted', { category, urgency });
    navigate(`/decision/${id}`, { replace: true });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      if (quota && quota.remaining <= 0 && !(await earnBonus())) {
        setSubmitting(false);
        return;
      }
      const id = await createDecision(text, context);
      goToDecision(id);
    } catch (e) {
      // 남은 수 표시가 오래됐을 수 있으니 서버가 막으면 광고 제안 후 한 번만 다시 시도
      if (codeOf(e) === 'FREE_LIMIT' && (await earnBonus())) {
        try {
          const id = await createDecision(text, context);
          goToDecision(id);
          return;
        } catch (retry) {
          openToast(errorMessage(codeOf(retry)));
        }
      } else if (codeOf(e) !== 'FREE_LIMIT') {
        openToast(errorMessage(codeOf(e)));
      }
      refreshQuota();
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <PageTop title="뭘 못 정하겠어요?" />
      <section className="input-group">
        <h2 className="section group-title">분야 <span className="muted">선택</span></h2>
        <div className="chip-row one-line section" role="radiogroup" aria-label="고민 분야">
          {CATEGORIES.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className="chip"
              role="radio"
              aria-checked={category === value}
              onClick={() => setCategory(category === value ? '' : value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="input-group">
        <h2 className="section group-title">언제까지? <span className="muted">선택</span></h2>
        <div className="chip-row section" role="radiogroup" aria-label="결정 시급도">
          {URGENCIES.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className="chip"
              role="radio"
              aria-checked={urgency === value}
              onClick={() => setUrgency(urgency === value ? '' : value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="input-group">
        <h2 className="section group-title concern">고민</h2>
        <div className="chip-row one-line section" aria-label="고민 예시">
          {EXAMPLES.map(([label, value]) => (
            <button type="button" key={label} className="chip subtle" onClick={() => setText(value)}>
              {label}
            </button>
          ))}
        </div>
        <TextArea
          variant="box"
          placeholder="예) 남을까, 옮길까? 연봉은 낮아도 배울 게 많은 곳이에요."
          minHeight={112}
          maxLength={CONCERN_MAX}
          value={text}
          hasError={touched && !!error}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-label="고민 내용"
        />
        <p className={touched && error ? 'counter error' : 'counter'} aria-live="polite">
          {touched && error ? error : `${text.trim().length}/${CONCERN_MAX}`}
        </p>
      </section>
      {quota && (
        <p className="section muted quota-hint" aria-live="polite">
          {quota.remaining > 0
            ? `오늘 남은 분석 ${quota.remaining}건`
            : quota.canEarnBonus && rewardedAdAvailable()
              ? '오늘 무료 분석을 모두 썼어요. 광고를 보면 1건 더 받을 수 있어요.'
              : '오늘 분석을 모두 썼어요. 내일 다시 이용해주세요.'}
        </p>
      )}
      <Gap size={8} />
      <details className="notice-box section">
        <summary>AI 분석 · 민감한 정보는 적지 마세요</summary>
        <ul className="notice" aria-label="AI 이용 안내">
          {noticeItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
      <FixedBottomCTA disabled={!!error || submitting} loading={submitting} onClick={submit}>
        질문 받기
      </FixedBottomCTA>
    </Page>
  );
}
