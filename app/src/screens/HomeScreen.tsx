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
      <div className="home">
        <div className="section home-top">
          <div className="brand-pill"><span className="brand-mark">✓</span> 결정해줘</div>
        </div>
        {/* 제목과 시작 버튼을 한 덩어리로 세로 가운데에 둔다 */}
        <div className="home-main">
          <section className="home-hero">
            <div className="hero-face" aria-hidden>🤔</div>
            <h1>할까, <em>말까?</em></h1>
            <p className="home-description">질문 3개면 답이 보여요</p>
            <ol className="steps" aria-label="이용 순서">
              <li>고민 적기</li>
              <li>질문 3개</li>
              <li><b>결론</b></li>
            </ol>
          </section>
          <div className="section home-action">
            <Button display="block" onClick={() => navigate('/input')}>
              고민 털어놓기
            </Button>
            {!aiEnabled() && (
              <>
                <Gap size={8} />
                <p className="muted">AI 분석을 준비하고 있어요.</p>
              </>
            )}
          </div>
        </div>
        <Gap size={16} />
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
                전체 기록
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
      </div>
    </Page>
  );
}
