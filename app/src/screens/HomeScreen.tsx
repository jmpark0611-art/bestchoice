import { Button, ListRow } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gap, Page, PageTop } from '../components/ui';
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
      <PageTop
        title="고민되는 선택이 있나요?"
        subtitle="상황을 적으면 질문 3개로 정리하고, 6가지 기준으로 판단을 도와드려요."
      />
      <div className="section">
        <Button display="block" onClick={() => navigate('/input')}>
          고민 판단하기
        </Button>
        {!aiEnabled() && (
          <>
            <Gap size={8} />
            <p className="muted">AI 분석을 준비하고 있어요. 고민은 미리 적어둘 수 있어요.</p>
          </>
        )}
      </div>
      <Gap size={24} />
      {recent && recent.length > 0 && (
        <>
          <p className="section question-title">최근 결정</p>
          <ul style={{ padding: 0, margin: 0 }}>
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
