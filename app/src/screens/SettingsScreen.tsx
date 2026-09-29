import { ListRow, useDialog, useToast } from '@toss/tds-mobile';
import { useNavigate } from 'react-router-dom';
import { Card, Gap, Page, PageTop } from '../components/ui';
import { deleteAccount, deleteAllDecisions } from '../lib/api';
import { AppError, errorMessage } from '../lib/errors';
import { ensureSession } from '../lib/supabase';

export const OPERATOR = { company: '에스케이컴퍼니', ceo: '박지민', email: 'jmpark0611@gmail.com' };

export function SettingsScreen() {
  const navigate = useNavigate();
  const { openConfirm } = useDialog();
  const { openToast } = useToast();
  const fail = (e: unknown) => openToast(errorMessage(e instanceof AppError ? e.code : 'UNKNOWN'));

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
    } catch (e) {
      fail(e);
    }
  };

  const removeAccount = async () => {
    const ok = await openConfirm({
      title: '계정을 삭제할까요?',
      description: '계정과 모든 기록이 즉시 삭제되고 되돌릴 수 없어요.',
      confirmButton: '계정 삭제',
      cancelButton: '취소',
    });
    if (!ok) return;
    try {
      await deleteAccount();
      await ensureSession(); // 새 익명 계정으로 처음부터 시작
      openToast('계정을 삭제했어요');
      navigate('/', { replace: true });
    } catch (e) {
      fail(e);
    }
  };

  const links: [string, string][] = [
    ['개인정보처리방침', '/policy/privacy'],
    ['이용약관', '/policy/terms'],
    ['AI 이용 안내', '/policy/ai'],
  ];

  return (
    <Page>
      <PageTop title="설정" />
      <ul style={{ padding: 0, margin: 0 }}>
        {links.map(([label, to]) => (
          <ListRow
            key={to}
            withArrow
            onClick={() => navigate(to)}
            contents={<ListRow.Texts type="1RowTypeA" top={label} />}
          />
        ))}
        <ListRow onClick={removeAll} contents={<ListRow.Texts type="1RowTypeA" top="모든 기록 삭제" />} />
        <ListRow onClick={removeAccount} contents={<ListRow.Texts type="1RowTypeA" top="계정 삭제" />} />
      </ul>
      <Gap size={24} />
      <Card title="문의">
        <p>
          {OPERATOR.company} · 대표 {OPERATOR.ceo}
        </p>
        <p>
          <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </p>
      </Card>
    </Page>
  );
}
