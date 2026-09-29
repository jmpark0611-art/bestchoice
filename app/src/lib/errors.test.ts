import { codeFromRpcMessage, errorMessage, RETRYABLE } from './errors';

describe('errors', () => {
  it('RPC 예외 메시지에서 코드를 찾는다', () => {
    expect(codeFromRpcMessage('AI_LIMIT_USER')).toBe('AI_LIMIT');
    expect(codeFromRpcMessage('DAILY_LIMIT')).toBe('DAILY_LIMIT');
    expect(codeFromRpcMessage('something else')).toBe('UNKNOWN');
    expect(codeFromRpcMessage(undefined)).toBe('UNKNOWN');
  });

  it('모르는 코드는 기본 문구', () => {
    expect(errorMessage('WHAT')).toMatch('잠시 후 다시');
    expect(errorMessage('AI_LIMIT')).toMatch('AI 분석 가능 횟수');
  });

  it('한도 초과는 재시도 대상이 아니다', () => {
    expect(RETRYABLE.has('AI_LIMIT')).toBe(false);
    expect(RETRYABLE.has('PREVIOUS_FAILED')).toBe(true);
  });
});
