import { FixedBottomCTA, TextArea } from '@toss/tds-mobile';
import { useState } from 'react';
import {
  TEXT_ANSWER_MAX,
  toAnswerList,
  type Answer,
  type AnswerValue,
  type Clarification,
} from '../lib/contract';
import { Gap, Page } from './ui';

type Props = {
  clarification: Clarification;
  initial?: Record<string, AnswerValue>;
  submitting: boolean;
  notice?: string;
  onSubmit: (answers: Answer[], raw: Record<string, AnswerValue>) => void;
};

export function QuestionsForm({ clarification, initial, submitting, notice, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue | undefined>>(initial ?? {});
  const [step, setStep] = useState(0);
  const set = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (id: string, choiceId: string) => {
    const cur = answers[id];
    const list = Array.isArray(cur) ? cur : [];
    set(id, list.includes(choiceId) ? list.filter((c) => c !== choiceId) : [...list, choiceId]);
  };
  const answeredCount = clarification.questions.filter((q) => {
    const value = answers[q.id];
    return typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;
  }).length;
  const question = clarification.questions[step];
  const current = answers[question.id];
  const currentComplete = typeof current === 'string' ? current.trim().length > 0 : Array.isArray(current) && current.length > 0;
  const last = step === clarification.questions.length - 1;

  return (
    <Page>
      <p className="question-status section">
        <b>{step + 1}</b> / {clarification.questions.length}
      </p>
      <div className="progress-track" aria-label={`질문 ${answeredCount}개 답변 완료`}><span style={{ width: `${(answeredCount / clarification.questions.length) * 100}%` }} /></div>
      {notice && (
        <>
          <p className="section muted">{notice}</p>
          <Gap />
        </>
      )}
      {step === 0 && <p className="section understood">“{clarification.summary}”</p>}
      <div key={question.id}>
        <div className="question">
          <p className="question-title">
            {question.text}
            {question.inputType === 'multiple' && <span className="muted"> 여러 개</span>}
          </p>
          {question.inputType === 'text' ? (
            <div className="bleed">
              <TextArea
                variant="box"
                placeholder="짧게 적어도 돼요"
                maxLength={TEXT_ANSWER_MAX}
                value={(answers[question.id] as string | undefined) ?? ''}
                onChange={(e) => set(question.id, e.target.value)}
                aria-label={question.text}
              />
            </div>
          ) : (
            <div className="choices" role={question.inputType === 'single' ? 'radiogroup' : 'group'} aria-label={question.text}>
              {question.choices?.map((c) => {
                const v = answers[question.id];
                const selected = question.inputType === 'single' ? v === c.id : Array.isArray(v) && v.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    className="choice"
                    aria-label={c.label}
                    aria-pressed={selected}
                    onClick={() => (question.inputType === 'single' ? set(question.id, c.id) : toggle(question.id, c.id))}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="card-navigation">
            {step > 0 && <button type="button" className="link-button" onClick={() => setStep(step - 1)}>
                이전
              </button>}
          </div>
        </div>
      </div>
      <FixedBottomCTA
        disabled={!currentComplete || submitting}
        loading={submitting}
        onClick={() => last ? onSubmit(toAnswerList(clarification.questions, answers), answers as Record<string, AnswerValue>) : setStep(step + 1)}
      >
        {last ? '결론 보기' : '다음'}
      </FixedBottomCTA>
    </Page>
  );
}
