import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  createReportRequestId, REPORT_CATEGORIES, REPORT_DETAILS_MAX, reportErrorMessage, reportTargetKey,
  submitDecisionReport, type ReportCategory, type ReportReceipt, type ReportSubmission, type ReportTarget,
} from '../lib/decisionReports';

type Props = {
  target: ReportTarget;
  choiceLabel: string;
  reason: string;
  disabled?: boolean;
  /** Parent keeps refresh/navigation from discarding a report whose receipt is still unknown. */
  onRequestPendingChange?: (pending: boolean) => void;
};

/** Parent shows this only after an AI result is visible; the RPC independently checks access. */
export function DecisionReport(props: Props) {
  return <ReportEditor key={reportTargetKey(props.target)} {...props} />;
}

function ReportEditor({ target, choiceLabel, reason, disabled = false, onRequestPendingChange }: Props) {
  const id = useId();
  const active = useRef(true);
  const sending = useRef(false);
  const pendingRequest = useRef<ReportSubmission | null>(null);
  const [opened, setOpened] = useState(false);
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [details, setDetails] = useState('');
  const [preview, setPreview] = useState(false);
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const requestNeedsConfirmation = attempted && !receipt && !abandoned;
  useEffect(() => {
    onRequestPendingChange?.(requestNeedsConfirmation);
    return () => onRequestPendingChange?.(false);
  }, [requestNeedsConfirmation, onRequestPendingChange]);

  const inspect = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !category || details.trim().length > REPORT_DETAILS_MAX) return;
    setPreview(true);
    setConsented(false);
    setError(null);
  };

  const send = async () => {
    if (disabled || sending.current || !consented || !category || receipt) return;
    sending.current = true;
    setPending(true);
    setAbandoned(false);
    setAbandonConfirm(false);
    setError(null);
    try {
      // Freeze the first transmitted payload. An uncertain retry must reuse its ID and content.
      if (!pendingRequest.current) {
        pendingRequest.current = { target, category, details: details.trim(), consented: true, requestId: createReportRequestId() };
      }
      setAttempted(true);
      const result = await submitDecisionReport(pendingRequest.current);
      if (active.current) setReceipt(result);
    } catch (cause) {
      if (active.current) setError(reportErrorMessage(cause));
    } finally {
      sending.current = false;
      if (active.current) setPending(false);
    }
  };

  const categoryLabel = REPORT_CATEGORIES.find(item => item.value === category)?.label;

  return (
    <section className="sharebox decision-report" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>AI 답변에 문제가 있나요?</h3>
      {!opened && <button type="button" className="btn text" disabled={disabled} onClick={() => setOpened(true)}>AI 답변 신고</button>}
      {opened && receipt && <div role="status">
        <p>신고가 서버에 접수됐어요.</p>
        <p className="small">접수 번호: <code>{receipt.receiptId}</code></p>
      </div>}
      {opened && !receipt && !preview && <form onSubmit={inspect}>
        <fieldset className="criteria-panel" disabled={disabled}>
          <legend>신고 사유</legend>
          <div className="criteria-options">
            {REPORT_CATEGORIES.map(item => <label className="criterion-option" key={item.value}>
              <input type="radio" name={`${id}-category`} value={item.value} checked={category === item.value}
                onChange={() => setCategory(item.value)} />
              <span>{item.label}</span>
            </label>)}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor={`${id}-details`}>어떤 문제였나요? (선택)</label>
          <textarea id={`${id}-details`} className="report-details" rows={3} maxLength={REPORT_DETAILS_MAX}
            value={details} disabled={disabled} aria-describedby={`${id}-details-help`}
            onChange={event => setDetails(event.target.value)} />
          <p className="small" id={`${id}-details-help`}>{details.length}/{REPORT_DETAILS_MAX}자 · 이름·연락처 같은 개인정보는 적지 마세요.</p>
        </div>
        <button type="submit" className="btn ghost" disabled={disabled || !category || details.trim().length > REPORT_DETAILS_MAX}>보낼 내용 확인</button>
      </form>}
      {opened && !receipt && preview && <div className="report-preview">
        <h4>보낼 내용 확인</h4>
        <p><strong>신고 사유:</strong> {categoryLabel}</p>
        <p><strong>추가 설명:</strong> {details.trim() || '없음'}</p>
        <p className="small">대상 AI 선택: {choiceLabel}</p>
        <blockquote>{reason}</blockquote>
        <p className="small">신고 사유·추가 설명과 이 결정의 식별 정보를 보내요. 운영자는 이미 서버에 있는 이 결정의 선택지·상황·AI 답변을 확인할 수 있어요.</p>
        <p className="small">이 기기의 회고·만족도·다른 결정 기록은 보내지 않아요.</p>
        {!attempted && <label className="report-consent">
          <input type="checkbox" checked={consented} disabled={disabled || pending} onChange={event => setConsented(event.target.checked)} />
          위 내용을 확인했고 신고 전송에 동의해요.
        </label>}
        <button type="button" className="btn ghost" disabled={disabled || pending || !consented} onClick={() => void send()}>
          {pending ? '접수 확인 중…' : attempted ? '같은 신고 다시 보내기' : '신고 보내기'}
        </button>
        {!attempted && <button type="button" className="btn text" disabled={disabled || pending}
          onClick={() => { setPreview(false); setConsented(false); }}>수정하기</button>}
        {attempted && !pending && !abandoned && !abandonConfirm && <button type="button" className="btn text"
          onClick={() => setAbandonConfirm(true)}>접수 확인 없이 나가기 허용</button>}
        {attempted && !pending && !abandoned && abandonConfirm && <div>
          <p className="small" role="alert">신고가 이미 서버에 접수됐을 수 있어요. 확인하지 않고 이동하면 이 화면의 재확인 정보가 사라질 수 있어요.</p>
          <button type="button" className="btn text" onClick={() => { setAbandoned(true); setAbandonConfirm(false); }}>확인 없이 나갈게요</button>
          <button type="button" className="btn text" onClick={() => setAbandonConfirm(false)}>계속 접수 확인하기</button>
        </div>}
        {attempted && !pending && abandoned && <p className="small">접수 확인 없이 이동할 수 있어요. 다시 보내기를 누르면 같은 신고로 접수 여부를 확인해요.</p>}
      </div>}
      {opened && error && <p className="error" role="alert">{error}</p>}
      {opened && pending && <p className="small" role="status">서버의 접수 확인을 기다리고 있어요.</p>}
      {opened && !receipt && <button type="button" className="btn text" disabled={pending} onClick={() => setOpened(false)}>신고 닫기</button>}
    </section>
  );
}
