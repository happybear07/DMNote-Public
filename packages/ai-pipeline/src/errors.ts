// AI 파이프라인 오류 (API.md 1.4 코드 + 클라이언트 전용 코드). 사용자 문구는 MESSAGES.md 3.7 · 3.8 · 부록 B.
// Edge 경유든 Anthropic 직접 호출(로컬 전용 모드)이든 같은 코드로 정규화한다 — 사용자는 경로를 몰라도 된다.

export type AiErrorCode =
  // Edge API (API.md 1.4)
  | 'invalid-request' | 'token-expired' | 'unauthenticated' | 'forbidden' | 'payload-too-large'
  | 'no-api-key' | 'invalid-api-key' | 'ai-refused' | 'client-outdated' | 'in-progress'
  | 'rate-limited' | 'upstream-error' | 'upstream-overloaded' | 'upstream-timeout'
  // 클라이언트 전용
  | 'network'          // fetch 실패 · 연결 끊김
  | 'offline'
  | 'aborted'          // 사용자 취소 (FR-103)
  | 'invalid-response' // 교정 재요청까지 형식 위반 (FR-100)
  | 'too-short'        // 공백 아닌 글자 20자 미만 (AI-PROMPTS 5절)
  | 'too-long';        // 120,000자 초과

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  /** 초 단위 (Retry-After · Problem Details retryAfter) */
  readonly retryAfter?: number;
  readonly requestId?: string;
  /** Problem Details `detail` 등 개발자용 설명 — 사용자 문구가 아니다 */
  readonly detail?: string;

  constructor(code: AiErrorCode, init: { status?: number; retryAfter?: number; requestId?: string; detail?: string; cause?: unknown } = {}) {
    super(init.detail ? `${code}: ${init.detail}` : code);
    this.name = 'AiError';
    this.code = code;
    this.status = init.status;
    this.retryAfter = init.retryAfter;
    this.requestId = init.requestId;
    this.detail = init.detail;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

/** 자동 재시도 대상 (FR-102: 429 · 5xx · 529 · 네트워크). 타임아웃은 사용자 선택이라 넣지 않는다 (MESSAGES 부록 B). */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof AiError)) return false;
  return e.code === 'rate-limited' || e.code === 'upstream-error' || e.code === 'upstream-overloaded' || e.code === 'network';
}

/** HTTP 상태(Anthropic 직접 호출 · Edge 둘 다)를 코드로. Edge는 본문 `code`가 있으면 그쪽이 우선. */
export function codeFromStatus(status: number, upstream: 'anthropic' | 'edge'): AiErrorCode {
  if (upstream === 'anthropic') {
    if (status === 401 || status === 403) return 'invalid-api-key';
    if (status === 429) return 'rate-limited';
    if (status === 529) return 'upstream-overloaded';
    if (status === 413) return 'payload-too-large';
    if (status === 408 || status === 504) return 'upstream-timeout';
    if (status >= 500) return 'upstream-error';
    return 'invalid-request';
  }
  switch (status) {
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 409: return 'in-progress';
    case 413: return 'payload-too-large';
    case 422: return 'invalid-api-key';
    case 426: return 'client-outdated';
    case 429: return 'rate-limited';
    case 503: return 'upstream-overloaded';
    case 504: return 'upstream-timeout';
    default: return status >= 500 ? 'upstream-error' : 'invalid-request';
  }
}

export interface AiErrorMessage { readonly id: string; readonly text: string }

/** 사용자에게 보일 문구 (MESSAGES.md). {time} 같은 자리표시자는 UI가 채운다. */
export function aiErrorMessage(e: AiError): AiErrorMessage {
  switch (e.code) {
    case 'invalid-request': return { id: 'MSG-API-400', text: '요청을 처리하지 못했어요. 앱 쪽 문제일 수 있어 오류 정보를 남겼어요. 원문과 노트는 그대로예요.' };
    case 'token-expired':
    case 'unauthenticated': return { id: 'MSG-API-401B', text: '로그인이 만료됐어요. 다시 로그인하면 동기화를 이어 가요. 그동안 편집은 이 기기에 저장돼요.' };
    case 'forbidden': return { id: 'MSG-API-403A', text: '이 노트에 접근할 권한이 없어요. 다른 계정으로 로그인했는지 확인해 주세요.' };
    case 'payload-too-large': return { id: 'MSG-API-413A', text: '보내려는 내용이 너무 커요({size}). 일부만 선택해 나눠서 시도해 주세요. 원문은 그대로 있어요.' };
    case 'no-api-key': return { id: 'MSG-AI-010', text: 'Claude API 키가 있어야 구조화할 수 있어요. 키를 등록하면 지금 요청을 바로 이어서 할게요. 원문은 그대로 있어요.' };
    case 'invalid-api-key': return { id: 'MSG-API-422B', text: '이 키로는 Claude에 연결하지 못했어요. 키가 만료됐거나 삭제됐을 수 있어요. 원문은 그대로 있어요.' };
    case 'ai-refused': return { id: 'MSG-AI-034', text: '이 내용은 AI가 처리하지 않았어요. 원문은 그대로 있어요.' };
    case 'client-outdated': return { id: 'MSG-API-426', text: '이 버전은 더 이상 서버와 연결할 수 없어요. 다시 열어 업데이트해 주세요. 노트는 이 기기에 안전하게 남아 있어요.' };
    case 'in-progress': return { id: 'MSG-AI-026', text: '이미 구조화하는 중이에요.' };
    case 'rate-limited': return { id: 'MSG-API-429A', text: 'AI 요청이 몰려서 잠시 쉬어야 해요. {time} 뒤에 다시 시도할 수 있어요. 원문은 그대로 있어요.' };
    case 'upstream-error': return { id: 'MSG-API-502', text: 'AI 서비스에서 오류가 나 결과를 받지 못했어요. 잠시 후 다시 시도해 주세요. 원문은 그대로 있어요.' };
    case 'upstream-overloaded': return { id: 'MSG-API-503', text: 'AI 서비스가 지금 붐벼요. 잠시 후 다시 시도해 주세요. 원문은 그대로 있어요.' };
    case 'upstream-timeout': return { id: 'MSG-API-504', text: '응답이 너무 오래 걸려 멈췄어요. 글을 나눠서 구조화하면 더 빨라요. 원문은 그대로 있어요.' };
    case 'network': return { id: 'MSG-NET-004', text: '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요. 노트는 이 기기에 안전하게 남아 있어요.' };
    case 'offline': return { id: 'MSG-NET-002', text: '인터넷에 연결되어 있지 않아 지금은 AI를 쓸 수 없어요. 원문은 그대로 있어요.' };
    case 'aborted': return { id: 'MSG-AI-023', text: '구조화를 취소했어요. 노트는 바뀌지 않았어요.' };
    case 'invalid-response': return { id: 'MSG-AI-031', text: 'AI 응답 형식이 맞지 않아 결과를 넣지 못했어요. 다시 시도하면 대부분 해결돼요. 원문은 그대로 있어요.' };
    case 'too-short': return { id: 'MSG-AI-032', text: '구조화할 내용이 너무 적어요. 조금 더 긴 글을 골라 주세요.' };
    case 'too-long': return { id: 'MSG-AI-033', text: '글이 너무 길어요. 일부만 선택해서 구조화해 주세요. 원문은 그대로 있어요.' };
  }
}
