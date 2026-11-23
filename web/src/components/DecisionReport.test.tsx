import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
import type { ReportReceipt } from '../lib/decisionReports';
import { DecisionReport } from './DecisionReport';

const submit = vi.hoisted(() => vi.fn());
vi.mock('../lib/decisionReports', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/decisionReports')>(), submitDecisionReport: submit,
}));

const pollId = '00000000-0000-4000-8000-000000000002';
const receiptId = '00000000-0000-4000-8000-000000000003';
const props = { target: { kind: 'owner' as const, pollId }, choiceLabel: '걸어가기', reason: '가까운 거리라 비용을 아낄 수 있어요.' };
const receipt: ReportReceipt = { status: 'received', receiptId, requestId: '00000000-0000-4000-8000-000000000001', receivedAt: '2026-11-23T09:00:00Z' };

async function previewReport(user: ReturnType<typeof userEvent.setup>, details = '거리가 적혀 있지 않아요') {
  await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
  await user.click(screen.getByRole('radio', { name: '사실과 맞지 않아요' }));
  if (details) await user.type(screen.getByLabelText('어떤 문제였나요? (선택)'), details);
  await user.click(screen.getByRole('button', { name: '보낼 내용 확인' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  submit.mockResolvedValue(receipt);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DecisionReport explicit consent and receipt', () => {
  it('previews the exact reason and details without a request, then sends only after consent', async () => {
    const user = userEvent.setup();
    render(<DecisionReport {...props} />);
    expect(submit).not.toHaveBeenCalled();
    await previewReport(user);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(props.reason)).toBeInTheDocument();
    expect(screen.getByText('거리가 적혀 있지 않아요')).toBeInTheDocument();
    expect(screen.getByText(/신고 사유·추가 설명과 이 결정의 식별 정보를 보내요/)).toBeInTheDocument();
    expect(screen.getByText(/이 기기의 회고·만족도·다른 결정 기록은 보내지 않아요/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: '신고 보내기' });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: '위 내용을 확인했고 신고 전송에 동의해요.' }));
    await user.click(send);
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      target: props.target, category: 'incorrect', details: '거리가 적혀 있지 않아요', consented: true,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('신고가 서버에 접수됐어요.');
    expect(screen.getByText(receiptId)).toBeInTheDocument();
  });

  it('does not claim reception while pending and collapses duplicate clicks to one request', async () => {
    let finish!: (result: ReportReceipt) => void;
    submit.mockReturnValue(new Promise<ReportReceipt>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const pendingChange = vi.fn();
    render(<DecisionReport {...props} onRequestPendingChange={pendingChange} />);
    await previewReport(user, '');
    await user.click(screen.getByRole('checkbox'));
    await user.dblClick(screen.getByRole('button', { name: '신고 보내기' }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('status')).toHaveTextContent('서버의 접수 확인을 기다리고 있어요.');
    expect(screen.queryByText('신고가 서버에 접수됐어요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '신고 닫기' })).toBeDisabled();
    await act(async () => { finish(receipt); });
    expect(screen.getByRole('status')).toHaveTextContent('신고가 서버에 접수됐어요.');
    expect(pendingChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps a timed-out payload immutable and reuses its request ID on explicit retry after closing', async () => {
    submit.mockRejectedValueOnce(new AppError('TIMEOUT')).mockResolvedValueOnce(receipt);
    const user = userEvent.setup();
    const pendingChange = vi.fn();
    render(<DecisionReport {...props} onRequestPendingChange={pendingChange} />);
    await previewReport(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '신고 보내기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('접수 여부를 확인하지 못했어요');
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('신고가 서버에 접수됐어요.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정하기' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('어떤 문제였나요? (선택)')).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '신고 닫기' }));
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
    await user.click(screen.getByRole('button', { name: '같은 신고 다시 보내기' }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
    expect(await screen.findByRole('status')).toHaveTextContent('신고가 서버에 접수됐어요.');
    expect(pendingChange).toHaveBeenLastCalledWith(false);
  });

  it('unlocks navigation only after explicit acknowledgment and relocks a same-ID retry', async () => {
    let finishRetry!: (result: ReportReceipt) => void;
    submit.mockRejectedValueOnce(new AppError('TIMEOUT'))
      .mockImplementationOnce(() => new Promise<ReportReceipt>(resolve => { finishRetry = resolve; }));
    const user = userEvent.setup();
    const pendingChange = vi.fn();
    render(<DecisionReport {...props} onRequestPendingChange={pendingChange} />);
    await previewReport(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '신고 보내기' }));
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '접수 확인 없이 나가기 허용' }));
    expect(screen.getByText(/신고가 이미 서버에 접수됐을 수 있어요/)).toBeInTheDocument();
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '계속 접수 확인하기' }));
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '접수 확인 없이 나가기 허용' }));
    await user.click(screen.getByRole('button', { name: '확인 없이 나갈게요' }));
    expect(pendingChange).toHaveBeenLastCalledWith(false);
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '신고 닫기' }));
    await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
    expect(pendingChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: '같은 신고 다시 보내기' }));
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
    await act(async () => { finishRetry(receipt); });
    expect(pendingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status')).toHaveTextContent('신고가 서버에 접수됐어요.');
  });

  it('releases the parent guard on unmount and ignores a late receipt', async () => {
    let finish!: (result: ReportReceipt) => void;
    submit.mockReturnValue(new Promise<ReportReceipt>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const pendingChange = vi.fn();
    const view = render(<DecisionReport {...props} onRequestPendingChange={pendingChange} />);
    await previewReport(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '신고 보내기' }));
    expect(pendingChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(pendingChange).toHaveBeenLastCalledWith(false);
    const calls = pendingChange.mock.calls.length;
    await act(async () => { finish(receipt); });
    expect(pendingChange).toHaveBeenCalledTimes(calls);
  });

  it('shows unavailable server status without a fabricated receipt or automatic resend', async () => {
    submit.mockRejectedValue(new AppError('REPORT_UNAVAILABLE'));
    const user = userEvent.setup();
    render(<DecisionReport {...props} />);
    await previewReport(user, '');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '신고 보내기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('지금은 신고 접수 기능을 사용할 수 없어요');
    expect(screen.queryByText('신고가 서버에 접수됐어요.')).not.toBeInTheDocument();
    expect(screen.queryByText(/접수 번호:/)).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('requires fresh consent after editing a preview before submission', async () => {
    const user = userEvent.setup();
    render(<DecisionReport {...props} />);
    await previewReport(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '수정하기' }));
    await user.clear(screen.getByLabelText('어떤 문제였나요? (선택)'));
    await user.type(screen.getByLabelText('어떤 문제였나요? (선택)'), '수정한 설명');
    await user.click(screen.getByRole('button', { name: '보낼 내용 확인' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '신고 보내기' })).toBeDisabled();
    expect(screen.getByText('수정한 설명')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not carry an old target draft or receipt into a different result', async () => {
    let finish!: (result: ReportReceipt) => void;
    submit.mockReturnValue(new Promise<ReportReceipt>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const view = render(<DecisionReport {...props} />);
    await previewReport(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '신고 보내기' }));
    view.rerender(<DecisionReport target={{ kind: 'voter', shareCode: 'new-result' }} choiceLabel="택시" reason="새 결과" />);
    await act(async () => { finish(receipt); });
    expect(screen.queryByText(receiptId)).not.toBeInTheDocument();
    expect(screen.queryByText('신고가 서버에 접수됐어요.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
    expect(screen.getByLabelText('어떤 문제였나요? (선택)')).toHaveValue('');
    expect(screen.getByRole('radio', { name: '사실과 맞지 않아요' })).not.toBeChecked();
  });

  it('keeps external busy states from starting a report', async () => {
    const user = userEvent.setup();
    render(<DecisionReport {...props} disabled />);
    expect(screen.getByRole('button', { name: 'AI 답변 신고' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'AI 답변 신고' }));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
