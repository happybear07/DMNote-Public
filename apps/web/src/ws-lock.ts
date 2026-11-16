// 워크스페이스 잠금 층 (FR-144 노트 · 폴더 잠금, FR-145 앱 잠금, FR-146 잠긴 노트 암호화).
// - 금고: 이 기기의 잠금 비밀번호 하나. 비밀번호 → 열쇠를 감싼 기록만 설정에 두고, 풀린 열쇠는 메모리에만.
// - 잠긴 노트: 내용 · 버전을 암호화해 저장, 목록에는 제목만(미리보기 없음), 검색 · 백링크 · 할 일 모으기 · 내보내기에서 빠진다.
// - 앱 잠금: 켜 두면 시작할 때 · 일정 시간 손대지 않으면 · 다른 앱에 다녀오면 잠금 화면(내용을 가린다). 화면 잠금일 뿐 저장 데이터를 암호화하지는 않는다.
// 층 순서: … → ws-versions → 여기 → workspace.ts
import { serialize, type Id } from '@dn/engine-core';
import { changeVaultPassword, createVault, openVault, type VaultRecord } from '@dn/storage-idb';
import { VersionLayer } from './ws-versions';
import { collectReminders } from './reminders';

/** 비밀번호 최소 길이 */
export const MIN_PASSWORD = 10; // 기기 안 암호화의 열쇠 — 짧으면 쉽게 맞힌다 (보안 3-4)

export abstract class LockLayer extends VersionLayer {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenAt = 0;
  private lockOffs: (() => void)[] = [];

  /** 부팅 때: 금고 · 잠긴 노트 표시 · 앱 잠금 설정을 읽고, 앱 잠금이 켜져 있으면 잠근 채 시작 */
  protected async installLocks(): Promise<void> {
    const rec = await this.meta.getSetting<VaultRecord>('vault');
    const appLock = (await this.meta.getSetting<{ enabled: boolean; minutes: number }>('appLock')) ?? { enabled: false, minutes: 5 };
    for (const n of [...this.state.notes, ...this.state.trash]) if (n.locked) this.store.markLocked(n.id, true);
    this.state.vault = rec ? 'locked' : 'none';
    this.state.appLock = rec ? appLock : { ...appLock, enabled: false };
    this.state.appLocked = !!rec && appLock.enabled;
    const poke = () => this.armIdle();
    const onVis = () => {
      if (document.hidden) { this.hiddenAt = Date.now(); return; }
      const a = this.state.appLock;
      if (a.enabled && this.hiddenAt && Date.now() - this.hiddenAt >= a.minutes * 60_000) this.lockApp();
      this.hiddenAt = 0;
    };
    for (const t of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(t, poke, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVis);
    this.lockOffs = [() => { for (const t of ['pointerdown', 'keydown', 'wheel'] as const) window.removeEventListener(t, poke, { capture: true }); }, () => document.removeEventListener('visibilitychange', onVis)];
    this.armIdle();
  }

  protected uninstallLocks(): void { for (const f of this.lockOffs) f(); if (this.idleTimer) clearTimeout(this.idleTimer); }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const a = this.state.appLock;
    if (!a.enabled || this.state.appLocked) return;
    this.idleTimer = setTimeout(() => this.lockApp(), a.minutes * 60_000);
  }

  // ───────── 금고 ─────────

  /** 처음 비밀번호 정하기 — 정하면 바로 풀린 상태 */
  async setupVault(password: string): Promise<boolean> {
    if (password.length < MIN_PASSWORD || this.state.vault !== 'none') return false;
    const { record, cipher } = await createVault(password);
    await this.meta.setSetting('vault', record);
    this.store.setVault(cipher);
    this.set({ vault: 'open' });
    return true;
  }

  /** 비밀번호로 풀기 — 앱 잠금 화면 · 잠긴 노트 열기 둘 다 */
  async unlockVault(password: string): Promise<boolean> {
    const rec = await this.meta.getSetting<VaultRecord>('vault');
    const cipher = rec ? await openVault(rec, password) : null;
    if (!cipher) return false;
    this.store.setVault(cipher);
    const want = this.state.unlockFor;
    this.set({ vault: 'open', appLocked: false, unlockFor: null });
    this.armIdle();
    if (want) await this.openById(want, { force: true });
    return true;
  }

  /** 금고 잠그기 — 열린 잠긴 노트는 닫고, 열쇠를 메모리에서 버린다 */
  async lockVault(): Promise<void> {
    if (this.state.vault !== 'open') return;
    const cur = this.state.currentId;
    if (cur && this.store.isLocked(cur)) { await this.openById(cur, { force: true }).catch(() => {}); }
    this.store.setVault(null);
    this.set({ vault: 'locked' });
    if (cur && this.store.isLocked(cur)) await this.openById(cur, { force: true });
  }

