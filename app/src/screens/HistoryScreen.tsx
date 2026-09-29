import { Button, ListRow, useDialog, useToast } from '@toss/tds-mobile';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorView, Gap, LoadingView, Page, PageTop } from '../components/ui';
import { deleteAllDecisions, listDecisions, type DecisionSummary } from '../lib/api';
import { CHOICE_LABELS } from '../lib/contract';
import { AppError, errorMessage } from '../lib/errors';

export function statusLabel(d: Pick<DecisionSummary, 'status' | 'choiceType' | 'createdAt'>): string {
  const date = new Date(d.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const state =
    d.choiceType != null
      ? CHOICE_LABELS[d.choiceType]
      : d.status === 'completed'
        ? '분석 완료'
        : d.status === 'crisis'
          ? '안내 확인 필요'
          : d.status === 'failed'
            ? '다시 시도 필요'
            : '답변 대기 중';
  return `${date} · ${state}`;
}

export function HistoryScreen() {
  const navigate = useNavigate();
  const { openConfirm } = useDialog();
  const { openToast } = useToast();
  const [items, setItems] = useState<DecisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listDecisions()
      .then(setItems)
      .catch((e) => setError(e instanceof AppError ? e.code : 'UNKNOWN'));
  }, []);
  useEffect(load, [load]);

  const removeAll = async () => {
    const ok = await openConfirm({
      title: '모든 기록을 삭제할까요?',
      description: '삭제한 기록은 되돌릴 수 없어요.',
      confirmButton: '삭제하기',
      cancelButton: '취소',
    });
    if (!ok) return;
    try {
      await deleteAllDecisions();
      openToast('모든 기록을 삭제했어요');
      load();
    } catch (e) {
      openToast(errorMessage(e instanceof AppError ? e.code : 'UNKNOWN'));
    }
  };

  if (error) return <ErrorView code={error} onRetry={load} />;
  if (!items) return <LoadingView message="불러오는 중이에요" />;

  return (
    <Page>
      <PageTop title="내 결정 기록" subtitle="기록은 작성 후 2개월이 지나면 자동으로 삭제돼요." />
      {items.length === 0 ? (
        <div className="center">
          <p className="muted">아직 기록이 없어요.</p>
          <Button display="block" onClick={() => navigate('/input')}>
            고민 판단하기
          </Button>
        </div>
      ) : (
        <>
          <ul style={{ padding: 0, margin: 0 }}>
            {items.map((d) => (
              <ListRow
                key={d.id}
                withArrow
                onClick={() => navigate(`/decision/${d.id}`)}
                contents={<ListRow.Texts type="2RowTypeA" top={d.summary ?? d.concern} bottom={statusLabel(d)} />}
              />
            ))}
          </ul>
          <Gap size={24} />
          <div className="section">
            <button type="button" className="link-button danger" onClick={removeAll}>
              모든 기록 삭제
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
