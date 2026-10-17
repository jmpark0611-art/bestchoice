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
      <p className="section result-kicker">결정했어요</p>
      <PageTop title={recommendationLabel(analysis)} subtitle={CONFIDENCE_LABELS[analysis.confidence]} />
      <Card highlight>
        <p>{analysis.recommendation.rationale}</p>
      </Card>
      {highStakes && (
        <>
          <Gap />
          <Card title="꼭 확인해주세요">
            <p>중요한 결정이에요. 전문가와 함께 확인하는 걸 권해요.</p>
          </Card>
        </>
      )}
      <Gap />
      <Card title={`${analysis.nextAction.timeframeHours}시간 안에 해볼 일`}>
        <p>{analysis.nextAction.text}</p>
      </Card>
      <Gap />
      <Card title="6가지 기준">
        <div className="axes">
          {analysis.axes.map((a) => (
            <details key={a.key} className="axis">
              {/* iOS Safari 구버전은 summary 자체에 grid가 안 먹어 안쪽 span에 배치 */}
              <summary>
                <span className="axis-row">
                  <span className="axis-name">{AXIS_LABELS[a.key]}</span>
                  <span className="axis-bar" aria-hidden>
                    <span style={{ width: `${a.score * 20}%` }} />
                  </span>
                  <span className="axis-score" aria-label={`5점 중 ${a.score}점`}>{a.score}</span>
                </span>
              </summary>
              <p className="axis-text">{a.rationale}</p>
              {a.uncertainty && <p className="axis-text muted">불확실: {a.uncertainty}</p>}
            </details>
          ))}
        </div>
        <p className="tap-hint">기준을 누르면 이유가 보여요</p>
      </Card>
      <Gap />
      <details className="card more">
        <summary><span className="more-head">놓치기 쉬운 점 {analysis.missedFactors.length}가지</span></summary>
        <ul className="bullets">
          {analysis.missedFactors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
      <Gap size={8} />
      <details className="card more">
        <summary><span className="more-head">이럴 땐 다른 선택이 나아요</span></summary>
        <ul className="bullets">
          {analysis.switchConditions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
      <Gap />
      <p className="section muted small">{analysis.disclaimer}</p>
    </div>
  );
}

/** 한 줄에 3개가 들어가도록 짧게. 기록 화면은 문장형 CHOICE_LABELS를 그대로 쓴다 */
const CHOICE_SHORT: Record<ChoiceType, string> = { followed: '추천대로', other: '다르게', undecided: '아직 고민 중' };

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
      <p className="question-title">그래서, 어떻게 했어요?</p>
      <div className="choice-row" role="radiogroup" aria-label="실제 선택">
        {(Object.keys(CHOICE_LABELS) as ChoiceType[]).map((t) => (
          <button
            type="button"
            key={t}
            className="choice compact"
            aria-label={CHOICE_LABELS[t]}
            aria-pressed={type === t}
            onClick={() => setType(t)}
          >
            {CHOICE_SHORT[t]}
          </button>
        ))}
      </div>
      <Gap size={8} />
      {/* 메모는 선택한 뒤에만 보여 화면을 짧게 유지 */}
      {(type || note) && (
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
      )}
      <Gap size={8} />
      <Button
        display="block"
        disabled={!type || !dirty || saving}
        loading={saving}
        onClick={() => type && onSave(type, note)}
      >
        {saved ? '기록 수정' : '기록하기'}
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
