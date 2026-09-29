import { FixedBottomCTA, TextArea } from '@toss/tds-mobile';
import { useState } from 'react';
import {
  answersComplete,
  TEXT_ANSWER_MAX,
  toAnswerList,
  type Answer,
  type AnswerValue,
  type Clarification,
} from '../lib/contract';
import { Card, Gap, Page, PageTop } from './ui';

type Props = {
  clarification: Clarification;
  initial?: Record<string, AnswerValue>;
  submitting: boolean;
  notice?: string;
  onSubmit: (answers: Answer[], raw: Record<string, AnswerValue>) => void;
};

export function QuestionsForm({ clarification, initial, submitting, notice, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue | undefined>>(initial ?? {});
  const set = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (id: string, choiceId: string) => {
    const cur = answers[id];
    const list = Array.isArray(cur) ? cur : [];
    set(id, list.includes(choiceId) ? list.filter((c) => c !== choiceId) : [...list, choiceId]);
  };
  const complete = answersComplete(clarification.questions, answers);

  return (
    <Page>
      <PageTop title="3가지만 더 알려주세요" subtitle="답에 따라 추천이 달라져요." />
      {notice && (
        <>
          <p className="section muted">{notice}</p>
          <Gap />
        </>
      )}
      <Card title="이렇게 이해했어요">
        <p>{clarification.summary}</p>
      </Card>
      <Gap size={24} />
      {clarification.questions.map((q, i) => (
        <div className="question" key={q.id}>
          <p className="question-title">
            {i + 1}. {q.text}
            {q.inputType === 'multiple' && <span className="muted"> (여러 개 선택)</span>}
          </p>
          {q.inputType === 'text' ? (
            <div className="bleed">
              <TextArea
                variant="box"
                placeholder="자유롭게 적어주세요"
                maxLength={TEXT_ANSWER_MAX}
                value={(answers[q.id] as string | undefined) ?? ''}
                onChange={(e) => set(q.id, e.target.value)}
                aria-label={q.text}
              />
            </div>
          ) : (
            <div className="choices" role={q.inputType === 'single' ? 'radiogroup' : 'group'} aria-label={q.text}>
              {q.choices?.map((c) => {
                const v = answers[q.id];
                const selected = q.inputType === 'single' ? v === c.id : Array.isArray(v) && v.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    className="choice"
                    aria-pressed={selected}
                    onClick={() => (q.inputType === 'single' ? set(q.id, c.id) : toggle(q.id, c.id))}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <FixedBottomCTA
        disabled={!complete || submitting}
        loading={submitting}
        onClick={() => onSubmit(toAnswerList(clarification.questions, answers), answers as Record<string, AnswerValue>)}
      >
        분석 받기
      </FixedBottomCTA>
    </Page>
  );
}
