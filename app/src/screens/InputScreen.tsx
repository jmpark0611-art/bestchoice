import { FixedBottomCTA, TextArea, useToast } from '@toss/tds-mobile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import aiNotice from '../../../docs/legal/ai-notice.md?raw';
import { Gap, Page, PageTop } from '../components/ui';
import { createDecision } from '../lib/api';
import { CONCERN_MAX, concernError } from '../lib/contract';
import { AppError, errorMessage } from '../lib/errors';
import { parseMarkdown } from '../lib/markdown';

const noticeItems = parseMarkdown(aiNotice).flatMap((b) => (b.type === 'list' ? b.items : []));

export function InputScreen() {
  const navigate = useNavigate();
  const { openToast } = useToast();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const error = concernError(text);
  const examples = [
    ['이직할까?', '지금 회사에 남을지 새로운 회사로 이직할지 고민이에요. 연봉과 성장 가능성 중 무엇을 우선해야 할지 모르겠어요.'],
    ['지금 살까?', '필요한 물건을 지금 구매할지 조금 더 기다릴지 고민이에요. 가격과 실제 사용 빈도를 함께 따져보고 싶어요.'],
    ['관계를 계속할까?', '지금의 관계를 계속 이어갈지 거리를 둘지 고민이에요. 제 마음과 앞으로의 변화를 함께 생각하고 싶어요.'],
    ['새로 시작할까?', '새로운 일을 지금 시작할지 조금 더 준비한 뒤 시작할지 고민이에요. 기회와 위험을 비교하고 싶어요.'],
  ];

  const submit = async () => {
    setSubmitting(true);
    try {
      const id = await createDecision(text);
      navigate(`/decision/${id}`, { replace: true });
    } catch (e) {
      openToast(errorMessage(e instanceof AppError ? e.code : 'UNKNOWN'));
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <PageTop title="어떤 고민인가요?" subtitle="상황과 고민 중인 선택지를 함께 적어주면 더 정확해요." />
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
      <Gap size={24} />
      <ul className="notice" aria-label="AI 이용 안내">
        {noticeItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <FixedBottomCTA disabled={!!error || submitting} loading={submitting} onClick={submit}>
        질문 받기
      </FixedBottomCTA>
    </Page>
  );
}
