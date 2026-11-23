/** A versioned acknowledgement only; no question, user ID, or server request is stored here. */
export const CONTENT_POLICY_VERSION = 'shared-content-v1';
export const CONTENT_POLICY_STORAGE_KEY = 'genie:shared-content-policy:v1';

export const SHARED_CONTENT_RULES = [
  '타인의 개인정보·비밀을 동의 없이 공개하거나, 타인의 권리를 침해하는 질문은 공유하지 마세요.',
  '혐오·괴롭힘·협박, 성적 착취·아동 유해 내용, 불법 행위를 조장하는 내용과 스팸은 금지해요.',
  '링크를 받은 사람은 선택지와 상황을 볼 수 있고 다른 사람에게 링크를 전달할 수 있어요.',
] as const;

export function hasAcceptedContentPolicy(): boolean {
  try {
    const raw = localStorage.getItem(CONTENT_POLICY_STORAGE_KEY);
    if (!raw || raw.length > 500) return false;
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null &&
      (value as { version?: unknown }).version === CONTENT_POLICY_VERSION &&
      (value as { accepted?: unknown }).accepted === true;
  } catch { return false; }
}

/** Called only after the explicit checkbox and share action. Storage denial never grants consent. */
export function rememberContentPolicyAcceptance(): boolean {
  try {
    const value = JSON.stringify({ version: CONTENT_POLICY_VERSION, accepted: true });
    localStorage.setItem(CONTENT_POLICY_STORAGE_KEY, value);
    return localStorage.getItem(CONTENT_POLICY_STORAGE_KEY) === value;
  } catch { return false; }
}
