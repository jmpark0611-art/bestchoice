import { Button, TextArea } from '@toss/tds-mobile';
import { useState } from 'react';
import {
  AXIS_LABELS,
  CHOICE_LABELS,
  CONFIDENCE_LABELS,
  NOTE_MAX,
  recommendationLabel,
  type Analysis,
  type ChoiceType,
} from '../lib/contract';
import { Card, Gap, PageTop } from './ui';

export function ResultView({ analysis, highStakes }: { analysis: Analysis; highStakes: boolean }) {
  return (
    <div className="result-report">
      <PageTop title="이렇게 판단했어요" subtitle={analysis.summary} />
      <div className="result-badge">AI 판단 리포트</div>
      <Card title="추천 결과" highlight>
        <p className="big">{recommendationLabel(analysis)}</p>
        <Gap size={8} />
        <p>{analysis.recommendation.rationale}</p>
        <Gap size={8} />
        <p className="muted">
          {CONFIDENCE_LABELS[analysis.confidence]} · {analysis.confidenceReason}
        </p>
      </Card>
      {highStakes && (
        <>
          <Gap />
          <Card title="꼭 확인해주세요">
            <p>중요한 결정이에요. 전문가와 함께 확인하는 걸 권해요.</p>
          </Card>
        </>
      )}
      <Gap size={24} />
      <Card title="6가지 기준으로 본 추천안">
        <div className="axes">
          {analysis.axes.map((a) => (
            <div key={a.key}>
              <div className="axis-head">
                <span>{AXIS_LABELS[a.key]}</span>
                <span aria-label={`5점 중 ${a.score}점`}>{a.score}/5</span>
              </div>
              <div className="axis-bar" aria-hidden>
                <span style={{ width: `${a.score * 20}%` }} />
              </div>
              <p className="axis-text">{a.rationale}</p>
              {a.uncertainty && <p className="axis-text muted">불확실: {a.uncertainty}</p>}
            </div>
          ))}
        </div>
      </Card>
      <Gap />
      <Card title="놓치기 쉬운 점">
        <ul className="bullets">
          {analysis.missedFactors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </Card>
      <Gap />
      <Card title={`${analysis.nextAction.timeframeHours}시간 안에 해볼 일`}>
        <p>{analysis.nextAction.text}</p>
      </Card>
      <Gap />
      <Card title="이럴 땐 다른 선택이 나아요">
        <ul className="bullets">
          {analysis.switchConditions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>
      <Gap />
      <p className="section muted">{analysis.disclaimer}</p>
    </div>
  );
}

type ChoiceProps = {
  saved: { type: ChoiceType; note: string } | null;
  saving: boolean;
  onSave: (type: ChoiceType, note: string) => void;
};

export function ActualChoiceForm({ saved, saving, onSave }: ChoiceProps) {
  const [type, setType] = useState<ChoiceType | null>(saved?.type ?? null);
  const [note, setNote] = useState(saved?.note ?? '');
  const dirty = type !== (saved?.type ?? null) || note.trim() !== (saved?.note ?? '');

  return (
    <section className="question">
      <p className="question-title">실제로는 어떻게 했나요?</p>
      <div className="choices" role="radiogroup" aria-label="실제 선택">
        {(Object.keys(CHOICE_LABELS) as ChoiceType[]).map((t) => (
          <button type="button" key={t} className="choice" aria-pressed={type === t} onClick={() => setType(t)}>
            {CHOICE_LABELS[t]}
          </button>
        ))}
      </div>
      <Gap size={8} />
      <div className="bleed">
        <TextArea
          variant="box"
          placeholder="메모 (선택)"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="메모"
        />
      </div>
      <Gap size={8} />
      <Button
        display="block"
        disabled={!type || !dirty || saving}
        loading={saving}
        onClick={() => type && onSave(type, note)}
      >
        {saved ? '기록 수정하기' : '기록하기'}
      </Button>
    </section>
  );
}

export function CrisisView({ onHome }: { onHome: () => void }) {
  return (
    <>
      <PageTop
        title="지금은 분석보다 도움이 먼저예요"
        subtitle="혼자 감당하지 않아도 돼요. 지금 바로 이야기할 수 있는 곳이 있어요."
      />
      <Card highlight>
        <ul className="bullets">
          <li>
            자살예방상담전화 <a href="tel:109">109</a> (24시간)
          </li>
          <li>
            정신건강위기상담전화 <a href="tel:15770199">1577-0199</a>
          </li>
          <li>
            긴급한 위험이 있다면 <a href="tel:112">112</a> 또는 <a href="tel:119">119</a>
          </li>
        </ul>
      </Card>
      <Gap size={24} />
      <div className="section">
        <Button display="block" variant="weak" onClick={onHome}>
          처음으로
        </Button>
      </div>
    </>
  );
}
