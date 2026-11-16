// 계정 · 로그인 흐름 (FR-094 · UX 4.7 · 화면 17 · 17-4~6): 로그인 창 단계, 매직 링크 · 소셜 로그인 결과 받기, 세션 저장(기기 암호화),
// 다른 탭에서 링크를 열면 이 탭도 이어서 로그인(BroadcastChannel), 삭제 예약 계정 확인, 로그아웃(노트는 이 기기에 남김).
import type { MetaStore } from '@dn/storage-idb';
import { AuthError, authBackend, authErrorText, isEmail, type AuthBackend, type AuthSession, type OAuthProvider } from './auth';

export interface LoginState {
  step: 'start' | 'sent' | 'expired' | 'deletion';
  email: string;
  busy?: boolean;
  error?: string;
  /** 다시 보내기를 열어 줄 시각 (ms) — 60초 */
  resendAt?: number;
  /** 삭제 예약 시각 (ms) */
  deleteAt?: number;
}
export interface Account { id: string; email: string }

interface Host {
  readonly meta: MetaStore;
  account: Account | null;
  login: LoginState | null;
  patch(p: { account?: Account | null; login?: LoginState | null }): void;
  toast(text: string): void;
}

const SECRET = 'authSession';
const EMAIL_KEY = 'dn:login-email';
const RESEND_MS = 60_000;

export class AccountCtl {
  readonly backend: AuthBackend = authBackend();
  private session: AuthSession | null = null;
  /** 삭제 예약 계정: 고를 때까지 세션을 들고 있는다 */
  private pending: AuthSession | null = null;
  private readonly channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dn-auth') : null;

  constructor(private readonly h: Host) {
    // 다른 탭에서 로그인 · 로그아웃하면 이 탭도 따라간다
    if (this.channel) this.channel.onmessage = () => { void this.load(true); };
  }

  get configured(): boolean { return this.backend.configured; }

  async init(): Promise<void> {
    await this.load(false);
    if (/access_token=|error=/.test(location.hash)) await this.fromRedirect(location.hash);
  }

  private async load(fromOtherTab: boolean): Promise<void> {
    const raw = await this.h.meta.getSecret(SECRET).catch(() => undefined);
    this.session = raw ? (JSON.parse(raw) as AuthSession) : null;
    const account = this.session ? { id: this.session.user.id, email: this.session.user.email } : null;
    this.h.patch({ account, ...(fromOtherTab && account && this.h.login?.step === 'sent' ? { login: null } : {}) });
    if (fromOtherTab && account && this.h.login === null) this.h.toast(`${account.email} 계정으로 로그인했어요.`);
  }

  private savedEmail(): string { try { return localStorage.getItem(EMAIL_KEY) ?? ''; } catch { return ''; } }

  open(): void { this.h.patch({ login: { step: 'start', email: this.savedEmail() } }); }
  close(): void { this.pending = null; this.h.patch({ login: null }); }
  /** 다른 방법으로 · 다른 이메일로 → 처음 단계 */
  restart(): void { this.h.patch({ login: { step: 'start', email: this.h.login?.email ?? this.savedEmail() } }); }

  async sendLink(email: string): Promise<void> {
    const cur = this.h.login ?? { step: 'start' as const, email };
    if (!isEmail(email)) { this.h.patch({ login: { ...cur, email, error: authErrorText(new AuthError('invalid-email')) } }); return; }
    this.h.patch({ login: { ...cur, email, busy: true, error: undefined } });
    try {
      await this.backend.sendLink(email, location.origin + location.pathname);
      try { localStorage.setItem(EMAIL_KEY, email.trim()); } catch { /* 다음에 다시 쓰면 된다 */ }
      this.h.patch({ login: { step: 'sent', email: email.trim(), resendAt: Date.now() + RESEND_MS } });
    } catch (e) {
      this.h.patch({ login: { ...cur, email, busy: false, error: authErrorText(e) } });
    }
  }

  oauth(p: OAuthProvider): void {
    if (!this.backend.configured) return;
    const url = this.backend.oauthUrl(p, location.origin + location.pathname);
    if (url.startsWith('#')) void this.fromRedirect(url); // 흉내 서버: 바로 돌아온 것처럼
    else location.assign(url);
  }

  /** 매직 링크 · 소셜 로그인에서 돌아온 주소 (#access_token=… · #error=…) */
  async fromRedirect(hash: string): Promise<void> {
    if (location.hash === hash) history.replaceState(null, '', location.pathname + location.search); // 주소창에 토큰을 남기지 않는다
    try {
      const s = await this.backend.fromRedirect(hash);
      if (!s) return;
      if (s.user.deleteAt) { this.pending = s; this.h.patch({ login: { step: 'deletion', email: s.user.email, deleteAt: s.user.deleteAt } }); return; }
      await this.commit(s);
    } catch (e) {
      if (e instanceof AuthError && e.code === 'expired') this.h.patch({ login: { step: 'expired', email: this.savedEmail() } });
      else this.h.toast(authErrorText(e));
    }
  }

  private async commit(s: AuthSession): Promise<void> {
    this.session = s;
    await this.h.meta.setSecret(SECRET, JSON.stringify(s), { email: s.user.email });
    this.h.patch({ account: { id: s.user.id, email: s.user.email }, login: null });
    this.h.toast(`${s.user.email} 계정으로 로그인했어요.`);
    this.channel?.postMessage('login');
  }

  /** 삭제 예약 계정: 삭제 취소하고 계속 */
  async cancelDeletion(): Promise<void> {
    const s = this.pending;
    if (!s || !this.h.login) return;
    this.h.patch({ login: { ...this.h.login, busy: true } });
    try {
      await this.backend.cancelDeletion(s);
      this.pending = null;
      await this.commit({ ...s, user: { id: s.user.id, email: s.user.email } });
    } catch (e) { this.h.patch({ login: { ...this.h.login, busy: false, error: authErrorText(e) } }); }
  }

  /** 삭제 예약 계정: 그대로 두고 로그아웃 — 이 기기의 노트는 그대로 */
  async keepDeletion(): Promise<void> {
    const s = this.pending;
    this.pending = null;
    if (s) await this.backend.signOut(s);
    this.h.patch({ login: null });
    this.h.toast('로그아웃했어요. 노트는 이 기기에 안전하게 남아 있어요.');
  }

  /** 로그아웃 (MSG-ACC-001 · 003): 노트는 이 기기에 남기고 동기화만 멈춘다 */
  async logout(): Promise<void> {
    if (this.session) await this.backend.signOut(this.session);
    this.session = null;
    await this.h.meta.deleteSecret(SECRET);
    this.h.patch({ account: null });
    this.h.toast('로그아웃했어요. 노트는 이 기기에 안전하게 남아 있어요.');
    this.channel?.postMessage('logout');
  }
}
