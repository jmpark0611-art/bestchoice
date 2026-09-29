import { Button, useToast } from '@toss/tds-mobile';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActualChoiceForm, CrisisView, ResultView } from '../components/ResultView';
import { QuestionsForm } from '../components/QuestionsForm';
import { ErrorView, Gap, LoadingView, Page } from '../components/ui';
import { getDecision, requestAI, saveActualChoice, type DecisionDetail } from '../lib/api';
import type { Answer, AnswerValue, ChoiceType } from '../lib/contract';
import { AppError, errorMessage } from '../lib/errors';
import { aiEnabled } from '../lib/supabase';

type View = 'clarify' | 'questions' | 'analyzing' | 'result' | 'crisis' | 'waiting' | 'ai-off';

/** 서버 상태 → 보여줄 화면 */
export function viewFor(d: DecisionDetail, aiOn: boolean): View {
  if (d.status === 'crisis') return 'crisis';
  if (d.status === 'completed' && d.analysis) return 'result';
  if (!aiOn) return 'ai-off';
  if (d.status === 'draft' || (d.status === 'failed' && !d.clarification)) return 'clarify';
  if (d.status === 'analyzing') return 'waiting';
  return 'questions';
}

const answersKey = (id: string) => `bc:answers:${id}`;
const loadAnswers = (id: string): Record<string, AnswerValue> | undefined => {
  try {
    const raw = sessionStorage.getItem(answersKey(id));
    return raw ? (JSON.parse(raw) as Record<string, AnswerValue>) : undefined;
  } catch {
    return undefined;
  }
};

const codeOf = (e: unknown) => (e instanceof AppError ? e.code : 'UNKNOWN');

export function DecisionScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { openToast } = useToast();
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'clarify' | 'analyze' | 'save' | null>(null);
  const [forceQuestions, setForceQuestions] = useState(false);
  const clarifyStarted = useRef(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getDecision(id));
    } catch (e) {
      setError(codeOf(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runClarify = useCallback(async () => {
    setBusy('clarify');
    setError(null);
    try {
      await requestAI({ decisionId: id, stage: 'clarify' });
      await reload();
    } catch (e) {
      setError(codeOf(e));
    } finally {
      setBusy(null);
    }
  }, [id, reload]);

  const view = detail ? viewFor(detail, aiEnabled()) : null;

  // 고민 등록 직후(draft)에는 질문 생성을 자동으로 한 번 시작
  useEffect(() => {
    if (view === 'clarify' && !clarifyStarted.current) {
      clarifyStarted.current = true;
      void runClarify();
    }
  }, [view, runClarify]);

  const runAnalyze = async (answers: Answer[], raw: Record<string, AnswerValue>) => {
    try {
      sessionStorage.setItem(answersKey(id), JSON.stringify(raw));
    } catch {
      // 저장 실패 시 재시도 때 답을 다시 입력하면 됨
    }
    setBusy('analyze');
    setError(null);
    try {
      await requestAI({ decisionId: id, stage: 'analyze', answers });
      setForceQuestions(false);
      await reload();
    } catch (e) {
      setError(codeOf(e));
    } finally {
      setBusy(null);
    }
  };

  const saveChoice = async (type: ChoiceType, note: string) => {
    setBusy('save');
    try {
      await saveActualChoice(id, type, note);
      await reload();
      openToast('기록했어요');
    } catch (e) {
      openToast(errorMessage(codeOf(e)));
    } finally {
      setBusy(null);
    }
  };

  const home = () => navigate('/', { replace: true });

  if (busy === 'clarify') return <LoadingView message="고민을 정리하고 질문을 만들고 있어요" />;
  if (busy === 'analyze') return <LoadingView message="6가지 기준으로 분석하고 있어요" />;
  if (error && !detail) return <ErrorView code={error} onRetry={reload} onHome={home} />;
  if (!detail || !view) return <LoadingView message="불러오는 중이에요" />;

  if (error && (view === 'clarify' || view === 'questions' || view === 'waiting')) {
    const retry = view === 'clarify' ? runClarify : () => (setError(null), setForceQuestions(true));
    return <ErrorView code={error} onRetry={retry} onHome={home} />;
  }

  const questionsView = () =>
    detail.clarification ? (
      <QuestionsForm
        clarification={detail.clarification}
        initial={loadAnswers(id)}
        submitting={false}
        notice={
          detail.status === 'failed' ? '지난 분석이 끝나지 못했어요. 답변을 확인하고 다시 보내주세요.' : undefined
        }
        onSubmit={runAnalyze}
      />
    ) : (
      <LoadingView message="질문을 준비하고 있어요" />
    );

  switch (view) {
    case 'crisis':
      return (
        <Page>
          <CrisisView onHome={home} />
        </Page>
      );
    case 'result':
      return (
        <Page>
          <ResultView analysis={detail.analysis!} highStakes={detail.safetyMode === 'high_stakes'} />
          <Gap size={24} />
          <ActualChoiceForm
            saved={detail.choiceType ? { type: detail.choiceType, note: detail.choiceNote } : null}
            saving={busy === 'save'}
            onSave={saveChoice}
          />
        </Page>
      );
    case 'ai-off':
      return (
        <Page>
          <div className="center">
            <p className="big">AI 분석을 준비하고 있어요</p>
            <p className="muted">적어주신 고민은 저장됐어요. 준비가 끝나면 이어서 분석할 수 있어요.</p>
            <Button display="block" variant="weak" onClick={home}>
              처음으로
            </Button>
          </div>
        </Page>
      );
    case 'waiting':
      if (forceQuestions) return questionsView();
      return (
        <Page>
          <div className="center">
            <p className="big">분석하고 있어요</p>
            <p className="muted">잠시 후 다시 확인해주세요.</p>
            <Button display="block" onClick={reload}>
              다시 확인하기
            </Button>
            <Button display="block" variant="weak" onClick={() => setForceQuestions(true)}>
              답변 다시 보내기
            </Button>
          </div>
        </Page>
      );
    case 'questions':
    case 'clarify':
      return questionsView();
  }
}
