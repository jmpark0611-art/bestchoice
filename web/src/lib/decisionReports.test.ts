import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors';
import { createReportRequestId, submitDecisionReport, type ReportSubmission } from './decisionReports';

const backend = vi.hoisted(() => ({ ensureSession: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./supabase', () => ({ ensureSession: backend.ensureSession, getSupabase: () => ({ rpc: backend.rpc }) }));

const requestId = '00000000-0000-4000-8000-000000000001';
const pollId = '00000000-0000-4000-8000-000000000002';
const receiptId = '00000000-0000-4000-8000-000000000003';
const input: ReportSubmission = { target: { kind: 'owner', pollId }, requestId, category: 'incorrect', details: '사실 확인이 필요해요', consented: true };
const receipt = { status: 'received', receiptId, requestId, receivedAt: '2026-11-23T09:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  backend.ensureSession.mockResolvedValue('existing-session');
  backend.rpc.mockImplementation(() => ({ abortSignal: backend.abortSignal }));
  backend.abortSignal.mockResolvedValue({ data: receipt, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('explicit report API', () => {
  it('sends only the chosen report payload and returns a matching server receipt', async () => {
    await expect(submitDecisionReport({ ...input, details: '  설명  ' })).resolves.toEqual(receipt);
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('vs_report_result', {
      p_request_id: requestId, p_category: 'incorrect', p_details: '설명', p_consent: true,
      p_poll_id: pollId, p_share_code: null,
    });
    expect(backend.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('reports a voted guest result by share code without sending a guessed owner ID', async () => {
    await submitDecisionReport({ ...input, target: { kind: 'voter', shareCode: 'friend-code' }, details: '' });
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('vs_report_result', {
      p_request_id: requestId, p_category: 'incorrect', p_details: '', p_consent: true,
      p_poll_id: null, p_share_code: 'friend-code',
    });
  });

  it.each([
    { ...input, consented: false },
    { ...input, requestId: 'invalid' },
    { ...input, details: '가'.repeat(201) },
    { ...input, target: { kind: 'owner', pollId: 'not-a-uuid' } },
    { ...input, target: { kind: 'voter', shareCode: '../another' } },
  ] as ReportSubmission[])('rejects invalid input before authentication or any network write', async invalid => {
    await expect(submitDecisionReport(invalid)).rejects.toMatchObject({ code: 'REPORT_INVALID' });
    expect(backend.ensureSession).not.toHaveBeenCalled();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('accepts the complete 200-unit description without truncation', async () => {
    const details = '가'.repeat(200);
    await submitDecisionReport({ ...input, details });
    expect(backend.rpc.mock.calls[0][1].p_details).toBe(details);
  });

  it.each(['PGRST202', '42883'])('treats missing server RPC %s as unavailable rather than a receipt', async code => {
    backend.abortSignal.mockResolvedValue({ data: null, error: { code, message: 'Function missing' } });
    await expect(submitDecisionReport(input)).rejects.toMatchObject({ code: 'REPORT_UNAVAILABLE' });
  });

  it.each(['REPORT_NOT_ALLOWED', 'REPORT_LIMIT', 'REPORT_BUSY', 'REPORT_REQUEST_CONFLICT'])('preserves server rejection %s', async code => {
    backend.abortSignal.mockResolvedValue({ data: null, error: { code: 'P0001', message: code } });
    await expect(submitDecisionReport(input)).rejects.toMatchObject({ code });
  });

  it.each([
    null, {}, { ...receipt, status: 'queued' }, { ...receipt, receiptId: 'client-generated-text' },
    { ...receipt, requestId: pollId }, { ...receipt, receivedAt: 'not-a-time' },
  ])('does not accept a partial or mismatched response as received', async data => {
    backend.abortSignal.mockResolvedValue({ data, error: null });
    await expect(submitDecisionReport(input)).rejects.toMatchObject({ code: 'REPORT_RECEIPT_INVALID' });
  });

  it('does not send a late report when authentication finishes after timeout', async () => {
    vi.useFakeTimers();
    let finishSession!: (token: string) => void;
    backend.ensureSession.mockReturnValue(new Promise<string>(resolve => { finishSession = resolve; }));
    const result = submitDecisionReport(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    finishSession('late-session');
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('times out once without automatically replaying a pending RPC', async () => {
    vi.useFakeTimers();
    backend.abortSignal.mockReturnValue(new Promise(() => {}));
    const result = submitDecisionReport(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(backend.abortSignal.mock.calls[0][0].aborted).toBe(true);
  });

  it('fails honestly if secure request IDs cannot be created', () => {
    vi.stubGlobal('crypto', {});
    expect(() => createReportRequestId()).toThrowError(new AppError('REPORT_UNAVAILABLE'));
  });
});
