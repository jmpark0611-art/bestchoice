export class AppError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_INPUT: '입력한 내용을 다시 확인해주세요.',
  SAME_OPTIONS: 'A와 B를 다르게 적어주세요.',
  VS_LIMIT: '오늘은 여기까지예요. 내일 다시 물어봐 주세요.',
  VS_BUSY: '지금 지니를 찾는 사람이 많아요. 잠시 후 다시 시도해주세요.',
  NOT_FOUND: '없는 투표예요. 링크를 다시 확인해주세요.',
  OWNER_CANNOT_VOTE: '내가 만든 투표에는 투표할 수 없어요.',
  VOTE_CLOSED: '투표가 마감됐어요.',
  RESULT_INVALID: '저장된 결론을 불러오지 못했어요. 다시 시도해주세요.',
  TIMEOUT: '응답이 늦어지고 있어요. 이미 저장됐을 수 있으니 최근 결정을 먼저 확인해주세요.',
  NETWORK: '연결이 불안정해요. 잠시 후 다시 시도해주세요.',
  AI_FAILED: '지니가 답을 못 냈어요. 다시 시도해주세요.',
};
const KNOWN_RPC = ['INVALID_INPUT', 'NOT_FOUND', 'OWNER_CANNOT_VOTE', 'VOTE_CLOSED', 'AUTH_REQUIRED', 'SHARE_FAILED'];

export const errorMessage = (code: string) => MESSAGES[code] ?? (code.startsWith('AI_') || code === 'MODEL_FORMAT' ? MESSAGES.AI_FAILED : MESSAGES.NETWORK);
export const codeOf = (e: unknown) => (e instanceof AppError ? e.code : 'NETWORK');
export const codeFromRpcMessage = (message?: string) => KNOWN_RPC.find((c) => message?.includes(c)) ?? 'NETWORK';
