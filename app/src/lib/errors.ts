// 서버(RPC 예외 메시지, decision-ai 오류 코드) → 사용자 문구

export class AppError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '로그인 정보가 만료됐어요. 앱을 다시 열어주세요.',
  INVALID_INPUT: '입력 내용을 다시 확인해주세요.',
  INVALID_ANSWERS: '답변을 다시 확인해주세요.',
  DAILY_LIMIT: '오늘은 고민을 더 등록할 수 없어요. 내일 다시 이용해주세요.',
  AI_LIMIT: '오늘 AI 분석 가능 횟수를 모두 썼어요. 내일 다시 이용해주세요.',
  REQUEST_CONFLICT: '요청이 겹쳤어요. 잠시 후 다시 시도해주세요.',
  IN_PROGRESS: '이미 분석 중이에요. 잠시 후 다시 확인해주세요.',
  PREVIOUS_FAILED: '이전 분석이 실패했어요. 다시 시도해주세요.',
  NOT_FOUND: '기록을 찾을 수 없어요. 삭제됐거나 보관기간이 지났을 수 있어요.',
  RESULT_REQUIRED: '분석이 끝난 뒤에 기록할 수 있어요.',
  NOT_CONFIGURED: 'AI 분석을 준비하고 있어요. 잠시 후 다시 시도해주세요.',
  AI_QUOTA: 'AI 분석을 잠시 이용할 수 없어요. 잠시 후 다시 시도해주세요.',
  AI_RATE_LIMIT: '요청이 많아요. 잠시 후 다시 시도해주세요.',
  AI_REFUSED: '이 고민은 분석하기 어려워요. 내용을 바꿔서 다시 적어주세요.',
  MODEL_FORMAT: '분석 결과를 만들지 못했어요. 다시 시도해주세요.',
  SAVE_UNCERTAIN: '저장 상태를 확인하지 못했어요. 기록 화면에서 확인해주세요.',
  NETWORK: '네트워크 연결을 확인해주세요.',
};

export const RETRYABLE = new Set([
  'PREVIOUS_FAILED',
  'IN_PROGRESS',
  'REQUEST_CONFLICT',
  'NOT_CONFIGURED',
  'AI_QUOTA',
  'AI_RATE_LIMIT',
  'AI_UPSTREAM',
  'AI_UNCERTAIN',
  'AI_INCOMPLETE',
  'AI_FAILED',
  'MODEL_FORMAT',
  'NETWORK',
]);

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? '문제가 생겼어요. 잠시 후 다시 시도해주세요.';
}

/** Postgres 예외 메시지(예: "AI_LIMIT_USER")를 코드로 정규화 */
export function codeFromRpcMessage(message: string | undefined): string {
  const m = message ?? '';
  const known = Object.keys(MESSAGES).find((k) => m.includes(k));
  return known ?? 'UNKNOWN';
}
