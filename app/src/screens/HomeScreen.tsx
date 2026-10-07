import { Button, ListRow } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gap, Page } from '../components/ui';
import { listDecisions, type DecisionSummary } from '../lib/api';
import { aiEnabled } from '../lib/supabase';
import { statusLabel } from './HistoryScreen';

export function HomeScreen() {
  const navigate = useNavigate();
  const [recent, setRecent] = useState<DecisionSummary[] | null>(null);

  useEffect(() => {
    listDecisions(3)
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  return (
    <Page>
      <section className="home-hero">
        <div className="brand-pill"><span className="brand-mark">✓</span> 결정해줘</div>
        <p className="home-kicker">생각이 복잡할 때</p>
        <h1>선택의 기준을<br /><em>또렷하게.</em></h1>
        <p className="home-description">고민을 들려주면 꼭 필요한 질문을 묻고<br />6가지 기준으로 차분하게 정리해 드려요.</p>
        <div className="choice-visual" aria-hidden="true">
          <div className="visual-path path-left"><span>선택 A</span></div>
          <div className="visual-path path-right"><span>선택 B</span></div>
          <div className="visual-result"><span>✓</span><b>나에게 맞는 선택</b></div>
        </div>
      </section>
      <div className="section home-action">
        <Button display="block" onClick={() => navigate('/input')}>
          내 고민 정리하기
        </Button>
        {!aiEnabled() && (
          <>
            <Gap size={8} />
            <p className="muted">AI 분석을 준비하고 있어요. 고민은 미리 적어둘 수 있어요.</p>
          </>
        )}
      </div>
      <section className="how-it-works">
        <p className="section-label">이렇게 도와드려요</p>
        <div className="process-grid">
          <div><b>01</b><span>고민 입력</span><p>상황과 선택지를<br />편하게 적어요</p></div>
          <div><b>02</b><span>핵심 질문</span><p>딱 3가지에<br />답해요</p></div>
          <div><b>03</b><span>판단 정리</span><p>6가지 기준으로<br />비교해요</p></div>
        </div>
      </section>
      <Gap size={24} />
      {recent && recent.length > 0 && (
        <>
          <p className="section section-label">최근 결정</p>
          <ul className="recent-list">
            {recent.map((d) => (
              <ListRow
                key={d.id}
                withArrow
                onClick={() => navigate(`/decision/${d.id}`)}
                contents={<ListRow.Texts type="2RowTypeA" top={d.summary ?? d.concern} bottom={statusLabel(d)} />}
              />
            ))}
          </ul>
          <div className="section">
            <Button display="block" variant="weak" onClick={() => navigate('/history')}>
              전체 기록 보기
            </Button>
          </div>
        </>
      )}
      <Gap size={24} />
      <div className="section">
        <button type="button" className="link-button" onClick={() => navigate('/settings')}>
          설정 · 약관 · 문의
        </button>
      </div>
    </Page>
  );
}
