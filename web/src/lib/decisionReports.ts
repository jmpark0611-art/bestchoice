import { withDeadline } from './deadline';
import { AppError } from './errors';
import { ensureSession, getSupabase } from './supabase';

export const REPORT_DETAILS_MAX = 200;
export const REPORT_CATEGORIES = [
  { value: 'unsafe', label: '위험하거나 부적절해요' },
  { value: 'incorrect', label: '사실과 맞지 않아요' },
  { value: 'privacy', label: '개인정보가 포함됐어요' },
  { value: 'other', label: '다른 문제가 있어요' },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value'];
export type ReportTarget = { kind: 'owner'; pollId: string } | { kind: 'voter'; shareCode: string };
export type ReportSubmission = {
  target: ReportTarget;
  category: ReportCategory;
  details: string;
  consented: boolean;
  /** Keep the same value and payload when retrying a request whose outcome is uncertain. */
  requestId: string;
};
export type ReportReceipt = { status: 'received'; receiptId: string; receivedAt: string; requestId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createReportRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // Fail honestly rather than use a predictable ID for duplicate prevention.
  throw new AppError('REPORT_UNAVAILABLE');
}

export function reportTargetKey(target: ReportTarget): string {
  return target.kind === 'owner' ? `owner:${target.pollId}` : `voter:${target.shareCode}`;
}

function validSubmission(input: ReportSubmission): boolean {
  const target = input.target;
  return UUID.test(input.requestId) && input.consented === true &&
    REPORT_CATEGORIES.some(category => category.value === input.category) &&
    typeof input.details === 'string' && input.details.trim().length <= REPORT_DETAILS_MAX &&
    (target.kind === 'owner' ? UUID.test(target.pollId)
      : target.kind === 'voter' && /^[A-Za-z0-9_-]{1,128}$/.test(target.shareCode));
}

function reportRpcError(error: { code?: string; message?: string }): AppError {
  if (error.code === 'PGRST202' || error.code === '42883') return new AppError('REPORT_UNAVAILABLE');
  const known = ['REPORT_NOT_ALLOWED', 'REPORT_LIMIT', 'REPORT_BUSY', 'REPORT_REQUEST_CONFLICT', 'REPORT_INVALID', 'AUTH_REQUIRED'];
  return new AppError(known.find(code => error.message?.includes(code)) ?? 'REPORT_NETWORK');
}

/** Explicit submission only: opening/previewing the form never authenticates or sends data. */
export async function submitDecisionReport(input: ReportSubmission): Promise<ReportReceipt> {
  if (!validSubmission(input)) throw new AppError('REPORT_INVALID');
  return withDeadline(async signal => {
    try {
      await ensureSession();
      // Authentication can finish after a timeout; never send a late report.
      if (signal.aborted) throw new AppError('TIMEOUT');
      const { data, error } = await getSupabase().rpc('vs_report_result', {
        p_request_id: input.requestId,
        p_category: input.category,
        p_details: input.details.trim(),
        p_consent: true,
        p_poll_id: input.target.kind === 'owner' ? input.target.pollId : null,
        p_share_code: input.target.kind === 'voter' ? input.target.shareCode : null,
      }).abortSignal(signal);
      if (signal.aborted) throw new AppError('TIMEOUT');
      if (error) throw reportRpcError(error);
      if (!data || typeof data !== 'object' || data.status !== 'received' ||
        typeof data.receiptId !== 'string' || !UUID.test(data.receiptId) ||
        typeof data.requestId !== 'string' || data.requestId.toLowerCase() !== input.requestId.toLowerCase() ||
        typeof data.receivedAt !== 'string' || !Number.isFinite(Date.parse(data.receivedAt))) {
        throw new AppError('REPORT_RECEIPT_INVALID');
      }
      return { status: 'received', receiptId: data.receiptId, receivedAt: data.receivedAt, requestId: data.requestId };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(signal.aborted ? 'TIMEOUT' : 'REPORT_NETWORK');
    }
  }, 15_000);
}

export function reportErrorMessage(error: unknown): string {
  const code = error instanceof AppError ? error.code : 'REPORT_NETWORK';
  switch (code) {
    case 'REPORT_UNAVAILABLE': return '지금은 신고 접수 기능을 사용할 수 없어요. 접수 확인을 받지 못했으니 나중에 다시 시도해 주세요.';
    case 'REPORT_INVALID': return '신고 사유와 200자 이내의 설명, 전송 동의를 확인해 주세요.';
    case 'REPORT_NOT_ALLOWED':
    case 'AUTH_REQUIRED': return '이 결과를 신고할 권한을 확인하지 못했어요. 작성자이거나 투표를 마친 결과인지 확인해 주세요.';
    case 'REPORT_LIMIT': return '오늘 보낼 수 있는 신고 수에 도달했어요. 내일 다시 시도해 주세요.';
    case 'REPORT_BUSY': return '지금 신고 요청이 많아요. 잠시 후 같은 신고를 다시 보내 주세요.';
    case 'REPORT_REQUEST_CONFLICT': return '이 신고 번호의 내용이 달라 접수 여부를 확인하지 못했어요. 같은 내용을 유지해 주세요.';
    case 'TIMEOUT': return '응답이 늦어 접수 여부를 확인하지 못했어요. 같은 신고 다시 보내기로 확인해 주세요.';
    default: return '접수 확인을 받지 못했어요. 같은 신고를 다시 보내 주세요.';
  }
}
