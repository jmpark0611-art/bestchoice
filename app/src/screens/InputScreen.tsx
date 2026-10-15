import { FixedBottomCTA, TextArea, useDialog, useToast } from '@toss/tds-mobile';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import aiNotice from '../../../docs/legal/ai-notice.md?raw';
import { Gap, Page, PageTop } from '../components/ui';
import { createDecision, getQuota, grantAdBonus, type Quota } from '../lib/api';
import { CONCERN_MAX, concernError } from '../lib/contract';
import { AppError, errorMessage } from '../lib/errors';
import { parseMarkdown } from '../lib/markdown';
import { rewardedAdAvailable, watchRewardedAd } from '../lib/rewardedAd';

const noticeItems = parseMarkdown(aiNotice).flatMap((b) => (b.type === 'list' ? b.items : []));

export function InputScreen() {
  const navigate = useNavigate();
  const { openToast } = useToast();
  const { openConfirm } = useDialog();
  const [quota, setQuota] = useState<Quota | null>(null);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [category, setCategory] = useState('');
  const [urgency, setUrgency] = useState('');
  const error = concernError(text);
  const categories = [
    ['💼', '일·커리어'], ['💳', '소비·돈'], ['💙', '관계'], ['🚀', '도전'], ['✨', '기타'],
  ];
  const urgencies = [['⚡', '오늘'], ['📅', '이번 주'], ['🌿', '천천히']];
  const examples = [
    ['이직할까?', '지금 회사에 남을지 새로운 회사로 이직할지 고민이에요. 연봉과 성장 가능성 중 무엇을 우선해야 할지 모르겠어요.'],
    ['지금 살까?', '필요한 물건을 지금 구매할지 조금 더 기다릴지 고민이에요. 가격과 실제 사용 빈도를 함께 따져보고 싶어요.'],
    ['관계를 계속할까?', '지금의 관계를 계속 이어갈지 거리를 둘지 고민이에요. 제 마음과 앞으로의 변화를 함께 생각하고 싶어요.'],
    ['새로 시작할까?', '새로운 일을 지금 시작할지 조금 더 준비한 뒤 시작할지 고민이에요. 기회와 위험을 비교하고 싶어요.'],
  ];

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
      return true;
    } catch (e) {
      openToast(errorMessage(codeOf(e)));
      return false;
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      if (quota && quota.remaining <= 0 && !(await earnBonus())) {
        setSubmitting(false);
        return;
      }
      const id = await createDecision(text);
      navigate(`/decision/${id}`, { replace: true });
    } catch (e) {
      // 남은 수 표시가 오래됐을 수 있으니 서버가 막으면 광고 제안 후 한 번만 다시 시도
      if (codeOf(e) === 'FREE_LIMIT' && (await earnBonus())) {
        try {
          const id = await createDecision(text);
          navigate(`/decision/${id}`, { replace: true });
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
      <PageTop title="결정 퀘스트를 시작해요" subtitle="세 칸만 채우면 나만의 판단 리포트가 열려요." />
      <div className="quest-map section" aria-label="결정 퀘스트 진행 단계">
        <div className={category ? 'done' : 'active'}><span>1</span><b>분야</b></div><i />
        <div className={urgency ? 'done' : category ? 'active' : ''}><span>2</span><b>시급도</b></div><i />
        <div className={text.trim().length >= 20 ? 'done' : urgency ? 'active' : ''}><span>3</span><b>고민 카드</b></div>
      </div>
      <section className="quest-stage">
        <div className="stage-heading"><span>STEP 1</span><h2>어떤 종류의 고민인가요?</h2></div>
        <div className="category-grid" role="radiogroup" aria-label="고민 분야">
          {categories.map(([icon, label]) => <button type="button" key={label} aria-label={label} aria-pressed={category === label} onClick={() => setCategory(label)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </div>
      </section>
      <section className="quest-stage">
        <div className="stage-heading"><span>STEP 2</span><h2>언제까지 결정하고 싶나요?</h2></div>
        <div className="urgency-row" role="radiogroup" aria-label="결정 시급도">
          {urgencies.map(([icon, label]) => <button type="button" key={label} aria-label={label} aria-pressed={urgency === label} onClick={() => setUrgency(label)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </div>
      </section>
      <section className="quest-stage writing-stage">
        <div className="stage-heading"><span>STEP 3</span><h2>고민 카드를 완성해요</h2></div>
      <div className="example-chips section" aria-label="고민 예시">
        {examples.map(([label, value]) => <button type="button" key={label} onClick={() => setText(value)}>{label}</button>)}
      </div>
      <TextArea
        variant="box"
        placeholder="예) 지금 회사에 남을지, 연봉은 조금 낮지만 배울 게 많은 곳으로 옮길지 고민이에요."
        minHeight={180}
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
      <div className="quest-reward" aria-live="polite">
        <span className="reward-icon">🔮</span><div><b>{category && urgency && !error ? '리포트 준비 완료!' : '결정 단서를 모으는 중'}</b><p>{category || '분야'} · {urgency || '시급도'} · 고민 {Math.min(100, Math.round((text.trim().length / 20) * 100))}%</p></div>
      </div>
      <Gap size={24} />
      <ul className="notice" aria-label="AI 이용 안내">
        {noticeItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {quota && (
        <p className="section muted quota-hint" aria-live="polite">
          {quota.remaining > 0
            ? `오늘 남은 분석 ${quota.remaining}건`
            : quota.canEarnBonus && rewardedAdAvailable()
              ? '오늘 무료 분석을 모두 썼어요. 광고를 보면 1건 더 받을 수 있어요.'
              : '오늘 분석을 모두 썼어요. 내일 다시 이용해주세요.'}
        </p>
      )}
      <FixedBottomCTA disabled={!category || !urgency || !!error || submitting} loading={submitting} onClick={submit}>
        질문 카드 열기
      </FixedBottomCTA>
    </Page>
  );
}
