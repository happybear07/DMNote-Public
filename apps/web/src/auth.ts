// 로그인 (FR-094 · UX 4.7 · 화면 17): 이메일 매직 링크 · Google · Apple. 로그인은 선택 — 안 해도 이 기기에서는 모든 편집이 된다.
// 서버는 Supabase Auth(ARCHITECTURE 8) — SDK 없이 REST로 부른다(의존성 추가 없음). 주소 · 공개 키(anon)는 VITE_SUPABASE_URL ·
// VITE_SUPABASE_ANON_KEY. 없으면 '서버 연결 전'으로 로그인 단추를 막고 "로그인 없이 계속"만 연다.
// 개발 · e2e에서는 localStorage 'dn:auth-mock'으로 흉내 서버(메일 대신 바로 돌아오는 링크)를 쓸 수 있다.

export interface AuthUser { readonly id: string; readonly email: string; /** 계정 삭제 예약 시각 (ms) — 유예 중 로그인 (MSG-ACC-012) */ readonly deleteAt?: number }
export interface AuthSession { readonly user: AuthUser; readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: number }
export type OAuthProvider = 'google' | 'apple';
export type AuthErrorCode = 'expired' | 'failed' | 'network' | 'rate-limit' | 'invalid-email' | 'not-configured';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, detail?: string) { super(detail ?? code); }
}