  async changeVaultPassword(oldPw: string, newPw: string): Promise<'ok' | 'wrong' | 'short'> {
    if (newPw.length < MIN_PASSWORD) return 'short';
    const rec = await this.meta.getSetting<VaultRecord>('vault');
    const next = rec ? await changeVaultPassword(rec, oldPw, newPw) : null;
    if (!next) return 'wrong';
    await this.meta.setSetting('vault', next);
    return 'ok';
  }

  // ───────── 노트 · 폴더 잠그기 (FR-144) ─────────

  /** 잠그기 · 풀기 — 금고가 열려 있어야 한다. 열린 노트면 저장 로그를 먼저 비우고 지금 엔진으로 다시 쓴다 */
  async setNoteLocked(id: Id, on: boolean): Promise<boolean> {
    if (this.state.vault !== 'open') return false;
    const meta = this.state.notes.find((n) => n.id === id);
    if (!meta || !!meta.locked === on) return !!meta;
    const o = this.open?.engine.note.id === id ? this.open : null;
    if (o) { o.view.endEditing(); await o.session.flush(); }
    const engine = o?.engine ?? (await this.readEngine(id));
    if (!engine) { this.toast('노트를 읽지 못해 잠그지 못했어요.'); return false; }
    await this.store.setNoteLocked(id, on, serialize(engine));
    // 알림(FR-136) 글자도 목록 정보에서 지운다 — 홈 · 기기 알림에 잠긴 노트 본문이 나오지 않게 (풀면 다시)
    await this.meta.patch(id, on ? { locked: true, preview: '', coverThumb: undefined, reminders: collectReminders(engine, { hideText: true }) } : { locked: undefined, reminders: collectReminders(engine) });
    await this.putSearchDoc(engine);
    if (!on) await this.meta.patch(id, { preview: '' });
    await this.refreshList();
    return true;
  }

  /** 폴더 잠그기: 안의 노트를 모두 잠그고, 폴더에 표시해 새 노트도 잠기게 */
  async setFolderLocked(folderId: Id, on: boolean): Promise<number> {
    if (this.state.vault !== 'open') return 0;
    const f = this.state.folders.find((x) => x.id === folderId);
    if (!f) return 0;
    await this.meta.putFolder({ ...f, ...(on ? { locked: true } : { locked: undefined }), updatedAt: Date.now() });
    let n = 0;
    for (const note of this.state.notes.filter((x) => x.folderId === folderId)) if (await this.setNoteLocked(note.id, on)) n++;
    await this.refreshList();
    return n;
  }

  /** 메뉴의 "잠그기 · 잠금 풀기" — 금고가 준비되지 않았으면 설정 › 보안으로 안내 */
  async toggleNoteLock(id: Id): Promise<void> {
    if (!(await this.vaultReady())) return;
    const on = !this.state.notes.find((n) => n.id === id)?.locked;
    if (await this.setNoteLocked(id, on)) this.toast(on ? '노트를 잠갔어요. 내용은 암호화돼 저장되고, 검색에서 빠져요.' : '잠금을 풀었어요.');
  }

  async toggleFolderLock(id: Id): Promise<void> {
    if (!(await this.vaultReady())) return;
    const on = !this.state.folders.find((f) => f.id === id)?.locked;
    const n = await this.setFolderLocked(id, on);
    this.toast(on ? `폴더를 잠갔어요 (노트 ${n}개). 이 폴더에 새로 만드는 노트도 잠겨요.` : `폴더 잠금을 풀었어요 (노트 ${n}개).`);
  }

  private async vaultReady(): Promise<boolean> {
    if (this.state.vault === 'open') return true;
    this.toast(this.state.vault === 'none' ? '잠금 비밀번호를 먼저 정해 주세요.' : '잠금 비밀번호로 먼저 풀어 주세요.');
    this.set({ dialog: { kind: 'settings', reason: 'security' } });
    return false;
  }

  /** 잠긴 폴더에 만드는 새 노트는 잠근다 */
  override async newNote(place: Parameters<VersionLayer['newNote']>[0] = {}): Promise<void> {
    await super.newNote(place);
    const f = place.folderId ? this.state.folders.find((x) => x.id === place.folderId) : undefined;
    const id = this.state.currentId;
    if (f?.locked && id) {
      if (this.state.vault === 'open') await this.setNoteLocked(id, true);
      else this.toast('잠긴 폴더예요 — 금고가 잠겨 있어 새 노트는 잠그지 못했어요.');
    }
  }

  // ───────── 앱 잠금 (FR-145) ─────────

  async setAppLock(enabled: boolean, minutes = this.state.appLock.minutes): Promise<void> {
    const appLock = { enabled: enabled && this.state.vault !== 'none', minutes };
    await this.meta.setSetting('appLock', appLock);
    this.set({ appLock });
    this.armIdle();
  }

  lockApp(): void {
    if (!this.state.appLock.enabled || this.state.vault === 'none') return;
    this.view?.endEditing();
    this.set({ appLocked: true, overlay: null, dialog: null, blockMenu: null, moveBlocks: null, insertMenu: null, noteMenu: null });
  }
}