export interface AuthBackend {
  readonly configured: boolean;
  /** 로그인 링크 메일 보내기 (매직 링크) */
  sendLink(email: string, redirectTo: string): Promise<void>;
  /** 소셜 로그인 페이지 주소 — 그쪽으로 넘어갔다가 redirectTo#access_token=… 으로 돌아온다 */
  oauthUrl(provider: OAuthProvider, redirectTo: string): string;
  /** 돌아온 주소의 해시(#access_token=… · #error=…) → 세션. 로그인 결과가 아니면 null */
  fromRedirect(hash: string): Promise<AuthSession | null>;
  refresh(s: AuthSession): Promise<AuthSession>;
  signOut(s: AuthSession): Promise<void>;
  /** 예약된 계정 삭제 취소 */
  cancelDeletion(s: AuthSession): Promise<void>;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** 해시의 오류 → 사용자에게 보일 종류 (만료 · 이미 쓴 링크는 'expired') */
function hashError(p: URLSearchParams): AuthError | null {
  const e = p.get('error_code') ?? p.get('error');
  if (!e) return null;
  return new AuthError(/expired|otp|invalid|already/i.test(`${e} ${p.get('error_description') ?? ''}`) ? 'expired' : 'failed', p.get('error_description') ?? e);
}

export function supabaseBackend(url: string, anonKey: string): AuthBackend {
  const base = url.replace(/\/+$/, '') + '/auth/v1';
  const call = async (path: string, init: RequestInit & { token?: string } = {}): Promise<Response> => {
    let r: Response;
    try {
      r = await fetch(base + path, { ...init, headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) } });
    } catch { throw new AuthError('network'); }
    if (r.status === 429) throw new AuthError('rate-limit');
    if (!r.ok) throw new AuthError(r.status === 401 || r.status === 403 ? 'expired' : 'failed', String(r.status));
    return r;
  };
  const toSession = async (accessToken: string, refreshToken: string, expiresIn: number): Promise<AuthSession> => {
    const u = await (await call('/user', { token: accessToken })).json() as { id: string; email: string; user_metadata?: { delete_at?: number | string } };
    const del = u.user_metadata?.delete_at ? new Date(u.user_metadata.delete_at).getTime() : undefined;
    return { user: { id: u.id, email: u.email, ...(del && del > Date.now() ? { deleteAt: del } : {}) }, accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 };
  };
  return {
    configured: true,
    async sendLink(email, redirectTo) {
      await call(`/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: JSON.stringify({ email: email.trim(), create_user: true }) });
    },
    oauthUrl: (provider, redirectTo) => `${base}/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`,
    async fromRedirect(hash) {
      const p = new URLSearchParams(hash.replace(/^#/, ''));
      const err = hashError(p);
      if (err) throw err;
      const at = p.get('access_token'), rt = p.get('refresh_token');
      if (!at || !rt) return null;
      return toSession(at, rt, Number(p.get('expires_in') ?? 3600));
    },
    async refresh(s) {
      const j = await (await call('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refreshToken }) })).json() as { access_token: string; refresh_token: string; expires_in: number };
      return toSession(j.access_token, j.refresh_token, j.expires_in);
    },
    async signOut(s) { await call('/logout', { method: 'POST', token: s.accessToken }).catch(() => {}); },
    async cancelDeletion(s) { await call('/user', { method: 'PUT', token: s.accessToken, body: JSON.stringify({ data: { delete_at: null } }) }); },
  };
}

/**
 * 흉내 서버 (개발 · e2e 전용): 메일 대신 "링크"를 바로 돌려받는다 — window.__dnAuthLink에 마지막 링크 해시.
 * 이메일에 'expired'가 들어가면 만료된 링크, 'delete'가 들어가면 삭제 예약 계정.
 */
export function mockBackend(): AuthBackend {
  const w = window as unknown as { __dnAuthLink?: string };
  const session = (email: string): AuthSession => ({
    user: { id: `mock-${email}`, email, ...(/delete/.test(email) ? { deleteAt: Date.now() + 7 * 864e5 } : {}) },
    accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresAt: Date.now() + 3600e3,
  });
  return {
    configured: true,
    async sendLink(email) {
      w.__dnAuthLink = /expired/.test(email) ? '#error=access_denied&error_code=otp_expired' : `#access_token=mock&refresh_token=mock&expires_in=3600&mock_email=${encodeURIComponent(email)}`;
    },
    oauthUrl: (provider) => `#access_token=mock&refresh_token=mock&expires_in=3600&mock_email=${encodeURIComponent(`${provider}@example.com`)}`,
    async fromRedirect(hash) {
      const p = new URLSearchParams(hash.replace(/^#/, ''));
      const err = hashError(p);
      if (err) throw err;
      const email = p.get('mock_email');
      return email ? session(email) : null;
    },
    async refresh(s) { return { ...s, expiresAt: Date.now() + 3600e3 }; },
    async signOut() {},
    async cancelDeletion() {},
  };
}

const unconfigured: AuthBackend = {
  configured: false,
  sendLink: () => Promise.reject(new AuthError('not-configured')),
  oauthUrl: () => '',
  fromRedirect: () => Promise.resolve(null),
  refresh: () => Promise.reject(new AuthError('not-configured')),
  signOut: () => Promise.resolve(),
  cancelDeletion: () => Promise.reject(new AuthError('not-configured')),
};

export function authBackend(): AuthBackend {
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return supabaseBackend(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  try { if ((import.meta.env.DEV || env.VITE_E2E === '1') && localStorage.getItem('dn:auth-mock')) return mockBackend(); } catch { /* 저장소를 못 쓰면 흉내 없음 */ }
  return unconfigured;
}

/** 오류 → 문구 (MESSAGES MSG-AUTH) */
export function authErrorText(e: unknown): string {
  const code = e instanceof AuthError ? e.code : 'failed';
  return ({
    expired: '로그인 링크가 만료됐어요. 새 링크를 받아 주세요.',
    failed: '로그인을 마치지 못했어요. 다시 시도해 주세요.',
    network: '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.',
    'rate-limit': '잠시 뒤에 다시 시도해 주세요. 링크를 너무 자주 요청했어요.',
    'invalid-email': '이메일 주소를 확인해 주세요.',
    'not-configured': '동기화 서버가 아직 연결되지 않았어요. 지금은 로그인 없이 이 기기에서 쓸 수 있어요.',
  } satisfies Record<AuthErrorCode, string>)[code];
}
